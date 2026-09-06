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

import { type AglynOrgBilling, CRM_COLLECTIONS } from '@aglyn/aglyn'
import {
  useFirestore,
  useFirestoreCollection,
} from '@aglyn/tenant-feature-instance'
import { Button, MenuItem, Stack, TextField, Typography } from '@mui/material'
import { collection, limit, orderBy, query, where } from 'firebase/firestore'
import { useMemo } from 'react'
import { useCrmScope } from '../hooks/use-crm-scope'
import { type CompanyOption, suggestCompanyForEmail } from '../model/companies'

export { suggestCompanyForEmail, type CompanyOption }

/**
 * How many companies the picker lists.
 *
 * A ceiling and not a page: somebody choosing a company knows which one, and
 * a workspace past two hundred accounts finds it from the company list's own
 * search and links the person from there. Bounded because this read happens
 * on a contact's page, where the company list is a control and not the
 * subject.
 */
export const COMPANY_OPTIONS_LIMIT = 200

export interface CompanyOptions {
  options: CompanyOption[]
  /** The listen has answered at least once. */
  ready: boolean
  /** The ceiling cut the list, so a company can exist and not be offered. */
  truncated: boolean
}

/**
 * The companies this viewer may link a contact to, alphabetically
 * (AGL-2597).
 *
 * Read under the same `visibleTo` predicate the company list runs, because
 * the rules refuse a listen without it for a scoped member — and because a
 * picker offering a company the reader could not open would let them file a
 * person under a record they cannot see. Ordered by `nameLower`, the key
 * every company write stores, so the picker reads as a list of names rather
 * than as document-id order dressed up.
 *
 * `enabled` gates the listen: a contact's properties card has one picker and
 * a merchant who opened the record to read a note must not pay for the
 * company list.
 */
export function useCompanyOptions(props: {
  hostId: string
  org?: Partial<AglynOrgBilling> | null
  enabled?: boolean
}): CompanyOptions {
  const { hostId, org, enabled = true } = props
  const firestore = useFirestore()
  const { scope, visibleTo } = useCrmScope({ hostId, org })
  const { data, status } = useFirestoreCollection<Record<string, unknown>>(
    () =>
      enabled && scope
        ? query(
            collection(firestore, scope[0], scope[1], CRM_COLLECTIONS.companies),
            where('visibleTo', 'array-contains-any', visibleTo),
            orderBy('nameLower'),
            limit(COMPANY_OPTIONS_LIMIT + 1),
          )
        : null,
    [firestore, scope, visibleTo, enabled],
    { idField: '$id' },
  )
  const options = useMemo<CompanyOption[]>(
    () =>
      (data ?? []).slice(0, COMPANY_OPTIONS_LIMIT).map((row) => ({
        id: String(row['$id']),
        name: String(row['name'] ?? ''),
        domain: typeof row['domain'] === 'string' ? row['domain'] : null,
      })),
    [data],
  )
  return {
    options,
    ready: Boolean(scope) && status !== 'loading',
    truncated: (data?.length ?? 0) > COMPANY_OPTIONS_LIMIT,
  }
}

export interface CompanyPickerProps {
  options: readonly CompanyOption[]
  /** The linked company's id, or `null` for none. */
  value: string | null
  onChange: (companyId: string | null) => void
  label?: string
  helperText?: string
  disabled?: boolean
  /**
   * The contact's email address, when the caller has one. A company whose
   * domain matches it is offered as a suggestion beneath the field — a
   * suggestion and never an automatic link, because the person who typed
   * `@acme.com` may be a contractor, a customer of Acme's, or Acme itself.
   */
  email?: string | null
  /** The option list has answered; until then the field says it is loading. */
  ready?: boolean
}

/**
 * One company, chosen from the list a contact may be filed under
 * (AGL-2597).
 *
 * A select rather than free text, because the value is a document id and a
 * typed name is how two records called "Acme" come to exist. The empty
 * choice is a real option — "No company" — so unlinking is done in the same
 * control that links, and a saved contact with no company reads as a
 * decision rather than a field somebody skipped.
 */
export function CompanyPicker(props: CompanyPickerProps) {
  const {
    options,
    value,
    onChange,
    label = 'Company',
    helperText,
    disabled,
    email,
    ready = true,
  } = props
  const suggestion = useMemo(
    () => (email ? suggestCompanyForEmail(email, options) : null),
    [email, options],
  )
  /*
   * A stored id the list does not carry — a company past the picker's
   * ceiling, or one this viewer cannot see — still has to render as SOMETHING
   * selected, or the select would show "No company" for a contact that has
   * one and the next save would silently unlink them.
   */
  const known = value ? options.some((option) => option.id === value) : true
  return (
    <Stack spacing={0.5}>
      <TextField
        select
        size="small"
        label={label}
        value={value ?? ''}
        disabled={disabled || !ready}
        helperText={!ready ? 'Loading companies…' : helperText}
        onChange={(event) => onChange(event.target.value || null)}
      >
        <MenuItem value="">{'No company'}</MenuItem>
        {!known && value ? (
          <MenuItem value={value}>{`Company ${value.slice(-6)}`}</MenuItem>
        ) : null}
        {options.map((option) => (
          <MenuItem key={option.id} value={option.id}>
            {option.domain ? `${option.name} · ${option.domain}` : option.name}
          </MenuItem>
        ))}
      </TextField>
      {suggestion && suggestion.id !== value ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Typography variant="caption" color="text.secondary">
            {`Suggested from the email address: ${suggestion.name}`}
          </Typography>
          <Button
            size="small"
            disabled={disabled}
            onClick={() => onChange(suggestion.id)}
          >
            {'Use'}
          </Button>
        </Stack>
      ) : null}
    </Stack>
  )
}
CompanyPicker.displayName = 'CompanyPicker'

export default CompanyPicker
