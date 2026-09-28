'use strict';

/**
 * Event lifecycle.
 *
 * Two separate things live here and must not be confused:
 *
 *   phase(event, now)  — a *description* of where the event is, used for
 *                        labels, ordering and UI. Never used to authorise.
 *
 *   can*(event, now)   — the *gates*. These are the only things that decide
 *                        whether a write is allowed, and they are evaluated
 *                        server-side on every request.
 *
 * A request that arrives after submissions_close_at is refused even if the
 * browser, the client clock, or a crafted request body says otherwise.
 */

const { db } = require('../db');
const authz = require('./authz');

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const PHASES = [
  { key: 'announced',  label: 'Announced' },
  { key: 'registration', label: 'Registration open' },
  { key: 'upcoming',   label: 'Upcoming' },
  { key: 'building',   label: 'Building' },
  { key: 'judging',    label: 'Judging' },
  { key: 'results',    label: 'Results' },
  { key: 'archived',   label: 'Ended' },
  { key: 'ended',      label: 'Ended' },
];

/**
 * The lifecycle functions are called with either a raw database row or the
 * public view object, which uses camelCase. Normalising here means a caller
 * can never accidentally read `undefined` from a field that exists under a
 * different name — which is exactly the bug that made every event read as
 * "live now" regardless of its deadlines.
 */
const FIELD_MAP = {
  status: 'status',
  results_released: 'resultsReleased',
  starts_at: 'startsAt',
  ends_at: 'endsAt',
  registration_opens_at: 'registrationOpensAt',
  registration_closes_at: 'registrationClosesAt',
  submissions_open_at: 'submissionsOpenAt',
  submissions_close_at: 'submissionsCloseAt',
  judging_opens_at: 'judgingOpensAt',
  judging_closes_at: 'judgingClosesAt',
  results_at: 'resultsAt',
  timezone: 'timezone',
};

function normalise(event) {
  if (!event) return event;
  const out = event;
  for (const [snake, camel] of Object.entries(FIELD_MAP)) {
    if (out[snake] === undefined && out[camel] !== undefined) out[snake] = out[camel];
  }
  return out;
}

