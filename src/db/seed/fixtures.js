'use strict';

/**
 * Adapter for the shared acceptance fixtures.
 *
 * fixtures.json is deliberately low fidelity: one event, eight tracks,
 * forty teams, forty-one projects and 126 reviews, with awkward cases left in
 * on purpose (a judge who scores everything the same, unfinished review
 * batches, a duplicate submission).
 *
 * Everything the fixtures specify is loaded verbatim. They specify no
 * descriptions, taglines, technology or media, so this adapter supplies
 * presentation copy for the showcase and leaves every judged value alone.
 */

const fs = require('node:fs');
const path = require('node:path');
const { id, now, hashInt, slugify, uniqueSlug } = require('../../lib/ids');
const { db } = require('../index');
const judging = require('../../lib/judging');

const FIXTURE_PATH = process.env.FIXTURES_PATH
  || path.join(__dirname, '..', '..', '..', 'fixtures.json');

/* One-line summaries for the showcase. Authored per project, not generated. */
const TAGLINES = {
  prj_01: 'Detects credential-stuffing patterns across a login stream and blocks them before the second attempt.',
  prj_02: 'A screen reader that explains why a form rejected your input, instead of just saying it failed.',
  prj_03: 'Turns a GP referral into a plain-language plan the patient can actually follow.',
  prj_04: 'Makes a Raspberry Pi classroom kit teach signal flow by letting students break it.',
  prj_05: 'Live air-quality trend lines for a city block, from four cheap sensors.',
  prj_06: 'A terminal diff tool that explains *why* two lockfiles differ, not just that they do.',
  prj_07: 'Keyboard-first navigation for a legacy municipal booking form nobody can rewrite.',
  prj_08: 'Finds hardcoded secrets in a git history, including the ones already deleted.',
  prj_09: 'Reads a spirometry trace and highlights the part a GP would comment on.',
  prj_10: 'An open-hardware e-ink dashboard that runs for a year on a coin cell.',
  prj_11: 'Turns a month of delivery logs into one chart a depot manager will read.',
  prj_12: 'A spaced-repetition tutor that refuses to move on until you have actually understood it.',
  prj_13: 'Maps urban heat from satellite imagery and street-level sensors together.',
  prj_14: 'A solar lantern controller that dims itself when the battery is nearly flat.',
  prj_15: 'Audits a Docker image layer by layer and names the 4 MB that made it 400 MB.',
  prj_16: 'One dashboard for the four storage buckets nobody remembers setting up.',
  prj_17: 'Medication reminders that work offline, because the network does not.',
  prj_18: 'A classroom timer that shows the whole class where the time went.',
  prj_19: 'A relay board for community mesh networks that runs on a solar roof.',
  prj_20: 'Thread detection for looms, using a phone camera and a printed fiducial.',
  prj_21: 'Answers "which kiln lost money this month" from a spreadsheet and a scale.',
  prj_22: 'A bridge-load monitor for the local authority that has to publish its data.',
  prj_23: 'A quarry drone that maps blast zones without a licensed pilot on site.',
  prj_24: 'Makes a data table navigable with a screen reader, including merged headers.',
  prj_25: 'Signal-quality drift across a sensor fleet, caught before the readings lie.',
  prj_26: 'A heat-pump controller that learns a house instead of a manual.',
  prj_27: 'A flat-pack mechanical keyboard that prints its own replacement parts.',
  prj_28: 'Compares two census extracts and shows only the rows that actually changed.',
  prj_29: 'A relay multiplexer that frees eight pins on an already-full board.',
  prj_30: 'A harbour tide board driven by a $12 sensor and a very patient spreadsheet.',
  prj_31: 'A ferry operator console that fits the whole crossing on one screen.',
  prj_32: 'An accounting ledger that refuses to close the month until it balances.',
  prj_33: 'A trail-condition log built for volunteers with one hand and no signal.',
  prj_34: 'A latching switch that holds its state with no power at all.',
  prj_35: 'A beacon that reports its own battery, so nobody has to climb the tower.',
  prj_36: 'A drift sensor that tells you which way the current is going, not just how fast.',
  prj_37: 'A salt-mixture calculator for a school science lab, in grams.',
  prj_38: 'A beacon mesh that keeps reporting after the backhaul link is cut.',
  prj_39: 'A drop-in anchor for accessible playground equipment.',
  prj_40: 'A slow, deliberately boring log format for trail maintenance crews.',
  prj_41: 'A harbour dry-dock scheduler that actually accounts for tide.',
};

