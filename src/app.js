// AnonEnough — state and rendering.
//
// Everything below the engine is presentation. The engine (src/engine.js) is pure and
// tested; this file owns the DOM, the memoization keys and the two animations.
//
// The page renders a *dataset descriptor* — order, labels, attacker-model candidates,
// ladders, declared tables, provenance. The demo file and an uploaded CSV both arrive
// through the same shape, so nothing downstream knows or cares which one is loaded.

import { COL, ORDER, QI_CANDIDATES, SHORT } from './schema.js';
import { generateSurvey } from './survey.js';
import { parseCsv } from './csv.js';
import { inferDescriptor } from './infer.js';
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

const CONFIG = {
  seed: 4207,
  rosterSize: 820,
  responseRate: 0.52,
  defaultSheet: 'anonymized', // 'original' | 'anonymized' | 'diff'
  rowsVisible: 14,
};

// The exhaustive lattice search is O(policies × rows); above this many active
// attacker columns it stops being instant, and the page refuses to pretend.
const MAX_ACTIVE_QIS = 6;

// Crafted column widths for the demo file; uploads get computed even widths.
// Every data column is flexible so slack spreads across all of them — a single
// fr track would hand the whole surplus to Activity and leave "Band" adrift in
// a 600px cell.
const DEMO_COLS = '44px minmax(72px, 0.7fr) minmax(76px, 0.7fr) minmax(150px, 1.5fr) '
  + 'minmax(100px, 0.9fr) minmax(104px, 0.95fr) minmax(84px, 0.8fr) minmax(92px, 0.85fr) 104px';

// Grade + Activity + Homeroom, not Age. Age and Grade are near-redundant, and the ±1
// year of jitter in the roster mints singleton classes that no generalization can clear —
// which would make every recommendation a column deletion.
const DEFAULT_QIS = [COL.grade, COL.activity, COL.homeroom];

const demoDescriptor = {
  kind: 'demo',
  generic: false,
  dataset: generateSurvey(CONFIG.seed, CONFIG.rosterSize, CONFIG.responseRate),
  order: ORDER,
  short: SHORT,
  qiCandidates: QI_CANDIDATES,
  initialQis: DEFAULT_QIS,
  sensitive: COL.vaped,
  sensitiveOptions: [COL.vaped, COL.safe],
  directIds: [],
  notices: [],
  tablesFor: (sensitive) => [
    { label: 'Sleep by grade', groupBy: COL.grade, breakdownBy: COL.sleep },
    { label: 'Sleep by age', groupBy: COL.age, breakdownBy: COL.sleep },
    { label: 'Sensitive answer by activity', groupBy: COL.activity, breakdownBy: sensitive },
  ],
  ladderFor,
  provenance: `survey-responses.csv · synthetic, seed ${CONFIG.seed} · generated in this tab · no real student answers`,
};

const state = {
  desc: demoDescriptor,
  version: 0, // bumped on every dataset change; part of every memo key
  sensitive: demoDescriptor.sensitive,
  qis: [...DEFAULT_QIS],
  policy: {},
  selected: null,
  sheet: CONFIG.defaultSheet,
  expanded: false,
  phase: 'idle', // 'idle' | 'strike' | 'in'
  diff: null,
  disp: null, // tweened metric values
  flash: null, // transient status-line message (upload errors, caps)
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
  notices: $('[data-notices]'),
  qiChips: $('[data-qi-chips]'),
  sensitive: $('[data-sensitive]'),
  previewPill: $('[data-preview-pill]'),
  sheetFix: $('[data-sheet-fix]'),
  sheetReset: $('[data-sheet-reset]'),
  kBadge: $('[data-k-badge]'),
  canvas: $('.sheet__canvas'),
  sheetPanel: $('.sheet'),
  letters: $('[data-letters]'),
  headers: $('[data-headers]'),
  rows: $('[data-rows]'),
  tabs: $('[data-tabs]'),
  rowToggle: $('[data-row-toggle]'),
  statusLine: $('[data-status-line]'),
  metrics: $('[data-metrics]'),
  metricsCaption: $('[data-metrics-caption]'),
  sentence: $('[data-sentence]'),
  fixBtn: $('[data-fix-btn]'),
  resetBtn: $('[data-reset-btn]'),
  fixDescription: $('[data-fix-description]'),
  chart: $('[data-chart]'),
  tableStrip: $('[data-table-strip]'),
  tablesHeading: $('[data-tables-heading]'),
  recHeading: $('[data-rec-heading]'),
  kneeK: $('[data-knee-k]'),
  kneeDescription: $('[data-knee-description]'),
  searchNote: $('[data-search-note]'),
  attackerLine: $('[data-attacker-line]'),
  limits: $('[data-limits]'),
  advisorNote: $('[data-advisor-note]'),
  provenance: $('[data-provenance]'),
  fileInput: $('[data-file-input]'),
};

