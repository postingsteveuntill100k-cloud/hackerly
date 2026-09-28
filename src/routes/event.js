'use strict';

const express = require('express');
const { db } = require('../db');
const authz = require('../lib/authz');
const queries = require('../lib/queries');
const lifecycle = require('../lib/lifecycle');
const views = require('../views/event');
const c = require('../views/components');
const { plain, json } = require('../lib/html');

const router = express.Router();

/* ------------------------------------------------------------- event page */

const TABS = [
  { key: 'overview', label: 'Overview', href: '' },
  { key: 'projects', label: 'Projects', href: '/projects' },
  { key: 'results', label: 'Results', href: '/results' },
];

router.get('/h/:slug', (req, res, next) => {
  try {
    res.send(render(req, authz.requireEvent(req.params.slug, req.actor), 'overview'));
  } catch (err) { next(err); }
});

router.get('/h/:slug/:tab', (req, res, next) => {
  try {
    const tab = req.params.tab;
    if (!TABS.some((t) => t.key === tab)) throw new authz.HttpError(404, 'That section does not exist.');
    res.send(render(req, authz.requireEvent(req.params.slug, req.actor), tab));
  } catch (err) { next(err); }
});

function render(req, event, tab) {
  const viewer = buildViewer(req, event);
  const sections = {
    about: event.about,
    tracks: queries.tracksFor(event.id),
    challenges: db().prepare(`
      SELECT c.*, t.colour, t.name AS track_name FROM challenges c
      LEFT JOIN tracks t ON t.id = c.track_id
      WHERE c.event_id = ? ORDER BY c.position, c.name
    `).all(event.id).map((ch) => ({
      id: ch.id,
      name: ch.name,
      description: ch.description,
      sponsor: ch.sponsor,
      prizeLabel: ch.prize_label,
      colour: ch.track_name ? ch.colour : 'ink',
      trackName: ch.track_name,
    })),
    schedule: queries.scheduleFor(event.id),
    announcements: queries.announcementsFor(event.id, 12),
    prizes: queries.prizesFor(event.id),
    faqs: queries.faqsFor(event.id),
    fields: queries.submissionFieldsFor(event.id),
    criteria: db().prepare('SELECT * FROM rubric_criteria WHERE event_id = ? ORDER BY position').all(event.id),
    people: queries.peopleForEvent(event.id, 40),
    judges: queries.judgesForEvent(event.id),
    staff: queries.staffForEvent(event.id),
    projects: queries.projectsForEvent(event.id, { publicOnly: true }),
  };

  const resultsReleased = authz.resultsArePublic(event);
  const results = resultsReleased ? queries.publishedResults(event.id) : [];

  return views.eventPage({
    event: publicEvent(event),
    viewer,
    sections,
    results,
    tabs: TABS.map((t) => ({
      ...t,
      count: t.key === 'projects' ? sections.projects.length
        : t.key === 'results' ? (resultsReleased ? results.length : null) : undefined,
    })),
    currentTab: tab,
  });
}

/**
 * What should this visitor be invited to do? The call to action is derived
 * from their real relationship to the event, so an organiser does not see
 * "Register" on their own event page.
 */
function buildViewer(req, event) {
  const user = req.actor.user;
  if (!user) {
    const registrationOpen = isRegistrationOpen(event);
    return {
      user: null,
      cta: `<a class="btn btn--accent" href="${registrationOpen ? `/signin?next=/p/${event.slug}` : '/signup'}">${registrationOpen ? 'Register to take part' : 'Create an account'}</a>
        <a class="btn btn--ghost" href="/signin">Sign in</a>`,
    };
  }

  const registered = authz.isRegistered(user.id, event.id);
  const staff = authz.isStaff(user.id, event.id);
  const judge = authz.judgeRecord(user.id, event.id);
  const phase = lifecycle.phase(event);

  const buttons = [];
  if (staff) buttons.push('<a class="btn btn--accent" href="/o/' + event.slug + '">Organiser console</a>');
  if (judge && judge.state === 'verified') buttons.push('<a class="btn btn--accent" href="/j/' + event.slug + '">Judging workspace</a>');
  if (registered) {
    buttons.push(`<a class="btn ${staff || judge ? 'btn--ghost' : 'btn--accent'}" href="/p/${event.slug}">Your entry</a>`);
  } else if (isRegistrationOpen(event)) {
    buttons.push(`<a class="btn btn--accent" href="/p/${event.slug}">Register</a>`);
  }
  if (authz.resultsArePublic(event)) buttons.push(`<a class="btn btn--ghost" href="/h/${event.slug}/results">Results</a>`);

  if (!buttons.length) {
    buttons.push(`<a class="btn btn--ghost" href="/hackathons">Find another hackathon</a>`);
  }

  let note = '';
  if (registered && phase === 'building') note = '';
  return { user, cta: buttons.join('\n'), registered, staff, judge: Boolean(judge), note };
}

function isRegistrationOpen(event) {
  try {
    lifecycle.registrationGate(event);
    return true;
  } catch {
    return false;
  }
}

function publicEvent(event) {
  return queries.publicEventColumns(event);
}

module.exports = router;
