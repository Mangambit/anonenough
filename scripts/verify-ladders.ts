/**
 * Ladder nesting proof.
 *
 * The remediation search is only correct if the generalization ladders form a
 * real hierarchy: moving one rung up must MERGE equivalence classes and can
 * never split them. That is what makes k monotone, and k-monotonicity is the
 * entire justification for the search's claim to have found the least
 * destructive fix.
 *
 * An earlier version of this project asserted that property in prose, tested it
 * by watching k on a single dataset, and passed — while the ladder was actually
 * broken. Widths 2 and 5 are not nested: 4 and 5 share the band "4–5" at width
 * 2, then split into "0–4" and "5–9" at width 5. The demo data simply contained
 * no violating pair.
 *
 * So this file tests the property itself, exhaustively over a value range,
 * independent of any dataset.
 *
 * Run:  npx tsx scripts/verify-ladders.ts
 */

import { autoLadder } from '../src/lib/anonymize';
import { ACTIVITY_CATEGORY, COL, generateSurvey, handCheckSample } from '../src/lib/generate';
import type { Dataset } from '../src/lib/types';

let failures = 0;
function check(label: string, ok: boolean, detail = '') {
  if (!ok) failures++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? ` — ${detail}` : ''}`);
}

/**
 * The nesting property, stated exactly:
 *   for all values a, b and every consecutive pair of levels (i, i+1),
 *   if level_i(a) === level_i(b) then level_{i+1}(a) === level_{i+1}(b).
 */
function assertNested(label: string, dataset: Dataset, column: string, values: string[]) {
  const ladder = autoLadder(
    dataset,
    column,
    column === COL.activity ? ACTIVITY_CATEGORY : undefined,
  );

  let violations: string[] = [];
  let comparisons = 0;

  for (let level = 0; level < ladder.levels.length - 1; level++) {
    const fine = ladder.levels[level];
    const coarse = ladder.levels[level + 1];
    for (let i = 0; i < values.length; i++) {
      for (let j = i + 1; j < values.length; j++) {
        comparisons++;
        const sameFine = fine.apply(values[i]) === fine.apply(values[j]);
        const sameCoarse = coarse.apply(values[i]) === coarse.apply(values[j]);
        if (sameFine && !sameCoarse) {
          violations.push(
            `"${values[i]}" & "${values[j]}" together at ${fine.label} ` +
              `("${fine.apply(values[i])}") but split at ${coarse.label} ` +
              `("${coarse.apply(values[i])}" vs "${coarse.apply(values[j])}")`,
          );
        }
      }
    }
  }

  check(
    `${label} ladder is nested`,
    violations.length === 0,
    violations.length === 0
      ? `${ladder.levels.length} levels, ${comparisons} pairs checked`
      : `${violations.length} violation(s): ${violations[0]}`,
  );
}

console.log('\nLadder nesting (the property the search depends on)');

const survey = generateSurvey(1);

// Numeric ladders, over a range far wider than any real school data, so the
// test cannot pass by luck the way the old one did.
const wideRange = Array.from({ length: 120 }, (_, i) => String(i));
assertNested('age (numeric)', survey, COL.age, wideRange);
assertNested('grade (numeric)', survey, COL.grade, wideRange);

// Non-integer and negative values: bands must still nest even where the label
// notation is imperfect (documented as a limitation in the README).
const awkward = ['0', '0.5', '1.5', '2.25', '-1', '-2.5', '7.999', '8'];
assertNested('age with fractional/negative values', survey, COL.age, awkward);

// Categorical ladder: exact -> grouped -> suppressed.
assertNested('activity (categorical rollup)', survey, COL.activity, [
  ...new Set(survey.rows.map((r) => r[COL.activity])),
]);

// Unparsable cells must not sail through generalization unchanged.
{
  const ladder = autoLadder(survey, COL.age);
  const banded = ladder.levels[1];
  check(
    'unparsable values are bucketed, not passed through',
    banded.apply('not-a-number') !== 'not-a-number',
    `"not-a-number" -> "${banded.apply('not-a-number')}"`,
  );
  check('blank stays blank', banded.apply('') === '', `"" -> "${banded.apply('')}"`);
}

// Malformed policies must fail loudly rather than silently analysing something else.
{
  const sample = handCheckSample();
  const ladder = autoLadder(sample, COL.grade);
  let threw = false;
  try {
    ladder.levels[0].apply('11');
    const { computeClasses } = await import('../src/lib/anonymize');
    computeClasses(sample, [ladder], { [COL.grade]: 99 });
  } catch (error) {
    threw = error instanceof RangeError;
  }
  check('out-of-range policy level throws', threw);
}

console.log(`\n${failures === 0 ? 'LADDERS VERIFIED' : `${failures} FAILURE(S)`}\n`);
process.exit(failures === 0 ? 0 : 1);