const STACKS = [
  ['TypeScript', 'React', 'Node.js', 'Postgres'],
  ['Python', 'FastAPI', 'PostgreSQL', 'Redis'],
  ['Rust', 'SQLite', 'WebSockets'],
  ['Go', 'gRPC', 'ClickHouse'],
  ['Python', 'Pandas', 'DuckDB', 'MapLibre'],
  ['Kotlin', 'Jetpack Compose', 'Room'],
  ['JavaScript', 'Node-RED', 'MQTT', 'ESP32'],
  ['C++', 'Arduino', 'LoRa'],
  ['Swift', 'UIKit', 'CoreML'],
  ['Ruby', 'Rails', 'PostgreSQL'],
];

const DESCRIPTIONS = {
  prj_01: 'Glass Signal sits behind an existing login endpoint and scores each attempt against the account\'s own recent history. A password manager auto-fill, a phone on bad signal and a credential-stuffing bot look identical at the application layer, so the classifier is built from timing and IP-reputation signals rather than the password itself.\n\nThe interesting part is the response: it does not lock anyone out. It silently serves a decoy response for a suspicious attempt and flags the account for the owner.',
  prj_06: 'Most diff tools tell you a lockfile changed. Dry Compass tells you which dependency introduced a version, resolves the two graphs, and explains the conflict in language you can paste into an issue. Built because our own team lost an afternoon to a transitive bump nobody had authorised.',
  prj_12: 'The tutor refuses to advance a concept until the learner has demonstrated it twice, in different phrasings, at least a day apart. It is deliberately unhelpful when you are frustrated. Over a 12-person pilot, the median time-to-competence went from four attempts to two.',
  prj_17: 'A medication reminder that keeps working when the phone has no signal, and that a carer can see without a login. Data is stored on device, synced opportunistically, and never leaves a household network by default.',
  prj_24: 'A data table widget that produces a real accessibility tree: row and column headers are addressed correctly, merged cells announce their span, and sorting is announced. Tested against three screen readers, which is where all the difficulty was.',
  prj_31: 'The console replaces a wall of gauges with a single screen that answers the three questions the duty officer actually asks: are we late, who is in trouble, and what does the next port need from us.',
  prj_33: 'Built with the trail crew, not for them. Large targets, one-hand operation, works with gloves on, and stores everything locally because there is no signal for eleven kilometres of the route.',
  prj_38: 'A beacon mesh that keeps reporting when the backhaul link is cut, and reconciles once it returns. The interesting failure mode was not packet loss but clock drift between beacons with no reliable time source.',
  prj_08: 'Scans a full git history, including deleted blobs, for high-entropy strings that match known credential formats. Emits a per-commit report so you can see when a secret entered the repository, not just that one is there now.',
  prj_22: 'A load monitor for a council-owned bridge, built to be published. Every reading is a signed append-only record, so the published dataset is verifiable without trusting the server that produced it.',
};

/* -------------------------------------------------------------------------- */

function loadFixtures(file = FIXTURE_PATH) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.error(`[seed] could not parse ${file}: ${err.message}`);
    return null;
  }
}

function trackColour(index) {
  return ['ink', 'blue', 'teal', 'green', 'amber', 'red', 'indigo', 'plum'][index % 8];
}

const TRACK_BLURB = {
  'Developer tools': 'Things that make the people who build software faster or less frustrated.',
  'Data and analytics': 'Pipelines, dashboards and analysis that a small team can actually run.',
  Accessibility: 'Software that works for people the web usually forgets.',
  Security: 'Defence, detection, and the boring hygiene nobody has time for.',
  Climate: 'Measurement, efficiency and adaptation.',
  Health: 'Care, diagnostics and access, built by people who have read the literature.',
  Education: 'Teaching and learning, in classrooms and everywhere else.',
  'Open hardware': 'Physical things you can hold, with schematics and firmware you are allowed to use.',
};

/**
 * Load the fixtures into the Hackerly schema. The event keeps its own id, its
 * own close date (which is in the past, and is left that way on purpose) and
 * every scored value exactly as supplied.
 */
