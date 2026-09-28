'use strict';

/**
 * Read model. Every function here is event-scoped and returns only the fields
 * a given surface is allowed to see. Views never build SQL.
 */

const { db } = require('../db');
const { json } = require('./html');
const judging = require('./judging');
const authz = require('./authz');
const { id, now } = require('./ids');

/* ------------------------------------------------------------------- events */

function publicEventColumns(event) {
  return {
    id: event.id,
    slug: event.slug,
    name: event.name,
    tagline: event.tagline,
    about: event.about,
    coverHue: event.cover_hue,
    organiserName: event.organiser_name,
    format: event.format,
    venue: event.venue,
    city: event.city,
    country: event.country,
    timezone: event.timezone,
    topics: json(event.topics, []),
    visibility: event.visibility,
    status: event.status,
    startsAt: event.starts_at,
    endsAt: event.ends_at,
    registrationOpensAt: event.registration_opens_at,
    registrationClosesAt: event.registration_closes_at,
    submissionsOpenAt: event.submissions_open_at,
    submissionsCloseAt: event.submissions_close_at,
    judgingOpensAt: event.judging_opens_at,
    judgingClosesAt: event.judging_closes_at,
    resultsAt: event.results_at,
    resultsReleased: Boolean(event.results_released),
    eligibility: event.eligibility,
    minTeamSize: event.min_team_size,
    maxTeamSize: event.max_team_size,
    allowSolo: Boolean(event.allow_solo),
    allowTeamInvites: Boolean(event.allow_team_invites),
    participationFee: event.participation_fee,
    maxParticipants: event.max_participants,
    requireApproval: Boolean(event.require_approval),
    requireRepo: Boolean(event.require_repo),
    requireDemo: Boolean(event.require_demo),
    requireVideo: Boolean(event.require_video),
    requireScreenshots: Boolean(event.require_screenshots),
    submissionChecklist: json(event.submission_checklist, []),
    codeOfConduct: event.code_of_conduct,
    rules: event.rules,
    showProjects: Boolean(event.show_projects),
    allowPublicVoting: Boolean(event.allow_public_voting),
    allowComments: Boolean(event.allow_comments),
    createdAt: event.created_at,
    updatedAt: event.updated_at,
  };
}

function eventStats(eventId) {
  const participants = db().prepare(`
    SELECT COUNT(*) AS n FROM registrations WHERE event_id = ? AND state IN ('confirmed','pending')
  `).get(eventId).n;
  const teams = db().prepare('SELECT COUNT(*) AS n FROM teams WHERE event_id = ?').get(eventId).n;
  const projects = db().prepare(`
    SELECT COUNT(*) AS n FROM projects WHERE event_id = ? AND status = 'submitted'
  `).get(eventId).n;
  const judges = db().prepare(`
    SELECT COUNT(*) AS n FROM judges WHERE event_id = ? AND state = 'verified'
  `).get(eventId).n;
  const countries = db().prepare(`
    SELECT COUNT(DISTINCT u.email_key) AS n
    FROM registrations r JOIN users u ON u.id = r.user_id
    WHERE r.event_id = ? AND r.state = 'confirmed'
  `).get(eventId).n;
  return { participants, teams, projects, judges, registrations: countries };
}

/**
 * Discovery listing. Public + published events only, unless asked otherwise.
 */
function listEvents({ search = '', topic = '', format = '', state = '', limit = 60, includePrivate = false } = {}) {
  const where = [];
  const params = [];
  if (!includePrivate) {
    where.push("visibility = 'public'");
    where.push("status != 'draft'");
  }
  if (search) {
    where.push('(lower(name) LIKE ? OR lower(tagline) LIKE ? OR lower(city) LIKE ? OR lower(country) LIKE ?)');
    const q = `%${search.toLowerCase()}%`;
    params.push(q, q, q, q);
  }
  if (format) { where.push('format = ?'); params.push(format); }
  const nowIso = new Date().toISOString();
  if (state === 'upcoming') { where.push('starts_at > ?'); params.push(nowIso); }
  if (state === 'live') { where.push('starts_at <= ? AND submissions_close_at > ?'); params.push(nowIso, nowIso); }
  if (state === 'past') { where.push('ends_at < ?'); params.push(nowIso); }

  const sql = `
    SELECT * FROM events
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY (status = 'archived') ASC, starts_at ASC
    LIMIT ?
  `;
  let rows = db().prepare(sql).all(...params, limit);
  if (topic) rows = rows.filter((e) => json(e.topics, []).includes(topic));

  return rows.map((e) => ({ ...publicEventColumns(e), stats: eventStats(e.id) }));
}

