import { SUPPRESSED } from './anonymize';
import type { ColumnLadder, Dataset, Policy } from './types';

/**
 * Analysis fidelity — how much of the thing you were actually going to publish
 * survives the anonymization.
 *
 * Blurring data always costs you something. The honest question is not "is the
 * data still good" in the abstract, but "do the specific tables I said I'd
 * print still say the same thing". So the user declares those tables up front,
 * and fidelity is measured only over them.
 *
 * Each table is a set of cells with counts. Normalize the counts to a
 * distribution and compare before/after with total variation distance:
 *
 *     TVD(P, Q) = ½ · Σ |P(cell) − Q(cell)|
 *
 * TVD is in [0, 1] and has a plain reading: it is the largest error you could
 * make in any single published proportion. Fidelity = 1 − TVD.
 */

export interface ReportTable {
  id: string;
  label: string;
  /** The column whose values become the table's rows. */
  groupBy: string;
  /** Optional breakdown column, e.g. the sensitive answer. */
  breakdownBy?: string;
}

export type Distribution = Map<string, number>;

const CELL_SEP = ' ';

/** Raw counts per cell, straight from the untouched data. */
export function rawDistribution(dataset: Dataset, table: ReportTable): Distribution {
  const counts: Distribution = new Map();
  for (const row of dataset.rows) {
    const group = String(row[table.groupBy] ?? '');
    const cell = table.breakdownBy
      ? `${group}${CELL_SEP}${String(row[table.breakdownBy] ?? '')}`
      : group;
    counts.set(cell, (counts.get(cell) ?? 0) + 1);
  }
  return normalize(counts);
}

/**
 * Counts per cell as reconstructed by a reader of the *anonymized* release.
 *
 * If the grouping column has been banded, the reader cannot recover which exact
 * category a row belonged to. The standard naive reconstruction — and the one a
 * student journalist would actually do — is to split a band's count evenly
 * across the categories it covers. A suppressed column splits across all of
 * them. That spreading is exactly where fidelity is lost.
 */
export function reconstructedDistribution(
  dataset: Dataset,
  ladders: ColumnLadder[],
  policy: Policy,
  table: ReportTable,
): Distribution {
  const ladder = ladders.find((l) => l.column === table.groupBy);

  // The grouping column was never generalized, so nothing was lost.
  if (!ladder) return rawDistribution(dataset, table);

  const levelIndex = Math.min(
    Math.max(policy[ladder.column] ?? 0, 0),
    ladder.levels.length - 1,
  );
  const level = ladder.levels[levelIndex];

  // Which raw categories does each generalized value cover?
  const allCategories = new Set<string>();
  const coveredBy = new Map<string, Set<string>>();
  for (const row of dataset.rows) {
    const raw = String(row[table.groupBy] ?? '');
    allCategories.add(raw);
    const generalized = level.apply(raw);
    let bucket = coveredBy.get(generalized);
    if (!bucket) {
      bucket = new Set();
      coveredBy.set(generalized, bucket);
    }
    bucket.add(raw);
  }

  const counts: Distribution = new Map();
  for (const row of dataset.rows) {
    const raw = String(row[table.groupBy] ?? '');
    const generalized = level.apply(raw);
    const targets =
      generalized === SUPPRESSED
        ? [...allCategories]
        : [...(coveredBy.get(generalized) ?? new Set([raw]))];
    const share = 1 / targets.length;

    for (const category of targets) {
      const cell = table.breakdownBy
        ? `${category}${CELL_SEP}${String(row[table.breakdownBy] ?? '')}`
        : category;
      counts.set(cell, (counts.get(cell) ?? 0) + share);
    }
  }
  return normalize(counts);
}

function normalize(counts: Distribution): Distribution {
  let total = 0;
  for (const value of counts.values()) total += value;
  if (total === 0) return counts;
  const out: Distribution = new Map();
  for (const [cell, value] of counts) out.set(cell, value / total);
  return out;
}

/** Total variation distance between two distributions over the same cells. */
export function totalVariationDistance(p: Distribution, q: Distribution): number {
  const cells = new Set([...p.keys(), ...q.keys()]);
  let sum = 0;
  for (const cell of cells) sum += Math.abs((p.get(cell) ?? 0) - (q.get(cell) ?? 0));
  return sum / 2;
}

export interface FidelityResult {
  /** 1 − worst TVD across the declared tables, in [0, 1]. */
  fidelity: number;
  /** Per-table TVD, so the UI can name which table suffered. */
  perTable: { id: string; label: string; tvd: number }[];
}

/**
 * Fidelity across every declared table, reported as the worst case. Averaging
 * would let a badly mangled table hide behind an intact one.
 */
export function computeFidelity(
  dataset: Dataset,
  ladders: ColumnLadder[],
  policy: Policy,
  tables: ReportTable[],
): FidelityResult {
  if (tables.length === 0) return { fidelity: 1, perTable: [] };

  const perTable = tables.map((table) => {
    const p = rawDistribution(dataset, table);
    const q = reconstructedDistribution(dataset, ladders, policy, table);
    return { id: table.id, label: table.label, tvd: totalVariationDistance(p, q) };
  });

  const worst = Math.max(...perTable.map((t) => t.tvd));
  return { fidelity: 1 - worst, perTable };
}
