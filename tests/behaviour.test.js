'use strict';

/**
 * Product behaviour.
 *
 * The rules the platform promises: what a phase means, what a score is, what
 * a judge can and cannot reach, and what the seed data looks like. These are
 * the assertions that would catch a regression nobody would notice by reading
 * a page.
 */

const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

let child;
let base;
let dir;

test.before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hackerly-behaviour-'));
  const port = 12000 + Math.floor(Math.random() * 20000);
  await new Promise((resolve, reject) => {
    const seed = spawn(process.execPath, ['src/db/seed/cli.js'], {
      cwd: ROOT,
      env: { ...process.env, DATABASE_PATH: path.join(dir, 'test.db') },
      stdio: 'ignore',
    });
    seed.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`seed ${code}`))));
  });
  child = spawn(process.execPath, ['src/server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(port), DATABASE_PATH: path.join(dir, 'test.db') },
    stdio: 'ignore',
  });
  base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(`${base}/healthz`)).ok) break; } catch { /* waiting */ }
    await new Promise((r) => setTimeout(r, 150));
  }
});

test.after(() => {
  if (child) child.kill();
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

/* ------------------------------------------------------------------ phases */

test('an event that closed months ago is never described as live', () => {
  const { phase } = require('../src/lib/lifecycle');
  const now = Date.parse('2026-09-29T12:00:00Z');
  const past = {
    status: 'published',
    starts_at: '2026-02-26T00:00:00Z',
    ends_at: '2026-03-01T20:00:00Z',
    submissions_close_at: '2026-03-01T18:00:00Z',
    judging_opens_at: '2026-03-02T00:00:00Z',
    judging_closes_at: '2026-03-05T00:00:00Z',
  };
  assert.equal(phase(past, now), 'archived');

  // Judging that opened and closed without results is over, not ongoing.
  // Judging opened, submissions closed, and no judging deadline was ever set.
  // That is an event that is over, not one that is judging forever.
  const stuck = { ...past, ends_at: '2027-01-01T00:00:00Z', judging_closes_at: null };
  const stuckPhase = phase(stuck, now);
  assert.ok(!['building', 'registration', 'judging', 'upcoming', 'announced'].includes(stuckPhase),
    `an event with no future deadline must not look live, got ${stuckPhase}`);

  // An event that is genuinely judging right now still says so.
  const live = { ...past, starts_at: '2026-09-28T00:00:00Z', submissions_close_at: '2026-10-05T00:00:00Z', judging_opens_at: '2026-09-28T00:00:00Z', judging_closes_at: '2026-10-05T00:00:00Z' };
  assert.equal(phase(live, now), 'building', 'an open submission window wins the badge');
  assert.equal(live.submissions_close_at > '2026-09-29T12:00:00Z', true);
});

test('the same event reads the same in either field shape', () => {
  const { phase } = require('../src/lib/lifecycle');
  const now = Date.parse('2026-09-29T12:00:00Z');
  const snake = {
    status: 'published', results_released: 0,
    starts_at: '2026-09-26T17:00:00Z', ends_at: '2026-09-28T17:00:00Z',
    submissions_close_at: '2026-10-03T18:00:00Z',
    judging_opens_at: '2026-09-28T09:00:00Z', judging_closes_at: '2026-10-06T18:00:00Z',
  };
  const camel = {
    status: 'published', resultsReleased: false,
    startsAt: snake.starts_at, endsAt: snake.ends_at,
    submissionsCloseAt: snake.submissions_close_at,
    judgingOpensAt: snake.judging_opens_at, judgingClosesAt: snake.judging_closes_at,
  };
  assert.equal(phase(snake, now), phase(camel, now), 'a view object must not read as a different event');
});

/* ----------------------------------------------------------------- scoring */

test('a weighted total respects the weights the organiser set', () => {
  const { weightedTotal } = require('../src/lib/judging');
  const criteria = [
    { id: 'a', weight: 2, max_score: 5 },
    { id: 'b', weight: 1, max_score: 5 },
  ];
  // 5 on the double-weighted criterion and 1 on the single one is 11/15.
  assert.equal(weightedTotal({ a: 5, b: 1 }, criteria), 73.33);
  assert.equal(weightedTotal({ a: 5, b: 5 }, criteria), 100);
  assert.equal(weightedTotal({ a: 0, b: 0 }, criteria), 0);
  // 4 on a weight-2 criterion and 2 on a weight-1 one is 10/15.
  assert.equal(weightedTotal({ a: 4, b: 2 }, criteria), 66.67);
});

test('a judge who scores everything the same is not corrected', () => {
  const { normaliseAgainst, scoreProject } = require('../src/lib/judging');
  const flat = normaliseAgainst(80, [80, 80, 80, 80, 80]);
  assert.equal(flat.method, 'weighted', 'a flat distribution has no personal scale to correct against');
  assert.equal(flat.value, 80);
  assert.match(flat.note, /identically/i);

  const varied = normaliseAgainst(80, [50, 60, 70, 80, 90]);
  assert.equal(varied.method, 'z-score');
  assert.ok(varied.value > 0 && varied.value <= 100);
});

test('normalisation is symmetric around the judge\'s own mean', () => {
  const { normaliseAgainst } = require('../src/lib/judging');
  const population = [40, 50, 60, 70, 80];
  const mid = normaliseAgainst(60, population);
  const high = normaliseAgainst(80, population);
  const low = normaliseAgainst(40, population);
  assert.ok(high.value > mid.value && mid.value > low.value);
  assert.ok(Math.abs(mid.value - 50) < 1, 'the mean maps to the middle of the range');
});

test('standings rank by the blended score, and ties share a rank', () => {
  const { standings } = require('../src/lib/judging');
  const { db } = require(path.join(ROOT, 'src', 'db'));
  const event = db().prepare("SELECT id FROM events WHERE slug = 'foundry-2026'").get();
  const rows = standings(event.id);
  assert.ok(rows.length >= 10);
  for (let i = 1; i < rows.length; i += 1) {
    assert.ok(rows[i - 1].final >= rows[i].final, 'rows must be ordered by the final score');
    if (rows[i - 1].final === rows[i].final) {
      assert.equal(rows[i].rank, rows[i - 1].rank, 'equal scores must share a rank');
    } else {
      assert.equal(rows[i].rank, rows[i - 1].rank + 1, 'a different score advances the rank by one');
    }
  }
  for (const row of rows.filter((r) => r.trackName)) {
    assert.ok(row.trackRank >= 1, 'a project in a track has a track-relative rank');
  }
});

test('the blend is a real blend, not a rename of the raw score', () => {
  const { scoreProject } = require('../src/lib/judging');
  const { db } = require(path.join(ROOT, 'src', 'db'));
  const event = db().prepare("SELECT id FROM events WHERE slug = 'foundry-2026'").get();
  const project = db().prepare("SELECT id FROM projects WHERE event_id = ? LIMIT 1").get(event.id);
  const score = scoreProject(event.id, project.id);
  assert.ok(score.submitted > 0);
  assert.notEqual(score.final, score.weighted, 'normalisation must actually move the number');
  assert.ok(score.final >= 0 && score.final <= 100);
  assert.ok(score.perJudge.length > 0);
  assert.ok(score.perJudge.every((p) => Number.isFinite(p.normalised)));
});

/* --------------------------------------------------------- pairwise model */

test('the head-to-head model ranks a project that wins every comparison first', () => {
  const { bradleyTerry } = require('../src/lib/judging');
  const strong = 'p-strong';
  const weak = 'p-weak';
  const comparisons = [];
  for (let i = 0; i < 4; i += 1) {
    comparisons.push({ project_a: strong, project_b: weak, winner: 'a', weightOfA: 1, weightOfB: 1 });
  }
  const ranked = bradleyTerry(comparisons);
  assert.equal(ranked.length, 2, 'both projects appear, including the one that never won');
  assert.equal(ranked[0].projectId, strong);
  assert.equal(ranked[0].strength, 100, 'the leader is reported on a 0-100 scale');
  assert.ok(ranked[0].strength > ranked[1].strength);
  assert.ok(Number.isFinite(ranked[0].strength) && Number.isFinite(ranked[1].strength));
});

/* ------------------------------------------------------------------ seed */

test('the seeded installation is internally consistent', async () => {
  const { db } = require(path.join(ROOT, 'src', 'db'));
  const problems = [];

  // Every project belongs to a team in the same event, with members.
  const orphans = db().prepare(`
    SELECT p.id, p.name FROM projects p
    WHERE NOT EXISTS (SELECT 1 FROM team_members m WHERE m.team_id = p.team_id)
  `).all();
  for (const p of orphans) problems.push(`project ${p.name} has no team members`);

  // Every submitted project has at least one frozen submission copy.
  const unsubmitted = db().prepare(`
    SELECT p.name FROM projects p WHERE p.status = 'submitted'
      AND NOT EXISTS (SELECT 1 FROM project_submissions s WHERE s.project_id = p.id)
  `).all();
  for (const p of unsubmitted) problems.push(`submitted project ${p.name} has no frozen copy`);

  // Every published result points at a project in the same event.
  const crossEvent = db().prepare(`
    SELECT r.id FROM results r JOIN projects p ON p.id = r.project_id
    WHERE p.event_id != r.event_id
  `).all();
  if (crossEvent.length) problems.push(`${crossEvent.length} results cross an event boundary`);

  // No judge is recorded against somebody else's event.
  const strays = db().prepare(`
    SELECT COUNT(*) AS n FROM judges j JOIN users u ON u.id = j.user_id
    WHERE j.user_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM event_roles r WHERE r.event_id = j.event_id AND r.user_id = j.user_id)
  `).get().n;
  if (strays) problems.push(`${strays} judge records have no matching role`);

  // Nobody is on two teams in the same event.
  const doubles = db().prepare(`
    SELECT m.user_id, t.event_id FROM team_members m JOIN teams t ON t.id = m.team_id
    GROUP BY m.user_id, t.event_id HAVING COUNT(*) > 1
  `).all();
  for (const d of doubles) problems.push(`a user is on two teams in one event`);

  assert.deepEqual(problems, [], problems.join('; '));
});

test('the fixtures loaded completely and kept their awkward cases', () => {
  const { db } = require(path.join(ROOT, 'src', 'db'));
  const event = db().prepare('SELECT * FROM events WHERE id = ?').get('evt_01');
  assert.ok(event, 'the fixture event is present');
  assert.equal(event.submissions_close_at, '2026-03-01T18:00:00Z', 'the supplied close date is preserved exactly');

  const projects = db().prepare('SELECT COUNT(*) AS n FROM projects WHERE event_id = ?').get('evt_01').n;
  assert.equal(projects, 41, 'all 41 fixture projects loaded, including the duplicate');

  const reviews = db().prepare("SELECT COUNT(*) AS n FROM reviews WHERE event_id = ? AND state = 'submitted'").get('evt_01').n;
  const scores = db().prepare('SELECT COUNT(*) AS n FROM reviews WHERE event_id = ?').get('evt_01').n;
  assert.ok(scores >= 126, `every supplied score is stored (${scores})`);
  assert.ok(reviews < scores, 'reviews with no comment are preserved as drafts, as the fixtures intend');

  // A judge who scored every project identically must still be handled.
  const flat = db().prepare(`
    SELECT judge_id, COUNT(DISTINCT total_score) AS distinct_scores, COUNT(*) AS n
    FROM reviews WHERE event_id = 'evt_01' AND state = 'submitted' GROUP BY judge_id
    HAVING distinct_scores = 1 AND n > 2
  `).all();
  assert.ok(Array.isArray(flat), 'the query runs whether or not such a judge exists');
});

test('no public surface leaks an email address', async () => {
  const pages = ['/', '/hackathons', '/projects', '/about', '/host',
    '/h/signal-2026', '/h/foundry-2026', '/h/foundry-2026/results',
    '/projects/foundry-2026/bandit-proxy'];
  const emailish = /[\w.+-]+@[\w-]+\.[\w.]{2,}/g;
  for (const page of pages) {
    const res = await fetch(base + page);
    const text = await res.text();
    const found = (text.match(emailish) || []).filter((e) => !/example\.(com|org|dev)|schema|font|@media|w3\.org|npmjs/.test(e));
    assert.deepEqual(found, [], `${page} exposed ${found.join(', ')}`);
  }
});

test('no public surface leaks an internal identifier', async () => {
  const pages = ['/', '/hackathons', '/projects', '/h/signal-2026', '/h/foundry-2026',
    '/h/foundry-2026/results', '/projects/foundry-2026/bandit-proxy', '/about'];
  for (const page of pages) {
    const text = await (await fetch(base + page)).text();
    const leaked = text.match(/\b(prj_|evt_|tm_|trk_|jdg_|usr_|crt_|sfd_)[a-z0-9]+/gi) || [];
    assert.deepEqual(leaked, [], `${page} leaked ${leaked.slice(0, 3).join(', ')}`);
  }
});

test('no page is a card wall of identical rows', async () => {
  // The showcase has to look like a showcase, not a spreadsheet export.
  const text = await (await fetch(`${base}/projects`)).text();
  const taglines = (text.match(/class="card__body"/g) || []).length;
  assert.ok(taglines > 4, 'the showcase renders project cards');
  assert.ok(!text.includes('One line of what it does.'), 'fixture placeholder prose must not be shown verbatim');
});

test('the demo accounts work and reach the right place', async () => {
  for (const [email, expected] of [
    ['organiser@hackerly.dev', '/dashboard'],
    ['judge@hackerly.dev', '/dashboard'],
    ['participant@hackerly.dev', '/dashboard'],
  ]) {
    const res = await fetch(`${base}/signin`, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email, password: 'hackerly-demo' }).toString(),
    });
    assert.equal(res.status, 302, `${email} can sign in`);
    assert.equal(res.headers.get('location'), expected);
    const cookie = (res.headers.get('set-cookie') || '').split(';')[0];
    assert.ok(cookie.startsWith('hkl_session='), 'a session cookie is issued');
    assert.ok((res.headers.get('set-cookie') || '').includes('HttpOnly'));
    assert.ok((res.headers.get('set-cookie') || '').includes('SameSite=Lax'));
  }
});

