// AnonEnough — state and rendering.
//
// Everything below the engine is presentation. The engine (src/engine.js) is pure and
// tested; this file owns the DOM, the memoization keys and the two animations.

import { COL, LETTERS, ORDER, QI_CANDIDATES, SHORT } from './schema.js';
import { generateSurvey } from './survey.js';
import {
  computeClasses,
  computeFidelity,
  homogeneousClasses,
  ladderFor,
  levelFor,
  searchFrontier,
} from './engine.js';
import { attackerSentence, diffWords } from './narrate.js';
import { buildChart } from './chart.js';

// The four knobs the design prototype exposed as props. They are hardcoded here for the
// same reason they were hardcoded there — there is no upload step yet, so there is
// nothing for a user to point them at. See NOTES.md.
const CONFIG = {
  seed: 4207,
  rosterSize: 820,
  responseRate: 0.52,
  sensitiveQuestion: COL.vaped, // or COL.safe
  defaultSheet: 'anonymized', // 'original' | 'anonymized' | 'diff'
  rowsVisible: 14,
};

const DECLARED_TABLES = [
  { label: 'Sleep by grade', groupBy: COL.grade, breakdownBy: COL.sleep },
  { label: 'Sleep by age', groupBy: COL.age, breakdownBy: COL.sleep },
  { label: 'Sensitive answer by activity', groupBy: COL.activity, breakdownBy: CONFIG.sensitiveQuestion },
];

// Grade + Activity + Homeroom, not Age. Age and Grade are near-redundant, and the ±1
// year of jitter in the roster mints singleton classes that no generalization can clear —
// which would make every recommendation a column deletion.
const DEFAULT_QIS = [COL.grade, COL.activity, COL.homeroom];

const state = {
  qis: [...DEFAULT_QIS],
  policy: {},
  selected: null,
  sheet: CONFIG.defaultSheet,
  expanded: false,
  phase: 'idle', // 'idle' | 'strike' | 'in'
  diff: null,
  disp: null, // tweened metric values
};

const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// ─── Tiny DOM helper ─────────────────────────────────────────────────────────

function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, String(value));
  }
  for (const child of children.flat()) {
    if (child == null) continue;
    node.append(typeof child === 'string' || typeof child === 'number' ? String(child) : child);
  }
  return node;
}

const $ = (selector) => document.querySelector(selector);
const el = {
  statusDot: $('[data-status-dot]'),
  filename: $('[data-filename]'),
  qiChips: $('[data-qi-chips]'),
  previewPill: $('[data-preview-pill]'),
  sheetFix: $('[data-sheet-fix]'),
  sheetReset: $('[data-sheet-reset]'),
  kBadge: $('[data-k-badge]'),
  letters: $('[data-letters]'),
  headers: $('[data-headers]'),
  rows: $('[data-rows]'),
  tabs: $('[data-tabs]'),
  rowToggle: $('[data-row-toggle]'),
  statusLine: $('[data-status-line]'),
  metrics: $('[data-metrics]'),
  sentence: $('[data-sentence]'),
  fixBtn: $('[data-fix-btn]'),
  resetBtn: $('[data-reset-btn]'),
  fixDescription: $('[data-fix-description]'),
  chart: $('[data-chart]'),
  tableStrip: $('[data-table-strip]'),
  recHeading: $('[data-rec-heading]'),
  kneeK: $('[data-knee-k]'),
  kneeDescription: $('[data-knee-description]'),
  searchNote: $('[data-search-note]'),
  attackerLine: $('[data-attacker-line]'),
  limits: $('[data-limits]'),
  advisorNote: $('[data-advisor-note]'),
  provenance: $('[data-provenance]'),
};

// ─── Memoized model ──────────────────────────────────────────────────────────

const dataset = generateSurvey(CONFIG.seed, CONFIG.rosterSize, CONFIG.responseRate);

let cachedModel = null;
let cachedSearch = null;

