import { autoLadder } from '../lib/anonymize';
import type { PhrasingMap } from '../lib/sentence';
import type { ReportTable } from '../lib/tvd';
import { ACTIVITY_CATEGORY, COL } from '../lib/generate';
import type { ColumnLadder, Dataset } from '../lib/types';

/**
 * Demo wiring: the things that are specific to *this* survey rather than to the
 * privacy maths. Kept out of src/lib so the engine stays general — anything in
 * here can be swapped when a user drops in their own CSV.
 */

/**
 * The DECLARED attacker model.
 *
 * Grade and main activity are things a classmate simply knows on sight, which
 * makes them the honest default. Age is deliberately excluded: adding it makes
 * almost every respondent unique, and that is far more powerful as something
 * the sensitivity panel reveals than as a default nobody chose.
 */
export const DEFAULT_QUASI_IDENTIFIERS = [COL.grade, COL.activity];

/** Columns offered as "what else might they know?" in the sensitivity sweep. */
export const CANDIDATE_QUASI_IDENTIFIERS = [COL.age, COL.homeroom];

/** The question whose answer would actually hurt if it leaked. */
export const SENSITIVE_COLUMN = COL.vaped;

/** Columns that are answers, not identifiers — never offered as QIs. */
export const ANSWER_COLUMNS = [COL.sleep, COL.safe, COL.vaped];

export function buildLadders(dataset: Dataset, columns: string[]): ColumnLadder[] {
  return columns.map((column) =>
    column === COL.activity
      ? autoLadder(dataset, column, ACTIVITY_CATEGORY)
      : autoLadder(dataset, column),
  );
}

/**
 * The two tables the paper actually intends to print. Fidelity is measured only
 * over these — declaring them up front is what stops "the data still looks fine"
 * from being a vibe.
 */
export const REPORT_TABLES: ReportTable[] = [
  { id: 'grade', label: 'Respondents by grade', groupBy: COL.grade },
  {
    id: 'sleep-by-activity',
    label: 'Sleeps under 6 hours, by activity',
    groupBy: COL.activity,
    breakdownBy: COL.sleep,
  },
];

const ORDINALS: Record<string, string> = {
  '9': '9th',
  '10': '10th',
  '11': '11th',
  '12': '12th',
};

/** "9" -> "9th-grader"; "8–9" -> "student in grades 8–9". */
function gradePhrase(value: string, plural: boolean): string {
  const ordinal = ORDINALS[value];
  if (ordinal) return plural ? `${ordinal}-graders` : `${ordinal}-grader`;
  return plural ? `students in grades ${value}` : `student in grades ${value}`;
}

/**
 * Phrasing turns generalized values into English. Without it the sentence reads
 * "the only What grade are you in? 11" — technically correct, rhetorically dead.
 */
export const PHRASING: PhrasingMap = {
  [COL.grade]: {
    order: 0,
    describe: (v) => gradePhrase(v, false),
    plural: (v) => gradePhrase(v, true),
  },
  [COL.activity]: {
    order: 1,
    // Rolled-up values already read as noun phrases ("a STEM activity");
    // raw ones are proper nouns ("Robotics").
    describe: (v) => `in ${v}`,
  },
  [COL.age]: {
    order: -1,
    describe: (v) => (v.includes('–') ? `student aged ${v}` : `${v}-year-old`),
    plural: (v) => (v.includes('–') ? `students aged ${v}` : `${v}-year-olds`),
  },
  [COL.homeroom]: {
    order: 2,
    describe: (v) => `in homeroom ${v}`,
  },
};

export const SUBJECT_NOUN = 'student';

/** k values the remediation search solves for. */
export const K_TARGETS = [2, 3, 5, 8, 11, 14, 20];

/**
 * Seed for the shipped demo, chosen by the search in scripts/verify.ts against a
 * stated acceptance predicate (a handful of unique rows, at least one
 * homogeneous group, a knee that keeps most of the published tables). Disclosed
 * here and in the README rather than hidden — the maths is identical on any CSV.
 */
export const DEMO_SEED = 1;
