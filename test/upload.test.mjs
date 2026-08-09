// Run with:  node --test test/
//
// The upload path: CSV parsing and schema inference. The inference tests assert
// the same nesting invariant the demo ladders are held to — an uploaded numeric
// column must never get a ladder where coarsening can SPLIT a group.

import test from 'node:test';
import assert from 'node:assert/strict';

import { parseCsv, sniffDelimiter } from '../src/csv.js';
import { autoLadder, columnStats, inferDescriptor, isDirectIdentifier, ROW_CAP } from '../src/infer.js';
import { SUPPRESSED } from '../src/schema.js';
import { computeClasses, searchFrontier } from '../src/engine.js';

// ─── Parser ──────────────────────────────────────────────────────────────────

test('parses plain CSV with CRLF line endings', () => {
  const { headers, rows } = parseCsv('a,b\r\n1,2\r\n3,4\r\n');
  assert.deepEqual(headers, ['a', 'b']);
  assert.deepEqual(rows, [['1', '2'], ['3', '4']]);
});

test('handles quoted fields with embedded delimiters, quotes and newlines', () => {
  const text = 'name,notes\n"Doe, Jane","said ""hi""\non two lines"\n';
  const { rows } = parseCsv(text);
  assert.equal(rows[0][0], 'Doe, Jane');
  assert.equal(rows[0][1], 'said "hi"\non two lines');
});

test('sniffs semicolon and tab delimiters', () => {
  assert.equal(sniffDelimiter('a;b;c\n1;2;3'), ';');
  assert.equal(sniffDelimiter('a\tb\tc\n1\t2\t3'), '\t');
  assert.equal(sniffDelimiter('"a;b",c\n1,2'), ','); // the ; is inside quotes
  const { headers } = parseCsv('x;y\n1;2');
  assert.deepEqual(headers, ['x', 'y']);
});

test('quoted whitespace is data; unquoted whitespace is noise', () => {
  // The dangerous direction: trimming a quoted field merges two distinct
  // values into one equivalence class and reports a HIGHER k than the file
  // has — the audit would call the file safer than it is.
  const { rows } = parseCsv('a,b\n"  A  ", A \n"A","A"\n');
  assert.equal(rows[0][0], '  A  ', 'quoted padding must survive');
  assert.equal(rows[0][1], 'A', 'unquoted padding is formatting, not data');
  assert.notEqual(rows[0][0], rows[1][0], 'distinct values were silently merged');
});

test('skips blank lines instead of minting empty rows', () => {
  const { rows } = parseCsv('a,b\n1,2\n\n3,4\n\n');
  assert.equal(rows.length, 2);
});

test('rejects ragged rows and unclosed quotes loudly', () => {
  assert.throws(() => parseCsv('a,b\n1,2,3'), /Row 2 has 3 fields/);
  assert.throws(() => parseCsv('a,b\n"open,2'), /Unclosed quote/);
});

test('deduplicates repeated headers and names blank ones', () => {
  const { headers } = parseCsv('x,,x\n1,2,3');
  assert.deepEqual(headers, ['x', 'Column 2', 'x (2)']);
});

// ─── Column statistics ───────────────────────────────────────────────────────

test('columnStats detects numeric columns and ignores blanks', () => {
  const s = columnStats(['14', '15', '', '16', '17']);
  assert.equal(s.isNumeric, true);
  assert.equal(s.isInteger, true);
  assert.equal(s.blanks, 1);
  assert.equal(s.min, 14);
  assert.equal(s.max, 17);
});

test('a mostly-text column is not numeric', () => {
  const s = columnStats(['Band', 'Choir', '12', 'Band']);
  assert.equal(s.isNumeric, false);
});

test('direct identifiers: high-cardinality named columns are caught', () => {
  const names = Array.from({ length: 40 }, (_, i) => `Person ${i}`);
  assert.equal(isDirectIdentifier('Full name', columnStats(names)), true);
  assert.equal(isDirectIdentifier('Email', columnStats(names)), true);
  // A high-cardinality *numeric* column without an ID-ish header is data, not an ID.
  const scores = Array.from({ length: 40 }, (_, i) => String(60 + i * 0.7));
  assert.equal(isDirectIdentifier('Test score', columnStats(scores)), false);
  // But "Student ID" numeric IS caught via the header hint.
  assert.equal(isDirectIdentifier('Student ID', columnStats(names)), true);
});

// ─── Auto ladders ────────────────────────────────────────────────────────────

test('auto ladders start exact and end suppressed', () => {
  const ladder = autoLadder('Age', columnStats(['14', '15', '16', '17', '18']));
  assert.equal(ladder.levels[0].apply('14'), '14');
  assert.equal(ladder.levels[ladder.levels.length - 1].apply('14'), SUPPRESSED);
});

test('auto numeric ladders band by powers of two and scale to the range', () => {
  const small = autoLadder('Age', columnStats(['14', '15', '16', '17', '18']));
  assert.equal(small.levels[1].apply('15'), '14–15'); // width 2
  assert.equal(small.levels[2].apply('15'), '12–15'); // width 4

  const wide = autoLadder('Income', columnStats(['12000', '38000', '90000']));
  const w = Number(wide.levels[1].label.replace(/\D/g, ''));
  assert.ok((90000 - 12000) / w <= 24, `width ${w} leaves too many bands`);
  assert.ok(Number.isInteger(Math.log2(w / 2)), `width ${w} is not 2·2^n`);
});

