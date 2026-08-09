// The analysis engine. Pure functions over plain data — no DOM, no state, no I/O.
//
// A *policy* maps a column name to an index into that column's generalization ladder.
// Level 0 is always "exact"; the last level is always "removed" (suppressed).
//
// Ported from the AnonEnough v2 design prototype. Three decisions in here were arrived
// at the hard way and are load-bearing; each is marked WHY at the point it matters.

import { ACTIVITY_BROAD, ACTIVITY_CATEGORY, COL, SHORT, SUPPRESSED } from './schema.js';

// ─── Generalization ladders ──────────────────────────────────────────────────

function bandLevel(width) {
  return {
    label: `${width}-year bands`,
    short: `band ${width}`,
    apply: (v) => {
      const n = Number(String(v).trim());
      if (!Number.isFinite(n)) return String(v);
      const lo = Math.floor(n / width) * width;
      return `${lo}–${lo + width - 1}`;
    },
  };
}

const EXACT = { label: 'exact', short: 'exact', apply: (v) => String(v) };
const REMOVED = { label: 'removed', short: 'removed', apply: () => SUPPRESSED };

/** The ordered coarsening options available for one column. */
export function ladderFor(column) {
  const levels = [EXACT];

  if (column === COL.age) {
    // WHY 2 then 4, not 2 then 5: the ladder has to be a real hierarchy — moving
    // one rung up must MERGE groups, never split them, because that is what makes
    // k monotone and the search's "least destructive fix" trustworthy. Widths 2
    // and 5 do not nest: ages 14 and 15 share the band 14–15 at width 2, then
    // split into 10–14 and 15–19 at width 5. Powers of two nest by construction.
    // (Swept on the shipped seed this never actually lowered k in any of the 31
    // attacker models — but it would the moment a real file is uploaded.)
    levels.push(bandLevel(2), bandLevel(4));
  } else if (column === COL.grade) {
    levels.push(
      {
        label: 'paired grades',
        short: 'pairs',
        apply: (v) => {
          const n = Number(v);
          if (!Number.isFinite(n)) return String(v);
          const lo = 9 + Math.floor((n - 9) / 2) * 2;
          return `${lo}–${lo + 1}`;
        },
      },
      {
        label: 'lower / upper school',
        short: 'school',
        apply: (v) => (Number(v) <= 10 ? 'Lower school' : 'Upper school'),
      },
    );
  } else if (column === COL.activity) {
    levels.push(
      { label: 'grouped by kind', short: 'kind', apply: (v) => ACTIVITY_CATEGORY[v] || String(v) },
      { label: 'competitive / creative', short: 'broad', apply: (v) => ACTIVITY_BROAD[v] || String(v) },
    );
  } else if (column === COL.homeroom) {
    levels.push({ label: 'wing only', short: 'wing', apply: (v) => `${String(v).charAt(0)} wing` });
  }

  levels.push(REMOVED);
  return { column, levels };
}

export function levelFor(ladder, policy) {
  const i = Math.min(Math.max(policy[ladder.column] || 0, 0), ladder.levels.length - 1);
  return ladder.levels[i];
}

export function generalizeRow(row, ladders, policy) {
  return ladders.map((l) => levelFor(l, policy).apply(row[l.column] != null ? row[l.column] : ''));
}

// ─── Equivalence classes and k ───────────────────────────────────────────────

const KEY_SEP = '␟'; // a codepoint no survey answer will contain

/**
 * Group rows that are indistinguishable to an attacker who knows the quasi-identifiers.
 * Returns the classes, a row→class lookup, k (smallest class), and how many classes
 * contain exactly one person.
 */
export function computeClasses(dataset, ladders, policy) {
  const byKey = new Map();
  const classIndex = new Array(dataset.rows.length).fill(-1);

  dataset.rows.forEach((row, i) => {
    const mapKey = generalizeRow(row, ladders, policy).join(KEY_SEP);
    let cls = byKey.get(mapKey);
    if (!cls) {
      cls = { key: mapKey, rowIndices: [], size: 0 };
      byKey.set(mapKey, cls);
    }
    cls.rowIndices.push(i);
    cls.size++;
  });

  const classes = [...byKey.values()];
  classes.forEach((c, i) => c.rowIndices.forEach((r) => { classIndex[r] = i; }));

  const k = classes.length === 0 ? 0 : Math.min(...classes.map((c) => c.size));
  return { classes, classIndex, k, uniqueRows: classes.filter((c) => c.size === 1).length };
}

