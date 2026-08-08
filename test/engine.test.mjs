// Run with:  node --test test/
//
// The numbers pinned here were measured from the engine itself, not copied from the
// design handoff — see NOTES.md for the one place the handoff turned out to be wrong.

import test from 'node:test';
import assert from 'node:assert/strict';

import { COL, QI_CANDIDATES, SHORT, SUPPRESSED } from '../src/schema.js';
import { generateSurvey, makeRng } from '../src/survey.js';
import {
  computeClasses,
  computeFidelity,
  describePolicy,
  distortionOf,
  findKnee,
  generalizeRow,
  homogeneousClasses,
  ladderFor,
  levelFor,
  policiesAtDepth,
  rawDistribution,
  reconstructedDistribution,
  searchFrontier,
  tvd,
} from '../src/engine.js';
import { attackerSentence, diffWords } from '../src/narrate.js';

const TABLES = [
  { label: 'Sleep by grade', groupBy: COL.grade, breakdownBy: COL.sleep },
  { label: 'Sleep by age', groupBy: COL.age, breakdownBy: COL.sleep },
  { label: 'Sensitive answer by activity', groupBy: COL.activity, breakdownBy: COL.vaped },
];
const DEFAULT_QIS = [COL.grade, COL.activity, COL.homeroom];

const ds = generateSurvey(4207, 820, 0.52);

function tiny(rows) {
  return { columns: Object.keys(rows[0]), rows, name: 'tiny.csv' };
}

// ─── Data generation ─────────────────────────────────────────────────────────

test('the demo file is deterministic for a given seed', () => {
  const a = generateSurvey(4207, 820, 0.52);
  const b = generateSurvey(4207, 820, 0.52);
  assert.deepEqual(a.rows, b.rows);
  assert.notDeepEqual(generateSurvey(99, 820, 0.52).rows, a.rows);
});

test('the demo file is 431 rows of 7 columns', () => {
  assert.equal(ds.rows.length, 431);
  assert.equal(ds.columns.length, 7);
});

test('rng stays inside [0,1)', () => {
  const rng = makeRng(1);
  for (let i = 0; i < 5000; i++) {
    const v = rng();
    assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
  }
});

// ─── Ladders ─────────────────────────────────────────────────────────────────

test('every ladder starts exact and ends suppressed', () => {
  for (const column of QI_CANDIDATES) {
    const l = ladderFor(column);
    assert.equal(l.levels[0].apply('14'), '14', SHORT[column]);
    assert.equal(l.levels[l.levels.length - 1].apply('14'), SUPPRESSED, SHORT[column]);
  }
});

test('every ladder is a real hierarchy: coarsening merges, never splits', () => {
  // The load-bearing invariant. The search only earns the phrase "least
  // destructive fix" if moving one rung up can merge equivalence classes but
  // never split one — that is what makes k monotone as you generalize.
  //
  // This is asserted directly rather than inferred from k on the shipped seed,
  // because the ladder was genuinely broken once and every k-watching check
  // still passed: age widths 2 and 5 put {14,15} together and then apart, and
  // the demo data simply never surfaced it. Widths are powers of two now.
  const values = Array.from({ length: 40 }, (_, i) => String(i));

  for (const column of Object.values(COL)) {
    const ladder = ladderFor(column);
    for (let level = 0; level < ladder.levels.length - 1; level++) {
      const fine = ladder.levels[level];
      const coarse = ladder.levels[level + 1];
      for (let i = 0; i < values.length; i++) {
        for (let j = i + 1; j < values.length; j++) {
          if (fine.apply(values[i]) !== fine.apply(values[j])) continue;
          assert.equal(
            coarse.apply(values[i]),
            coarse.apply(values[j]),
            `${SHORT[column]}: "${values[i]}" and "${values[j]}" share ` +
              `"${fine.apply(values[i])}" at ${fine.label} but split at ${coarse.label}`,
          );
        }
      }
    }
  }
});

