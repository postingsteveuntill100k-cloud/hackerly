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

router.get('/projects', (req, res) => {
  const filters = {
    search: String(req.query.q || '').slice(0, 80),
    track: String(req.query.track || '').slice(0, 60),
    tech: String(req.query.tech || '').slice(0, 40),
    awarded: req.query.awarded === '1',
  };
  res.send(views.showcasePage({
    user: req.actor.user,
    projects: queries.showcase({ ...filters, limit: 60 }),
    facets: queries.showcaseFacets(),
    filters,
  }));
});

router.get('/host', (req, res) => {
  if (!req.user) return res.redirect('/signup?next=/host/new');
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
