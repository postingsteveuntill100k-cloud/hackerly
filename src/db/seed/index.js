'use strict';

const { db, close } = require('../index');
const { seedFixtures, loadFixtures, FIXTURE_PATH } = require('./fixtures');
const { seedDemo, DEMO_PASSWORD, SEEDED_ACCOUNTS } = require('./demo');
const config = require('../../config');

/**
 * Seeding is additive and idempotent. Running it against a populated database
 * is a no-op for everything that already exists; it never destroys a user's
 * data, which is why `docker compose up` on an existing volume is safe.
 */
function seed({ force = false } = {}) {
  const database = db();
  const summary = { fixtures: null, demo: null, database: config.databasePath };

  if (force) {
    // Only used by `npm run reset`, and only against a local file database.
    for (const table of [
      'review_scores', 'pairwise_comparisons', 'judge_conflicts', 'reviews', 'judge_assignments',
      'results', 'votes', 'comments', 'project_submissions', 'projects', 'team_invitations',
      'team_members', 'teams', 'submission_fields', 'faqs', 'prizes', 'announcements',
      'challenges', 'schedule_items', 'judge_tracks', 'judges', 'rubric_criteria',
      'registrations', 'event_roles', 'api_tokens', 'sessions', 'audit_log', 'tracks', 'events', 'users',
    ]) {
      database.exec(`DELETE FROM ${table};`);
    }
  }

  if (config.seedOnBoot !== false || force) {
    const fixtures = loadFixtures();
    if (fixtures) {
      summary.fixtures = seedFixtures(fixtures);
    } else {
      summary.fixtures = { missing: true, path: FIXTURE_PATH };
    }
  }

  if (config.seedDemo !== false || force) {
    summary.demo = seedDemo();
  }

  return summary;
}

function isEmpty() {
  const row = db().prepare('SELECT COUNT(*) AS n FROM events').get();
  return row.n === 0;
}

module.exports = { seed, isEmpty, close, DEMO_PASSWORD, SEEDED_ACCOUNTS, FIXTURE_PATH };