function model() {
  const key = `${state.qis.join('|')}#${JSON.stringify(state.policy)}`;
  if (cachedModel && cachedModel.key === key) return cachedModel;

  const ladders = state.qis.map(ladderFor);
  const classes = computeClasses(dataset, ladders, state.policy);
  const base = computeClasses(dataset, ladders, {});
  const fidelity = computeFidelity(dataset, ladders, state.policy, DECLARED_TABLES);

  // The lattice search is the expensive step and does not depend on the applied policy,
  // so it only reruns when the declared attacker model changes.
  const searchKey = state.qis.join('|');
  if (!cachedSearch || cachedSearch.key !== searchKey) {
    cachedSearch = { key: searchKey, value: searchFrontier(dataset, ladders, DECLARED_TABLES) };
  }

  cachedModel = {
    key,
    ladders,
    classes,
    base,
    fidelity,
    search: cachedSearch.value,
    homogeneous: homogeneousClasses(dataset, classes.classes, CONFIG.sensitiveQuestion),
  };
  return cachedModel;
}

function selectedRow(m) {
  if (state.selected != null) return state.selected;
  const firstUnique = m.base.classes.find((c) => c.size === 1);
  return firstUnique ? firstUnique.rowIndices[0] : 0;
}

// Column distributions never change — the file is fixed — so the bar heights are
// computed once and only their colour reacts to state.
const histogramCache = new Map();
function histogram(column) {
  if (histogramCache.has(column)) return histogramCache.get(column);
  const counts = new Map();
  for (const row of dataset.rows) counts.set(row[column], (counts.get(row[column]) || 0) + 1);
  const values = [...counts.entries()]
    .sort((a, b) => String(a[0]).localeCompare(String(b[0]), undefined, { numeric: true }));
  const max = Math.max(...values.map((v) => v[1]));
  const bars = values.slice(0, 9).map(([, n]) => Math.max(2, Math.round((n / max) * 14)));
  histogramCache.set(column, bars);
  return bars;
}

// ─── Actions ─────────────────────────────────────────────────────────────────

let strikeTimer;
let settleTimer;

function setState(patch) {
  Object.assign(state, patch);
  render();
}

function applyPolicy(next) {
  const m = model();
  const rowIndex = selectedRow(m);
  const before = attackerSentence(dataset, m.ladders, state.policy, m.classes, rowIndex);

  const nextClasses = computeClasses(dataset, m.ladders, next);
  const after = attackerSentence(dataset, m.ladders, next, nextClasses, rowIndex);

  clearTimeout(strikeTimer);
  clearTimeout(settleTimer);

  if (reducedMotion() || before === after) {
    setState({ policy: next, phase: 'idle', diff: null });
    return;
  }

  setState({ policy: next, phase: 'strike', diff: diffWords(before.split(' '), after.split(' ')) });
  strikeTimer = setTimeout(() => setState({ phase: 'in' }), 340);
  settleTimer = setTimeout(() => setState({ phase: 'idle', diff: null }), 1100);
}

function toggleQi(column) {
  const qis = state.qis.includes(column)
    ? state.qis.filter((c) => c !== column)
    : [...state.qis, column];
  if (!qis.length) return; // an empty attacker model has nothing to report on

  clearTimeout(strikeTimer);
  clearTimeout(settleTimer);
  setState({ qis, policy: {}, phase: 'idle', diff: null });
}

function jumpToSheet() {
  const target = document.getElementById('sheet');
  if (!target) return;
  window.scrollTo({
    top: target.getBoundingClientRect().top + window.scrollY - 72,
    behavior: reducedMotion() ? 'auto' : 'smooth',
  });
}

// ─── Metric tween ────────────────────────────────────────────────────────────

let tweenTargets = null;
let tweenKey = null;
let tweenFrame = null;
const metricNodes = [];

function paintMetrics(values, view) {
  if (!metricNodes.length) return;
  const shown = [
    `k = ${Math.round(values.k)}`,
    String(Math.round(values.uniq)),
    formatRisk(values.risk),
    `${Math.round(values.fid)}%`,
  ];
  metricNodes.forEach((node, i) => {
    node.textContent = shown[i];
    node.classList.toggle('is-alarm', view.alarmFlags[i]);
    node.classList.toggle('is-safe', view.safeFlags[i]);
  });
}

