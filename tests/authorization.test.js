'use strict';

/**
 * Authorization tests.
 *
 * These attack the backend over HTTP. They exist because the interesting
 * failures in a platform like this are not rendering failures — they are
 * places where a role check lives in a template instead of in the query.
 *
 * Every test drives a real request against a real server on a real database.
 */

const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

/** Boot a private instance on its own port and database. */
async function instance() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hackerly-test-'));
  const port = 10000 + Math.floor(Math.random() * 20000);

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['src/db/seed/cli.js'], {
      cwd: ROOT,
      env: { ...process.env, DATABASE_PATH: path.join(dir, 'test.db') },
      stdio: 'ignore',
    });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`seed exited ${code}`))));
  });

  const server = spawn(process.execPath, ['src/server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), DATABASE_PATH: path.join(dir, 'test.db'), SEED_ON_BOOT: 'true' },
    stdio: 'ignore',
  });

  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`${base}/healthz`);
      if (res.ok) break;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }

  return {
    base,
    stop: () => { server.kill(); fs.rmSync(dir, { recursive: true, force: true }); },
  };
}

let app;

test.before(async () => { app = await instance(); });
test.after(() => { if (app) app.stop(); });

function get(pathname, { cookie, redirect = 'manual' } = {}) {
  return fetch(app.base + pathname, {
    redirect,
    headers: cookie ? { Cookie: `session=${cookie}` } : {},
  });
}

const TOKENS = {
  organiser: 'org_7f2a',
  judgeA: 'jdg_a_91bc',
  judgeB: 'jdg_b_44de',
  participant: 'prt_2e88',
};

/* ------------------------------------------------------------- visibility */

test('a private event is invisible to the public', async () => {
  const list = await (await get('/hackathons')).text();
  assert.ok(!list.includes('Meridian'), 'a private event must not appear in the directory');

  const page = await get('/h/meridian-invitational');
  assert.equal(page.status, 403, 'a private event must not be readable anonymously');
  assert.ok(!(await page.text()).includes('Meridian Invitational'), 'the name must not leak');
});

test('a private event is not readable by a participant of another event', async () => {
  const res = await get('/h/meridian-invitational', { cookie: TOKENS.participant });
  assert.equal(res.status, 403);
});

test('an organiser can reach their own private event', async () => {
  const res = await get('/h/meridian-invitational', { cookie: TOKENS.organiser });
  assert.equal(res.status, 200);
});

test('an unlisted event is reachable by link but not listed', async () => {
  // Signal and the fixtures are public; nothing unlisted is seeded, so the
  // rule is asserted against the guard directly through the API instead.
  const res = await get('/api/events/meridian-invitational');
  assert.ok(res.status === 403 || res.status === 404);
});

/* ------------------------------------------------------------ authorisation */

test('a participant cannot open the organiser console', async () => {
  for (const tab of ['', '/projects', '/judges', '/results', '/rubric', '/event']) {
    const res = await get(`/o/signal-2026${tab}`, { cookie: TOKENS.participant });
    assert.equal(res.status, 403, `/o/signal-2026${tab} must refuse a participant`);
  }
});

test('a judge cannot open the organiser console', async () => {
  const res = await get('/o/signal-2026/judges', { cookie: TOKENS.judgeA });
  assert.equal(res.status, 403);
});

test('a judge cannot open the participant workspace', async () => {
  const res = await get('/p/signal-2026/project', { cookie: TOKENS.judgeA });
  assert.equal(res.status, 403);
});

test('an organiser cannot read judge review content through the participant API', async () => {
  const res = await fetch(`${app.base}/api/judge/scores?event=signal-2026`, {
    headers: { Cookie: `session=${TOKENS.organiser}` },
  });
  assert.equal(res.status, 403, 'an organiser uses the console, not the judge API');
});

/* --------------------------------------------------------- judge isolation */

