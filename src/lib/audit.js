'use strict';

const { db } = require('../db');
const { id, now } = require('./ids');

/**
 * Append-only audit trail.
 *
 * Writes never touch a result. Reads are always filtered to the acting user's
 * own rows, or to the event whose staff they are.
 */
function record({
  eventId = null, actor = null, action, resourceType, resourceId = null,
  outcome = 'ok', detail = '',
}) {
  try {
    db().prepare(`
      INSERT INTO audit_log (id, event_id, actor_id, actor_role, action, resource_type,
                             resource_id, outcome, detail, at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id('aud'),
      eventId,
      actor && actor.user ? actor.user.id : null,
      actorRole(actor),
      String(action),
      String(resourceType),
      resourceId ? String(resourceId) : null,
      outcome,
      typeof detail === 'string' ? detail.slice(0, 800) : JSON.stringify(detail).slice(0, 800),
      now(),
    );
  } catch (err) {
    // Auditing must never take the request down, but a failure is worth seeing.
    console.error('[audit] could not record', action, err.message);
  }
}

function actorRole(actor) {
  if (!actor || !actor.user) return 'visitor';
  if (actor.roles && actor.roles.length) return actor.roles[0];
  return 'member';
}

/** Denials are as interesting as grants. */
function denied(actor, action, resourceType, detail) {
  record({ actor, action, resourceType, outcome: 'denied', detail });
}

function forEvent(eventId, limit = 100) {
  return db().prepare(`
    SELECT a.*, u.name AS actor_name FROM audit_log a
    LEFT JOIN users u ON u.id = a.actor_id
    WHERE a.event_id = ? ORDER BY a.at DESC LIMIT ?
  `).all(eventId, limit);
}

function forActor(userId, limit = 50) {
  return db().prepare(`
    SELECT * FROM audit_log WHERE actor_id = ? ORDER BY at DESC LIMIT ?
  `).all(userId, limit);
}

module.exports = { record, denied, forEvent, forActor };