test('auto ladders are real hierarchies: coarsening merges, never splits', () => {
  // Same invariant as the demo ladders, asserted directly: any two values that
  // share a band at level L must still share one at every level above L.
  const values = Array.from({ length: 200 }, (_, i) => String(i * 7 - 300));
  const ladder = autoLadder('n', columnStats(values));
  for (let lv = 0; lv + 1 < ladder.levels.length; lv++) {
    const a = ladder.levels[lv];
    const b = ladder.levels[lv + 1];
    for (const x of values) {
      for (const y of values) {
        if (a.apply(x) === a.apply(y)) {
          assert.equal(b.apply(x), b.apply(y),
            `${x} and ${y} share "${a.apply(x)}" at level ${lv} but split at level ${lv + 1}`);
        }
      }
    }
  }
});

test('blank numeric cells band to "(blank)", not to 0', () => {
  const ladder = autoLadder('Age', columnStats(['14', '', '16']));
  assert.equal(ladder.levels[1].apply(''), '(blank)');
  assert.notEqual(ladder.levels[1].apply(''), ladder.levels[1].apply('0'));
});

test('non-integer numerics get half-open band labels', () => {
  const ladder = autoLadder('GPA', columnStats(['1.2', '2.7', '3.9']));
  assert.match(ladder.levels[1].apply('2.7'), /–</); // "2–<4", not "2–3"
});

// ─── Descriptor assembly ─────────────────────────────────────────────────────

function makeCsv() {
  const header = 'Student name,Grade,Club,Hours of sleep,Ever vaped';
  const rows = [];
  for (let i = 0; i < 60; i++) {
    rows.push([
      `Person ${i}`,
      String(9 + (i % 4)),
      ['Band', 'Chess', 'Track'][i % 3],
      String(5 + (i % 5)),
      i % 4 === 0 ? 'Yes' : 'No',
    ].join(','));
  }
  return parseCsv(`${header}\n${rows.join('\n')}`);
}

test('inferDescriptor removes direct identifiers and says so', () => {
  const desc = inferDescriptor(makeCsv(), 'club.csv');
  assert.deepEqual(desc.directIds, ['Student name']);
  assert.ok(desc.notices.some((n) => n.includes('direct identifier')));
  assert.ok(!desc.qiCandidates.includes('Student name'));
  assert.ok(!desc.sensitiveOptions.includes('Student name'));
});

test('inferDescriptor defaults the sensitive answer to the last usable column', () => {
  const desc = inferDescriptor(makeCsv(), 'club.csv');
  assert.equal(desc.sensitive, 'Ever vaped');
  assert.ok(!desc.qiCandidates.includes('Ever vaped'));
});

test('the inferred descriptor runs through the real engine end to end', () => {
  const desc = inferDescriptor(makeCsv(), 'club.csv');
  const ladders = desc.initialQis.map(desc.ladderFor);
  const classes = computeClasses(desc.dataset, ladders, {});
  assert.equal(classes.classIndex.length, 60);
  assert.ok(classes.k >= 1);

  const search = searchFrontier(desc.dataset, ladders, desc.tablesFor(desc.sensitive));
  assert.ok(search.evaluated > 0);
  for (const point of search.frontier) assert.equal(point.dead, 0);
});

test('an uploaded file still has a publishable fix, described in its own words', () => {
  // Two bugs lived here. (1) Declaring a table over EVERY attacker column made
  // every route to a larger group "dead", so the search returned nothing and the
  // tool had no advice. (2) The policy description looked labels up in the demo's
  // table, so an uploaded file's recommendation read "undefined → removed".
  const desc = inferDescriptor(makeCsv(), 'club.csv');
  const ladders = desc.initialQis.map(desc.ladderFor);
  const search = searchFrontier(desc.dataset, ladders, desc.tablesFor(desc.sensitive), undefined, desc.short);

  assert.ok(search.frontier.length > 0, 'no publishable policy was found at all');
  assert.ok(search.knee, 'no recommendation');
  for (const point of search.frontier) {
    assert.doesNotMatch(point.description, /undefined/, point.description);
  }
  // At least one attacker column must stay out of the declared tables, or the
  // search is boxed in again the next time someone edits tablesFor.
  const groupBys = new Set(desc.tablesFor(desc.sensitive).map((t) => t.groupBy));
  assert.ok(desc.initialQis.some((c) => !groupBys.has(c)),
    'every attacker column is load-bearing for a table — the search cannot recommend anything');
});

test('row cap: oversized files are truncated with a notice', () => {
  const header = 'a,b';
  const lines = Array.from({ length: ROW_CAP + 50 }, (_, i) => `${i % 9},${i % 4}`);
  const desc = inferDescriptor(parseCsv(`${header}\n${lines.join('\n')}`), 'big.csv');
  assert.equal(desc.dataset.rows.length, ROW_CAP);
  assert.ok(desc.notices.some((n) => n.includes('first')));
});

test('a file that is all identifiers refuses to audit', () => {
  const rows = Array.from({ length: 30 }, (_, i) => `P ${i},x${i}@y.com`).join('\n');
  assert.throws(() => inferDescriptor(parseCsv(`Name,Email\n${rows}`), 'ids.csv'),
    /fewer than two informative columns/);
});