function at(value) {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

function phase(event, nowMs = Date.now()) {
  const e = normalise(event);
  if (!e) return 'announced';
  if (e.status === 'draft') return 'draft';
  if (e.status === 'archived') return 'archived';

  if (e.results_released === true || e.results_released === 1) return 'results';

  const start = at(e.starts_at);
  const close = at(e.submissions_close_at);
  const end = at(e.ends_at);
  const judgingOpens = at(e.judging_opens_at);
  const judgingCloses = at(e.judging_closes_at);
  const regOpens = at(e.registration_opens_at);
  const regCloses = at(e.registration_closes_at);

  // The judging window has both ends: an event whose judging deadline passed
  // without results being published is over, not still judging.
  // An open judging window with no closing date only counts while submissions
  // are still open; once they are not, an event that never set a judging
  // deadline is over rather than permanently judging.
  const submissionsOpen = start !== null && close !== null && nowMs < close;
  const judgingOpen = judgingOpens !== null && nowMs >= judgingOpens
    && ((judgingCloses !== null && nowMs < judgingCloses)
      || (judgingCloses === null && submissionsOpen));
  // Building wins the badge when both are true: a participant looking at the
  // page needs to know that submissions are still open, and the console
  // already shows that judging has begun.
  if (start !== null && close !== null && nowMs >= start && nowMs < close) return 'building';
  if (judgingOpen) return 'judging';
  if (regOpens !== null && nowMs >= regOpens && (regCloses === null || nowMs < regCloses)) return 'registration';
  if (start !== null && nowMs < start) return 'upcoming';
  // Past the last meaningful date and no judging window: the event is over.
  if (close !== null && nowMs >= close) return (end !== null && nowMs >= end) ? 'archived' : 'ended';
  return 'announced';
}

function phaseLabel(event, nowMs = Date.now()) {
  return (PHASES.find((p) => p.key === phase(event, nowMs)) || { label: 'Hackathon' }).label;
}

function isLive(event, nowMs = Date.now()) {
  const p = phase(event, nowMs);
  return p === 'registration' || p === 'building';
}

/** Is the judging window open right now, whatever the badge says? */
function isJudgingOpen(event, nowMs = Date.now()) {
  const e = normalise(event);
  const opens = at(e.judging_opens_at);
  const closes = at(e.judging_closes_at);
  return opens !== null && nowMs >= opens && (closes === null || nowMs < closes);
}

/* ------------------------------------------------------------------- gates */

class Gate extends Error {
  constructor(message, hint) {
    super(message);
    this.name = 'Gate';
    this.hint = hint;
    this.statusCode = 409;
  }
}

/** The fixture/seeded events may deliberately sit in the past. */
function registrationGate(rawEvent, nowMs = Date.now()) {
  const event = normalise(rawEvent);
  if (event.status === 'draft') throw new Gate('This hackathon is not published yet.');
  if (event.status === 'archived') throw new Gate('This hackathon has ended. Registration is closed.');
  if (event.visibility === 'private') throw new Gate('This hackathon is invite only.');
  const opens = at(event.registration_opens_at);
  const closes = at(event.registration_closes_at);
  if (opens && nowMs < opens) throw new Gate('Registration has not opened yet.', `Opens ${fmt(event.registration_opens_at, event.timezone)}.`);
  if (closes && nowMs >= closes) throw new Gate('Registration is closed.', `Closed ${fmt(event.registration_closes_at, event.timezone)}.`);
  if (!opens && !closes && nowMs >= at(event.submissions_close_at)) {
    throw new Gate('Registration is closed.', 'This hackathon has already finished.');
  }
  if (event.require_approval) return { needsApproval: true };
  if (event.max_participants > 0 && confirmedCount(event.id) >= event.max_participants) {
    throw new Gate('This hackathon is fully booked.');
  }
  return { needsApproval: false };
}

function confirmedCount(eventId) {
  const row = db().prepare(`
    SELECT COUNT(*) AS n FROM registrations WHERE event_id = ? AND state IN ('confirmed','pending')
  `).get(eventId);
  return row ? row.n : 0;
}

/**
 * Submission gate. Evaluated on the server, on every submit and every
 * mutation of a submitted project. This is the check the acceptance suite
 * exercises against a closed event.
 */
function submissionGate(rawEvent, nowMs = Date.now()) {
  const event = normalise(rawEvent);
  if (event.status === 'draft') throw new Gate('This hackathon is not published yet.');
  if (event.status === 'archived') throw new Gate('This hackathon has ended. Submissions are closed.');
  const opens = at(event.submissions_open_at) || at(event.starts_at);
  const closes = at(event.submissions_close_at);
  if (opens && nowMs < opens) throw new Gate('Submissions are not open yet.', `Opens ${fmt(event.submissions_open_at || event.starts_at, event.timezone)}.`);
  if (!closes) throw new Gate('This hackathon has no submission deadline configured.');
  if (nowMs >= closes) {
    throw new Gate('Submissions are closed.', `The deadline was ${fmt(event.submissions_close_at, event.timezone)}.`);
  }
  return true;
}

/** Can this project still be edited? Drafts close with the deadline. */
function editGate(rawEvent, project, nowMs = Date.now()) {
  const event = normalise(rawEvent);
  if (project.status === 'submitted' && project.submitted_at
      && nowMs >= at(event.submissions_close_at)) {
    throw new Gate('Submissions are closed, so a submitted project can no longer be changed.');
  }
  if (event.status === 'archived') throw new Gate('This hackathon has ended.');
  return submissionGate(event, nowMs);
}

/** Judging is open to verified judges with assignments once the window opens. */
function judgingGate(rawEvent, nowMs = Date.now()) {
  const event = normalise(rawEvent);
  if (event.status === 'archived') throw new Gate('Judging has closed for this hackathon.');
  const opens = at(event.judging_opens_at);
  const closes = at(event.judging_closes_at);
  if (opens && nowMs < opens) throw new Gate('Judging has not opened yet.', `Opens ${fmt(event.judging_opens_at, event.timezone)}.`);
  if (closes && nowMs >= closes) throw new Gate('The judging window has closed.', `Closed ${fmt(event.judging_closes_at, event.timezone)}.`);
  return true;
}

/* ------------------------------------------------------------- presentation */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function fmt(value, timezone = 'UTC') {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone,
    }).format(d);
  } catch {
    return new Intl.DateTimeFormat('en-GB', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(d);
  }
}

