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

import type { FunctionValueType, HostFunctionParameterOption } from '@aglyn/aglyn'
import { Button, IconButton, Stack, TextField, Typography } from '@mui/material'
import { useState } from 'react'
import {
  choiceRowsFromOptions,
  optionsFromChoiceRows,
  type ParameterChoiceRow,
} from '../model/parameter-options'

export interface ParameterChoicesEditorProps {
  /** The parameter's name, for the remove buttons' labels. */
  parameterName: string
  type: FunctionValueType
  options: HostFunctionParameterOption[] | undefined
  onChange: (options: HostFunctionParameterOption[]) => void
}

/**
 * A parameter's choices as rows (AGL-3768): what the function receives and
 * what a visitor reads, one choice per row. The rows are this editor's own
 * state, so a choice whose value is still blank is not dropped mid-edit.
 */
export function ParameterChoicesEditor(props: ParameterChoicesEditorProps) {
  const { parameterName, type, options, onChange } = props
  const [rows, setRows] = useState<ParameterChoiceRow[]>(() =>
    choiceRowsFromOptions(options),
  )
  const commit = (next: ParameterChoiceRow[]) => {
    setRows(next)
    onChange(optionsFromChoiceRows(next))
  }
  const update = (index: number, patch: Partial<ParameterChoiceRow>) =>
    commit(rows.map((row, at) => (at === index ? { ...row, ...patch } : row)))
  const duplicate = (index: number) => {
    const value = rows[index].value.trim()
    return Boolean(value) && rows.findIndex((row) => row.value.trim() === value) < index
  }

  return (
    <Stack spacing={1} sx={{ pl: { xs: 0, sm: '118px' } }}>
      {rows.map((row, index) => (
        <Stack key={index} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <TextField
            label="Function gets"
            value={row.value}
            onChange={(event) =>
              update(index, {
                value:
                  type === 'number'
                    ? event.target.value.replace(/[^0-9.-]/g, '')
                    : event.target.value.slice(0, 120),
              })
            }
            error={duplicate(index)}
            helperText={duplicate(index) ? 'Already a choice' : undefined}
            slotProps={
              type === 'number' ? { htmlInput: { inputMode: 'decimal' } } : undefined
            }
            size="small"
            sx={{ flex: 1, minWidth: 0 }}
          />
          <TextField
            label="Visitors see"
            placeholder={row.value}
            value={row.label}
            onChange={(event) => update(index, { label: event.target.value.slice(0, 80) })}
            size="small"
            sx={{ flex: 2, minWidth: 0 }}
          />
          <IconButton
            size="small"
            aria-label={`Remove choice ${index + 1} of ${parameterName || 'parameter'}`}
            onClick={() => commit(rows.filter((_, at) => at !== index))}
          >
            {'×'}
          </IconButton>
        </Stack>
      ))}
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Button
          size="small"
          onClick={() => commit([...rows, { value: '', label: '' }])}
        >
          {'Add choice'}
        </Button>
        {rows.length ? null : (
          <Typography variant="caption" color="text.secondary">
            {'Give it choices to ask it as a list.'}
          </Typography>
        )}
      </Stack>
    </Stack>
  )
}

export default ParameterChoicesEditor
