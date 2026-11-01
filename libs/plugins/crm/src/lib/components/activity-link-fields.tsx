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

import { dealContactRolesOf } from '@aglyn/aglyn'
import { Box, FormHelperText, Stack } from '@mui/material'
import { useMemo } from 'react'
import { useCrmRecordNames } from '../hooks/use-crm-record-names'
import type { CrmActivityPicks } from '../model/crm-activity-link'
import type { ActivityRecordLink, ActivityScope } from './activity-queries'
import { CrmRecordPicker } from './crm-record-picker'
import { CrmRelatedToPicker } from './crm-related-to-picker'

export interface ActivityLinkFieldsProps {
  /** Where the fields read, from `useActivityScope`. */
  scope: ActivityScope
  picks: CrmActivityPicks
  onChange: (picks: CrmActivityPicks) => void
  /** The record the dialog was opened on. */
  link: ActivityRecordLink
  /** The deal page's own document, whose contact roles lead **Name**. */
  deal?: { contactId?: unknown; contactRoles?: unknown } | null
  disabled?: boolean
}

/**
 * **Name** and **Related To** on the log dialog (AGL-4123): who the entry is
 * with, and the company or deal it is about. Salesforce's Who and What.
 *
 * A component of its own so that its reads are the open dialog's: MUI mounts
 * a closed dialog's content only once it opens, and the dialog itself stays
 * mounted on every record page.
 *
 * On a deal's page every contact role leads **Name**, whichever part they
 * play and however long since they were updated; the list below still offers
 * anybody else this reader may see, so a call with a colleague at the same
 * company can be logged without first adding them to the deal.
 */
export function ActivityLinkFields(props: ActivityLinkFieldsProps) {
  const { scope, picks, onChange, link, deal, disabled } = props
  const { dataScope, orgId, readTokens, consentGroup, org } = scope
  const groupId = consentGroup?.groupId ?? null
  const { contactId, related } = picks
  const roleIds = useMemo(
    () => (deal ? dealContactRolesOf(deal).map((row) => row.contactId) : []),
    [deal],
  )
  const names = useCrmRecordNames({
    orgId,
    groupId,
    org,
    records: [
      ...roleIds.map((id) => ({ kind: 'contact' as const, id })),
      ...(contactId ? [{ kind: 'contact' as const, id: contactId }] : []),
      ...(related ? [related] : []),
    ],
  })
  const pinned = roleIds.flatMap((id) => {
    const label = names('contact', id)
    return label ? [{ id, label }] : []
  })
  return (
    <Stack spacing={0.5}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <CrmRecordPicker
            kind="contact"
            label="Name"
            scope={dataScope}
            readTokens={readTokens}
            groupId={groupId}
            org={org}
            value={contactId}
            // The kind until the name lands, and for one nobody can name: an id
            // means nothing to anybody.
            valueLabel={contactId ? (names('contact', contactId) ?? 'Contact') : undefined}
            onChange={(id) => onChange({ ...picks, contactId: id })}
            pinned={pinned}
            pinnedLabel="On this deal"
            disabled={disabled}
            lazy
          />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <CrmRelatedToPicker
            scope={dataScope}
            orgId={orgId}
            readTokens={readTokens}
            contactId={contactId}
            companyId={related?.kind === 'company' ? related.id : (link.companyId ?? null)}
            value={related}
            valueLabel={related ? names(related.kind, related.id) : undefined}
            onChange={(next) => onChange({ ...picks, related: next })}
            disabled={disabled}
          />
        </Box>
      </Stack>
      {contactId || related ? null : (
        <FormHelperText error>{'Name a contact, or what this is related to.'}</FormHelperText>
      )}
    </Stack>
  )
}
ActivityLinkFields.displayName = 'ActivityLinkFields'

export default ActivityLinkFields
