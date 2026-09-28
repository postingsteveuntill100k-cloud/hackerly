'use strict';

const { HttpError } = require('./authz');

class FieldErrors {
  constructor() { this.errors = {}; }
  add(field, message) {
    if (!this.errors[field]) this.errors[field] = message;
    return this;
  }
  get any() { return Object.keys(this.errors).length > 0; }
  throwIfAny(message = 'Please check the highlighted fields.') {
    if (this.any) {
      const err = new HttpError(422, message, this.errors);
      err.fields = this.errors;
      throw err;
    }
  }
}

function text(value, { field, label, errors, required = false, min = 0, max = 4000, trim = true } = {}) {
  let out = value === undefined || value === null ? '' : String(value);
  if (trim) out = out.trim();
  if (!out) {
    if (required) errors.add(field, `${label} is required.`);
    return '';
  }
  if (out.length < min) errors.add(field, `${label} must be at least ${min} characters.`);
  if (out.length > max) errors.add(field, `${label} must be under ${max.toLocaleString('en-GB')} characters.`);
  return out.slice(0, max);
}

function email(value, { field = 'email', label = 'Email', errors, required = true } = {}) {
  const out = text(value, { field, label, errors, required, max: 254, trim: true });
  if (!out) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(out)) errors.add(field, 'That does not look like a valid email address.');
  return out.toLowerCase();
}

function password(value, { field = 'password', label = 'Password', errors, required = true, min = 10 } = {}) {
  const out = value === undefined || value === null ? '' : String(value);
  if (!out) {
    if (required) errors.add(field, `${label} is required.`);
    return '';
  }
  if (out.length < min) errors.add(field, `${label} must be at least ${min} characters.`);
  if (out.length > 200) errors.add(field, `${label} is too long.`);
  return out;
}

function int(value, { field, label, errors, min = -Infinity, max = Infinity, fallback = 0 } = {}) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) {
    errors.add(field, `${label} must be a number.`);
    return fallback;
  }
  if (n < min || n > max) errors.add(field, `${label} must be between ${min} and ${max}.`);
  return Math.trunc(n);
}

function bool(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

/**
 * Validate against a fixed set. An absent value is not an error when a
 * fallback exists — that is the case of a select with a sensible default, and
 * failing a submission because a form omitted an optional choice is hostile.
 */
function oneOf(value, allowed, { field, label, errors, fallback } = {}) {
  const out = String(value ?? '').trim();
  if (!out) {
    if (fallback !== undefined) return fallback;
    errors.add(field, `${label} is required.`);
    return allowed[0];
  }
  if (!allowed.includes(out)) {
    errors.add(field, `${label} must be one of: ${allowed.join(', ')}.`);
    return fallback !== undefined ? fallback : allowed[0];
  }
  return out;
}

function list(value, { max = 12, maxItemLength = 40 } = {}) {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean).slice(0, max)
      .map((v) => v.slice(0, maxItemLength));
  }
  return String(value || '')
    .split(/[,\n]/)
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, max)
    .map((v) => v.slice(0, maxItemLength));
}

/** Accepts a datetime-local value and stores a UTC ISO string. */
function isoOrNull(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

module.exports = { FieldErrors, text, email, password, int, bool, oneOf, list, isoOrNull };
