// Schema inference for uploaded files: turn parsed CSV into the same descriptor
// shape the demo file uses, so the engine and the page never care where a
// dataset came from.
//
// Three rules carried over from the demo engine, because they are load-bearing:
//   • every ladder starts exact and ends suppressed;
//   • every numeric ladder uses power-of-two band widths, so coarsening MERGES
//     classes and never splits them (the invariant the whole search rests on);
//   • no invented hierarchies — a categorical column we know nothing about gets
//     exact → removed, not a made-up grouping we could not defend to a judge.

import { SUPPRESSED } from './schema.js';

export const ROW_CAP = 5000; // the lattice search is exhaustive; cap and say so
const QI_CANDIDATE_CAP = 8;
const INITIAL_QI_COUNT = 3;
const MAX_BANDS = 24;

// ─── Per-column statistics ───────────────────────────────────────────────────

export function columnStats(values) {
  const distinct = new Set();
  let blanks = 0;
  let numeric = 0;
  let integers = 0;
  let min = Infinity;
  let max = -Infinity;

  for (const raw of values) {
    const v = String(raw).trim();
    if (v === '') { blanks++; continue; }
    distinct.add(v);
    const n = Number(v);
    if (Number.isFinite(n)) {
      numeric++;
      if (Number.isInteger(n)) integers++;
      if (n < min) min = n;
      if (n > max) max = n;
    }
  }

  const filled = values.length - blanks;
  return {
    filled,
    blanks,
    distinct: distinct.size,
    uniqueRatio: filled ? distinct.size / filled : 0,
    isNumeric: filled > 0 && numeric / filled >= 0.9 && distinct.size > 1,
    isInteger: filled > 0 && integers === numeric,
    min,
    max,
  };
}

// Headers that name a person or a key directly. Cardinality is the real test —
// the pattern only lowers the bar for columns that also *say* what they are.
const ID_HINT = /\b(name|email|e-mail|phone|student|address|username|user|ssn|id|uuid)\b/i;

export function isDirectIdentifier(header, stats) {
  if (stats.filled < 5) return false;
  if (stats.isNumeric && !ID_HINT.test(header)) return false; // ages, scores, years
  const bar = ID_HINT.test(header) ? 0.5 : 0.9;
  return stats.uniqueRatio >= bar && stats.distinct >= 5;
}

// ─── Generalization ladders ──────────────────────────────────────────────────

function formatBand(lo, width, isInteger) {
  const hi = isInteger ? lo + width - 1 : lo + width;
  if (lo < 0 || hi < 0) return isInteger ? `${lo} to ${hi}` : `${lo} to <${hi}`;
  return isInteger ? `${lo}–${hi}` : `${lo}–<${hi}`;
}

function bandLevel(width, isInteger) {
  return {
    label: `bands of ${width}`,
    short: `band ${width}`,
    apply: (v) => {
      const s = String(v).trim();
      if (s === '') return '(blank)';
      const n = Number(s);
      if (!Number.isFinite(n)) return s;
      const lo = Math.floor(n / width) * width;
      return formatBand(lo, width, isInteger);
    },
  };
}

const EXACT = { label: 'exact', short: 'exact', apply: (v) => String(v) };
const REMOVED = { label: 'removed', short: 'removed', apply: () => SUPPRESSED };

/**
 * exact → band w → band 2w → removed for numeric columns, exact → removed for
 * everything else. w is the smallest power of two that keeps the column at or
 * under MAX_BANDS bands, so a 14–18 age column bands by 2 while an income
 * column bands by thousands.
 */
export function autoLadder(column, stats) {
  const levels = [EXACT];
  if (stats.isNumeric) {
    const range = Math.max(stats.max - stats.min, 1);
    let w = 2;
    while (range / w > MAX_BANDS) w *= 2;
    levels.push(bandLevel(w, stats.isInteger), bandLevel(w * 2, stats.isInteger));
  }
  levels.push(REMOVED);
  return { column, levels };
}

// ─── Descriptor assembly ─────────────────────────────────────────────────────

function shortLabel(header) {
  const clean = header.replace(/[?？]\s*$/, '').trim();
  if (clean.length <= 18) return clean;
  const cut = clean.slice(0, 17);
  const space = cut.lastIndexOf(' ');
  return `${cut.slice(0, space > 8 ? space : 17)}…`;
}

/**
 * Build a dataset descriptor from parsed CSV. Every judgment call made here is
 * written into `notices` — the page shows them, because a default the user
 * never saw is a default they cannot defend.
 */
