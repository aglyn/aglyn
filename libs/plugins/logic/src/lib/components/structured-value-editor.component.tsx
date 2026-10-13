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
  Alert,
  Button,
  IconButton,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import {
  duplicateStructuredKeys,
  parseStructuredValue,
  serializeStructuredValue,
  type StructuredValueKind,
  type StructuredValueRow,
} from '../model/structured-value'

const KIND_LABELS: Record<Exclude<StructuredValueKind, 'kept'>, string> = {
  text: 'Text',
  number: 'Number',
  boolean: 'True/false',
}

export interface StructuredValueEditorProps {
  shape: 'dictionary' | 'collection'
  /** The stored JSON string; read once, when the editor opens. */
  value: string
  onChange: (value: string) => void
}

/**
 * A dictionary as a Key / Value table and a collection as a list
 * (AGL-3757): each row typed Text, Number or True/false, written back as the
 * JSON string the variable has always stored. The rows are this editor's own
 * state, so a row whose key is still being typed is not dropped mid-edit.
 */
export function StructuredValueEditor(props: StructuredValueEditorProps) {
  const { shape, value, onChange } = props
  const [initial] = useState(() => parseStructuredValue(value, shape))
  const [rows, setRows] = useState<StructuredValueRow[]>(initial.rows)
  const duplicates = shape === 'dictionary' ? duplicateStructuredKeys(rows) : new Set<string>()

  const commit = (next: StructuredValueRow[]) => {
    setRows(next)
    onChange(serializeStructuredValue(next, shape))
  }
  const update = (index: number, patch: Partial<StructuredValueRow>) =>
    commit(rows.map((row, at) => (at === index ? { ...row, ...patch } : row)))

  const noun = shape === 'dictionary' ? 'entry' : 'item'
  return (
    <Stack spacing={1}>
      <Typography variant="caption" color="text.secondary">
        {shape === 'dictionary'
          ? 'Each entry is a name and its value. A function reads one as variable.name.'
          : 'Each item is one value in the list, in order.'}
      </Typography>
      {initial.unreadable ? (
        <Alert severity="warning">
          {'The saved value could not be read as a ' +
            (shape === 'dictionary' ? 'set of entries' : 'list') +
            '. Add its values below; saving replaces it.'}
        </Alert>
      ) : null}
      {rows.map((row, index) => (
        <Stack
          key={index}
          direction="row"
          spacing={1}
          sx={{ alignItems: 'center' }}
        >
          {shape === 'dictionary' ? (
            <TextField
              label="Entry name"
              value={row.key}
              onChange={(event) => update(index, { key: event.target.value })}
              error={duplicates.has(row.key.trim())}
              helperText={
                duplicates.has(row.key.trim()) ? 'Used twice — the last one wins' : undefined
              }
              size="small"
              sx={{ flex: 1 }}
            />
          ) : (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ width: 20, flexShrink: 0 }}
            >
              {`${index + 1}`}
            </Typography>
          )}
          {row.kind === 'kept' ? (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ flex: 2 }}
              noWrap
              title={row.value}
            >
              {'A nested list or set of entries — kept as it is'}
            </Typography>
          ) : (
            <>
              <TextField
                select
                label="Type"
                value={row.kind}
                onChange={(event) => {
                  const kind = event.target.value as StructuredValueKind
                  update(index, {
                    kind,
                    value:
                      kind === 'boolean'
                        ? row.value === 'true'
                          ? 'true'
                          : 'false'
                        : row.kind === 'boolean'
                          ? ''
                          : row.value,
                  })
                }}
                size="small"
                sx={{ width: 130 }}
              >
                {Object.entries(KIND_LABELS).map(([kind, label]) => (
                  <MenuItem key={kind} value={kind}>
                    {label}
                  </MenuItem>
                ))}
              </TextField>
              {row.kind === 'boolean' ? (
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center', flex: 2 }}
                >
                  <Switch
                    checked={row.value === 'true'}
                    onChange={(event) =>
                      update(index, {
                        value: event.target.checked ? 'true' : 'false',
                      })
                    }
                    slotProps={{ input: { 'aria-label': `Value ${index + 1}` } }}
                  />
                  <Typography variant="body2">
                    {row.value === 'true' ? 'True' : 'False'}
                  </Typography>
                </Stack>
              ) : (
                <TextField
                  label="Value"
                  value={row.value}
                  onChange={(event) =>
                    update(index, {
                      value:
                        row.kind === 'number'
                          ? event.target.value.replace(/[^0-9.eE+-]/g, '')
                          : event.target.value,
                    })
                  }
                  slotProps={
                    row.kind === 'number'
                      ? { htmlInput: { inputMode: 'decimal' } }
                      : undefined
                  }
                  size="small"
                  sx={{ flex: 2 }}
                />
              )}
            </>
          )}
          <IconButton
            size="small"
            aria-label={`Remove ${noun} ${index + 1}`}
            onClick={() => commit(rows.filter((_, at) => at !== index))}
          >
            {'×'}
          </IconButton>
        </Stack>
      ))}
      <Button
        size="small"
        sx={{ alignSelf: 'flex-start' }}
        onClick={() => commit([...rows, { key: '', kind: 'text', value: '' }])}
      >
        {shape === 'dictionary' ? 'Add entry' : 'Add item'}
      </Button>
    </Stack>
  )
}

export default StructuredValueEditor