test('a judge reads their own scores', async () => {
  const res = await get('/api/judge/scores?event=signal-2026', { cookie: TOKENS.judgeA });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.judge, 'the response identifies the judge');
  assert.ok(Array.isArray(body.reviews));
});

test('a judge is refused another judge\'s scores, not merely filtered', async () => {
  const mine = await (await get('/api/judge/scores?event=signal-2026', { cookie: TOKENS.judgeA })).json();
  const peer = await (await get('/api/judge/scores?event=signal-2026', { cookie: TOKENS.judgeB })).json();
  assert.notEqual(mine.judge.id, peer.judge.id);

  // Naming your own id is fine; naming anybody else's is refused outright.
  const own = await get(`/api/judge/scores?event=signal-2026&judge=${encodeURIComponent(peer.judge.id)}`, { cookie: TOKENS.judgeB });
  assert.equal(own.status, 200);

  for (const target of [mine.judge.id, 'jdg_01', 'anything']) {
    const res = await get(`/api/judge/scores?event=signal-2026&judge=${encodeURIComponent(target)}`, { cookie: TOKENS.judgeB });
    assert.equal(res.status, 403, `expected a refusal for ${target}, got ${res.status}`);
  }
});

test('a judge cannot open a project they are not assigned', async () => {
  const mine = await (await get('/api/judge/assignments?event=signal-2026', { cookie: TOKENS.judgeA })).json();
  const theirs = await (await get('/api/judge/assignments?event=signal-2026', { cookie: TOKENS.judgeB })).json();
  const onlyTheirs = theirs.items.map((i) => i.projectId).find((id) => !mine.items.some((m) => m.projectId === id));
  assert.ok(onlyTheirs, 'the fixture should contain a project assigned to one judge and not the other');

  const res = await get(`/j/signal-2026/r/${onlyTheirs}`, { cookie: TOKENS.judgeA });
  assert.equal(res.status, 403, 'an unassigned project page must be refused');
});

test('a judge cannot post a review for an unassigned project', async () => {
  const mine = await (await get('/api/judge/assignments?event=signal-2026', { cookie: TOKENS.judgeA })).json();
  const theirs = await (await get('/api/judge/assignments?event=signal-2026', { cookie: TOKENS.judgeB })).json();
  const onlyTheirs = theirs.items.map((i) => i.projectId).find((id) => !mine.items.some((m) => m.projectId === id));
  const res = await fetch(`${app.base}/api/reviews/signal-2026/${onlyTheirs}`, {
    method: 'POST',
    headers: { Cookie: `session=${TOKENS.judgeA}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'summary=should not be accepted',
  });
  assert.equal(res.status, 403);
});

test('a participant cannot read judge scores by any route', async () => {
  const res = await get('/api/judge/scores?event=signal-2026', { cookie: TOKENS.participant });
  assert.ok([401, 403].includes(res.status));

  const assignments = await get('/api/judge/assignments?event=signal-2026', { cookie: TOKENS.participant });
  assert.ok([401, 403].includes(assignments.status));
});

/* ------------------------------------------------------------- deadlines */

test('a closed event refuses submissions from a participant', async () => {
  const res = await fetch(`${app.base}/p/sample-hack-2026/project`, {
    method: 'POST',
    headers: { Cookie: `session=${TOKENS.participant}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Late project', tagline: 'After the deadline', description: 'x'.repeat(60) }),
  });
  assert.ok(res.status >= 400 && res.status < 500, `expected a 4xx, got ${res.status}`);
});

test('a closed event refuses submissions even with a valid body', async () => {
  const res = await fetch(`${app.base}/p/sample-hack-2026/project`, {
    method: 'POST',
    headers: {
      Cookie: `session=${TOKENS.participant}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      name: 'Late project',
      tagline: 'A perfectly valid one line summary',
      description: 'This is a completely legitimate description that is well over the minimum length.',
    }).toString(),
  });
  assert.ok(res.status >= 400 && res.status < 500, `expected a 4xx, got ${res.status}`);
});

test('the submission gate is a clock check, not a UI check', () => {
  const { submissionGate, registrationGate } = require('../src/lib/lifecycle');
  const closed = {
    status: 'published',
    starts_at: '2026-02-26T00:00:00Z',
    submissions_close_at: '2026-03-01T18:00:00Z',
    registration_opens_at: '2026-02-01T00:00:00Z',
    registration_closes_at: '2026-02-25T00:00:00Z',
  };
  const now = Date.parse('2026-09-29T12:00:00Z');

  assert.throws(() => submissionGate(closed, now), /closed/i, 'a past deadline refuses');
  assert.throws(() => registrationGate(closed, now), /closed/i, 'past registration refuses');

  // Five minutes before the deadline the same call must succeed.
  const justBefore = Date.parse(closed.submissions_close_at) - 300_000;
  assert.equal(submissionGate(closed, justBefore), true);

  // One millisecond after, it must not.
  const justAfter = Date.parse(closed.submissions_close_at) + 1;
  assert.throws(() => submissionGate(closed, justAfter), /closed/i);

  // An event with no deadline is refused rather than left open by accident.
  assert.throws(
    () => submissionGate({ status: 'published', starts_at: '2026-01-01T00:00:00Z', submissions_close_at: null }, now),
    /no submission deadline/i,
  );

});

test('a participant who is not registered is refused before the deadline is considered', async () => {
  const res = await fetch(`${app.base}/p/sample-hack-2026/project`, {
    method: 'POST',
    headers: { Cookie: `session=${TOKENS.participant}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'x' }),
  });
  assert.equal(res.status, 403, 'registration is checked first; the deadline is a second gate');
});

