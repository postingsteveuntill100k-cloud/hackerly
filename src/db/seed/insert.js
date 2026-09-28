'use strict';

const { db } = require('../index');

/**
 * A small insert helper.
 *
 * SQL that spells out a long column list invites off-by-one placeholder
 * mistakes, which are tedious to find and produce a runtime error rather than
 * a type error. Naming the columns once and letting the row supply them by
 * key removes the class of bug entirely.
 */
function insert(table, row) {
  const columns = Object.keys(row);
  const placeholders = columns.map(() => '?').join(', ');
  const sql = `INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`;
  db().prepare(sql).run(...columns.map((column) => row[column]));
  return row;
}

module.exports = { insert };
