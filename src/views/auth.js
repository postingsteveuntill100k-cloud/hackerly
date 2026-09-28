'use strict';

const { esc } = require('../lib/html');
const c = require('./components');

const DEMO_ACCOUNTS = [
  ['organiser@hackerly.dev', 'Organiser — runs a hackathon end to end'],
  ['judge@hackerly.dev', 'Judge — reviews assigned projects'],
  ['participant@hackerly.dev', 'Participant — registers, teams up, submits'],
];

function authPage({ mode, values = {}, errors = {}, notice = null, demo = true }) {
  const isSignup = mode === 'signup';
  const err = (f) => (errors[f] ? `<p class="field__err">${esc(errors[f])}</p>` : '');

  const form = `
<form method="post" action="${isSignup ? '/signup' : '/signin'}" novalidate>
  ${notice ? c.note('accent', esc(notice)) : ''}
  ${Object.keys(errors).length ? c.note('stop', 'Please correct the highlighted fields.') : ''}

  ${isSignup ? `<label class="field">
    <span class="field__label">Your name<span class="field__req">*</span></span>
    <input type="text" name="name" value="${esc(values.name || '')}" autocomplete="name" required maxlength="80" aria-invalid="${errors.name ? 'true' : 'false'}">
    ${err('name')}
  </label>` : ''}

  <label class="field">
    <span class="field__label">Email<span class="field__req">*</span></span>
    <input type="email" name="email" value="${esc(values.email || '')}" autocomplete="email" required maxlength="254" aria-invalid="${errors.email ? 'true' : 'false'}">
    ${err('email')}
  </label>

  <label class="field">
    <span class="field__label">Password<span class="field__req">*</span></span>
    <input type="password" name="password" autocomplete="${isSignup ? 'new-password' : 'current-password'}" required minlength="10" aria-invalid="${errors.password ? 'true' : 'false'}">
    ${isSignup ? '<p class="field__help">At least 10 characters.</p>' : ''}
    ${err('password')}
  </label>

  ${isSignup ? `<label class="field">
    <span class="field__label">What do you build?</span>
    <input type="text" name="headline" value="${esc(values.headline || '')}" maxlength="90" placeholder="Backend engineer, student, designer…">
    <p class="field__help">Shown beside your name on event pages. Optional.</p>
  </label>
  <label class="field">
    <span class="field__label">Organisation</span>
    <input type="text" name="organisation" value="${esc(values.organisation || '')}" maxlength="90" placeholder="University, company, or leave blank">
  </label>` : ''}

  <button class="btn btn--accent btn--block btn--lg mt-2" type="submit">${isSignup ? 'Create account' : 'Sign in'}</button>
</form>

${demo && !isSignup ? `
<div class="auth-divider">demo accounts</div>
<div class="panel panel--sunk stack stack--sm">
  <p class="small muted mb-0">This installation is seeded with three roles so you can look around. Password for all three is <code class="mono">hackerly-demo</code>.</p>
  ${DEMO_ACCOUNTS.map(([email, role]) => `<form method="post" action="/signin" class="cluster cluster--between" style="gap:.4rem">
    <input type="hidden" name="email" value="${esc(email)}">
    <input type="hidden" name="password" value="hackerly-demo">
    <span class="small"><b>${esc(email.split('@')[0])}</b> <span class="muted">— ${esc(role.split('—')[1] || role).trim()}</span></span>
    <button class="btn btn--ghost btn--sm" type="submit">Sign in</button>
  </form>`).join('')}
</div>` : ''}`;

  const body = `<div class="auth-page">
  <aside class="auth-page__aside">
    <div>${c.brand('/', '')}</div>
    <div>
      <h2>${isSignup ? 'One account for the whole event.' : 'Welcome back.'}</h2>
      <p class="mt-2">${isSignup
    ? 'Create an account to register for hackathons, join a team, submit a project, host an event, or judge one.'
    : 'Sign in to reach your registrations, teams, submissions, events and judging queue.'}</p>
    </div>
    <div>
      <p class="small" style="color:color-mix(in srgb, var(--paper) 55%, transparent)">Browsing hackathons and the public showcase never requires an account.</p>
    </div>
  </aside>
  <div class="auth-page__form">
    <div class="auth-card">
      <h1>${isSignup ? 'Create your account' : 'Sign in'}</h1>
      <p class="muted mb-3">${isSignup ? 'Free, and it takes about twenty seconds.' : 'Use the email you registered with.'}</p>
      ${form}
      <p class="small mt-3 mb-0">
        ${isSignup
    ? 'Already have an account? <a class="link-quiet" href="/signin">Sign in</a>'
    : 'No account yet? <a class="link-quiet" href="/signup">Create one</a>'}
      </p>
    </div>
  </div>
</div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${isSignup ? 'Create an account' : 'Sign in'} · Hackerly</title>
<meta name="robots" content="noindex">
<link rel="icon" href="/mark.svg" type="image/svg+xml">
<link rel="preload" href="/fonts/inter.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/fraunces.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/css/hackerly.css">
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<main id="main">${body}</main>
<div class="toast-host" id="toasts" aria-live="polite"></div>
<script src="/js/app.js" defer></script>
</body>
</html>`;
}

function errorPage({ status, title, message, detail, user, actions = '', inApp = false }) {
  const body = `<div class="wrap wrap--narrow bay bay--lg center">
    <div class="eyebrow eyebrow--plain" style="justify-content:center">${status}</div>
    <h1 class="display" style="font-size:var(--step-4)">${esc(title)}</h1>
    <p class="lede" style="margin-inline:auto">${esc(message)}</p>
    ${detail ? `<div class="panel panel--sunk mt-3" style="text-align:left"><p class="small mono mb-0">${esc(detail)}</p></div>` : ''}
    <div class="btn-row mt-3" style="justify-content:center">
      ${actions || '<a class="btn" href="/">Back to Hackerly</a>'}
    </div>
  </div>`;
  // Inside the application a marketing footer is noise; the app chrome is
  // what helps somebody get back to where they were.
  return inApp
    ? c.appLayout({ title, description: message, user, body })
    : c.siteLayout({ title, description: message, user, body });
}

module.exports = { authPage, errorPage };