test('ladders coarsen the way the design specifies', () => {
  const age = ladderFor(COL.age);
  assert.equal(age.levels[1].apply('15'), '14–15'); // 2-year bands
  assert.equal(age.levels[2].apply('15'), '12–15'); // 4-year bands (see nesting test below)

  const grade = ladderFor(COL.grade);
  assert.equal(grade.levels[1].apply('9'), '9–10');
  assert.equal(grade.levels[1].apply('12'), '11–12');
  assert.equal(grade.levels[2].apply('10'), 'Lower school');
  assert.equal(grade.levels[2].apply('11'), 'Upper school');

  const activity = ladderFor(COL.activity);
  assert.equal(activity.levels[1].apply('Robotics'), 'STEM');
  assert.equal(activity.levels[2].apply('Robotics'), 'Competitive');

  const homeroom = ladderFor(COL.homeroom);
  assert.equal(homeroom.levels[1].apply('B2'), 'B wing');

  // Sleep has no middle rung — exact or gone.
  assert.equal(ladderFor(COL.sleep).levels.length, 2);
});

test('a non-numeric value survives a banding level unchanged', () => {
  assert.equal(ladderFor(COL.age).levels[1].apply('n/a'), 'n/a');
  assert.equal(ladderFor(COL.grade).levels[1].apply('n/a'), 'n/a');
});

test('levelFor clamps a policy index past the end of the ladder', () => {
  const homeroom = ladderFor(COL.homeroom);
  assert.equal(levelFor(homeroom, { [COL.homeroom]: 99 }).apply('B2'), SUPPRESSED);
  assert.equal(levelFor(homeroom, {}).apply('B2'), 'B2');
});

// ─── Equivalence classes ─────────────────────────────────────────────────────

test('computeClasses groups identical rows and reports the smallest group', () => {
  const d = tiny([
    { [COL.grade]: '9', [COL.homeroom]: 'A1' },
    { [COL.grade]: '9', [COL.homeroom]: 'A1' },
    { [COL.grade]: '9', [COL.homeroom]: 'A2' }, // alone
    { [COL.grade]: '12', [COL.homeroom]: 'B1' }, // alone
  ]);
  const ladders = [COL.grade, COL.homeroom].map(ladderFor);
  const r = computeClasses(d, ladders, {});

  assert.equal(r.classes.length, 3);
  assert.equal(r.k, 1);
  assert.equal(r.uniqueRows, 2);
  assert.equal(r.classIndex[0], r.classIndex[1]);
  assert.notEqual(r.classIndex[0], r.classIndex[2]);
});

test('generalizing merges classes and raises k', () => {
  const d = tiny([
    { [COL.homeroom]: 'A1' },
    { [COL.homeroom]: 'A2' },
    { [COL.homeroom]: 'B1' },
    { [COL.homeroom]: 'B2' },
  ]);
  const ladders = [ladderFor(COL.homeroom)];
  assert.equal(computeClasses(d, ladders, {}).k, 1);
  assert.equal(computeClasses(d, ladders, { [COL.homeroom]: 1 }).k, 2); // wings
  assert.equal(computeClasses(d, ladders, { [COL.homeroom]: 2 }).k, 4); // removed
});

test('generalizeRow reads columns in ladder order and blanks a missing one', () => {
  const ladders = [COL.grade, COL.homeroom].map(ladderFor);
  assert.deepEqual(generalizeRow({ [COL.grade]: '9', [COL.homeroom]: 'A1' }, ladders, {}), ['9', 'A1']);
  assert.deepEqual(generalizeRow({ [COL.grade]: '9' }, ladders, {}), ['9', '']);
});

test('the demo opens in the alarming state the narrative needs', () => {
  // Pitfall 3 of the handoff: if the demo opens at a safe k the whole page is pointless.
  const base = computeClasses(ds, DEFAULT_QIS.map(ladderFor), {});
  assert.equal(base.k, 1);
  assert.equal(base.uniqueRows, 38);
});

