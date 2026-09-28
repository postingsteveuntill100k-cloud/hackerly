'use strict';

const express = require('express');
const { db } = require('../db');
const authz = require('../lib/authz');
const audit = require('../lib/audit');
const lifecycle = require('../lib/lifecycle');
const queries = require('../lib/queries');
const judging = require('../lib/judging');
const views = require('../views/judge');
const v = require('../lib/validate');
const { id, now, hashInt } = require('../lib/ids');

const router = express.Router();

/**
 * Everything under /j requires a verified judge in the named event. This runs
 * before any route handler, so there is no path in this router that can be
 * reached without it.
 */
router.use('/j', (req, res, next) => {
  const m = req.path.match(/^\/([A-Za-z0-9_-]+)/);
  if (!m) return next();
  const event = authz.findEvent(m[1]);
  if (!event) return next(new authz.HttpError(404, 'That hackathon does not exist.'));
  if (!req.user) {
    return res.redirect(`/signin?next=${encodeURIComponent(req.originalUrl)}`);
  }
  req.judgeEvent = event;
  req.judge = authz.requireJudge(event, req.actor); // throws 403
  authz.requireTokenScope(req.actor, event, 'read');
  next();
});

/* ------------------------------------------------------------------ queue */

router.get('/j/:slug', (req, res) => {
  const event = req.judgeEvent;
  const judge = req.judge;
  const summary = queries.assignmentSummary(judge.id);
  const conflicts = db().prepare('SELECT * FROM judge_conflicts WHERE judge_id = ?').all(judge.id).length
    ? db().prepare('SELECT project_id FROM judge_conflicts WHERE judge_id = ?').all(judge.id) : [];

  const gate = { error: null };
  try {
    lifecycle.judgingGate(event);
  } catch (err) {
    gate.error = `${err.message}${err.hint ? ` ${err.hint}` : ''}`;
  }

  res.send(views.judgeHome({
    event: queries.publicEventColumns(event),
    viewer: { user: req.actor.user },
    judge: publicJudge(judge),
    summary,
    conflicts,
    pairwise: db().prepare('SELECT COUNT(*) AS n FROM pairwise_comparisons WHERE judge_id = ?').get(judge.id).n,
    gate,
    spread: queries.scoreSpread(event.id),
  }));
});

router.get('/j/:slug/progress', (req, res) => {
  const event = req.judgeEvent;
  const judge = req.judge;
  res.send(views.judgeProgressPage({
    event: queries.publicEventColumns(event),
    viewer: { user: req.actor.user },
    judge: publicJudge(judge),
    summary: queries.assignmentSummary(judge.id),
    panel: queries.judgeProgressFor(event.id),
    spread: queries.scoreSpread(event.id),
    myReviews: db().prepare(`
      SELECT r.project_id, r.total_score, r.submitted_at, p.name AS project_name
      FROM reviews r JOIN projects p ON p.id = r.project_id
      WHERE r.judge_id = ? AND r.state = 'submitted' ORDER BY r.submitted_at DESC
    `).all(judge.id),
  }));
});

/* -------------------------------------------------- the judging workspace */

router.get('/j/:slug/r/:projectId', (req, res, next) => {
  try {
    const event = req.judgeEvent;
    const judge = req.judge;
    const { assignment } = authz.requireAssignment(event, req.params.projectId, req.actor);
    const project = authz.loadProject(event, req.params.projectId, req.actor, 'judge');

    const gate = { error: null };
    try {
      lifecycle.judgingGate(event);
    } catch (err) {
      gate.error = `${err.message}${err.hint ? ` ${err.hint}` : ''}`;
    }

    const conflict = db().prepare('SELECT reason FROM judge_conflicts WHERE judge_id = ? AND project_id = ?')
      .get(judge.id, project.id);

    res.send(views.reviewWorkspace({
      event: queries.publicEventColumns(event),
      viewer: { user: req.actor.user },
      judge: publicJudge(judge),
      project: queries.projectDetail(project, { forJudges: true }),
      criteria: judging.criteriaFor(event.id),
      review: queries.reviewFor(judge.id, project.id),
      assignment,
      queue: queries.assignmentSummary(judge.id),
      conflict: conflict ? conflict.reason : null,
      gate,
      formErrors: {},
    }));
  } catch (err) { next(err); }
});

/**
 * Save a review. `action=save` keeps a draft; `action=submit` locks it, and
 * a submit without every criterion and a summary is refused with a reason
 * rather than silently saved as a draft.
 */
