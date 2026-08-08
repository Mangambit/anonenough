import { SUPPRESSED } from './anonymize';
import type { ClassResult, Dataset, EquivalenceClass, Row } from './types';

/**
 * l-diversity — does the group still hide the *answer*?
 *
 * k-anonymity is a claim about identity: "at least k people share this
 * description". It says nothing about what those k people said. If all fourteen
 * of them gave the same answer to the sensitive question, an attacker who
 * narrows you to that group learns your answer without ever learning your name.
 * Being one-of-fourteen is no comfort when all fourteen said yes.
 *
 * Machanavajjhala et al. (2007) named this the homogeneity attack and proposed
 * the counter-measure: every equivalence class should be "well represented" by
 * at least l distinct sensitive values. This module MEASURES that; it does not
 * enforce it. The engine already detects the extreme case — `homogeneousClasses`
 * in anonymize.ts is exactly the l = 1 test — but "not homogeneous" and "safe"
 * are very different claims, and everything interesting lives in between them.
 *
 * TWO MEASURES, DELIBERATELY BOTH:
 *
 *   Distinct l — how many distinct sensitive values appear in the class. Easy
 *     to explain, easy for a judge to count by hand, and far too generous: it
 *     scores one dissenting answer among thirteen as though it were real cover.
 *
 *   Entropy l — exp(H), where H is the Shannon entropy of the sensitive values
 *     inside the class. Read it as the *effective* number of answers: how many
 *     equally-likely categories would leave an attacker exactly as uncertain as
 *     this class really does.
 *
 * WHY ENTROPY IS THE STRICTER OF THE TWO. Take a class of 13 "No" and 1 "Yes".
 * Its distinct l is 2, so it passes any 2-diversity test. But an attacker who
 * narrows someone to that class guesses "No" and is right 93% of the time — the
 * class is still effectively disclosive. Its entropy l is 1.29: barely above the
 * 1.0 of a fully homogeneous class, which is the honest description of how much
 * cover it actually provides. Distinct l counts the answers that exist; entropy
 * l weighs how much each one actually hides. Where they disagree, entropy is
 * the one to believe, and it is always the smaller of the two.
 *
 * A note on logarithm bases, because it looks like a choice and is not:
 * exp(H_nats) and 2^(H_bits) are the same number. The "effective number of
 * categories" is base-independent, so this file uses natural log throughout
 * without committing the reader to a unit.
 *
 * THE INVARIANT WORTH PINNING (scripts/verify.ts does):
 *
 *     1 ≤ entropy l ≤ distinct l ≤ class size
 *
 * The left equality holds exactly when the class is homogeneous; the middle
 * equality holds exactly when the answers are uniformly spread.
 *
 * Recursive (c, l)-diversity from the same paper is deliberately NOT here. It
 * needs a c the user would have to pick, and there is no defensible way to pick
 * it in this UI — an unexplainable knob is worse than a missing feature.
 */

/** One sensitive value inside one equivalence class. */
export interface SensitiveCount {
  /** The trimmed cell value. Blank cells are canonicalized to `''`. */
  value: string;
  count: number;
  /** count / class size — the attacker's posterior for a member of this class. */
  share: number;
}

export interface ClassDiversity {
  /** Index into `ClassResult.classes`, so the UI can find the rows to highlight. */
  index: number;
  /** The generalized quasi-identifier tuple, for display. */
  key: string[];
  size: number;
  /** Distinct sensitive values present. Blank counts as one of them. */
  distinctL: number;
  /** exp(H) — the effective number of answers. Always in [1, distinctL]. */
  entropyL: number;
  /** Values and their counts, most common first. `counts[0].share` is the
   *  attacker's best single guess and how often it lands. */
  counts: SensitiveCount[];
  /** Every sensitive cell in this class is the suppression marker. */
  sensitiveSuppressed: boolean;
  /** `size > 0 && !sensitiveSuppressed` — whether this class counts toward the
   *  dataset-wide minimum. Derived, but stated so callers do not have to guess. */
  measured: boolean;
}