// Spreadsheet column letters: A…Z, then AA, AB…
function colLetter(i) {
  let s = '';
  let n = i;
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}

// ─── Memoized model ──────────────────────────────────────────────────────────

let cachedModel = null;
let cachedSearch = null;

function model() {
  const dataset = state.desc.dataset;
  const key = `${state.version}#${state.sensitive}#${state.qis.join('|')}#${JSON.stringify(state.policy)}`;
  if (cachedModel && cachedModel.key === key) return cachedModel;

  const tables = state.desc.tablesFor(state.sensitive);
  const ladders = state.qis.map((c) => state.desc.ladderFor(c));
  const classes = computeClasses(dataset, ladders, state.policy);
  const base = computeClasses(dataset, ladders, {});
  const fidelity = computeFidelity(dataset, ladders, state.policy, tables);

  // The lattice search is the expensive step and does not depend on the applied policy,
  // so it only reruns when the declared attacker model (or the dataset) changes.
  const searchKey = `${state.version}#${state.sensitive}#${state.qis.join('|')}`;
  if (!cachedSearch || cachedSearch.key !== searchKey) {
    cachedSearch = {
      key: searchKey,
      value: searchFrontier(dataset, ladders, tables, undefined, state.desc.short),
    };
  }

  cachedModel = {
    key,
    tables,
    ladders,
    classes,
    base,
    fidelity,
    search: cachedSearch.value,
    homogeneous: homogeneousClasses(dataset, classes.classes, state.sensitive),
  };
  return cachedModel;
}

function selectedRow(m) {
  if (state.selected != null) return state.selected;
  const firstUnique = m.base.classes.find((c) => c.size === 1);
  return firstUnique ? firstUnique.rowIndices[0] : 0;
}

// Column distributions only change when the dataset does, so bar heights are
// computed once per dataset and only their colour reacts to state.
const histogramCache = new Map();
function histogram(column) {
  const cacheKey = `${state.version}:${column}`;
  if (histogramCache.has(cacheKey)) return histogramCache.get(cacheKey);
  const counts = new Map();
  for (const row of state.desc.dataset.rows) counts.set(row[column], (counts.get(row[column]) || 0) + 1);
  const values = [...counts.entries()]
    .sort((a, b) => String(a[0]).localeCompare(String(b[0]), undefined, { numeric: true }));
  const max = Math.max(...values.map((v) => v[1]));
  const bars = values.slice(0, 9).map(([, n]) => Math.max(2, Math.round((n / max) * 14)));
  histogramCache.set(cacheKey, bars);
  return bars;
}

// ─── Actions ─────────────────────────────────────────────────────────────────

let strikeTimer;
let settleTimer;
let flashTimer;

function setState(patch) {
  Object.assign(state, patch);
  render();
}

function flash(message) {
  clearTimeout(flashTimer);
  setState({ flash: message });
  flashTimer = setTimeout(() => setState({ flash: null }), 4500);
}

