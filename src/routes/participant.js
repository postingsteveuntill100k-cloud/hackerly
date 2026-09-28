'use strict';

const express = require('express');
const { db } = require('../db');
const authz = require('../lib/authz');
const audit = require('../lib/audit');
const lifecycle = require('../lib/lifecycle');
const queries = require('../lib/queries');
const judging = require('../lib/judging');
const views = require('../views/participant');
const v = require('../lib/validate');
const { id, now, token, slugify, hashInt } = require('../lib/ids');
const { sha256 } = require('../lib/auth');
const { json } = require('../lib/html');

const router = express.Router();

/* ------------------------------------------------------------- dashboard */

router.get('/dashboard', (req, res, next) => {
  try {
    const user = authz.requireUser(req.actor);

    const rows = db().prepare(`
      SELECT DISTINCT e.* FROM events e
      JOIN event_roles r ON r.event_id = e.id
      WHERE r.user_id = ? AND e.status != 'draft'
      ORDER BY e.starts_at DESC
    `).all(user.id);

    const organising = [];
    const judgingQueue = [];
    const upcoming = [];
    const past = [];

    for (const e of rows) {
      const event = queries.publicEventColumns(e);
      const phase = lifecycle.phase(e);
      const isStaff = authz.isStaff(user.id, e.id);
      const judge = authz.judgeRecord(user.id, e.id);
      const registered = authz.isRegistered(user.id, e.id);
      const stats = queries.eventStats(e.id);

      if (isStaff) {
        const snapshot = queries.organiserSnapshot(e.id);
        organising.push({
          ...event,
          phase,
          badge: `${stats.registrations} registered`,
          detail: `${stats.projects} submission${stats.projects === 1 ? '' : 's'} · ${snapshot.reviewsDone} of ${snapshot.assigned} reviews in`,
          action: 'Open console',
        });
        continue;
      }

      if (judge && judge.state === 'verified') {
        const summary = queries.assignmentSummary(judge.id);
        judgingQueue.push({
          ...event,
          phase,
          badge: `${summary.done}/${summary.total} reviewed`,
          detail: summary.remaining
            ? `${summary.remaining} still to review in your queue.`
            : 'Your queue is clear.',
          action: summary.remaining ? 'Keep reviewing' : 'View progress',
        });
      }

      if (registered) {
        const team = authz.teamForUser(e.id, user.id);
        const project = team
          ? db().prepare("SELECT * FROM projects WHERE team_id = ? ORDER BY created_at DESC LIMIT 1").get(team.id)
          : null;
        const target = phase === 'results' ? past : upcoming;
        target.push({
          ...event,
          phase,
          badge: project ? (project.status === 'submitted' ? 'Submitted' : 'In progress') : (team ? 'Teamed up' : 'Registered'),
          detail: project
            ? `${project.name} — ${project.status === 'submitted' ? 'with the judges' : 'still being built'}`
            : team
              ? `${team.name} — no project yet`
              : 'Registered. Create a team or go solo to start building.',
          action: project ? 'Open your project' : team ? 'Manage your team' : 'Get started',
        });
      }
    }

    // Results a participant is actually allowed to see.
    const published = rows
      .filter((e) => authz.isRegistered(user.id, e.id) || authz.isStaff(user.id, e.id))
      .filter((e) => authz.resultsArePublic(e));

    res.send(views.dashboard({
      user: req.actor.user,
      organising,
      judging: judgingQueue,
      upcoming,
      past,
      roles: rows.length,
    }));
    void published;
  } catch (err) { next(err); }
});

/* -------------------------------------------------- participant workspace */

