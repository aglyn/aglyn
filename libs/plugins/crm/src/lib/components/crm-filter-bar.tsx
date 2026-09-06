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

import { CRM_VIEW_MAX_FILTERS, type CrmViewFilterClause } from '@aglyn/aglyn'
import { mdiFilterPlusOutline } from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import {
  type ListFilterField,
  listFilterOperatorLabel,
  listFilterOperators,
} from '@aglyn/shared-ui-jsx/const/list-filter'
import {
  Button,
  Chip,
  MenuItem,
  Popover,
  Stack,
  TextField,
  Tooltip,
} from '@mui/material'
import { type MouseEvent, useMemo, useState } from 'react'

/** A choice for a field whose value is picked rather than typed. */
export interface CrmFilterOption {
  value: string
  label: string
}

export interface CrmFilterBarProps {
  /** The list's grammar — every field a clause may name. */
  fields: readonly ListFilterField[]
  /** How a field reads on a chip; a field without one reads as its column. */
  headers: Readonly<Record<string, string>>
  clauses: readonly CrmViewFilterClause[]
  onChange: (clauses: CrmViewFilterClause[]) => void
  /**
   * Choices per field — an owner from the roster, a stage from the fixed
   * list, a source from its labels. A field with choices gets a picker
   * and its chip shows the label; without them a value is typed.
   */
  options?: Readonly<Record<string, readonly CrmFilterOption[]>>
  /** The field the query is serving, marked so the reader knows which reached everything. */
  servedField?: string | null
  disabled?: boolean
  /**
   * The reader reached for a filter. A section that reads its pickers'
   * choices lazily — the roster, the companies — starts those reads here,
   * so a list nobody is narrowing pays for neither.
   */
  onOpen?: () => void
}

/** Operators that carry no value, so the value box is not shown for them. */
const VALUELESS = new Set(['isEmpty', 'isNotEmpty'])
/** Operators that take several values, comma-joined the way the grammar splits them. */
const MULTI = new Set(['isAnyOf'])

const dayLabel = (raw: string): string => {
  const at = new Date(raw)
  return Number.isNaN(at.getTime()) ? raw : at.toLocaleDateString()
}

/**
 * The chips above a CRM list: every clause the list is narrowed by, and
 * the one control that adds another (AGL-2617).
 *
 * A saved view carries several clauses and the community data grid's panel
 * holds one, so the list needs an editor of its own for the set. Each
 * clause is a chip that reads as a sentence — "Owner is Dana", "Created on
 * or after 1 Jan" — with the clause the query serves marked, because that
 * is the one that reached every contact and the others narrowed the loaded
 * window; the list's caption says the same thing in prose.
 *
 * Adding one is a popover, not a row of controls: field, operator, value,
 * Add. The value control follows the field — a picker where the section
 * supplied choices, a date box for a date, a number box for a number, a
 * text box otherwise — and the operators offered are exactly the ones the
 * grammar declares for the field, so a clause cannot be built that nothing
 * answers.
 */
