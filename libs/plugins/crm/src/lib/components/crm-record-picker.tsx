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
  useFirestore,
  useFirestoreCollection,
} from '@aglyn/tenant-feature-instance'
import { Autocomplete, TextField } from '@mui/material'
import { collection, limit, orderBy, query } from 'firebase/firestore'
import { useMemo, useState } from 'react'
import {
  CRM_RECORD_COLLECTIONS,
  type CrmRecordKind,
  crmRecordName,
} from '../hooks/use-crm-record-names'
import { crmVisibleToClause } from '../hooks/use-crm-scope'
import { contactPrimaryGroup } from '../model/contact-record'

/**
 * How many records a picker offers. The window is the hundred most recently
 * touched, which is the hundred a person is most likely to be making a task
 * about; the field says so, and the record pages' own "New task" buttons
 * arrive with the record already linked, which is how a task about an older
 * one gets made.
 */
export const CRM_RECORD_PICKER_LIMIT = 100

const PICKER_LABELS: Record<CrmRecordKind, string> = {
  contact: 'Contact',
  company: 'Company',
  deal: 'Deal',
}

export interface CrmRecordPickerProps {
  kind: CrmRecordKind
  scope: readonly [string, string] | null
  /** The reader's tokens, or `null` at the organization level — no clause (AGL-2630). */
  readTokens: readonly string[] | null
  /**
   * The viewing group, for a contact's facet name — or `null` at the
   * organization level, where each contact is named through its own
   * primary holder (`contactPrimaryGroup`), resolved from {@link org}.
   */
  groupId: string | null
  /** The org document, for the per-contact holder when {@link groupId} is null. */
  org?: Record<string, unknown> | null
  value: string | null
  onChange: (id: string | null) => void
  disabled?: boolean
  /** The field's label; the record kind's name by default. */
  label?: string
  /** A record the picker never offers — the record being edited, say. */
  excludeId?: string
  /**
   * The current value's name, when the caller already resolved it — shown
   * instead of the id while the window does not hold the record.
   */
  valueLabel?: string
  /**
   * Open the listener only once the menu is first opened, for a picker that
   * sits on a page most readers never change it on.
   */
  lazy?: boolean
  helperText?: string
}

/**
 * Link a task to a contact, company or deal by name (AGL-2599).
 *
 * One query shape for all three kinds — the most recently updated hundred
 * visible to this site, filtered as the person types — because that is the
 * one shape every CRM collection has an index for (`visibleTo, updatedAt`).
 * A prefix search on the stored name would need `(visibleTo, nameLower)`,
 * which companies have and contacts do not, and a picker that searched two
 * kinds properly and one kind not at all would be worse to explain than a
 * window. The listener opens with the drawer and closes with it.
 */
export function CrmRecordPicker(props: CrmRecordPickerProps) {
  const { kind, scope, readTokens, groupId, org, value, onChange, disabled } = props
  const { label, excludeId, valueLabel, lazy = false, helperText } = props
  const firestore = useFirestore()
  const [opened, setOpened] = useState(!lazy)
  const { data, status } = useFirestoreCollection<Record<string, unknown> & { $id: string }>(
    () =>
      scope && opened
        ? query(
            collection(firestore, scope[0], scope[1], CRM_RECORD_COLLECTIONS[kind]),
            ...crmVisibleToClause(readTokens),
            orderBy('updatedAt', 'desc'),
            limit(CRM_RECORD_PICKER_LIMIT),
          )
        : null,
    [firestore, scope, readTokens, kind, opened],
    { idField: '$id' },
  )
  const options = useMemo(
    () =>
      (data ?? [])
        .filter((row) => row.$id !== excludeId)
        .map((row) => ({
          id: row.$id,
          label:
            crmRecordName(
              kind,
              row,
              groupId ?? contactPrimaryGroup(row, org).groupId,
            ) || row.$id,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [data, kind, groupId, org, excludeId],
  )
  /*
   * The linked record may sit outside the window — an old contact a record
   * page's button linked — so the value is a placeholder carrying its id
   * until (unless) the window turns out to hold it.
   */
  const selected = useMemo(() => {
    if (!value) return null
    return (
      options.find((option) => option.id === value) ?? { id: value, label: valueLabel || value }
    )
  }, [options, value, valueLabel])

  return (
    <Autocomplete
      options={options}
      value={selected}
      onChange={(_event, next) => onChange(next?.id ?? null)}
      onOpen={() => setOpened(true)}
      getOptionLabel={(option) => option.label}
      isOptionEqualToValue={(option, current) => option.id === current.id}
      loading={opened && status === 'loading'}
      disabled={disabled}
      size="small"
      renderInput={(params) => (
        <TextField
          {...params}
          label={label ?? PICKER_LABELS[kind]}
          helperText={
            options.length >= CRM_RECORD_PICKER_LIMIT
              ? `The ${CRM_RECORD_PICKER_LIMIT} most recently updated — type to narrow.`
              : helperText
          }
        />
      )}
    />
  )
}
CrmRecordPicker.displayName = 'CrmRecordPicker'

export default CrmRecordPicker
