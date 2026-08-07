/**
 * Engine verification + seed search.
 *
 * Run:  node --experimental-strip-types scripts/verify.ts
 *
 * Two jobs:
 *   1. Assert the hand-written 12-row sample behaves exactly as claimed, so the
 *      "count it yourself" demo beat is true.
 *   2. Search seeds for a survey dataset that demonstrates the failure clearly,
 *      and print the winner so it can be committed.
 */

import { autoLadder, computeClasses, homogeneousClasses, sensitivitySweep } from '../src/lib/anonymize';
import { computeRisk, formatRisk } from '../src/lib/risk';
import { attackerSentence, advisorNote } from '../src/lib/sentence';
import { computeFidelity } from '../src/lib/tvd';
import type { ReportTable } from '../src/lib/tvd';
import { searchFrontier, latticeSize } from '../src/lib/search';
import {
  ACTIVITY_CATEGORY,
  COL,
  generateSurvey,
  generateRoster,
  handCheckSample,
} from '../src/lib/generate';
import type { ColumnLadder, Dataset, Policy } from '../src/lib/types';

let failures = 0;
function check(label: string, condition: boolean, detail = '') {
  const mark = condition ? 'PASS' : 'FAIL';
  if (!condition) failures++;
  console.log(`  [${mark}] ${label}${detail ? ` — ${detail}` : ''}`);
}

/**
 * The DECLARED attacker model for the demo: what a classmate plausibly knows
 * on sight. Grade and main activity are public facts about a person at school.
 *
 * Age is deliberately NOT in the default model. Adding it makes almost every
 * respondent unique — which is exactly the point the sensitivity panel exists
 * to make, and it is a far better beat as a discovery than as a default.
 */
function laddersFor(dataset: Dataset): ColumnLadder[] {
  return [
    autoLadder(dataset, COL.grade),
    autoLadder(dataset, COL.activity, ACTIVITY_CATEGORY),
  ];
}

const EXACT_POLICY: Policy = { [COL.grade]: 0, [COL.activity]: 0 };

const TABLES: ReportTable[] = [
  { id: 'a', label: 'Respondents by grade', groupBy: COL.grade },
  {
    id: 'b',
    label: 'Sleeps under 6h, by activity',
    groupBy: COL.activity,
    breakdownBy: COL.sleep,
  },
];

const PHRASING = {
  [COL.age]: { describe: (v: string) => `${v}-year-old`, order: 0 },
  [COL.grade]: { describe: (v: string) => `in grade ${v}`, order: 1 },
  [COL.activity]: {
    describe: (v: string) => (v.startsWith('a ') || v.startsWith('an ') ? `in ${v}` : `in ${v}`),
    order: 2,
  },
};

// ---------------------------------------------------------------------------
console.log('\n1. Hand-written 12-row sample');
// ---------------------------------------------------------------------------
{
  const sample = handCheckSample();
  const ladders = laddersFor(sample);
  const exact: Policy = EXACT_POLICY;
  const result = computeClasses(sample, ladders, exact);

  check('12 rows', sample.rows.length === 12, `got ${sample.rows.length}`);
  check('k = 1 at exact values', result.k === 1, `k=${result.k}`);
  check('exactly 3 unique rows', result.uniqueRows === 3, `got ${result.uniqueRows}`);

  const homogeneous = homogeneousClasses(sample, result, COL.vaped);
  check(
    'at least one homogeneous group',
    homogeneous.length >= 1,
    `${homogeneous.length} group(s), largest size ${Math.max(0, ...homogeneous.map((c) => c.size))}`,
  );

  const uniqueRow = result.classes.find((c) => c.size === 1)!.rowIndices[0];
  const before = attackerSentence(sample, ladders, exact, result, uniqueRow, PHRASING, 'student');
  check('unique row produces an "only" sentence', before.isUnique, before.text);

  // Coarsen: 2-wide age bands + activity rollup.
  const fixed: Policy = { [COL.grade]: 0, [COL.activity]: 1 };
  const afterResult = computeClasses(sample, ladders, fixed);
  const after = attackerSentence(sample, ladders, fixed, afterResult, uniqueRow, PHRASING, 'student');
  check('the same row after a fix is no longer unique', !after.isUnique || afterResult.k > 1, after.text);
  console.log(`        before: ${before.text}`);
  console.log(`        after:  ${after.text}`);
}