function tween(view) {
  const targets = tweenTargets;
  const key = JSON.stringify(targets);
  if (tweenKey === key) return;
  tweenKey = key;

  // A hidden tab starves requestAnimationFrame, which would leave the band displaying
  // the previous audit's numbers until the user came back. Correct beats animated.
  if (reducedMotion() || document.hidden) {
    state.disp = targets;
    paintMetrics(targets, view);
    return;
  }

  const from = state.disp || { k: 0, risk: 0, fid: 0, uniq: 0 };
  const start = performance.now();
  cancelAnimationFrame(tweenFrame);

  const step = (now) => {
    const p = Math.min(1, (now - start) / 700);
    const eased = 1 - (1 - p) ** 3;
    const disp = {};
    for (const field in targets) disp[field] = from[field] + (targets[field] - from[field]) * eased;
    state.disp = disp;
    paintMetrics(disp, view);
    if (p < 1) tweenFrame = requestAnimationFrame(step);
  };
  tweenFrame = requestAnimationFrame(step);
}

const formatRisk = (v) => (v >= 10 ? `${Math.round(v)}%` : `${v.toFixed(1)}%`);

// ─── Render ──────────────────────────────────────────────────────────────────

function render() {
  const m = model();
  const { ladders, classes, base, fidelity, search, homogeneous } = m;
  const sheet = state.sheet;

  const k = classes.k;
  const alarm = k === 1;
  const uniq = classes.uniqueRows;
  const riskValue = k > 0 ? 100 / k : 100;

  const points = search.frontier;
  const knee = search.knee;
  const fixTarget = knee || points[points.length - 1] || null;

  const anyPolicy = ladders.some((l) => (state.policy[l.column] || 0) > 0);

  // On load, Anonymized and Diff would be byte-identical to Original — so they preview
  // the recommendation instead. It is labelled everywhere so it cannot read as applied.
  const previewing = !anyPolicy && sheet !== 'original' && !!fixTarget;
  const effPolicy = previewing ? fixTarget.policy : state.policy;
  const effClasses = previewing ? computeClasses(dataset, ladders, effPolicy) : classes;

  const applied = !!fixTarget && anyPolicy
    && ladders.every((l) => (state.policy[l.column] || 0) === (fixTarget.policy[l.column] || 0));

  const levelByCol = {};
  ladders.forEach((l) => { levelByCol[l.column] = levelFor(l, effPolicy); });

  const rowIndex = selectedRow(m);

  document.documentElement.style.setProperty('--verdict', alarm ? 'var(--risk)' : 'var(--accent)');

  // ── Sheet chrome ──
  el.filename.textContent = `${dataset.name} — ${dataset.rows.length} rows · ${dataset.columns.length} columns`;

  el.qiChips.replaceChildren(...QI_CANDIDATES.map((c) => h('button', {
    type: 'button',
    class: 'qi-chip',
    'aria-pressed': String(state.qis.includes(c)),
    text: SHORT[c],
    onclick: () => toggleQi(c),
  })));

  el.previewPill.hidden = !previewing;

  el.sheetFix.textContent = !fixTarget ? 'No publishable fix'
    : applied ? 'Fix applied'
      : previewing ? 'Apply this fix' : 'Apply recommended fix';
  el.sheetFix.disabled = !fixTarget;
  el.sheetFix.classList.toggle('sheet-btn--applied', applied);

  el.sheetReset.classList.toggle('sheet-reset--armed', anyPolicy);

  el.kBadge.textContent = previewing ? `k ${base.k} → ${effClasses.k}`
    : anyPolicy ? `k ${base.k} → ${k}` : `k = ${k}`;
  el.kBadge.classList.toggle('k-badge--alarm', alarm);

  // ── Column strips ──
  // The leading spacer keeps both strips aligned with the row gutter track.
  el.letters.replaceChildren(
    h('div', { class: 'is-spacer' }),
    ...ORDER.map((c, i) => h('div', {
      class: state.qis.includes(c) ? 'is-qi' : '',
      text: LETTERS[i],
    })),
    h('div', { class: 'is-sum', text: 'Σ' }),
  );

  el.headers.replaceChildren(
    h('div', { class: 'head is-spacer' }),
    ...ORDER.map((c) => {
      const isQi = state.qis.includes(c);
      const changed = sheet !== 'original' && !!levelByCol[c] && (effPolicy[c] || 0) > 0;
      return h('div', { class: `head${isQi ? ' is-qi' : ''}${changed ? ' is-changed' : ''}` },
        h('div', { class: 'spark' }, QI_CANDIDATES.includes(c)
          ? histogram(c).map((height) => h('i', { style: `height:${height}px` }))
          : []),
        h('div', { class: 'head__label', text: SHORT[c] }));
    }),
    h('div', { class: 'head is-sum' },
      h('div', { class: 'spark' }),
      h('div', { class: 'head__label', text: 'Group size' })),
  );

  // ── Rows ──
  const limit = state.expanded ? dataset.rows.length : Math.max(4, CONFIG.rowsVisible);
  const shown = sheet === 'original' ? base : effClasses;

  el.rows.classList.toggle('sheet__body--scroll', state.expanded);
  el.rows.replaceChildren(...dataset.rows.slice(0, limit).map((row, i) => {
    const ci = shown.classIndex[i];
    const size = ci >= 0 ? shown.classes[ci].size : 1;
    const unique = size === 1;
    const isSelected = i === rowIndex;

    const cells = ORDER.map((c) => {
      const level = levelByCol[c];
      const raw = String(row[c]);
      const generalized = level ? level.apply(raw) : raw;
      const changed = !!level && generalized !== raw && sheet !== 'original';
      const isQi = state.qis.includes(c);

      const classNames = ['cell'];
      if (isQi) classNames.push('is-qi');
      if (isQi && unique) classNames.push('in-unique');
      if (changed) classNames.push('is-changed');

      return h('div', { class: classNames.join(' ') },
        sheet === 'diff' && changed ? h('span', { class: 'cell__old', text: raw }) : null,
        h('span', { class: 'cell__value', text: sheet === 'anonymized' || sheet === 'diff' ? generalized : raw }));
    });

    cells.push(h('div', {
      class: `cell cell--size${unique ? ' is-unique' : size >= 5 ? ' is-safe' : ''}`,
    }, h('span', { class: 'cell__value', text: `1 of ${size}` })));

    const node = h('div', {
      class: `sheet-grid row${unique ? ' is-unique' : ''}${isSelected ? ' is-selected' : ''}`,
      role: 'button',
      tabindex: '0',
      'aria-pressed': String(isSelected),
      'aria-label': `Row ${i + 1}, one of ${size} indistinguishable responses`,
      onclick: () => setState({ selected: i, phase: 'idle', diff: null }),
      onkeydown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setState({ selected: i, phase: 'idle', diff: null });
        }
      },
    }, h('div', { class: 'row__gutter', text: String(i + 1) }), ...cells);

    return node;
  }));

  // ── Sheet footer ──
  el.tabs.replaceChildren(...[['original', 'Original'], ['anonymized', 'Anonymized'], ['diff', 'Diff']]
    .map(([id, label]) => h('button', {
      type: 'button',
      class: 'tab',
      role: 'tab',
      'aria-selected': String(sheet === id),
      onclick: () => setState({ sheet: id }),
    }, h('span', { class: 'tab__dot' }), label)));

  el.rowToggle.textContent = state.expanded
    ? `Show first ${CONFIG.rowsVisible}`
    : `Show all ${dataset.rows.length}`;

  const uniqueShown = sheet === 'original' ? base.uniqueRows : previewing ? effClasses.uniqueRows : uniq;
  el.statusLine.textContent = sheet === 'original'
    ? `${base.uniqueRows} of ${dataset.rows.length} rows describe exactly one person`
    : previewing
      ? `Would leave ${effClasses.uniqueRows} of ${dataset.rows.length} rows describing one person · smallest group ${effClasses.k}`
      : `${uniq} of ${dataset.rows.length} rows describe exactly one person · smallest group ${k}`;
  el.statusLine.parentElement.classList.toggle('is-alarm', uniqueShown > 0);

  // ── Metrics ──
  const metricDefs = [
    {
      label: 'Smallest group',
      note: alarm
        ? 'At least one row still describes exactly one student.'
        : `Every row shares its answers with at least ${k - 1} others.`,
    },
    {
      label: 'Rows describing one person',
      note: `Out of ${dataset.rows.length} responses collected.`,
    },
    {
      label: 'Worst-case re-identification',
      note: 'Prosecutor framing, stated as an upper bound.',
    },
    {
      label: 'Published tables surviving',
      note: `Averaged across the ${DECLARED_TABLES.length} tables declared for release.`,
    },
  ];

  const view = {
    alarmFlags: [alarm, uniq > 0, alarm, false],
    safeFlags: [!alarm, uniq === 0, false, false],
  };

  if (!metricNodes.length) {
    el.metrics.replaceChildren(...metricDefs.map((def) => {
      const value = h('div', { class: 'metric__value' });
      metricNodes.push(value);
      return h('div', { class: 'metric' },
        h('div', { class: 'micro', text: def.label }),
        value,
        h('div', { class: 'metric__note', text: def.note }));
    }));
  } else {
    metricDefs.forEach((def, i) => {
      el.metrics.children[i].lastElementChild.textContent = def.note;
    });
  }

  tweenTargets = { k, risk: riskValue, fid: fidelity.fidelity * 100, uniq };
  paintMetrics(state.disp || { k: 0, risk: 0, fid: 0, uniq: 0 }, view);
  tween(view);

  // ── The sentence ──
  const currentSentence = attackerSentence(dataset, ladders, state.policy, classes, rowIndex);
  let tokens;
  if (state.phase !== 'idle' && state.diff) {
    const list = state.phase === 'strike'
      ? state.diff.filter((t) => t.op !== 'add')
      : state.diff.filter((t) => t.op !== 'del');
    tokens = list.map((t) => h('span', {
      class: `tok${t.op === 'del' ? ' tok--del' : t.op === 'add' ? ' tok--add' : ''}`,
      text: `${t.text} `,
    }));
  } else {
    tokens = currentSentence.split(' ').map((w) => h('span', { class: 'tok', text: `${w} ` }));
  }
  el.sentence.replaceChildren(...tokens);

  el.fixBtn.textContent = !fixTarget ? 'No publishable fix exists'
    : applied ? 'Recommended fix applied' : 'Apply the recommended fix';
  el.fixBtn.disabled = !fixTarget;
  el.fixBtn.classList.toggle('fix-btn--applied', applied);

  el.fixDescription.textContent = fixTarget
    ? `→ ${fixTarget.description}`
    : '→ Every route to a larger group destroys a declared table. Narrow the attacker model above, or cut a table from the release.';

  // ── Tradeoff ──
  el.chart.replaceChildren(buildChart({
    points,
    knee,
    ladders,
    policy: state.policy,
    onPick: applyPolicy,
  }));

  el.tableStrip.replaceChildren(...fidelity.perTable.map((t) => h('div', {},
    h('span', { class: 'label', text: t.label }),
    h('span', {
      class: `value${t.dead || t.tvd > 0.25 ? ' is-bad' : t.tvd > 0.08 ? ' is-caution' : ''}`,
      text: t.dead ? 'cannot publish' : `${Math.round((1 - t.tvd) * 100)}%`,
    }))));

  el.recHeading.textContent = !fixTarget ? 'Recommended'
    : applied ? 'Recommended — applied' : 'Recommended — not yet applied';
  el.kneeK.textContent = knee ? `k = ${knee.k}` : 'None';
  el.kneeDescription.textContent = knee
    ? `${Math.round(knee.fidelity * 100)}% of the published statistics would survive if you published ${knee.description.toLowerCase()}.`
    : 'No generalization reaches a larger group without destroying a table you declared for release. Narrow the attacker model, drop a table from the release, or do not publish row-level data at all.';
  el.searchNote.textContent = `Evaluated ${search.evaluated} of ${search.total} possible generalization policies in this tab, discarded every one that would destroy a declared table, then kept the least destructive route to each group size.`;

  // ── Limits ──
  const qiNames = state.qis.map((c) => SHORT[c].toLowerCase()).join(', ');
  el.attackerLine.textContent = `Someone at the same school who already recognizes ${qiNames} — a classmate, a parent, a teacher.`;

  const homCount = homogeneous.length;
  const homSentence = homCount === 0
    ? 'No group here answers the sensitive question identically.'
    : `${homCount} ${homCount === 1 ? 'group here answers' : 'groups here answer'} the sensitive question identically.`;

  const limits = [
    'It cannot know what the attacker actually knows. It only reports the model you declared above.',
    'It does not cover free-text answers, timestamps read as attendance, or anything about these students published elsewhere.',
    `A group can hide who you are and still reveal what you said. ${homSentence}`,
    'Releasing two versions of the same file, one stricter than the other, can undo all of this.',
    'This is a risk report under a stated set of assumptions. It never says a file is safe.',
  ];
  el.limits.replaceChildren(...limits.map((text, i) => h('div', {
    class: `limit${i === 4 ? ' limit--headline' : ''}`,
  },
  h('span', { class: 'limit__mark', text: String(i + 1).padStart(2, '0') }),
  h('p', { text }))));

  // ── Advisor note ──
  el.advisorNote.textContent = [
    `Under the declared attacker model (${qiNames}), the smallest group in these ${dataset.rows.length} responses contains ${k}${k === 1 ? ' person' : ' people'}.`,
    uniq === 0
      ? 'No row describes exactly one person.'
      : `${uniq} ${uniq === 1 ? 'row still describes' : 'rows still describe'} exactly one person.`,
    `Worst-case re-identification risk is ${formatRisk(riskValue)}, an upper bound: no population roster was supplied, so this figure stands in for both the prosecutor and journalist framings.`,
    `The tables we planned to publish retain ${Math.round(fidelity.fidelity * 100)}% of their original shape.`,
    homCount === 0
      ? 'No group gives a single identical answer to the sensitive question.'
      : `${homCount} ${homCount === 1 ? 'group answers' : 'groups answer'} the sensitive question identically, so an attacker who narrows someone to such a group learns their answer without ever identifying them.`,
    'This is a risk report under a stated set of assumptions, not a guarantee of anonymity.',
  ].join(' ');

  el.provenance.textContent = `${dataset.name} · synthetic, seed ${CONFIG.seed} · generated in this tab · no real student answers`;
}

// ─── Wire up ─────────────────────────────────────────────────────────────────

for (const button of document.querySelectorAll('[data-jump-sheet]')) {
  button.addEventListener('click', jumpToSheet);
}
el.sheetFix.addEventListener('click', () => {
  const { search } = model();
  const target = search.knee || search.frontier[search.frontier.length - 1];
  if (target) applyPolicy({ ...target.policy });
});
el.fixBtn.addEventListener('click', () => {
  const { search } = model();
  const target = search.knee || search.frontier[search.frontier.length - 1];
  if (target) applyPolicy({ ...target.policy });
});
el.sheetReset.addEventListener('click', () => applyPolicy({}));
el.resetBtn.addEventListener('click', () => applyPolicy({}));
el.rowToggle.addEventListener('click', () => setState({ expanded: !state.expanded }));

// Scroll-driven reveals need `animation-timeline: view()`; where it is unsupported the
// elements would otherwise sit at opacity 0 forever.
if (!CSS.supports('animation-timeline: view()')) {
  for (const node of document.querySelectorAll('.reveal')) node.classList.remove('reveal');
}

render();
