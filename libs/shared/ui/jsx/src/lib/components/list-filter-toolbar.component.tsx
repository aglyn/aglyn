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

import {
  Badge,
  Button,
  MenuItem,
  Popover,
  Stack,
  TextField,
} from '@mui/material'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  type ListFilterField,
  listFilterOperatorLabel,
  listFilterOperators,
} from '../const/list-filter'
import {
  type ListFilterClause,
  type ListFilterOption,
  upsertListFilterClause,
} from '../const/list-grid-filter'

/** Operators that carry no value. */
const VALUELESS = new Set(['isEmpty', 'isNotEmpty'])

/** How long the search box waits after the last keystroke before asking. */
const SEARCH_SETTLE_MS = 300

export interface ListFilterToolbarProps {
  /** The list's grammar — every field the Filters panel may name. */
  fields: readonly ListFilterField[]
  /** How a field reads in the panel and on its chip. */
  headers: Readonly<Record<string, string>>
  /** Choices per field, for a field whose value is picked rather than typed. */
  options?: Readonly<Record<string, readonly ListFilterOption[]>>
  clauses: readonly ListFilterClause[]
  onChange: (clauses: ListFilterClause[]) => void
  /** The quick search. Absent, the list offers no search box. */
  search?: {
    words: readonly string[]
    onChange: (words: string[]) => void
    placeholder?: string
  }
  disabled?: boolean
}

/**
 * THE LIST TOOLBAR, FOR A LIST THAT IS NOT A TABLE (AGL-3321).
 *
 * A table's search box and Filters panel are the grid's own toolbar. A list
 * drawn as cards, tiles or a feed has no grid, and must not become one to get
 * them — its presentation is not the filter's to change. This is the same two
 * controls over any presentation: a search box whose words the list puts on
 * its query, and a Filters button whose panel adds one clause per field, in
 * the same grammar (`ListFilterField`) and the same clause shape
 * (`ListFilterClause`) the grid's panel produces. The clauses in force show
 * as `ListFilterChips` beside it, and what the query could not take as
 * `ListQueryNotices`, exactly as over a table.
 *
 * It offers only the operators each field declares (`listFilterOperators`),
 * which are the ones the list's query can serve.
 */
