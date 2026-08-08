import type { Dataset, Row } from './types';

/**
 * Synthetic demo data.
 *
 * Demonstrating a re-identification tool on real classmates' survey answers
 * would be the exact harm the tool exists to prevent. So the demo data is
 * generated, labelled as generated everywhere it appears, and reproducible:
 * this file plus the seed is the whole provenance chain.
 *
 * Shape deliberately mirrors a Google Forms export — a Timestamp column and
 * question-phrased headers — because that is the artifact a student editor
 * actually has in front of them.
 */

/** mulberry32: small, fast, fully deterministic from a 32-bit seed. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, items: T[]): T {
  return items[Math.floor(rng() * items.length)];
}

function weightedPick<T>(rng: () => number, items: [T, number][]): T {
  const total = items.reduce((sum, [, w]) => sum + w, 0);
  let roll = rng() * total;
  for (const [item, weight] of items) {
    roll -= weight;
    if (roll <= 0) return item;
  }
  return items[items.length - 1][0];
}

export const COL = {
  timestamp: 'Timestamp',
  name: 'Your name',
  age: 'How old are you?',
  grade: 'What grade are you in?',
  activity: 'What is your main after-school activity?',
  homeroom: 'Which homeroom are you in?',
  sleep: 'On a school night, how many hours do you sleep?',
  safe: 'Do you feel safe at school?',
  vaped: 'Have you ever been offered a vape?',
} as const;

export const ACTIVITIES = [
  'Robotics',
  'Band',
  'Soccer',
  'Debate',
  'Theater',
  'Track',
  'Newspaper',
  'Chess',
] as const;

/** Rollup used by the Activity generalization ladder. */
export const ACTIVITY_CATEGORY: Record<string, string> = {
  Robotics: 'a STEM activity',
  Chess: 'a STEM activity',
  Band: 'an arts activity',
  Theater: 'an arts activity',
  Newspaper: 'an arts activity',
  Soccer: 'a sport',
  Track: 'a sport',
  Debate: 'an academic activity',
};

const HOMEROOMS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

/**
 * Invented names for the demo.
 *
 * The name column exists so the app can start where a real editor starts —
 * looking at a spreadsheet that obviously identifies everyone — and so deleting
 * it is something you watch happen rather than something you're told about.
 * These people do not exist.
 */
const FIRST_NAMES = [
  'Priya', 'Marcus', 'Leila', 'Tomás', 'Aisha', 'Noah', 'Yuki', 'Dara',
  'Sofia', 'Omar', 'Hannah', 'Kwame', 'Ines', 'Ravi', 'Clara', 'Mateo',
  'Nadia', 'Elias', 'Mei', 'Jonah', 'Zara', 'Felix', 'Amara', 'Luca',
];
const LAST_INITIALS = 'ABCDEFGHIKLMNOPRSTVW'.split('');

function makeName(rng: () => number): string {
  return `${pick(rng, FIRST_NAMES)} ${pick(rng, LAST_INITIALS)}.`;
}

/**
 * Build a school roster. Ages correlate with grade the way they really do,
 * which is what makes {age, grade, activity} identifying in the first place —
 * an unusual age for a grade is exactly what singles someone out.
 */
export function generateRoster(seed: number, size = 800): Dataset {
  const rng = makeRng(seed);
  const rows: Row[] = [];

  for (let i = 0; i < size; i++) {
    const grade = weightedPick(rng, [
      [9, 1],
      [10, 1],
      [11, 1],
      [12, 1],
    ]);
    // Most students are the modal age for their grade; a few are off by one.
    const baseAge = grade + 5;
    const age = weightedPick(rng, [
      [baseAge, 8],
      [baseAge + 1, 2],
      [baseAge - 1, 1],
    ]);
    rows.push({
      [COL.age]: String(age),
      [COL.grade]: String(grade),
      [COL.activity]: pick(rng, [...ACTIVITIES]),
      [COL.homeroom]: pick(rng, HOMEROOMS),
    });
  }

  return {
    columns: [COL.age, COL.grade, COL.activity, COL.homeroom],
    rows,
    label: `Synthetic roster — generated, seed ${seed}`,
  };
}

/**
 * Draw the survey respondents from the roster and give them answers.
 * Returned as a Forms-shaped dataset: timestamp first, then the questions.
 */
