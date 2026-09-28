'use strict';

const crypto = require('node:crypto');

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

function randomBytes(n) {
  return crypto.randomBytes(n).toString('base64url');
}

/**
 * Prefixed, sortable-ish identifier. Prefixes are human readable in logs and
 * in URLs but carry no meaning: nothing in the system branches on a prefix.
 */
function id(prefix) {
  const bytes = crypto.randomBytes(9);
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return prefix ? `${prefix}_${out}` : out;
}

function token(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function now() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** Deterministic integer in [0, max) from a string — used for stable artwork. */
function hashInt(input, max) {
  const h = crypto.createHash('sha256').update(String(input)).digest();
  return h.readUInt32BE(0) % max;
}

function slugify(value, fallback = 'item') {
  const base = String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return base || fallback;
}

function uniqueSlug(existing, desired, fallback = 'item') {
  const base = slugify(desired, fallback);
  let candidate = base;
  let n = 2;
  while (existing.has(candidate)) {
    candidate = `${base}-${n}`;
    n += 1;
  }
  existing.add(candidate);
  return candidate;
}

module.exports = { id, token, now, hashInt, slugify, uniqueSlug, randomBytes };