test('homogeneousClasses ignores singletons and mixed groups', () => {
  const d = tiny([
    { [COL.grade]: '9', [COL.vaped]: 'Yes' },
    { [COL.grade]: '9', [COL.vaped]: 'Yes' }, // unanimous group of 2
    { [COL.grade]: '10', [COL.vaped]: 'Yes' },
    { [COL.grade]: '10', [COL.vaped]: 'No' }, // mixed
    { [COL.grade]: '11', [COL.vaped]: 'No' }, // singleton
  ]);
  const r = computeClasses(d, [ladderFor(COL.grade)], {});
  const hom = homogeneousClasses(d, r.classes, COL.vaped);
  assert.equal(hom.length, 1);
  assert.equal(hom[0].size, 2);
});

// ─── Fidelity ────────────────────────────────────────────────────────────────

test('tvd is 0 for identical distributions and 1 for disjoint ones', () => {
  const p = new Map([['a', 0.5], ['b', 0.5]]);
  assert.equal(tvd(p, new Map(p)), 0);
  assert.equal(tvd(p, new Map([['c', 1]])), 1);
});

test('an untouched file reconstructs its own tables exactly', () => {
  const ladders = DEFAULT_QIS.map(ladderFor);
  const { fidelity, perTable } = computeFidelity(ds, ladders, {}, TABLES);
  assert.equal(fidelity, 1);
  assert.ok(perTable.every((t) => t.tvd === 0 && !t.dead));
});

test('a banded column spreads its weight over the values it covers', () => {
  const d = tiny([
    { [COL.grade]: '9', [COL.sleep]: '8+' },
    { [COL.grade]: '10', [COL.sleep]: '8+' },
  ]);
  const table = { label: 't', groupBy: COL.grade, breakdownBy: COL.sleep };
  const ladders = [ladderFor(COL.grade)];
  const raw = rawDistribution(d, table);
  const rec = reconstructedDistribution(d, ladders, { [COL.grade]: 1 }, table); // 9–10 paired

  // Each row's weight is split evenly across grade 9 and grade 10, so the two cells
  // that were 100/0 and 0/100 both become 50/50 — and the halves cancel out.
  assert.equal(tvd(raw, rec), 0);
  assert.equal(rec.size, 2);
});

test('suppressing a table column kills the table outright', () => {
  const ladders = DEFAULT_QIS.map(ladderFor);
  const gradeGone = { [COL.grade]: ladderFor(COL.grade).levels.length - 1 };
  const { perTable, fidelity } = computeFidelity(ds, ladders, gradeGone, TABLES);

  const sleepByGrade = perTable.find((t) => t.label === 'Sleep by grade');
  assert.equal(sleepByGrade.dead, true);
  assert.equal(sleepByGrade.tvd, 1);
  assert.ok(fidelity < 1);
});

test('fidelity averages the tables rather than taking the worst', () => {
  // WHY this matters: with max(), a second wrecked table would leave fidelity unchanged
  // and the tradeoff curve would flatten into a meaningless plateau.
  const ladders = [COL.grade, COL.activity].map(ladderFor);
  const gradeMax = ladderFor(COL.grade).levels.length - 1;
  const activityMax = ladderFor(COL.activity).levels.length - 1;

  const one = computeFidelity(ds, ladders, { [COL.grade]: gradeMax }, TABLES).fidelity;
  const two = computeFidelity(ds, ladders, { [COL.grade]: gradeMax, [COL.activity]: activityMax }, TABLES).fidelity;

  assert.ok(two < one, `killing a second table must cost something: ${two} vs ${one}`);
  assert.ok(Math.abs(one - (1 - 1 / 3)) < 1e-9); // exactly one of three tables dead
  assert.ok(Math.abs(two - (1 - 2 / 3)) < 1e-9); // exactly two of three dead
});

