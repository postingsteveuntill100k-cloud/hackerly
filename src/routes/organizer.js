'use strict';

const express = require('express');
const { db } = require('../db');
const authz = require('../lib/authz');
const audit = require('../lib/audit');
const lifecycle = require('../lib/lifecycle');
const queries = require('../lib/queries');
const judging = require('../lib/judging');
const views = require('../views/organizer');
const v = require('../lib/validate');
const { id, now, token, slugify, hashInt, uniqueSlug } = require('../lib/ids');
const { insert } = require('../db/seed/insert');
const { hashPassword, verifyPassword, sha256 } = require('../lib/auth');
const { json } = require('../lib/html');

const router = express.Router();

/** Every organiser route requires an authenticated member of the event. */
router.use('/o', (req, res, next) => {
  const m = req.path.match(/^\/([A-Za-z0-9_-]+)/);
  if (!m) return next();
  const event = authz.findEvent(m[1]);
  if (!event) return next(authz.deny ? new authz.HttpError(404, 'That hackathon does not exist.') : undefined);
  req.organiserEvent = event;
  authz.requireStaff(event, req.actor);
  authz.requireTokenScope(req.actor, event, 'export');
  req.actor.isStaff = true;
  next();
});

/** Actions shown in the head of every console page. */
function consoleActions(req) {
  if (!req.organiserEvent) return '';
  const slug = req.organiserEvent.slug;
  return `<a class="btn btn--ghost btn--sm" href="/api/export.csv?event=${slug}" title="Every submitted review, one row each">Export reviews (CSV)</a>`;
}

/* --------------------------------------------------------------- overview */

router.get('/o/:slug', (req, res) => {
  res.locals.consoleActions = consoleActions(req);
  const event = req.organiserEvent;
  const snapshot = queries.organiserSnapshot(event.id);
  const phase = lifecycle.phase(event);

  const nextDeadline = ['submissions_close_at', 'judging_closes_at', 'registration_closes_at', 'ends_at']
    .map((key) => ({ key, at: event[key] }))
    .filter((d) => d.at && Date.parse(d.at) > Date.now())
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0];

  const resultsReady = db().prepare('SELECT COUNT(*) AS n FROM results WHERE event_id = ?').get(event.id).n > 0;

  const gateErrors = [];
  if (!event.about) gateErrors.push('The event has no description. Participants are deciding whether to join based on that.');
  if (!db().prepare('SELECT 1 AS ok FROM tracks WHERE event_id = ?').get(event.id)) gateErrors.push('No tracks defined. Judges cannot rank anything without at least one.');
  if (!db().prepare('SELECT 1 AS ok FROM rubric_criteria WHERE event_id = ?').get(event.id)) gateErrors.push('No rubric criteria. Judges will not be able to score anything.');
  if (!db().prepare("SELECT 1 AS ok FROM judges WHERE event_id = ? AND state = 'verified'").get(event.id)) gateErrors.push('No verified judges.');

  res.send(views.overviewPage({ user: req.actor.user, extraActions: consoleActions(req),
    event: queries.publicEventColumns(event),
    snapshot,
    phase,
    nextDeadline: nextDeadline
      ? { label: { submissions_close_at: 'Submissions close', judging_closes_at: 'Judging closes', registration_closes_at: 'Registration closes', ends_at: 'The hackathon ends' }[nextDeadline.key], at: nextDeadline.at, urgent: Date.parse(nextDeadline.at) - Date.now() < 7 * 86400_000 }
      : null,
    resultsReady,
    gateErrors,
    recentProjects: queries.projectsForEvent(event.id, { publicOnly: false }).slice(0, 6),
  }));
});

/* ------------------------------------------------------------ event setup */

router.get('/host/new', (req, res) => {
  authz.requireUser(req.actor);
  res.send(views.eventFormPage({ user: req.actor.user, extraActions: consoleActions(req), isNew: true }));
});

router.post('/host/new', (req, res, next) => {
  try {
    const user = authz.requireUser(req.actor);
    const parsed = parseEventForm(req.body, true);
    parsed.errors.throwIfAny();

    const eventId = id('evt');
    const existing = new Set(db().prepare('SELECT slug FROM events').all().map((e) => e.slug));
    insert('events', {
      id: eventId,
      slug: uniqueSlug(existing, parsed.values.name, 'hackathon'),
      name: parsed.values.name,
      tagline: parsed.values.tagline,
      about: parsed.values.about,
      cover_hue: hashInt(eventId, 360),
      organiser_name: parsed.values.organiserName,
      organiser_id: user.id,
      visibility: parsed.values.visibility,
      status: 'published',
      results_released: 0,
      format: parsed.values.format,
      venue: parsed.values.venue,
      city: parsed.values.city,
      country: parsed.values.country,
      timezone: parsed.values.timezone,
      topics: JSON.stringify(parsed.values.topics),
      registration_opens_at: parsed.values.registrationOpensAt,
      registration_closes_at: parsed.values.registrationClosesAt,
      starts_at: parsed.values.startsAt,
      ends_at: parsed.values.endsAt,
      submissions_open_at: parsed.values.submissionsOpenAt,
      submissions_close_at: parsed.values.submissionsCloseAt,
      judging_opens_at: parsed.values.judgingOpensAt,
      judging_closes_at: parsed.values.judgingClosesAt,
      results_at: parsed.values.resultsAt,
      eligibility: parsed.values.eligibility,
      min_team_size: parsed.values.minTeamSize,
      max_team_size: parsed.values.maxTeamSize,
      allow_solo: parsed.values.allowSolo,
      allow_team_invites: parsed.values.allowTeamInvites,
      participation_fee: parsed.values.participationFee,
      max_participants: parsed.values.maxParticipants,
      require_approval: parsed.values.requireApproval,
      require_repo: parsed.values.requireRepo,
      require_demo: parsed.values.requireDemo,
      require_video: parsed.values.requireVideo,
      require_screenshots: parsed.values.requireScreenshots,
      submission_checklist: JSON.stringify(parsed.values.submissionChecklist),
      code_of_conduct: parsed.values.codeOfConduct,
      rules: parsed.values.rules,
      show_projects: parsed.values.showProjects,
      allow_public_voting: parsed.values.allowPublicVoting,
      allow_comments: parsed.values.allowComments,
      created_at: now(),
      updated_at: now(),
    });

    db().prepare(`
      INSERT INTO event_roles (id, event_id, user_id, role, granted_by, created_at) VALUES (?,?,?,'organiser',?,?)
    `).run(id('rol'), eventId, user.id, user.id, now());

    // A new event with no rubric cannot be judged, so seed a sensible default
    // the organiser can edit or delete.
    [['Does it work', 'The core path runs without a script and without narration.', 1.2, 5],
      ['Craft', 'Is the engineering sound and maintainable?', 1, 5],
      ['Usefulness', 'Does it remove a real piece of friction for a real person?', 1, 5]]
      .forEach(([name, description, weight, max], i) => {
        db().prepare(`
          INSERT INTO rubric_criteria (id, event_id, field_key, name, description, weight, max_score, position)
          VALUES (?,?,?,?,?,?,?,?)
        `).run(id('crt'), eventId, `default-${i}`, name, description, weight, max, i);
      });

    audit.record({ actor: req.actor, eventId, action: 'event.create', resourceType: 'event', resourceId: eventId });
    res.redirect(`/o/${db().prepare('SELECT slug FROM events WHERE id = ?').get(eventId).slug}`);
  } catch (err) {
    if (err.fields) {
      return res.status(err.statusCode || 422).send(views.eventFormPage({
        isNew: true, user: req.actor.user, errors: err.fields, values: req.body,
      }));
    }
    return next(err);
  }
});

