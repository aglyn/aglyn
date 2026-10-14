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
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  ListSubheader,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { type ReactNode, useState } from 'react'
import {
  buildFormula,
  FORMULA_OPERATION_ORDER,
  FORMULA_OPERATIONS,
  type FormulaDraft,
  type FormulaOperand,
  type FormulaOperation,
  formulaDraftFor,
  formulaOperandLabel,
} from '../model/formula'
import type { FormulaName } from '../model/formula-names'

const SOURCE_LABELS: Record<FormulaOperand['source'], string> = {
  name: 'A value',
  number: 'A number',
  text: 'Some text',
  current: 'What is there now',
}

const SEPARATORS: { value: string; label: string }[] = [
  { value: ' ', label: 'A space' },
  { value: ', ', label: 'A comma' },
  { value: ' - ', label: 'A dash' },
  { value: '', label: 'Nothing' },
]

const SYMBOLS = ['$', '€', '£', '¥', '']

function NameSelect(props: {
  label: string
  value: string
  names: readonly FormulaName[]
  onChange: (value: string) => void
}) {
  const { label, value, names, onChange } = props
  const items: ReactNode[] = []
  let group: string | null = null
  for (const option of names) {
    if (option.group !== group) {
      group = option.group
      items.push(<ListSubheader key={`group:${group}`}>{group}</ListSubheader>)
    }
    items.push(
      <MenuItem key={option.value} value={option.value}>
        {option.label}
      </MenuItem>,
    )
  }
  return (
    <TextField
      select
      label={label}
      value={names.some((option) => option.value === value) ? value : ''}
      onChange={(event) => onChange(event.target.value)}
      size="small"
      sx={{ flex: 1 }}
    >
      {items.length ? items : <MenuItem disabled>{'Nothing to pick yet'}</MenuItem>}
    </TextField>
  )
}

function OperandRow(props: {
  label: string
  operand: FormulaOperand
  names: readonly FormulaName[]
  hasCurrent: boolean
  onChange: (operand: FormulaOperand) => void
  onRemove?: () => void
}) {
  const { label, operand, names, hasCurrent, onChange, onRemove } = props
  const sources = (Object.keys(SOURCE_LABELS) as FormulaOperand['source'][]).filter(
    (source) => source !== 'current' || hasCurrent,
  )
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <TextField
        select
        label={label}
        value={operand.source}
        onChange={(event) => {
          const source = event.target.value as FormulaOperand['source']
          onChange(
            source === 'name'
              ? { source, name: '' }
              : source === 'current'
                ? { source }
                : { source, value: '' },
          )
        }}
        size="small"
        sx={{ width: 170 }}
      >
        {sources.map((source) => (
          <MenuItem key={source} value={source}>
            {SOURCE_LABELS[source]}
          </MenuItem>
        ))}
      </TextField>
      {operand.source === 'name' ? (
        <NameSelect
          label="Which"
          value={operand.name}
          names={names}
          onChange={(name) => onChange({ source: 'name', name })}
        />
      ) : operand.source === 'number' ? (
        <TextField
          label="Number"
          value={operand.value}
          onChange={(event) =>
            onChange({
              source: 'number',
              value: event.target.value.replace(/[^0-9.-]/g, ''),
            })
          }
          slotProps={{ htmlInput: { inputMode: 'decimal' } }}
          size="small"
          sx={{ flex: 1 }}
        />
      ) : operand.source === 'text' ? (
        <TextField
          label="Text"
          value={operand.value}
          onChange={(event) =>
            onChange({ source: 'text', value: event.target.value })
          }
          size="small"
          sx={{ flex: 1 }}
        />
      ) : (
        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
          {'The formula already in the box'}
        </Typography>
      )}
      {onRemove ? (
        <IconButton size="small" aria-label={`Remove ${label}`} onClick={onRemove}>
          {'×'}
        </IconButton>
      ) : null}
    </Stack>
  )
}

export interface FormulaBuilderDialogProps {
  /** What the box holds now; offered as a value so formulas can be layered. */
  current: string
  /** Parameters, local variables and site variables, grouped. */
  names: readonly FormulaName[]
  /** Receives the expression the builder wrote. */
  onUse: (expression: string) => void
  onClose: () => void
}