test('fidelity with no declared tables is vacuously perfect', () => {
  assert.deepEqual(computeFidelity(ds, DEFAULT_QIS.map(ladderFor), {}, []), { fidelity: 1, perTable: [] });
});

// ─── Distortion ──────────────────────────────────────────────────────────────

test('deleting a column costs more than two mild generalizations', () => {
  // WHY the square: under a linear cost the search buys privacy with free deletions.
  const ladders = [COL.grade, COL.activity].map(ladderFor);
  const deleteOne = distortionOf(ladders, { [COL.grade]: 3 }); // grade removed
  const softenBoth = distortionOf(ladders, { [COL.grade]: 1, [COL.activity]: 1 });
  assert.ok(deleteOne > softenBoth, `${deleteOne} should exceed ${softenBoth}`);
});

test('an unchanged policy has no distortion', () => {
  assert.equal(distortionOf(DEFAULT_QIS.map(ladderFor), {}), 0);
  assert.equal(distortionOf([], {}), 0);
});

// ─── The lattice search ──────────────────────────────────────────────────────

test('policiesAtDepth enumerates each policy exactly once across all depths', () => {
  const ladders = DEFAULT_QIS.map(ladderFor);
  const total = ladders.reduce((p, l) => p * l.levels.length, 1);
  const maxDepth = ladders.reduce((s, l) => s + (l.levels.length - 1), 0);

  const seen = new Set();
  let count = 0;
  for (let d = 0; d <= maxDepth; d++) {
    for (const p of policiesAtDepth(ladders, d)) {
      count++;
      seen.add(ladders.map((l) => p[l.column] || 0).join(','));
    }
  }
  assert.equal(count, total);
  assert.equal(seen.size, total);
});

test('the frontier never recommends a policy that destroys a declared table', () => {
  // The single most important guarantee in the engine.
  for (let mask = 1; mask < 1 << QI_CANDIDATES.length; mask++) {
    const qis = QI_CANDIDATES.filter((_, i) => mask & (1 << i));
    const { frontier } = searchFrontier(ds, qis.map(ladderFor), TABLES);
    for (const p of frontier) {
      assert.equal(p.dead, 0, `dead table recommended for ${qis.map((c) => SHORT[c]).join('+')}`);
    }
  }
});

test('the frontier is monotonically decreasing in fidelity for every attacker model', () => {
  // Pitfall 2 territory: a non-monotonic curve makes the tradeoff section unreadable.
  for (let mask = 1; mask < 1 << QI_CANDIDATES.length; mask++) {
    const qis = QI_CANDIDATES.filter((_, i) => mask & (1 << i));
    const { frontier } = searchFrontier(ds, qis.map(ladderFor), TABLES);
    for (let i = 1; i < frontier.length; i++) {
      assert.ok(frontier[i].k > frontier[i - 1].k, 'k must strictly increase');
      assert.ok(
        frontier[i].fidelity <= frontier[i - 1].fidelity + 1e-12,
        `fidelity rose at k=${frontier[i].k} for ${qis.map((c) => SHORT[c]).join('+')}`,
      );
    }
  }
});

test('every frontier point actually reaches the group size it claims', () => {
  const ladders = DEFAULT_QIS.map(ladderFor);
  const { frontier } = searchFrontier(ds, ladders, TABLES);
  for (const p of frontier) {
    assert.equal(computeClasses(ds, ladders, p.policy).k, p.k);
    assert.ok(p.k >= p.target);
  }
});

test('the search reports honest coverage of the lattice', () => {
  const ladders = DEFAULT_QIS.map(ladderFor);
  const s = searchFrontier(ds, ladders, TABLES);
  assert.equal(s.total, 4 * 4 * 3); // grade 4 levels, activity 4, homeroom 3
  assert.equal(s.evaluated, s.total); // exhaustive, not sampled
});