function applyPolicy(next) {
  const m = model();
  const rowIndex = selectedRow(m);
  const before = attackerSentence(state.desc.dataset, m.ladders, state.policy, m.classes, rowIndex, state.desc);

  const nextClasses = computeClasses(state.desc.dataset, m.ladders, next);
  const after = attackerSentence(state.desc.dataset, m.ladders, next, nextClasses, rowIndex, state.desc);

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
  const adding = !state.qis.includes(column);
  if (adding && state.qis.length >= MAX_ACTIVE_QIS) {
    flash(`The exhaustive search stays honest up to ${MAX_ACTIVE_QIS} attacker columns — drop one before adding another.`);
    return;
  }
  const qis = adding ? [...state.qis, column] : state.qis.filter((c) => c !== column);
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

// ─── Loading a file ──────────────────────────────────────────────────────────

function adoptDescriptor(desc) {
  clearTimeout(strikeTimer);
  clearTimeout(settleTimer);
  cachedModel = null;
  cachedSearch = null;
  setState({
    desc,
    version: state.version + 1,
    sensitive: desc.sensitive,
    qis: [...desc.initialQis],
    policy: {},
    selected: null,
    sheet: desc.kind === 'upload' ? 'original' : CONFIG.defaultSheet,
    expanded: false,
    phase: 'idle',
    diff: null,
    flash: null,
  });
  jumpToSheet();
}

async function loadFile(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = parseCsv(text);
    adoptDescriptor(inferDescriptor(parsed, file.name));
  } catch (err) {
    flash(`Could not audit ${file.name}: ${err && err.message ? err.message : err}`);
  }
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
  const desc = state.desc;
  const dataset = desc.dataset;
  const { tables, ladders, classes, base, fidelity, search, homogeneous } = m;
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
  el.filename.textContent = `${dataset.name} — ${dataset.rows.length} rows · ${desc.order.length} columns`;

  el.canvas.style.setProperty('--sheet-cols', desc.kind === 'demo'
    ? DEMO_COLS
    : `44px repeat(${desc.order.length}, minmax(110px, 1fr)) 96px`);
  el.canvas.style.minWidth = desc.kind === 'demo' ? '830px' : `${140 + desc.order.length * 110}px`;

  // ── Notices (inference judgment calls, stated where they can be argued with) ──
  const noticeItems = desc.notices.map((text) => h('div', { class: 'notice' },
    h('span', { class: 'notice__mark', text: '!' }), h('p', { text })));
  if (desc.kind === 'upload') {
    noticeItems.push(h('div', { class: 'notice notice--action' },
      h('p', { text: 'This file was read locally. Reloading the page forgets it entirely.' }),
      h('button', {
        type: 'button', class: 'notice__btn', text: 'Return to the demo file',
        onclick: () => adoptDescriptor(demoDescriptor),
      })));
  }
  el.notices.replaceChildren(...noticeItems);
  el.notices.hidden = noticeItems.length === 0;

  el.qiChips.replaceChildren(...desc.qiCandidates.map((c) => h('button', {
    type: 'button',
    class: 'qi-chip',
    'aria-pressed': String(state.qis.includes(c)),
    title: c,
    text: desc.short[c],
    onclick: () => toggleQi(c),
  })));

  el.sensitive.replaceChildren(...desc.sensitiveOptions.map((c) => h('option', {
    value: c, selected: c === state.sensitive || null, text: desc.short[c],
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
    ...desc.order.map((c, i) => h('div', {
      class: state.qis.includes(c) ? 'is-qi' : '',
      text: colLetter(i),
    })),
    h('div', { class: 'is-sum', text: 'Σ' }),
  );

  el.headers.replaceChildren(
    h('div', { class: 'head is-spacer' }),
    ...desc.order.map((c) => {
      const isQi = state.qis.includes(c);
      const isId = desc.directIds.includes(c);
      const removed = isId && sheet !== 'original';
      const changed = sheet !== 'original' && !!levelByCol[c] && (effPolicy[c] || 0) > 0;
      return h('div', {
        class: `head${isQi ? ' is-qi' : ''}${changed ? ' is-changed' : ''}${removed ? ' is-removed' : ''}`,
        title: c,
      },
      h('div', { class: 'spark' }, desc.qiCandidates.includes(c)
        ? histogram(c).map((height) => h('i', { style: `height:${height}px` }))
        : []),
      h('div', { class: 'head__label', text: desc.short[c] }));
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

    const cells = desc.order.map((c) => {
      const level = levelByCol[c];
      const raw = String(row[c] != null ? row[c] : '');
      const isId = desc.directIds.includes(c);
      const idRemoved = isId && sheet !== 'original';
      const generalized = idRemoved ? '∗' : level ? level.apply(raw) : raw;
      const changed = (idRemoved || (!!level && generalized !== raw)) && sheet !== 'original';
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
  el.statusLine.textContent = state.flash ? state.flash
    : sheet === 'original'
      ? `${base.uniqueRows} of ${dataset.rows.length} rows describe exactly one person`
      : previewing
        ? `Would leave ${effClasses.uniqueRows} of ${dataset.rows.length} rows describing one person · smallest group ${effClasses.k}`
        : `${uniq} of ${dataset.rows.length} rows describe exactly one person · smallest group ${k}`;
  el.statusLine.parentElement.classList.toggle('is-alarm', !!state.flash || uniqueShown > 0);

  // ── Metrics ──
  const metricDefs = [
    {
      label: 'Smallest group',
      note: alarm
        ? 'At least one row still describes exactly one person.'
        : `Every row shares its answers with at least ${k - 1} others.`,
    },
    {
      label: 'Rows describing one person',
      note: `Out of ${dataset.rows.length} responses in the file.`,
    },
    {
      label: 'Worst-case re-identification',
      note: 'Prosecutor framing: 1/k within this file, as an upper bound.',
    },
    {
      // On an upload nobody declared anything — inference guessed the tables,
      // so the label must not borrow the authority of the word "declared".
      label: desc.kind === 'demo' ? 'Published tables surviving' : 'Assumed tables surviving',
      note: desc.kind === 'demo'
        ? `Averaged across the ${tables.length} tables declared for release.`
        : `Averaged across ${tables.length} tables this tool assumed you would publish. It has no way to know the real ones.`,
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
    // Both label and note: the fourth metric renames itself between the demo
    // ("Published tables") and an upload ("Assumed tables"), and updating only
    // the note left the old label asserting something the upload cannot claim.
    metricDefs.forEach((def, i) => {
      el.metrics.children[i].firstElementChild.textContent = def.label;
      el.metrics.children[i].lastElementChild.textContent = def.note;
    });
  }

  // The sheet can be previewing the recommended fix while these numbers still
  // describe the unfixed file. Two states, one screen — say so outright rather
  // than leaving a small pill to carry it.
  el.metricsCaption.hidden = !previewing;
  el.metricsCaption.textContent = previewing
    ? 'These four numbers describe the file as it stands today. The sheet above is previewing the recommended fix — nothing has been applied yet.'
    : '';

  tweenTargets = { k, risk: riskValue, fid: fidelity.fidelity * 100, uniq };
  paintMetrics(state.disp || { k: 0, risk: 0, fid: 0, uniq: 0 }, view);
  tween(view);

  // ── The sentence ──
  const currentSentence = attackerSentence(dataset, ladders, state.policy, classes, rowIndex, desc);
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

  el.tablesHeading.textContent = desc.kind === 'demo'
    ? 'Tables declared for release — under the policy currently applied'
    : 'Tables this tool assumed you would publish — under the policy currently applied';

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
    // Not lowercased: an uploaded file's columns are proper names, and
    // "if you published years at company → removed" reads like a typo.
    ? `${Math.round(knee.fidelity * 100)}% of the published statistics would survive if you published ${knee.description}.`
    : 'No generalization reaches a larger group without destroying a table you declared for release. Narrow the attacker model, drop a table from the release, or do not publish row-level data at all.';
  el.searchNote.textContent = `Evaluated ${search.evaluated} of ${search.total} possible generalization policies in this tab, discarded every one that would destroy a declared table, then kept the least destructive route to each group size.`;

  // ── Limits ──
  const qiNames = state.qis.map((c) => desc.short[c].toLowerCase()).join(', ');
  el.attackerLine.textContent = `Someone who already recognizes ${qiNames} — for a school survey: a classmate, a parent, a teacher.`;

  const homCount = homogeneous.length;
  const homSentence = homCount === 0
    ? 'No group here answers the sensitive question identically.'
    : `${homCount} ${homCount === 1 ? 'group here answers' : 'groups here answer'} the sensitive question identically.`;

  const limits = [
    'It cannot know what the attacker actually knows. It only reports the model you declared above.',
    'It does not cover free-text answers, timestamps read as attendance, or anything about these people published elsewhere.',
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
    // Naming the framing precisely matters: 1/k over the SAMPLE is the
    // prosecutor figure. Journalist risk is defined against population
    // class sizes, and no roster was supplied — so it is not computed here
    // rather than quietly assumed equal.
    `Worst-case re-identification risk is ${formatRisk(riskValue)} — the prosecutor figure, 1/k measured within this file. Journalist risk needs the size of each group in the full population, which was not supplied, so it is not reported. Because the file is a subset of a larger roster, journalist risk would be no higher than this.`,
    `The tables we planned to publish retain ${Math.round(fidelity.fidelity * 100)}% of their original shape.`,
    homCount === 0
      ? 'No group gives a single identical answer to the sensitive question.'
      : `${homCount} ${homCount === 1 ? 'group answers' : 'groups answer'} the sensitive question identically, so an attacker who narrows someone to such a group learns their answer without ever identifying them.`,
    'This is a risk report under a stated set of assumptions, not a guarantee of anonymity.',
  ].join(' ');

  el.provenance.textContent = desc.provenance;
}

// ─── Wire up ─────────────────────────────────────────────────────────────────

for (const button of document.querySelectorAll('[data-jump-sheet]')) {
  button.addEventListener('click', jumpToSheet);
}
for (const button of document.querySelectorAll('[data-upload-trigger]')) {
  button.addEventListener('click', () => el.fileInput.click());
}
el.fileInput.addEventListener('change', () => {
  loadFile(el.fileInput.files[0]);
  el.fileInput.value = ''; // allow re-selecting the same file
});

// Drag a CSV anywhere onto the sheet. The overlay copy carries the promise that
// matters: the file is read in this tab and goes nowhere.
let dragDepth = 0;
el.sheetPanel.addEventListener('dragenter', (e) => {
  e.preventDefault();
  dragDepth++;
  el.sheetPanel.classList.add('is-drop');
});
el.sheetPanel.addEventListener('dragover', (e) => e.preventDefault());
el.sheetPanel.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) el.sheetPanel.classList.remove('is-drop');
});
el.sheetPanel.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  el.sheetPanel.classList.remove('is-drop');
  const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) loadFile(file);
});

el.sensitive.addEventListener('change', () => {
  setState({ sensitive: el.sensitive.value, phase: 'idle', diff: null });
});

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