export function ListFilterToolbar(props: ListFilterToolbarProps) {
  const { fields, headers, options = {}, clauses, onChange, search, disabled = false } = props
  const panelId = useId()
  const anchor = useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)

  // The search box is the reader's until they pause; then its words are asked.
  const [typed, setTyped] = useState(() => (search?.words ?? []).join(' '))
  const asked = (search?.words ?? []).join(' ')
  const onSearch = search?.onChange
  useEffect(() => {
    if (!onSearch) return
    const words = typed.split(/\s+/).filter(Boolean)
    if (words.join(' ') === asked) return
    const timer = setTimeout(() => onSearch(words), SEARCH_SETTLE_MS)
    return () => clearTimeout(timer)
  }, [typed, asked, onSearch])

  const label = (column: string) => headers[column] ?? column
  const [column, setColumn] = useState<string>(fields[0]?.column ?? '')
  const field = useMemo(
    () => fields.find((entry) => entry.column === column) ?? fields[0],
    [fields, column],
  )
  const operators = useMemo(() => (field ? listFilterOperators(field) : []), [field])
  const [op, setOp] = useState<string>(operators[0] ?? '')
  const [value, setValue] = useState('')

  // Opening the panel on a field shows the clause it already holds, if any.
  const pick = (next: string) => {
    const nextField = fields.find((entry) => entry.column === next)
    const held = clauses.find((clause) => clause.field === next)
    const nextOperators = nextField ? listFilterOperators(nextField) : []
    setColumn(next)
    setOp(held && nextOperators.includes(held.op) ? held.op : (nextOperators[0] ?? ''))
    setValue(held?.value ?? '')
  }
  useEffect(() => {
    if (open) pick(column)
    // Re-read only when the panel opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const choices = field ? options[field.column] : undefined
  const booleanChoices: readonly ListFilterOption[] = [
    { value: 'true', label: 'Yes' },
    { value: 'false', label: 'No' },
  ]
  const picked = choices ?? (field?.kind === 'boolean' ? booleanChoices : undefined)
  const valueless = VALUELESS.has(op)
  const ready = Boolean(field && op && (valueless || value.trim()))

  const apply = () => {
    if (!field || !ready) return
    onChange(
      upsertListFilterClause(clauses, field.column, {
        field: field.column,
        op,
        value: valueless ? '' : value.trim(),
      }),
    )
    setOpen(false)
  }

  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={1}
      sx={{ alignItems: { sm: 'center' } }}
    >
      {search ? (
        <TextField
          size="small"
          type="search"
          value={typed}
          disabled={disabled}
          onChange={(event) => setTyped(event.target.value)}
          placeholder={search.placeholder ?? 'Search…'}
          slotProps={{ htmlInput: { 'aria-label': search.placeholder ?? 'Search' } }}
          sx={{ minWidth: { sm: 280 } }}
        />
      ) : null}
      {fields.length ? (
        <>
          <Badge badgeContent={clauses.length} color="primary" overlap="rectangular">
            <Button
              ref={anchor}
              variant="outlined"
              size="medium"
              disabled={disabled}
              aria-haspopup="dialog"
              aria-controls={open ? panelId : undefined}
              aria-expanded={open}
              onClick={() => setOpen(true)}
            >
              {'Filters'}
            </Button>
          </Badge>
          <Popover
            id={panelId}
            open={open}
            anchorEl={anchor.current}
            onClose={() => setOpen(false)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
            slotProps={{ paper: { role: 'dialog', 'aria-label': 'Filters' } as never }}
          >
            <Stack
              component="form"
              spacing={1.5}
              sx={{ p: 2, width: { xs: 'calc(100vw - 32px)', sm: 340 }, maxWidth: 340 }}
              onSubmit={(event) => {
                event.preventDefault()
                apply()
              }}
            >
              <TextField
                select
                size="small"
                label="Field"
                value={field?.column ?? ''}
                onChange={(event) => pick(event.target.value)}
              >
                {fields.map((entry) => (
                  <MenuItem key={entry.column} value={entry.column}>
                    {label(entry.column)}
                  </MenuItem>
                ))}
              </TextField>
              {operators.length > 1 ? (
                <TextField
                  select
                  size="small"
                  label="Operator"
                  value={op}
                  onChange={(event) => setOp(event.target.value)}
                >
                  {operators.map((entry) => (
                    <MenuItem key={entry} value={entry}>
                      {listFilterOperatorLabel(entry)}
                    </MenuItem>
                  ))}
                </TextField>
              ) : null}
              {valueless ? null : picked ? (
                <TextField
                  select
                  size="small"
                  label="Value"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                >
                  {picked.map((choice) => (
                    <MenuItem key={choice.value} value={choice.value}>
                      {choice.label}
                    </MenuItem>
                  ))}
                </TextField>
              ) : (
                <TextField
                  size="small"
                  label="Value"
                  type={field?.kind === 'date' ? 'date' : field?.kind === 'number' ? 'number' : 'text'}
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  slotProps={field?.kind === 'date' ? { inputLabel: { shrink: true } } : undefined}
                />
              )}
              <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                {field && clauses.some((clause) => clause.field === field.column) ? (
                  <Button
                    onClick={() => {
                      onChange(upsertListFilterClause(clauses, field.column, null))
                      setOpen(false)
                    }}
                  >
                    {'Remove'}
                  </Button>
                ) : null}
                <Button type="submit" variant="contained" disabled={!ready}>
                  {'Apply'}
                </Button>
              </Stack>
            </Stack>
          </Popover>
        </>
      ) : null}
    </Stack>
  )
}
ListFilterToolbar.displayName = 'ListFilterToolbar'

export default ListFilterToolbar
