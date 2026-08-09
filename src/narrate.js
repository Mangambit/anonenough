// Turning a row's equivalence class into the sentence an outsider could say out loud.
// This is the part of the audit a non-technical reader actually understands, so it has
// to read like English rather than like a key.

import { ACTIVITY_PHRASE, COL, SHORT, SUPPRESSED } from './schema.js';
import { generalizeRow } from './engine.js';

function describeFragment(column, value, plural) {
  if (column === COL.age) return `${value}-year-old`;
  if (column === COL.grade) {
    if (/^\d+$/.test(value)) return plural ? `students in grade ${value}` : `${value}th-grader`;
    if (/\d/.test(value)) return `students in grades ${value}`;
    return `in the ${value.toLowerCase()}`;
  }
  if (column === COL.activity) return `in ${ACTIVITY_PHRASE[value] || value}`;
  if (column === COL.homeroom) return `in homeroom ${value}`;
  if (column === COL.sleep) return `sleeping ${value} hours`;
  return `${SHORT[column]} ${value}`;
}

// Fragments read naturally in this order regardless of the column order on the sheet.
const FRAG_ORDER = {
  [COL.age]: 0,
  [COL.grade]: 1,
  [COL.activity]: 2,
  [COL.homeroom]: 3,
  [COL.sleep]: 4,
};

// Fragments starting with these words attach *after* the noun ("14-year-old in Band"),
// everything else stacks in front of it.
const TRAILING = /^(in|from|who|with|at|on|sleeping)\b/i;

export function attackerSentence(dataset, ladders, policy, classResult, rowIndex, desc) {
  const generalized = generalizeRow(dataset.rows[rowIndex], ladders, policy);
  const ci = classResult.classIndex[rowIndex];
  const classSize = ci >= 0 ? classResult.classes[ci].size : 1;
  const isUnique = classSize === 1;

  // Uploaded files get plain "label value" clauses — we know nothing about their
  // columns, and an invented idiom would read wrong ("in homeroom Sales").
  if (desc && desc.generic) {
    const clauses = [];
    ladders.forEach((l, i) => {
      const v = generalized[i];
      if (v === SUPPRESSED || v === '') return;
      clauses.push(`${desc.short[l.column]} ${v}`);
    });
    if (!clauses.length) {
      return `This is one of ${classSize} responses with nothing left to tell them apart.`;
    }
    const list = clauses.length === 1
      ? clauses[0]
      : `${clauses.slice(0, -1).join(', ')} and ${clauses[clauses.length - 1]}`;
    return isUnique
      ? `This is the only response in the file with ${list}.`
      : `This is one of ${classSize} responses with ${list}.`;
  }

  const parts = [];
  ladders.forEach((l, i) => {
    const v = generalized[i];
    if (v === SUPPRESSED || v === '') return; // a removed column tells the attacker nothing
    parts.push({
      text: describeFragment(l.column, v, !isUnique),
      order: FRAG_ORDER[l.column] != null ? FRAG_ORDER[l.column] : 9,
    });
  });
  parts.sort((a, b) => a.order - b.order);

  const fragments = parts.map((p) => p.text);
  if (!fragments.length) {
    return `This is one of ${classSize} responses with nothing left to tell them apart.`;
  }

  const leading = [];
  const trailing = [];
  for (const f of fragments) (TRAILING.test(f) ? trailing : leading).push(f);

  const head = leading.length ? leading.join(' ') : (isUnique ? 'student' : 'students');
  const description = trailing.length ? `${head} ${trailing.join(' ')}` : head;

  return isUnique
    ? `This is the only ${description} in the data.`
    : `This is one of ${classSize} ${description}.`;
}

/**
 * Word-level LCS diff, used to animate one sentence turning into another.
 * Returns tokens tagged 'same' | 'del' | 'add' in reading order.
 */
export function diffWords(a, b) {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ text: a[i], op: 'same' }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ text: a[i], op: 'del' }); i++; }
    else { out.push({ text: b[j], op: 'add' }); j++; }
  }
  while (i < n) out.push({ text: a[i++], op: 'del' });
  while (j < m) out.push({ text: b[j++], op: 'add' });
  return out;
}
