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
  type CrmPicklist,
  type CrmPicklistId,
  crmPicklistDefinition,
  crmPicklistOptions,
  groupPicklistOptions,
  type PicklistOption,
} from '@aglyn/aglyn'
import { ListItemText, ListSubheader, MenuItem, TextField } from '@mui/material'
import { type ReactNode, useMemo } from 'react'

export interface CrmPicklistSelectProps {
  /** Which of the CRM's standard picklists the field is. */
  picklistId: CrmPicklistId
  picklist: CrmPicklist
  /** The label the record holds, or `''` for none. */
  value: string
  onChange: (label: string) => void
  /**
   * What the record held when the form opened. Kept in the menu while the
   * list no longer offers it — deactivated, or written before the list
   * held it — so the select shows what is stored until somebody changes it.
   */
  stored?: string
  disabled?: boolean
  helperText?: string
  error?: boolean
}

/** How a kept value that the list does not offer reads in the menu and the field. */
function optionText(option: PicklistOption): string {
  if (option.inactive) return `${option.label} (inactive)`
  if (option.unlisted) return `${option.label} (not in the list)`
  return option.label
}

/**
 * A standard picklist's select (AGL-3298, AGL-3510): the org's active
 * values in the order the Fields page keeps them, a "None" to clear, and
 * the record's own value when the list would not otherwise show it —
 * marked, and selectable only as what it already is. A definition with
 * groups lists its values under a heading per group, in the definition's
 * order, with ungrouped values last.
 *
 * MUI's select `TextField`, the control every CRM form in this plugin uses
 * for a fixed choice, so it sizes, labels and disables like its neighbors.
 */
export function CrmPicklistSelect(props: CrmPicklistSelectProps) {
  const { picklistId, picklist, value, onChange, stored, disabled, helperText, error } = props
  const definition = crmPicklistDefinition(picklistId)
  const options = useMemo(
    () => crmPicklistOptions(picklist, stored || value),
    [picklist, stored, value],
  )
  const selected = options.find((option) => option.label === value)

  const item = (option: PicklistOption) => (
    <MenuItem
      key={option.label}
      value={option.label}
      // A kept value is shown so the record reads true, not offered as a
      // choice for a record that does not hold it already.
      disabled={(option.inactive || option.unlisted) && option.label !== (stored || value)}
    >
      <ListItemText
        primary={optionText(option)}
        slotProps={
          option.inactive || option.unlisted ? { primary: { color: 'text.secondary' } } : undefined
        }
      />
    </MenuItem>
  )
  // The menu's children flat — a Select reads its options from its direct
  // children, so the headings sit between them rather than around them.
  const groups = definition?.groups ?? []
  const items: ReactNode[] = groups.length
    ? groupPicklistOptions(options, groups).flatMap((section) => [
        <ListSubheader key={`group:${section.group?.id ?? ''}`}>
          {section.group?.label ?? 'No group'}
        </ListSubheader>,
        ...section.options.map(item),
      ])
    : options.map(item)

  return (
    <TextField
      select
      size="small"
      label={definition?.label ?? 'Value'}
      value={selected ? value : ''}
      onChange={(event) => onChange(String(event.target.value))}
      disabled={disabled}
      helperText={helperText}
      error={error}
      fullWidth
      slotProps={{
        select: {
          displayEmpty: true,
          renderValue: (current) => {
            const option = options.find((entry) => entry.label === current)
            return option ? optionText(option) : 'None'
          },
        },
        inputLabel: { shrink: true },
      }}
    >
      <MenuItem value="">
        <ListItemText primary="None" slotProps={{ primary: { color: 'text.secondary' } }} />
      </MenuItem>
      {items}
    </TextField>
  )
}
CrmPicklistSelect.displayName = 'CrmPicklistSelect'

export default CrmPicklistSelect
