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

import { Chip, Stack, Tooltip } from '@mui/material'
import { type ListFilterField, listFilterOperatorLabel } from '../const/list-filter'
import type { ListFilterClause, ListFilterOption } from '../const/list-grid-filter'

export interface ListFilterChipsProps {
  /** The list's grammar — every field a clause may name. */
  fields: readonly ListFilterField[]
  /** How a field reads on a chip; a field without one reads as its column. */
  headers: Readonly<Record<string, string>>
  clauses: readonly ListFilterClause[]
  onChange: (clauses: ListFilterClause[]) => void
  /** Choices per field, so a chip names a picked value by its label. */
  options?: Readonly<Record<string, readonly ListFilterOption[]>>
  /**
   * The field the query is serving, marked so the reader knows which reached
   * everything. Omitted on a list whose every clause narrows the same rows.
   */
  servedField?: string | null
  /**
   * Whether chips carry the served / loaded-window distinction at all.
   * Defaults to whether `servedField` was passed: a list that answers every
   * clause over the same rows has nothing to distinguish.
   */
  marksServed?: boolean
  disabled?: boolean
}

/** Operators that carry no value. */
const VALUELESS = new Set(['isEmpty', 'isNotEmpty'])
/** Operators that take several values, comma-joined the way the grammar splits them. */
const MULTI = new Set(['isAnyOf'])

const dayLabel = (raw: string): string => {
  const at = new Date(raw)
  return Number.isNaN(at.getTime()) ? raw : at.toLocaleDateString()
}

/**
 * Every clause a list is narrowed by, as chips over the grid (AGL-2617,
 * AGL-3313; shared since AGL-3317).
 *
 * The clauses are ADDED through the grid's own Filters panel; this bar is
 * what shows the SET. The free DataGrid's panel holds one item at a time
 * and a saved view holds several, so without it a list narrowed by two
 * fields would show one of the two and hide the other. Each
 * chip reads as a sentence — "Owner is Dana", "Created on or after 1 Jan"
 * — and removes its clause; where some clauses reach the query and others
 * narrow the loaded rows, the served one is marked.
 */
export function ListFilterChips(props: ListFilterChipsProps) {
  const {
    fields,
    headers,
    clauses,
    onChange,
    options = {},
    servedField = null,
    marksServed = props.servedField !== undefined,
    disabled = false,
  } = props
  const header = (column: string) => headers[column] ?? column

  /** How a clause reads: its header, its operator, and its value by label. */
  const sentence = (clause: ListFilterClause): string => {
    const field = fields.find((entry) => entry.column === clause.field)
    const choices = options[clause.field]
    const named = (value: string) =>
      choices?.find((option) => option.value === value)?.label ?? value
    const value = VALUELESS.has(clause.op)
      ? ''
      : MULTI.has(clause.op)
        ? clause.value
            .split(',')
            .map((entry) => entry.trim())
            .filter(Boolean)
            .map(named)
            .join(', ')
        : clause.label ?? (field?.kind === 'date' ? dayLabel(clause.value) : named(clause.value))
    return `${header(clause.field)} ${listFilterOperatorLabel(clause.op)}${value ? ` ${value}` : ''}`
  }

  if (!clauses.length) return null
  return (
    <Stack
      direction="row"
      spacing={1}
      useFlexGap
      sx={{ alignItems: 'center', flexWrap: 'wrap' }}
      role="list"
      aria-label="Filters"
    >
      {clauses.map((clause, index) => {
        const served = marksServed && servedField !== null && clause.field === servedField
        const key = `${clause.field}-${clause.op}-${index}`
        const chip = (
          <Chip
            key={key}
            role="listitem"
            size="small"
            variant={served ? 'filled' : 'outlined'}
            color={served ? 'primary' : 'default'}
            label={sentence(clause)}
            disabled={disabled}
            onDelete={() => onChange(clauses.filter((_entry, at) => at !== index))}
          />
        )
        return marksServed ? (
          <Tooltip
            key={key}
            title={served ? 'Searched across every record' : 'Narrows the records already loaded'}
          >
            {chip}
          </Tooltip>
        ) : (
          chip
        )
      })}
    </Stack>
  )
}
ListFilterChips.displayName = 'ListFilterChips'

export default ListFilterChips