router.post('/j/:slug/r/:projectId/review', (req, res, next) => {
  try {
    const event = req.judgeEvent;
    const judge = req.judge;
    authz.requireAssignment(event, req.params.projectId, req.actor);
    const project = authz.loadProject(event, req.params.projectId, req.actor, 'judge');
    authz.loadProject(event, req.params.projectId, req.actor, 'judge');
    lifecycle.judgingGate(event);

    const criteria = judging.criteriaFor(event.id);
    const scores = {};
    const notes = {};
    for (const c of criteria) {
      const raw = req.body[`score_${c.id}`];
      if (raw === undefined || raw === '') continue;
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0 || value > c.max_score) {
        throw new authz.HttpError(422, `"${c.name}" must be scored between 0 and ${c.max_score}.`);
      }
      scores[c.id] = value;
      notes[c.id] = String(req.body[`note_${c.id}`] || '').slice(0, 300);
    }

    const prose = {
      summary: String(req.body.summary || '').slice(0, 1200),
      strengths: String(req.body.strengths || '').slice(0, 800),
      improvements: String(req.body.improvements || '').slice(0, 800),
      concerns: String(req.body.concerns || '').slice(0, 800),
      recommend: ['shortlist', 'discuss', 'pass'].includes(req.body.recommend) ? req.body.recommend : '',
    };

    const existing = queries.reviewFor(judge.id, project.id);
    if (existing && existing.state === 'submitted' && req.body.action !== 'reopen') {
      // A submitted review is part of the record. Reopening is deliberate.
      throw new authz.HttpError(409, 'You have already submitted this review. Contact the organisers to change it.');
    }

    const result = queries.saveReview({
      eventId: event.id,
      projectId: project.id,
      judgeId: judge.id,
      scores,
      notes,
      prose,
      state: req.body.action === 'submit' ? 'submitted' : 'draft',
    });

    if (result.state === 'draft' && req.body.action === 'submit') {
      const missing = [];
      if (result.answered < criteria.length) missing.push('every criterion');
      if (!prose.summary.trim()) missing.push('a summary');
      throw new authz.HttpError(422, `Saved as a draft — to submit you need ${missing.join(' and ')}.`);
    }

    if (result.state === 'submitted') {
      db().prepare("UPDATE judge_assignments SET state = 'completed', completed_at = ? WHERE judge_id = ? AND project_id = ?")
        .run(now(), judge.id, project.id);
      db().prepare('UPDATE judges SET last_active_at = ? WHERE id = ?').run(now(), judge.id);
      audit.record({ actor: req.actor, eventId: event.id, action: 'review.submit', resourceType: 'review', resourceId: result.reviewId, detail: `${result.total} / 100` });
      const nextItem = queries.assignmentSummary(judge.id).items.find((i) => i.state !== 'done');
      if (req.get('accept') === 'application/json') {
        return res.json({ ok: true, state: 'submitted', total: result.total, next: nextItem ? nextItem.projectId : null });
      }
      return res.redirect(nextItem
        ? `/j/${event.slug}/r/${nextItem.projectId}`
        : `/j/${event.slug}`);
    }

    audit.record({ actor: req.actor, eventId: event.id, action: 'review.save', resourceType: 'review', resourceId: result.reviewId });
    if (req.get('accept') === 'application/json') {
      return res.json({ ok: true, state: 'draft', total: result.total, answered: result.answered, of: criteria.length });
    }
    res.redirect(`/j/${event.slug}/r/${project.id}?saved=1`);
  } catch (err) {
    if (req.get('accept') === 'application/json') return next(err);
    next(err);
  }
});

