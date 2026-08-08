import { useCallback, useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';

import { computeClasses, sensitivitySweep } from './lib/anonymize';
import { computeDiversity } from './lib/diversity';
import { computeRisk } from './lib/risk';
import { advisorNote, attackerSentence } from './lib/sentence';
import { computeFidelity } from './lib/tvd';
import { searchFrontier } from './lib/search';
import type { FrontierPoint } from './lib/search';
import { COL, generateRoster, generateSurvey, handCheckSample, toCsv } from './lib/generate';
import type { Dataset, Policy } from './lib/types';

import {
  ANSWER_COLUMNS,
  CANDIDATE_QUASI_IDENTIFIERS,
  DEFAULT_QUASI_IDENTIFIERS,
  DEMO_SEED,
  K_TARGETS,
  PHRASING,
  REPORT_TABLES,
  SENSITIVE_COLUMN,
  SUBJECT_NOUN,
  buildLadders,
} from './config/demo';

import { DataTable } from './components/DataTable';
import { Sentence } from './components/Sentence';
import {
  FrontierChart,
  Panel,
  RiskPanel,
  SensitivityPanel,
  ThreatModelPanel,
  shortColumn,
} from './components/Panels';

/**
 * AnonEnough.
 *
 * The app boots into the state a real editor is actually in — a survey export
 * with everyone's name still attached — so that deleting the names is something
 * you watch happen rather than something you are told about. Every number below
 * recomputes from that one action.
 */

type Source = 'demo' | 'sample' | 'uploaded';

export default function App() {
  const [source, setSource] = useState<Source>('demo');
  const [uploaded, setUploaded] = useState<Dataset | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [namesDeleted, setNamesDeleted] = useState(false);
  const [qiColumns, setQiColumns] = useState<string[]>(DEFAULT_QUASI_IDENTIFIERS);
  const [policy, setPolicy] = useState<Policy>({});
  const [selectedRow, setSelectedRow] = useState<number | null>(null);
  const [attackerGuess, setAttackerGuess] = useState<Record<string, string>>({});
  const fileInput = useRef<HTMLInputElement>(null);

  const dataset = useMemo<Dataset>(() => {
    if (source === 'uploaded' && uploaded) return uploaded;
    if (source === 'sample') return handCheckSample();
    return generateSurvey(DEMO_SEED);
  }, [source, uploaded]);

  const population = useMemo(
    () => (source === 'demo' ? generateRoster(DEMO_SEED) : null),
    [source],
  );

  const availableColumns = dataset.columns;
  const activeQis = useMemo(
    () => qiColumns.filter((column) => availableColumns.includes(column)),
    [qiColumns, availableColumns],
  );

  const ladders = useMemo(() => buildLadders(dataset, activeQis), [dataset, activeQis]);

  // A policy carried over from another dataset can reference levels that do not
  // exist here, and the engine now (correctly) refuses those rather than
  // silently analysing something else. Clamp at the boundary instead.
  const safePolicy = useMemo<Policy>(() => {
    const next: Policy = {};
    for (const ladder of ladders) {
      const requested = policy[ladder.column] ?? 0;
      next[ladder.column] = Math.min(Math.max(Math.trunc(requested) || 0, 0), ladder.levels.length - 1);
    }
    return next;
  }, [ladders, policy]);

  const assessed = ladders.length > 0;

  const classResult = useMemo(
    () => computeClasses(dataset, ladders, safePolicy),
    [dataset, ladders, safePolicy],
  );

  const risk = useMemo(
    () => computeRisk(ladders, safePolicy, classResult, population),
    [ladders, safePolicy, classResult, population],
  );

  const fidelity = useMemo(() => {
    const tables = REPORT_TABLES.filter((table) => availableColumns.includes(table.groupBy));
    return computeFidelity(dataset, ladders, safePolicy, tables);
  }, [dataset, ladders, safePolicy, availableColumns]);

  const search = useMemo(() => {
    if (!assessed) return null;
    const tables = REPORT_TABLES.filter((table) => availableColumns.includes(table.groupBy));
    return searchFrontier(dataset, ladders, tables, K_TARGETS);
  }, [assessed, dataset, ladders, availableColumns]);

  const sensitivity = useMemo(() => {
    if (!assessed) return [];
    const candidates = CANDIDATE_QUASI_IDENTIFIERS.filter((c) => availableColumns.includes(c));
    return sensitivitySweep(dataset, ladders, safePolicy, candidates);
  }, [assessed, dataset, ladders, safePolicy, availableColumns]);

  const sensitiveColumn = availableColumns.includes(SENSITIVE_COLUMN)
    ? SENSITIVE_COLUMN
    : (ANSWER_COLUMNS.find((c) => availableColumns.includes(c)) ?? availableColumns[availableColumns.length - 1]);

  /**
   * How predictable the sensitive answer is inside each group.
   *
   * k says nothing about answers. A group of nine that splits eight-to-one is
   * "k-anonymous" and still hands an attacker the answer 89% of the time, so the
   * app reports the worst group by entropy rather than only counting the groups
   * that are perfectly unanimous.
   */
  const diversity = useMemo(
    () => (assessed ? computeDiversity(dataset, classResult, sensitiveColumn) : null),
    [assessed, dataset, classResult, sensitiveColumn],
  );

  const worstAnswer = useMemo(() => {
    const worst = diversity?.worstClass;
    if (!worst || worst.counts.length === 0) return null;
    const top = worst.counts.reduce((a, b) => (b.count > a.count ? b : a));
    return { size: worst.size, topCount: top.count, topValue: top.value };
  }, [diversity]);

  // Default the sentence to the first still-identifiable row, so the finding is
  // on screen without anyone having to hunt for it.
  const focusRow = useMemo(() => {
    if (selectedRow !== null) return selectedRow;
    const firstUnique = classResult.classes.find((c) => c.size === 1);
    return firstUnique ? firstUnique.rowIndices[0] : null;
  }, [selectedRow, classResult]);

  const sentence = useMemo(() => {
    if (focusRow === null || !assessed) return null;
    return attackerSentence(
      dataset,
      ladders,
      safePolicy,
      classResult,
      focusRow,
      PHRASING,
      SUBJECT_NOUN,
    );
  }, [focusRow, assessed, dataset, ladders, safePolicy, classResult]);

  const note = useMemo(
    () =>
      advisorNote({
        k: classResult.k,
        uniqueRows: classResult.uniqueRows,
        prosecutor: `${(risk.prosecutor * 100).toFixed(risk.prosecutor >= 0.1 ? 0 : 1)}%`,
        journalist: risk.journalist === null ? null : `${(risk.journalist * 100).toFixed(1)}%`,
        journalistIsUpperBound: risk.journalistIsUpperBound,
        fidelityPercent: `${(fidelity.fidelity * 100).toFixed(1)}%`,
        worstAnswer,
        quasiIdentifiers: activeQis.map(shortColumn),
        rowCount: dataset.rows.length,
      }),
    [classResult, risk, fidelity, worstAnswer, activeQis, dataset],
  );

  const applyFix = useCallback(
    (point: FrontierPoint) => {
      // Pin whichever row is on screen first. The auto-pick is "the first row
      // that is still one-of-a-kind", and a successful fix removes every such
      // row — so without pinning, the sentence would vanish at exactly the
      // moment it is supposed to change in front of you.
      if (selectedRow === null && focusRow !== null) setSelectedRow(focusRow);
      setPolicy({ ...point.policy });
    },
    [selectedRow, focusRow],
  );

  const recommended = search?.knee ?? null;
  const activePolicyKey = Object.entries(safePolicy)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([column, level]) => `${column}:${level}`)
    .join('|');

  const handleUpload = useCallback((file: File) => {
    setUploadError(null);
    if (file.size > 5 * 1024 * 1024) {
      setUploadError('That file is larger than 5 MB. This runs in your browser, so keep it small.');
      return;
    }
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      complete: (result) => {
        const rows = result.data.filter((row) => Object.keys(row).length > 0);
        const columns = (result.meta.fields ?? []).filter((f) => f && f.trim() !== '');
        if (columns.length === 0 || rows.length === 0) {
          setUploadError('No usable header row and data found in that file.');
          return;
        }
        setUploaded({ columns, rows, label: `${file.name} — never uploaded, parsed in this tab` });
        setSource('uploaded');
        setNamesDeleted(true);
        setQiColumns(columns.filter((c) => DEFAULT_QUASI_IDENTIFIERS.includes(c)));
        setPolicy({});
        setSelectedRow(null);
      },
      error: () => setUploadError('That file could not be parsed as CSV.'),
    });
  }, []);

  const nameColumnPresent = availableColumns.includes(COL.name);
  const visibleColumns = availableColumns.filter(
    (column) => column !== COL.timestamp && (column !== COL.name || !namesDeleted),
  );

  return (
    <div style={{ maxWidth: 1180, margin: '0 auto', padding: '32px 20px 64px' }}>
      <header style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <h1 style={{ fontSize: 26 }}>AnonEnough</h1>
          <p style={{ margin: 0, color: 'var(--ink-secondary)' }}>
            Deleting names is not anonymizing.
          </p>
        </div>
        <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--ink-tertiary)' }}>
          Everything runs in this tab. Your file is never uploaded — turn off your Wi-Fi and it
          still works.
        </p>
      </header>

      {/* The cold open: a survey that still has everyone's name on it. */}
      {nameColumnPresent && !namesDeleted && (
        <div
          style={{
            background: 'var(--panel)',
            border: '1px solid var(--rule-strong)',
            padding: 20,
            marginBottom: 16,
            display: 'flex',
            gap: 16,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ flex: '1 1 320px' }}>
            <h2 style={{ fontSize: 16, marginBottom: 4 }}>
              The school paper is about to publish this survey.
            </h2>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-secondary)' }}>
              It was promised anonymous. The obvious first step is to delete the name column.
            </p>
          </div>
          <button
            onClick={() => setNamesDeleted(true)}
            style={{
              background: 'var(--ink)',
              color: 'var(--paper)',
              border: 0,
              padding: '12px 20px',
              fontWeight: 600,
              fontSize: 15,
            }}
          >
            Delete the names →
          </button>
        </div>
      )}

      {/* Headline finding */}
      {assessed && namesDeleted && (
        <div
          style={{
            background: classResult.uniqueRows > 0 ? 'var(--alarm-wash)' : 'var(--resolved-wash)',
            border: `1px solid ${classResult.uniqueRows > 0 ? 'var(--alarm)' : 'var(--resolved)'}`,
            padding: '14px 18px',
            marginBottom: 16,
          }}
        >
          <strong
            style={{
              color: classResult.uniqueRows > 0 ? 'var(--alarm)' : 'var(--resolved)',
              fontSize: 15,
            }}
          >
            {classResult.uniqueRows > 0
              ? `Names deleted. ${classResult.uniqueRows} ${classResult.uniqueRows === 1 ? 'row' : 'rows'} still ${classResult.uniqueRows === 1 ? 'describes' : 'describe'} exactly one person.`
              : `No row describes exactly one person. Smallest group: ${classResult.k}.`}
          </strong>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.55fr) minmax(280px, 1fr)', gap: 20 }}>
        <main style={{ minWidth: 0 }}>
          {/* The hero: the sentence and the flip */}
          {sentence && (
            <section
              style={{
                background: 'var(--panel)',
                border: '1px solid var(--rule)',
                padding: 20,
                marginBottom: 16,
              }}
            >
              <h2 className="label" style={{ marginBottom: 10 }}>
                What someone could say about this row
              </h2>
              <Sentence text={sentence.text} isUnique={sentence.isUnique} />
              {recommended && (
                <div style={{ marginTop: 16, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <button
                    onClick={() => applyFix(recommended)}
                    disabled={activePolicyKey === policyKeyOfPoint(recommended)}
                    style={{
                      background:
                        activePolicyKey === policyKeyOfPoint(recommended)
                          ? 'var(--resolved-wash)'
                          : 'var(--resolved)',
                      color:
                        activePolicyKey === policyKeyOfPoint(recommended)
                          ? 'var(--resolved)'
                          : '#fff',
                      border: '1px solid var(--resolved)',
                      padding: '10px 16px',
                      fontWeight: 600,
                    }}
                  >
                    {activePolicyKey === policyKeyOfPoint(recommended)
                      ? 'Recommended fix applied'
                      : 'Apply recommended fix'}
                  </button>
                  <button
                    onClick={() => setPolicy({})}
                    style={{
                      background: 'none',
                      border: '1px solid var(--rule-strong)',
                      padding: '10px 16px',
                    }}
                  >
                    Undo
                  </button>
                  <span style={{ fontSize: 12, color: 'var(--ink-tertiary)', alignSelf: 'center' }}>
                    {recommended.description} · keeps{' '}
                    {(recommended.fidelity * 100).toFixed(1)}% of your published tables
                  </span>
                </div>
              )}
            </section>
          )}

          {/* Data source controls */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <SourceButton active={source === 'demo'} onClick={() => resetTo('demo')}>
              Demo survey
            </SourceButton>
            <SourceButton active={source === 'sample'} onClick={() => resetTo('sample')}>
              12-row sample (check it by hand)
            </SourceButton>
            <button
              onClick={() => fileInput.current?.click()}
              style={{ ...sourceButtonStyle, background: 'none' }}
            >
              Drop your own CSV
            </button>
            <input
              ref={fileInput}
              type="file"
              accept=".csv,text/csv"
              style={{ display: 'none' }}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) handleUpload(file);
                event.target.value = '';
              }}
            />
            <button
              onClick={() => downloadCsv(dataset)}
              style={{ ...sourceButtonStyle, background: 'none' }}
            >
              Download this CSV
            </button>
          </div>

          {uploadError && (
            <p
              style={{
                background: 'var(--alarm-wash)',
                border: '1px solid var(--alarm)',
                color: 'var(--alarm)',
                padding: '8px 12px',
                fontSize: 13,
                margin: '0 0 12px',
              }}
            >
              {uploadError}
            </p>
          )}

          {dataset.label && (
            <p style={{ fontSize: 12, color: 'var(--ink-tertiary)', margin: '0 0 8px' }}>
              {dataset.label}
            </p>
          )}

          <DataTable
            dataset={dataset}
            ladders={ladders}
            policy={safePolicy}
            classResult={classResult}
            visibleColumns={visibleColumns}
            deletedColumns={namesDeleted && nameColumnPresent ? [COL.name] : []}
            selectedRow={focusRow}
            onSelectRow={setSelectedRow}
          />

          <AttackSimulator
            dataset={dataset}
            ladders={ladders}
            policy={safePolicy}
            guess={attackerGuess}
            setGuess={setAttackerGuess}
            sensitiveColumn={sensitiveColumn}
          />
        </main>

        <aside style={{ minWidth: 0 }}>
          {!assessed && (
            <Panel title="Not assessed">
              <p style={{ fontSize: 13, margin: 0 }}>
                No quasi-identifiers are declared, so there is nothing to group rows by. This is
                not a clean bill of health — it means the question has not been asked.
              </p>
            </Panel>
          )}

          <Panel
            title="What an outsider would recognise"
            note="These columns are the declared attacker model. Everything else is treated as an answer, not an identifier."
          >
            {availableColumns
              .filter((column) => column !== COL.timestamp && column !== COL.name)
              .map((column) => {
                const checked = activeQis.includes(column);
                const isAnswer = ANSWER_COLUMNS.includes(column);
                return (
                  <label
                    key={column}
                    style={{
                      display: 'flex',
                      gap: 8,
                      alignItems: 'center',
                      fontSize: 13,
                      padding: '3px 0',
                      color: isAnswer ? 'var(--ink-tertiary)' : 'var(--ink)',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setQiColumns((current) =>
                          current.includes(column)
                            ? current.filter((c) => c !== column)
                            : [...current, column],
                        )
                      }
                    />
                    {shortColumn(column)}
                    {isAnswer && <span style={{ fontSize: 11 }}>(an answer)</span>}
                  </label>
                );
              })}
          </Panel>

          {assessed && <RiskPanel risk={risk} />}

          {assessed && (
            <Panel
              title="What survives of what you meant to publish"
              note="Measured only over the tables declared below — not a general claim that the data is still good."
            >
              <div
                className="mono"
                style={{ fontSize: 30, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.1 }}
              >
                {(fidelity.fidelity * 100).toFixed(1)}%
              </div>
              <ul style={{ margin: '8px 0 0', padding: 0, listStyle: 'none', fontSize: 12 }}>
                {fidelity.perTable.map((table) => (
                  <li key={table.id} style={{ color: 'var(--ink-secondary)' }}>
                    {table.label}:{' '}
                    <span className="mono">{((1 - table.tvd) * 100).toFixed(1)}%</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {search && (
            <FrontierChart search={search} onApply={applyFix} activePolicyKey={activePolicyKey} />
          )}

          {assessed && <SensitivityPanel entries={sensitivity} />}

          {assessed && (
            <Panel title="The note you can hand to your advisor">
              <p style={{ fontSize: 12.5, lineHeight: 1.6, margin: '0 0 10px' }}>{note}</p>
              <button
                onClick={() => navigator.clipboard?.writeText(note)}
                style={{ ...sourceButtonStyle, background: 'none' }}
              >
                Copy
              </button>
            </Panel>
          )}

          {assessed && (
            <ThreatModelPanel
              quasiIdentifiers={activeQis}
              k={classResult.k}
              entropyL={diversity?.entropyL ?? 0}
              worstAnswer={worstAnswer}
              onHighlightWorst={() => {
                const worst = diversity?.worstClass;
                const cls = worst ? classResult.classes[worst.index] : undefined;
                if (cls) setSelectedRow(cls.rowIndices[0]);
              }}
            />
          )}
        </aside>
      </div>

      <footer
        style={{
          marginTop: 32,
          paddingTop: 16,
          borderTop: '1px solid var(--rule)',
          fontSize: 12,
          color: 'var(--ink-tertiary)',
        }}
      >
        Network requests after load: <strong className="mono">0</strong>. Method: k-anonymity
        (Sweeney 2002); prosecutor and journalist risk (El Emam &amp; Dankar 2008); the homogeneity
        caveat (Machanavajjhala et al. 2007). Demo data is synthetic and generated from a
        committed seed — no real student's answers appear anywhere in this tool.
      </footer>
    </div>
  );

  function resetTo(next: Source) {
    setSource(next);
    setPolicy({});
    setSelectedRow(null);
    setQiColumns(DEFAULT_QUASI_IDENTIFIERS);
    setNamesDeleted(next !== 'demo');
    setAttackerGuess({});
  }
}

function policyKeyOfPoint(point: FrontierPoint): string {
  return Object.entries(point.policy)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([column, level]) => `${column}:${level}`)
    .join('|');
}

const sourceButtonStyle: React.CSSProperties = {
  border: '1px solid var(--rule-strong)',
  padding: '7px 12px',
  fontSize: 13,
};

function SourceButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        ...sourceButtonStyle,
        background: active ? 'var(--ink)' : 'none',
        color: active ? 'var(--paper)' : 'var(--ink)',
        fontWeight: active ? 600 : 400,
      }}
    >
      {children}
    </button>
  );
}

