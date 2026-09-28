'use strict';

const crypto = require('node:crypto');
const { id, token, now } = require('./ids');
const config = require('../config');
const { db } = require('../db');

// Set for the duration of one resolveIdentity call so the caller can see which
// kind of credential authenticated.
let lastCredential = null;

/* ------------------------------------------------------------------ passwords */

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 96 * 1024 * 1024,
  }).toString('hex');
  return { hash, salt };
}

function verifyPassword(password, hash, salt) {
  if (!hash || !salt) return false;
  const candidate = crypto.scryptSync(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 96 * 1024 * 1024,
  }).toString('hex');
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ------------------------------------------------------------------- sessions */

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

/**
 * Create a session. The raw token is returned to the caller exactly once, to be
 * placed in a cookie. Only its SHA-256 is stored, so a database copy does not
 * hand out live sessions.
 */
function createSession(userId, userAgent = '') {
  const raw = token(32);
  const created = new Date();
  const expires = new Date(created.getTime() + config.sessionTtlDays * 86400_000);
  db().prepare(`
    INSERT INTO sessions (id, user_id, token_hash, user_agent, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id('ses'), userId, sha256(raw), String(userAgent).slice(0, 300), created.toISOString(), expires.toISOString());
  db().prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now(), userId);
  return { token: raw, expiresAt: expires };
}

function sessionUser(rawToken) {
  if (!rawToken || typeof rawToken !== 'string' || rawToken.length < 8) return null;
  const credential = findCredential(sha256(rawToken));
  if (!credential) return null;
  lastCredential = credential;
  return loadUser(credential.user_id);
}

/**
 * A credential is either a browser session or a long-lived API token. Both
 * are stored hashed and both are revocable, so a copy of the database cannot
 * be replayed to impersonate anyone.
 */
function findCredential(hash) {
  const session = db().prepare(`
    SELECT user_id FROM sessions
    WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?
  `).get(hash, now());
  if (session) return { user_id: session.user_id, kind: 'session', scopes: [] };

  const token = db().prepare(`
    SELECT id, user_id, event_id, scopes FROM api_tokens
    WHERE token_hash = ? AND revoked_at IS NULL
      AND (expires_at IS NULL OR expires_at > ?)
  `).get(hash, now());
  if (token) {
    // Best effort; a bookkeeping write must never fail the request.
    try {
      db().prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').run(now(), token.id);
    } catch { /* ignore */ }
    let scopes = [];
    try { scopes = JSON.parse(token.scopes || '[]'); } catch { scopes = []; }
    return { user_id: token.user_id, kind: 'api_token', event_id: token.event_id, scopes };
  }
  return null;
}

function loadUser(userId) {
  return db().prepare(`
    SELECT id, email, name, headline, organisation, avatar_hue, auth_provider
    FROM users WHERE id = ?
  `).get(userId) || null;
}

function destroySession(rawToken) {
  if (!rawToken) return;
  db().prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
    .run(now(), sha256(rawToken));
}

function purgeExpiredSessions() {
  db().prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
}

/* --------------------------------------------------------------------- users */

function findUserByEmail(email) {
  return db().prepare('SELECT * FROM users WHERE email_key = ?').get(normaliseEmail(email));
}

function findUserById(userId) {
  return db().prepare('SELECT * FROM users WHERE id = ?').get(userId);
}

function createUser({ email, name, password, headline = '', organisation = '', provider = 'password' }) {
  const clean = normaliseEmail(email);
  if (findUserByEmail(clean)) {
    const err = new Error('An account with that email already exists.');
    err.statusCode = 409;
    throw err;
  }
  const credentials = password ? hashPassword(password) : { hash: '', salt: '' };
  const userId = id('usr');
  const hue = Math.abs([...clean].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 360, 7)) % 360;
  db().prepare(`
    INSERT INTO users (id, email, email_key, name, headline, organisation, avatar_hue,
                       password_hash, password_salt, auth_provider, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId, clean, clean, name, headline, organisation, hue,
    credentials.hash, credentials.salt, provider, now());
  return findUserById(userId);
}

function normaliseEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    headline: user.headline || '',
    organisation: user.organisation || '',
    bio: user.bio || '',
    avatarHue: user.avatar_hue ?? 24,
    initials: initialsOf(user.name),
  };
}

function initialsOf(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Resolve a user record from a browser session cookie, a long-lived API
 * token, or a verified Firebase ID token (optional, only when configured).
 * A Firebase token never grants a role; roles come from event_roles only.
 *
 * The credential kind and its scopes are recorded on the request so that an
 * event-scoped token cannot be used against a different event.
 */
function resolveIdentity(req) {
  const bearer = (req.get('authorization') || '').match(/^bearer\s+(.+)$/i);
  const raw = req.rawSession
    || (bearer ? bearer[1].trim() : null)
    || req.get('x-hackerly-session');

  let user = null;
  if (raw) {
    lastCredential = null;
    user = sessionUser(raw);
    req.credential = lastCredential;
  }

  if (!user && bearer) {
    const viaFirebase = require('./firebase').verifyIdToken(bearer[1].trim());
    if (viaFirebase) {
      user = viaFirebase;
      req.credential = { kind: 'firebase', scopes: [] };
    }
  }

  return user;
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSession,
  sessionUser,
  destroySession,
  purgeExpiredSessions,
  findUserByEmail,
  findUserById,
  createUser,
  normaliseEmail,
  publicUser,
  initialsOf,
  resolveIdentity,
  sha256,
  findCredential,
  loadUser,
};