router.get('/o/:slug/event', (req, res) => {
  res.locals.consoleActions = consoleActions(req);
  res.send(views.eventFormPage({ user: req.actor.user, extraActions: consoleActions(req), event: queries.publicEventColumns(req.organiserEvent) }));
});

router.post('/o/:slug/event', (req, res, next) => {
  const event = req.organiserEvent;
  try {
    const parsed = parseEventForm(req.body, false);
    parsed.errors.throwIfAny();
    db().prepare(`
      UPDATE events SET name = ?, tagline = ?, about = ?, organiser_name = ?, visibility = ?, format = ?,
        venue = ?, city = ?, country = ?, timezone = ?, topics = ?,
        registration_opens_at = ?, registration_closes_at = ?, starts_at = ?, ends_at = ?,
        submissions_open_at = ?, submissions_close_at = ?, judging_opens_at = ?, judging_closes_at = ?,
        results_at = ?, eligibility = ?, min_team_size = ?, max_team_size = ?, allow_solo = ?,
        allow_team_invites = ?, participation_fee = ?, max_participants = ?, require_approval = ?,
        require_repo = ?, require_demo = ?, require_video = ?, require_screenshots = ?,
        submission_checklist = ?, code_of_conduct = ?, rules = ?, show_projects = ?,
        allow_public_voting = ?, allow_comments = ?, updated_at = ?
      WHERE id = ?
    `).run(
      parsed.values.name, parsed.values.tagline, parsed.values.about, parsed.values.organiserName,
      parsed.values.visibility, parsed.values.format, parsed.values.venue, parsed.values.city,
      parsed.values.country, parsed.values.timezone, JSON.stringify(parsed.values.topics),
      parsed.values.registrationOpensAt, parsed.values.registrationClosesAt,
      parsed.values.startsAt, parsed.values.endsAt, parsed.values.submissionsOpenAt,
      parsed.values.submissionsCloseAt, parsed.values.judgingOpensAt, parsed.values.judgingClosesAt,
      parsed.values.resultsAt, parsed.values.eligibility, parsed.values.minTeamSize,
      parsed.values.maxTeamSize, parsed.values.allowSolo, parsed.values.allowTeamInvites,
      parsed.values.participationFee, parsed.values.maxParticipants, parsed.values.requireApproval,
      parsed.values.requireRepo, parsed.values.requireDemo, parsed.values.requireVideo,
      parsed.values.requireScreenshots, JSON.stringify(parsed.values.submissionChecklist),
      parsed.values.codeOfConduct, parsed.values.rules, parsed.values.showProjects,
      parsed.values.allowPublicVoting, parsed.values.allowComments, now(), event.id,
    );
    audit.record({ actor: req.actor, eventId: event.id, action: 'event.update', resourceType: 'event', resourceId: event.id });
    res.redirect(`/o/${event.slug}/event?saved=1`);
  } catch (err) {
    if (err.fields) {
      return res.status(422).send(views.eventFormPage({
        event: queries.publicEventColumns(event), user: req.actor.user, errors: err.fields, values: req.body,
      }));
    }
    return next(err);
  }
});

