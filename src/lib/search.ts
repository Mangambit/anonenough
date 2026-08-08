import { computeClasses } from './anonymize';
import { computeFidelity } from './tvd';
import type { ReportTable } from './tvd';
import type { ColumnLadder, Dataset, Policy } from './types';

/**
 * The remediation search.
 *
 * There are many ways to blur a table — band the ages, roll up the activities,
 * suppress a column — and they trade off against each other. Rather than
 * guessing, search the whole space of combinations and find, for each privacy
 * target, the *least destructive* way to hit it.
 *
 * The space is a lattice: one axis per quasi-identifier, one step per rung of
 * that column's generalization ladder. Six columns with four rungs each is
 * 4,096 combinations — small enough to search exactly, large enough that
 * searching it beats guessing.
 *
 * THE PRUNING RULE (this is the part worth saying out loud):
 *
 *   Generalizing a column only ever merges equivalence classes together; it
 *   can never split one. So group sizes only grow, which means k is monotone
 *   non-decreasing as you move up the lattice.
 *
 * Two consequences make an exact answer cheap:
 *
 *   1. If a policy already meets your k target, every coarser policy above it
 *      also meets it — and is strictly more distorted. None of them can be a
 *      better answer, so the entire upward cone is skipped without evaluating.
 *
 *   2. Searching in non-decreasing order of distortion means the first policies
 *      that satisfy the target are minimal-distortion ones. Everything deeper
 *      is at least as distorted, so it cannot beat them either.
 *
 * This is the generalization property used by Samarati's and LeFevre's
 * k-anonymity algorithms. The counter in the UI reports how much of the space
 * was actually evaluated versus proved unnecessary.
 */

export interface PolicyEvaluation {
  policy: Policy;
  k: number;
  uniqueRows: number;
  fidelity: number;
  /** Normalized generalization cost in [0, 1], averaged over columns. */
  distortion: number;
}

export interface FrontierPoint extends PolicyEvaluation {
  /** The k value this point was searched for. */
  target: number;
  /** Human-readable summary, e.g. "Age → 2-wide bands · Activity → grouped". */
  description: string;
}

export interface SearchResult {
  frontier: FrontierPoint[];
  /** Policies actually evaluated. */
  evaluated: number;
  /** Size of the whole lattice. */
  total: number;
  /** total − evaluated: skipped because they could not beat the answer. */
  pruned: number;
  /** True when every combination was evaluated rather than pruned. */
  exhaustive: boolean;
  /** The knee: the best privacy-per-unit-fidelity point on the frontier. */
  knee: FrontierPoint | null;
}

/** Total number of policies in the lattice. */
export function latticeSize(ladders: ColumnLadder[]): number {
  return ladders.reduce((product, ladder) => product * ladder.levels.length, 1);
}

/** Average normalized generalization cost. 0 = untouched, 1 = all suppressed. */
export function distortionOf(ladders: ColumnLadder[], policy: Policy): number {
  if (ladders.length === 0) return 0;
  let sum = 0;
  for (const ladder of ladders) {
    const maxLevel = ladder.levels.length - 1;
    if (maxLevel <= 0) continue;
    sum += (policy[ladder.column] ?? 0) / maxLevel;
  }
  return sum / ladders.length;
}

export function describePolicy(ladders: ColumnLadder[], policy: Policy): string {
  const parts = ladders
    .filter((ladder) => (policy[ladder.column] ?? 0) > 0)
    .map((ladder) => {
      const level = ladder.levels[policy[ladder.column]];
      return `${ladder.column} → ${level.label}`;
    });
  return parts.length ? parts.join(' · ') : 'no changes';
}

function policyKey(ladders: ColumnLadder[], policy: Policy): string {
  return ladders.map((l) => policy[l.column] ?? 0).join(',');
}

/**
 * Enumerate the lattice one distortion-depth at a time.
 * Depth d contains every policy whose ladder steps sum to d.
 */
function policiesAtDepth(ladders: ColumnLadder[], depth: number): Policy[] {
  const results: Policy[] = [];

  const walk = (index: number, remaining: number, acc: Policy) => {
    if (index === ladders.length) {
      if (remaining === 0) results.push({ ...acc });
      return;
    }
    const ladder = ladders[index];
    const maxLevel = ladder.levels.length - 1;
    for (let level = 0; level <= Math.min(maxLevel, remaining); level++) {
      acc[ladder.column] = level;
      walk(index + 1, remaining - level, acc);
    }
    acc[ladder.column] = 0;
  };

  walk(0, depth, {});
  return results;
}

/** Above this many combinations, fall back to the pruned search. */
const EXHAUSTIVE_LIMIT = 50_000;

