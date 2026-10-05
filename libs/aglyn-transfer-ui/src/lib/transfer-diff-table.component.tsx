/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use client'

/**
 * Before → after, row by row: what an import (or a package) will change.
 *
 * Generic over what a row is. The import wizard feeds it planned rows
 * through {@link planRowsToDiffRows}; a package import feeds it items. A
 * filter narrows it to one outcome, and it pages so a large file's review
 * stays one screen.
 */

import type {
  PlannedTransferRow,
  TransferRowVerdict,
} from '@aglyn/aglyn/data-transfer'
import { ScrollTable } from '@aglyn/shared-ui-jsx/components/scroll-table.component'
import {
  Box,
  Chip,
  Stack,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  Typography,
} from '@mui/material'
import { useState } from 'react'

import { TransferChoiceSelect } from './transfer-choice-select.component'
import {
  REASON_WORDS,
  VERDICT_WORDS,
  displayTransferValue,
  rowNumber,
} from './transfer-words'

type ChipColor =
  'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'info'

export interface TransferDiffChange {
  key: string
  label: string
  before: unknown
  after: unknown
  /** How the change was decided ("Fill blanks · Default"). */
  note?: string
}

export interface TransferDiffRow {
  key: string
  /** What the row is ("Row 4"). */
  title: string
  /** What it is about (a record's name). */
  subtitle?: string
  /** The filter value it belongs to. */
  status: string
  statusLabel: string
  statusColor?: ChipColor
  changes: TransferDiffChange[]
  /** Why nothing changes, for a row with no changes. */
  note?: string
}

export interface TransferDiffFilter {
  value: string
  label: string
  count: number
}

export interface TransferDiffTableProps {
  /** Names the table for assistive technology. */
  label: string
  rows: readonly TransferDiffRow[]
  /** Offered beside "All"; the table shows rows whose `status` is the chosen value. */
  filters?: readonly TransferDiffFilter[]
  pageSize?: number
  emptyText?: string
}

export function TransferDiffTable({
  label,
  rows,
  filters = [],
  pageSize = 25,
  emptyText = 'Nothing to show.',
}: TransferDiffTableProps) {
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(0)
  const shown =
    filter === 'all' ? rows : rows.filter((row) => row.status === filter)
  // A shorter list (a new filter, a re-plan) never leaves the page past its end.
  const lastPage = Math.max(0, Math.ceil(shown.length / pageSize) - 1)
  const current = Math.min(page, lastPage)
  const visible = shown.slice(current * pageSize, current * pageSize + pageSize)
  return (
    <Stack spacing={1}>
      {filters.length ? (
        <Box>
          <TransferChoiceSelect
            label="Show"
            value={filter}
            onChange={(next) => {
              setFilter(next)
              setPage(0)
            }}
            options={[
              { value: 'all', label: `All (${rows.length.toLocaleString()})` },
              ...filters.map((entry) => ({
                value: entry.value,
                label: `${entry.label} (${entry.count.toLocaleString()})`,
                disabled: entry.count === 0,
              })),
            ]}
          />
        </Box>
      ) : null}
      <ScrollTable size="small" aria-label={label}>
        <TableHead>
          <TableRow>
            <TableCell>Row</TableCell>
            <TableCell>Outcome</TableCell>
            <TableCell>Field</TableCell>
            <TableCell>Before</TableCell>
            <TableCell>After</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {visible.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5}>
                <Typography variant="body2" color="text.secondary">
                  {emptyText}
                </Typography>
              </TableCell>
            </TableRow>
          ) : null}
          {visible.flatMap((row) => {
            const span = Math.max(1, row.changes.length)
            const head = (
              <>
                <TableCell rowSpan={span} sx={{ verticalAlign: 'top' }}>
                  <Typography variant="body2">{row.title}</Typography>
                  {row.subtitle ? (
                    <Typography variant="caption" color="text.secondary">
                      {row.subtitle}
                    </Typography>
                  ) : null}
                </TableCell>
                <TableCell rowSpan={span} sx={{ verticalAlign: 'top' }}>
                  <Chip
                    size="small"
                    label={row.statusLabel}
                    color={row.statusColor ?? 'default'}
                    variant="outlined"
                  />
                </TableCell>
              </>
            )
            if (!row.changes.length) {
              return [
                <TableRow key={row.key}>
                  {head}
                  <TableCell colSpan={3}>
                    <Typography variant="body2" color="text.secondary">
                      {row.note ?? 'No field changes.'}
                    </Typography>
                  </TableCell>
                </TableRow>,
              ]
            }
            return row.changes.map((change, index) => (
              <TableRow key={`${row.key}:${change.key}`}>
                {index === 0 ? head : null}
                <TableCell>
                  <Typography variant="body2">{change.label}</Typography>
                  {change.note ? (
                    <Typography variant="caption" color="text.secondary">
                      {change.note}
                    </Typography>
                  ) : null}
                </TableCell>
                <TableCell>
                  <Typography variant="body2" color="text.secondary">
                    {displayTransferValue(change.before)}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Typography variant="body2">
                    {displayTransferValue(change.after)}
                  </Typography>
                </TableCell>
              </TableRow>
            ))
          })}
        </TableBody>
      </ScrollTable>
      {shown.length > pageSize ? (
        <TablePagination
          component="div"
          count={shown.length}
          page={current}
          rowsPerPage={pageSize}
          rowsPerPageOptions={[pageSize]}
          onPageChange={(_event, next) => setPage(next)}
        />
      ) : null}
    </Stack>
  )
}

export const VERDICT_COLORS: Readonly<Record<TransferRowVerdict, ChipColor>> = {
  create: 'success',
  update: 'info',
  unchanged: 'default',
  skip: 'warning',
  fail: 'error',
}

/** Planned rows as diff rows: the verdict, the record, and each field before → after. */
export function planRowsToDiffRows(
  rows: readonly PlannedTransferRow[],
  fieldLabel: (fieldId: string) => string,
  recordLabels: Readonly<Record<string, string>> = {},
): TransferDiffRow[] {
  return rows.map((row) => ({
    key: String(row.index),
    title: `Row ${rowNumber(row.index)}`,
    ...(row.recordId
      ? { subtitle: recordLabels[row.recordId] ?? row.recordId }
      : {}),
    status: row.verdict,
    statusLabel: VERDICT_WORDS[row.verdict],
    statusColor: VERDICT_COLORS[row.verdict],
    changes: row.diff.map((change) => ({
      key: change.fieldId,
      label: fieldLabel(change.fieldId),
      before: change.before,
      after: change.after,
    })),
    ...(row.reason
      ? {
          note: `${REASON_WORDS[row.reason]}${row.missing?.length ? `: ${row.missing.map(fieldLabel).join(', ')}` : ''}`,
        }
      : {}),
  }))
}

export default TransferDiffTable