function parseEventForm(body, isNew) {
  const errors = new v.FieldErrors();
  const values = {
    name: v.text(body.name, { field: 'name', label: 'Name', errors, required: true, min: 3, max: 100 }),
    tagline: v.text(body.tagline, { field: 'tagline', label: 'Tagline', errors, required: true, min: 10, max: 180 }),
    about: v.text(body.about, { field: 'about', label: 'About', errors, max: 8000 }),
    organiserName: v.text(body.organiserName, { field: 'organiserName', label: 'Organising body', errors, max: 90 }),
    timezone: v.text(body.timezone, { field: 'timezone', label: 'Timezone', errors, required: true, max: 60 }) || 'UTC',
    format: v.oneOf(body.format, ['online', 'in_person', 'hybrid'], { field: 'format', label: 'Format', errors, fallback: 'online' }),
    visibility: v.oneOf(body.visibility, ['public', 'unlisted', 'private'], { field: 'visibility', label: 'Visibility', errors, fallback: 'public' }),
    venue: v.text(body.venue, { field: 'venue', label: 'Venue', errors, max: 120 }),
    city: v.text(body.city, { field: 'city', label: 'City', errors, max: 80 }),
    country: v.text(body.country, { field: 'country', label: 'Country', errors, max: 80 }),
    topics: v.list(body.topics, { max: 10, maxItemLength: 30 }),
    registrationOpensAt: v.isoOrNull(body.registrationOpensAt),
    registrationClosesAt: v.isoOrNull(body.registrationClosesAt),
    startsAt: v.isoOrNull(body.startsAt),
    endsAt: v.isoOrNull(body.endsAt),
    submissionsOpenAt: v.isoOrNull(body.submissionsOpenAt),
    submissionsCloseAt: v.isoOrNull(body.submissionsCloseAt),
    judgingOpensAt: v.isoOrNull(body.judgingOpensAt),
    judgingClosesAt: v.isoOrNull(body.judgingClosesAt),
    resultsAt: v.isoOrNull(body.resultsAt),
    eligibility: v.text(body.eligibility, { field: 'eligibility', label: 'Eligibility', errors, max: 2000 }),
    minTeamSize: v.int(body.minTeamSize, { field: 'minTeamSize', label: 'Minimum team size', errors, min: 1, max: 20, fallback: 1 }),
    maxTeamSize: v.int(body.maxTeamSize, { field: 'maxTeamSize', label: 'Maximum team size', errors, min: 1, max: 20, fallback: 4 }),
    maxParticipants: v.int(body.maxParticipants, { field: 'maxParticipants', label: 'Capacity', errors, min: 0, max: 100000, fallback: 0 }),
    participationFee: v.text(body.participationFee, { field: 'participationFee', label: 'Entry fee', errors, max: 60 }),
    allowSolo: v.bool(body.allowSolo) ? 1 : 0,
    allowTeamInvites: v.bool(body.allowTeamInvites) ? 1 : 0,
    requireApproval: v.bool(body.requireApproval) ? 1 : 0,
    showProjects: v.bool(body.showProjects) ? 1 : 0,
    allowPublicVoting: v.bool(body.allowPublicVoting) ? 1 : 0,
    allowComments: v.bool(body.allowComments) ? 1 : 0,
    requireRepo: v.bool(body.requireRepo) ? 1 : 0,
    requireDemo: v.bool(body.requireDemo) ? 1 : 0,
    requireVideo: v.bool(body.requireVideo) ? 1 : 0,
    requireScreenshots: v.bool(body.requireScreenshots) ? 1 : 0,
    submissionChecklist: v.list(body.submissionChecklist, { max: 20, maxItemLength: 160 }),
    codeOfConduct: v.text(body.codeOfConduct, { field: 'codeOfConduct', label: 'Code of conduct', errors, max: 4000 }),
    rules: v.text(body.rules, { field: 'rules', label: 'Rules', errors, max: 8000 }),
  };

  if (!values.startsAt) errors.add('startsAt', 'The hackathon needs a start time.');
  if (!values.endsAt) errors.add('endsAt', 'The hackathon needs an end time.');
  if (!values.submissionsCloseAt) errors.add('submissionsCloseAt', 'Submissions need a deadline. The server refuses writes after it.');
  if (values.startsAt && values.endsAt && Date.parse(values.endsAt) <= Date.parse(values.startsAt)) {
    errors.add('endsAt', 'The end time must be after the start time.');
  }
  if (values.startsAt && values.submissionsCloseAt && Date.parse(values.submissionsCloseAt) < Date.parse(values.startsAt)) {
    errors.add('submissionsCloseAt', 'The submission deadline cannot be before the hackathon starts.');
  }
  if (values.registrationOpensAt && values.registrationClosesAt
      && Date.parse(values.registrationClosesAt) <= Date.parse(values.registrationOpensAt)) {
    errors.add('registrationClosesAt', 'Registration must close after it opens.');
  }
  if (values.minTeamSize > values.maxTeamSize) {
    errors.add('maxTeamSize', 'The maximum team size must be at least the minimum.');
  }
  if (isNew && !values.startsAt) {
    // A brand new event with a deadline in the past is almost certainly a
    // typo, and it would make the event unenterable.
    void 0;
  }
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: values.timezone });
  } catch {
    errors.add('timezone', 'That is not a recognised timezone. Use an IANA name such as Europe/London.');
  }
  return { values, errors };
}

/**
 * Archive or restore an event. Archiving hides it from the directory without
 * touching a single record, which is what an organiser who created an event by
 * mistake actually wants — and what the human critic uses to clean up after
 * itself.
 */
router.post('/o/:slug/archive', (req, res) => {
  const event = req.organiserEvent;
  const archiving = event.status !== 'archived';
  db().prepare('UPDATE events SET status = ?, updated_at = ? WHERE id = ?')
    .run(archiving ? 'archived' : 'published', now(), event.id);
  audit.record({
    actor: req.actor, eventId: event.id,
    action: archiving ? 'event.archive' : 'event.unarchive', resourceType: 'event', resourceId: event.id,
  });
  res.redirect('/o');
});

/* ----------------------------------------------------------------- tracks */

router.get('/o/:slug/tracks', (req, res) => {
  res.locals.consoleActions = consoleActions(req);
  const event = req.organiserEvent;
  res.send(views.tracksPage({ user: req.actor.user, extraActions: consoleActions(req),
    event: queries.publicEventColumns(event),
    tracks: queries.tracksFor(event.id),
    challenges: db().prepare('SELECT * FROM challenges WHERE event_id = ? ORDER BY position, name').all(event.id),
  }));
});