/**
 * Classes of two or more that all gave the same answer to the sensitive question.
 * k hides *who* you are; it does nothing about a group that unanimously answered "Yes".
 */
export function homogeneousClasses(dataset, classes, sensitiveColumn) {
  return classes.filter((c) => {
    if (c.size < 2) return false;
    const first = dataset.rows[c.rowIndices[0]][sensitiveColumn];
    return c.rowIndices.every((i) => dataset.rows[i][sensitiveColumn] === first);
  });
}

// ─── Fidelity: what survives of the statistics you meant to publish ──────────

function normalize(counts) {
  let total = 0;
  counts.forEach((v) => { total += v; });
  if (!total) return counts;
  const out = new Map();
  counts.forEach((v, key) => out.set(key, v / total));
  return out;
}

export function rawDistribution(dataset, table) {
  const counts = new Map();
  for (const row of dataset.rows) {
    const g = String(row[table.groupBy]);
    const cell = table.breakdownBy ? g + KEY_SEP + String(row[table.breakdownBy]) : g;
    counts.set(cell, (counts.get(cell) || 0) + 1);
  }
  return normalize(counts);
}

/**
 * What an analyst could reconstruct from the *generalized* file: a banded or suppressed
 * value spreads its weight uniformly across the raw values it could have covered.
 */
export function reconstructedDistribution(dataset, ladders, policy, table) {
  const ladder = ladders.find((l) => l.column === table.groupBy);
  if (!ladder) return rawDistribution(dataset, table);

  const level = levelFor(ladder, policy);
  const all = new Set();
  const coveredBy = new Map();
  for (const row of dataset.rows) {
    const raw = String(row[table.groupBy]);
    all.add(raw);
    const g = level.apply(raw);
    if (!coveredBy.has(g)) coveredBy.set(g, new Set());
    coveredBy.get(g).add(raw);
  }

  const counts = new Map();
  for (const row of dataset.rows) {
    const raw = String(row[table.groupBy]);
    const g = level.apply(raw);
    const targets = g === SUPPRESSED ? [...all] : [...(coveredBy.get(g) || new Set([raw]))];
    const share = 1 / targets.length;
    for (const cat of targets) {
      const cell = table.breakdownBy ? cat + KEY_SEP + String(row[table.breakdownBy]) : cat;
      counts.set(cell, (counts.get(cell) || 0) + share);
    }
  }
  return normalize(counts);
}

/** Total variation distance: half the L1 distance between two distributions. */
export function tvd(p, q) {
  const cells = new Set([...p.keys(), ...q.keys()]);
  let sum = 0;
  cells.forEach((c) => { sum += Math.abs((p.get(c) || 0) - (q.get(c) || 0)); });
  return sum / 2;
}

export function computeFidelity(dataset, ladders, policy, tables) {
  if (!tables.length) return { fidelity: 1, perTable: [] };

  const suppressed = (column) => {
    const l = ladders.find((x) => x.column === column);
    return !!l && levelFor(l, policy).apply('x') === SUPPRESSED;
  };

  const perTable = tables.map((t) => {
    // WHY: if a table's group-by or breakdown column is gone, the table cannot be
    // published at all. That is categorically worse than a distorted table, so it is
    // flagged `dead` and the search refuses to recommend the policy that caused it.
    const dead = suppressed(t.groupBy) || suppressed(t.breakdownBy);
    return {
      label: t.label,
      dead,
      tvd: dead ? 1 : tvd(rawDistribution(dataset, t), reconstructedDistribution(dataset, ladders, policy, t)),
    };
  });

  // WHY: mean, not max. Max saturates — once the worst table is wrecked, further damage
  // elsewhere becomes invisible and the whole tradeoff curve reads as a flat plateau.
  const mean = perTable.reduce((s, t) => s + t.tvd, 0) / perTable.length;
  return { fidelity: 1 - mean, perTable };
}

/**
 * How mangled the file is, independent of what it is being used for.
 * WHY the square: it makes deleting a column categorically more expensive than a mild
 * generalization. With a linear cost the search happily buys privacy by dropping columns.
 */
