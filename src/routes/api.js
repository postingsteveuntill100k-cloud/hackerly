'use strict';

const express = require('express');
const { db } = require('../db');
const authz = require('../lib/authz');
const audit = require('../lib/audit');
const lifecycle = require('../lib/lifecycle');
const queries = require('../lib/queries');
const judging = require('../lib/judging');
const v = require('../lib/validate');
const { json } = require('../lib/html');
const { id, now } = require('../lib/ids');

const router = express.Router();

/* --------------------------------------------------------------- identity */

router.get('/api/me', (req, res) => {
  if (!req.user) return res.status(401).json({ user: null });
  res.json({
    user: req.actor.user,
    roles: req.actor.eventId ? authz.rolesIn(req.user.id, req.actor.eventId) : [],
  });
});

/* -------------------------------------------------------------- discovery */

router.get('/api/events', (req, res) => {
  const events = queries.listEvents({
    search: String(req.query.q || '').slice(0, 60),
    format: String(req.query.format || ''),
    limit: Math.min(50, Number(req.query.limit) || 20),
  });
  res.json({
    events: events.map((e) => ({
      id: e.id, slug: e.slug, name: e.name, tagline: e.tagline,
      status: lifecycle.phase(e), format: e.format, topics: e.topics,
      startsAt: e.startsAt, endsAt: e.endsAt, stats: e.stats,
    })),
  });
});

router.get('/api/events/:slug', (req, res, next) => {
  try {
    const event = authz.requireEvent(req.params.slug, req.actor);
    res.json({
      event: queries.publicEventColumns(event),
      stats: queries.eventStats(event.id),
      tracks: queries.tracksFor(event.id),
      // Results are only included when they have actually been released.
      results: authz.resultsArePublic(event) ? queries.publishedResults(event.id) : null,
    });
  } catch (err) { next(err); }
});

/* ------------------------------------------------- the acceptance surface */

/**
 * A judge's own reviews.
 *
 * `?judge=` may name a peer. That is answered 403, not filtered: a judge has
 * no legitimate reason to ask for another judge's numbers, and a filter would
 * return a 200 that leaks the fact that the peer exists.
 */
router.get('/api/judge/scores', (req, res, next) => {
  try {
    const user = authz.requireUser(req.actor);
    const event = authz.findEvent(String(req.query.event || '')) || firstJudgeableEvent(user.id);
    if (!event) throw new authz.HttpError(404, 'You are not a judge on any hackathon here.');

    const judge = authz.requireJudge(event, req.actor);
    const requested = req.query.judge;
    if (requested !== undefined && String(requested) !== judge.id) {
      audit.record({
        actor: req.actor, eventId: event.id, action: 'judge.peerscores',
        resourceType: 'judge', resourceId: String(requested), outcome: 'denied',
      });
      throw new authz.HttpError(403, 'You can only read your own scores.');
    }

    const criteria = judging.criteriaFor(event.id);
    const rows = db().prepare(`
      SELECT r.*, p.name AS project_name, p.slug AS project_slug FROM reviews r
      JOIN projects p ON p.id = r.project_id
      WHERE r.judge_id = ? AND r.event_id = ? ORDER BY p.name
    `).all(judge.id, event.id);

    res.json({
      judge: { id: judge.id, name: judge.name },
      event: { id: event.id, slug: event.slug, name: event.name },
      criteria: criteria.map((c) => ({ id: c.id, name: c.name, weight: c.weight, max: c.max_score })),
      reviews: rows.map((r) => {
        const scores = {};
        for (const s of db().prepare('SELECT criterion_id, score FROM review_scores WHERE review_id = ?').all(r.id)) {
          scores[s.criterion_id] = s.score;
        }
        return {
          projectId: r.project_id,
          project: r.project_name,
          projectSlug: r.project_slug,
          state: r.state,
          weightedScore: r.total_score,
          normalisedScore: normalisedFor(event.id, r),
          criteria: scores,
          summary: r.summary,
          strengths: r.strengths,
          improvements: r.improvements,
          concerns: r.concerns,
          recommend: r.recommend,
          submittedAt: r.submitted_at,
          updatedAt: r.updated_at,
        };
      }),
    });
  } catch (err) { next(err); }
});

