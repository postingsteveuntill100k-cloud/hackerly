'use strict';

/**
 * Optional Firebase integration.
 *
 * Hackerly never requires Firebase. This module is only exercised when
 * FIREBASE_VERIFY_ID_TOKENS=true and a project id is configured; otherwise
 * verifyIdToken() is a no-op and the portal runs entirely on local SQLite.
 *
 * No service-account private key is ever read at runtime by the portal. The
 * client SDK on the hosted front end obtains tokens; the portal only verifies
 * them against Google's public signing keys.
 */

const config = require('../config');
const crypto = require('node:crypto');
const { db } = require('../db');
const auth = require('./auth');
const { id, now } = require('./ids');

const AUDIENCE = `https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit`;
const ISSUERS = new Set(['https://securetoken.google.com/', 'https://accounts.google.com']);

let certCache = { at: 0, keys: new Map() };

function enabled() {
  return Boolean(config.firebase.verifyIdTokens && config.firebase.projectId);
}

async function publicKeys() {
  const nowMs = Date.now();
  if (nowMs - certCache.at < 6 * 3600_000) return certCache.keys;
  const res = await fetch('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');
  if (!res.ok) throw new Error(`Could not fetch Firebase signing keys (${res.status})`);
  const certs = await res.json();
  const keys = new Map();
  for (const [kid, pem] of Object.entries(certs)) {
    keys.set(kid, crypto.createPublicKey(pem));
  }
  certCache = { at: nowMs, keys };
  return keys;
}

function decodeSegment(segment) {
  return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
}

function constantTimeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verify a Firebase Auth ID token and return the matching local user,
 * provisioning one on first sign-in. Returns null on any failure — callers
 * treat that exactly like "not signed in".
 */
async function verifyIdToken(idToken) {
  if (!enabled() || !idToken) return null;
  try {
    const parts = String(idToken).split('.');
    if (parts.length !== 3) return null;
    const [headerPart, payloadPart, signature] = parts;
    const header = decodeSegment(headerPart);
    if (header.alg !== 'RS256') return null;

    const keys = await publicKeys();
    const key = keys.get(header.kid);
    if (!key) return null;

    const data = Buffer.from(`${headerPart}.${payloadPart}`);
    const verified = crypto.verify('RSA-SHA256', data, key, Buffer.from(signature, 'base64url'));
    if (!verified) return null;

    const claims = decodeSegment(payloadPart);
    if (!ISSUERS.has(claims.iss)) return null;
    if (claims.aud !== config.firebase.projectId && claims.aud !== AUDIENCE) return null;
    if (!claims.sub || Number(claims.exp || 0) * 1000 < Date.now()) return null;
    if (claims.email_verified === false) return null;

    return provisionFromClaims(claims);
  } catch {
    return null;
  }
}

/** Find or create the local account for a verified Firebase identity. */
function provisionFromClaims(claims) {
  const email = auth.normaliseEmail(claims.email);
  if (!email) return null;
  const existing = auth.findUserByEmail(email);
  if (existing) return existing;

  const name = String(claims.name || claims.email || 'Hackerly user').slice(0, 80);
  const userId = id('usr');
  db().prepare(`
    INSERT INTO users (id, email, email_key, name, headline, organisation, avatar_hue,
                       password_hash, password_salt, auth_provider, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, '', '', 'firebase', ?)
  `).run(userId, email, email, name, '', '', Math.abs([...email].reduce((a, c) => (a * 33 + c.charCodeAt(0)) % 360, 11)) % 360, now());
  return auth.findUserById(userId);
}

/** Synchronous variant used by middleware; falls back to session auth only. */
function verifyIdTokenSync() {
  return null;
}

module.exports = { enabled, verifyIdToken, verifyIdTokenSync, provisionFromClaims };