export function generateSurvey(seed: number, rosterSize = 800, responseRate = 0.11): Dataset {
  const roster = generateRoster(seed, rosterSize);
  const rng = makeRng(seed ^ 0x9e3779b9);
  const rows: Row[] = [];

  let clock = Date.UTC(2026, 8, 15, 8, 0, 0);

  for (const person of roster.rows) {
    if (rng() > responseRate) continue;
    clock += Math.floor(rng() * 9 * 60 * 1000) + 30_000;

    const grade = Number(person[COL.grade]);
    // Older students report less sleep; this is the pattern the paper wants to
    // publish, and therefore the thing anonymization must not destroy.
    const sleepsLittle = rng() < 0.25 + (grade - 9) * 0.09;
    const activity = person[COL.activity];

    rows.push({
      [COL.timestamp]: new Date(clock).toISOString().slice(0, 16).replace('T', ' '),
      [COL.name]: makeName(rng),
      [COL.age]: person[COL.age],
      [COL.grade]: person[COL.grade],
      [COL.activity]: activity,
      [COL.homeroom]: person[COL.homeroom],
      [COL.sleep]: sleepsLittle ? 'Under 6' : pick(rng, ['6–7', '7–8', 'More than 8']),
      [COL.safe]: rng() < 0.82 ? 'Yes' : 'No',
      [COL.vaped]: rng() < 0.31 ? 'Yes' : 'No',
    });
  }

  return {
    columns: [
      COL.timestamp,
      COL.name,
      COL.age,
      COL.grade,
      COL.activity,
      COL.homeroom,
      COL.sleep,
      COL.safe,
      COL.vaped,
    ],
    rows,
    label: `Synthetic survey — generated from seed ${seed}. These people do not exist.`,
  };
}

/**
 * The twelve-row sample, written by hand rather than generated.
 *
 * Its job is to be checkable without trusting the app: a judge can count the
 * groups on their fingers and confirm every number on screen. Three rows are
 * unique under {age, grade, activity}; one group of three answers the sensitive
 * question identically, which is the homogeneity caveat made concrete.
 */
export function handCheckSample(): Dataset {
  const make = (
    age: number,
    grade: number,
    activity: string,
    homeroom: string,
    sleep: string,
    safe: string,
    vaped: string,
  ): Row => ({
    [COL.timestamp]: '2026-09-15 08:0' + ((age + grade) % 10),
    [COL.age]: String(age),
    [COL.grade]: String(grade),
    [COL.activity]: activity,
    [COL.homeroom]: homeroom,
    [COL.sleep]: sleep,
    [COL.safe]: safe,
    [COL.vaped]: vaped,
  });

  // Laid out deliberately for the declared model {grade, activity}:
  //   · exactly three rows are one-of-a-kind
  //   · rolling activities up to their category resolves all three
  //   · one group of three answers the sensitive question identically
  //   · ages are chosen so that ADDING age to the model breaks things again,
  //     which is what makes the sensitivity panel worth looking at
  const rows: Row[] = [
    // Unique: the only 11th-grader in Robotics. Pairs with the Chess player
    // once both roll up to "a STEM activity".
    make(17, 11, 'Robotics', 'A1', 'Under 6', 'No', 'Yes'),
    make(16, 11, 'Chess', 'B2', 'Under 6', 'Yes', 'No'),
    // Unique: the only 9th-grader in Track. Joins the 9th-grade Soccer pair
    // once both roll up to "a sport".
    make(14, 9, 'Track', 'C1', '7–8', 'Yes', 'No'),
    make(15, 9, 'Soccer', 'B2', '7–8', 'Yes', 'No'),
    make(15, 9, 'Soccer', 'C2', 'More than 8', 'Yes', 'No'),
    // A homogeneous group of three: identical answer to the sensitive question,
    // so k alone does not protect them. One differing age splits this group the
    // moment age enters the attacker model.
    make(16, 10, 'Soccer', 'A2', '6–7', 'Yes', 'Yes'),
    make(16, 10, 'Soccer', 'B1', 'Under 6', 'Yes', 'Yes'),
    make(15, 10, 'Soccer', 'C2', '7–8', 'No', 'Yes'),
    // Two ordinary pairs.
    make(15, 10, 'Band', 'A1', 'More than 8', 'Yes', 'No'),
    make(15, 10, 'Band', 'B1', '7–8', 'Yes', 'No'),
    make(16, 11, 'Debate', 'C1', 'Under 6', 'Yes', 'No'),
    make(16, 11, 'Debate', 'A2', '6–7', 'No', 'Yes'),
  ];

  return {
    columns: [
      COL.timestamp,
      COL.age,
      COL.grade,
      COL.activity,
      COL.homeroom,
      COL.sleep,
      COL.safe,
      COL.vaped,
    ],
    rows,
    label: 'Hand-written 12-row sample — count the groups yourself',
  };
}

/** Serialize a dataset to CSV so the demo can be downloaded and re-dropped. */
export function toCsv(dataset: Dataset): string {
  const escape = (value: string) =>
    /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  const header = dataset.columns.map(escape).join(',');
  const lines = dataset.rows.map((row) =>
    dataset.columns.map((column) => escape(String(row[column] ?? ''))).join(','),
  );
  return [header, ...lines].join('\n');
}
