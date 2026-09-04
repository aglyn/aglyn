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

import {
  type DataTableAlignment,
  parseDataTableRows,
  readDataTableAlignments,
  readPastedDataTable,
  serializeDataTable,
  withCellSet,
  withColumnAdded,
  withColumnRemoved,
  withRowAdded,
  withRowRemoved,
} from '@aglyn/shared-data-enums'
import {
  mdiFormatAlignCenter,
  mdiFormatAlignLeft,
  mdiFormatAlignRight,
  mdiPlus,
  mdiTrashCanOutline,
} from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import IconButton from '@mui/material/IconButton'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import type { ClipboardEvent } from 'react'
import { useCallback, useMemo } from 'react'
import { useFieldApi } from '../vendor/data-driven-forms'
import FormFieldGrid, { type FormFieldGridProps } from './form-field-grid'
import type { BaseFieldProps } from './types'

/**
 * DataTable (AGL-2543): the row-and-column editor for the Table element.
 *
 * Without it the element would be a textarea of pipe syntax, which re-ships
 * the complaint the issue was filed about — "a subscriber who wants to change
 * one cell has to edit markdown pipe syntax, which is exactly the audience
 * the besigner exists to avoid".
 *
 * The PERSISTED value is unchanged by this control existing: still ONE string
 * in the syntax the element itself parses, via the same shared helpers, so
 * renderers and published documents stay untouched. Same rule the CSS length,
 * border and gradient fields follow.
 *
 * There is no local draft state, deliberately. The border and dimension
 * fields need one because a half-typed decimal must not be rounded out from
 * under the caret; a table cell has no such intermediate — every keystroke is
 * already a valid cell value — so reading straight from the prop keeps the
 * grid honest about what is stored and removes a whole class of re-seed bug.
 */

const ALIGN_ICONS: Record<DataTableAlignment, string> = {
  left: mdiFormatAlignLeft.path,
  center: mdiFormatAlignCenter.path,
  right: mdiFormatAlignRight.path,
}

export interface DataTableFieldProps extends BaseFieldProps {
  FormFieldGridProps?: FormFieldGridProps
}

