// Synthetic demo data. No real student ever answered any of this.
//
// A roster of `rosterSize` students is generated first, then a response rate is applied,
// so the published file is a *subset* of a population — which is what makes the
// re-identification story realistic. Everything is seeded, so the same seed always
// produces the same file.

import { COL, ORDER } from './schema.js';

/** mulberry32 — small, fast, deterministic. */
export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, items) {
  return items[Math.floor(rng() * items.length)];
}

function weighted(rng, pairs) {
  let total = 0;
  for (const p of pairs) total += p[1];
  let roll = rng() * total;
  for (const p of pairs) {
    roll -= p[1];
    if (roll <= 0) return p[0];
  }
  return pairs[pairs.length - 1][0];
}

// Skewed on purpose: an even spread would hand every column far more entropy than a
// real school has, and the demo would open in a falsely reassuring state.
const ACTIVITY_W = [['Soccer', 22], ['Band', 18], ['Track', 14], ['Theater', 11], ['Robotics', 9], ['Debate', 7], ['Newspaper', 4], ['Chess', 3]];
const HOMEROOM_W = [['A1', 26], ['A2', 22], ['B1', 18], ['B2', 14], ['C1', 9], ['C2', 5]];
const GRADE_W = [['9', 30], ['10', 27], ['11', 23], ['12', 20]];

export function generateSurvey(seed, rosterSize = 820, rate = 0.52) {
  const rng = makeRng(seed);
  const roster = [];
  for (let i = 0; i < rosterSize; i++) {
    const grade = Number(weighted(rng, GRADE_W));
    const base = grade + 5;
    const r = rng();
    // ±1 year of jitter around the modal age for the grade — held back or skipped ahead.
    const age = r < 0.72 ? base : r < 0.9 ? base + 1 : base - 1;
    roster.push({
      age: String(age),
      grade: String(grade),
      activity: weighted(rng, ACTIVITY_W),
      homeroom: weighted(rng, HOMEROOM_W),
    });
  }

  const rng2 = makeRng(seed ^ 0x9e3779b9);
  const rows = [];
  for (const p of roster) {
    if (rng2() > rate) continue;
    const sleepsLittle = rng2() < 0.25 + (Number(p.grade) - 9) * 0.09;
    rows.push({
      [COL.age]: p.age,
      [COL.grade]: p.grade,
      [COL.activity]: p.activity,
      [COL.homeroom]: p.homeroom,
      [COL.sleep]: sleepsLittle ? 'Under 6' : pick(rng2, ['6–7', '7–8', '8+']),
      [COL.safe]: rng2() < 0.82 ? 'Yes' : 'No',
      [COL.vaped]: rng2() < 0.31 ? 'Yes' : 'No',
    });
  }

  return { columns: ORDER, rows, name: 'survey-responses.csv' };
}
