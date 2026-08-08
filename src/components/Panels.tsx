import type { SensitivityEntry } from '../lib/anonymize';
import type { RiskResult } from '../lib/risk';
import { formatRisk } from '../lib/risk';
import type { FrontierPoint, SearchResult } from '../lib/search';

/**
 * The supporting panels.
 *
 * House rules, applied everywhere below:
 *   · every number is shown with the assumption it depends on, in the same
 *     field of view — a figure whose provenance lives in a README is a figure
 *     that cannot be defended when someone asks about it out loud
 *   · the limitations panel is never collapsible; a caveat you can dismiss is
 *     decoration
 *   · the word "safe" does not appear
 */

export function Panel({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--rule)',
        padding: 16,
        marginBottom: 16,
      }}
    >
      <h2 className="label" style={{ marginBottom: note ? 4 : 12 }}>
        {title}
      </h2>
      {note && (
        <p style={{ fontSize: 12, color: 'var(--ink-tertiary)', margin: '0 0 12px' }}>{note}</p>
      )}
      {children}
    </section>
  );
}

/** Two risk framings side by side, each carrying its own assumption. */
export function RiskPanel({ risk }: { risk: RiskResult }) {
  return (
    <Panel title="Worst-case re-identification risk" note="For the most exposed person, not the average one.">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Stat
          value={formatRisk(risk.prosecutor)}
          label="Prosecutor"
          detail="if they already know the person answered"
          tone={risk.prosecutor >= 0.5 ? 'alarm' : 'neutral'}
        />
        <Stat
          value={risk.journalist === null ? '—' : formatRisk(risk.journalist)}
          label="Journalist"
          detail={
            risk.journalistIsUpperBound
              ? 'no roster supplied — upper bound only'
              : 'if they do not know whether they answered'
          }
          tone={risk.journalist !== null && risk.journalist >= 0.5 ? 'alarm' : 'neutral'}
        />
      </div>
      <p style={{ fontSize: 12, color: 'var(--ink-tertiary)', margin: '12px 0 0' }}>
        Smallest group: <strong className="mono">{risk.k}</strong>
        {risk.populationK !== null && (
          <>
            {' '}
            in the survey, <strong className="mono">{risk.populationK}</strong> in the school
          </>
        )}
        . Prosecutor risk is 1 ÷ smallest group size.
      </p>
    </Panel>
  );
}

function Stat({
  value,
  label,
  detail,
  tone,
}: {
  value: string;
  label: string;
  detail: string;
  tone: 'alarm' | 'neutral';
}) {
  return (
    <div>
      <div
        className="mono"
        style={{
          fontSize: 30,
          fontWeight: 600,
          lineHeight: 1.1,
          color: tone === 'alarm' ? 'var(--alarm)' : 'var(--ink)',
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 12, color: 'var(--ink-tertiary)' }}>{detail}</div>
    </div>
  );
}

/**
 * The privacy / usefulness frontier.
 *
 * Every dot is the best available fix for one privacy target: the one that costs
 * the least of what you were going to publish. The amber ring is the knee —
 * where buying more privacy starts costing disproportionately more accuracy.
 */