test('the recommended fix for the default model is the one the design describes', () => {
  const ladders = DEFAULT_QIS.map(ladderFor);
  const { knee } = searchFrontier(ds, ladders, TABLES);
  assert.equal(knee.k, 6);
  assert.equal(knee.description, 'Grade → paired grades · Homeroom → removed');
  assert.ok(knee.fidelity > 0.97);
});

test('an impossible table set produces the empty frontier, not a bad recommendation', () => {
  // Reachable in principle even though no quasi-identifier subset triggers it on the
  // demo file: declare a table on a column the attacker also recognizes, and every
  // route to a larger group kills it.
  const d = tiny([
    { [COL.homeroom]: 'A1' },
    { [COL.homeroom]: 'A2' },
    { [COL.homeroom]: 'B1' },
    { [COL.homeroom]: 'B2' },
  ]);
  const ladders = [ladderFor(COL.homeroom)];
  const impossible = [{ label: 'Anything by homeroom', groupBy: COL.homeroom, breakdownBy: null }];
  const s = searchFrontier(d, ladders, impossible, [3]);

  // Reaching k>=3 needs the wing level or removal; both leave the declared table
  // unpublishable at the granularity it was declared... except wings keep it alive,
  // so only removal is dead. Confirm the survivor is never a dead policy.
  assert.ok(s.frontier.every((p) => p.dead === 0));

  const s2 = searchFrontier(d, ladders, impossible, [4]); // only removal reaches k=4
  assert.equal(s2.frontier.length, 0);
  assert.equal(findKnee(s2.frontier), null);
});

test('findKnee returns the point before the steepest fidelity drop', () => {
  const frontier = [
    { k: 2, fidelity: 0.99 },
    { k: 4, fidelity: 0.97 }, // -0.010 per k
    { k: 8, fidelity: 0.60 }, // -0.0925 per k  <- steepest, so the knee is the point before
    { k: 16, fidelity: 0.55 },
  ];
  assert.equal(findKnee(frontier).k, 4);
  assert.equal(findKnee([]), null);
  assert.equal(findKnee([{ k: 5, fidelity: 1 }]).k, 5);
});

test('describePolicy names only the columns it actually touched', () => {
  const ladders = DEFAULT_QIS.map(ladderFor);
  assert.equal(describePolicy(ladders, {}), 'the file unchanged');
  assert.equal(describePolicy(ladders, { [COL.grade]: 0 }), 'the file unchanged');
  assert.equal(describePolicy(ladders, { [COL.grade]: 1 }), 'Grade → paired grades');
});

// ─── The sentence ────────────────────────────────────────────────────────────

function sentenceFor(rows, qis, policy = {}, rowIndex = 0) {
  const d = tiny(rows);
  const ladders = qis.map(ladderFor);
  return attackerSentence(d, ladders, policy, computeClasses(d, ladders, policy), rowIndex);
}

test('a row of one is named as the only one', () => {
  const s = sentenceFor(
    [{ [COL.grade]: '9', [COL.activity]: 'Chess' }, { [COL.grade]: '12', [COL.activity]: 'Band' }],
    [COL.grade, COL.activity],
  );
  assert.equal(s, 'This is the only 9th-grader in Chess in the data.');
});

test('a row in a crowd is counted, and reads in the plural', () => {
  const s = sentenceFor(
    [{ [COL.grade]: '9', [COL.activity]: 'Chess' }, { [COL.grade]: '9', [COL.activity]: 'Chess' }],
    [COL.grade, COL.activity],
  );
  assert.equal(s, 'This is one of 2 students in grade 9 in Chess.');
});

test('a generalized activity reads as its category, not its raw name', () => {
  const rows = [{ [COL.activity]: 'Chess' }, { [COL.activity]: 'Robotics' }];
  assert.equal(sentenceFor(rows, [COL.activity], { [COL.activity]: 1 }), 'This is one of 2 students in a STEM activity.');
  assert.equal(sentenceFor(rows, [COL.activity], { [COL.activity]: 2 }), 'This is one of 2 students in a competitive activity.');
});