function downloadCsv(dataset: Dataset) {
  const blob = new Blob([toCsv(dataset)], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'anonenough-demo.csv';
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Be the attacker.
 *
 * Reading that a row is identifiable is abstract. Picking the two facts you'd
 * plausibly know about a classmate and watching the survey narrow to one person
 * — with their answers attached — is not. This is the same computation as the
 * rest of the page, run from the other side of the table.
 */
function AttackSimulator({
  dataset,
  ladders,
  policy,
  guess,
  setGuess,
  sensitiveColumn,
}: {
  dataset: Dataset;
  ladders: { column: string; levels: { label: string; apply: (v: string) => string }[] }[];
  policy: Policy;
  guess: Record<string, string>;
  setGuess: (next: Record<string, string>) => void;
  sensitiveColumn: string;
}) {
  const optionsByColumn = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const ladder of ladders) {
      const level = ladder.levels[Math.min(policy[ladder.column] ?? 0, ladder.levels.length - 1)];
      const values = new Set(dataset.rows.map((row) => level.apply(row[ladder.column] ?? '')));
      map.set(
        ladder.column,
        [...values].sort((a, b) => {
          const na = Number(a);
          const nb = Number(b);
          return Number.isFinite(na) && Number.isFinite(nb) ? na - nb : a.localeCompare(b);
        }),
      );
    }
    return map;
  }, [ladders, policy, dataset]);

  const matches = useMemo(() => {
    const active = Object.entries(guess).filter(([, value]) => value !== '');
    if (active.length === 0) return null;
    return dataset.rows
      .map((row, index) => ({ row, index }))
      .filter(({ row }) =>
        active.every(([column, value]) => {
          const ladder = ladders.find((l) => l.column === column);
          if (!ladder) return true;
          const level = ladder.levels[Math.min(policy[column] ?? 0, ladder.levels.length - 1)];
          return level.apply(row[column] ?? '') === value;
        }),
      );
  }, [guess, dataset, ladders, policy]);

  if (ladders.length === 0) return null;

  return (
    <section
      style={{
        marginTop: 16,
        background: 'var(--panel)',
        border: '1px solid var(--rule)',
        padding: 20,
      }}
    >
      <h2 className="label" style={{ marginBottom: 4 }}>
        Try it from the other side
      </h2>
      <p style={{ fontSize: 12, color: 'var(--ink-tertiary)', margin: '0 0 12px' }}>
        Pick what you would know about someone at this school and see how far it narrows.
      </p>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        {ladders.map((ladder) => (
          <label key={ladder.column} style={{ fontSize: 12 }}>
            <div style={{ marginBottom: 4, color: 'var(--ink-secondary)' }}>
              {shortColumn(ladder.column)}
            </div>
            <select
              value={guess[ladder.column] ?? ''}
              onChange={(event) => setGuess({ ...guess, [ladder.column]: event.target.value })}
              style={{
                fontFamily: 'var(--mono)',
                fontSize: 13,
                padding: '6px 8px',
                border: '1px solid var(--rule-strong)',
                background: 'var(--paper)',
                minWidth: 140,
              }}
            >
              <option value="">any</option>
              {(optionsByColumn.get(ladder.column) ?? []).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        ))}
        {Object.values(guess).some((v) => v !== '') && (
          <button
            onClick={() => setGuess({})}
            style={{ ...sourceButtonStyle, alignSelf: 'flex-end', background: 'none' }}
          >
            Clear
          </button>
        )}
      </div>

      {matches === null ? (
        <p style={{ fontSize: 13, color: 'var(--ink-tertiary)', margin: 0 }}>
          Choose at least one thing you would know.
        </p>
      ) : matches.length === 0 ? (
        <p style={{ fontSize: 13, margin: 0 }}>Nobody in the survey matches that combination.</p>
      ) : (
        <div>
          <p
            style={{
              fontSize: 15,
              margin: '0 0 8px',
              fontWeight: 600,
              color: matches.length === 1 ? 'var(--alarm)' : 'var(--ink)',
            }}
          >
            {matches.length === 1
              ? 'That is exactly one person — and here is what they answered.'
              : `That narrows it to ${matches.length} people.`}
          </p>
          {matches.length <= 3 && (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
              {matches.map(({ row, index }) => (
                <li key={index} className="mono" style={{ marginBottom: 2 }}>
                  {shortColumn(sensitiveColumn)}: <strong>{row[sensitiveColumn]}</strong>
                </li>
              ))}
            </ul>
          )}
          {matches.length === 1 && (
            <p style={{ fontSize: 12, color: 'var(--ink-tertiary)', margin: '8px 0 0' }}>
              This is what k = 1 means in practice. Nothing was hacked — the spreadsheet
              simply describes one person.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