export function FrontierChart({
  search,
  onApply,
  activePolicyKey,
}: {
  search: SearchResult;
  onApply: (point: FrontierPoint) => void;
  activePolicyKey: string;
}) {
  const points = search.frontier;
  if (points.length === 0) {
    return (
      <Panel title="Privacy vs. what survives">
        <p style={{ fontSize: 13, color: 'var(--ink-tertiary)', margin: 0 }}>
          No combination of these columns reaches the privacy targets. Declare fewer
          quasi-identifiers, or accept that this table cannot be published as-is.
        </p>
      </Panel>
    );
  }

  const width = 320;
  const height = 150;
  const pad = { left: 34, right: 12, top: 10, bottom: 26 };
  const maxK = Math.max(...points.map((p) => p.k));
  const x = (k: number) =>
    pad.left + (Math.log(k) / Math.log(Math.max(maxK, 2))) * (width - pad.left - pad.right);
  const y = (f: number) => pad.top + (1 - f) * (height - pad.top - pad.bottom);

  return (
    <Panel
      title="Privacy vs. what survives"
      note={`Searched ${search.evaluated} of ${search.total} possible fixes${search.exhaustive ? ' — all of them' : ''}.`}
    >
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Privacy versus fidelity frontier">
        <line x1={pad.left} y1={y(1)} x2={width - pad.right} y2={y(1)} stroke="var(--rule)" />
        <line x1={pad.left} y1={pad.top} x2={pad.left} y2={height - pad.bottom} stroke="var(--rule)" />
        <polyline
          points={points.map((p) => `${x(p.k)},${y(p.fidelity)}`).join(' ')}
          fill="none"
          stroke="var(--ink-tertiary)"
          strokeWidth={1}
        />
        {points.map((point) => {
          const isKnee = search.knee?.policy && samePolicy(point, search.knee);
          const isActive = policyKeyOf(point) === activePolicyKey;
          return (
            <g key={point.target} onClick={() => onApply(point)} style={{ cursor: 'pointer' }}>
              <circle
                cx={x(point.k)}
                cy={y(point.fidelity)}
                r={isActive ? 6 : 4}
                fill={isActive ? 'var(--resolved)' : 'var(--ink)'}
              />
              {isKnee && (
                <circle
                  cx={x(point.k)}
                  cy={y(point.fidelity)}
                  r={9}
                  fill="none"
                  stroke="var(--marker)"
                  strokeWidth={2}
                />
              )}
              <title>
                {`k = ${point.k}, ${(point.fidelity * 100).toFixed(1)}% of your tables survive — ${point.description}`}
              </title>
            </g>
          );
        })}
        <text x={pad.left} y={height - 8} fontSize={9} fill="var(--ink-tertiary)">
          smallest group (k) →
        </text>
        <text x={2} y={pad.top + 4} fontSize={9} fill="var(--ink-tertiary)">
          100%
        </text>
      </svg>
      <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0 }}>
        {points.map((point) => (
          <li key={point.target} style={{ marginBottom: 4 }}>
            <button
              onClick={() => onApply(point)}
              style={{
                width: '100%',
                textAlign: 'left',
                background: policyKeyOf(point) === activePolicyKey ? 'var(--resolved-wash)' : 'none',
                border: '1px solid var(--rule)',
                padding: '6px 8px',
                fontSize: 12,
              }}
            >
              <span className="mono" style={{ fontWeight: 600 }}>
                k ≥ {point.k}
              </span>
              <span style={{ color: 'var(--ink-tertiary)' }}>
                {' '}
                · {(point.fidelity * 100).toFixed(1)}% survives ·{' '}
              </span>
              {point.description}
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function policyKeyOf(point: { policy: Record<string, number> }): string {
  return Object.entries(point.policy)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([column, level]) => `${column}:${level}`)
    .join('|');
}

function samePolicy(a: { policy: Record<string, number> }, b: { policy: Record<string, number> }) {
  return policyKeyOf(a) === policyKeyOf(b);
}

/**
 * What happens if the assumption about the attacker is wrong by one column.
 * This is the panel that turns a single k into an honest range of outcomes.
 */
export function SensitivityPanel({ entries }: { entries: SensitivityEntry[] }) {
  if (entries.length === 0) return null;
  return (
    <Panel
      title="If you guessed wrong about what they know"
      note="Nothing here can know what an attacker actually knows. This shows how far the answer moves if your assumption is off by one column."
    >
      <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
        <tbody>
          {entries.map((entry) => (
            <tr key={`${entry.change}-${entry.column}`}>
              <td style={{ padding: '4px 0', color: 'var(--ink-secondary)' }}>
                {entry.change === 'add' ? 'they also know' : 'they do not know'}{' '}
                <strong style={{ color: 'var(--ink)' }}>{shortColumn(entry.column)}</strong>
              </td>
              <td className="mono" style={{ padding: '4px 0', textAlign: 'right' }}>
                k = {entry.k}
              </td>
              <td
                className="mono"
                style={{
                  padding: '4px 0 4px 12px',
                  textAlign: 'right',
                  color: entry.uniqueRows > 0 ? 'var(--alarm)' : 'var(--ink-tertiary)',
                  whiteSpace: 'nowrap',
                }}
              >
                {entry.uniqueRows} alone
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

/** Survey headers are full questions; the panels need something readable. */
export function shortColumn(column: string): string {
  const map: Record<string, string> = {
    'How old are you?': 'age',
    'What grade are you in?': 'grade',
    'What is your main after-school activity?': 'activity',
    'Which homeroom are you in?': 'homeroom',
    'On a school night, how many hours do you sleep?': 'sleep',
    'Do you feel safe at school?': 'safety answer',
    'Have you ever been offered a vape?': 'vaping answer',
    'Your name': 'name',
  };
  return map[column] ?? column;
}

/**
 * The limitations panel. Always visible, never collapsible.
 *
 * A tool that reports privacy numbers without stating what it does not model is
 * worse than no tool, because it converts an unknown risk into false comfort.
 */
export function ThreatModelPanel({
  quasiIdentifiers,
  k,
  entropyL,
  worstAnswer,
  onHighlightWorst,
}: {
  quasiIdentifiers: string[];
  k: number;
  entropyL: number;
  worstAnswer: { size: number; topCount: number; topValue: string } | null;
  onHighlightWorst: () => void;
}) {
  const share = worstAnswer ? Math.round((worstAnswer.topCount / worstAnswer.size) * 100) : 0;
  return (
    <section
      style={{
        background: 'var(--panel)',
        border: '1px solid var(--rule-strong)',
        borderLeft: '3px solid var(--ink)',
        padding: 16,
        fontSize: 12,
        lineHeight: 1.55,
      }}
    >
      <h2 className="label" style={{ marginBottom: 8 }}>
        What this assumes, and what it does not cover
      </h2>
      <p style={{ margin: '0 0 8px' }}>
        <strong>Assumed attacker:</strong> someone at the school who knows a person's{' '}
        {quasiIdentifiers.length ? quasiIdentifiers.map(shortColumn).join(', ') : '(nothing selected)'}.
        The prosecutor figure additionally assumes they know the person answered at all.
      </p>
      <p style={{ margin: '0 0 8px' }}>
        <strong>Not modelled:</strong> free-text answers, submission timestamps, anything joined
        from another published list, and any knowledge beyond the columns above.
      </p>
      <p style={{ margin: '0 0 8px' }}>
        <strong>k protects identity, not answers.</strong> Narrowing someone to a group whose
        answers all look alike reveals their answer without ever naming them.{' '}
        {worstAnswer ? (
          <>
            Worst group here:{' '}
            <button
              onClick={onHighlightWorst}
              style={{
                background: share >= 75 ? 'var(--alarm-wash)' : 'transparent',
                border: `1px solid ${share >= 75 ? 'var(--alarm)' : 'var(--rule-strong)'}`,
                color: share >= 75 ? 'var(--alarm)' : 'var(--ink)',
                padding: '1px 6px',
                fontWeight: 600,
              }}
            >
              {worstAnswer.topCount} of {worstAnswer.size} said "{worstAnswer.topValue}"
            </button>{' '}
            — guessing that is right {share}% of the time (entropy l-diversity{' '}
            <span className="mono">{entropyL.toFixed(2)}</span>).
          </>
        ) : (
          <span style={{ color: 'var(--ink-tertiary)' }}>Not measurable here.</span>
        )}
      </p>
      <p style={{ margin: 0, fontWeight: 600 }}>
        Strongest claim available: every group has at least{' '}
        <span className="mono">{k}</span> {k === 1 ? 'person' : 'people'} in it, under the model
        above. That is a risk measurement, not a guarantee of anonymity.
      </p>
    </section>
  );
}