function eventTopics() {
  const counts = new Map();
  for (const e of db().prepare("SELECT topics FROM events WHERE visibility = 'public' AND status != 'draft'").all()) {
    for (const t of json(e.topics, [])) counts.set(t, (counts.get(t) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, n }));
}

function tracksFor(eventId) {
  return db().prepare(`
    SELECT t.*, (SELECT COUNT(*) FROM projects p WHERE p.track_id = t.id AND p.status = 'submitted') AS project_count
    FROM tracks t WHERE t.event_id = ? ORDER BY t.position, t.name
  `).all(eventId).map(trackView);
}

function trackView(t) {
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    description: t.description,
    brief: t.brief,
    sponsor: t.sponsor,
    colour: t.colour,
    projectCount: t.project_count ?? 0,
  };
}

function scheduleFor(eventId) {
  return db().prepare(
    'SELECT * FROM schedule_items WHERE event_id = ? ORDER BY starts_at, position',
  ).all(eventId).map((s) => ({
    id: s.id, title: s.title, description: s.description,
    kind: s.kind, location: s.location, startsAt: s.starts_at, endsAt: s.ends_at,
  }));
}

function announcementsFor(eventId, limit = 20) {
  return db().prepare(`
    SELECT a.*, u.name AS author_name FROM announcements a
    LEFT JOIN users u ON u.id = a.author_id
    WHERE a.event_id = ? ORDER BY a.pinned DESC, a.created_at DESC LIMIT ?
  `).all(eventId, limit).map((a) => ({
    id: a.id, title: a.title, body: a.body, kind: a.kind,
    pinned: Boolean(a.pinned), author: a.author_name || 'Organising team', createdAt: a.created_at,
  }));
}

function prizesFor(eventId) {
  return db().prepare(`
    SELECT p.*, t.name AS track_name FROM prizes p
    LEFT JOIN tracks t ON t.id = p.track_id
    WHERE p.event_id = ? ORDER BY p.position, p.name
  `).all(eventId).map((p) => ({
    id: p.id, name: p.name, description: p.description, placeLabel: p.place_label,
    value: p.value, sponsor: p.sponsor, trackName: p.track_name,
  }));
}

function faqsFor(eventId) {
  return db().prepare(
    'SELECT * FROM faqs WHERE event_id = ? ORDER BY position',
  ).all(eventId).map((f) => ({ id: f.id, question: f.question, answer: f.answer }));
}

function submissionFieldsFor(eventId) {
  return db().prepare(
    'SELECT * FROM submission_fields WHERE event_id = ? ORDER BY position',
  ).all(eventId).map((f) => ({
    id: f.id, key: f.field_key, label: f.label, help: f.help, kind: f.kind,
    options: json(f.options, []), required: Boolean(f.required),
    judgesSee: Boolean(f.judges_see), position: f.position,
  }));
}

/* ------------------------------------------------------------------- people */

function peopleForEvent(eventId, limit = 200) {
  const people = db().prepare(`
    SELECT u.id, u.name, u.headline, u.organisation, u.avatar_hue
    FROM registrations r JOIN users u ON u.id = r.user_id
    WHERE r.event_id = ? AND r.state IN ('confirmed','pending')
    ORDER BY u.name LIMIT ?
  `).all(eventId, limit);
  return people.map((p) => ({
    id: p.id, name: p.name, headline: p.headline, organisation: p.organisation, hue: p.avatar_hue,
  }));
}

function judgesForEvent(eventId) {
  return db().prepare(`
    SELECT * FROM judges WHERE event_id = ? AND state IN ('verified','invited') ORDER BY state, name
  `).all(eventId).map((j) => ({
    id: j.id,
    name: j.name,
    headline: j.headline,
    organisation: j.organisation,
    bio: j.bio,
    state: j.state,
    // Email is deliberately not exposed on public surfaces.
    trackNames: db().prepare(`
      SELECT t.name FROM judge_tracks jt JOIN tracks t ON t.id = jt.track_id WHERE jt.judge_id = ?
    `).all(j.id).map((r) => r.name),
  }));
}