/** One l-diversity measure, summarized over the whole dataset. */
export interface DiversityMeasure {
  /**
   * The l in "l-diversity": the minimum over measured classes, because privacy
   * is a worst-case property and the person who gets hurt is the least protected
   * one. `0` is not a real l — it means no class was measurable at all, so
   * check `measuredClasses` before rendering it.
   */
  l: number;
  /** The class that attained the minimum — the one worth highlighting. */
  worstClass: ClassDiversity | null;
  /** One entry per class, in `ClassResult.classes` order. */
  perClass: ClassDiversity[];
  /** How many classes contributed to `l`. */
  measuredClasses: number;
  /** How many were excluded because the sensitive column was suppressed. */
  suppressedClasses: number;
}

export interface DiversityResult {
  /** Minimum distinct l across measured classes. */
  distinctL: number;
  /** Minimum entropy l across measured classes. Never exceeds `distinctL`. */
  entropyL: number;
  /** The most disclosive class, ranked by entropy l. */
  worstClass: ClassDiversity | null;
  perClass: ClassDiversity[];
  measuredClasses: number;
  suppressedClasses: number;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), high);
}

/**
 * Read one sensitive cell.
 *
 * Missing keys, null, and whitespace-only cells all collapse to `''`, and BLANK
 * IS ITS OWN CATEGORY — it is not dropped and it is not merged into anything.
 * Two reasons. Dropping blank rows would shrink the class and inflate every
 * share left in it, reporting more certainty than the attacker has. And a blank
 * is itself an answer-shaped fact: "declined to answer" is information, often
 * correlated with the sensitive answer, and it is what the released table shows.
 *
 * The honest caveat, which is why `counts` exposes the blank instead of hiding
 * it: a class of 13 "No" and 1 blank scores distinct l = 2, and whether that
 * blank is real cover depends on what non-response means in this survey. That
 * is a judgement for a human, so the number is shown rather than assumed.
 *
 * Trimming means " Yes" and "Yes" are one answer here, while `homogeneousClasses`
 * compares raw cells and would call them two. The divergence only ever makes
 * this module stricter — it can merge values, never split them — which is the
 * safe direction for a privacy measure.
 */
function cellValue(row: Row | undefined, column: string): string {
  const raw = row?.[column];
  if (raw == null) return '';
  return String(raw).trim();
}

/** Count the sensitive values in one class and score both measures over them. */
function tallyClass(
  dataset: Dataset,
  cls: EquivalenceClass,
  index: number,
  sensitiveColumn: string,
): ClassDiversity {
  const tally = new Map<string, number>();
  for (const rowIndex of cls.rowIndices) {
    const value = cellValue(dataset.rows[rowIndex], sensitiveColumn);
    tally.set(value, (tally.get(value) ?? 0) + 1);
  }

  // Count what was actually tallied rather than trusting `cls.size`, so the
  // shares below are guaranteed to sum to 1 even on a malformed ClassResult.
  const size = cls.rowIndices.length;

  // An empty class has no distribution to measure. It cannot come out of
  // computeClasses — a class exists only once a row lands in it — but a caller
  // can hand us anything, and 0/0 is not a number anyone wants in a risk report.
  if (size === 0) {
    return {
      index,
      key: cls.key,
      size: 0,
      distinctL: 0,
      entropyL: 0,
      counts: [],
      sensitiveSuppressed: false,
      measured: false,
    };
  }

  let entropy = 0;
  for (const count of tally.values()) {
    const p = count / size;
    entropy -= p * Math.log(p);
  }

  const distinctL = tally.size;
  // Floating-point noise can push exp(H) a hair past distinctL on a perfectly
  // uniform class. Clamping to the interval the mathematics already guarantees
  // removes the noise; it is not a fudge of the measurement.
  const entropyL = clamp(Math.exp(entropy), 1, distinctL);

  const counts: SensitiveCount[] = [...tally.entries()]
    .map(([value, count]) => ({ value, count, share: count / size }))
    // Most common first; ties broken by value so the UI order is deterministic.
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));

  // The sensitive column was itself suppressed for this class: every cell is the
  // marker, so the release publishes no answer here and there is nothing to
  // disclose. Scoring it l = 1 would raise a homogeneity alarm about a column
  // that was never printed, so it is flagged and left out of the minimum. A
  // PARTIALLY suppressed class (some markers, some real answers) is measured
  // normally — there the marker is a published category like any other, and an
  // attacker really does learn something from the answers beside it.
  const sensitiveSuppressed = distinctL === 1 && tally.has(SUPPRESSED);

  return {
    index,
    key: cls.key,
    size,
    distinctL,
    entropyL,
    counts,
    sensitiveSuppressed,
    measured: !sensitiveSuppressed,
  };
}

