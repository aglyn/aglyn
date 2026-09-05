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

import { PageHeaderRecord, pluginDocsHelp, type CrmLeadFields } from '@aglyn/aglyn'
import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import {
  useFirestore,
  useFirestoreDoc,
  useOrgDataScope,
} from '@aglyn/tenant-feature-instance'
import { Button, Stack, Typography } from '@mui/material'
import { doc } from 'firebase/firestore'
import { useState } from 'react'
import { type CrmDetailPageProps, crmRoutes } from '../model/crm-routes'
import { LeadConvertDialog } from './lead-convert-dialog'
import { LeadHistoryCard } from './lead-history-card'
import { useOrgMemberOptions } from './lead-owner-select'
import { LeadPropertiesCard } from './lead-properties-card'
import { LeadUnqualifyDialog } from './lead-unqualify-dialog'

type LeadDocument = Record<string, unknown> & CrmLeadFields

/**
 * `/crm/leads/{leadId}` — one lead (AGL-2608).
 *
 * The record behind a row of the Leads section: what the person did on the
 * site, who is working them, and the conversion that turns them into a
 * contact, a company and a deal. One document listen — `hosts/{hostId}/leads`
 * is host-scoped by path, so there is no `visibleTo` to filter — and one
 * roster request for the owner picker; the convert dialog's reads open only
 * when it does.
 */
export function LeadDetailPage(props: CrmDetailPageProps) {
  const { id, hostId, org, basePath } = props
  const firestore = useFirestore()
  const routes = crmRoutes(basePath)
  const {
    data: lead,
    status,
    fromCache,
  } = useFirestoreDoc<LeadDocument>(
    () => doc(firestore, 'hosts', hostId, 'leads', id),
    [firestore, hostId, id],
  )
  const { orgId } = useOrgDataScope({ hostId })
  const roster = useOrgMemberOptions(orgId)
  const [converting, setConverting] = useState(false)
  const [unqualifying, setUnqualifying] = useState(false)

  const label = lead ? String(lead['name'] || lead['email'] || id) : undefined
  const backLink = (
    <Button
      component={AppLink as any}
      {...({ componentVariant: 'naked', nativeButton: false } as any)}
      href={routes.section('leads')}
      size="small"
      color="primary"
    >
      {'Back to leads'}
    </Button>
  )

  if (status === 'error' || (status === 'success' && !lead)) {
    return (
      <CardDisplay
        header={'Lead'}
        help={pluginDocsHelp('crmLeads', { anchor: '#a-leads-page' })}
        actions={backLink}
        contentGutterX
        contentGutterY
      >
        <Typography variant="body2" color="text.secondary">
          {status === 'error'
            ? 'This lead could not be read.'
            : 'This lead no longer exists — it may have been removed from the Inbox.'}
        </Typography>
      </CardDisplay>
    )
  }
  if (!lead) {
    return (
      <CardDisplay
        header={'Lead'}
        help={pluginDocsHelp('crmLeads', { anchor: '#a-leads-page' })}
        actions={backLink}
        contentGutterX
        contentGutterY
      >
        <Typography variant="body2" color="text.secondary">
          {'Loading…'}
        </Typography>
      </CardDisplay>
    )
  }

  return (
    <>
      {/* The page heading and the trail name the person; the cards then say
          what they hold rather than repeating the name. */}
      <PageHeaderRecord title={label} />
      <Stack spacing={3}>
        <LeadPropertiesCard
          hostId={hostId}
          leadId={id}
          lead={lead}
          leadStatus={status}
          fromCache={fromCache}
          basePath={basePath}
          roster={roster}
          onConvert={() => setConverting(true)}
          onUnqualify={() => setUnqualifying(true)}
        />
        <LeadHistoryCard hostId={hostId} leadId={id} lead={lead} />
      </Stack>
      <LeadConvertDialog
        open={converting}
        onClose={() => setConverting(false)}
        hostId={hostId}
        orgId={orgId}
        org={org as Record<string, unknown> | undefined}
        leadId={id}
        lead={lead}
        basePath={basePath}
        roster={roster}
      />
      <LeadUnqualifyDialog
        open={unqualifying}
        onClose={() => setUnqualifying(false)}
        hostId={hostId}
        leadId={id}
        leadLabel={label ?? id}
      />
    </>
  )
}
LeadDetailPage.displayName = 'LeadDetailPage'

export default LeadDetailPage