export function CrmFilterBar(props: CrmFilterBarProps) {
  const {
    fields,
    headers,
    clauses,
    onChange,
    options = {},
    servedField = null,
    disabled = false,
    onOpen,
  } = props
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [draft, setDraft] = useState<{ field: string; op: string; value: string }>({
    field: '',
    op: '',
    value: '',
  })

  /** Fields a clause can be added on — those with at least one operator. */
  const choosable = useMemo(
    () => fields.filter((field) => listFilterOperators(field).length > 0),
    [fields],
  )
  const header = (column: string) => headers[column] ?? column
  const draftField = choosable.find((field) => field.column === draft.field) ?? null
  const operators = draftField ? listFilterOperators(draftField) : []
  const draftOptions = draft.field ? options[draft.field] : undefined
  const valueless = VALUELESS.has(draft.op)
  const multi = MULTI.has(draft.op)

  const open = (event: MouseEvent<HTMLElement>) => {
    const first = choosable[0]
    const firstOps = first ? listFilterOperators(first) : []
    setDraft({ field: first?.column ?? '', op: firstOps[0] ?? '', value: '' })
    setAnchor(event.currentTarget)
    onOpen?.()
  }
  const close = () => setAnchor(null)

  const chooseField = (column: string) => {
    const field = choosable.find((entry) => entry.column === column)
    const ops = field ? listFilterOperators(field) : []
    setDraft({ field: column, op: ops[0] ?? '', value: '' })
  }

  const canAdd =
    Boolean(draft.field && draft.op) &&
    (valueless || draft.value.trim() !== '') &&
    clauses.length < CRM_VIEW_MAX_FILTERS

  const add = () => {
    if (!canAdd) return
    const value = valueless ? '' : draft.value.trim()
    const label =
      draftOptions && !multi
        ? draftOptions.find((option) => option.value === value)?.label
        : undefined
    onChange([...clauses, { field: draft.field, op: draft.op, value, ...(label ? { label } : {}) }])
    close()
  }

  /** How a clause reads: its header, its operator, and its value by label. */
  const sentence = (clause: CrmViewFilterClause): string => {
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

  return (
    <Stack
      direction="row"
      spacing={1}
      useFlexGap
      sx={{ alignItems: 'center', flexWrap: 'wrap' }}
    >
      {clauses.map((clause, index) => {
        const served = servedField !== null && clause.field === servedField
        return (
          <Tooltip
            key={`${clause.field}-${clause.op}-${index}`}
            title={
              served
                ? 'Searched across every record'
                : 'Narrows the records already loaded'
            }
          >
            <Chip
              size="small"
              variant={served ? 'filled' : 'outlined'}
              color={served ? 'primary' : 'default'}
              label={sentence(clause)}
              disabled={disabled}
              onDelete={() => onChange(clauses.filter((_entry, at) => at !== index))}
            />
          </Tooltip>
        )
      })}
      <Button
        size="small"
        startIcon={<MdiIcon path={mdiFilterPlusOutline.path} size={0.8} />}
        onClick={open}
        disabled={disabled || !choosable.length || clauses.length >= CRM_VIEW_MAX_FILTERS}
        aria-haspopup="dialog"
      >
        {'Add filter'}
      </Button>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={close}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <Stack spacing={1.5} sx={{ p: 2, minWidth: 280 }} role="dialog" aria-label="Add filter">
          <TextField
            select
            size="small"
            label="Field"
            value={draft.field}
            onChange={(event) => chooseField(event.target.value)}
          >
            {choosable.map((field) => (
              <MenuItem key={field.column} value={field.column}>
                {header(field.column)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label="Condition"
            value={draft.op}
            onChange={(event) => setDraft((prev) => ({ ...prev, op: event.target.value, value: '' }))}
            disabled={!draftField}
          >
            {operators.map((op) => (
              <MenuItem key={op} value={op}>
                {listFilterOperatorLabel(op)}
              </MenuItem>
            ))}
          </TextField>
          {valueless ? null : draftOptions ? (
            <TextField
              select
              size="small"
              label="Value"
              value={multi ? draft.value.split(',').filter(Boolean) : draft.value}
              onChange={(event) => {
                const next = event.target.value as unknown
                setDraft((prev) => ({
                  ...prev,
                  value: Array.isArray(next) ? next.join(',') : String(next),
                }))
              }}
              slotProps={multi ? { select: { multiple: true } } : undefined}
            >
              {draftOptions.map((option) => (
                <MenuItem key={option.value} value={option.value}>
                  {option.label}
                </MenuItem>
              ))}
            </TextField>
          ) : draftField?.kind === 'boolean' ? (
            <TextField
              select
              size="small"
              label="Value"
              value={draft.value}
              onChange={(event) => setDraft((prev) => ({ ...prev, value: event.target.value }))}
            >
              <MenuItem value="true">{'Yes'}</MenuItem>
              <MenuItem value="false">{'No'}</MenuItem>
            </TextField>
          ) : (
            <TextField
              size="small"
              label="Value"
              type={
                draftField?.kind === 'date'
                  ? 'date'
                  : draftField?.kind === 'number'
                    ? 'number'
                    : 'text'
              }
              placeholder={multi ? 'one, two, three' : undefined}
              helperText={multi ? 'Separate several with commas' : undefined}
              value={draft.value}
              onChange={(event) => setDraft((prev) => ({ ...prev, value: event.target.value }))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  add()
                }
              }}
              slotProps={
                draftField?.kind === 'date' ? { inputLabel: { shrink: true } } : undefined
              }
            />
          )}
          <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
            <Button size="small" onClick={close}>
              {'Cancel'}
            </Button>
            <Button size="small" variant="contained" disabled={!canAdd} onClick={add}>
              {'Add'}
            </Button>
          </Stack>
        </Stack>
      </Popover>
    </Stack>
  )
}
CrmFilterBar.displayName = 'CrmFilterBar'

export default CrmFilterBar
