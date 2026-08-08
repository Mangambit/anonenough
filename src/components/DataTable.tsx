import { useMemo } from 'react';
import { generalizeRow } from '../lib/anonymize';
import type { ClassResult, ColumnLadder, Dataset, Policy } from '../lib/types';

/**
 * The spreadsheet, with the finding attached to it.
 *
 * Two rules from the design brief drive everything here: red is only ever
 * attached to a specific row (alarm detached from evidence reads as scare-ware),
 * and the uniqueness column is the point — "1 of 1" says in three characters
 * what k = 1 says in a notation nobody outside the field reads.
 *
 * Cells show the GENERALIZED value for quasi-identifier columns, so applying a
 * fix visibly changes the data rather than changing a number somewhere else.
 */

interface DataTableProps {
  dataset: Dataset;
  ladders: ColumnLadder[];
  policy: Policy;
  classResult: ClassResult;
  visibleColumns: string[];
  deletedColumns: string[];
  selectedRow: number | null;
  onSelectRow: (rowIndex: number) => void;
  maxRows?: number;
}

export function DataTable({
  dataset,
  ladders,
  policy,
  classResult,
  visibleColumns,
  deletedColumns,
  selectedRow,
  onSelectRow,
  maxRows = 24,
}: DataTableProps) {
  const ladderByColumn = useMemo(
    () => new Map(ladders.map((ladder) => [ladder.column, ladder])),
    [ladders],
  );

  const generalized = useMemo(
    () => dataset.rows.map((row) => generalizeRow(row, ladders, policy)),
    [dataset, ladders, policy],
  );

  const rows = dataset.rows.slice(0, maxRows);

  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--rule)', background: 'var(--panel)' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
        <thead>
          <tr>
            <th style={headStyle} title="Number of respondents sharing this row's description">
              How many share this?
            </th>
            {visibleColumns.map((column) => {
              const isQi = ladderByColumn.has(column);
              const isDeleted = deletedColumns.includes(column);
              return (
                <th
                  key={column}
                  style={{
                    ...headStyle,
                    color: isDeleted ? 'var(--alarm)' : isQi ? 'var(--ink)' : 'var(--ink-tertiary)',
                    textDecoration: isDeleted ? 'line-through' : undefined,
                  }}
                >
                  {column}
                  {isQi && !isDeleted && (
                    <span style={{ color: 'var(--ink-tertiary)', fontWeight: 400 }}> · known</span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => {
            const classIdx = classResult.classIndex[rowIndex];
            const size = classIdx >= 0 ? classResult.classes[classIdx].size : 1;
            const unique = size === 1;
            const selected = selectedRow === rowIndex;

            return (
              <tr
                key={rowIndex}
                onClick={() => onSelectRow(rowIndex)}
                tabIndex={0}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelectRow(rowIndex);
                  }
                }}
                style={{
                  height: 'var(--row-height)',
                  cursor: 'pointer',
                  background: unique
                    ? 'var(--alarm-wash)'
                    : selected
                      ? 'rgba(0,0,0,0.03)'
                      : 'transparent',
                  outline: selected ? '2px solid var(--ink)' : undefined,
                  outlineOffset: -2,
                  transition: 'background 300ms var(--ease)',
                }}
              >
                <td
                  style={{
                    ...cellStyle,
                    fontWeight: unique ? 600 : 400,
                    color: unique ? 'var(--alarm)' : 'var(--ink-secondary)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {unique ? '1 of 1' : `1 of ${size}`}
                </td>
                {visibleColumns.map((column) => {
                  const ladderIndex = ladders.findIndex((l) => l.column === column);
                  const value =
                    ladderIndex >= 0 ? generalized[rowIndex][ladderIndex] : row[column];
                  const isDeleted = deletedColumns.includes(column);
                  return (
                    <td
                      key={column}
                      style={{
                        ...cellStyle,
                        color: isDeleted ? 'var(--ink-tertiary)' : 'var(--ink)',
                        textDecoration: isDeleted ? 'line-through' : undefined,
                      }}
                    >
                      {value}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      {dataset.rows.length > rows.length && (
        <p
          style={{
            margin: 0,
            padding: '8px 12px',
            fontSize: 12,
            color: 'var(--ink-tertiary)',
            borderTop: '1px solid var(--rule)',
          }}
        >
          Showing {rows.length} of {dataset.rows.length} rows. Every number on this page is
          computed over all {dataset.rows.length}.
        </p>
      )}
    </div>
  );
}

const headStyle: React.CSSProperties = {
  textAlign: 'left',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.04em',
  padding: '10px 12px',
  borderBottom: '1px solid var(--rule-strong)',
  position: 'sticky',
  top: 0,
  background: 'var(--panel)',
  whiteSpace: 'nowrap',
};

const cellStyle: React.CSSProperties = {
  padding: '0 12px',
  borderBottom: '1px solid var(--rule)',
  whiteSpace: 'nowrap',
};
