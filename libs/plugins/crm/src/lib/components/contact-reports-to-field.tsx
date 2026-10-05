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

import type { AglynOrgBilling } from '@aglyn/aglyn'
import { useCrmRecordNames } from '../hooks/use-crm-record-names'
import { useCrmScope } from '../hooks/use-crm-scope'
import CrmRecordPicker from './crm-record-picker'

export interface ContactReportsToFieldProps {
  /** The site the record is read under, or `null` at the organization level. */
  hostId: string | null
  org?: Partial<AglynOrgBilling> | null
  /** The record being edited — never offered as its own manager. */
  contactId: string
  /** The holder whose facet names the contacts. */
  groupId: string
  /** The manager's contact id, or `''` for none. */
  value: string
  onChange: (contactId: string) => void
  disabled?: boolean
}

/**
 * Salesforce's Reports To on a contact (AGL-3515): another contact the
 * holder can see, picked from the contacts this site lists.
 *
 * The listen opens only when the menu does — a record page is read far more
 * often than its manager is changed — and the current manager is named by
 * one cached read, so the field reads as a person rather than an id while
 * the menu is closed. `crm/contact-update` refuses the record itself and a
 * pick that would make a loop; the picker leaves the record itself out so
 * the first of those is never offered.
 */
export function ContactReportsToField(props: ContactReportsToFieldProps) {
  const { hostId, org, contactId, groupId, value, onChange, disabled } = props
  const scope = useCrmScope({ hostId, org })
  const nameOf = useCrmRecordNames({
    orgId: scope.orgId,
    groupId: groupId || null,
    org: (org ?? null) as Record<string, unknown> | null,
    records: value ? [{ kind: 'contact', id: value }] : [],
  })
  return (
    <CrmRecordPicker
      kind="contact"
      label="Reports to"
      scope={scope.scope}
      readTokens={scope.visibleTo}
      groupId={groupId || null}
      org={(org ?? null) as Record<string, unknown> | null}
      value={value || null}
      valueLabel={value ? nameOf('contact', value) : undefined}
      excludeId={contactId}
      onChange={(id) => onChange(id ?? '')}
      disabled={disabled}
      lazy
      helperText="This person's manager, from your contacts"
    />
  )
}
ContactReportsToField.displayName = 'ContactReportsToField'

export default ContactReportsToField