function staffForEvent(eventId) {
  return db().prepare(`
    SELECT u.id, u.name, u.headline, u.organisation, u.avatar_hue, er.role
    FROM event_roles er JOIN users u ON u.id = er.user_id
    WHERE er.event_id = ? AND er.role IN ('organiser','coordinator')
    ORDER BY er.role, u.name
  `).all(eventId).map((p) => ({ ...p, hue: p.avatar_hue }));
}

/* -------------------------------------------------------------------- teams */

function teamsForEvent(eventId) {
  return db().prepare(`
    SELECT t.*, (SELECT COUNT(*) FROM team_members m WHERE m.team_id = t.id) AS member_count,
           (SELECT COUNT(*) FROM projects p WHERE p.team_id = t.id) AS project_count
    FROM teams t WHERE t.event_id = ? ORDER BY t.name
  `).all(eventId).map(teamView);
}

function teamView(t) {
  return {
    id: t.id, slug: t.slug, name: t.name, tagline: t.tagline,
    isFinal: Boolean(t.is_final),
    memberCount: t.member_count ?? 0,
    projectCount: t.project_count ?? 0,
  };
}

function teamDetail(teamId) {
  const team = db().prepare('SELECT * FROM teams WHERE id = ?').get(teamId);
  if (!team) return null;
  const members = db().prepare(`
    SELECT u.id, u.name, u.headline, u.avatar_hue, m.role, m.joined_at
    FROM team_members m JOIN users u ON u.id = m.user_id
    WHERE m.team_id = ? ORDER BY m.role = 'lead' DESC, m.joined_at
  `).all(teamId).map((m) => ({
    userId: m.id, name: m.name, headline: m.headline, hue: m.avatar_hue,
    role: m.role, joinedAt: m.joined_at,
  }));
  const projects = db().prepare(
    'SELECT * FROM projects WHERE team_id = ? ORDER BY created_at',
  ).all(teamId);
  return {
    id: team.id, slug: team.slug, name: team.name, tagline: team.tagline,
    inviteCode: team.invite_code, isFinal: Boolean(team.is_final),
    members, projects: projects.map((p) => projectCard(p, { internal: true })),
    createdAt: team.created_at,
  };
}

/* ------------------------------------------------------------------ projects */

function projectCard(p, opts = {}) {
  const internal = Boolean(opts.internal);
  const team = db().prepare('SELECT name, slug FROM teams WHERE id = ?').get(p.team_id);
  const track = p.track_id
    ? db().prepare('SELECT name, colour, slug FROM tracks WHERE id = ?').get(p.track_id)
    : null;
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    tagline: p.tagline,
    status: p.status,
    isPublic: Boolean(p.is_public),
    coverHue: p.cover_hue,
    techStack: json(p.tech_stack, []),
    teamName: team ? team.name : 'Unknown team',
    teamSlug: team ? team.slug : '',
    trackName: track ? track.name : '',
    trackColour: track ? track.colour : 'ink',
    eventId: p.event_id,
    submittedAt: p.submitted_at,
    updatedAt: p.updated_at,
    privateOnly: Boolean(internal),
  };
}

function projectsForEvent(eventId, { publicOnly = true, trackId = null, search = '' } = {}) {
  const where = ['p.event_id = ?'];
  const params = [eventId];
  if (publicOnly) {
    where.push("p.status = 'submitted'");
    where.push('p.is_public = 1');
  }
  if (trackId) { where.push('p.track_id = ?'); params.push(trackId); }
  if (search) {
    where.push('(lower(p.name) LIKE ? OR lower(p.tagline) LIKE ?)');
    const q = `%${search.toLowerCase()}%`;
    params.push(q, q);
  }
  return db().prepare(`
    SELECT p.* FROM projects p WHERE ${where.join(' AND ')}
    ORDER BY p.submitted_at DESC, p.name
  `).all(...params).map((p) => projectCard(p, { internal: !publicOnly }));
}

