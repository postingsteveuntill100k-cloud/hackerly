'use strict';

/**
 * Authorization.
 *
 * Rules that hold everywhere in Hackerly:
 *
 *  1. A role only exists in the context of an event, and it is read from
 *     event_roles / judges on every request. Nothing in the browser can
 *     influence it.
 *  2. Cross-event access is refused by scoping every query to the event id
 *     the caller proved they may act on. Changing an id in a URL does
 *     nothing because the id is only ever used together with a proven
 *     membership.
 *  3. Review content (scores, notes, recommendations) is readable by the
 *     author and by organisers of that event. Never by another judge, and
 *     never by a participant.
 *  4. Results are readable when the event has published them, or by an
 *     organiser. The clock alone does not publish anything.
 *  5. Private and unlisted events are invisible to non-members.
 */

const { db } = require('../db');

const ORGANISER_ROLES = new Set(['organiser', 'coordinator']);
const STAFF_ROLES = new Set(['organiser', 'coordinator']);

/** Thrown by guards; rendered as an error page or JSON by the route layer. */
class HttpError extends Error {
  constructor(statusCode, message, detail) {
    super(message);
    this.statusCode = statusCode;
    this.detail = detail;
  }
}

const deny = (statusCode, message, detail) => { throw new HttpError(statusCode, message, detail); };

/* --------------------------------------------------------------- event access */

function findEvent(slugOrId) {
  return db().prepare('SELECT * FROM events WHERE slug = ? OR id = ?').get(String(slugOrId), String(slugOrId)) || null;
}

function roleIn(userId, eventId) {
  if (!userId || !eventId) return null;
  const row = db().prepare(`
    SELECT role FROM event_roles WHERE event_id = ? AND user_id = ? ORDER BY role LIMIT 1
  `).get(eventId, userId);
  return row ? row.role : null;
}

function rolesIn(userId, eventId) {
  if (!userId || !eventId) return [];
  return db().prepare('SELECT role FROM event_roles WHERE event_id = ? AND user_id = ?')
    .all(eventId, userId).map((r) => r.role);
}

function isStaff(userId, eventId) {
  return rolesIn(userId, eventId).some((r) => STAFF_ROLES.has(r));
}

function isParticipant(userId, eventId) {
  const row = db().prepare(`
    SELECT 1 AS ok FROM event_roles WHERE event_id = ? AND user_id = ? AND role = 'participant'
  `).get(eventId, userId);
  return Boolean(row);
}

/** The verified judge record for this user in this event, or null. */
function judgeRecord(userId, eventId) {
  if (!userId || !eventId) return null;
  return db().prepare(`
    SELECT * FROM judges WHERE event_id = ? AND user_id = ? AND state IN ('verified','invited')
    ORDER BY state = 'verified' DESC LIMIT 1
  `).get(eventId, userId) || null;
}

function isVerifiedJudge(userId, eventId) {
  const judge = judgeRecord(userId, eventId);
  return Boolean(judge && judge.state === 'verified');
}

/** Registered (not withdrawn) participant in this event. */
function registrationFor(userId, eventId) {
  if (!userId || !eventId) return null;
  return db().prepare('SELECT * FROM registrations WHERE event_id = ? AND user_id = ?')
    .get(eventId, userId) || null;
}

function isRegistered(userId, eventId) {
  const reg = registrationFor(userId, eventId);
  return Boolean(reg && reg.state !== 'withdrawn' && reg.state !== 'declined');
}

/**
 * Can this user see the event page at all?
 * Public events: everyone. Unlisted: staff + registered. Private: staff only.
 */
function canViewEvent(event, userId) {
  if (!event) return false;
  if (event.visibility === 'public') return true;
  if (!userId) return false;
  if (isStaff(userId, event.id)) return true;
  if (event.visibility === 'unlisted') {
    return isRegistered(userId, event.id) || isVerifiedJudge(userId, event.id);
  }
  return false;
}

/** Only a published, public event is discoverable in listings. */
function isDiscoverable(event) {
  return event.visibility === 'public' && event.status !== 'draft';
}

/* ------------------------------------------------------------------- guards */

function requireUser(actor) {
  if (!actor || !actor.user) deny(401, 'Sign in to continue.');
  return actor.user;
}

function requireEvent(slugOrId, actor) {
  const event = findEvent(slugOrId);
  if (!event) deny(404, 'That hackathon does not exist.');
  if (!canViewEvent(event, actor && actor.user ? actor.user.id : null)) {
    deny(403, 'This hackathon is private.');
  }
  return event;
}

/**
 * An API token minted for one event must not be usable against another. The
 * credential is checked here, once, rather than in every route.
 */
function requireTokenScope(actor, event, scope) {
  const credential = actor && actor.credential;
  if (!credential || credential.kind !== 'api_token') return true;
  if (credential.event_id && credential.event_id !== event.id) {
    deny(403, 'This credential is scoped to a different hackathon.');
  }
  if (scope && credential.scopes && credential.scopes.length && !credential.scopes.includes(scope)) {
    deny(403, 'This credential does not carry that permission.');
  }
  return true;
}