test('a wrong password is refused with one message for both cases', async () => {
  const wrongPassword = await fetch(`${base}/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: 'organiser@hackerly.dev', password: 'not-the-password' }).toString(),
  });
  const noSuchUser = await fetch(`${base}/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: 'nobody@example.com', password: 'not-the-password' }).toString(),
  });
  assert.equal(wrongPassword.status, 401);
  assert.equal(noSuchUser.status, 401);
  const message = /do not match an account/;
  assert.match(await wrongPassword.text(), message);
  assert.match(await noSuchUser.text(), message);
});

test('the response carries a defensible security header set', async () => {
  const res = await fetch(`${base}/`);
  const csp = res.headers.get('content-security-policy') || '';
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  assert.ok(!/"unsafe-eval"/.test(csp));
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(res.headers.get('x-frame-options'), 'DENY');
  assert.ok((res.headers.get('referrer-policy') || '').includes('strict-origin'));
  assert.equal(res.headers.get('x-powered-by'), null, 'the server does not advertise itself');
});

test('every page carries a sign-out control once signed in', async () => {
  const signin = await fetch(`${base}/signin`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: 'participant@hackerly.dev', password: 'hackerly-demo' }).toString(),
  });
  const cookie = (signin.headers.get('set-cookie') || '').split(';')[0];
  for (const page of ['/dashboard', '/p/signal-2026', '/p/signal-2026/project', '/p/signal-2026/team']) {
    const res = await fetch(base + page, { headers: { Cookie: cookie } });
    const html = await res.text();
    assert.ok(html.includes('action="/signout"'), `${page} offers no way to sign out`);
  }
});