function firstJudgeableEvent(userId) {
  return db().prepare(`
    SELECT e.* FROM events e JOIN judges j ON j.event_id = e.id
    WHERE j.user_id = ? AND j.state = 'verified' ORDER BY e.starts_at DESC LIMIT 1
  `).get(userId) || null;
}

function normalisedFor(eventId, review) {
  const population = db().prepare(`
    SELECT total_score FROM reviews WHERE judge_id = ? AND state = 'submitted'
  `).all(review.judge_id).map((r) => r.total_score);
  const n = judging.normaliseAgainst(review.total_score, population);
  return { value: n.value, method: n.method, note: n.note };
}

/**
 * Organiser CSV export. Requires staff on the event in question. Produces one
 * row per submitted review, with the rubric flattened into columns, plus the
 * judge and project names so the file is usable without a join.
 */
router.get('/api/export.csv', (req, res, next) => {
  try {
    const user = authz.requireUser(req.actor);
    const slug = String(req.query.event || '');
    const event = authz.findEvent(slug);
    if (!event) throw new authz.HttpError(404, 'That hackathon does not exist.');
    authz.requireStaff(event, req.actor);

    const criteria = judging.criteriaFor(event.id);
    const rows = db().prepare(`
      SELECT r.*, j.name AS judge_name, p.name AS project_name, p.slug AS project_slug,
             t.name AS track_name, tm.name AS team_name
      FROM reviews r
      JOIN judges j ON j.id = r.judge_id
      JOIN projects p ON p.id = r.project_id
      JOIN teams tm ON tm.id = p.team_id
      LEFT JOIN tracks t ON t.id = p.track_id
      WHERE r.event_id = ? AND r.state = 'submitted'
      ORDER BY p.name, j.name
    `).all(event.id);

    const header = [
      'event', 'project', 'project_slug', 'team', 'track', 'judge', 'state',
      ...criteria.map((c) => c.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')),
      'weighted_score', 'normalised_score', 'recommend', 'summary', 'strengths',
      'improvements', 'concerns', 'submitted_at',
    ];

    const lines = [header.map(csvCell).join(',')];
    for (const r of rows) {
      const scores = {};
      for (const s of db().prepare('SELECT criterion_id, score FROM review_scores WHERE review_id = ?').all(r.id)) {
        scores[s.criterion_id] = s.score;
      }
      const n = judging.normaliseAgainst(r.total_score,
        db().prepare("SELECT total_score FROM reviews WHERE judge_id = ? AND state = 'submitted'").all(r.judge_id).map((x) => x.total_score));
      lines.push([
        event.name, r.project_name, r.project_slug, r.team_name, r.track_name || '',
        r.judge_name, r.state,
        ...criteria.map((c) => (scores[c.id] === undefined ? '' : scores[c.id])),
        r.total_score, n.value, r.recommend, r.summary, r.strengths, r.improvements, r.concerns, r.submitted_at,
      ].map(csvCell).join(','));
    }

    // A project-level summary block would break a naive CSV reader, so the
    // export stays one row per review and the standings are a separate export.
    audit.record({ actor: req.actor, eventId: event.id, action: 'export.csv', resourceType: 'event', resourceId: event.id, detail: `${rows.length} rows` });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${event.slug}-reviews.csv"`);
    res.send(`﻿${lines.join('\n')}`);
  } catch (err) { next(err); }
});

/** Standings as CSV — the same numbers shown on the results page. */
router.get('/api/export/standings.csv', (req, res, next) => {
  try {
    const user = authz.requireUser(req.actor);
    const event = authz.findEvent(String(req.query.event || ''));
    if (!event) throw new authz.HttpError(404, 'That hackathon does not exist.');
    authz.requireStaff(event, req.actor);

    const standings = judging.standings(event.id);
    const header = ['rank', 'track_rank', 'project', 'track', 'reviews', 'weighted', 'normalised', 'final', 'method'];
    const lines = [header.join(',')];
    for (const s of standings) {
      lines.push([s.rank, s.track_rank, s.name, s.trackName || '', s.submitted, s.weighted, s.normalised, s.final, s.method]
        .map(csvCell).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${event.slug}-standings.csv"`);
    res.send(`﻿${lines.join('\n')}`);
  } catch (err) { next(err); }
});

/**
 * CSV cells are quoted and internal quotes doubled, and a leading =, +, -
 * or @ is prefixed with a quote so a spreadsheet cannot execute a formula
 * that came from user text.
 */
function csvCell(value) {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/* -------------------------------------------------------- judge read API */

router.get('/api/judge/assignments', (req, res, next) => {
  try {
    const user = authz.requireUser(req.actor);
    const event = authz.requireEvent(String(req.query.event || ''), req.actor);
    const judge = authz.requireJudge(event, req.actor);
    res.json({ judge: { id: judge.id, name: judge.name }, ...queries.assignmentSummary(judge.id) });
  } catch (err) { next(err); }
});

router.get('/api/judge/projects/:projectId', (req, res, next) => {
  try {
    const user = authz.requireUser(req.actor);
    const event = authz.requireEvent(String(req.query.event || ''), req.actor);
    const judge = authz.requireJudge(event, req.actor);
    const { project } = authz.requireAssignment(event, req.params.projectId, req.actor);
    res.json({
      project: queries.projectDetail(project, { forJudges: true }),
      criteria: judging.criteriaFor(event.id),
      review: queries.reviewFor(judge.id, project.id),
    });
  } catch (err) { next(err); }
});

/* ----------------------------------------------------- organiser read API */

router.get('/api/organizer/overview', (req, res, next) => {
  try {
    const user = authz.requireUser(req.actor);
    const event = authz.requireEvent(String(req.query.event || ''), req.actor);
    authz.requireStaff(event, req.actor);
    res.json({
      event: queries.publicEventColumns(event),
      phase: lifecycle.phase(event),
      stats: queries.eventStats(event.id),
      snapshot: queries.organiserSnapshot(event.id),
      resultsReleased: authz.resultsArePublic(event),
    });
  } catch (err) { next(err); }
});

router.get('/api/organizer/projects', (req, res, next) => {
  try {
    const user = authz.requireUser(req.actor);
    const event = authz.requireEvent(String(req.query.event || ''), req.actor);
    authz.requireStaff(event, req.actor);
    const projects = queries.projectsForEvent(event.id, { publicOnly: false });
    res.json({
      projects: projects.map((p) => ({
        ...p,
        reviews: db().prepare("SELECT COUNT(*) AS n FROM reviews WHERE project_id = ? AND state = 'submitted'").get(p.id).n,
        score: judging.scoreProject(event.id, p.id),
      })),
    });
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------- showcase API */

router.get('/api/projects', (req, res) => {
  res.json({
    projects: queries.showcase({
      search: String(req.query.q || '').slice(0, 60),
      track: String(req.query.track || '').slice(0, 60),
      tech: String(req.query.tech || '').slice(0, 40),
      limit: Math.min(60, Number(req.query.limit) || 24),
    }),
  });
});

/* ------------------------------------------------------------------ tokens */

/**
 * API tokens for automation. The raw value is shown once and never again,
 * and only an organiser of the event can mint one.
 */
router.get('/o/:slug/tokens', (req, res) => {
  const event = req.organiserEvent;
  res.json({
    tokens: db().prepare(`
      SELECT id, label, scopes, created_at, last_used_at, revoked_at FROM api_tokens
      WHERE event_id = ? OR (event_id IS NULL AND user_id = ?)
      ORDER BY created_at DESC
    `).all(event.id, req.user.id).map((t) => ({
      id: t.id, label: t.label, scopes: json(t.scopes, []),
      createdAt: t.created_at, lastUsedAt: t.last_used_at, revokedAt: t.revoked_at,
    })),
  });
});

module.exports = router;
