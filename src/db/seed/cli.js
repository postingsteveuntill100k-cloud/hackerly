#!/usr/bin/env node
'use strict';

/**
 * Seeding CLI.
 *
 *   node src/db/seed/cli.js             seed anything missing
 *   node src/db/seed/cli.js --fresh     wipe and re-seed (local development only)
 *   node src/db/seed/cli.js --check     report what is in the database
 */

const { db, close } = require('../index');
const { seed, DEMO_PASSWORD, SEEDED_ACCOUNTS } = require('./index');
const config = require('../../config');

const args = new Set(process.argv.slice(2));

if (args.has('--check')) {
  const counts = {};
  for (const table of ['events', 'users', 'teams', 'projects', 'judges', 'reviews', 'results', 'api_tokens']) {
    counts[table] = db().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  }
  console.log(`Hackerly database: ${config.databasePath}`);
  console.table(counts);
  close();
  process.exit(0);
}

const summary = seed({ force: args.has('--fresh') });

console.log('');
console.log('  Hackerly — database ready');
console.log('  ' + '-'.repeat(60));
console.log(`  file            ${config.databasePath}`);

if (summary.fixtures && summary.fixtures.missing) {
  console.log(`  fixtures        not found at ${summary.fixtures.path}`);
  console.log('                  The acceptance suite needs this file next to run.py.');
} else if (summary.fixtures) {
  console.log(`  fixtures        event ${summary.fixtures.eventId}, ${summary.fixtures.projects} projects`
    + `${summary.fixtures.duplicateCount ? `, ${summary.fixtures.duplicateCount} duplicate submission preserved` : ''}`);
}

if (summary.demo && !summary.demo.skipped) {
  console.log(`  demo content    ${summary.demo.events} events, ${summary.demo.projects} projects, ${summary.demo.users} people`);
  console.log('');
  console.log(`  Demo sign-in    password for all three is "${DEMO_PASSWORD}"`);
  for (const [role, email] of Object.entries(SEEDED_ACCOUNTS)) {
    console.log(`                  ${role.padEnd(11)} ${email}`);
  }
  console.log('');
  console.log('  API tokens for automation and the acceptance checker:');
  for (const [role, token] of Object.entries(summary.demo.tokens)) {
    console.log(`                  ${role.padEnd(11)} Cookie: session=${token}`);
  }
} else if (summary.demo && summary.demo.skipped) {
  console.log('  demo content    already present');
}

console.log('');
close();