test('fragments order age → grade → activity → homeroom → sleep regardless of input order', () => {
  const s = sentenceFor(
    [{ [COL.homeroom]: 'B2', [COL.age]: '14', [COL.grade]: '9' }],
    [COL.homeroom, COL.age, COL.grade],
  );
  assert.equal(s, 'This is the only 14-year-old 9th-grader in homeroom B2 in the data.');
});

test('a suppressed column drops out of the sentence entirely', () => {
  const rows = [{ [COL.grade]: '9', [COL.homeroom]: 'A1' }, { [COL.grade]: '9', [COL.homeroom]: 'A2' }];
  const homeroomGone = { [COL.homeroom]: ladderFor(COL.homeroom).levels.length - 1 };
  const s = sentenceFor(rows, [COL.grade, COL.homeroom], homeroomGone);
  assert.ok(!s.includes('homeroom'), s);
  assert.equal(s, 'This is one of 2 students in grade 9.');
});

test('with everything suppressed the sentence says so rather than describing nothing', () => {
  const rows = [{ [COL.homeroom]: 'A1' }, { [COL.homeroom]: 'A2' }];
  const gone = { [COL.homeroom]: ladderFor(COL.homeroom).levels.length - 1 };
  assert.equal(
    sentenceFor(rows, [COL.homeroom], gone),
    'This is one of 2 responses with nothing left to tell them apart.',
  );
});

test('a generalized grade reads as a range', () => {
  const rows = [{ [COL.grade]: '9' }, { [COL.grade]: '10' }];
  assert.equal(sentenceFor(rows, [COL.grade], { [COL.grade]: 1 }), 'This is one of 2 students in grades 9–10.');
  // "in the lower school" attaches after the noun, so the generic plural noun stays.
  assert.equal(sentenceFor(rows, [COL.grade], { [COL.grade]: 2 }), 'This is one of 2 students in the lower school.');
});

test('the recommended fix demonstrably changes what the attacker can say', () => {
  const ladders = DEFAULT_QIS.map(ladderFor);
  const base = computeClasses(ds, ladders, {});
  const rowIndex = base.classes.find((c) => c.size === 1).rowIndices[0];
  const { knee } = searchFrontier(ds, ladders, TABLES);

  const before = attackerSentence(ds, ladders, {}, base, rowIndex);
  const after = attackerSentence(ds, ladders, knee.policy, computeClasses(ds, ladders, knee.policy), rowIndex);

  assert.ok(before.startsWith('This is the only '), before);
  assert.ok(after.startsWith('This is one of '), after);
});

// ─── The diff ────────────────────────────────────────────────────────────────

test('diffWords keeps the common run and marks the rest', () => {
  const d = diffWords(['the', 'only', 'student'], ['one', 'of', 'six', 'students']);
  assert.deepEqual(d.filter((t) => t.op === 'same').map((t) => t.text), []);
  assert.deepEqual(d.filter((t) => t.op === 'del').map((t) => t.text), ['the', 'only', 'student']);
  assert.deepEqual(d.filter((t) => t.op === 'add').map((t) => t.text), ['one', 'of', 'six', 'students']);
});

test('deletions replay the old sentence and insertions replay the new one', () => {
  const a = 'This is the only 9th-grader in the data.'.split(' ');
  const b = 'This is one of 6 students in grade 9.'.split(' ');
  const d = diffWords(a, b);
  assert.deepEqual(d.filter((t) => t.op !== 'add').map((t) => t.text), a);
  assert.deepEqual(d.filter((t) => t.op !== 'del').map((t) => t.text), b);
});

test('an unchanged sentence produces no edits', () => {
  const words = ['a', 'b', 'c'];
  assert.ok(diffWords(words, [...words]).every((t) => t.op === 'same'));
});
