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

import { Autocomplete, TextField } from '@mui/material'
import { useMemo, useState } from 'react'
import { useCrmFoldsScope } from '../hooks/use-crm-list-query'
import { useContactRoleDeals, useLinkedDeals } from '../hooks/use-deals'
import {
  type CrmActivityRelated,
  type CrmPickerRow,
  type CrmRelatedToOption,
  crmRelatedToOptions,
} from '../model/crm-activity-link'
import { CRM_RECORD_PICKER_LIMIT, useCrmRecordWindow } from './crm-record-picker'

export interface CrmRelatedToPickerProps {
  /** The org root, or `null` until it is known. */
  scope: readonly [string, string] | null
  orgId: string | null
  /** The reader's tokens, or `null` at the organization level. */
  readTokens: readonly string[] | null
  /** The contact the entry is with, whose open deals lead the list. */
  contactId: string | null
  /** The company the entry is about, whose open deals lead the list. */
  companyId: string | null
  value: CrmActivityRelated | null
  /** The current value's name, shown while the lists do not hold the record. */
  valueLabel?: string
  onChange: (next: CrmActivityRelated | null) => void
  disabled?: boolean
}

type RelatedOption = CrmRelatedToOption

const sameRecord = (a: CrmActivityRelated, b: CrmActivityRelated) =>
  a.kind === b.kind && a.id === b.id

/**
 * An activity's **Related To** (AGL-4123), Salesforce's What: one company or
 * one deal.
 *
 * The open deals of the person and the company on the entry lead the list,
 * because logging a call with someone who has a deal in flight is the case
 * this field exists for: naming that deal puts the entry on it too. Below
 * them sit the windows every record picker offers, so an older record stays
 * one search away. Nothing listens until the menu is first opened, because
 * most entries are saved with the field as it opened.
 */
export function CrmRelatedToPicker(props: CrmRelatedToPickerProps) {
  const { scope, orgId, readTokens, contactId, companyId, value, valueLabel, onChange, disabled } =
    props
  const [opened, setOpened] = useState(false)
  const companies = useCrmRecordWindow('company', scope, readTokens, opened)
  const deals = useCrmRecordWindow('deal', scope, readTokens, opened)
  const foldsScope = useCrmFoldsScope(orgId, readTokens)
  const contactDeals = useLinkedDeals(orgId, readTokens, {
    contactId: opened ? (contactId ?? '') : '',
  })
  const roleDeals = useContactRoleDeals(
    orgId,
    readTokens,
    foldsScope,
    opened ? contactId : null,
  )
  const companyDeals = useLinkedDeals(orgId, readTokens, {
    companyId: opened ? (companyId ?? '') : '',
  })

  const options = useMemo<RelatedOption[]>(
    () =>
      crmRelatedToOptions({
        linkedDeals: [
          ...(contactDeals.data ?? []),
          ...(roleDeals.data ?? []),
          ...(companyDeals.data ?? []),
        ] as unknown as CrmPickerRow[],
        deals: deals.data ?? [],
        companies: companies.data ?? [],
      }),
    [contactDeals.data, roleDeals.data, companyDeals.data, deals.data, companies.data],
  )

  const windowFull =
    (companies.data?.length ?? 0) >= CRM_RECORD_PICKER_LIMIT ||
    (deals.data?.length ?? 0) >= CRM_RECORD_PICKER_LIMIT

  const selected = useMemo<RelatedOption | null>(() => {
    if (!value) return null
    return (
      options.find((option) => sameRecord(option, value)) ?? {
        ...value,
        label: valueLabel || (value.kind === 'deal' ? 'Deal' : 'Company'),
        group: '',
      }
    )
  }, [options, value, valueLabel])

  return (
    <Autocomplete
      options={options}
      value={selected}
      onChange={(_event, next) =>
        onChange(next ? { kind: next.kind, id: next.id } : null)
      }
      onOpen={() => setOpened(true)}
      getOptionLabel={(option) => option.label}
      getOptionKey={(option) => `${option.kind}:${option.id}`}
      isOptionEqualToValue={(option, current) => sameRecord(option, current)}
      groupBy={(option) => option.group}
      loading={opened && (companies.status === 'loading' || deals.status === 'loading')}
      disabled={disabled}
      size="small"
      renderInput={(params) => (
        <TextField
          {...params}
          label="Related To"
          helperText={
            windowFull ? `The ${CRM_RECORD_PICKER_LIMIT} most recently updated — type to narrow.` : undefined
          }
        />
      )}
    />
  )
}
CrmRelatedToPicker.displayName = 'CrmRelatedToPicker'

export default CrmRelatedToPicker