/** The full judging / showcase detail for one project. */
function projectDetail(project, { forJudges = false } = {}) {
  const team = db().prepare('SELECT * FROM teams WHERE id = ?').get(project.team_id);
  const track = project.track_id
    ? db().prepare('SELECT * FROM tracks WHERE id = ?').get(project.track_id)
    : null;
  const members = team ? db().prepare(`
    SELECT u.name, u.headline, u.avatar_hue, m.role FROM team_members m
    JOIN users u ON u.id = m.user_id WHERE m.team_id = ? ORDER BY m.role = 'lead' DESC, m.joined_at
  `).all(team.id).map((m) => ({ name: m.name, headline: m.headline, hue: m.avatar_hue, role: m.role })) : [];

  const fields = submissionFieldsFor(project.event_id);
  const answers = json(project.answers, {});
  const answersView = fields
    .filter((f) => (forJudges ? f.judgesSee : true) && answers[f.key])
    .map((f) => ({ key: f.key, label: f.label, value: answers[f.key] }));

  const votes = db().prepare('SELECT COUNT(*) AS n FROM votes WHERE project_id = ?').get(project.id).n;

  return {
    id: project.id,
    slug: project.slug,
    name: project.name,
    tagline: project.tagline,
    description: project.description,
    techStack: json(project.tech_stack, []),
    repoUrl: project.repo_url,
    demoUrl: project.demo_url,
    videoUrl: project.video_url,
    videoKind: project.video_kind,
    coverHue: project.cover_hue,
    screenshots: json(project.screenshots, []),
    status: project.status,
    isPublic: Boolean(project.is_public),
    eventId: project.event_id,
    submittedAt: project.submitted_at,
    updatedAt: project.updated_at,
    team: team ? { id: team.id, slug: team.slug, name: team.name, members } : null,
    track: track ? trackView(track) : null,
    answers: answersView,
    votes,
    withdrawnReason: project.withdrawn_reason,
  };
}

function projectBySlug(eventId, slug) {
  return db().prepare('SELECT * FROM projects WHERE event_id = ? AND slug = ?').get(eventId, String(slug)) || null;
}

/** Public showcase across every visible event. */
function showcase({ search = '', track = '', tech = '', limit = 60, awardedOnly = false } = {}) {
  const rows = db().prepare(`
    SELECT p.*, e.name AS event_name, e.slug AS event_slug, e.country, e.ends_at
    FROM projects p JOIN events e ON e.id = p.event_id
    WHERE p.status = 'submitted' AND p.is_public = 1
      AND e.visibility = 'public' AND e.status != 'draft'
    ORDER BY COALESCE(p.submitted_at, p.created_at) DESC
  `).all();

  let results = rows.map((p) => {
    const award = db().prepare(`
      SELECT award, rank, track_rank FROM results
      WHERE project_id = ? AND published = 1
    `).get(p.id);
    return {
      ...projectCard(p),
      eventName: p.event_name,
      eventSlug: p.event_slug,
      country: p.country,
      award: award ? award.award : '',
      rank: award ? award.rank : 0,
    };
  });

  if (search) {
    const q = search.toLowerCase();
    results = results.filter((p) => [p.name, p.tagline, p.teamName, p.eventName, p.techStack.join(' ')]
      .join(' ').toLowerCase().includes(q));
  }
  if (track) results = results.filter((p) => p.trackName === track);
  if (tech) results = results.filter((p) => p.techStack.includes(tech));
  if (awardedOnly) results = results.filter((p) => p.award);
  return results.slice(0, limit);
}

function showcaseFacets() {
  const tech = new Map();
  const tracks = new Map();
  const publicProjects = db().prepare(`
    SELECT tech_stack, track_id FROM projects p JOIN events e ON e.id = p.event_id
    WHERE p.status = 'submitted' AND p.is_public = 1 AND e.visibility = 'public'
  `).all();
  for (const p of publicProjects) {
    for (const t of json(p.tech_stack, [])) tech.set(t, (tech.get(t) || 0) + 1);
  }
  for (const t of db().prepare(`
    SELECT t.name, COUNT(p.id) AS n FROM tracks t
    JOIN events e ON e.id = t.event_id
    LEFT JOIN projects p ON p.track_id = t.id AND p.status = 'submitted' AND p.is_public = 1
    WHERE e.visibility = 'public' AND e.status != 'draft'
    GROUP BY t.name HAVING n > 0 ORDER BY n DESC
  `).all()) tracks.set(t.name, t.n);
  return {
    tech: [...tech.entries()].sort((a, b) => b[1] - a[1]).slice(0, 24).map(([name, n]) => ({ name, n })),
    tracks: [...tracks.entries()].map(([name, n]) => ({ name, n })),
  };
}

/* ------------------------------------------------------------------ results */