/** Autosave endpoint used by the scoring panel. Draft-only, never submits. */
router.post('/api/reviews/:eventSlug/:projectId', (req, res, next) => {
  try {
    const event = authz.findEvent(req.params.eventSlug);
    if (!event) throw new authz.HttpError(404, 'That hackathon does not exist.');
    if (!req.user) throw new authz.HttpError(401, 'Sign in to continue.');
    const judge = authz.requireJudge(event, req.actor);
    authz.requireAssignment(event, req.params.projectId, req.actor);
    const project = authz.loadProject(event, req.params.projectId, req.actor, 'judge');
    lifecycle.judgingGate(event);

    const existing = queries.reviewFor(judge.id, project.id);
    if (existing && existing.state === 'submitted') {
      throw new authz.HttpError(409, 'This review is already submitted.');
    }

    const criteria = judging.criteriaFor(event.id);
    const scores = {};
    const notes = {};
    for (const c of criteria) {
      const value = Number(req.body[`score_${c.id}`]);
      if (Number.isFinite(value)) scores[c.id] = Math.min(c.max_score, Math.max(0, value));
      if (req.body[`note_${c.id}`] !== undefined) notes[c.id] = String(req.body[`note_${c.id}`] || '').slice(0, 300);
    }
    const prose = {
      summary: req.body.summary !== undefined ? String(req.body.summary).slice(0, 1200) : undefined,
      strengths: req.body.strengths !== undefined ? String(req.body.strengths).slice(0, 800) : undefined,
      improvements: req.body.improvements !== undefined ? String(req.body.improvements).slice(0, 800) : undefined,
      concerns: req.body.concerns !== undefined ? String(req.body.concerns).slice(0, 800) : undefined,
      recommend: req.body.recommend !== undefined ? String(req.body.recommend) : undefined,
    };
    const result = queries.saveReview({
      eventId: event.id, projectId: project.id, judgeId: judge.id, scores, notes, prose, state: 'draft',
    });
    res.json({
      ok: true,
      total: result.total,
      answered: result.answered,
      of: result.total_criteria,
    });
  } catch (err) { next(err); }
});

router.post('/j/:slug/r/:projectId/conflict', (req, res) => {
  const event = req.judgeEvent;
  const judge = req.judge;
  const reason = String(req.body.reason || '').trim().slice(0, 200);
  db().prepare(`
    INSERT OR REPLACE INTO judge_conflicts (id, event_id, judge_id, project_id, reason, declared_at)
    VALUES (?,?,?,?,?,?)
  `).run(id('cfl'), event.id, judge.id, req.params.projectId, reason, now());
  db().prepare("UPDATE judge_assignments SET state = 'revoked' WHERE judge_id = ? AND project_id = ?")
    .run(judge.id, req.params.projectId);
  audit.record({
    actor: req.actor, eventId: event.id, action: 'judge.conflict',
    resourceType: 'judge_assignment', resourceId: req.params.projectId, detail: reason,
  });
  res.redirect(`/j/${event.slug}`);
});

/* ---------------------------------------------------------- side by side */

router.get('/j/:slug/compare', (req, res) => {
  const event = req.judgeEvent;
  const judge = req.judge;

  // Selection comes from the query string, but every id is then checked
  // against this judge's assignments before anything is read.
  const requested = String(req.query.ids || req.query.a || '').split(',').map((s) => s.trim()).filter(Boolean);
  const fallback = queries.assignmentSummary(judge.id).items.slice(0, 2).map((i) => i.projectId);
  const ids = (requested.length ? requested : fallback).slice(0, 4);

  const columns = [];
  const missing = [];
  for (const projectId of ids) {
    const assigned = db().prepare(`
      SELECT 1 AS ok FROM judge_assignments WHERE judge_id = ? AND project_id = ? AND state != 'revoked'
    `).get(judge.id, projectId);
    if (!assigned) { missing += 1; continue; }
    const project = db().prepare('SELECT * FROM projects WHERE id = ? AND event_id = ?').get(projectId, event.id);
    if (!project) { missing += 1; continue; }
    columns.push({
      project: queries.projectDetail(project, { forJudges: true }),
      review: queries.reviewFor(judge.id, project.id),
      isBest: false,
    });
  }

  // Highlight the best score per criterion so the eye lands on the difference.
  const criteria = judging.criteriaFor(event.id);
  for (const c of criteria) {
    const best = Math.max(...columns.map((col) => (col.review ? col.review.scores[c.id] : -1)), -1);
    if (best > 0) {
      for (const col of columns) {
        if (col.review && col.review.scores[c.id] === best && columns.length > 1) col.isBest = true;
      }
    }
  }

  res.send(views.comparePage({
    event: queries.publicEventColumns(event),
    viewer: { user: req.actor.user },
    columns,
    criteria,
    mine: req.query.mine === '1',
    missing,
    selection: new Set(ids),
  }));
});

/* ------------------------------------------------------------- head to head */

