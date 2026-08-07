import { SUPPRESSED } from './anonymize';
import type { ClassResult, ColumnLadder, Dataset, Policy, Row } from './types';
import { generalizeRow } from './anonymize';

/**
 * The attacker sentence.
 *
 * A number like "k = 1" means nothing to most people. The same fact said out
 * loud — "this is the only 17-year-old 11th-grader in Robotics" — is the whole
 * product in one line. The identical sentence, recomputed after a fix, becomes
 * "one of 14 students in grades 10–11 in a STEM activity".
 *
 * Every word comes from the data and the computed class size. There is no
 * language model here: it is a template filled with values you can read off
 * the table yourself.
 */

/** Optional per-column phrasing so the sentence reads like English. */
export interface Phrasing {
  /** Renders a generalized value as a noun phrase fragment. */
  describe: (generalizedValue: string) => string;
  /** Plural form, used when the row is no longer alone. */
  plural?: (generalizedValue: string) => string;
  /** Fragments with lower order appear earlier in the sentence. */
  order?: number;
}

export type PhrasingMap = Record<string, Phrasing>;

export interface AttackerSentence {
  /** The full sentence, ready to display. */
  text: string;
  /** Size of the equivalence class this row belongs to. */
  classSize: number;
  /** True when this row describes exactly one person. */
  isUnique: boolean;
  /** The descriptive fragments used, in order. */
  fragments: string[];
}

function defaultDescribe(column: string, value: string): string {
  return `${column} ${value}`;
}

/**
 * Compose the sentence for one row under the current policy.
 *
 * Suppressed columns drop out of the description entirely — that is the point
 * of suppressing them, and leaving "Age ∗" in the sentence would be noise.
 */
export function attackerSentence(
  dataset: Dataset,
  ladders: ColumnLadder[],
  policy: Policy,
  classResult: ClassResult,
  rowIndex: number,
  phrasing: PhrasingMap = {},
  subjectNoun = 'person',
): AttackerSentence {
  const row: Row = dataset.rows[rowIndex];
  const generalized = generalizeRow(row, ladders, policy);

  const classIdx = classResult.classIndex[rowIndex];
  const classSize = classIdx >= 0 ? classResult.classes[classIdx].size : 1;
  const isUnique = classSize === 1;

  const parts: { text: string; order: number }[] = [];
  ladders.forEach((ladder, i) => {
    const value = generalized[i];
    if (value === SUPPRESSED || value === '') return;
    const phrase = phrasing[ladder.column];
    const text = !phrase
      ? defaultDescribe(ladder.column, value)
      : isUnique || !phrase.plural
        ? phrase.describe(value)
        : phrase.plural(value);
    parts.push({ text, order: phrase?.order ?? i });
  });
  parts.sort((a, b) => a.order - b.order);
  const fragments = parts.map((p) => p.text);

  if (fragments.length === 0) {
    // Everything suppressed: nothing is left to tell this row apart.
    const text = `This is one of ${classSize} responses with nothing left to tell them apart.`;
    return { text, classSize, isUnique, fragments };
  }

  const description = joinFragments(fragments, isUnique ? subjectNoun : pluralize(subjectNoun));

  const text = isUnique
    ? `This is the only ${description} in the data.`
    : `This is one of ${classSize} ${description}.`;

  return { text, classSize, isUnique, fragments };
}

/**
 * Pluralize the fallback subject noun. `subjectNoun` is always the SINGULAR
 * form ("student", "person"); the plural is derived here so callers cannot
 * accidentally produce "studentses".
 */
const IRREGULAR_PLURALS: Record<string, string> = {
  person: 'people',
  child: 'children',
  woman: 'women',
  man: 'men',
};

function pluralize(noun: string): string {
  const irregular = IRREGULAR_PLURALS[noun.toLowerCase()];
  if (irregular) return irregular;
  if (/(s|x|z|ch|sh)$/i.test(noun)) return `${noun}es`;
  if (/[^aeiou]y$/i.test(noun)) return `${noun.slice(0, -1)}ies`;
  return `${noun}s`;
}

/**
 * Join fragments so the sentence reads like English rather than a field dump:
 *   ["17-year-old", "11th-grader", "in Robotics"] -> "17-year-old 11th-grader in Robotics"
 *
 * Fragments are split into noun-ish heads and prepositional tails. If every
 * fragment is prepositional ("in grade 11", "in Robotics") there is no subject
 * for the sentence to hang on, so the caller's subject noun is inserted —
 * otherwise you get "the only in grade 11 in Robotics".
 */
function joinFragments(fragments: string[], subjectNoun: string): string {
  const leading: string[] = [];
  const trailing: string[] = [];
  for (const fragment of fragments) {
    if (/^(in|from|who|with|at|on|doing)\b/i.test(fragment)) trailing.push(fragment);
    else leading.push(fragment);
  }

  const head = leading.length ? leading.join(' ') : subjectNoun;
  if (trailing.length === 0) return head;
  return `${head} ${trailing.join(' ')}`;
}

/**
 * The advisor note: the paragraph the editor can actually hand to the adult who
 * asked "are you sure no one can be identified?". Every number is live; the
 * closing line is deliberately a bounded claim, never a guarantee.
 */
export interface AdvisorNoteInput {
  k: number;
  uniqueRows: number;
  prosecutor: string;
  journalist: string | null;
  journalistIsUpperBound: boolean;
  fidelityPercent: string | null;
  homogeneousCount: number;
  quasiIdentifiers: string[];
  rowCount: number;
}

export function advisorNote(input: AdvisorNoteInput): string {
  const {
    k,
    uniqueRows,
    prosecutor,
    journalist,
    journalistIsUpperBound,
    fidelityPercent,
    homogeneousCount,
    quasiIdentifiers,
    rowCount,
  } = input;

  const qis = quasiIdentifiers.length ? quasiIdentifiers.join(', ') : 'none selected';
  const lines: string[] = [];

  lines.push(
    `Under the declared attacker model (${qis}), the smallest group in these ${rowCount} responses has ${k} ${k === 1 ? 'person' : 'people'} in it.`,
  );
  lines.push(
    uniqueRows === 0
      ? 'No row describes exactly one person.'
      : `${uniqueRows} ${uniqueRows === 1 ? 'row still describes' : 'rows still describe'} exactly one person.`,
  );
  lines.push(
    journalist && !journalistIsUpperBound
      ? `Worst-case re-identification risk: ${prosecutor} if the attacker already knows the person answered, ${journalist} if they do not.`
      : `Worst-case re-identification risk: ${prosecutor} (upper bound — no population roster was supplied, so this figure stands in for both framings).`,
  );
  if (fidelityPercent) {
    lines.push(`The tables we planned to publish retain ${fidelityPercent} of their original shape.`);
  }
  lines.push(
    homogeneousCount === 0
      ? 'No group gives a single identical answer to the sensitive question.'
      : `${homogeneousCount} ${homogeneousCount === 1 ? 'group answers' : 'groups answer'} the sensitive question identically — an attacker who narrows someone to such a group learns their answer without identifying them.`,
  );
  lines.push(
    `This is a risk report under a stated set of assumptions, not a guarantee of anonymity.`,
  );

  return lines.join(' ');
}
