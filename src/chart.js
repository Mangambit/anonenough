// The privacy/fidelity frontier plot.
//
// Two scale decisions carry the whole section:
//   • x is logarithmic in k, because the interesting range is 2–70 and a linear axis
//     buries every early point against the origin;
//   • y is fitted to the data range rather than pinned to 0–100%, because surviving
//     fidelity lives around 80–100% and a 0–100% axis renders the curve as a flat line.

const NS = 'http://www.w3.org/2000/svg';
const ACCENT = '#5b93f0';
const RISK = '#ff4d3d';

function el(tag, attrs = {}, ...children) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    node.setAttribute(key, String(value));
  }
  for (const child of children.flat()) {
    if (child == null) continue;
    node.append(typeof child === 'string' || typeof child === 'number' ? String(child) : child);
  }
  return node;
}

const W = 660;
const H = 214;
const PAD_L = 46;
const PAD_R = 18;
const PAD_T = 16;
const PAD_B = 44;

function emptyChart() {
  return el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': 'No publishable policy exists' },
    el('line', { x1: PAD_L, x2: W - PAD_R, y1: H - PAD_B, y2: H - PAD_B, stroke: '#26292d' }),
    el('line', { x1: PAD_L, x2: PAD_L, y1: PAD_T, y2: H - PAD_B, stroke: '#26292d' }),
    el('text', {
      x: (PAD_L + W - PAD_R) / 2, y: H / 2 - 6, 'text-anchor': 'middle',
      'font-family': 'JetBrains Mono, monospace', 'font-size': 12, fill: RISK,
    }, 'NO PUBLISHABLE POLICY EXISTS'),
    el('text', {
      x: (PAD_L + W - PAD_R) / 2, y: H / 2 + 14, 'text-anchor': 'middle',
      'font-family': 'Instrument Sans, sans-serif', 'font-size': 12, fill: '#8b8f94',
    }, 'Every route to a larger group destroys a table you declared for release.'));
}

/**
 * @param {object}   opts
 * @param {Array}    opts.points   frontier points, ascending in k
 * @param {object?}  opts.knee     the recommended point
 * @param {Array}    opts.ladders  ladders in play, used to test which point is applied
 * @param {object}   opts.policy   the policy currently applied
 * @param {Function} opts.onPick   called with a policy when a point is clicked
 */
export function buildChart({ points, knee, ladders, policy, onPick }) {
  if (!points.length) return emptyChart();

  const maxK = Math.max(...points.map((p) => p.k), 2);
  const fLo = Math.max(0, Math.floor((Math.min(...points.map((p) => p.fidelity)) - 0.04) * 20) / 20);
  const span = Math.max(1 - fLo, 0.05);

  const sx = (k) => PAD_L + (Math.log(k) / Math.log(maxK)) * (W - PAD_L - PAD_R);
  const sy = (f) => PAD_T + (1 - (f - fLo) / span) * (H - PAD_T - PAD_B);

  const gridlines = [0, 1 / 3, 2 / 3, 1].map((r, i) => {
    const f = fLo + r * span;
    return el('g', {},
      el('line', { x1: PAD_L, x2: W - PAD_R, y1: sy(f), y2: sy(f), stroke: i === 3 ? '#26292d' : '#191c1f' }),
      el('text', {
        x: PAD_L - 10, y: sy(f) + 4, 'text-anchor': 'end',
        'font-family': 'JetBrains Mono, monospace', 'font-size': 10, fill: '#4e5359',
      }, `${Math.round(f * 100)}%`));
  });

  const linePath = points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.k).toFixed(1)} ${sy(p.fidelity).toFixed(1)}`).join(' ');
  const areaPath = `M${sx(points[0].k)} ${sy(fLo)}`
    + points.map((p) => ` L${sx(p.k).toFixed(1)} ${sy(p.fidelity).toFixed(1)}`).join('')
    + ` L${sx(points[points.length - 1].k)} ${sy(fLo)} Z`;

  const dots = points.map((p) => {
    const isKnee = !!knee && p.k === knee.k && p.fidelity === knee.fidelity;
    const applied = ladders.length > 0 && ladders.every((l) => (policy[l.column] || 0) === (p.policy[l.column] || 0));

    const group = el('g', {
      class: 'dot-group',
      role: 'button',
      tabindex: '0',
      'aria-label': `Apply the policy that reaches a smallest group of ${p.k}, keeping ${Math.round(p.fidelity * 100)}% of the declared statistics`,
    },
      // A generous invisible hit area — the visible dot is only 3.5px.
      el('circle', { cx: sx(p.k), cy: sy(p.fidelity), r: 14, fill: 'transparent' }),
      applied ? el('circle', { cx: sx(p.k), cy: sy(p.fidelity), r: 9, fill: 'none', stroke: ACCENT, 'stroke-opacity': 0.35 }) : null,
      isKnee
        ? el('rect', {
          x: sx(p.k) - 5.5, y: sy(p.fidelity) - 5.5, width: 11, height: 11, fill: ACCENT,
          transform: `rotate(45 ${sx(p.k)} ${sy(p.fidelity)})`,
        })
        : el('circle', {
          cx: sx(p.k), cy: sy(p.fidelity), r: applied ? 5 : 3.5,
          fill: applied ? ACCENT : '#0f1113', stroke: applied ? ACCENT : '#5c6167', 'stroke-width': 1.3,
        }),
      el('text', {
        x: sx(p.k), y: H - PAD_B + 18, 'text-anchor': 'middle',
        'font-family': 'JetBrains Mono, monospace', 'font-size': 10.5, fill: isKnee ? ACCENT : '#5c6167',
      }, `k=${p.k}`));

    const pick = () => onPick({ ...p.policy });
    group.addEventListener('click', pick);
    group.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
    });
    return group;
  });

  return el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': 'Privacy bought against surviving statistics' },
    el('defs', {}, el('linearGradient', { id: 'ae-fill', x1: '0', y1: '0', x2: '0', y2: '1' },
      el('stop', { offset: '0%', 'stop-color': ACCENT, 'stop-opacity': 0.16 }),
      el('stop', { offset: '100%', 'stop-color': ACCENT, 'stop-opacity': 0 }))),
    gridlines,
    el('path', { d: areaPath, fill: 'url(#ae-fill)' }),
    el('path', { d: linePath, fill: 'none', stroke: '#6e747a', 'stroke-width': 1.4 }),
    el('line', { x1: PAD_L, x2: PAD_L, y1: PAD_T, y2: H - PAD_B, stroke: '#26292d' }),
    dots,
    el('text', { x: 0, y: H - 6, 'font-family': 'JetBrains Mono, monospace', 'font-size': 10, 'letter-spacing': '0.1em', fill: '#4e5359' }, 'SMALLEST GROUP →'),
    el('text', { x: 0, y: 10, 'font-family': 'JetBrains Mono, monospace', 'font-size': 10, 'letter-spacing': '0.1em', fill: '#4e5359' }, 'STATISTICS KEPT'));
}