function tallyAll(
  dataset: Dataset,
  classResult: ClassResult,
  sensitiveColumn: string,
): ClassDiversity[] {
  return classResult.classes.map((cls, index) =>
    tallyClass(dataset, cls, index, sensitiveColumn),
  );
}

/**
 * Is `b` more disclosive than `a` under this measure?
 *
 * Lower l first. Among equals, the larger class: a homogeneous block of twenty
 * exposes twenty people and a homogeneous pair exposes two, so the bigger one is
 * the one to point at. Index last, so the answer never depends on Map ordering.
 */
function isMoreDisclosive(
  a: ClassDiversity,
  b: ClassDiversity,
  metric: (cls: ClassDiversity) => number,
): boolean {
  const la = metric(a);
  const lb = metric(b);
  if (lb !== la) return lb < la;
  if (b.size !== a.size) return b.size > a.size;
  return b.index < a.index;
}

/** Reduce per-class scores to the worst case, which is the only case that matters. */
function summarize(
  perClass: ClassDiversity[],
  metric: (cls: ClassDiversity) => number,
): DiversityMeasure {
  const measured = perClass.filter((cls) => cls.measured);
  const worstClass = measured.reduce<ClassDiversity | null>(
    (worst, cls) => (worst === null || isMoreDisclosive(worst, cls, metric) ? cls : worst),
    null,
  );

  return {
    l: worstClass ? metric(worstClass) : 0,
    worstClass,
    perClass,
    measuredClasses: measured.length,
    suppressedClasses: perClass.filter((cls) => cls.sensitiveSuppressed).length,
  };
}

/**
 * Distinct l-diversity: the smallest number of distinct sensitive values in any
 * equivalence class.
 *
 * The generous measure, and the one to quote when explaining the idea, because
 * anyone can verify it by counting. Do not quote it alone — see the module
 * header for why 13-and-1 passes this test and should not.
 *
 * A single-row class scores 1: an attacker who narrows to it learns the answer
 * with certainty. Note that this is stricter than `homogeneousClasses`, which
 * skips classes of size 1 on the grounds that a lone row is already an identity
 * problem. Here it is counted, because from the attribute-disclosure side a
 * class of one is the worst case there is.
 */
export function distinctLDiversity(
  dataset: Dataset,
  classResult: ClassResult,
  sensitiveColumn: string,
): DiversityMeasure {
  return summarize(tallyAll(dataset, classResult, sensitiveColumn), (cls) => cls.distinctL);
}

/**
 * Entropy l-diversity: the smallest exp(H) over the equivalence classes.
 *
 * The measure to act on. It is never larger than distinct l, and the gap between
 * them is precisely the amount by which counting distinct answers flatters a
 * skewed class.
 *
 * Not an integer, and should not be rounded before comparison: a class scoring
 * 1.97 is not 2-diverse, and rounding it to 2 would report a threshold as met
 * when it was missed.
 */
export function entropyLDiversity(
  dataset: Dataset,
  classResult: ClassResult,
  sensitiveColumn: string,
): DiversityMeasure {
  return summarize(tallyAll(dataset, classResult, sensitiveColumn), (cls) => cls.entropyL);
}

/**
 * Both measures in one pass, plus the class to highlight.
 *
 * Prefer this over calling the two functions separately — they each re-tally the
 * dataset, and this shares the work.
 *
 * `worstClass` is ranked by entropy l, because that is the finer of the two
 * measures and the one whose worst case is worth a human's attention.
 *
 * `perClass` is in `ClassResult.classes` order and includes the classes that
 * were excluded from the minima. Do not take your own `Math.min` over it: the
 * headline numbers deliberately skip classes where the sensitive column was
 * suppressed, and a naive minimum would put those back in.
 */
export function computeDiversity(
  dataset: Dataset,
  classResult: ClassResult,
  sensitiveColumn: string,
): DiversityResult {
  const perClass = tallyAll(dataset, classResult, sensitiveColumn);
  const distinct = summarize(perClass, (cls) => cls.distinctL);
  const entropy = summarize(perClass, (cls) => cls.entropyL);

  return {
    distinctL: distinct.l,
    entropyL: entropy.l,
    worstClass: entropy.worstClass,
    perClass,
    measuredClasses: entropy.measuredClasses,
    suppressedClasses: entropy.suppressedClasses,
  };
}