router.get('/j/:slug/pairwise', (req, res) => {
  const event = req.judgeEvent;
  const judge = req.judge;

  const assigned = db().prepare(`
    SELECT p.* FROM projects p
    JOIN judge_assignments a ON a.project_id = p.id
    WHERE a.judge_id = ? AND a.state != 'revoked'
    ORDER BY p.name
  `).all(judge.id);

  // Prefer pairs not yet compared. If every pair is done, offer the last one.
  let pair = null;
  const tried = new Set(db().prepare('SELECT project_a, project_b FROM pairwise_comparisons WHERE judge_id = ?')
    .all(judge.id).map((r) => [r.project_a, r.project_b].sort().join('|')));
  outer:
  for (let i = 0; i < assigned.length; i += 1) {
    for (let j = i + 1; j < assigned.length; j += 1) {
      if (!tried.has([assigned[i].id, assigned[j].id].sort().join('|'))) {
        pair = { a: projectSummary(assigned[i]), b: projectSummary(assigned[j]) };
        break outer;
      }
    }
  }

  const comparisons = db().prepare(`
    SELECT * FROM pairwise_comparisons WHERE judge_id = ?
  `).all(judge.id).map((cmp) => {
    const a = db().prepare('SELECT name FROM projects WHERE id = ?').get(cmp.project_a);
    const b = db().prepare('SELECT name FROM projects WHERE id = ?').get(cmp.project_b);
    return {
      winnerName: cmp.winner === 'a' ? (a || {}).name : cmp.winner === 'b' ? (b || {}).name : 'Tie',
      loserName: cmp.winner === 'a' ? (b || {}).name : (a || {}).name,
      rationale: cmp.rationale,
      createdAt: cmp.created_at,
    };
  });

  const strengths = judging.bradleyTerry(buildComparisonGraph(judge.id, comparisons.length ? true : false))
    .map((s) => {
      const p = db().prepare('SELECT name FROM projects WHERE id = ?').get(s.projectId);
      return { ...s, name: p ? p.name : 'Unknown' };
    });

  res.send(views.pairwisePage({
    event: queries.publicEventColumns(event),
    viewer: { user: req.actor.user },
    pair,
    history: comparisons.slice(-10).reverse(),
    myStrengths: strengths,
    canCompare: assigned.length >= 2,
  }));
});

router.post('/j/:slug/pairwise', (req, res) => {
  const event = req.judgeEvent;
  const judge = req.judge;
  const a = String(req.body.a || '');
  const b = String(req.body.b || '');
  const winner = ['a', 'b', 'tie'].includes(req.body.winner) ? req.body.winner : '';
  if (!a || !b || !winner) throw new authz.HttpError(422, 'Pick a winner first.');
  if (a === b) throw new authz.HttpError(422, 'A project cannot be compared with itself.');

  for (const projectId of [a, b]) {
    const assigned = db().prepare(`
      SELECT 1 AS ok FROM judge_assignments WHERE judge_id = ? AND project_id = ? AND state != 'revoked'
    `).get(judge.id, projectId);
    if (!assigned) throw new authz.HttpError(403, 'You can only compare projects assigned to you.');
  }

  const [first, second] = [a, b].sort();
  db().prepare(`
    INSERT INTO pairwise_comparisons (id, event_id, judge_id, project_a, project_b, winner, rationale, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?)
    ON CONFLICT(judge_id, project_a, project_b)
    DO UPDATE SET winner = excluded.winner, rationale = excluded.rationale, updated_at = excluded.updated_at
  `).run(id('pwr'), event.id, judge.id, first, second, winner,
    String(req.body.rationale || '').slice(0, 600), now(), now());

  audit.record({ actor: req.actor, eventId: event.id, action: 'pairwise.record', resourceType: 'pairwise_comparison' });
  res.redirect(`/j/${event.slug}/pairwise`);
});

function buildComparisonGraph(judgeId, hasData) {
  if (!hasData) return [];
  return db().prepare('SELECT * FROM pairwise_comparisons WHERE judge_id = ?').all(judgeId)
    .map((cmp) => ({
      project_a: cmp.project_a,
      project_b: cmp.project_b,
      winner: cmp.winner,
      weightOfA: 1,
      weightOfB: 1,
    }));
}

function projectSummary(project) {
  const review = db().prepare(`
    SELECT state, total_score FROM reviews WHERE judge_id = (
      SELECT judge_id FROM judge_assignments WHERE project_id = ? LIMIT 1
    ) AND project_id = ?
  `).get(project.id, project.id);
  return {
    id: project.id,
    name: project.name,
    tagline: project.tagline,
    teamName: (db().prepare('SELECT name FROM teams WHERE id = ?').get(project.team_id) || {}).name,
    track: project.track_id ? db().prepare('SELECT name, colour FROM tracks WHERE id = ?').get(project.track_id) : null,
    demoUrl: project.demo_url,
    repoUrl: project.repo_url,
    videoUrl: project.video_url,
    review,
  };
}

/* ---------------------------------------------------------------- helpers */

function publicJudge(judge) {
  return { id: judge.id, name: judge.name, headline: judge.headline, organisation: judge.organisation };
}

module.exports = router;
