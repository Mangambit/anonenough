/**
 * Core data model for AnonEnough.
 *
 * A dataset is a list of rows keyed by column name. Everything downstream
 * (equivalence classes, risk, fidelity, the remediation search) is computed
 * from a Dataset plus a Policy, and nothing is ever mutated in place.
 */

export type Row = Record<string, string>;

export interface Dataset {
  columns: string[];
  rows: Row[];
  /** Provenance shown in the UI. Synthetic demo data must say so. */
  label?: string;
}

/**
 * One rung of a generalization ladder for a single column.
 *
 * `apply` maps a raw cell value to its generalized form. Level 0 is always
 * the identity ("exact"); the last level is always full suppression ("*").
 * Coarser levels merge more rows together, which is what makes k rise.
 */
export interface Level {
  label: string;
  apply: (value: string) => string;
}

export interface ColumnLadder {
  column: string;
  levels: Level[];
}

/**
 * A policy picks one ladder level per quasi-identifier column.
 * Keys are column names; values are indices into that column's `levels`.
 */
export type Policy = Record<string, number>;

/** A group of rows that share the same generalized quasi-identifier tuple. */
export interface EquivalenceClass {
  /** The generalized values, in QI-column order. */
  key: string[];
  /** Indices into Dataset.rows. */
  rowIndices: number[];
  size: number;
}

export interface ClassResult {
  classes: EquivalenceClass[];
  /** classIndex[rowIndex] -> index into `classes`. */
  classIndex: number[];
  /** Smallest class size in the dataset. k = 1 means someone is unique. */
  k: number;
  /** How many rows sit in a class of size 1. */
  uniqueRows: number;
}
