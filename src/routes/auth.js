'use strict';

const config = require('../config');
const auth = require('../lib/auth');
const authz = require('../lib/authz');
const audit = require('../lib/audit');
const lifecycle = require('../lib/lifecycle');
const v = require('../lib/validate');
const { authPage } = require('../views/auth');
const { safeUrl } = require('../lib/html');

const router = require('express').Router();

/** Turn a field-error map into a query string the auth form can read back. */
function fieldErrorsToQuery(errors) {
  return `?${Object.entries(errors).map(([k, v2]) => `${encodeURIComponent(k)}=${encodeURIComponent(v2)}`).join('&')}`;
}

router.get('/signin', (req, res) => {
  if (req.user) return res.redirect('/dashboard');
  res.send(authPage({ mode: 'signin', notice: noticeFrom(req), values: { email: req.query.email || '' }, demo: isSeededDemo() }));
});

router.get('/signup', (req, res) => {
  if (req.user) return res.redirect('/dashboard');
  res.send(authPage({ mode: 'signup', notice: noticeFrom(req), values: { email: req.query.email || '' } }));
});

router.post('/signin', (req, res, next) => {
  const errors = new v.FieldErrors();
  const email = v.email(req.body.email, { errors });
  const password = v.text(req.body.password, { field: 'password', label: 'Password', errors, required: true, trim: false });
  errors.throwIfAny();

  const user = auth.findUserByEmail(email);
  // One message for both "no such account" and "wrong password" so the form
  // cannot be used to enumerate which addresses have accounts.
  if (!user || !auth.verifyPassword(password, user.password_hash, user.password_salt)) {
    audit.record({ actor: req.actor, action: 'auth.signin', resourceType: 'session', outcome: 'denied', detail: email });
    return res.status(401).send(authPage({
      mode: 'signin',
      errors: { password: 'That email and password do not match an account.' },
      values: { email },
      demo: isSeededDemo(),
    }));
  }

  const { token, expiresAt } = auth.createSession(user.id, req.get('user-agent'));
  audit.record({ actor: { user }, action: 'auth.signin', resourceType: 'session', outcome: 'ok' });
  res.setHeader('Set-Cookie', sessionCookie(token, expiresAt));
  res.redirect(nextPath(req.body.next, '/dashboard'));
});

router.post('/signup', (req, res, next) => {
  const errors = new v.FieldErrors();
  const name = v.text(req.body.name, { field: 'name', label: 'Your name', errors, required: true, min: 2, max: 80 });
  const email = v.email(req.body.email, { errors });
  const password = v.password(req.body.password, { errors, min: 10 });
  const headline = v.text(req.body.headline, { field: 'headline', label: 'What you build', errors, max: 90 });
  const organisation = v.text(req.body.organisation, { field: 'organisation', label: 'Organisation', errors, max: 90 });
  errors.throwIfAny();

  let user;
  try {
    user = auth.createUser({ email, name, password, headline, organisation });
  } catch (err) {
    return res.status(409).send(authPage({
      mode: 'signup',
      errors: { email: err.message },
      values: { name, email, headline, organisation },
    }));
  }

  const { token, expiresAt } = auth.createSession(user.id, req.get('user-agent'));
  audit.record({ actor: { user }, action: 'auth.signup', resourceType: 'user', resourceId: user.id });
  res.setHeader('Set-Cookie', sessionCookie(token, expiresAt));
  res.redirect(nextPath(req.body.next, '/dashboard'));
});

router.post('/signout', (req, res) => {
  auth.destroySession(req.rawSession);
  res.setHeader('Set-Cookie', clearedCookie());
  res.redirect('/');
});

/* ------------------------------------------------- judge access codes --- */

/**
 * A judge invited by an organiser verifies themselves here. The code is
 * compared against a per-judge hash; there is no way to enumerate judges or
 * codes from this endpoint, and it grants nothing until the code matches.
 */
router.get('/judge/verify/:eventSlug', (req, res, next) => {
  try {
    const event = authz.findEvent(req.params.eventSlug);
    if (!event) throw new authz.HttpError(404, 'That hackathon does not exist.');
    res.send(judgeVerifyPage({ event, error: noticeFrom(req) }));
  } catch (err) { next(err); }
});

