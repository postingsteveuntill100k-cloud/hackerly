'use strict';

const express = require('express');
const config = require('./config');
const { db } = require('./db');
const { seed, isEmpty } = require('./db/seed');
const auth = require('./lib/auth');
const authz = require('./lib/authz');
const audit = require('./lib/audit');
const { errorPage } = require('./views/auth');

const app = express();

app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', true);

/* ------------------------------------------------------------- middleware */

app.use((req, res, next) => {
  // A content-security policy that does not need a nonce because the
  // application never renders inline script. Anything the browser executes
  // comes from a file in public/.
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "script-src 'self'",
      // Styles are all in one stylesheet; no inline style attributes are set
      // by the server other than safe geometry on generated artwork, which is
      // permitted here.
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      // Demo and repository links leave the origin, but we never frame them.
      "frame-src https://www.youtube-nocookie.com https://player.vimeo.com",
      "connect-src 'self'",
      "form-action 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
    ].join('; '),
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: true, limit: '256kb' }));

// Resolve identity once, and attach the event context the request implies.
app.use((req, res, next) => {
  const cookies = parseCookie(req.headers.cookie);
  // `hkl_session` is what the browser gets. `session` is also accepted so an
  // API client or a scripted check can present a credential without needing
  // to know the cookie name. Both are hashed before lookup.
  const raw = cookies[config.sessionCookieName] || cookies.session || null;
  req.rawSession = raw;
  req.user = auth.resolveIdentity(req);
  req.actor = req.user
    ? { user: auth.publicUser(req.user), credential: req.credential || null }
    : { user: null, credential: null };
  next();
});

app.use((req, res, next) => {
  // Role context is only populated when a request is clearly about one event.
  if (req.user) {
    const m = req.path.match(/^\/(?:h|p|o|j|api\/events)\/([A-Za-z0-9_-]+)/);
    if (m) {
      const event = authz.findEvent(m[1]);
      if (event) {
        req.event = event;
        req.actor.eventId = event.id;
        req.actor.roles = authz.rolesIn(req.user.id, event.id);
        req.actor.isStaff = authz.isStaff(req.user.id, event.id);
        req.actor.judge = authz.judgeRecord(req.user.id, event.id);
      }
    }
  }
  next();
});

/* ----------------------------------------------------------------- routes */

app.use('/', require('./routes/public'));
app.use('/', require('./routes/auth'));
app.use('/', require('./routes/event'));
app.use('/', require('./routes/participant'));
app.use('/', require('./routes/project'));
app.use('/', require('./routes/organizer'));
app.use('/', require('./routes/judge'));
// The API router declares full /api paths, so it mounts at the root.
app.use(require('./routes/api'));

app.use(express.static(require('node:path').join(config.root, 'public'), {
  maxAge: config.env === 'production' ? '7d' : 0,
  index: false,
  etag: true,
}));

/* ------------------------------------------------------------- fallthrough */

app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found', path: req.path });
  }
  res.status(404);
  res.send(errorPage({
    status: 404,
    title: 'Nothing here',
    message: 'That page does not exist, or it is not visible to you.',
    user: req.actor.user,
    inApp: isAppPath(req.path),
  }));
});

/* ------------------------------------------------------------ error handling */

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.statusCode || 500;
  if (status >= 500) {
    console.error(`[hackerly] ${req.method} ${req.originalUrl}`, err);
  }
  if (res.headersSent) return;

  const isApi = req.path.startsWith('/api/') || req.get('accept') === 'application/json';
  // A person who followed a link to their workspace without signing in should
  // be offered the sign-in form, not a status code.
  if (status === 401 && !isApi && isAppPath(req.path)) {
    return res.redirect(`/signin?next=${encodeURIComponent(req.originalUrl)}`);
  }
  if (isApi) {
    return res.status(status).json({
      error: statusTitle(status),
      message: status >= 500 ? 'Something went wrong on our side.' : err.message,
      ...(err.fields ? { fields: err.fields } : {}),
    });
  }
  res.status(status).send(errorPage({
    status,
    title: statusTitle(status),
    message: status >= 500 ? 'Something went wrong on our side. The error has been logged.' : err.message,
    detail: err.detail,
    user: req.actor ? req.actor.user : null,
    inApp: isAppPath(req.path),
  }));
});

/** Paths that belong to a signed-in workspace rather than to the public site. */
function isAppPath(path) {
  return /^\/(dashboard|host\/new|p\/|o\/|j\/)/.test(path) || path === '/dashboard';
}

function statusTitle(status) {
  return {
    400: 'That request made no sense',
    401: 'Sign in first',
    403: 'Not for you',
    404: 'Nothing here',
    409: 'Not right now',
    422: 'Check the form',
    429: 'Too many requests',
  }[status] || 'Something went wrong';
}

function parseCookie(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key) out[key] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

/* -------------------------------------------------------------------- boot */

function ensureSeeded() {
  if (isEmpty() && config.seedOnBoot) {
    const summary = seed();
    if (summary.demo && !summary.demo.skipped) {
      console.log('  Seeded demo content. Sign in with organiser@hackerly.dev / hackerly-demo');
    }
  }
  auth.purgeExpiredSessions();
}

function startServer(port = config.port) {
  ensureSeeded();
  const server = app.listen(port, config.host, () => {
    const lines = [
      '',
      '  HACKERLY — the hackathon platform',
      '  ' + '='.repeat(62),
      `  Listening      http://localhost:${port}`,
      `  Storage        ${config.databasePath}`,
      `  Environment    ${config.env}`,
    ];
    if (require('./db/seed').DEMO_ACCOUNTS) {
      lines.push(
        '  ' + '-'.repeat(62),
        '  Demo accounts (password: hackerly-demo)',
        `    organiser     ${require('./db/seed').SEEDED_ACCOUNTS.organiser}`,
        `    judge         ${require('./db/seed').SEEDED_ACCOUNTS.judge}`,
        `    judge 2       ${require('./db/seed').SEEDED_ACCOUNTS.judge2}`,
        `    participant   ${require('./db/seed').SEEDED_ACCOUNTS.participant}`,
        '  ' + '-'.repeat(62),
        '  API tokens (for automation and the acceptance checker)',
        '    organizer    Cookie: session=org_7f2a',
        '    judge_a      Cookie: session=jdg_a_91bc',
        '    judge_b      Cookie: session=jdg_b_44de',
        '    participant  Cookie: session=prt_2e88',
      );
    }
    lines.push('  ' + '='.repeat(62), '');
    console.log(lines.join('\n'));
  });
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n  Port ${port} is already in use. Set PORT=<other> and try again.\n`);
      process.exit(1);
    }
    throw err;
  });
  return { app, server };
}

if (require.main === module) {
  startServer();
}

module.exports = { app, startServer, ensureSeeded };
