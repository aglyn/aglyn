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

import { type AglynOrgMember, findOrgMember } from '@aglyn/aglyn'
import { FormControl, InputLabel, MenuItem, Select } from '@mui/material'
import { useId } from 'react'
import type { OrgMemberOptions } from '../hooks/use-org-member-options'

/** The `value` an owner select carries for "nobody". */
export const UNASSIGNED_OWNER = ''

/**
 * How a member reads in a picker: the name they set, else their address,
 * else the id — never blank, because a blank option cannot be chosen on
 * purpose.
 */
export function orgMemberLabel(
  member: Pick<AglynOrgMember, '$id' | 'displayName' | 'email'>,
): string {
  return (
    String(member.displayName ?? '').trim() ||
    String(member.email ?? '').trim() ||
    String(member.$id)
  )
}

export interface LeadOwnerSelectProps {
  value: string | null | undefined
  onChange: (uid: string) => void
  roster: OrgMemberOptions
  label?: string
  size?: 'small' | 'medium'
  disabled?: boolean
  fullWidth?: boolean
}

/**
 * The owner picker: Unassigned, then the roster by name.
 *
 * The stored value is resolved to a member first — by uid, or by an address
 * the roster has — so the picker highlights the person and a save writes
 * their uid. A value the roster does not hold is kept as its own option
 * rather than dropped, because a controlled `Select` whose value is absent
 * from its options renders empty — which would show a lead owned by
 * somebody who left as owned by nobody, and a save from that state would
 * make it true.
 */
export function LeadOwnerSelect(props: LeadOwnerSelectProps) {
  const {
    value,
    onChange,
    roster,
    label = 'Owner',
    size = 'small',
    disabled,
    fullWidth = true,
  } = props
  const resolved = findOrgMember(roster.options, value)
  const current = resolved?.uid ?? value ?? UNASSIGNED_OWNER
  const known = Boolean(resolved)
  /*
   * A bare `Select` names its combobox after the VALUE it shows, not after
   * the label beside it — MUI builds `aria-labelledby` from `labelId` and the
   * display element, and with no `labelId` only the display is left. A
   * reader hears "Unassigned" and has to guess it is the owner; a test can
   * only find the control by what it happens to say. The label's id is what
   * makes "Owner" the control's name.
   */
  const labelId = useId()
  return (
    <FormControl size={size} fullWidth={fullWidth} disabled={disabled}>
      <InputLabel id={labelId}>{label}</InputLabel>
      <Select
        labelId={labelId}
        label={label}
        value={current}
        onChange={(event) => onChange(String(event.target.value))}
      >
        <MenuItem value={UNASSIGNED_OWNER}>
          <em>{'Unassigned'}</em>
        </MenuItem>
        {current && !known ? (
          <MenuItem value={current}>{roster.labelFor(current)}</MenuItem>
        ) : null}
        {roster.options.map((option) => (
          <MenuItem key={option.uid} value={option.uid}>
            {option.label}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  )
}
LeadOwnerSelect.displayName = 'LeadOwnerSelect'

export default LeadOwnerSelect
