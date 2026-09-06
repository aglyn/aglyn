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
  type AglynOrgMember,
  type CrmMemberOption,
  crmMemberOption,
  findOrgMember,
} from '@aglyn/aglyn'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import { FormControl, InputLabel, MenuItem, Select } from '@mui/material'
import { useCallback, useEffect, useId, useMemo, useState } from 'react'

/** One team member as the owner picker lists them. */
export type OrgMemberOption = CrmMemberOption

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

export interface OrgMemberOptions {
  options: OrgMemberOption[]
  loading: boolean
  error: string | null
  /**
   * A stored reference — a uid, or an address the roster has — as a name,
   * `Unassigned` for none, and honest about one the roster no longer has.
   */
  labelFor: (ref: string | null | undefined) => string
}

/**
 * The org's roster, as owner options (AGL-2608).
 *
 * Read through `GET /api/orgs/members` rather than off Firestore, because the
 * members collection's read rule cannot be satisfied by a LIST — it admits a
 * member reading their own row and an org-wide member reading all of them,
 * and the client cannot know which it is before asking. The route re-derives
 * membership with the Admin SDK and answers the whole roster to any member,
 * which is what a picker needs: every person a lead could be handed to.
 *
 * One request per org per mount. The list and the record page both read it,
 * and the label column on the list needs it before anybody clicks, so it is
 * paid on mount — bounded by the size of the team, not by the data.
 */
export function useOrgMemberOptions(
  orgId: string | null | undefined,
): OrgMemberOptions {
  const { data: user } = useUser()
  const [members, setMembers] = useState<OrgMemberOption[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!orgId || !user) return
    let cancelled = false
    setMembers(null)
    setError(null)
    void (async () => {
      const response = await authorizedFetch(
        user,
        `/api/orgs/members?orgId=${encodeURIComponent(orgId)}`,
      )
      const body = (await response.json().catch(() => ({}))) as {
        members?: unknown
        error?: unknown
      }
      if (cancelled) return
      if (!response.ok) {
        setError(String(body?.error ?? 'The team could not be loaded.'))
        setMembers([])
        return
      }
      const list = (Array.isArray(body?.members) ? body.members : []) as AglynOrgMember[]
      setMembers(
        list
          .map((member) => crmMemberOption(member as unknown as Record<string, unknown>))
          .filter((option): option is OrgMemberOption => option !== null)
          .sort((a, b) => a.label.localeCompare(b.label)),
      )
    })()
    return () => {
      cancelled = true
    }
  }, [orgId, user])

  const options = useMemo(() => members ?? [], [members])
  const labelFor = useCallback(
    (ref: string | null | undefined) => {
      if (!ref) return 'Unassigned'
      // A reference the roster does not carry is a member who has left;
      // naming that is better than an id nobody recognizes or a blank that
      // reads as unassigned.
      return findOrgMember(options, ref)?.label ?? 'Former member'
    },
    [options],
  )
  return useMemo(
    () => ({
      options,
      loading: Boolean(orgId) && members === null && !error,
      error,
      labelFor,
    }),
    [options, orgId, members, error, labelFor],
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