/**
 * The "Build formula" dialog (AGL-3757): pick what to work out — add,
 * smallest of, format as money — and the values it works on, and the box
 * gets the expression that does it. Nothing is typed but numbers and text.
 * Its own chunk, loaded the first time an ƒx button is pressed.
 */
export default function FormulaBuilderDialog(props: FormulaBuilderDialogProps) {
  const { current, names, onUse, onClose } = props
  const [draft, setDraft] = useState<FormulaDraft>(() =>
    formulaDraftFor(current.trim() ? 'add' : 'value', undefined, current),
  )
  const spec = FORMULA_OPERATIONS[draft.operation]
  const expression = buildFormula(draft, current)
  const setOperand = (index: number, operand: FormulaOperand) =>
    setDraft((previous) => ({
      ...previous,
      operands: previous.operands.map((item, at) => (at === index ? operand : item)),
    }))
  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{'Build formula'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          <TextField
            select
            label="Work out"
            value={draft.operation}
            onChange={(event) =>
              setDraft(
                formulaDraftFor(event.target.value as FormulaOperation, draft, current),
              )
            }
            size="small"
          >
            {FORMULA_OPERATION_ORDER.map((operation) => (
              <MenuItem key={operation} value={operation}>
                {FORMULA_OPERATIONS[operation].label}
              </MenuItem>
            ))}
          </TextField>
          {draft.operands.map((operand, index) => (
            <OperandRow
              key={index}
              label={formulaOperandLabel(draft.operation, index)}
              operand={operand}
              names={names}
              hasCurrent={Boolean(current.trim())}
              onChange={(next) => setOperand(index, next)}
              onRemove={
                spec.variadic && index >= spec.minOperands
                  ? () =>
                      setDraft({
                        ...draft,
                        operands: draft.operands.filter((_, at) => at !== index),
                      })
                  : undefined
              }
            />
          ))}
          {spec.variadic ? (
            <Button
              size="small"
              sx={{ alignSelf: 'flex-start' }}
              onClick={() =>
                setDraft({
                  ...draft,
                  operands: [
                    ...draft.operands,
                    draft.operation === 'join'
                      ? { source: 'text', value: '' }
                      : { source: 'name', name: '' },
                  ],
                })
              }
            >
              {'Add another'}
            </Button>
          ) : null}
          <Stack direction="row" spacing={1}>
            {draft.operation === 'currency' ? (
              <TextField
                select
                label="Sign"
                value={draft.symbol ?? '$'}
                onChange={(event) => setDraft({ ...draft, symbol: event.target.value })}
                size="small"
                sx={{ width: 110 }}
              >
                {SYMBOLS.map((symbol) => (
                  <MenuItem key={symbol || 'none'} value={symbol}>
                    {symbol || 'None'}
                  </MenuItem>
                ))}
              </TextField>
            ) : null}
            {spec.places ? (
              <TextField
                select
                label="Decimal places"
                value={draft.places ?? (draft.operation === 'currency' ? 2 : 0)}
                onChange={(event) =>
                  setDraft({ ...draft, places: Number(event.target.value) })
                }
                size="small"
                sx={{ width: 150 }}
              >
                {[0, 1, 2, 3, 4].map((places) => (
                  <MenuItem key={places} value={places}>
                    {String(places)}
                  </MenuItem>
                ))}
              </TextField>
            ) : null}
            {draft.operation === 'join' ? (
              <TextField
                select
                label="Between each"
                value={draft.separator ?? ' '}
                onChange={(event) => setDraft({ ...draft, separator: event.target.value })}
                size="small"
                sx={{ width: 160 }}
              >
                {SEPARATORS.map((separator) => (
                  <MenuItem key={separator.label} value={separator.value}>
                    {separator.label}
                  </MenuItem>
                ))}
              </TextField>
            ) : null}
          </Stack>
          <Typography variant="caption" color="text.secondary">
            {expression
              ? `The box will read: ${expression}`
              : 'Choose every value to finish the formula.'}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{'Cancel'}</Button>
        <Button
          variant="contained"
          disabled={!expression}
          onClick={() => {
            if (!expression) return
            onUse(expression)
            onClose()
          }}
        >
          {'Use formula'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