// ---------------------------------------------------------------------------
console.log('\n2. Monotonicity of k (the pruning claim)');
// ---------------------------------------------------------------------------
{
  const survey = generateSurvey(1234);
  const ladders = laddersFor(survey);
  let violations = 0;
  let comparisons = 0;

  // Coarsening any single column must never decrease k.
  for (const ladder of ladders) {
    for (let level = 0; level < ladder.levels.length - 1; level++) {
      const lower: Policy = {};
      ladders.forEach((l) => (lower[l.column] = 0));
      lower[ladder.column] = level;
      const higher: Policy = { ...lower, [ladder.column]: level + 1 };
      const kLow = computeClasses(survey, ladders, lower).k;
      const kHigh = computeClasses(survey, ladders, higher).k;
      comparisons++;
      if (kHigh < kLow) violations++;
    }
  }
  check('k never decreases when coarsening', violations === 0, `${comparisons} comparisons, ${violations} violations`);
}

// ---------------------------------------------------------------------------
console.log('\n3. Seed search for the shipped demo');
// ---------------------------------------------------------------------------
{
  const targets = [2, 3, 5, 8, 11, 14, 20];
  let winner: { seed: number; report: string } | null = null;

  for (let seed = 1; seed <= 4000 && !winner; seed++) {
    const survey = generateSurvey(seed);
    if (survey.rows.length < 70 || survey.rows.length > 100) continue;

    const ladders = laddersFor(survey);
    const exact: Policy = EXACT_POLICY;
    const result = computeClasses(survey, ladders, exact);

    // The reveal needs a small, countable number of unique rows: enough to be
    // alarming, few enough to point at individually on camera.
    if (result.uniqueRows < 2 || result.uniqueRows > 8) continue;

    const homogeneous = homogeneousClasses(survey, result, COL.vaped);
    if (homogeneous.length < 1) continue;

    const search = searchFrontier(survey, ladders, TABLES, targets);
    if (!search.knee || search.knee.k < 5) continue;
    if (search.knee.fidelity < 0.85) continue;

    const risk = computeRisk(survey, ladders, exact, result, generateRoster(seed));
    winner = {
      seed,
      report: [
        `seed ${seed}`,
        `${survey.rows.length} respondents`,
        `k=${result.k}, ${result.uniqueRows} unique rows`,
        `${homogeneous.length} homogeneous group(s)`,
        `lattice ${search.total}, evaluated ${search.evaluated}, pruned ${search.pruned}`,
        `knee k=${search.knee.k} fidelity ${(search.knee.fidelity * 100).toFixed(1)}%`,
        `prosecutor ${formatRisk(risk.prosecutor)}, journalist ${risk.journalist ? formatRisk(risk.journalist) : 'n/a'}`,
      ].join('\n        '),
    };
  }

  check('found a seed meeting the acceptance predicate', winner !== null);
  if (winner) {
    console.log(`        ${winner.report}`);

    const survey = generateSurvey(winner.seed);
    const ladders = laddersFor(survey);
    const exact: Policy = EXACT_POLICY;
    const result = computeClasses(survey, ladders, exact);
    const search = searchFrontier(survey, ladders, TABLES, [2, 3, 5, 8, 11, 14, 20]);
    const risk = computeRisk(survey, ladders, exact, result, generateRoster(winner.seed));
    const fid = computeFidelity(survey, ladders, search.knee!.policy, TABLES);

    console.log('\n        frontier:');
    for (const point of search.frontier) {
      console.log(
        `          k≥${String(point.target).padStart(2)} → k=${String(point.k).padStart(2)}  fidelity ${(point.fidelity * 100).toFixed(1)}%  ${point.description}`,
      );
    }

    console.log('\n        sensitivity (declared model = grade, activity):');
    for (const entry of sensitivitySweep(survey, ladders, exact, [COL.age, COL.homeroom])) {
      console.log(`          ${entry.change} ${entry.column} → k=${entry.k}, ${entry.uniqueRows} unique`);
    }

    console.log('\n        advisor note at the knee:');
    console.log(
      '          ' +
        advisorNote({
          k: search.knee!.k,
          uniqueRows: search.knee!.uniqueRows,
          prosecutor: formatRisk(1 / search.knee!.k),
          journalist: risk.journalist ? formatRisk(risk.journalist) : null,
          journalistIsUpperBound: risk.journalistIsUpperBound,
          fidelityPercent: `${(fid.fidelity * 100).toFixed(1)}%`,
          homogeneousCount: homogeneousClasses(
            survey,
            computeClasses(survey, ladders, search.knee!.policy),
            COL.vaped,
          ).length,
          quasiIdentifiers: ['grade', 'activity'],
          rowCount: survey.rows.length,
        }).replace(/\. /g, '.\n          '),
    );

    console.log(`\n        lattice size: ${latticeSize(ladders)}`);
  }
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
