'use strict';

/**
 * Scoring, weighting and normalisation.
 *
 * Raw rubric scores are not comparable across judges: one judge may award 4s
 * for competent work while another reserves 5 for exceptional. Hackerly
 * therefore always reports a normalised figure alongside the raw one, and
 * always states the method it used.
 *
 *   1. weighted      — Σ(score × weight) / Σ(weight × max) × 100
 *                     how the judge scored the project, on their own terms.
 *   2. z-score       — the project's total rescaled against the distribution
 *                     of that judge's own submissions, and scaled into 0–100.
 *                     Removes leniency/severity bias per judge.
 *   3. blend         — 60% weighted + 40% z-score, the default standings.
 *
 * Judges who submit an identical score for every project contribute nothing
 * to the spread, so the blend falls back to the weighted score for them and
 * says so.
 */

const { db } = require('../db');

function criteriaFor(eventId) {
  return db().prepare(`
    SELECT id, field_key, name, description, weight, max_score, position
    FROM rubric_criteria WHERE event_id = ? ORDER BY position, name
  `).all(eventId);
}

/** Σ(score × weight) / Σ(max × weight) × 100 over the answered criteria. */
function weightedTotal(scores, criteria) {
  let earned = 0;
  let possible = 0;
  for (const c of criteria) {
    const value = scores[c.id];
    if (value === undefined || value === null) continue;
    earned += Number(value) * c.weight;
    possible += c.max_score * c.weight;
  }
  if (possible <= 0) return 0;
  return round2((earned / possible) * 100);
}

/** Raw 0–max sum, ignoring weights. Used for the judge's own reference. */
function rawTotal(scores, criteria) {
  const answered = criteria.filter((c) => scores[c.id] !== undefined && scores[c.id] !== null);
  if (!answered.length) return 0;
  return round2(answered.reduce((sum, c) => sum + Number(scores[c.id]), 0));
}