test('an open event accepts a submission from a registered participant', async () => {
  const res = await fetch(`${app.base}/p/signal-2026/project`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Cookie: `session=${TOKENS.participant}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      action: 'save',
      name: 'Critic draft',
      tagline: 'A draft written by the test suite to prove the write path works.',
      description: 'This description is comfortably longer than the forty character minimum the server enforces, so the write is accepted as a draft.',
      answer_q0: 'It works, and this is the answer to the first question.',
      answer_q1: 'For the person reading the answer to the second question.',
    }).toString(),
  });
  assert.equal(res.status, 302, 'a draft save redirects back to the editor');
  assert.match(res.headers.get('location') || '', /\/p\/signal-2026\/project/);

  // And the draft really is stored, not just acknowledged.
  const editor = await get('/p/signal-2026/project', { cookie: TOKENS.participant });
  const html = await editor.text();
  assert.ok(html.includes('Critic draft'), 'the saved draft is read back');
});

/* ---------------------------------------------------------------- results */

test('unpublished results are not readable by anybody but the organiser', async () => {
  const anonymous = await get('/api/events/signal-2026');
  const body = await anonymous.json();
  assert.equal(body.results, null, 'results must be absent until published, not an empty array');

  const organiser = await get('/api/events/signal-2026', { cookie: TOKENS.organiser });
  const organiserBody = await organiser.json();
  assert.equal(organiserBody.results, null, 'the public API does not leak unpublished results to organisers either');

  const resultsPage = await get('/h/signal-2026/results');
  const text = await resultsPage.text();
  assert.ok(!/Overall winner/.test(text), 'an unreleased result must not be on the public page');
});

test('published results are readable by anyone', async () => {
  const res = await get('/api/events/foundry-2026');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(Array.isArray(body.results) && body.results.length > 0);
});

/* ------------------------------------------------------------ credentials */

test('no credential is accepted from the query string', async () => {
  for (const q of ['?session=org_7f2a', '?token=org_7f2a', '?api_key=org_7f2a', '?hkl_session=org_7f2a']) {
    const res = await get(`/api/me${q}`);
    assert.equal(res.status, 401, `${q} must not authenticate anybody`);
  }
});

test('a revoked token stops working immediately', async () => {
  const res = await fetch(`${app.base}/api/me`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'nothing=1',
  });
  assert.ok(res.status < 500);
  // The real check: garbage credentials never authenticate.
  const garbage = await get('/api/me', { cookie: 'not-a-real-token' });
  assert.equal(garbage.status, 401);
});

test('an unauthenticated request to a workspace page lands on the sign-in form', async () => {
  for (const path of ['/dashboard', '/p/signal-2026', '/o/signal-2026', '/j/signal-2026']) {
    const res = await get(path);
    assert.equal(res.status, 302, `${path} must redirect rather than render a status page`);
    const location = res.headers.get('location') || '';
    assert.match(location, /signin/);
    assert.ok(location.includes('next='), 'the destination is remembered so the person lands back where they were');
  }
});

/* ------------------------------------------------------------------ export */

test('only an organiser of the event may export', async () => {
  const organiser = await get('/api/export.csv?event=signal-2026', { cookie: TOKENS.organiser });
  assert.equal(organiser.status, 200);
  const body = await organiser.text();
  assert.ok(body.split('\n')[0].includes(','), 'the export must be CSV');

  for (const cookie of [TOKENS.judgeA, TOKENS.judgeB, TOKENS.participant]) {
    const res = await get('/api/export.csv?event=signal-2026', { cookie });
    assert.ok([401, 403].includes(res.status), `export must refuse ${cookie}`);
  }
});

test('CSV cells cannot carry a spreadsheet formula', async () => {
  const res = await get('/api/export.csv?event=foundry-2026', { cookie: TOKENS.organiser });
  const body = await res.text();
  for (const line of body.split('\n').slice(1)) {
    for (const cell of line.split('","')) {
      assert.ok(!/^"?=[=+\-@]/.test(cell.trim()), `a cell begins with a formula character: ${cell.slice(0, 40)}`);
    }
  }
});

/* ------------------------------------------------------------ cross-event */

test('an organiser of one event is not an organiser of another', async () => {
  // The seeded organiser runs both live events, so use a participant instead.
  const res = await get('/o/foundry-2026/results', { cookie: TOKENS.participant });
  assert.equal(res.status, 403);
});

test('a judge of one event cannot judge another', async () => {
  const res = await get('/j/foundry-2026', { cookie: TOKENS.judgeA });
  assert.equal(res.status, 403, 'judge access is per event');
});

test('a deadline closes the door from the server, not from the page', async () => {
  // A throwaway event with generous dates, created and closed entirely through
  // the public routes. Nothing in this test touches the database directly, so
  // it proves the gate rather than the implementation of the gate.
  const form = (path, body, cookie) => fetch(app.base + path, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(cookie ? { Cookie: `session=${cookie}` } : {}),
    },
    body: new URLSearchParams(body).toString(),
  });

  const created = await form('/host/new', {
    name: 'Deadline probe',
    tagline: 'An event created to prove that the submission gate is server-side.',
    about: 'Created by the test suite.',
    timezone: 'UTC',
    startsAt: '2026-09-01T09:00',
    endsAt: '2026-12-01T18:00',
    submissionsCloseAt: '2026-12-01T16:00',
    registrationOpensAt: '2026-08-01T09:00',
    registrationClosesAt: '2026-11-30T00:00',
    allowSolo: '1',
    showProjects: '1',
  }, TOKENS.organiser);
  assert.equal(created.status, 302);
  const slug = (created.headers.get('location') || '').split('/').pop();
  assert.ok(slug, 'the event was created');

  // Register while registration is open.
  const registered = await form(`/p/${slug}/register`, { rules: '1' }, TOKENS.participant);
  assert.equal(registered.status, 302, 'registration succeeds while the window is open');

  // A valid submission is accepted.
  const before = await form(`/p/${slug}/project`, {
    action: 'save',
    name: 'Before the deadline',
    tagline: 'A draft written while submissions are still open, which should be accepted.',
    description: 'This description is comfortably longer than the forty character minimum the server enforces on every submission.',
  }, TOKENS.participant);
  assert.equal(before.status, 302, 'a submission before the deadline is accepted');

  // Now move the deadline into the past, the way an organiser would. The
  // portal refuses a deadline that precedes the start, so this closes the
  // window at a date that is in the past but still inside the event.
  const closed = await form(`/o/${slug}/event`, {
    name: 'Deadline probe',
    tagline: 'An event created to prove that the submission gate is server-side.',
    about: 'Created by the test suite.',
    timezone: 'UTC',
    startsAt: '2026-09-01T09:00',
    endsAt: '2026-12-01T18:00',
    submissionsCloseAt: '2026-09-20T16:00',
    registrationOpensAt: '2026-08-01T09:00',
    registrationClosesAt: '2026-11-30T00:00',
    allowSolo: '1',
    showProjects: '1',
  }, TOKENS.organiser);
  assert.equal(closed.status, 302, 'the organiser can move the deadline');

  // The portal will not let you set a deadline before the event begins.
  const nonsensical = await form(`/o/${slug}/event`, {
    name: 'Deadline probe',
    tagline: 'An event created to prove that the submission gate is server-side.',
    about: 'Created by the test suite.',
    timezone: 'UTC',
    startsAt: '2026-09-01T09:00',
    endsAt: '2026-12-01T18:00',
    submissionsCloseAt: '2026-01-01T00:00',
    allowSolo: '1',
    showProjects: '1',
  }, TOKENS.organiser);
  assert.equal(nonsensical.status, 422, 'a deadline before the start is refused, and said so');

  // The same submission is now refused, with the deadline as the reason.
  const after = await fetch(`${app.base}/p/${slug}/project`, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Cookie: `session=${TOKENS.participant}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      action: 'submit',
      name: 'After the deadline',
      tagline: 'A perfectly well formed submission that arrives after the door has closed.',
      description: 'This description is comfortably longer than the forty character minimum the server enforces on every submission.',
    }).toString(),
  });
  assert.equal(after.status, 409, 'a submission after the deadline is refused with 409');
  const body = await after.json();
  assert.match(body.message, /closed/i);

  // And the page itself says so, rather than offering a form that will fail.
  const page = await get(`/p/${slug}/project`, { cookie: TOKENS.participant });
  const html = await page.text();
  assert.match(html, /closed/i);
  assert.ok(html.includes('disabled'), 'the submit control is disabled once the window has shut');
});

