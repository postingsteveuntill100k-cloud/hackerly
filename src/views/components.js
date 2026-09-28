'use strict';

const { esc, safeUrl, hostOf } = require('../lib/html');
const { initialsOf } = require('../lib/auth');
const lc = require('../lib/lifecycle');

/* ------------------------------------------------------------------- brand */

const MARK = `<svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
  <path d="M4 4v24M28 4v24M4 16h24" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>
  <circle cx="4" cy="4" r="3.1" fill="currentColor"/>
  <circle cx="28" cy="4" r="3.1" fill="currentColor"/>
  <circle cx="4" cy="28" r="3.1" fill="currentColor"/>
  <circle cx="28" cy="28" r="3.1" fill="currentColor"/>
  <rect x="12.2" y="12.2" width="7.6" height="7.6" rx="1.4" fill="var(--accent, #c8411c)"/>
</svg>`;

function brand(href = '/', context = '') {
  return `<a class="brand" href="${esc(href)}" aria-label="Hackerly home">
    <span class="brand__mark">${MARK}</span>
    <span>HACKERLY</span>
    ${context ? `<em>${esc(context)}</em>` : ''}
  </a>`;
}

/* ---------------------------------------------------------------- artwork */

const HUES = [
  [12, 30], [30, 48], [48, 66], [72, 96], [96, 132],
  [140, 168], [170, 194], [196, 214], [216, 236], [238, 258], [262, 284], [288, 312], [318, 342],
];

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry(seed) {
  let t = seed;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Deterministic cover artwork. Every hackathon and every project gets a
 * distinct composition from its own name, so a listing of forty projects
 * reads as forty things rather than forty identical placeholders.
 */
function art(seed, { tall = false, band = 0 } = {}) {
  const key = String(seed || 'hackerly');
  const rand = mulberry(hashSeed(key));
  const [h1, h2] = HUES[Math.floor(rand() * HUES.length)];
  const style = Math.floor(rand() * 4);
  const w = 400;
  const h = tall ? 300 : 200;
  const gid = `g${(hashSeed(key) % 100000).toString(36)}`;

  let body = '';
  if (style === 0) {
    // contour lines
    const lines = [];
    for (let i = 0; i < 16; i += 1) {
      const y = 12 + i * 12;
      const amp = 8 + rand() * 20;
      const phase = rand() * Math.PI * 2;
      let d = `M-10 ${y.toFixed(1)}`;
      for (let x = 0; x <= w + 20; x += 26) {
        d += ` Q ${(x + 13).toFixed(1)} ${(y + Math.sin(phase + x / 34) * amp).toFixed(1)} ${(x + 26).toFixed(1)} ${y.toFixed(1)}`;
      }
      lines.push(`<path d="${d}" fill="none" stroke="hsl(${h1} 30% 30%)" stroke-width="1" opacity="${(0.16 + (i / 16) * 0.5).toFixed(2)}"/>`);
    }
    body = lines.join('');
  } else if (style === 1) {
    // stacked blocks
    let x = 14;
    while (x < w - 20) {
      const bw = 14 + rand() * 46;
      const bh = 26 + rand() * (h - 70);
      const op = 0.12 + rand() * 0.5;
      body += `<rect x="${x.toFixed(1)}" y="${(h - 24 - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="hsl(${h1 + (rand() * 40 - 20)} 42% 32%)" opacity="${op.toFixed(2)}"/>`;
      x += bw + 5 + rand() * 12;
    }
  } else if (style === 2) {
    // dot matrix
    const cols = 20;
    const rows = 10;
    for (let cx = 0; cx < cols; cx += 1) {
      for (let cy = 0; cy < rows; cy += 1) {
        const px = 18 + cx * ((w - 36) / (cols - 1));
        const py = 18 + cy * ((h - 40) / (rows - 1));
        const wobble = Math.sin((cx * 0.6 + cy * 0.35) + rand() * 0.3);
        const r = 1.4 + Math.abs(wobble) * 4.4;
        body += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${r.toFixed(1)}" fill="hsl(${h1} 46% 26%)" opacity="${(0.22 + Math.abs(wobble) * 0.62).toFixed(2)}"/>`;
      }
    }
  } else {
    // arcs
    for (let i = 0; i < 9; i += 1) {
      const r = 40 + i * 26 + rand() * 16;
      const cx = 30 + rand() * (w - 60);
      const cy = h - 10 - rand() * 40;
      body += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="none" stroke="hsl(${h1 + i * 4} 38% 30%)" stroke-width="${(0.8 + rand() * 1.6).toFixed(1)}" opacity="${(0.5 - i * 0.045).toFixed(2)}"/>`;
    }
  }

  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice" role="img" aria-label="">
    <defs>
      <linearGradient id="${gid}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="hsl(${h1} 52% 92%)"/>
        <stop offset="52%" stop-color="hsl(${(h1 + h2) / 2} 44% 86%)"/>
        <stop offset="100%" stop-color="hsl(${h2} 40% 80%)"/>
      </linearGradient>
    </defs>
    <rect width="${w}" height="${h}" fill="url(#${gid})"/>
    <g>${body}</g>
    ${band ? `<rect x="0" y="${h - 26}" width="${w}" height="26" fill="hsl(${h1} 30% 22%)" opacity="0.86"/>` : ''}
  </svg>`;
}

function artBox(seed, { tall = false, band = false, className = '' } = {}) {
  return `<div class="art ${tall ? 'art--tall' : ''} ${className}">${art(seed, { tall, band })}</div>`;
}

/* ----------------------------------------------------------------- people */

function avatar(user, size = '') {
  const name = typeof user === 'string' ? user : (user && (user.name || user.title)) || '?';
  const hue = (typeof user === 'object' && user && (user.hue ?? user.avatarHue)) || 24;
  return `<span class="avatar ${size ? `avatar--${size}` : ''}" style="background:hsl(${Number(hue) || 24} 32% 32%)" title="${esc(name)}" aria-hidden="true">${esc(initialsOf(name))}</span>`;
}

function avatarStack(people, max = 4) {
  const list = (people || []).slice(0, max);
  if (!list.length) return '';
  return `<span class="avatar-stack">${list.map((p) => avatar(p, 'sm')).join('')}</span>`;
}

function personRow(user, { role = '', bio = '' } = {}) {
  return `<div class="person">
    ${avatar(user, 'lg')}
    <div class="person__body">
      <div class="person__name">${esc(user.name)}</div>
      ${role || user.headline || user.organisation ? `<div class="person__role">${esc([role, user.headline, user.organisation].filter(Boolean).join(' · '))}</div>` : ''}
      ${bio ? `<div class="person__bio">${esc(bio)}</div>` : ''}
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ pieces */

function trackChip(name, colour = 'ink') {
  if (!name) return '';
  return `<span class="track-chip" style="--tc:var(--track-${esc(colour)}, var(--ink-3))">${esc(name)}</span>`;
}

function techTags(list = []) {
  if (!list.length) return '';
  return `<div class="tags">${list.slice(0, 8).map((t) => `<span class="tag">${esc(t)}</span>`).join('')}</div>`;
}

function statusBadge(phase) {
  const map = {
    draft: ['badge', 'Not published'],
    announced: ['badge', 'Announced'],
    upcoming: ['badge--info badge--dot', 'Registration soon'],
    registration: ['badge--good badge--dot badge--pulse', 'Registration open'],
    building: ['badge--accent badge--dot badge--pulse', 'Live now'],
    judging: ['badge--warn badge--dot', 'Judging'],
    results: ['badge--good', 'Results published'],
    ended: ['badge', 'Ended'],
    archived: ['badge', 'Ended'],
  };
  const [cls, label] = map[phase] || ['badge', 'Hackathon'];
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}

function formatBadge(format) {
  const map = { online: 'Online', in_person: 'In person', hybrid: 'Hybrid' };
  return `<span class="badge">${esc(map[format] || format || 'Online')}</span>`;
}

function countdownBlock(event) {
  const phase = lc.phase(event);
  const target = phase === 'building' ? event.submissions_close_at
    : phase === 'registration' ? event.registration_closes_at
      : phase === 'judging' ? event.judging_closes_at
        : phase === 'upcoming' ? event.starts_at
          : null;
  const c = target ? lc.countdown(target) : null;
  if (!c || c.passed) return '';
  const label = phase === 'building' ? 'Submissions close'
    : phase === 'registration' ? 'Registration closes'
      : phase === 'judging' ? 'Judging closes' : 'Starts in';
  return `<div class="stack stack--sm">
    <div class="eyebrow eyebrow--plain">${esc(label)}</div>
    <div class="countdown" data-target="${Date.parse(target)}">
      ${c.days ? `<div><b>${c.days}</b><span>days</span></div>` : ''}
      <div><b>${String(c.hours).padStart(2, '0')}</b><span>hrs</span></div>
      <div><b>${String(c.minutes).padStart(2, '0')}</b><span>min</span></div>
    </div>
    <p class="small muted mb-0">${esc(lc.fmt(target, event.timezone))} ${esc(event.timezone)}</p>
  </div>`;
}

function formatLocation(event) {
  if (event.format === 'online') return 'Online';
  return [event.venue, event.city, event.country].filter(Boolean).join(', ') || 'In person';
}

function externalLink(url, label) {
  const safe = safeUrl(url);
  if (!safe) return '';
  return `<a class="link-card" href="${esc(safe)}" target="_blank" rel="noopener noreferrer nofollow">
    <span class="link-card__i">↗</span>
    <span class="flex-1">
      <span class="link-card__t">${esc(label)}</span>
      <span class="link-card__s">${esc(hostOf(url))}</span>
    </span>
  </a>`;
}

function note(kind, html, { title = '' } = {}) {
  const icon = { accent: '!', good: '✓', warn: '!', stop: '×', info: 'i' }[kind] || '·';
  return `<div class="note note--${kind}">
    <span class="note__icon" aria-hidden="true">${icon}</span>
    <span>${title ? `<strong>${esc(title)}</strong> ` : ''}${html}</span>
  </div>`;
}

function empty(title, body, action = '') {
  return `<div class="empty">
    <h3>${esc(title)}</h3>
    <p>${esc(body)}</p>
    ${action ? `<div class="mt-2">${action}</div>` : ''}
  </div>`;
}

function meter(value, total, { accent = false, label = '', right = '' } = {}) {
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return `<div class="meter">
    <div class="meter__track"><div class="meter__fill ${accent ? 'meter__fill--accent' : value === total && total > 0 ? 'meter__fill--good' : ''}" style="width:${pct}%"></div></div>
    ${(label || right) ? `<div class="meter__legend"><span>${esc(label)}</span><span>${esc(right)}</span></div>` : ''}
  </div>`;
}

function sectionHead({ eyebrow = '', title, body = '', id = '' }) {
  return `<div class="section__head"${id ? ` id="${esc(id)}"` : ''}>
    ${eyebrow ? `<div class="eyebrow">${esc(eyebrow)}</div>` : ''}
    <h2>${esc(title)}</h2>
    ${body ? `<p>${esc(body)}</p>` : ''}
  </div>`;
}

function pagination(page, pages, makeHref) {
  if (pages <= 1) return '';
  const items = [];
  const push = (p, label = p, current = false, gap = false) => {
    items.push(gap
      ? '<span class="is-gap">…</span>'
      : (current
        ? `<span aria-current="page">${label}</span>`
        : `<a href="${esc(makeHref(p))}">${label}</a>`));
  };
  for (let p = 1; p <= pages; p += 1) {
    if (p === 1 || p === pages || Math.abs(p - page) <= 1) push(p, p, p === page);
    else if (items[items.length - 1] !== '<span class="is-gap">…</span>') push(null, '', false, true);
  }
  return `<nav class="pagination" aria-label="Pagination">${items.join('')}</nav>`;
}

/* ------------------------------------------------------------ site layout */

function siteHeader({ user = null, current = '' } = {}) {
  const links = [
    ['/hackathons', 'Hackathons'],
    ['/projects', 'Showcase'],
    ['/host', 'Host'],
    ['/about', 'About'],
  ];
  return `<header class="site-head">
    <div class="wrap site-head__in">
      ${brand()}
      <nav class="site-nav" aria-label="Main">
        ${links.map(([href, label]) => `<a href="${href}"${current === href ? ' aria-current="page"' : ''}>${label}</a>`).join('')}
      </nav>
      <div class="site-head__end">
        ${user
    ? `<details class="usermenu usermenu--site">
        <summary class="user-pill" aria-label="Account menu">${avatar(user, 'sm')} ${esc(user.name.split(' ')[0])}</summary>
        <div class="usermenu__panel">
          <div class="usermenu__id"><b>${esc(user.name)}</b><span>${esc(user.email)}</span></div>
          <a href="/dashboard">Your hackathons</a>
          <a href="/host/new">Host a hackathon</a>
          <a href="/about">About Hackerly</a>
          <form method="post" action="/signout"><button class="usermenu__out" type="submit">Sign out</button></form>
        </div>
      </details>`
    : `<a class="btn btn--ghost btn--sm" href="/signin">Sign in</a><a class="btn btn--sm" href="/signup">Create account</a>`}
      </div>
    </div>
  </header>`;
}

function siteFooter() {
  const col = (title, links) => `<div><h4>${title}</h4><ul>${links.map(([h, l]) => `<li><a href="${h}">${l}</a></li>`).join('')}</ul></div>`;
  return `<footer class="site-foot">
    <div class="wrap">
      <div class="site-foot__grid">
        <div>
          ${brand()}
          <p class="small mt-2" style="max-width:30ch">One place to discover, host, build, judge and showcase hackathons. Open source and self-hostable.</p>
        </div>
        ${col('Participate', [['/hackathons', 'Browse hackathons'], ['/projects', 'Project showcase'], ['/signup', 'Create an account'], ['/about#how', 'How it works']])}
        ${col('Host', [['/host', 'Host a hackathon'], ['/host#judging', 'Judging engine'], ['/host#selfhost', 'Self-hosting'], ['/about', 'About Hackerly']])}
        ${col('Judging', [['/about#judging', 'How judging works'], ['/about#integrity', 'Integrity & fairness'], ['/about#privacy', 'Privacy']])}
      </div>
      <div class="site-foot__base">
        <span>© ${new Date().getFullYear()} Hackerly. Open source, MIT licensed.</span>
        <span>Self-hosted capable · No account required to browse</span>
      </div>
    </div>
  </footer>`;
}

function siteLayout({ title, description = '', current = '', user, body, canonical = '', bodyClass = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Hackerly</title>
<meta name="description" content="${esc(description)}">
${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ''}
<meta property="og:title" content="${esc(title)} · Hackerly">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
<link rel="icon" href="/mark.svg" type="image/svg+xml">
<link rel="preload" href="/fonts/inter.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/fraunces.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/css/hackerly.css">
</head>
<body${bodyClass ? ` class="${esc(bodyClass)}"` : ''}>
<a class="skip-link" href="#main">Skip to content</a>
${siteHeader({ user, current })}
<main id="main">${body}</main>
${siteFooter()}
<div class="toast-host" id="toasts" aria-live="polite"></div>
<script src="/js/app.js" defer></script>
</body>
</html>`;
}

/* -------------------------------------------------------------- app layout */

function appHeader({ user, event = null, nav = [], current = '' }) {
  return `<header class="app-head">
    <div class="wrap app-head__in">
      ${brand('/dashboard')}
      ${event ? `<div class="app-head__ctx">
        <b>${esc(event.name)}</b>
        <span>${esc(event.venue ? [event.city, event.country].filter(Boolean).join(', ') : 'Online')}</span>
      </div>` : '<div class="app-head__ctx"><b>Your workspace</b><span>Hackerly</span></div>'}
      <nav class="app-head__nav" aria-label="Workspace">
        ${nav.map(([href, label, opts = {}]) => `<a href="${esc(href)}"${current === href ? ' aria-current="page"' : ''}>${opts.short ? `<span class="opt">${esc(label)}</span>${esc(opts.short)}` : esc(label)}</a>`).join('')}
        <details class="usermenu">
          <summary class="user-pill" aria-label="Account menu">
            ${avatar(user, 'sm')} ${esc((user && user.name ? user.name.split(' ')[0] : 'Account'))}
          </summary>
          <div class="usermenu__panel">
            <div class="usermenu__id">
              <b>${esc(user && user.name)}</b>
              ${user && user.email ? `<span>${esc(user.email)}</span>` : ''}
            </div>
            <a href="/dashboard">Your hackathons</a>
            <a href="/host/new">Host a hackathon</a>
            <a href="/about">About Hackerly</a>
            <form method="post" action="/signout">
              <button class="usermenu__out" type="submit">Sign out</button>
            </form>
          </div>
        </details>
      </nav>
    </div>
  </header>`;
}

function appLayout({ title, user, event, nav = [], current = '', body, description = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · Hackerly</title>
<meta name="robots" content="noindex">
${description ? `<meta name="description" content="${esc(description)}">` : ''}
<link rel="icon" href="/mark.svg" type="image/svg+xml">
<link rel="preload" href="/fonts/inter.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/fraunces.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/css/hackerly.css">
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
${appHeader({ user, event, nav, current })}
<main id="main" class="app-body"><div class="wrap">${body}</div></main>
<div class="toast-host" id="toasts" aria-live="polite"></div>
<script src="/js/app.js" defer></script>
</body>
</html>`;
}

function consoleShell({ title, subtitle = '', user, event, nav = [], current = '', body, actions = '' }) {
  const mobile = `<div class="console__mobile">${nav.map(([href, label]) => `<a href="${esc(href)}"${current === href ? ' aria-current="page"' : ''}>${esc(label)}</a>`).join('')}</div>`;
  return appLayout({
    title,
    user,
    event,
    nav: event ? [[`/h/${event.slug}`, 'Event page'], ...nav] : nav,
    current,
    description: subtitle,
    body: `<div class="console">
      ${mobile}
      <nav class="console__nav" aria-label="Console sections">${nav.map(([href, label, opts = {}]) => `<a href="${esc(href)}"${current === href ? ' aria-current="page"' : ''}>${esc(label)}${opts.count !== undefined ? `<span class="count">${esc(opts.count)}</span>` : ''}</a>`).join('')}</nav>
      <div class="console__main">
        <div class="console__head">
          <div class="cluster cluster--between cluster--top">
            <div><h1>${esc(title)}</h1>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>
            ${actions ? `<div class="btn-row btn-row--tight">${actions}</div>` : ''}
          </div>
        </div>
        ${body}
      </div>
    </div>`,
  });
}

module.exports = {
  MARK,
  brand,
  art,
  artBox,
  avatar,
  avatarStack,
  personRow,
  trackChip,
  techTags,
  statusBadge,
  formatBadge,
  countdownBlock,
  formatLocation,
  externalLink,
  note,
  empty,
  meter,
  sectionHead,
  pagination,
  siteLayout,
  siteHeader,
  siteFooter,
  appLayout,
  appHeader,
  consoleShell,
};