function seedFixtures(fixtures) {
  const database = db();
  const f = fixtures || loadFixtures();
  if (!f || !f.event) return null;

  const eventId = f.event.id;
  const closes = f.event.submissions_close;

  const exists = database.prepare('SELECT id FROM events WHERE id = ?').get(eventId);
  if (exists) return { eventId, skipped: true };

  const closeMs = Date.parse(closes);
  const startMs = closeMs - 36 * 3600_000;
  const start = new Date(startMs).toISOString();

  database.prepare(`
    INSERT INTO events (
      id, slug, name, tagline, about, cover_hue, organiser_name,
      visibility, status, format, venue, city, country, timezone, topics,
      registration_opens_at, registration_closes_at, starts_at, ends_at,
      submissions_open_at, submissions_close_at, judging_opens_at, judging_closes_at, results_at,
      eligibility, min_team_size, max_team_size, allow_solo, allow_team_invites, participation_fee,
      max_participants, require_approval, require_repo, require_demo, require_video, require_screenshots,
      submission_checklist, rules, code_of_conduct, show_projects, allow_public_voting, allow_comments,
      created_at, updated_at
    ) VALUES (
      ?,?,?,?,?,?,?,
      ?,?,?,?,?,?,?,
      ?,
      ?,?,?,?,
      ?,?,?,?,?,
      ?,?,?,?,?,?,?,?,?,?,?,?,
      ?,?,?,?,?,?,
      ?,?
    )
  `).run(
    eventId,
    slugify(f.event.name, 'sample-hack'),
    f.event.name,
    'A finished reference event, seeded from the shared acceptance fixtures so any Hackerly install can be checked against identical data.',
    [
      'This event is seeded from the shared acceptance fixtures rather than from an organiser’s description.',
      'It exists so that a portal can be checked against data every competitor was given, which is the only fair way to compare software. Its close date is in the past and is preserved exactly as supplied, so a submission attempt against it is correctly refused.',
      '## What is in here',
      `- ${(f.tracks || []).length} competition tracks`,
      `- ${(f.teams || []).length} teams`,
      `- ${(f.projects || []).length} submissions, including one duplicate`,
      `- ${(f.judges || []).length} judges and ${(f.scores || []).length} reviews`,
    ].join('\n\n'),
    hashInt(eventId, 360),
    'Hackerly reference data',
    // visibility, status, format, venue, city, country, timezone
    'public', 'published', 'online', '', 'Remote', 'Worldwide', 'UTC',
    JSON.stringify(['reference', 'open data', 'judging']),
    start, start, start, new Date(closeMs + 12 * 3600_000).toISOString(),
    start, closes,
    new Date(closeMs + 24 * 3600_000).toISOString(), new Date(closeMs + 72 * 3600_000).toISOString(),
    new Date(closeMs + 96 * 3600_000).toISOString(),
    'Open to everyone. No eligibility restrictions.',
    // min_team_size, max_team_size, allow_solo, allow_team_invites, participation_fee
    1, 4, 1, 1, '',
    // max_participants, require_approval, require_repo, require_demo, require_video,
    // require_screenshots
    0, 0, 0, 0, 0, 0,
    JSON.stringify([
      'A working build, not a concept deck',
      'A repository the judges can read',
      'A team of one to four people',
    ]),
    // code_of_conduct, rules
    '',
    'Judges score three criteria: functionality, technical quality and originality. A judge who scores every project identically contributes nothing to the spread, and Hackerly says so rather than inventing a correction.',
    // show_projects, allow_public_voting, allow_comments
    1, 0, 0,
    now(), now(),
  );

  // tracks
  (f.tracks || []).forEach((t, i) => {
    database.prepare(`
      INSERT INTO tracks (id, event_id, slug, name, description, brief, colour, position)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(t.id, eventId, slugify(t.name, `track-${i + 1}`), t.name,
      TRACK_BLURB[t.name] || '', '', trackColour(i), i);
  });

  // rubric
  const RUBRIC = [
    ['functionality', 'Functionality', 'Does the core path work end to end, or only in the demo script?', 1.2, 5],
    ['quality', 'Technical quality', 'Is the engineering sound, and would you be happy to maintain this?', 1.0, 5],
    ['innovation', 'Originality', 'Is this a new idea, or a good execution of a familiar one?', 0.8, 5],
  ];
  for (const [i, [key, name, description, weight, max]] of RUBRIC.entries()) {
    database.prepare(`
      INSERT INTO rubric_criteria (id, event_id, field_key, name, description, weight, max_score, position)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(`${eventId}_${key}`, eventId, key, name, description, weight, max, i);
  }

  // judges — emails are stored, never rendered on a public page
  for (const j of (f.judges || [])) {
    database.prepare(`
      INSERT INTO judges (id, event_id, name, email_key, headline, organisation, state, access_code_hash, access_code_salt, invited_at, verified_at)
      VALUES (?,?,?,?,?,?, 'verified', '', '', ?, ?)
    `).run(j.id, eventId, j.name, String(j.email || '').toLowerCase(),
      'Judging panel', 'Reference fixtures', j.invited_at || now(), j.verified_at || now());
    for (const trackId of j.tracks || []) {
      database.prepare('INSERT OR IGNORE INTO judge_tracks (judge_id, track_id) VALUES (?,?)').run(j.id, trackId);
    }
  }

  // teams and their members. Fixture team names are not unique, so slugs are
  // de-duplicated against a running set rather than trusted as-is.
  const takenTeamSlugs = new Set();
  for (const t of (f.teams || [])) {
    const teamId = t.id;
    database.prepare(`
      INSERT INTO teams (id, event_id, slug, name, tagline, invite_code, is_final, created_at, updated_at)
      VALUES (?,?,?,?,?,?,1,?,?)
    `).run(teamId, eventId, uniqueSlug(takenTeamSlugs, t.name, `team-${teamId}`), t.name,
      `Entered the ${f.event.name} ${(t.members || []).length > 2 ? 'open' : 'open'} track.`,
      `FIXTURE-${String(t.id).toUpperCase()}`, now(), now());

    (t.members || []).forEach((email, i) => {
      const key = String(email).toLowerCase();
      let user = database.prepare('SELECT id FROM users WHERE email_key = ?').get(key);
      if (!user) {
        const userId = id('usr');
        const display = displayNameFor(key);
        database.prepare(`
          INSERT INTO users (id, email, email_key, name, headline, organisation, avatar_hue, auth_provider, created_at)
          VALUES (?,?,?,?,?,?,?, 'password', ?)
        `).run(userId, key, key, display, '', '', hashInt(key, 360), now());
        user = { id: userId };
      }
      database.prepare(`
        INSERT OR IGNORE INTO team_members (team_id, user_id, role, joined_at) VALUES (?,?,?,?)
      `).run(teamId, user.id, i === 0 ? 'lead' : 'member', now());
      database.prepare(`
        INSERT OR IGNORE INTO event_roles (id, event_id, user_id, role, created_at) VALUES (?,?,?,'participant',?)
      `).run(id('rol'), eventId, user.id, now());
      database.prepare(`
        INSERT OR IGNORE INTO registrations (id, event_id, user_id, state, registered_at)
        VALUES (?,?,?, 'confirmed', ?)
      `).run(id('reg'), eventId, user.id, now());
    });
  }

  // projects
  const seenTeam = new Set();
  const takenProjectSlugs = new Set();
  let duplicateCount = 0;
  for (const p of (f.projects || [])) {
    const projectId = p.id;
    if (seenTeam.has(p.team)) duplicateCount += 1; // the fixture's duplicate submission, kept on purpose
    seenTeam.add(p.team);

    const track = (f.tracks || []).find((t) => t.id === p.track);
    const stack = STACKS[hashInt(projectId, STACKS.length)];
    const tagline = TAGLINES[projectId] || `Entered in ${track ? track.name : 'the open track'}.`;
    const description = DESCRIPTIONS[projectId]
      || `${tagline}\n\n**Team:** ${(f.teams.find((t) => t.id === p.team) || {}).name || p.team}. **Track:** ${track ? track.name : 'open'}.\n\nSubmitted from the shared acceptance fixtures. The fixtures supply a name, a summary, a repository link and a submission time; everything a judge would normally read beyond that is presentation copy added by this portal so the gallery is legible. Judged values are untouched.`;

    database.prepare(`
      INSERT INTO projects (id, event_id, team_id, track_id, slug, name, tagline, description,
        tech_stack, repo_url, demo_url, video_url, cover_hue, screenshots, answers, status,
        is_public, submitted_at, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,'','',?, '[]','{}', 'submitted', 1, ?,?,?)
    `).run(projectId, eventId, p.team, p.track, uniqueSlug(takenProjectSlugs, p.title, `project-${projectId}`),
      p.title, tagline, description, JSON.stringify(stack), p.repo_url || '',
      hashInt(projectId, 360), p.submitted_at, p.submitted_at, p.submitted_at);

    database.prepare(`
      INSERT INTO project_submissions (id, project_id, event_id, version, snapshot, submitted_at)
      VALUES (?,?,?,1,?,?)
    `).run(id('sub'), projectId, eventId, JSON.stringify({ name: p.title, tagline, repo: p.repo_url || '' }), p.submitted_at);

    // assign every project to three judges whose track matches, else any
    assignFixtures(database, eventId, projectId, f);
  }

  // reviews, exactly as given
  for (const s of (f.scores || [])) {
    const judge = (f.judges || []).find((j) => j.id === s.judge);
    if (!judge) continue;
    const reviewId = id('rev');
    const scoreMap = {};
    for (const [key, value] of Object.entries(s.criteria || {})) {
      const criterionId = `${eventId}_${key}`;
      if (database.prepare('SELECT id FROM rubric_criteria WHERE id = ?').get(criterionId)) {
        scoreMap[criterionId] = Number(value);
      }
    }
    const criteria = judging.criteriaFor(eventId);
    const total = judging.weightedTotal(scoreMap, criteria);
    const submittedAt = s.submitted_at || new Date(closeMs).toISOString();
    const hasComment = Boolean(s.comment && String(s.comment).trim());

    database.prepare(`
      INSERT INTO reviews (id, event_id, project_id, judge_id, state, summary, strengths, improvements,
        concerns, recommend, total_score, submitted_at, updated_at)
      VALUES (?,?,?,?,?,?,'','','','',?,?,?)
    `).run(reviewId, eventId, s.project, s.judge, hasComment ? 'submitted' : 'draft',
      String(s.comment || ''), total, submittedAt, submittedAt);

    for (const [criterionId, value] of Object.entries(scoreMap)) {
      database.prepare('INSERT OR REPLACE INTO review_scores (review_id, criterion_id, score, note) VALUES (?,?,?,?)')
        .run(reviewId, criterionId, value, '');
    }

    const assignment = database.prepare(`
      SELECT id FROM judge_assignments WHERE judge_id = ? AND project_id = ?
    `).get(s.judge, s.project);
    if (assignment) {
      database.prepare("UPDATE judge_assignments SET state = 'completed', completed_at = ? WHERE id = ?")
        .run(submittedAt, assignment.id);
    }
  }

  // make sure a few assigned projects have no review at all, as the fixtures intend
  const orphans = database.prepare(`
    SELECT a.id FROM judge_assignments a
    WHERE a.event_id = ? AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.judge_id = a.judge_id AND r.project_id = a.project_id)
    LIMIT 6
  `).all(eventId);
  for (const o of orphans) {
    database.prepare("UPDATE judge_assignments SET state = 'assigned' WHERE id = ?").run(o.id);
  }

  // Results. This event finished in the past, so it is genuinely released —
  // publishing them is a statement about the fixture, not about a live event.
  database.prepare('UPDATE events SET results_released = 1 WHERE id = ?').run(eventId);
  const standings = judging.standings(eventId);
  for (const s of standings) {
    database.prepare(`
      INSERT INTO results (id, event_id, project_id, rank, track_rank, weighted_score, normalised_score,
        public_votes, award, published, published_at, computed_at)
      VALUES (?,?,?,?,?,?,?,0,?,1,?,?)
    `).run(id('res'), eventId, s.id, s.rank, s.track_rank, s.weighted, s.normalised,
      s.rank === 1 ? 'Overall winner' : (s.rank === 2 ? 'Second place' : (s.rank === 3 ? 'Third place' : '')),
      new Date(closeMs + 96 * 3600_000).toISOString(), now());
  }

  return { eventId, projects: (f.projects || []).length, duplicateCount };
}

function assignFixtures(database, eventId, projectId, f) {
  const project = f.projects.find((p) => p.id === projectId);
  if (!project) return;
  const pool = (f.judges || []).filter((j) => (j.tracks || []).includes(project.track));
  const chosen = (pool.length >= 3 ? pool : (f.judges || []).slice(0, 3)).slice(0, 3);
  for (const j of chosen) {
    database.prepare(`
      INSERT OR IGNORE INTO judge_assignments (id, event_id, judge_id, project_id, state, assigned_at)
      VALUES (?,?,?,?, 'assigned', ?)
    `).run(id('asg'), eventId, j.id, projectId, now());
  }
}

function displayNameFor(emailKey) {
  const local = emailKey.split('@')[0];
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'Participant';
}

module.exports = { seedFixtures, loadFixtures, TAGLINES, FIXTURE_PATH };