function mean(values) {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function stdev(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance = values.reduce((acc, v) => acc + (v - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Rescale a raw total against the distribution of one judge's completed
 * reviews. Returns { value, method, note } so callers can show the method
 * rather than a mysterious number.
 */
function normaliseAgainst(rawValue, population) {
  const usable = population.filter((v) => Number.isFinite(v));
  if (usable.length < 2) {
    return { value: clamp(rawValue, 0, 100), method: 'weighted', note: 'Not enough completed reviews to normalise yet.' };
  }
  const m = mean(usable);
  const sd = stdev(usable);
  if (sd < 0.0001) {
    return {
      value: clamp(rawValue, 0, 100),
      method: 'weighted',
      note: 'This judge has scored every project identically, so there is no personal scale to correct against.',
    };
  }
  const z = (rawValue - m) / sd;
  // Map z of [-2, +2] onto 0–100. Beyond that we clamp, because no judge
  // should be able to move a project's rank by being extreme alone.
  const scaled = ((z + 2) / 4) * 100;
  return { value: round2(clamp(scaled, 0, 100)), method: 'z-score', note: '' };
}

/**
 * The default blend used for standings.
 *
 * @param {number} weighted          raw weighted total, 0-100
 * @param {number} normalisedMean    mean of the per-judge normalised scores, 0-100
 * @param {boolean} usable           whether any judge provided a usable personal scale
 */
function blend(weighted, normalisedMean, usable) {
  if (!usable) {
    return {
      value: round2(weighted),
      method: 'weighted',
      note: 'Normalisation skipped: no judge varied their scores enough to correct for.',
    };
  }
  return { value: round2(weighted * 0.6 + normalisedMean * 0.4), method: 'blend', note: '' };
}

/**
 * Score one project across an event: pulls submitted reviews, normalises
 * each judge against their own history, then aggregates.
 */
function scoreProject(eventId, projectId) {
  const criteria = criteriaFor(eventId);
  const review = db().prepare(`
    SELECT r.id, r.judge_id, r.total_score, r.state, j.name AS judge_name
    FROM reviews r JOIN judges j ON j.id = r.judge_id
    WHERE r.event_id = ? AND r.project_id = ? AND r.state = 'submitted'
  `).all(eventId, projectId);

  if (!review.length) {
    return { submitted: 0, weighted: 0, normalised: 0, final: 0, method: 'weighted', note: 'No submitted reviews yet.', perJudge: [] };
  }

  const weightedValues = review.map((r) => r.total_score);
  const normalisedValues = [];
  const perJudge = [];

  for (const r of review) {
    const population = db().prepare(`
      SELECT total_score FROM reviews
      WHERE judge_id = ? AND state = 'submitted'
    `).all(r.judge_id).map((row) => row.total_score);
    const n = normaliseAgainst(r.total_score, population);
    normalisedValues.push(n.value);
    perJudge.push({
      judgeId: r.judge_id,
      judgeName: r.judge_name,
      weighted: r.total_score,
      normalised: n.value,
      method: n.method,
    });
  }

  const weighted = round2(mean(weightedValues));
  const rawNormalised = round2(mean(normalisedValues));
  // A judge is only a usable correction if their own scores actually varied.
  const usableCount = perJudge.filter((p) => p.method === 'z-score').length;
  const blended = blend(weighted, rawNormalised, usableCount > 0);

  return {
    submitted: review.length,
    weighted,
    normalised: rawNormalised,
    final: blended.value,
    method: blended.method,
    note: blended.note,
    judgesNormalised: usableCount,
    judgesTotal: perJudge.length,
    perJudge,
  };
}

/** Standings for a whole event, ranked by the blended score. */
function standings(eventId) {
  const projects = db().prepare(`
    SELECT p.id, p.name, p.slug, p.cover_hue, p.is_public, t.name AS track_name, t.id AS track_id
    FROM projects p LEFT JOIN tracks t ON t.id = p.track_id
    WHERE p.event_id = ? AND p.status = 'submitted'
  `).all(eventId);

  const rows = projects.map((p) => ({ trackRank: 0, ...p, ...scoreProject(eventId, p.id) }));
  rows.sort((a, b) => (b.final - a.final) || (b.weighted - a.weighted) || a.name.localeCompare(b.name));

  let rank = 0;
  let lastKey = null;
  for (const row of rows) {
    const key = row.final;
    if (key !== lastKey) { rank += 1; lastKey = key; }
    row.rank = rank;
  }

  // Track-relative rank, so a small track still produces a winner.
  const byTrack = new Map();
  for (const row of rows) {
    if (!row.track_id) continue;
    if (!byTrack.has(row.track_id)) byTrack.set(row.track_id, []);
    byTrack.get(row.track_id).push(row);
  }
  for (const group of byTrack.values()) {
    group.sort((a, b) => (b.final - a.final));
    group.forEach((row, i) => { row.track_rank = i + 1; });
  }

  return rows;
}

/* -------------------------------------------------- pairwise (Bradley–Terry) */

/**
 * Win/loss matrix from a judge's pairwise comparisons, solved with a few
 * dozen iterations of the standard MM algorithm. Used for the bonus
 * "pairwise judging mode" and to expose relative strength in the UI.
 */
function bradleyTerry(comparisons) {
  // Both sides of every comparison take part, including a project that has
  // never won: excluding it would quietly hide the weakest entry.
  const seen = new Set();
  const names = new Map();
  for (const c of comparisons) {
    for (const id of [c.project_a, c.project_b]) {
      if (!seen.has(id)) { seen.add(id); names.set(id, 0); }
    }
    if (c.winner === 'a') names.set(c.project_a, (names.get(c.project_a) || 0) + c.weightOfA);
    if (c.winner === 'b') names.set(c.project_b, (names.get(c.project_b) || 0) + c.weightOfB);
    if (c.winner === 'tie') {
      names.set(c.project_a, (names.get(c.project_a) || 0) + 0.5);
      names.set(c.project_b, (names.get(c.project_b) || 0) + 0.5);
    }
  }
  const ids = [...names.keys()];
  if (!ids.length) return [];

  const strength = new Map(ids.map((id) => [id, 1]));
  const wins = new Map(ids.map((id) => [id, 0]));

  for (let iter = 0; iter < 60; iter += 1) {
    wins.clear();
    for (const id of ids) wins.set(id, 0);
    for (const c of comparisons) {
      const wA = c.weightOfA;
      const wB = c.weightOfB;
      if (c.winner === 'a') {
        wins.set(c.project_a, wins.get(c.project_a) + wA);
        wins.set(c.project_b, wins.get(c.project_b) + 0);
      } else if (c.winner === 'b') {
        wins.set(c.project_b, wins.get(c.project_b) + wB);
        wins.set(c.project_a, wins.get(c.project_a) + 0);
      } else if (c.winner === 'tie') {
        wins.set(c.project_a, wins.get(c.project_a) + wA * 0.5);
        wins.set(c.project_b, wins.get(c.project_b) + wB * 0.5);
      }
    }
    for (const id of ids) {
      const w = wins.get(id);
      if (w <= 0) continue;
      let denominator = 0;
      for (const other of ids) {
        const s = strength.get(id);
        const o = strength.get(other);
        denominator += cAdd(s, o);
      }
      const target = sAdd(strength.get(id), w);
      if (denominator > 0 && target > 0) {
        strength.set(id, (strength.get(id) * w) / denominator + 0.0001);
      }
    }
  }

  // A perfect record drives the unconstrained strength towards infinity, which
  // is useless to display. Report the ratio to the strongest entry instead,
  // scaled so the leader reads 100 and the field reads 0-100.
  const raw = ids
    .map((id) => ({ projectId: id, raw: strength.get(id), wins: wins.get(id) }))
    .sort((a, b) => b.raw - a.raw);
  const top = raw.length ? raw[0].raw : 1;
  return raw.map((r) => ({
    projectId: r.projectId,
    strength: round2((r.raw / top) * 100),
    wins: r.wins,
  }));
}

const sAdd = (x, y) => x + y;
const cAdd = (x, y) => 1 / (1 + y / x);

/* --------------------------------------------------------------- utilities */

function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }
function round4(n) { return Math.round((Number(n) + Number.EPSILON) * 10000) / 10000; }
function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, Number(n) || 0)); }

module.exports = {
  criteriaFor,
  weightedTotal,
  rawTotal,
  normaliseAgainst,
  blend,
  scoreProject,
  standings,
  bradleyTerry,
  mean,
  stdev,
  round2,
  clamp,
};