export function inferDescriptor({ headers, rows }, fileName) {
  const notices = [];

  let kept = rows;
  if (rows.length > ROW_CAP) {
    kept = rows.slice(0, ROW_CAP);
    notices.push(`Large file: auditing the first ${ROW_CAP.toLocaleString()} of ${rows.length.toLocaleString()} rows. Every number on this page covers only those.`);
  }

  const order = headers;
  const stats = {};
  const short = {};
  headers.forEach((columnName, i) => {
    stats[columnName] = columnStats(kept.map((r) => r[i]));
    short[columnName] = shortLabel(columnName);
  });

  const datasetRows = kept.map((r) => {
    const obj = {};
    headers.forEach((columnName, i) => { obj[columnName] = r[i]; });
    return obj;
  });

  // Direct identifiers: removed from every published view before any counting.
  // The audit is about what the file still says AFTER the obvious step.
  const directIds = headers.filter((c) => isDirectIdentifier(c, stats[c]));
  for (const c of directIds) {
    notices.push(`“${short[c]}” looks like a direct identifier (${stats[c].distinct} distinct values in ${stats[c].filled} rows) — removed from the published file before the audit. The audit is about what is left.`);
  }

  const usable = headers.filter((c) => !directIds.includes(c) && stats[c].distinct > 1);
  if (usable.length < 2) {
    throw new Error('After removing direct identifiers, fewer than two informative columns remain — nothing to audit.');
  }

  // Sensitive answer: default to the last usable column — surveys put the
  // question that needed the anonymity promise at the end. Changeable on page.
  const sensitive = usable[usable.length - 1];

  // Attacker-model candidates: what an outsider could recognize on sight.
  // Free-text-like columns (hundreds of distinct values, non-numeric) are out.
  const recognizable = usable.filter((c) => c !== sensitive
    && (stats[c].isNumeric || stats[c].distinct <= 60));
  const qiCandidates = recognizable.slice(0, QI_CANDIDATE_CAP);
  if (recognizable.length > QI_CANDIDATE_CAP) {
    notices.push(`Only the first ${QI_CANDIDATE_CAP} recognizable columns are offered as attacker knowledge; toggle chips to swap the model.`);
  }

  // Starting attacker model: the lowest-cardinality candidates — the things a
  // classmate is most likely to actually know (grade before exact age).
  const initialQis = [...qiCandidates]
    .sort((a, b) => stats[a].distinct - stats[b].distinct)
    .slice(0, INITIAL_QI_COUNT);

  if (!initialQis.length) {
    throw new Error('No column looks like something an outsider could recognize — declare the attacker model by editing the file, or audit a file with demographic columns.');
  }

  const ladders = {};
  for (const c of qiCandidates) ladders[c] = autoLadder(c, stats[c]);

  // Declared tables: fixed at upload time (initial model × sensitive), so
  // fidelity stays comparable while the attacker chips are toggled.
  //
  // WHY the highest-cardinality column is left out: a table is "dead" if its
  // group-by column gets suppressed, and the search refuses any policy that
  // kills a table. Declare a table over EVERY attacker column and every route
  // to a larger group is forbidden — the search comes back empty and the tool
  // has no advice to give. The most identifying column is also the least
  // plausible publication axis, so it is the one left free to be coarsened.
  const byCardinality = [...initialQis].sort((a, b) => stats[a].distinct - stats[b].distinct);
  const tableGroupBys = byCardinality.length > 1 ? byCardinality.slice(0, -1) : byCardinality;

  // Full column names, not the truncated display labels — a notice that reads
  // “Have you experien…” undercuts the point it is making.
  notices.push(`Fidelity is measured against tables this tool guessed you would publish: “${sensitive}” broken down by ${tableGroupBys.map((c) => `“${c}”`).join(' and ')}. If those are not the numbers you actually need, the fidelity percentage is measuring the wrong thing.`);
  const tablesFor = (sens) => {
    const groups = tableGroupBys.filter((g) => g !== sens);
    return (groups.length ? groups : tableGroupBys).map((g) => ({
      label: `${short[sens]} by ${short[g]}`,
      groupBy: g,
      breakdownBy: g === sens ? null : sens,
    }));
  };

  return {
    kind: 'upload',
    generic: true,
    dataset: { columns: order, rows: datasetRows, name: fileName },
    order,
    short,
    stats,
    qiCandidates,
    initialQis,
    sensitive,
    sensitiveOptions: usable,
    directIds,
    notices,
    tablesFor,
    ladderFor: (column) => ladders[column] || autoLadder(column, stats[column]),
    provenance: `${fileName} · read locally in this tab · never sent anywhere`,
  };
}
