#!/usr/bin/env node
'use strict';

/**
 * Static export.
 *
 * Hackerly renders pages on the server, so a static host needs a snapshot of
 * them. This walks the public surface of a running instance, fetches every
 * anonymous page, and writes them to `dist/` with a directory index so that a
 * plain file host serves the same URLs.
 *
 * Only anonymous GETs are fetched. Nothing user-specific is exported, and no
 * cookie is sent — a page that needs an account is not part of the public site
 * and is skipped rather than exported as an error.
 *
 *   node scripts/export-static.js [--base http://localhost:10000] [--out dist]
 */

const fs = require('node:fs');
const path = require('node:path');

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const BASE = argOf('--base', process.env.PUBLIC_ORIGIN || 'http://localhost:10000').replace(/\/+$/, '');
const OUT = path.resolve(argOf('--out', 'dist'));

/* The public surface. Anything that renders for a signed-in person is
   deliberately absent. */
const STATIC_PAGES = [
  { url: '/', file: 'index.html' },
  { url: '/hackathons', file: 'hackathons/index.html' },
  { url: '/projects', file: 'projects/index.html' },
  { url: '/host', file: 'host/index.html' },
  { url: '/about', file: 'about/index.html' },
];

/* Assets are copied verbatim. */
const ASSET_DIRS = ['css', 'js', 'fonts'];
const ASSET_FILES = ['mark.svg', 'robots.txt'];

function listEventPages() {
  // The catalogue comes from the API rather than a hand-written list, so a new
  // event appears on the static site without anybody editing this file.
  return fetch(`${BASE}/api/events?limit=100`)
    .then((r) => r.json())
    .then((body) => (body.events || []).flatMap((e) => [
      { url: `/h/${e.slug}`, file: `h/${e.slug}/index.html` },
      { url: `/h/${e.slug}/projects`, file: `h/${e.slug}/projects/index.html` },
      // The results tab is public either way: published rankings, or the
      // honest "not published yet" page. Both are worth serving.
      { url: `/h/${e.slug}/results`, file: `h/${e.slug}/results/index.html` },
    ]))
    .catch(() => {
      console.warn('  ! could not read the event catalogue; exporting the fixed pages only');
      return [];
    });
}

function listProjectPages() {
  return fetch(`${BASE}/api/projects?limit=200`)
    .then((r) => r.json())
    .then((body) => (body.projects || []).map((p) => ({
      url: `/projects/${p.eventSlug}/${p.slug}`,
      file: `projects/${p.eventSlug}/${p.slug}/index.html`,
    })))
    .catch(() => {
      console.warn('  ! could not read the showcase; skipping project pages');
      return [];
    });
}

async function copyAssets() {
  for (const dir of ASSET_DIRS) {
    const from = path.join(__dirname, '..', 'public', dir);
    if (!fs.existsSync(from)) continue;
    fs.cpSync(from, path.join(OUT, dir), { recursive: true });
  }
  for (const file of ASSET_FILES) {
    const from = path.join(__dirname, '..', 'public', file);
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(OUT, file));
  }
}

function rewrite(html, fromUrl) {
  // Absolute links to the export origin become relative, so the snapshot works
  // from any path and on any host.
  return html
    .split(`href="${BASE}`).join('href="')
    .split(`content="${BASE}`).join('content="');
}

async function main() {
  console.log(`\n  Exporting the public surface of ${BASE}\n`);

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const pages = [
    ...STATIC_PAGES,
    ...(await listEventPages()),
    ...(await listProjectPages()),
  ];

  let written = 0;
  let skipped = 0;
  for (const page of pages) {
    try {
      const res = await fetch(BASE + page.url, { redirect: 'manual' });
      if (!res.ok) {
        console.warn(`  ! ${page.url} returned ${res.status}, skipped`);
        skipped += 1;
        continue;
      }
      const html = await res.text();
      const target = path.join(OUT, page.file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, rewrite(html, BASE));
      written += 1;
    } catch (err) {
      skipped += 1;
    }
  }

  await copyAssets();

  // A file for hosts that want a 404 page.
  fs.writeFileSync(path.join(OUT, '404.html'),
    '<!doctype html><meta charset="utf-8"><title>Not found</title>'
    + '<link rel="stylesheet" href="/css/hackerly.css">'
    + '<div class="wrap wrap--narrow bay bay--lg center"><h1>Nothing here</h1>'
    + '<p class="lede" style="margin-inline:auto">That page does not exist on this static mirror.</p>'
    + '<a class="btn" href="/">Back to Hackerly</a></div>');

  console.log(`  ${written} page(s) written, ${skipped} skipped`);
  console.log(`  output: ${OUT}\n`);
  if (written === 0) {
    console.error('  Nothing was exported. Is the portal running?\n');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