function publishedResults(eventId) {
  return db().prepare(`
    SELECT r.*, p.name AS project_name, p.slug AS project_slug, p.tagline, p.cover_hue,
           p.tech_stack, t.name AS track_name, t.colour AS track_colour, tm.name AS team_name
    FROM results r
    JOIN projects p ON p.id = r.project_id
    JOIN teams tm ON tm.id = p.team_id
    LEFT JOIN tracks t ON t.id = p.track_id
    WHERE r.event_id = ? AND r.published = 1
    ORDER BY r.rank ASC, r.normalised_score DESC
  `).all(eventId).map((r) => ({
    rank: r.rank,
    trackRank: r.track_rank,
    projectId: r.project_id,
    name: r.project_name,
    slug: r.project_slug,
    tagline: r.tagline,
    coverHue: r.cover_hue,
    techStack: json(r.tech_stack, []),
    trackName: r.track_name,
    trackColour: r.track_colour,
    teamName: r.team_name,
    award: r.award,
    headline: r.headline,
    weightedScore: r.weighted_score,
    normalisedScore: r.normalised_score,
    publicVotes: r.public_votes,
  }));
}

/* ------------------------------------------------------------------ reviews */

function reviewFor(judgeId, projectId) {
  const review = db().prepare(`
    SELECT * FROM reviews WHERE judge_id = ? AND project_id = ?
  `).get(judgeId, projectId);
  if (!review) return null;
  const scores = {};
  const notes = {};
  for (const s of db().prepare('SELECT criterion_id, score, note FROM review_scores WHERE review_id = ?')
    .all(review.id)) {
    scores[s.criterion_id] = s.score;
    notes[s.criterion_id] = s.note;
  }
  return {
    id: review.id,
    state: review.state,
    summary: review.summary,
    strengths: review.strengths,
    improvements: review.improvements,
    concerns: review.concerns,
    recommend: review.recommend,
    totalScore: review.total_score,
    scores,
    notes,
    submittedAt: review.submitted_at,
    updatedAt: review.updated_at,
  };
}