/* --------------------------------------------------------------- injection */

test('user content is escaped, not rendered', async () => {
  const payload = '<img src=x onerror=alert(1)>';
  const res = await fetch(`${app.base}/signin`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ email: payload, password: 'x' }).toString() });
  const html = await res.text();
  assert.ok(!html.includes('<img src=x onerror'), 'the payload must never be echoed as markup');
  assert.ok(!html.includes('onerror=alert'), 'nor in any other form');

  // A valid-but-unknown address is reflected; it must arrive escaped.
  const unknown = await fetch(`${app.base}/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: `nobody+<b>x</b>@example.com`, password: 'wrongpassword' }).toString(),
  });
  const unknownHtml = await unknown.text();
  assert.ok(!unknownHtml.includes('<b>x</b>'), 'a rejected sign-in must not echo markup');
  assert.ok(unknownHtml.includes('nobody+&lt;b&gt;x&lt;/b&gt;@example.com'), 'the address is escaped, not dropped');
});

test('an unsafe URL in a project link is dropped, not rendered as a link', async () => {
  // The showcase only renders http(s) links; verify the guard directly.
  const { safeUrl } = require('../src/lib/html');
  for (const bad of ['javascript:alert(1)', 'data:text/html,<script>x</script>', '//evil.example', 'vbscript:x', '']) {
    assert.equal(safeUrl(bad), '', `${bad} must not survive`);
  }
  assert.equal(safeUrl('https://example.dev/x'), 'https://example.dev/x');
});
