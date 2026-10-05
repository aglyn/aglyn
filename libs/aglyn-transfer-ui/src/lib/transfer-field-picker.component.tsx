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
 * Which fields go into a file, and in what order.
 *
 * Every field the resource has is offered — standard, custom, derived and
 * system — grouped as the catalog groups them and searchable by label, id
 * or alias. The chosen fields are listed in file order, and each moves up
 * or down with a button, so the order is set from the keyboard as easily
 * as with a pointer.
 */

import type {
  TransferField,
  TransferFieldCatalog,
} from '@aglyn/aglyn/data-transfer'
import {
  groupTransferFields,
  moveTransferField,
  searchTransferFields,
} from '@aglyn/aglyn/data-transfer'
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward'
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward'
import {
  Box,
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useId, useMemo, useState } from 'react'

export interface TransferFieldPickerProps {
  catalog: TransferFieldCatalog
  /** The chosen field ids, in file order. */
  selected: readonly string[]
  onChange(fieldIds: string[]): void
}

function fieldKind(field: TransferField): string | null {
  if (field.custom) return 'Custom'
  if (field.system) return 'System'
  if (field.derived) return 'Computed'
  if (field.readOnly) return 'Read-only'
  return null
}

export function TransferFieldPicker({
  catalog,
  selected,
  onChange,
}: TransferFieldPickerProps) {
  const [query, setQuery] = useState('')
  const orderId = useId()
  const matching = useMemo(
    () => searchTransferFields(catalog, query).map((field) => field.id),
    [catalog, query],
  )
  const groups = useMemo(
    () => groupTransferFields(catalog, matching),
    [catalog, matching],
  )
  const chosen = new Set(selected)

  const toggle = (fieldId: string, on: boolean) => {
    if (on) {
      if (!chosen.has(fieldId)) onChange([...selected, fieldId])
    } else onChange(selected.filter((id) => id !== fieldId))
  }
  const selectShown = () =>
    onChange([...selected, ...matching.filter((id) => !chosen.has(id))])
  const clearShown = () => {
    const shown = new Set(matching)
    onChange(selected.filter((id) => !shown.has(id)))
  }

  return (
    <Stack
      direction={{ xs: 'column', md: 'row' }}
      spacing={2}
      sx={{ alignItems: 'stretch' }}
    >
      <Stack spacing={1} sx={{ flex: 1, minWidth: 0 }}>
        <TextField
          size="small"
          label="Search fields"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <Stack direction="row" spacing={1}>
          <Button size="small" onClick={selectShown}>
            {query ? 'Select shown' : 'Select all'}
          </Button>
          <Button size="small" onClick={clearShown}>
            {query ? 'Clear shown' : 'Select none'}
          </Button>
        </Stack>
        <Box sx={{ maxHeight: 360, overflowY: 'auto' }}>
          {groups.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No field matches “{query}”.
            </Typography>
          ) : null}
          {groups.map(({ group, fields }) => (
            <Box
              key={group.id}
              role="group"
              aria-label={group.label}
              sx={{ mb: 1 }}
            >
              <Typography variant="overline" color="text.secondary">
                {group.label}
              </Typography>
              <Stack>
                {fields.map((field) => {
                  const kind = fieldKind(field)
                  return (
                    <FormControlLabel
                      key={field.id}
                      control={
                        <Checkbox
                          size="small"
                          checked={chosen.has(field.id)}
                          onChange={(event) =>
                            toggle(field.id, event.target.checked)
                          }
                        />
                      }
                      label={
                        <Stack
                          direction="row"
                          spacing={1}
                          sx={{ alignItems: 'center' }}
                        >
                          <span>{field.label}</span>
                          {kind ? (
                            <Chip
                              size="small"
                              variant="outlined"
                              label={kind}
                            />
                          ) : null}
                        </Stack>
                      }
                    />
                  )
                })}
              </Stack>
            </Box>
          ))}
        </Box>
      </Stack>
      <Stack spacing={1} sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="subtitle2" id={orderId}>
          Columns in the file ({selected.length})
        </Typography>
        {selected.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Choose at least one field.
          </Typography>
        ) : null}
        <List
          dense
          aria-labelledby={orderId}
          sx={{ maxHeight: 400, overflowY: 'auto' }}
        >
          {selected.map((fieldId, index) => {
            const field = catalog.byId.get(fieldId)
            const name = field?.label ?? fieldId
            return (
              <ListItem
                key={fieldId}
                secondaryAction={
                  <Stack direction="row">
                    <IconButton
                      size="small"
                      aria-label={`Move ${name} up`}
                      disabled={index === 0}
                      onClick={() =>
                        onChange(moveTransferField(selected, index, index - 1))
                      }
                    >
                      <ArrowUpwardIcon fontSize="small" />
                    </IconButton>
                    <IconButton
                      size="small"
                      aria-label={`Move ${name} down`}
                      disabled={index === selected.length - 1}
                      onClick={() =>
                        onChange(moveTransferField(selected, index, index + 1))
                      }
                    >
                      <ArrowDownwardIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                }
              >
                <ListItemText primary={`${index + 1}. ${name}`} />
              </ListItem>
            )
          })}
        </List>
      </Stack>
    </Stack>
  )
}

export default TransferFieldPicker
