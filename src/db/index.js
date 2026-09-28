'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config');

let instance = null;

function initSchema(db) {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);
}

function open(file) {
  const target = file || config.databasePath;
  if (target !== ':memory:') {
    fs.mkdirSync(path.dirname(target), { recursive: true });
  }
  const db = new DatabaseSync(target);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA foreign_keys = ON;');
  initSchema(db);
  return db;
}

/** Process-wide connection. */
function db() {
  if (!instance) instance = open();
  return instance;
}

/** A separate, isolated connection — used by tests and by the seeder. */
function memory() {
  return open(':memory:');
}

function close() {
  if (instance) {
    try { instance.close(); } catch { /* already closed */ }
    instance = null;
  }
}

module.exports = { db, open, memory, close, initSchema, DB_PATH: config.databasePath };
