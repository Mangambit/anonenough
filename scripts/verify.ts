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

import {
  autoLadder,
  computeClasses,
  homogeneousClasses,
  sensitivitySweep,
  SUPPRESSED,
} from '../src/lib/anonymize';
import { computeDiversity } from '../src/lib/diversity';
import type { DiversityResult } from '../src/lib/diversity';
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

    const risk = computeRisk(ladders, exact, result, generateRoster(seed));
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
    const risk = computeRisk(ladders, exact, result, generateRoster(winner.seed));
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

// ---------------------------------------------------------------------------
console.log('\n4. l-diversity (k protects identity, not answers)');
// ---------------------------------------------------------------------------
{
  /**
   * Score a distribution directly. Every row shares one quasi-identifier value,
   * so computeClasses returns exactly one equivalence class holding exactly
   * these answers — which lets a check state a distribution and read back its l.
   */
  const ANSWER = 'answer';
  const scoreOneClass = (answers: string[]): DiversityResult => {
    const dataset: Dataset = {
      columns: ['group', ANSWER],
      rows: answers.map((answer) => ({ group: 'G', [ANSWER]: answer })),
      label: 'Hand-constructed equivalence class',
    };
    const ladders = [autoLadder(dataset, 'group')];
    return computeDiversity(dataset, computeClasses(dataset, ladders, { group: 0 }), ANSWER);
  };
  const repeat = (value: string, times: number) =>
    Array.from({ length: times }, () => value);

  // (a) The hand-written sample's known homogeneous group.
  const sample = handCheckSample();
  const ladders = laddersFor(sample);
  const result = computeClasses(sample, ladders, EXACT_POLICY);
  const diversity = computeDiversity(sample, result, COL.vaped);

  // Rows 5-7 are the {grade 10, Soccer} block, written by hand to answer the
  // sensitive question identically. k says 3 people; l says the 3 hide nothing.
  const homogeneousGroup = diversity.perClass[result.classIndex[5]];
  check(
    'the hand-written all-"Yes" group holds 3 rows',
    homogeneousGroup.size === 3,
    `size ${homogeneousGroup.size}, key ${homogeneousGroup.key.join(' / ')}`,
  );
  check(
    'that group has distinct-l = 1',
    homogeneousGroup.distinctL === 1,
    `distinct-l ${homogeneousGroup.distinctL}`,
  );
  check(
    'that group has entropy-l = 1',
    homogeneousGroup.entropyL === 1,
    `entropy-l ${homogeneousGroup.entropyL.toFixed(4)}`,
  );

  // The two modules have to agree about the extreme case, or one of them is
  // wrong: anything homogeneousClasses() flags must score 1 on both measures.
  const flagged = homogeneousClasses(sample, result, COL.vaped);
  const agree = flagged.every((cls) => {
    const scored = diversity.perClass[result.classes.indexOf(cls)];
    return scored.distinctL === 1 && scored.entropyL === 1;
  });
  check(
    'every group homogeneousClasses() flags scores l = 1 on both measures',
    flagged.length >= 1 && agree,
    `${flagged.length} flagged group(s)`,
  );
  check(
    'so the sample as a whole is only 1-diverse',
    diversity.distinctL === 1 && diversity.entropyL === 1,
    `distinct-l ${diversity.distinctL}, entropy-l ${diversity.entropyL.toFixed(4)}`,
  );
  check(
    'worstClass points at the largest homogeneous group, not a singleton',
    diversity.worstClass !== null && diversity.worstClass.index === result.classIndex[5],
    diversity.worstClass
      ? `size ${diversity.worstClass.size}, ${diversity.worstClass.counts.map((c) => `${c.value || '(blank)'}×${c.count}`).join(' ')}`
      : 'none',
  );

  // (b) entropy-l ≤ distinct-l, across the whole policy lattice and three
  //     different sensitive columns. Entropy can only ever be the stricter one.
  const survey = generateSurvey(1234);
  const surveyLadders = laddersFor(survey);
  const sensitiveColumns = [COL.vaped, COL.safe, COL.sleep];
  const policyCount = surveyLadders[0].levels.length * surveyLadders[1].levels.length;
  let comparisons = 0;
  let violations = 0;
  let strictlyStricter = 0;

  for (let grade = 0; grade < surveyLadders[0].levels.length; grade++) {
    for (let activity = 0; activity < surveyLadders[1].levels.length; activity++) {
      const policy: Policy = { [COL.grade]: grade, [COL.activity]: activity };
      const classes = computeClasses(survey, surveyLadders, policy);
      for (const column of sensitiveColumns) {
        const scored = computeDiversity(survey, classes, column);
        comparisons++;
        if (scored.entropyL > scored.distinctL) violations++;
        for (const cls of scored.perClass) {
          comparisons++;
          // 1 ≤ entropy-l ≤ distinct-l ≤ class size, for every class with rows.
          if (cls.entropyL < 1) violations++;
          if (cls.entropyL > cls.distinctL) violations++;
          if (cls.distinctL > cls.size) violations++;
          if (cls.entropyL < cls.distinctL) strictlyStricter++;
        }
      }
    }
  }
  check(
    'entropy-l ≤ distinct-l ≤ class size, everywhere',
    violations === 0,
    `${comparisons} comparisons over ${policyCount} policies × ${sensitiveColumns.length} sensitive columns, ${violations} violations`,
  );
  check(
    'and entropy-l is strictly smaller somewhere, so it is not a restatement',
    strictlyStricter > 0,
    `${strictlyStricter} class(es) where entropy-l < distinct-l`,
  );

  // (c) The 13/1 split — the case distinct-l gets wrong.
  const skewed = scoreOneClass([...repeat('No', 13), 'Yes']);
  check(
    '13-No / 1-Yes class has distinct-l = 2',
    skewed.distinctL === 2,
    `distinct-l ${skewed.distinctL}`,
  );
  check(
    'but entropy-l < 1.5 — barely above a homogeneous class',
    skewed.entropyL < 1.5,
    `entropy-l ${skewed.entropyL.toFixed(4)}, best guess right ${(skewed.perClass[0].counts[0].share * 100).toFixed(0)}% of the time`,
  );

  // The contrast that makes the point: the same two answers, evenly split,
  // really are 2-diverse. Distinct-l cannot tell these two classes apart.
  const balanced = scoreOneClass([...repeat('No', 7), ...repeat('Yes', 7)]);
  check(
    '7-No / 7-Yes class has distinct-l = 2 AND entropy-l = 2',
    balanced.distinctL === 2 && Math.abs(balanced.entropyL - 2) < 1e-12,
    `entropy-l ${balanced.entropyL.toFixed(4)}`,
  );

  // (d) Edge cases the module promises to handle exactly.
  const withBlank = scoreOneClass([...repeat('No', 13), '   ']);
  check(
    'a blank sensitive answer is its own category, not dropped',
    withBlank.distinctL === 2 &&
      withBlank.perClass[0].counts.some((c) => c.value === '' && c.count === 1),
    `distinct-l ${withBlank.distinctL}, entropy-l ${withBlank.entropyL.toFixed(4)}`,
  );

  const singleton = scoreOneClass(['Yes']);
  check(
    'a single-row class scores 1 on both measures and is still measured',
    singleton.distinctL === 1 && singleton.entropyL === 1 && singleton.measuredClasses === 1,
    'a class of one discloses the answer with certainty',
  );

  const allSuppressed = scoreOneClass(repeat(SUPPRESSED, 3));
  check(
    'a class whose sensitive column was suppressed is flagged, not scored',
    allSuppressed.suppressedClasses === 1 &&
      allSuppressed.measuredClasses === 0 &&
      allSuppressed.worstClass === null &&
      allSuppressed.distinctL === 0,
    'nothing was published, so there is nothing to disclose',
  );

  const partlySuppressed = scoreOneClass([...repeat(SUPPRESSED, 2), 'Yes']);
  check(
    'a partially suppressed class is measured normally',
    partlySuppressed.measuredClasses === 1 && partlySuppressed.distinctL === 2,
    `distinct-l ${partlySuppressed.distinctL}, entropy-l ${partlySuppressed.entropyL.toFixed(4)}`,
  );

  const nothing = scoreOneClass([]);
  check(
    'an empty dataset yields no classes and no false alarm',
    nothing.perClass.length === 0 &&
      nothing.worstClass === null &&
      nothing.distinctL === 0 &&
      nothing.entropyL === 0,
    'l = 0 means "nothing measurable", not "maximally disclosive"',
  );

  // (e) The whole reason this module exists, on real demo data: the remediation
  //     the search recommends raises k, and the answers stay exposed anyway.
  //     Deliberately asserted as a property rather than against a pinned number,
  //     because the demo seed and the ladders are still moving.
  const demo = generateSurvey(1);
  const demoLadders = laddersFor(demo);
  const demoSearch = searchFrontier(demo, demoLadders, TABLES, [2, 3, 5, 8, 11, 14, 20]);
  const knee = demoSearch.knee;
  if (knee) {
    const atKnee = computeClasses(demo, demoLadders, knee.policy);
    const demoDiversity = computeDiversity(demo, atKnee, COL.vaped);
    check(
      'the recommended fix raises k but still leaves a class that leaks the answer',
      demoDiversity.entropyL < 2,
      `seed 1 at the knee: k=${atKnee.k}, distinct-l ${demoDiversity.distinctL}, entropy-l ${demoDiversity.entropyL.toFixed(4)}`,
    );
    const worst = demoDiversity.worstClass;
    if (worst) {
      console.log(
        `        worst class at the knee: ${worst.size} people, ` +
          `${worst.counts.map((c) => `${c.value || '(blank)'}×${c.count}`).join(' ')} ` +
          `(${worst.key.join(' / ')})`,
      );
    }
  }
  console.log(
    `        13/1 entropy-l ${skewed.entropyL.toFixed(3)} vs 7/7 entropy-l ${balanced.entropyL.toFixed(3)} — distinct-l calls both 2`,
  );
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
