'use strict';

const express = require('express');
const { db } = require('../db');
const authz = require('../lib/authz');
const queries = require('../lib/queries');
const lifecycle = require('../lib/lifecycle');
const views = require('../views/public');
const c = require('../views/components');

const router = express.Router();

/* --------------------------------------------------------------- homepage */

router.get('/', (req, res) => {
  const events = queries.listEvents({ limit: 12, state: '' });
  const projects = queries.showcase({ limit: 4 });
  res.send(views.homePage({
    user: req.actor.user,
    events,
    projects,
    stats: {
      judges: db().prepare("SELECT COUNT(*) AS n FROM judges WHERE state = 'verified'").get().n,
      events: db().prepare("SELECT COUNT(*) AS n FROM events WHERE visibility='public' AND status='published'").get().n,
      projects: db().prepare("SELECT COUNT(*) AS n FROM projects WHERE status='submitted' AND is_public=1").get().n,
    },
  }));
});

router.get('/hackathons', (req, res) => {
  const filters = {
    search: String(req.query.q || '').slice(0, 80),
    topic: String(req.query.topic || '').slice(0, 40),
    format: ['online', 'in_person', 'hybrid'].includes(req.query.format) ? req.query.format : '',
    state: ['upcoming', 'live', 'past'].includes(req.query.state) ? req.query.state : '',
  };
  const events = queries.listEvents({ ...filters, limit: 60 });
  res.send(views.hackathonsPage({
    user: req.actor.user,
    events,
    topics: queries.eventTopics(),
    filters,
    resultCount: events.length,
  }));
});

// Generous, because a gallery that truncates hard hides finished work behind a
// pager: the archive is the point of the page. Still paginated, because an
// install with thousands of submissions should not render thousands of cards.
const SHOWCASE_PAGE_SIZE = 48;

router.get('/projects', (req, res) => {
  const filters = {
    search: String(req.query.q || '').slice(0, 80),
    track: String(req.query.track || '').slice(0, 60),
    tech: String(req.query.tech || '').slice(0, 40),
    awarded: req.query.awarded === '1',
  };
  // The query layer calls it awardedOnly; the form and the view call it awarded.
  const query = { ...filters, awardedOnly: filters.awarded };
  const total = queries.showcaseCount(query);
  const pages = Math.max(1, Math.ceil(total / SHOWCASE_PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Number.parseInt(req.query.page, 10) || 1));

  res.send(views.showcasePage({
    user: req.actor.user,
    projects: queries.showcase({ ...query, limit: SHOWCASE_PAGE_SIZE, offset: (page - 1) * SHOWCASE_PAGE_SIZE }),
    facets: queries.showcaseFacets(),
    filters,
    total,
    page,
    pages,
    pageSize: SHOWCASE_PAGE_SIZE,
  }));
});

router.get('/o', (req, res, next) => {
  try {
    const user = authz.requireUser(req.actor);
    const rows = db().prepare(`
      SELECT DISTINCT e.* FROM events e
      JOIN event_roles r ON r.event_id = e.id
      WHERE r.user_id = ? AND r.role IN ('organiser','coordinator')
      ORDER BY e.starts_at DESC
    `).all(user.id);

    const shape = (e) => {
      const view = queries.publicEventColumns(e);
      const stats = queries.eventStats(e.id);
      const snapshot = queries.organiserSnapshot(e.id);
      const phase = lifecycle.phase(e);
      return {
        slug: view.slug,
        name: view.name,
        phase,
        formatLabel: { online: 'Online', in_person: 'In person', hybrid: 'Hybrid' }[view.format] || view.format,
        detail: `${stats.registrations} registered · ${stats.projects} submission${stats.projects === 1 ? '' : 's'} · ${snapshot.reviewsDone} of ${snapshot.assigned} reviews in`,
        dates: lifecycle.fmtRange(view.startsAt, view.endsAt, view.timezone),
        action: phase === 'results' ? 'View results' : 'Open console',
      };
    };

    res.send(views.organiserHomePage({
      user: req.actor.user,
      events: rows.filter((e) => e.status !== 'archived').map(shape),
      archived: rows.filter((e) => e.status === 'archived').map(shape),
    }));
  } catch (err) { next(err); }
});

router.get('/host', (req, res) => {
  // The page explains what hosting involves; that is worth reading before
  // anyone is asked to make an account.
  res.send(views.hostPage({ user: req.actor.user }));
});

router.get('/about', (req, res) => {
  res.send(views.aboutPage({
    user: req.actor.user,
    stats: {
      events: db().prepare('SELECT COUNT(*) AS n FROM events WHERE visibility=\'public\' AND status=\'published\'').get().n,
      projects: db().prepare("SELECT COUNT(*) AS n FROM projects WHERE status='submitted' AND is_public=1").get().n,
      judges: db().prepare("SELECT COUNT(*) AS n FROM judges WHERE state='verified'").get().n,
    },
  }));
});

/* ------------------------------------------------------------- healthcheck */

router.get('/healthz', (req, res) => {
  let ok = true;
  let events = 0;
  try {
    events = db().prepare('SELECT COUNT(*) AS n FROM events').get().n;
  } catch {
    ok = false;
  }
  res.status(ok ? 200 : 503).json({ ok, events, uptime: Math.round(process.uptime()) });
});

module.exports = router;