router.get('/p/:slug', (req, res, next) => {
  try {
    const user = authz.requireUser(req.actor);
    const event = authz.requireEvent(req.params.slug, req.actor);
    const staff = authz.isStaff(user.id, event.id);

    // A signed-in visitor who has not registered is not an error. They get the
    // registration form on the same page they will work in afterwards.
    if (!staff && !authz.isRegistered(user.id, event.id)) {
      return res.send(views.registrationPage({
        event: queries.publicEventColumns(event),
        viewer: { user: req.actor.user },
        gates: buildGates(event, { registration: null, team: null, project: null, user }),
        stats: queries.eventStats(event.id),
      }));
    }

    const registration = authz.registrationFor(user.id, event.id);
    const team = authz.teamForUser(event.id, user.id);
    const project = team
      ? db().prepare('SELECT * FROM projects WHERE team_id = ? ORDER BY created_at DESC LIMIT 1').get(team.id)
      : null;

    const gates = buildGates(event, { registration, team, project, user });
    const checklist = buildChecklist(event, project ? projectView(project) : null);
    const results = buildParticipantResults(event, project, user);

    const announcementCount = db().prepare('SELECT COUNT(*) AS n FROM announcements WHERE event_id = ?').get(event.id).n;

    res.send(views.participantPage({
      event: queries.publicEventColumns(event),
      viewer: { user: req.actor.user },
      registration: registration ? {
        state: registration.state,
        stateLabel: {
          confirmed: 'Confirmed', pending: 'Awaiting review',
          waitlisted: 'Waitlisted', declined: 'Declined', withdrawn: 'Withdrawn',
        }[registration.state],
        registeredAt: registration.registered_at,
        answers: registration.note ? { 'Note to organisers': registration.note } : {},
      } : null,
      team: team ? teamView(team, user.id) : null,
      project: project ? projectView(project) : null,
      checklist,
      gates,
      results,
      announcementCount,
    }));
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------- register */

router.post('/p/:slug/register', (req, res, next) => {
  try {
    const user = authz.requireUser(req.actor);
    const event = authz.requireEvent(req.params.slug, req.actor);

    // The gate is the authority. A closed event refuses regardless of the form.
    const gate = lifecycle.registrationGate(event);
    if (!req.body.rules) throw new authz.HttpError(422, 'You need to accept the rules to register.');

    const existing = authz.registrationFor(user.id, event.id);
    if (existing && existing.state !== 'withdrawn') {
      return res.redirect(`/p/${event.slug}`);
    }

    const note = String(req.body.note || '').trim().slice(0, 600);
    if (existing) {
      db().prepare(`
        UPDATE registrations SET state = ?, note = ?, registered_at = ?, reviewed_at = NULL, reviewed_by = NULL
        WHERE id = ?
      `).run(gate.needsApproval ? 'pending' : 'confirmed', note, now(), existing.id);
    } else {
      db().prepare(`
        INSERT INTO registrations (id, event_id, user_id, state, note, registered_at)
        VALUES (?,?,?,?,?,?)
      `).run(id('reg'), event.id, user.id, gate.needsApproval ? 'pending' : 'confirmed', note, now());
    }
    db().prepare(`
      INSERT OR IGNORE INTO event_roles (id, event_id, user_id, role, created_at) VALUES (?,?,?,'participant',?)
    `).run(id('rol'), event.id, user.id, now());

    audit.record({ actor: req.actor, eventId: event.id, action: 'registration.create', resourceType: 'event', resourceId: event.id });
    res.redirect(`/p/${event.slug}`);
  } catch (err) { next(err); }
});

/* ------------------------------------------------------------------ team */

router.get('/p/:slug/team', (req, res, next) => {
  try {
    const user = authz.requireUser(req.actor);
    const event = authz.requireEvent(req.params.slug, req.actor);
    authz.requireParticipant(event, req.actor);
    const team = authz.teamForUser(event.id, user.id);

    res.send(views.teamPage({
      event: queries.publicEventColumns(event),
      viewer: { user: req.actor.user },
      team: team ? teamView(team, user.id) : null,
      invitations: team
        ? db().prepare("SELECT email FROM team_invitations WHERE team_id = ? AND state = 'pending'").all(team.id)
        : [],
      gate: { error: null },
    }));
  } catch (err) { next(err); }
});

router.post('/p/:slug/team/create', (req, res, next) => {
  try {
    const user = authz.requireUser(req.actor);
    const event = authz.requireEvent(req.params.slug, req.actor);
    authz.requireParticipant(event, req.actor);

    if (authz.teamForUser(event.id, user.id)) {
      return res.redirect(`/p/${event.slug}/team`);
    }

    const errors = new v.FieldErrors();
    const name = v.text(req.body.name, { field: 'name', label: 'Team name', errors, required: true, min: 2, max: 60 });
    const tagline = v.text(req.body.tagline, { field: 'tagline', label: 'Description', errors, max: 120 });
    errors.throwIfAny();

    const teamId = id('tm');
    const existing = new Set(db().prepare('SELECT slug FROM teams WHERE event_id = ?').all(event.id).map((t) => t.slug));
    db().prepare(`
      INSERT INTO teams (id, event_id, slug, name, tagline, invite_code, is_final, created_by, created_at, updated_at)
      VALUES (?,?,?,?,?,?,0,?,?,?)
    `).run(teamId, event.id, require('../lib/ids').uniqueSlug(existing, name, 'team'), name, tagline,
      inviteCode(), user.id, now(), now());
    db().prepare('INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?,?,?,?)')
      .run(teamId, user.id, 'lead', now());

    audit.record({ actor: req.actor, eventId: event.id, action: 'team.create', resourceType: 'team', resourceId: teamId });
    res.redirect(`/p/${event.slug}/team`);
  } catch (err) { next(err); }
});

router.post('/p/:slug/join', (req, res, next) => {
  try {
    const user = authz.requireUser(req.actor);
    const event = authz.requireEvent(req.params.slug, req.actor);
    authz.requireParticipant(event, req.actor);

    if (authz.teamForUser(event.id, user.id)) return res.redirect(`/p/${event.slug}/team`);

    const code = String(req.body.code || '').trim().toUpperCase();
    const team = db().prepare('SELECT * FROM teams WHERE event_id = ? AND invite_code = ?')
      .get(event.id, code);
    if (!team) throw new authz.HttpError(404, 'No team in this hackathon has that invite code.');

    const count = db().prepare('SELECT COUNT(*) AS n FROM team_members WHERE team_id = ?').get(team.id).n;
    if (count >= event.max_team_size) {
      throw new authz.HttpError(409, `${team.name} is already full at ${event.max_team_size} members.`);
    }
    db().prepare('INSERT OR IGNORE INTO team_members (team_id, user_id, role, joined_at) VALUES (?,?,?,?)')
      .run(team.id, user.id, 'member', now());
    audit.record({ actor: req.actor, eventId: event.id, action: 'team.join', resourceType: 'team', resourceId: team.id });
    res.redirect(`/p/${event.slug}/team`);
  } catch (err) { next(err); }
});

router.post('/p/:slug/team/invite', (req, res, next) => {
  try {
    const user = authz.requireUser(req.actor);
    const event = authz.requireEvent(req.params.slug, req.actor);
    authz.requireParticipant(event, req.actor);
    if (event.allow_team_invites !== 1) throw new authz.HttpError(403, 'This hackathon does not allow invites.');
    const team = authz.teamForUser(event.id, user.id);
    if (!team) throw new authz.HttpError(409, 'Create a team first.');

    const errors = new v.FieldErrors();
    const email = v.email(req.body.email, { errors });
    errors.throwIfAny();

    const existing = db().prepare("SELECT id FROM team_invitations WHERE team_id = ? AND email = ? AND state = 'pending'")
      .get(team.id, email);
    if (!existing) {
      db().prepare(`
        INSERT INTO team_invitations (id, team_id, event_id, email, role, token_hash, state, invited_by, created_at, expires_at)
        VALUES (?,?,?,?, 'member', ?, 'pending', ?,?,?)
      `).run(id('tiv'), team.id, event.id, email, sha256(token(24)), user.id, now(),
        new Date(Date.now() + 14 * 86400_000).toISOString());
    }
    audit.record({ actor: req.actor, eventId: event.id, action: 'team.invite', resourceType: 'team', resourceId: team.id, detail: email });
    res.redirect(`/p/${event.slug}/team`);
  } catch (err) { next(err); }
});

router.post('/p/:slug/team/remove', (req, res, next) => {
  try {
    const user = authz.requireUser(req.actor);
    const event = authz.requireEvent(req.params.slug, req.actor);
    const team = authz.teamForUser(event.id, user.id);
    if (!team) throw new authz.HttpError(404, 'You are not on a team.');
    const member = db().prepare('SELECT role FROM team_members WHERE team_id = ? AND user_id = ?')
      .get(team.id, user.id);
    if (!member || member.role !== 'lead') throw new authz.HttpError(403, 'Only the team lead can remove members.');
    const target = String(req.body.userId || '');
    if (target === user.id) throw new authz.HttpError(409, 'Transfer the lead role before leaving.');
    db().prepare('DELETE FROM team_members WHERE team_id = ? AND user_id = ?').run(team.id, target);
    audit.record({ actor: req.actor, eventId: event.id, action: 'team.remove_member', resourceType: 'team', resourceId: team.id });
    res.redirect(`/p/${event.slug}/team`);
  } catch (err) { next(err); }
});

router.post('/p/:slug/team/dissolve', (req, res, next) => {
  try {
    const user = authz.requireUser(req.actor);
    const event = authz.requireEvent(req.params.slug, req.actor);
    const team = authz.teamForUser(event.id, user.id);
    if (!team) throw new authz.HttpError(404, 'You are not on a team.');
    const member = db().prepare('SELECT role FROM team_members WHERE team_id = ? AND user_id = ?')
      .get(team.id, user.id);
    if (!member || member.role !== 'lead') throw new authz.HttpError(403, 'Only the team lead can dissolve a team.');
    if (!event.allow_solo && !team.members) { /* no-op */ }
    // Members are released, not deleted, so their registration survives.
    const members = db().prepare('SELECT user_id FROM team_members WHERE team_id = ?').all(team.id);
    db().prepare('DELETE FROM team_members WHERE team_id = ?').run(team.id);
    const hasProject = db().prepare('SELECT 1 AS ok FROM projects WHERE team_id = ?').get(team.id);
    if (!hasProject) {
      db().prepare('DELETE FROM teams WHERE id = ?').run(team.id);
    } else {
      // Keep the team so the project is not orphaned, but empty it.
      db().prepare("UPDATE teams SET is_final = 0, updated_at = ? WHERE id = ?").run(now(), team.id);
    }
    void members;
    audit.record({ actor: req.actor, eventId: event.id, action: 'team.dissolve', resourceType: 'team', resourceId: team.id });
    res.redirect(`/p/${event.slug}/team`);
  } catch (err) { next(err); }
});

/* ---------------------------------------------------------------- project */

router.get('/p/:slug/project', (req, res, next) => {
  try {
    const user = authz.requireUser(req.actor);
    const event = authz.requireEvent(req.params.slug, req.actor);
    authz.requireParticipant(event, req.actor);
    const project = loadOwnedProject(event, user);
    sendEditor(req, res, event, project, {});
  } catch (err) { next(err); }
});

/**
 * POST target for the acceptance checker and for any API client attempting a
 * submission. Refuses when the event's deadline has passed, and requires a
 * real team or a solo allowance. Returns JSON for API callers so a client
 * never has to parse HTML to find out why it failed.
 */
router.post('/p/:slug/project', (req, res, next) => {
  const wantsJson = req.get('accept') === 'application/json' || req.get('content-type') === 'application/json';
  try {
    const user = authz.requireUser(req.actor);
    const event = authz.requireEvent(req.params.slug, req.actor);
    authz.requireParticipant(event, req.actor);

    const existing = loadOwnedProject(event, user, { allowMissing: true });
    const errors = new v.FieldErrors();
    const name = v.text(req.body.name, { field: 'name', label: 'Project name', errors, required: true, min: 2, max: 80 });
    const tagline = v.text(req.body.tagline, { field: 'tagline', label: 'One-line summary', errors, required: true, min: 8, max: 140 });
    const description = v.text(req.body.description, { field: 'description', label: 'Description', errors, required: true, min: 40, max: 6000 });
    errors.throwIfAny();

    const team = authz.teamForUser(event.id, user.id);
    if (!team && !event.allow_solo) {
      throw new authz.HttpError(409, 'Create a team, or ask the organisers to allow solo entries.');
    }

    // Deadline enforcement, server side, on every write.
    lifecycle.submissionGate(event);
    if (existing && existing.status === 'submitted') lifecycle.editGate(event, existing);

    const trackId = db().prepare('SELECT 1 AS ok FROM tracks WHERE id = ? AND event_id = ?')
      .get(String(req.body.trackId || ''), event.id) ? String(req.body.trackId) : null;
    const techStack = v.list(req.body.techStack, { max: 10, maxItemLength: 30 });
    const fields = queries.submissionFieldsFor(event.id);
    const answers = {};
    for (const f of fields) {
      const value = String(req.body[`answer_${f.key}`] || '').trim();
      if (f.required && !value) errors.add(f.key, `${f.label} is required.`);
      if (value) answers[f.key] = value.slice(0, f.kind === 'longtext' ? 2000 : 400);
    }
    errors.throwIfAny();

    const submitting = req.body.action === 'submit';
    if (submitting) {
      assertRequirements(event, { name, tagline, description, repoUrl: v.text(req.body.repoUrl, { field: 'repoUrl', label: 'Repository URL', errors }), demoUrl: v.text(req.body.demoUrl, { field: 'demoUrl', label: 'Demo URL', errors }), videoUrl: v.text(req.body.videoUrl, { field: 'videoUrl', label: 'Video URL', errors }) }, fields, answers);
    }

    const urls = {
      repo: cleanUrl(req.body.repoUrl),
      demo: cleanUrl(req.body.demoUrl),
      video: cleanUrl(req.body.videoUrl),
    };

    const projectId = existing ? existing.id : id('prj');
    const slugBase = require('../lib/ids').uniqueSlug(
      new Set(db().prepare('SELECT slug FROM projects WHERE event_id = ? AND id != ?').all(event.id, projectId).map((p) => p.slug)),
      name, 'project',
    );
    const timestamp = now();

    if (existing) {
      db().prepare(`
        UPDATE projects SET name = ?, slug = ?, tagline = ?, description = ?, track_id = ?,
          tech_stack = ?, repo_url = ?, demo_url = ?, video_url = ?, answers = ?, updated_at = ?
        WHERE id = ?
      `).run(name, slugBase, tagline, description, trackId, JSON.stringify(techStack),
        urls.repo, urls.demo, urls.video, JSON.stringify(answers), timestamp, projectId);
    } else {
      const teamId = team ? team.id : ensureSoloTeam(event.id, user.id);
      db().prepare(`
        INSERT INTO projects (id, event_id, team_id, track_id, slug, name, tagline, description,
          tech_stack, repo_url, demo_url, video_url, cover_hue, screenshots, answers, status,
          is_public, created_at, updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, '[]', ?, 'draft', 0, ?, ?)
      `).run(projectId, event.id, teamId, trackId, slugBase, name, tagline, description,
        JSON.stringify(techStack), urls.repo, urls.demo, urls.video, hashInt(projectId, 360),
        JSON.stringify(answers), timestamp, timestamp);
    }

    if (submitting) {
      const version = db().prepare('SELECT COALESCE(MAX(version), 0) AS v FROM project_submissions WHERE project_id = ?')
        .get(projectId).v + 1;
      db().prepare(`
        INSERT INTO project_submissions (id, project_id, event_id, version, snapshot, submitted_at)
        VALUES (?,?,?,?,?,?)
      `).run(id('sub'), projectId, event.id, version, JSON.stringify({
        name, tagline, description, track_id: trackId, tech_stack: techStack,
        repo_url: urls.repo, demo_url: urls.demo, video_url: urls.video, answers,
      }), timestamp);
      db().prepare("UPDATE projects SET status = 'submitted', submitted_at = ?, is_public = 1 WHERE id = ?")
        .run(timestamp, projectId);
      audit.record({ actor: req.actor, eventId: event.id, action: 'project.submit', resourceType: 'project', resourceId: projectId, detail: `version ${version}` });
    } else {
      audit.record({ actor: req.actor, eventId: event.id, action: 'project.save', resourceType: 'project', resourceId: projectId });
    }

    if (wantsJson) {
      return res.status(submitting ? 201 : 200).json({
        ok: true,
        projectId,
        status: submitting ? 'submitted' : 'draft',
        version: submitting ? db().prepare('SELECT COALESCE(MAX(version),0) v FROM project_submissions WHERE project_id = ?').get(projectId).v : null,
      });
    }
    res.redirect(`/p/${event.slug}/project`);
  } catch (err) {
    if (wantsJson) return next(err);
    // Re-render the editor with the failure rather than losing their input.
    try {
      const user = authz.requireUser(req.actor);
      const event = authz.requireEvent(req.params.slug, req.actor);
      const project = loadOwnedProject(event, user, { allowMissing: true });
      return sendEditor(req, res, event, project, {
        errors: (err && err.fields) || { form: err.message },
        notice: err.message,
      }, err.statusCode);
    } catch {
      return next(err);
    }
  }
});

/* ---------------------------------------------------------------- helpers */

function sendEditor(req, res, event, project, { errors = {}, notice }, status = 200) {
  const gate = { error: null, warning: null, canSubmit: false, submitBlockedReason: null };
  try {
    lifecycle.submissionGate(event);
    if (project && project.status === 'submitted') lifecycle.editGate(event, project);
    gate.canSubmit = true;
  } catch (err) {
    gate.error = err.message;
    gate.warning = err.hint || null;
    gate.submitBlockedReason = err.message;
  }
  const team = authz.teamForUser(event.id, req.user.id);
  res.status(status).send(views.projectEditor({
    event: queries.publicEventColumns(event),
    viewer: { user: req.actor.user },
    project: project ? projectView(project) : null,
    team: team ? teamView(team, req.user.id) : null,
    fields: { questions: queries.submissionFieldsFor(event.id), tracks: queries.tracksFor(event.id) },
    errors,
    notice,
    gate,
    checklist: buildChecklist(event, project ? projectView(project) : null),
  }));
}

function loadOwnedProject(event, user, { allowMissing = false } = {}) {
  const team = authz.teamForUser(event.id, user.id);
  if (!team) {
    if (allowMissing) return null;
    throw new authz.HttpError(409, 'Create a team first, or start a solo project.');
  }
  const project = db().prepare('SELECT * FROM projects WHERE team_id = ? ORDER BY created_at DESC LIMIT 1').get(team.id);
  if (!project && !allowMissing) return null;
  return project || null;
}

function ensureSoloTeam(eventId, userId) {
  const teamId = id('tm');
  db().prepare(`
    INSERT INTO teams (id, event_id, slug, name, tagline, invite_code, is_final, created_by, created_at, updated_at)
    VALUES (?,?,?,?,?,?,0,?,?,?)
  `).run(teamId, eventId, `solo-${userId.slice(-8)}`, 'Solo entry', 'Working on their own.',
    inviteCode(), userId, now(), now());
  db().prepare('INSERT INTO team_members (team_id, user_id, role, joined_at) VALUES (?,?,?,?)')
    .run(teamId, userId, 'lead', now());
  return teamId;
}

function teamView(team, userId) {
  const members = db().prepare(`
    SELECT u.id, u.name, u.headline, u.avatar_hue, m.role FROM team_members m
    JOIN users u ON u.id = m.user_id WHERE m.team_id = ? ORDER BY m.role = 'lead' DESC, m.joined_at
  `).all(team.id).map((m) => ({
    userId: m.id, name: m.name, headline: m.headline, hue: m.avatar_hue,
    role: m.role, isYou: m.id === userId,
  }));
  return {
    id: team.id, name: team.name, tagline: team.tagline, inviteCode: team.invite_code,
    isLead: members.some((m) => m.isYou && m.role === 'lead'),
    members,
  };
}

function projectView(p) {
  const track = p.track_id ? db().prepare('SELECT name, colour FROM tracks WHERE id = ?').get(p.track_id) : null;
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    tagline: p.tagline,
    description: p.description,
    status: p.status,
    track_id: p.track_id,
    trackName: track ? track.name : '',
    trackColour: track ? track.colour : 'ink',
    techStack: json(p.tech_stack, []),
    repoUrl: p.repo_url,
    demoUrl: p.demo_url,
    videoUrl: p.video_url,
    answers: json(p.answers, {}),
    submittedAt: p.submitted_at,
  };
}

function buildChecklist(event, project) {
  const items = [];
  const p = project || {};
  if (event.require_repo) {
    items.push({ label: 'Repository link', done: Boolean(p.repoUrl), required: true, hint: 'must be public and carry a licence' });
  }
  if (event.require_demo) items.push({ label: 'Live demo link', done: Boolean(p.demoUrl), required: true });
  if (event.require_video) items.push({ label: 'Demo video', done: Boolean(p.videoUrl), required: true });
  if (event.require_screenshots) {
    items.push({ label: 'Screenshots', done: json(p.screenshots, []).length > 0, required: true });
  }
  items.push({ label: 'Project name', done: Boolean(p.name), required: true });
  items.push({ label: 'One-line summary', done: Boolean(p.tagline), required: true });
  items.push({ label: 'Full description', done: (p.description || '').length >= 40, required: true });
  items.push({ label: 'Submitted to the judges', done: p.status === 'submitted', required: false });
  return items;
}

function buildGates(event, { registration, team, project }) {
  const out = { error: null, warning: null, title: '', registerOpen: false, registerClosedReason: '' };
  try {
    lifecycle.registrationGate(event);
    out.registerOpen = true;
  } catch (err) {
    out.registerClosedReason = `${err.message}${err.hint ? ` ${err.hint}` : ''}`;
  }

  if (project) {
    try {
      lifecycle.editGate(event, project);
    } catch (err) {
      out.title = 'Submissions are closed';
      out.error = `${err.message} ${err.hint || ''}`.trim();
    }
  } else if (team) {
    try {
      lifecycle.submissionGate(event);
    } catch (err) {
      out.title = 'Submissions are closed';
      out.error = `${err.message} ${err.hint || ''}`.trim();
    }
  }
  void registration;
  return out;
}

function buildParticipantResults(event, project, user) {
  if (!project || !authz.resultsArePublic(event)) return null;
  const row = db().prepare('SELECT * FROM results WHERE event_id = ? AND project_id = ? AND published = 1')
    .get(event.id, project.id);
  if (!row) return null;
  const track = project.track_id ? db().prepare('SELECT name FROM tracks WHERE id = ?').get(project.track_id) : null;
  const score = judging.scoreProject(event.id, project.id);
  return {
    rank: row.rank,
    trackRank: row.track_rank,
    trackName: track ? track.name : '',
    award: row.award,
    normalisedScore: row.normalised_score,
    reviewsSubmitted: score.submitted,
  };
  void user;
}

function assertRequirements(event, { name, tagline, description, repoUrl, demoUrl, videoUrl }, fields, answers) {
  if (event.require_repo && !repoUrl) throw new authz.HttpError(422, 'This hackathon requires a repository link.');
  if (event.require_demo && !demoUrl) throw new authz.HttpError(422, 'This hackathon requires a live demo link.');
  if (event.require_video && !videoUrl) throw new authz.HttpError(422, 'This hackathon requires a demo video.');
  if (description.length < 40) throw new authz.HttpError(422, 'The description is too short to be useful to a judge.');
  const missing = fields.filter((f) => f.required && !answers[f.key]);
  if (missing.length) {
    throw new authz.HttpError(422, `Answer the required questions: ${missing.map((f) => f.label).join(', ')}`);
  }
  void name; void tagline;
}

function cleanUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return require('../lib/html').safeUrl(raw);
}

function inviteCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  const bytes = require('node:crypto').randomBytes(8);
  for (let i = 0; i < 8; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

module.exports = router;
