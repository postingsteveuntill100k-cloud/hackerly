'use strict';

const express = require('express');
const { db } = require('../db');
const authz = require('../lib/authz');
const audit = require('../lib/audit');
const lifecycle = require('../lib/lifecycle');
const queries = require('../lib/queries');
const views = require('../views/event');
const c = require('../views/components');

const router = express.Router();

/* -------------------------------------------------------- project showcase */

router.get('/projects/:eventSlug/:projectSlug', (req, res, next) => {
  try {
    const event = authz.requireEvent(req.params.eventSlug, req.actor);
    const project = queries.projectBySlug(event.id, req.params.projectSlug);
    if (!project) throw new authz.HttpError(404, 'That project does not exist in this hackathon.');

    // A project page is public only if the event allows the showcase, the
    // project opted in, and it was actually submitted.
    const showcaseVisible = event.show_projects === 1
      && project.is_public === 1
      && project.status === 'submitted';
    const staff = req.user && authz.isStaff(req.user.id, event.id);
    if (!showcaseVisible && !staff) throw new authz.HttpError(404, 'That project is not public.');

    sendProject(req, res, event, project, { showcaseVisible, staff });
  } catch (err) { next(err); }
});

function sendProject(req, res, event, project, { showcaseVisible, staff }) {
  const detail = queries.projectDetail(project, { forJudges: staff });
  const resultsReleased = authz.resultsArePublic(event);

  const resultRow = resultsReleased
    ? db().prepare('SELECT * FROM results WHERE event_id = ? AND project_id = ? AND published = 1')
      .get(event.id, project.id)
    : null;
  const score = resultRow
    ? queries.organiserSnapshot && scoreFor(event.id, project.id)
    : null;

  const comments = event.allow_comments
    ? db().prepare(`
        SELECT cm.*, u.name AS author_name FROM comments cm
        JOIN users u ON u.id = cm.user_id
        WHERE cm.project_id = ? AND cm.state = 'visible' ORDER BY cm.created_at DESC LIMIT 50
      `).all(project.id).map((cm) => ({
        body: cm.body,
        createdAt: cm.created_at,
        authorName: cm.author_name,
        author: { name: cm.author_name, hue: 0 },
      }))
    : [];

  const canVote = event.allow_public_voting === 1
    && req.user
    && authz.isRegistered(req.user.id, event.id);

  const voted = req.user
    ? Boolean(db().prepare('SELECT 1 AS ok FROM votes WHERE project_id = ? AND user_id = ?')
      .get(project.id, req.user.id))
    : false;

  const results = resultRow ? {
    rank: resultRow.rank,
    trackRank: resultRow.track_rank,
    award: resultRow.award,
    normalisedScore: resultRow.normalised_score,
    reviewsSubmitted: score ? score.submitted : 0,
  } : null;

  res.send(views.projectPage({
    project: detail,
    event: queries.publicEventColumns(event),
    results,
    comments,
    viewer: { user: req.actor.user },
    backHref: `/h/${event.slug}`,
    backLabel: event.name,
    canVote: Boolean(canVote),
    voted,
  }));
  void showcaseVisible;
}

function scoreFor(eventId, projectId) {
  const judging = require('../lib/judging');
  return judging.scoreProject(eventId, projectId);
}

/* ------------------------------------------------------------------ votes */

router.post('/projects/:eventSlug/:projectSlug/vote', (req, res, next) => {
  try {
    const user = authz.requireUser(req.actor);
    const event = authz.requireEvent(req.params.eventSlug, req.actor);
    if (event.allow_public_voting !== 1) {
      throw new authz.HttpError(403, 'This hackathon is not accepting public votes.');
    }
    if (!authz.isRegistered(user.id, event.id)) {
      throw new authz.HttpError(403, 'Only registered participants can vote.');
    }
    const project = queries.projectBySlug(event.id, req.params.projectSlug);
    if (!project || project.status !== 'submitted' || project.is_public !== 1) {
      throw new authz.HttpError(404, 'That project is not open for voting.');
    }

    const existing = db().prepare('SELECT id FROM votes WHERE project_id = ? AND user_id = ?')
      .get(project.id, user.id);
    if (existing) {
      db().prepare('DELETE FROM votes WHERE id = ?').run(existing.id);
      audit.record({ actor: req.actor, eventId: event.id, action: 'vote.remove', resourceType: 'project', resourceId: project.id });
    } else {
      db().prepare(`
        INSERT OR IGNORE INTO votes (id, event_id, project_id, user_id, created_at) VALUES (?,?,?,?,?)
      `).run(require('../lib/ids').id('vot'), event.id, project.id, user.id, require('../lib/ids').now());
      audit.record({ actor: req.actor, eventId: event.id, action: 'vote.add', resourceType: 'project', resourceId: project.id });
    }
    res.redirect(`/p/${event.slug}/${project.slug}`);
  } catch (err) { next(err); }
});

/* --------------------------------------------------------------- comments */

router.post('/projects/:eventSlug/:projectSlug/comment', (req, res, next) => {
  try {
    const user = authz.requireUser(req.actor);
    const event = authz.requireEvent(req.params.eventSlug, req.actor);
    if (event.allow_comments !== 1) throw new authz.HttpError(403, 'Comments are closed for this hackathon.');
    const project = queries.projectBySlug(event.id, req.params.projectSlug);
    if (!project || project.status !== 'submitted' || project.is_public !== 1) {
      throw new authz.HttpError(404, 'That project is not open for discussion.');
    }
    const body = String(req.body.body || '').trim().slice(0, 1200);
    if (body.length < 2) throw new authz.HttpError(422, 'Write something first.');
    db().prepare(`
      INSERT INTO comments (id, event_id, project_id, user_id, body, state, created_at)
      VALUES (?,?,?,?,?, 'visible', ?)
    `).run(require('../lib/ids').id('cmt'), event.id, project.id, user.id, body, require('../lib/ids').now());
    audit.record({ actor: req.actor, eventId: event.id, action: 'comment.create', resourceType: 'project', resourceId: project.id });
    res.redirect(`/p/${event.slug}/${project.slug}`);
  } catch (err) { next(err); }
});

module.exports = router;