export function distortionOf(ladders, policy) {
  if (!ladders.length) return 0;
  let sum = 0;
  for (const l of ladders) {
    const max = l.levels.length - 1;
    if (max > 0) sum += ((policy[l.column] || 0) / max) ** 2;
  }
  return sum / ladders.length;
}

/**
 * `short` maps a column to its display label. It falls back to the column name
 * itself, because an uploaded file's columns are not in the demo's label table
 * and a recommendation that reads "undefined → removed" is worse than a long one.
 */
export function describePolicy(ladders, policy, short = SHORT) {
  const parts = ladders
    .filter((l) => (policy[l.column] || 0) > 0)
    .map((l) => `${(short && short[l.column]) || l.column} → ${l.levels[policy[l.column]].label}`);
  return parts.length ? parts.join(' · ') : 'the file unchanged';
}

// ─── Searching the lattice ───────────────────────────────────────────────────

/** Every policy whose level indices sum to exactly `depth`. */
export function policiesAtDepth(ladders, depth) {
  const results = [];
  const walk = (i, remaining, acc) => {
    if (i === ladders.length) {
      if (remaining === 0) results.push({ ...acc });
      return;
    }
    const max = ladders[i].levels.length - 1;
    for (let lv = 0; lv <= Math.min(max, remaining); lv++) {
      acc[ladders[i].column] = lv;
      walk(i + 1, remaining - lv, acc);
    }
    acc[ladders[i].column] = 0;
  };
  walk(0, depth, {});
  return results;
}

/** The point just before the steepest drop in fidelity per unit of k. */
export function findKnee(frontier) {
  if (!frontier.length) return null;
  if (frontier.length <= 2) return frontier[frontier.length - 1];

  let kneeIndex = frontier.length - 1;
  let worst = -Infinity;
  for (let i = 1; i < frontier.length; i++) {
    const dk = frontier[i].k - frontier[i - 1].k;
    if (dk <= 0) continue;
    const drop = (frontier[i - 1].fidelity - frontier[i].fidelity) / dk;
    if (drop > worst) {
      worst = drop;
      kneeIndex = i - 1;
    }
  }
  return frontier[kneeIndex];
}

export const DEFAULT_TARGETS = [2, 3, 5, 8, 12, 20, 40];

/**
 * Exhaustively evaluate the policy lattice, then for each target k keep the single
 * least destructive policy that reaches it *without killing a declared table*.
 *
 * Ranking on fidelity — the axis actually plotted — is what makes the returned curve
 * monotonically decreasing. If nothing publishable reaches any target the frontier comes
 * back empty and the caller must show an explicit empty state rather than recommending
 * a policy that destroys a table the publisher said they needed.
 */
export function searchFrontier(dataset, ladders, tables, targets = DEFAULT_TARGETS, short = SHORT) {
  const total = ladders.reduce((p, l) => p * l.levels.length, 1);
  const maxDepth = ladders.reduce((s, l) => s + (l.levels.length - 1), 0);

  const all = [];
  for (let d = 0; d <= maxDepth; d++) {
    for (const policy of policiesAtDepth(ladders, d)) {
      const classes = computeClasses(dataset, ladders, policy);
      const fid = computeFidelity(dataset, ladders, policy, tables);
      all.push({
        policy,
        k: classes.k,
        uniqueRows: classes.uniqueRows,
        fidelity: fid.fidelity,
        dead: fid.perTable.filter((t) => t.dead).length,
        distortion: distortionOf(ladders, policy),
      });
    }
  }

  const frontier = [];
  for (const target of [...targets].sort((a, b) => a - b)) {
    const feasible = all.filter((e) => e.k >= target && e.dead === 0);
    if (!feasible.length) continue;
    const best = feasible.reduce((a, b) => (
      b.fidelity > a.fidelity || (b.fidelity === a.fidelity && b.distortion < a.distortion) ? b : a
    ));
    frontier.push({ ...best, target, description: describePolicy(ladders, best.policy, short) });
  }

  // Several targets often land on the same policy; keep one point per distinct policy.
  const seen = new Map();
  for (const p of frontier) {
    const key = ladders.map((l) => p.policy[l.column] || 0).join(',');
    const existing = seen.get(key);
    if (!existing || p.target > existing.target) seen.set(key, p);
  }

  const deduped = [...seen.values()].sort((a, b) => a.k - b.k);
  return { frontier: deduped, evaluated: all.length, total, knee: findKnee(deduped) };
}