function fmtDate(value, timezone = 'UTC') {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: timezone }).format(d);
  } catch {
    return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(d);
  }
}

function fmtDay(value, timezone = 'UTC') {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: timezone }).format(d);
  } catch {
    return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  }
}

function fmtTime(value, timezone = 'UTC') {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone }).format(d);
  } catch {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
}

function fmtRange(start, end, timezone = 'UTC') {
  if (!start) return '';
  if (!end) return fmtDate(start, timezone);
  const a = Date.parse(start);
  const b = Date.parse(end);
  if (!Number.isFinite(b)) return fmtDate(start, timezone);
  if (b - a < 36 * HOUR) return `${fmtDate(start, timezone)}, ${fmtTime(start, timezone)} – ${fmtTime(end, timezone)}`;
  return `${fmtDate(start, timezone)} – ${fmtDate(end, timezone)}`;
}

/** "in 3 days" / "6 hours ago" — always paired with an absolute time nearby. */
function relative(value, nowMs = Date.now()) {
  if (!value) return '';
  const t = Date.parse(value);
  if (!Number.isFinite(t)) return '';
  const diff = t - nowMs;
  const abs = Math.abs(diff);
  const suffix = diff >= 0 ? 'left' : 'ago';
  if (abs < 60_000) return diff >= 0 ? 'in under a minute' : 'just now';
  if (abs < HOUR) { const n = Math.round(abs / MINUTE); return `${n} minute${n === 1 ? '' : 's'} ${suffix}`; }
  if (abs < DAY) { const n = Math.round(abs / HOUR); return `${n} hour${n === 1 ? '' : 's'} ${suffix}`; }
  if (abs < 30 * DAY) { const n = Math.round(abs / DAY); return `${n} day${n === 1 ? '' : 's'} ${suffix}`; }
  const n = Math.round(abs / (30 * DAY));
  return `${n} month${n === 1 ? '' : 's'} ${suffix}`;
}

function countdown(value, nowMs = Date.now()) {
  const t = at(value);
  if (t === null) return null;
  const diff = t - nowMs;
  if (diff <= 0) return { passed: true, days: 0, hours: 0, minutes: 0 };
  return {
    passed: false,
    days: Math.floor(diff / DAY),
    hours: Math.floor((diff % DAY) / HOUR),
    minutes: Math.floor((diff % HOUR) / MINUTE),
  };
}

/** The set of dated milestones shown on an event page. */
function milestones(rawEvent) {
  const event = normalise(rawEvent);
  const rows = [
    { key: 'registration_opens_at', label: 'Registration opens' },
    { key: 'registration_closes_at', label: 'Registration closes' },
    { key: 'starts_at', label: 'Hackathon begins' },
    { key: 'submissions_close_at', label: 'Submissions close' },
    { key: 'judging_opens_at', label: 'Judging begins' },
    { key: 'judging_closes_at', label: 'Judging ends' },
    { key: 'results_at', label: 'Results' },
  ];
  return rows
    .map((r) => ({ ...r, at: event[r.key], done: at(event[r.key]) !== null && Date.parse(event[r.key]) <= Date.now() }))
    .filter((r) => r.at);
}

module.exports = {
  MINUTE, HOUR, DAY, PHASES, Gate,
  phase, phaseLabel, isLive, isJudgingOpen,
  registrationGate, submissionGate, editGate, judgingGate,
  confirmedCount,
  fmt, fmtDate, fmtDay, fmtTime, fmtRange, relative, countdown, milestones,
};