function requireStaff(event, actor) {
  requireUser(actor);
  if (!isStaff(actor.user.id, event.id)) {
    deny(403, 'Only the organising team can do that.');
  }
  return true;
}

function requireParticipant(event, actor) {
  requireUser(actor);
  if (isStaff(actor.user.id, event.id)) return true;
  if (!isRegistered(actor.user.id, event.id)) {
    deny(403, 'Register for this hackathon first.');
  }
  return true;
}

function requireJudge(event, actor) {
  requireUser(actor);
  const judge = judgeRecord(actor.user.id, event.id);
  if (!judge || judge.state !== 'verified') {
    deny(403, 'Judge access is granted by the organising team.');
  }
  return judge;
}

/** Staff may always read results; everyone else needs publication. */
function resultsArePublic(event) {
  return event.results_released === true || event.results_released === 1;
}

function requireResultsVisible(event, actor) {
  if (resultsArePublic(event)) return true;
  if (actor && actor.user && isStaff(actor.user.id, event.id)) return true;
  deny(403, 'Results for this hackathon have not been published yet.');
  return false;
}

/* ------------------------------------------------------------- project scope */

/**
 * Load a project and prove the caller may act on it.
 * `scope` narrows further: 'public' | 'judge' | 'staff' | 'team'
 */
function loadProject(event, projectId, actor, scope = 'public') {
  const project = db().prepare('SELECT * FROM projects WHERE id = ? AND event_id = ?')
    .get(String(projectId), event.id);
  if (!project) deny(404, 'That project does not exist in this hackathon.');

  const userId = actor && actor.user ? actor.user.id : null;
  const staff = userId ? isStaff(userId, event.id) : false;
  if (staff) return project;

  if (scope === 'public') {
    const showcase = event.show_projects === 1 && project.is_public === 1
      && project.status === 'submitted';
    if (!showcase) deny(404, 'That project is not public.');
    return project;
  }

  if (scope === 'judge') {
    const judge = judgeRecord(userId, event.id);
    if (judge && judge.state === 'verified') {
      const assignment = db().prepare(`
        SELECT 1 AS ok FROM judge_assignments
        WHERE judge_id = ? AND project_id = ? AND state != 'revoked'
      `).get(judge.id, project.id);
      if (assignment) return project;
    }
    deny(403, 'You are not assigned to this project.');
  }

  if (scope === 'team') {
    if (userId && onTeam(project.team_id, userId)) return project;
    deny(403, 'You are not on the team for this project.');
  }

  deny(403, 'You cannot view this project.');
  return null;
}

function onTeam(teamId, userId) {
  return Boolean(db().prepare('SELECT 1 AS ok FROM team_members WHERE team_id = ? AND user_id = ?')
    .get(teamId, userId));
}

function teamsForUser(eventId, userId) {
  if (!userId) return [];
  return db().prepare(`
    SELECT t.* FROM teams t
    JOIN team_members m ON m.team_id = t.id
    WHERE t.event_id = ? AND m.user_id = ?
    ORDER BY m.role = 'lead' DESC, t.created_at ASC
  `).all(eventId, userId);
}

/**
 * The team a participant is working in. When somebody is on more than one team
 * (which the invite rules allow), the one that already has a project wins —
 * otherwise you would be dropped into an empty team while your work sits
 * somewhere else.
 */
function teamForUser(eventId, userId) {
  const teams = teamsForUser(eventId, userId);
  if (teams.length <= 1) return teams[0] || null;
  const withProject = teams.find((t) => db().prepare('SELECT 1 AS ok FROM projects WHERE team_id = ?').get(t.id));
  return withProject || teams[0];
}

/* -------------------------------------------------------------- assignment */

/** The calling judge's assignment row for a project, or deny. */
function requireAssignment(event, projectId, actor) {
  const judge = requireJudge(event, actor);
  const assignment = db().prepare(`
    SELECT * FROM judge_assignments
    WHERE judge_id = ? AND project_id = ? AND state != 'revoked'
  `).get(judge.id, String(projectId));
  if (!assignment) deny(403, 'That project is not in your assignment list.');
  return { judge, assignment };
}

module.exports = {
  HttpError,
  deny,
  findEvent,
  roleIn,
  rolesIn,
  isStaff,
  isParticipant,
  isRegistered,
  registrationFor,
  judgeRecord,
  isVerifiedJudge,
  canViewEvent,
  isDiscoverable,
  requireUser,
  requireEvent,
  requireTokenScope,
  requireStaff,
  requireParticipant,
  requireJudge,
  requireResultsVisible,
  resultsArePublic,
  loadProject,
  onTeam,
  teamForUser,
  teamsForUser,
  requireAssignment,
  ORGANISER_ROLES,
  STAFF_ROLES,
};