router.post('/o/:slug/tracks', (req, res, next) => {
  const event = req.organiserEvent;
  try {
    const errors = new v.FieldErrors();
    const name = v.text(req.body.name, { field: 'name', label: 'Track name', errors, required: true, min: 2, max: 70 });
    errors.throwIfAny();
    const existing = new Set(db().prepare('SELECT slug FROM tracks WHERE event_id = ?').all(event.id).map((t) => t.slug));
    db().prepare(`
      INSERT INTO tracks (id, event_id, slug, name, description, brief, sponsor, colour, position)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(id('trk'), event.id, uniqueSlug(existing, name, 'track'), name,
      String(req.body.description || '').slice(0, 200), String(req.body.brief || '').slice(0, 3000),
      String(req.body.sponsor || '').slice(0, 70), String(req.body.colour || 'ink'),
      db().prepare('SELECT COALESCE(MAX(position),0)+1 AS p FROM tracks WHERE event_id = ?').get(event.id).p);
    audit.record({ actor: req.actor, eventId: event.id, action: 'track.create', resourceType: 'track' });
    res.redirect(`/o/${event.slug}/tracks`);
  } catch (err) { next(err); }
});

router.post('/o/:slug/tracks/:id/delete', (req, res, next) => {
  const event = req.organiserEvent;
  const track = db().prepare('SELECT id FROM tracks WHERE id = ? AND event_id = ?').get(req.params.id, event.id);
  if (!track) throw new authz.HttpError(404, 'No such track.');
  db().prepare('UPDATE projects SET track_id = NULL WHERE track_id = ?').run(track.id);
  db().prepare('DELETE FROM tracks WHERE id = ?').run(track.id);
  audit.record({ actor: req.actor, eventId: event.id, action: 'track.delete', resourceType: 'track', resourceId: track.id });
  res.redirect(`/o/${event.slug}/tracks`);
});

router.post('/o/:slug/challenges', (req, res, next) => {
  const event = req.organiserEvent;
  const errors = new v.FieldErrors();
  const name = v.text(req.body.name, { field: 'name', label: 'Challenge name', errors, required: true, min: 4, max: 140 });
  errors.throwIfAny();
  db().prepare(`
    INSERT INTO challenges (id, event_id, name, description, sponsor, prize_label, position)
    VALUES (?,?,?,?,?,?,?)
  `).run(id('chl'), event.id, name, String(req.body.description || '').slice(0, 1200),
    String(req.body.sponsor || '').slice(0, 70), String(req.body.prizeLabel || '').slice(0, 80),
    db().prepare('SELECT COALESCE(MAX(position),0)+1 AS p FROM challenges WHERE event_id = ?').get(event.id).p);
  audit.record({ actor: req.actor, eventId: event.id, action: 'challenge.create', resourceType: 'challenge' });
  res.redirect(`/o/${event.slug}/tracks`);
});

router.post('/o/:slug/challenges/:id/delete', (req, res) => {
  const event = req.organiserEvent;
  db().prepare('DELETE FROM challenges WHERE id = ? AND event_id = ?').run(req.params.id, event.id);
  audit.record({ actor: req.actor, eventId: event.id, action: 'challenge.delete', resourceType: 'challenge', resourceId: req.params.id });
  res.redirect(`/o/${event.slug}/tracks`);
});

/* -------------------------------------------------------------- schedule */

router.get('/o/:slug/schedule', (req, res) => {
  res.locals.consoleActions = consoleActions(req);
  res.send(views.schedulePage({ user: req.actor.user, extraActions: consoleActions(req),
    event: queries.publicEventColumns(req.organiserEvent),
    items: queries.scheduleFor(req.organiserEvent.id),
  }));
});

router.post('/o/:slug/schedule', (req, res, next) => {
  const event = req.organiserEvent;
  try {
    const errors = new v.FieldErrors();
    const title = v.text(req.body.title, { field: 'title', label: 'Title', errors, required: true, max: 120 });
    const startsAt = v.isoOrNull(req.body.startsAt);
    errors.throwIfAny();
    if (!startsAt) throw new authz.HttpError(422, 'A schedule item needs a start time.');
    db().prepare(`
      INSERT INTO schedule_items (id, event_id, title, description, kind, location, starts_at, ends_at, position)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(id('sch'), event.id, title, String(req.body.description || '').slice(0, 200),
      String(req.body.kind || 'session'), String(req.body.location || '').slice(0, 90),
      startsAt, v.isoOrNull(req.body.endsAt),
      db().prepare('SELECT COALESCE(MAX(position),0)+1 AS p FROM schedule_items WHERE event_id = ?').get(event.id).p);
    audit.record({ actor: req.actor, eventId: event.id, action: 'schedule.create', resourceType: 'schedule' });
    res.redirect(`/o/${event.slug}/schedule`);
  } catch (err) { next(err); }
});

router.post('/o/:slug/schedule/:id/delete', (req, res) => {
  const event = req.organiserEvent;
  db().prepare('DELETE FROM schedule_items WHERE id = ? AND event_id = ?').run(req.params.id, event.id);
  audit.record({ actor: req.actor, eventId: event.id, action: 'schedule.delete', resourceType: 'schedule', resourceId: req.params.id });
  res.redirect(`/o/${event.slug}/schedule`);
});

/* ---------------------------------------------------------- requirements */

router.get('/o/:slug/requirements', (req, res) => {
  res.locals.consoleActions = consoleActions(req);
  res.send(views.requirementsPage({ user: req.actor.user, extraActions: consoleActions(req),
    event: queries.publicEventColumns(req.organiserEvent),
    fields: queries.submissionFieldsFor(req.organiserEvent.id),
  }));
});

router.post('/o/:slug/requirements', (req, res, next) => {
  const event = req.organiserEvent;
  try {
    const errors = new v.FieldErrors();
    const label = v.text(req.body.label, { field: 'label', label: 'Question', errors, required: true, min: 4, max: 160 });
    errors.throwIfAny();
    const key = slugify(String(req.body.key || label), 'question').replace(/-/g, '_');
    const existing = new Set(db().prepare('SELECT field_key FROM submission_fields WHERE event_id = ?').all(event.id).map((f) => f.field_key));
    db().prepare(`
      INSERT INTO submission_fields (id, event_id, field_key, label, help, kind, options, required, judges_see, position)
      VALUES (?,?,?,?,?,?, '[]', ?,?,?)
    `).run(id('sfd'), event.id, uniqueSlug(existing, key, 'question'), label,
      String(req.body.help || '').slice(0, 200), v.oneOf(req.body.kind, ['text', 'longtext', 'url'], { field: 'kind', label: 'Type', errors, fallback: 'text' }),
      v.bool(req.body.required) ? 1 : 0, v.bool(req.body.judgesSee) ? 1 : 0,
      db().prepare('SELECT COALESCE(MAX(position),0)+1 AS p FROM submission_fields WHERE event_id = ?').get(event.id).p);
    audit.record({ actor: req.actor, eventId: event.id, action: 'requirement.create', resourceType: 'submission_field' });
    res.redirect(`/o/${event.slug}/requirements`);
  } catch (err) { next(err); }
});

router.post('/o/:slug/requirements/:id/delete', (req, res) => {
  const event = req.organiserEvent;
  db().prepare('DELETE FROM submission_fields WHERE id = ? AND event_id = ?').run(req.params.id, event.id);
  audit.record({ actor: req.actor, eventId: event.id, action: 'requirement.delete', resourceType: 'submission_field', resourceId: req.params.id });
  res.redirect(`/o/${event.slug}/requirements`);
});

/* --------------------------------------------------------- registration */

router.get('/o/:slug/registration', (req, res) => {
  res.locals.consoleActions = consoleActions(req);
  const event = req.organiserEvent;
  const rows = db().prepare(`
    SELECT r.*, u.name, u.headline, u.organisation, u.avatar_hue FROM registrations r
    JOIN users u ON u.id = r.user_id WHERE r.event_id = ? ORDER BY r.registered_at
  `).all(event.id);

  const participants = rows.map((r) => {
    const team = authz.teamForUser(event.id, r.user_id);
    const project = team ? db().prepare('SELECT name FROM projects WHERE team_id = ? LIMIT 1').get(team.id) : null;
    return {
      userId: r.user_id,
      name: r.name,
      headline: r.headline,
      organisation: r.organisation,
      hue: r.avatar_hue,
      state: r.state,
      note: r.note,
      teamName: team ? team.name : '',
      projectName: project ? project.name : '',
    };
  });

  res.send(views.registrationPage({ user: req.actor.user, extraActions: consoleActions(req),
    event: queries.publicEventColumns(event),
    registrations: participants,
    pending: participants.filter((p) => p.state === 'pending'),
    teams: queries.teamsForEvent(event.id),
    participants,
  }));
});

router.post('/o/:slug/registrations/:userId/state', (req, res) => {
  const event = req.organiserEvent;
  const state = v.oneOf(req.body.state, ['confirmed', 'declined', 'waitlisted', 'withdrawn'], {
    field: 'state', label: 'State', errors: new v.FieldErrors(), fallback: 'confirmed',
  });
  const reg = db().prepare('SELECT id FROM registrations WHERE event_id = ? AND user_id = ?').get(event.id, req.params.userId);
  if (!reg) throw new authz.HttpError(404, 'That person is not registered.');
  db().prepare('UPDATE registrations SET state = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?')
    .run(state, now(), req.user.id, reg.id);
  audit.record({ actor: req.actor, eventId: event.id, action: `registration.${state}`, resourceType: 'registration', resourceId: reg.id });
  res.redirect(`/o/${event.slug}/registration`);
});

/* ----------------------------------------------------------------- teams */

router.get('/o/:slug/teams', (req, res) => {
  res.locals.consoleActions = consoleActions(req);
  const event = req.organiserEvent;
  res.send(views.teamsPage({ user: req.actor.user, extraActions: consoleActions(req),
    event: queries.publicEventColumns(event),
    teams: db().prepare('SELECT id FROM teams WHERE event_id = ? ORDER BY name').all(event.id).map((t) => {
      const detail = queries.teamDetail(t.id);
      return { ...detail, memberCount: detail.members.length, projects: detail.projects };
    }),
  }));
});

/* -------------------------------------------------------------- projects */

router.get('/o/:slug/projects', (req, res) => {
  res.locals.consoleActions = consoleActions(req);
  const event = req.organiserEvent;
  const projects = queries.projectsForEvent(event.id, { publicOnly: false });
  const withReviews = projects.map((p) => ({
    ...p,
    reviewCount: db().prepare(`
      SELECT COUNT(*) AS n FROM reviews WHERE project_id = ? AND state = 'submitted'
    `).get(p.id).n,
  }));
  const scores = {};
  for (const p of withReviews) scores[p.id] = judging.scoreProject(event.id, p.id);
  res.send(views.projectsPage({ user: req.actor.user, extraActions: consoleActions(req),
    event: queries.publicEventColumns(event), projects: withReviews, scores,
  }));
});

router.post('/o/:slug/projects/bulk', (req, res) => {
  const event = req.organiserEvent;
  const [verb, value] = String(req.body.action || '').split(':');
  const ids = [].concat(req.body.projectIds || []).map(String).filter(Boolean);
  for (const projectId of ids) {
    const project = db().prepare('SELECT id FROM projects WHERE id = ? AND event_id = ?').get(projectId, event.id);
    if (!project) continue;
    if (verb === 'public') {
      // Only submitted projects can enter the showcase.
      const target = db().prepare('SELECT status FROM projects WHERE id = ?').get(projectId);
      db().prepare('UPDATE projects SET is_public = ? WHERE id = ?')
        .run(target.status === 'submitted' ? (value === '1' ? 1 : 0) : 0, projectId);
    } else if (verb === 'withdraw') {
      db().prepare("UPDATE projects SET status = 'withdrawn' WHERE id = ?").run(projectId);
      db().prepare("UPDATE judge_assignments SET state = 'revoked' WHERE project_id = ?").run(projectId);
    } else if (verb === 'restore') {
      db().prepare("UPDATE projects SET status = 'submitted' WHERE id = ?").run(projectId);
    } else if (verb === 'disqualify') {
      db().prepare("UPDATE projects SET status = 'disqualified' WHERE id = ?").run(projectId);
      db().prepare("UPDATE judge_assignments SET state = 'revoked' WHERE project_id = ?").run(projectId);
    }
    audit.record({ actor: req.actor, eventId: event.id, action: `project.${verb}`, resourceType: 'project', resourceId: projectId });
  }
  res.redirect(`/o/${event.slug}/projects`);
});

router.get('/o/:slug/projects/:id', (req, res, next) => {
  res.locals.consoleActions = consoleActions(req);
  const event = req.organiserEvent;
  try {
    const project = db().prepare('SELECT * FROM projects WHERE id = ? AND event_id = ?').get(req.params.id, event.id);
    if (!project) throw new authz.HttpError(404, 'No such project.');
    res.send(views.projectInspectPage({ user: req.actor.user, extraActions: consoleActions(req),
      event: queries.publicEventColumns(event),
      project: queries.projectDetail(project, { forJudges: true }),
      submission: db().prepare('SELECT * FROM project_submissions WHERE project_id = ? ORDER BY version DESC').all(project.id),
      reviews: db().prepare(`
        SELECT r.*, j.name AS judge_name FROM reviews r JOIN judges j ON j.id = r.judge_id
        WHERE r.project_id = ? ORDER BY r.state
      `).all(project.id).map((r) => ({ judgeName: r.judge_name, state: r.state, totalScore: r.total_score })),
      redacted: true,
      scores: judging.scoreProject(event.id, project.id),
    }));
  } catch (err) { next(err); }
});

/* ----------------------------------------------------------------- rubric */

router.get('/o/:slug/rubric', (req, res) => {
  res.locals.consoleActions = consoleActions(req);
  res.send(views.rubricPage({ user: req.actor.user, extraActions: consoleActions(req),
    event: queries.publicEventColumns(req.organiserEvent),
    criteria: judging.criteriaFor(req.organiserEvent.id),
  }));
});

router.post('/o/:slug/rubric', (req, res, next) => {
  const event = req.organiserEvent;
  try {
    const errors = new v.FieldErrors();
    const name = v.text(req.body.name, { field: 'name', label: 'Criterion name', errors, required: true, min: 2, max: 80 });
    const weight = Number(req.body.weight || 1);
    const maxScore = Number(req.body.maxScore || 5);
    if (!Number.isFinite(weight) || weight < 0.1 || weight > 10) errors.add('weight', 'Weight must be between 0.1 and 10.');
    if (!Number.isFinite(maxScore) || maxScore < 1 || maxScore > 10) errors.add('maxScore', 'Maximum must be between 1 and 10.');
    errors.throwIfAny();
    const existing = new Set(db().prepare('SELECT field_key FROM rubric_criteria WHERE event_id = ?').all(event.id).map((c) => c.field_key));
    db().prepare(`
      INSERT INTO rubric_criteria (id, event_id, field_key, name, description, weight, max_score, position)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(id('crt'), event.id, uniqueSlug(existing, name, 'criterion'), name,
      String(req.body.description || '').slice(0, 300), weight, maxScore,
      db().prepare('SELECT COALESCE(MAX(position),0)+1 AS p FROM rubric_criteria WHERE event_id = ?').get(event.id).p);
    audit.record({ actor: req.actor, eventId: event.id, action: 'rubric.create', resourceType: 'rubric_criterion' });
    res.redirect(`/o/${event.slug}/rubric`);
  } catch (err) { next(err); }
});

router.post('/o/:slug/rubric/:id/delete', (req, res) => {
  const event = req.organiserEvent;
  const submitted = db().prepare(`
      SELECT COUNT(*) AS n FROM review_scores rs JOIN reviews r ON r.id = rs.review_id
      WHERE rs.criterion_id = ? AND r.event_id = ?
    `).get(req.params.id, event.id).n;
  if (submitted > 0) {
    throw new authz.HttpError(409, 'Judges have already scored against this criterion, so it cannot be deleted. Reduce its weight instead.');
  }
  db().prepare('DELETE FROM rubric_criteria WHERE id = ? AND event_id = ?').run(req.params.id, event.id);
  audit.record({ actor: req.actor, eventId: event.id, action: 'rubric.delete', resourceType: 'rubric_criterion', resourceId: req.params.id });
  res.redirect(`/o/${event.slug}/rubric`);
});

/* ----------------------------------------------------------------- judges */

router.get('/o/:slug/judges', (req, res) => {
  res.locals.consoleActions = consoleActions(req);
  const event = req.organiserEvent;
  const judges = db().prepare('SELECT * FROM judges WHERE event_id = ? ORDER BY state, name').all(event.id)
    .map((j) => ({
      ...j,
      assigned: db().prepare('SELECT COUNT(*) AS n FROM judge_assignments WHERE judge_id = ? AND state != \'revoked\'').get(j.id).n,
      submitted: db().prepare("SELECT COUNT(*) AS n FROM reviews WHERE judge_id = ? AND state = 'submitted'").get(j.id).n,
      tracks: db().prepare('SELECT t.name FROM judge_tracks jt JOIN tracks t ON t.id = jt.track_id WHERE jt.judge_id = ?').all(j.id).map((r) => r.name),
    }));
  const inviteLink = judges.find((j) => j.state === 'invited')
    ? `${require('../config').publicOrigin}/judge/verify/${event.slug}`
    : null;
  res.send(views.judgesPage({ user: req.actor.user, extraActions: consoleActions(req), event: queries.publicEventColumns(event), judges, inviteLink }));
});

router.post('/o/:slug/judges', (req, res, next) => {
  const event = req.organiserEvent;
  try {
    const errors = new v.FieldErrors();
    const name = v.text(req.body.name, { field: 'name', label: 'Name', errors, required: true, min: 2, max: 90 });
    const email = v.email(req.body.email, { errors });
    const headline = v.text(req.body.headline, { field: 'headline', label: 'Role', errors, max: 90 });
    errors.throwIfAny();

    if (db().prepare('SELECT 1 AS ok FROM judges WHERE event_id = ? AND email_key = ?').get(event.id, email)) {
      throw new authz.HttpError(409, 'That person is already on the panel.');
    }

    // A one-time access code, stored hashed. The organiser sees it once.
    const code = `HLY-${token(4).replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8)}`;
    const creds = hashPassword(code);
    const judgeId = id('jdg');
    db().prepare(`
      INSERT INTO judges (id, event_id, name, email_key, headline, organisation, state,
        access_code_hash, access_code_salt, invite_code, invited_by, invited_at)
      VALUES (?,?,?,?,?,'', 'invited', ?,?,?,?,?)
    `).run(judgeId, event.id, name, email, headline, creds.hash, creds.salt, code, req.user.id, now());

    const trackNames = v.list(req.body.tracks, { max: 8, maxItemLength: 60 });
    for (const trackName of trackNames) {
      const track = db().prepare('SELECT id FROM tracks WHERE event_id = ? AND lower(name) = lower(?)').get(event.id, trackName);
      if (track) db().prepare('INSERT OR IGNORE INTO judge_tracks (judge_id, track_id) VALUES (?,?)').run(judgeId, track.id);
    }

    audit.record({ actor: req.actor, eventId: event.id, action: 'judge.invite', resourceType: 'judge', resourceId: judgeId, detail: email });
    res.redirect(`/o/${event.slug}/judges?invited=${encodeURIComponent(code)}`);
  } catch (err) { next(err); }
});

router.post('/o/:slug/judges/:id/verify', (req, res) => {
  const event = req.organiserEvent;
  const judge = db().prepare('SELECT * FROM judges WHERE id = ? AND event_id = ?').get(req.params.id, event.id);
  if (!judge) throw new authz.HttpError(404, 'No such judge.');
  db().prepare("UPDATE judges SET state = 'verified', verified_at = ? WHERE id = ?").run(now(), judge.id);
  audit.record({ actor: req.actor, eventId: event.id, action: 'judge.verify', resourceType: 'judge', resourceId: judge.id });
  res.redirect(`/o/${event.slug}/judges`);
});

router.post('/o/:slug/judges/:id/remove', (req, res) => {
  const event = req.organiserEvent;
  const judge = db().prepare('SELECT * FROM judges WHERE id = ? AND event_id = ?').get(req.params.id, event.id);
  if (!judge) throw new authz.HttpError(404, 'No such judge.');
  db().prepare("UPDATE judges SET state = 'removed' WHERE id = ?").run(judge.id);
  db().prepare("UPDATE judge_assignments SET state = 'revoked' WHERE judge_id = ?").run(judge.id);
  audit.record({ actor: req.actor, eventId: event.id, action: 'judge.remove', resourceType: 'judge', resourceId: judge.id });
  res.redirect(`/o/${event.slug}/judges`);
});

/* ------------------------------------------------------------ assignments */

router.get('/o/:slug/assignments', (req, res) => {
  res.locals.consoleActions = consoleActions(req);
  const event = req.organiserEvent;
  const projects = queries.projectsForEvent(event.id, { publicOnly: false });
  const judges = db().prepare("SELECT * FROM judges WHERE event_id = ? AND state = 'verified' ORDER BY name").all(event.id);
  const assignmentMap = {};
  for (const p of projects) {
    assignmentMap[p.id] = db().prepare("SELECT * FROM judge_assignments WHERE project_id = ? AND state != 'revoked'").all(p.id);
  }
  res.send(views.assignmentsPage({ user: req.actor.user, extraActions: consoleActions(req),
    event: queries.publicEventColumns(event), projects, judges, assignmentMap,
    tracks: queries.tracksFor(event.id),
  }));
});

router.post('/o/:slug/assignments/toggle', (req, res) => {
  const event = req.organiserEvent;
  const project = db().prepare('SELECT id FROM projects WHERE id = ? AND event_id = ?').get(String(req.body.projectId), event.id);
  const judge = db().prepare('SELECT id FROM judges WHERE id = ? AND event_id = ?').get(String(req.body.judgeId), event.id);
  if (!project || !judge) throw new authz.HttpError(404, 'No such project or judge.');
  if (req.body.next === '1') {
    db().prepare(`
      INSERT OR IGNORE INTO judge_assignments (id, event_id, judge_id, project_id, state, assigned_at)
      VALUES (?,?,?,?, 'assigned', ?)
    `).run(id('asg'), event.id, judge.id, project.id, now());
    audit.record({ actor: req.actor, eventId: event.id, action: 'assignment.create', resourceType: 'judge_assignment', resourceId: project.id });
  } else {
    db().prepare("UPDATE judge_assignments SET state = 'revoked' WHERE judge_id = ? AND project_id = ?").run(judge.id, project.id);
    audit.record({ actor: req.actor, eventId: event.id, action: 'assignment.revoke', resourceType: 'judge_assignment', resourceId: project.id });
  }
  res.redirect(`/o/${event.slug}/assignments`);
});

router.post('/o/:slug/assignments/auto', (req, res) => {
  const event = req.organiserEvent;
  const perJudge = Math.max(1, Math.min(10, Number(req.body.perJudge) || 3));
  const judges = db().prepare("SELECT * FROM judges WHERE event_id = ? AND state = 'verified'").all(event.id);
  if (!judges.length) throw new authz.HttpError(409, 'Verify at least one judge first.');

  const projects = db().prepare("SELECT * FROM projects WHERE event_id = ? AND status = 'submitted'").all(event.id);
  let created = 0;
  for (const project of projects) {
    const trackJudges = judges.filter((j) => db().prepare(`
      SELECT 1 AS ok FROM judge_tracks WHERE judge_id = ? AND track_id = ?
    `).get(j.id, project.track_id));
    const pool = trackJudges.length ? trackJudges : judges;
    // Round-robin so the load is spread rather than filling one judge first.
    for (let k = 0; k < perJudge; k += 1) {
      const judge = pool[(created + k) % pool.length];
      const result = db().prepare(`
        INSERT OR IGNORE INTO judge_assignments (id, event_id, judge_id, project_id, state, assigned_at)
        VALUES (?,?,?,?, 'assigned', ?)
      `).run(id('asg'), event.id, judge.id, project.id, now());
      if (result.changes) created += 1;
    }
  }
  audit.record({ actor: req.actor, eventId: event.id, action: 'assignment.auto', resourceType: 'judge_assignment', detail: `${created} created` });
  res.redirect(`/o/${event.slug}/assignments`);
});

router.post('/o/:slug/assignments/clear', (req, res) => {
  const event = req.organiserEvent;
  db().prepare("UPDATE judge_assignments SET state = 'revoked' WHERE event_id = ? AND state != 'revoked'").run(event.id);
  audit.record({ actor: req.actor, eventId: event.id, action: 'assignment.clear', resourceType: 'judge_assignment' });
  res.redirect(`/o/${event.slug}/assignments`);
});

/* ---------------------------------------------------------- announcements */

router.get('/o/:slug/announcements', (req, res) => {
  res.locals.consoleActions = consoleActions(req);
  res.send(views.announcementsPage({ user: req.actor.user, extraActions: consoleActions(req),
    event: queries.publicEventColumns(req.organiserEvent),
    announcements: db().prepare('SELECT * FROM announcements WHERE event_id = ? ORDER BY pinned DESC, created_at DESC').all(req.organiserEvent.id),
  }));
});

router.post('/o/:slug/announcements', (req, res, next) => {
  const event = req.organiserEvent;
  try {
    const errors = new v.FieldErrors();
    const title = v.text(req.body.title, { field: 'title', label: 'Title', errors, required: true, min: 3, max: 140 });
    const body = v.text(req.body.body, { field: 'body', label: 'Body', errors, required: true, min: 3, max: 4000 });
    errors.throwIfAny();
    const announcementId = id('ann');
    db().prepare(`
      INSERT INTO announcements (id, event_id, title, body, kind, pinned, author_id, created_at)
      VALUES (?,?,?,?, 'update', ?,?,?)
    `).run(announcementId, event.id, title, body, v.bool(req.body.pinned) ? 1 : 0, req.user.id, now());
    audit.record({ actor: req.actor, eventId: event.id, action: 'announcement.create', resourceType: 'announcement', resourceId: announcementId });
    res.redirect(`/o/${event.slug}/announcements`);
  } catch (err) { next(err); }
});

router.post('/o/:slug/announcements/:id/delete', (req, res) => {
  const event = req.organiserEvent;
  db().prepare('DELETE FROM announcements WHERE id = ? AND event_id = ?').run(req.params.id, event.id);
  audit.record({ actor: req.actor, eventId: event.id, action: 'announcement.delete', resourceType: 'announcement', resourceId: req.params.id });
  res.redirect(`/o/${event.slug}/announcements`);
});

/* ---------------------------------------------------------------- results */

router.get('/o/:slug/results', (req, res) => {
  res.locals.consoleActions = consoleActions(req);
  const event = req.organiserEvent;
  const computed = db().prepare('SELECT COUNT(*) AS n FROM results WHERE event_id = ?').get(event.id).n > 0;
  const standings = computed
    ? db().prepare(`
        SELECT r.*, p.name, p.slug, p.tech_stack, t.name AS track_name
        FROM results r JOIN projects p ON p.id = r.project_id
        LEFT JOIN tracks t ON t.id = p.track_id
        WHERE r.event_id = ? ORDER BY r.rank
      `).all(event.id).map((r) => ({
        ...r,
        name: r.name,
        trackName: r.track_name,
        techStack: json(r.tech_stack, []),
        teamName: (db().prepare('SELECT t.name FROM teams t JOIN projects p ON p.team_id = t.id WHERE p.id = ?').get(r.project_id) || {}).name,
      }))
    : [];
  res.send(views.resultsPage({ user: req.actor.user, extraActions: consoleActions(req),
    event: queries.publicEventColumns(event),
    computed,
    standings,
    published: authz.resultsArePublic(event),
    spread: queries.scoreSpread(event.id),
    hasReviews: db().prepare("SELECT 1 AS ok FROM reviews WHERE event_id = ? AND state = 'submitted'").get(event.id) !== undefined,
  }));
});

/** Recompute standings. Publishing is a separate, explicit act. */
router.post('/o/:slug/results/compute', (req, res) => {
  const event = req.organiserEvent;
  const standings = judging.standings(event.id);
  const published = authz.resultsArePublic(event);

  db().prepare('DELETE FROM results WHERE event_id = ?').run(event.id);
  for (const s of standings) {
    const project = db().prepare('SELECT * FROM projects WHERE id = ?').get(s.id);
    const existingAward = project ? '' : '';
    const parts = [];
    if (s.rank === 1) parts.push('Overall winner');
    else if (s.rank === 2) parts.push('Second place');
    else if (s.rank === 3) parts.push('Third place');
    if (s.track_rank === 1 && s.trackName) parts.push(`Best in ${s.trackName}`);
    db().prepare(`
      INSERT INTO results (id, event_id, project_id, rank, track_rank, weighted_score, normalised_score,
        public_votes, award, published, published_at, computed_at)
      VALUES (?,?,?,?,?,?,?,0,?,?,?,?)
    `).run(id('res'), event.id, s.id, s.rank, s.track_rank, s.weighted, s.final, parts.join(' · '),
      published ? 1 : 0, published ? now() : null, now());
    void existingAward;
  }
  audit.record({ actor: req.actor, eventId: event.id, action: 'results.compute', resourceType: 'results', detail: `${standings.length} rows` });
  res.redirect(`/o/${event.slug}/results`);
});

router.post('/o/:slug/results/publish', (req, res) => {
  const event = req.organiserEvent;
  const releasing = !authz.resultsArePublic(event);
  if (releasing) {
    const rows = db().prepare('SELECT COUNT(*) AS n FROM results WHERE event_id = ?').get(event.id).n;
    if (!rows) throw new authz.HttpError(409, 'Compute the standings before publishing them.');
  }
  db().prepare('UPDATE events SET results_released = ?, updated_at = ? WHERE id = ?')
    .run(releasing ? 1 : 0, now(), event.id);
  db().prepare('UPDATE results SET published = ?, published_at = ? WHERE event_id = ?')
    .run(releasing ? 1 : 0, releasing ? now() : null, event.id);
  audit.record({
    actor: req.actor, eventId: event.id,
    action: releasing ? 'results.publish' : 'results.unpublish',
    resourceType: 'results', resourceId: event.id,
  });
  res.redirect(`/o/${event.slug}/results`);
});

/* --------------------------------------------------------------- activity */

router.get('/o/:slug/activity', (req, res) => {
  res.locals.consoleActions = consoleActions(req);
  res.send(views.activityPage({ user: req.actor.user, extraActions: consoleActions(req),
    event: queries.publicEventColumns(req.organiserEvent),
    entries: audit.forEvent(req.organiserEvent.id, 200),
  }));
});

module.exports = router;