/**
 * Find the fix that reaches each k target while destroying the least of what
 * you were going to publish.
 *
 * The selection criterion is fidelity, not ladder steps. That distinction
 * matters: suppressing one column outright is a single step but can wipe out an
 * entire published table, while banding two columns is two steps and barely
 * moves the numbers. Ranking by steps produces answers that are cheap to
 * compute and wrong to act on.
 *
 * For a lattice this size the honest move is simply to evaluate all of it —
 * "I checked every combination" is a stronger claim than any heuristic. The
 * pruned path below exists only for pathological quasi-identifier counts, and
 * says so in its result.
 */
export function searchFrontier(
  dataset: Dataset,
  ladders: ColumnLadder[],
  tables: ReportTable[],
  targets: number[],
): SearchResult {
  const total = latticeSize(ladders);
  const cache = new Map<string, PolicyEvaluation>();

  const evaluate = (policy: Policy): PolicyEvaluation => {
    const key = policyKey(ladders, policy);
    const hit = cache.get(key);
    if (hit) return hit;

    const classes = computeClasses(dataset, ladders, policy);
    const { fidelity } = computeFidelity(dataset, ladders, policy, tables);
    const evaluation: PolicyEvaluation = {
      policy: { ...policy },
      k: classes.k,
      uniqueRows: classes.uniqueRows,
      fidelity,
      distortion: distortionOf(ladders, policy),
    };
    cache.set(key, evaluation);
    return evaluation;
  };

  const sortedTargets = [...targets].sort((a, b) => a - b);
  const frontier: FrontierPoint[] = [];

  if (total <= EXHAUSTIVE_LIMIT) {
    const maxDepth = ladders.reduce((sum, l) => sum + (l.levels.length - 1), 0);
    const all: PolicyEvaluation[] = [];
    for (let depth = 0; depth <= maxDepth; depth++) {
      for (const policy of policiesAtDepth(ladders, depth)) all.push(evaluate(policy));
    }

    for (const target of sortedTargets) {
      const feasible = all.filter((e) => e.k >= target);
      if (feasible.length === 0) continue;
      // Best surviving accuracy; ties go to the less generalized policy.
      const best = feasible.reduce((a, b) =>
        b.fidelity > a.fidelity || (b.fidelity === a.fidelity && b.distortion < a.distortion) ? b : a,
      );
      frontier.push({ ...best, target, description: describePolicy(ladders, best.policy) });
    }

    return {
      frontier: dedupeByPolicy(frontier),
      evaluated: cache.size,
      total,
      pruned: 0,
      exhaustive: true,
      knee: findKnee(dedupeByPolicy(frontier)),
    };
  }

  // Oversized lattice: fall back to minimizing generalization steps, where
  // k-monotonicity licenses pruning every policy above a satisfying one.
  const maxDepth = ladders.reduce((sum, l) => sum + (l.levels.length - 1), 0);
  for (const target of sortedTargets) {
    let best: PolicyEvaluation | null = null;
    for (let depth = 0; depth <= maxDepth; depth++) {
      let found = false;
      for (const policy of policiesAtDepth(ladders, depth)) {
        const evaluation = evaluate(policy);
        if (evaluation.k < target) continue;
        found = true;
        if (!best || evaluation.fidelity > best.fidelity) best = evaluation;
      }
      if (found) break;
    }
    if (best) frontier.push({ ...best, target, description: describePolicy(ladders, best.policy) });
  }

  const deduped = dedupeByPolicy(frontier);
  return {
    frontier: deduped,
    evaluated: cache.size,
    total,
    pruned: Math.max(total - cache.size, 0),
    exhaustive: false,
    knee: findKnee(deduped),
  };
}

/**
 * Several k targets often resolve to the same policy. Showing one dot per
 * target would imply the search found distinct answers it did not.
 */
function dedupeByPolicy(points: FrontierPoint[]): FrontierPoint[] {
  const seen = new Map<string, FrontierPoint>();
  for (const point of points) {
    const key = Object.entries(point.policy)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, level]) => level)
      .join(',');
    const existing = seen.get(key);
    // Keep the highest target a given policy satisfies.
    if (!existing || point.target > existing.target) seen.set(key, point);
  }
  return [...seen.values()].sort((a, b) => a.k - b.k);
}

/**
 * The knee of the privacy/fidelity curve: the point after which buying more
 * privacy starts costing disproportionately more accuracy. Found as the largest
 * drop in fidelity per unit of k gained, taking the point just before it.
 */
export function findKnee(frontier: FrontierPoint[]): FrontierPoint | null {
  if (frontier.length === 0) return null;
  if (frontier.length <= 2) return frontier[frontier.length - 1];

  const sorted = [...frontier].sort((a, b) => a.k - b.k);
  let kneeIndex = sorted.length - 1;
  let worstSlope = -Infinity;

  for (let i = 1; i < sorted.length; i++) {
    const deltaK = sorted[i].k - sorted[i - 1].k;
    if (deltaK <= 0) continue;
    const drop = (sorted[i - 1].fidelity - sorted[i].fidelity) / deltaK;
    if (drop > worstSlope) {
      worstSlope = drop;
      kneeIndex = i - 1;
    }
  }
  return sorted[kneeIndex];
}