function saveReview({ eventId, projectId, judgeId, scores, notes = {}, prose = {}, state = 'draft' }) {
  const criteria = judging.criteriaFor(eventId);
  const existing = db().prepare('SELECT * FROM reviews WHERE judge_id = ? AND project_id = ?')
    .get(judgeId, projectId);

  const reviewId = existing ? existing.id : id('rev');
  const scoreMap = {};
  for (const c of criteria) {
    const value = Number(scores[c.id]);
    if (Number.isFinite(value)) scoreMap[c.id] = Math.min(c.max_score, Math.max(0, value));
  }
  const answered = Object.keys(scoreMap);
  const total = judging.weightedTotal(scoreMap, criteria);
  const complete = answered.length === criteria.length
    && criteria.every((c) => String(prose.summary || '').trim().length > 0);

  const nextState = state === 'submitted' && complete ? 'submitted' : 'draft';
  const timestamp = now();

  if (existing) {
    db().prepare(`
      UPDATE reviews SET summary = ?, strengths = ?, improvements = ?, concerns = ?,
             recommend = ?, total_score = ?, state = ?, submitted_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      prose.summary || existing.summary,
      prose.strengths ?? existing.strengths,
      prose.improvements ?? existing.improvements,
      prose.concerns ?? existing.concerns,
      prose.recommend ?? existing.recommend,
      total, nextState,
      nextState === 'submitted' ? (existing.submitted_at || timestamp) : existing.submitted_at,
      timestamp, reviewId,
    );
    db().prepare('DELETE FROM review_scores WHERE review_id = ?').run(reviewId);
  } else {
    db().prepare(`
      INSERT INTO reviews (id, event_id, project_id, judge_id, state, summary, strengths,
                           improvements, concerns, recommend, total_score, submitted_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(reviewId, eventId, projectId, judgeId, nextState,
      prose.summary || '', prose.strengths || '', prose.improvements || '',
      prose.concerns || '', prose.recommend || '', total,
      nextState === 'submitted' ? timestamp : null, timestamp);
  }

  const insert = db().prepare(
    'INSERT INTO review_scores (review_id, criterion_id, score, note) VALUES (?, ?, ?, ?)',
  );
  for (const criterionId of answered) {
    insert.run(reviewId, criterionId, scoreMap[criterionId], String(notes[criterionId] || '').slice(0, 600));
  }

  return { reviewId, total, state: nextState, complete, answered: answered.length, total_criteria: criteria.length };
}

/* -------------------------------------------------------------- assignments */

function assignmentSummary(judgeId) {
  const rows = db().prepare(`
    SELECT a.id, a.state, a.project_id, p.name AS project_name, p.slug, p.cover_hue,
           t.name AS track_name, t.colour AS track_colour, r.state AS review_state,
           r.total_score, r.submitted_at
    FROM judge_assignments a
    JOIN projects p ON p.id = a.project_id
    LEFT JOIN tracks t ON t.id = p.track_id
    LEFT JOIN reviews r ON r.judge_id = a.judge_id AND r.project_id = a.project_id
    WHERE a.judge_id = ? AND a.state != 'revoked'
    ORDER BY (r.state = 'submitted') ASC, t.position ASC, p.name ASC
  `).all(judgeId);
  const items = rows.map((r) => ({
    assignmentId: r.id,
    projectId: r.project_id,
    name: r.project_name,
    slug: r.slug,
    coverHue: r.cover_hue,
    trackName: r.track_name,
    trackColour: r.track_colour,
    state: r.review_state === 'submitted' ? 'done' : (r.review_state === 'draft' ? 'in_progress' : 'todo'),
    score: r.total_score,
  }));
  return {
    items,
    total: items.length,
    done: items.filter((i) => i.state === 'done').length,
    inProgress: items.filter((i) => i.state === 'in_progress').length,
    remaining: items.filter((i) => i.state === 'todo').length,
  };
}

/* ------------------------------------------------------------- organiser ops */

function organiserSnapshot(eventId) {
  const stats = eventStats(eventId);
  const reviewStats = db().prepare(`
    SELECT COUNT(*) AS assigned, SUM(CASE WHEN state = 'submitted' THEN 1 ELSE 0 END) AS done
    FROM judge_assignments WHERE event_id = ? AND state != 'revoked'
  `).get(eventId);
  const unread = db().prepare(`
    SELECT COUNT(*) AS n FROM announcements WHERE event_id = ?
  `).get(eventId).n;
  const recent = db().prepare(`
    SELECT a.*, u.name AS actor_name FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
    WHERE a.event_id = ? ORDER BY a.at DESC LIMIT 12
  `).all(eventId);
  const lastResults = db().prepare(`
    SELECT MAX(computed_at) AS at FROM results WHERE event_id = ?
  `).get(eventId);
  return {
    ...stats,
    assigned: reviewStats.assigned || 0,
    reviewsDone: reviewStats.done || 0,
    announcements: unread,
    resultsComputedAt: lastResults ? lastResults.at : null,
    recent: recent.map((r) => ({
      id: r.id, action: r.action, actor: r.actor_name || 'System',
      role: r.actor_role, outcome: r.outcome, at: r.at, resource: r.resource_type,
    })),
  };
}

function judgeProgressFor(eventId) {
  return db().prepare(`
    SELECT j.id, j.name, j.state,
           (SELECT COUNT(*) FROM judge_assignments a WHERE a.judge_id = j.id AND a.state != 'revoked') AS assigned,
           (SELECT COUNT(*) FROM reviews r WHERE r.judge_id = j.id AND r.state = 'submitted') AS submitted,
           (SELECT MAX(r.submitted_at) FROM reviews r WHERE r.judge_id = j.id AND r.state = 'submitted') AS last_at
    FROM judges j WHERE j.event_id = ? ORDER BY submitted ASC, assigned ASC, j.name
  `).all(eventId);
}

function scoreSpread(eventId) {
  const rows = judging.standings(eventId);
  if (!rows.length) return { count: 0, mean: 0, min: 0, max: 0, judges: 0, submitted: 0 };
  const values = rows.map((r) => r.final);
  return {
    count: rows.length,
    mean: judging.round2(judging.mean(values)),
    min: Math.min(...values),
    max: Math.max(...values),
    judges: db().prepare("SELECT COUNT(*) AS n FROM judges WHERE event_id = ? AND state = 'verified'")
      .get(eventId).n,
    submitted: rows.reduce((a, r) => a + r.submitted, 0),
  };
}

module.exports = {
  publicEventColumns,
  eventStats,
  listEvents,
  eventTopics,
  tracksFor,
  trackView,
  scheduleFor,
  announcementsFor,
  prizesFor,
  faqsFor,
  submissionFieldsFor,
  peopleForEvent,
  judgesForEvent,
  staffForEvent,
  teamsForEvent,
  teamView,
  teamDetail,
  projectCard,
  projectsForEvent,
  projectDetail,
  projectBySlug,
  showcase,
  showcaseFacets,
  publishedResults,
  reviewFor,
  saveReview,
  assignmentSummary,
  organiserSnapshot,
  judgeProgressFor,
  scoreSpread,
  authz,
};