router.post('/judge/verify/:eventSlug', (req, res, next) => {
  try {
    const event = authz.findEvent(req.params.eventSlug);
    if (!event) throw new authz.HttpError(404, 'That hackathon does not exist.');

    const code = String(req.body.code || '').trim();
    if (!code) {
      return res.send(judgeVerifyPage({ event, error: 'Enter the access code your organiser sent you.' }));
    }

    const judge = require('../db').db().prepare(`
      SELECT * FROM judges WHERE event_id = ? AND state != 'removed'
    `).all(event.id).find((j) => auth.verifyPassword(code, j.access_code_hash, j.access_code_salt));

    if (!judge) {
      audit.record({ actor: req.actor, action: 'judge.verify', resourceType: 'judge', resourceId: event.id, outcome: 'denied' });
      return res.status(401).send(judgeVerifyPage({ event, error: 'That code is not valid for this hackathon.' }));
    }

    // The judge is verified, but only gets a session if they already have an
    // account on this installation. Otherwise we tell them to sign in, and the
    // access is attached to their account by email match.
    const now = require('../lib/ids').now();
    require('../db').db().prepare(`
      UPDATE judges SET state = 'verified', verified_at = ?, last_active_at = ? WHERE id = ?
    `).run(now, now, judge.id);

    const user = auth.findUserByEmail(judge.email_key);
    if (user) {
      require('../db').db().prepare('UPDATE judges SET user_id = ? WHERE id = ?').run(user.id, judge.id);
      if (judge.user_id !== user.id) {
        require('../db').db().prepare(`
          INSERT OR IGNORE INTO event_roles (id, event_id, user_id, role, created_at) VALUES (?,?,?,'judge',?)
        `).run(require('../lib/ids').id('rol'), event.id, user.id, now);
      }
      const { token, expiresAt } = auth.createSession(user.id, req.get('user-agent'));
      audit.record({ actor: { user }, action: 'judge.verify', resourceType: 'judge', resourceId: judge.id, outcome: 'ok' });
      res.setHeader('Set-Cookie', sessionCookie(token, expiresAt));
      return res.redirect(`/j/${event.slug}`);
    }

    res.send(judgeVerifyPage({
      event,
      success: `Access confirmed for ${judge.name}. Sign in or create an account with ${judge.email_key} to reach your assignments.`,
    }));
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------------- helpers */

function sessionCookie(token, expiresAt) {
  const parts = [
    `${config.sessionCookieName}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ];
  if (config.secureCookies) parts.push('Secure');
  return parts.join('; ');
}

function clearedCookie() {
  const parts = [`${config.sessionCookieName}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (config.secureCookies) parts.push('Secure');
  return parts.join('; ');
}

/** Only same-origin relative paths are honoured, so `next` cannot be an open redirect. */
function nextPath(candidate, fallback) {
  const raw = String(candidate || '');
  if (!raw.startsWith('/') || raw.startsWith('//')) return fallback;
  try {
    const url = new URL(raw, 'http://placeholder');
    if (url.host !== 'placeholder') return fallback;
    return `${url.pathname}${url.search}`;
  } catch {
    return fallback;
  }
}

function noticeFrom(req) {
  const value = req.query.notice || req.query.error;
  if (!value) return null;
  const text = String(value).replace(/[<>]/g, '');
  return text.slice(0, 200);
}

function isSeededDemo() {
  try {
    const row = require('../db').db()
      .prepare("SELECT COUNT(*) AS n FROM users WHERE email_key = 'organiser@hackerly.dev'")
      .get();
    return row.n > 0;
  } catch {
    return false;
  }
}

function judgeVerifyPage({ event, error, success }) {
  const c = require('../views/components');
  const { esc } = require('../lib/html');
  const body = `<div class="wrap wrap--narrow bay bay--lg">
    <div class="eyebrow">Judge access</div>
    <h1 class="display" style="font-size:var(--step-4)">${esc(event.name)}</h1>
    <p class="lede mt-2">Judges are admitted by the organising team. Enter the access code they sent you. This grants read access to the projects you are assigned — nothing else, and nothing to other judges.</p>
    ${success ? c.note('good', esc(success)) : ''}
    ${error ? c.note('stop', esc(error)) : ''}
    <form method="post" action="/judge/verify/${esc(event.slug)}" class="panel mt-3">
      <label class="field">
        <span class="field__label">Access code<span class="field__req">*</span></span>
        <input type="text" name="code" required autofocus autocomplete="off" class="mono" placeholder="ABC-1234-XXXX" style="text-transform:uppercase">
      </label>
      <button class="btn btn--accent" type="submit">Verify access</button>
    </form>
    <p class="small muted mt-3">Already have an account? <a class="link-quiet" href="/signin?next=/judge/verify/${esc(event.slug)}">Sign in</a></p>
  </div>`;
  return c.siteLayout({ title: 'Judge access', description: `Judge access for ${event.name}.`, body });
}

module.exports = router;
module.exports.sessionCookie = sessionCookie;
module.exports.clearedCookie = clearedCookie;
module.exports.nextPath = nextPath;