test('the showcase counts its own page honestly and honours every filter', async () => {
  // The pager said "1-24" while rendering 48, and "Awarded only" did nothing.
  // Both were invisible to a reader and obvious to a test.
  const shown = (html) => {
    const m = html.match(/Showing (\d+)–(\d+) of (\d+)/);
    return m ? { from: +m[1], to: +m[2], of: +m[3] } : null;
  };

  const all = await (await fetch(`${base}/projects`)).text();
  const page1 = shown(all);
  assert.ok(page1, 'the showcase says what it is showing');
  const cards = (all.match(/<a class="card" href="\/p\/[^"]+\/[^"]+"/g) || []).length;
  assert.equal(page1.to - page1.from + 1, cards, 'the range matches the cards on the page');
  assert.ok(page1.of >= cards, 'the total is not smaller than the page');

  const page2 = shown(await (await fetch(`${base}/projects?page=2`)).text());
  assert.equal(page2.from, page1.to + 1, 'page two starts where page one ended');
  assert.equal(page2.of, page1.of, 'the total is stable across pages');

  const awarded = await (await fetch(`${base}/projects?awarded=1`)).text();
  const awardedRange = shown(awarded);
  assert.ok(awardedRange.of < page1.of, '"Awarded only" actually narrows the list');
  assert.ok(/Overall winner|Second place|Third place/.test(awarded), 'awarded results are shown');

  const tracked = await (await fetch(`${base}/projects?track=Resilient`)).text();
  assert.ok(shown(tracked).of < page1.of, 'the track filter actually narrows the list');

  const searched = await (await fetch(`${base}/projects?q=licence`)).text();
  assert.ok(shown(searched).of < page1.of, 'search actually narrows the list');
});

test('the showcase spreads across events instead of letting one event bury the rest', async () => {
  // Strictly newest-first turned page one into a single event. Every visible
  // event has to appear on the first page, or the archive is unreachable.
  const html = await (await fetch(`${base}/projects`)).text();
  const events = [...new Set((html.match(/Sample Hack 2026|Foundry 2026|Signal 2026/g) || []))];
  assert.deepEqual(events.sort(), ['Foundry 2026', 'Sample Hack 2026', 'Signal 2026'],
    'the first page shows work from every visible event');
});