export const DataTableField = (props: DataTableFieldProps) => {
  const {
    input,
    isReadOnly,
    isDisabled,
    label,
    helperText,
    description,
    help,
    FormFieldGridProps = {},
    // Free-text leftovers from the schema shape these fields share; they
    // must never reach the DOM.
    inputProps: _inputProps,
    InputProps: _InputProps,
    multiline: _multiline,
    type: _type,
    options: _options,
    meta: _meta,
    validateOnMount: _validateOnMount,
    isRequired: _isRequired,
    placeholder: _placeholder,
    ...rest
  } = useFieldApi(props)

  const stored = `${input.value ?? ''}`
  const rows = useMemo(() => parseDataTableRows(stored), [stored])
  const width = rows[0]?.length ?? 0
  const alignments = useMemo(
    () => readDataTableAlignments(stored, width),
    [stored, width],
  )

  const commit = useCallback(
    (nextRows: string[][], nextAlignments = alignments) => {
      input.onChange(serializeDataTable(nextRows, nextAlignments))
    },
    [input, alignments],
  )

  /**
   * Importing a markdown table by pasting it into a cell (AGL-2568).
   *
   * It replaces the whole grid rather than splicing at the cell, because what
   * an author pastes is a table, not a range: the case this exists for is
   * moving a comparison table off the Markdown workaround, where the grid it
   * lands on is the two-row starter. Anything the paste is NOT a table —
   * which includes every ordinary cell value — falls through to the browser
   * and types itself into the cell, so this cannot cost anyone a paste.
   */
  const importPaste = useCallback(
    (event: ClipboardEvent<HTMLElement>) => {
      const pasted = readPastedDataTable(
        event.clipboardData?.getData('text/plain'),
      )
      if (!pasted) return
      event.preventDefault()
      commit(pasted.rows, pasted.alignments)
    },
    [commit],
  )

  const locked = isReadOnly || isDisabled

  // An empty value has no cell to click, so the grid cannot be typed into
  // and the author is stuck. Offer the one action that unsticks it.
  if (rows.length === 0) {
    return (
      <FormFieldGrid help={help} {...FormFieldGridProps}>
        <Stack spacing={1} {...rest}>
          <Box sx={{ color: 'text.secondary', fontSize: 13 }}>
            {label ?? 'Rows'}
          </Box>
          <Button
            size="small"
            variant="outlined"
            disabled={locked}
            startIcon={<MdiIcon path={mdiPlus.path} />}
            onClick={() =>
              commit(
                [
                  ['Feature', 'Us', 'Them'],
                  ['', '', ''],
                ],
                ['left', 'center', 'center'],
              )
            }
          >
            {'Start a table'}
          </Button>
          {/* "Then", not "or": the import runs on a cell's paste handler, and
              an empty field has no cell to paste into. */}
          <Box sx={{ color: 'text.secondary', fontSize: 12 }}>
            {'Then paste a markdown table into any cell to import one.'}
          </Box>
        </Stack>
      </FormFieldGrid>
    )
  }

  return (
    <FormFieldGrid help={help} {...FormFieldGridProps}>
      <Stack spacing={1} {...rest}>
        {label ? (
          <Box sx={{ color: 'text.secondary', fontSize: 13 }}>{label}</Box>
        ) : null}

        {/* Per-column alignment. It sits above its column rather than in a
            separate field because it belongs to the column an author is
            looking at — and because a field editor only ever receives one
            prop, so it has to travel inside this same string. */}
        <Stack direction="row" spacing={0.5} sx={{ pl: 0 }}>
          {alignments.map((alignment, columnIndex) => (
            <Box key={columnIndex} sx={{ flex: 1, minWidth: 0 }}>
              <ToggleButtonGroup
                size="small"
                exclusive
                disabled={locked}
                value={alignment}
                onChange={(_event, next) => {
                  if (!next) return
                  const nextAlignments = alignments.map((current, index) =>
                    index === columnIndex
                      ? (next as DataTableAlignment)
                      : current,
                  )
                  commit(rows, nextAlignments)
                }}
                aria-label={`Column ${columnIndex + 1} alignment`}
              >
                {(
                  Object.keys(ALIGN_ICONS) as DataTableAlignment[]
                ).map((option) => (
                  <ToggleButton key={option} value={option} sx={{ px: 0.75 }}>
                    <MdiIcon path={ALIGN_ICONS[option]} size={0.7} />
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
              <IconButton
                size="small"
                disabled={locked || width <= 1}
                aria-label={`Remove column ${columnIndex + 1}`}
                onClick={() => commit(withColumnRemoved(rows, columnIndex))}
              >
                <MdiIcon path={mdiTrashCanOutline.path} size={0.7} />
              </IconButton>
            </Box>
          ))}
        </Stack>

        {rows.map((row, rowIndex) => (
          <Stack
            key={rowIndex}
            direction="row"
            spacing={0.5}
            sx={{ alignItems: 'center' }}
          >
            {row.map((cell, columnIndex) => (
              <TextField
                key={columnIndex}
                size="small"
                fullWidth
                disabled={locked}
                value={cell}
                onPaste={importPaste}
                slotProps={{
                  htmlInput: {
                    'aria-label': `Row ${rowIndex + 1} column ${
                      columnIndex + 1
                    }`,
                  },
                }}
                onChange={(event) =>
                  commit(
                    withCellSet(rows, rowIndex, columnIndex, event.target.value),
                  )
                }
              />
            ))}
            <IconButton
              size="small"
              disabled={locked || rows.length <= 1}
              aria-label={`Remove row ${rowIndex + 1}`}
              onClick={() => commit(withRowRemoved(rows, rowIndex))}
            >
              <MdiIcon path={mdiTrashCanOutline.path} size={0.7} />
            </IconButton>
          </Stack>
        ))}

        <Stack direction="row" spacing={1}>
          <Button
            size="small"
            disabled={locked}
            startIcon={<MdiIcon path={mdiPlus.path} />}
            onClick={() => commit(withRowAdded(rows))}
          >
            {'Row'}
          </Button>
          <Button
            size="small"
            disabled={locked}
            startIcon={<MdiIcon path={mdiPlus.path} />}
            onClick={() => commit(withColumnAdded(rows))}
          >
            {'Column'}
          </Button>
        </Stack>

        {helperText || description ? (
          <Box sx={{ color: 'text.secondary', fontSize: 12 }}>
            {helperText ?? description}
          </Box>
        ) : null}
      </Stack>
    </FormFieldGrid>
  )
}

export default DataTableField
