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
  pluginDocsHelp,
  type CrmLeadFields,
  leadPrimaryGroup,
  normalizeContactEmail,
  readErasureRequestedAtMs,
} from '@aglyn/aglyn'
import {
  useFirestore,
  useFirestoreDoc,
  useHostCampaigns,
} from '@aglyn/tenant-feature-instance'
import { Stack, Typography } from '@mui/material'
import { doc } from 'firebase/firestore'
import { useMemo, useState } from 'react'
import { useCampaignFilingLog } from '../hooks/use-campaign-filing-log'
import { CrmCreateSiteDefault } from '../hooks/use-crm-org-mount'
import { useCrmScope } from '../hooks/use-crm-scope'
import { useOrgMemberOptions } from '../hooks/use-org-member-options'
import { type CrmDetailPageProps, crmRoutes } from '../model/crm-routes'
import { CrmRecordChip, CrmRecordHeader } from './crm-record-header'
import { CrmRecordInsightsZone } from './crm-record-insights-zone'
import { useErasePersonAction } from './erase-person-action'
import { LeadCampaignsCard, leadCampaignNames } from './lead-campaigns-card'
import { LeadConvertDialog } from './lead-convert-dialog'
import { LeadHistoryCard } from './lead-history-card'
import { LeadPropertiesCard } from './lead-properties-card'
import { LeadUnqualifyDialog } from './lead-unqualify-dialog'
import { RecordActivityCard } from './record-activity-card'

type LeadDocument = Record<string, unknown> & CrmLeadFields

/**
 * `/crm/leads/{leadId}` — one lead (AGL-2608).
 *
 * The record behind a row of the Leads section: what the person did on the
 * site, who is working them, and the conversion that turns them into a
 * contact, a company and a deal. One document listen and one roster request
 * for the owner picker; the convert dialog's reads open only when it does.
 *
 * ## The two levels, and the site a lead is acted on as (AGL-3278)
 *
 * The org root comes from `useCrmScope`, as it does on every other CRM
 * record page: under a site it is looked up from that site, and at the
 * organization level it is the mount's, known at once. It used to come
 * from `useOrgDataScope({ hostId })` — correct only under a site, because
 * an absent host settles at `orgId: null`, and a null org builds no
 * reference, opens no listener and leaves the page loading forever.
 *
 * Several surfaces still need ONE site: the campaigns to offer, the feed
 * an activity is filed in, the booking door, the consent basis, the
 * conversion. Under a site that is the mounted one. At the organization
 * level it is the lead's own first capturing site — `leadPrimaryGroup` —
 * the same answer `contactPrimaryGroup` gives the contact page, and the
 * same one the Leads list already converts a row as.
 */
export function LeadDetailPage(props: CrmDetailPageProps) {
  const { id, hostId, org, basePath } = props
  const firestore = useFirestore()
  const routes = crmRoutes(basePath)
  /*
   * Resolved BEFORE the read that needs it (AGL-3275). A lead is an org row
   * now, so the org has to be known to address one — and `scope` is null
   * while the host-index lookup settles. Handing that null to `doc()` is a
   * thrown `TypeError`, which the page renders as a 500 rather than as a
   * record still loading.
   */
  const { scope, orgId, ready, consentGroup: viewingGroup } = useCrmScope({
    hostId,
    org,
  })
  const {
    data: lead,
    status,
    fromCache,
  } = useFirestoreDoc<LeadDocument>(
    () => (scope ? doc(firestore, scope[0], scope[1], 'leads', id) : null),
    [firestore, scope, id],
  )
  /*
   * The group this lead is READ through: the mounted site's under a site,
   * and the lead's own first capturing site at the organization level
   * (AGL-3278). The consent basis is read against it — a refusal recorded
   * for any sibling in a declared group stands against every one of them,
   * so a group of one would report a person as opted in who had
   * unsubscribed from the brand beside this one.
   */
  const leadGroup = useMemo(
    () => viewingGroup ?? leadPrimaryGroup(lead, org as Record<string, unknown>),
    [viewingGroup, lead, org],
  )
  /** The one site this page acts as, or null for a lead no site captured. */
  const siteHostId = hostId ?? (leadGroup.hostId || null)
  const roster = useOrgMemberOptions(orgId)
  /*
   * The site's campaigns, read once for the page (AGL-3274): the header
   * names the ones the lead is filed under and the Campaigns card offers
   * them. One listener, not one per surface — the containers are the
   * capturing site's.
   */
  const campaigns = useHostCampaigns(siteHostId ?? undefined, { enabled: true })
  // A saved filing is written on the lead's Activity too (AGL-3274), one
  // entry per campaign added or removed, by the member who saved it.
  const logFiling = useCampaignFilingLog({
    orgId,
    hostId: siteHostId,
    org: org as Record<string, unknown> | undefined,
  })
  const [converting, setConverting] = useState(false)
  const [unqualifying, setUnqualifying] = useState(false)
  // The privacy erasure (AGL-2623), offered from the lead as from the
  // contact: the same request, filed by the lead's address.
  const leadEmail = lead ? normalizeContactEmail(lead['email']) : null
  const erase = useErasePersonAction({
    hostId: siteHostId,
    orgId,
    subject: lead && leadEmail ? { kind: 'lead', id, email: leadEmail } : null,
    requestedAtMs: readErasureRequestedAtMs(lead),
  })

  const label = lead ? String(lead['name'] || lead['email'] || id) : undefined

  /*
   * A SETTLED lookup with no org is an answer, not a wait (AGL-3278). The
   * spinner below is for a read in flight; standing on it once `ready` has
   * said there is no org to read from is the endless "Loading…" this page
   * shipped with.
   */
  const noOrg = ready && !scope
  if (noOrg || status === 'error' || (status === 'success' && !lead)) {
    return (
      <CrmRecordHeader
        kind="Lead"
        title={undefined}
        help={pluginDocsHelp('crmLeads', { anchor: '#a-leads-page' })}
        backHref={routes.section('leads')}
        backLabel="Back to leads"
      >
        <Typography variant="body2" color="text.secondary">
          {noOrg || status === 'error'
            ? 'This lead could not be read.'
            : 'This lead no longer exists — it may have been removed from the Inbox.'}
        </Typography>
      </CrmRecordHeader>
    )
  }
  if (!lead) {
    return (
      <CrmRecordHeader
        kind="Lead"
        title={undefined}
        help={pluginDocsHelp('crmLeads', { anchor: '#a-leads-page' })}
        backHref={routes.section('leads')}
        backLabel="Back to leads"
        loading
      />
    )
  }

  return (
    /* A task or an activity created from this page defaults to the lead's
       own site, not to the site the reader last picked in a list's drawer
       (AGL-2630) — as on every other record page. */
    <CrmCreateSiteDefault hostId={siteHostId}>
      {/* The properties card is the record's lead card: it publishes the
          page heading and the trail, so the history card under it says what
          it holds rather than repeating the name. */}
      <Stack spacing={3}>
        <LeadPropertiesCard
          hostId={siteHostId}
          consentGroup={leadGroup}
          orgId={orgId}
          leadId={id}
          lead={lead}
          leadStatus={status}
          fromCache={fromCache}
          basePath={basePath}
          roster={roster}
          onConvert={() => setConverting(true)}
          onUnqualify={() => setUnqualifying(true)}
          extraMenuItems={erase.menuItems}
          banner={erase.banner}
          erasurePending={erase.pendingSinceMs !== null}
          org={org}
          // The campaigns the lead is filed under (AGL-3274), by name
          // beside the status. An id no container answers for draws no
          // chip: the card below keeps it, the header only names.
          extraChips={leadCampaignNames(lead, campaigns.options).map((name) => (
            <CrmRecordChip key={name} label="Campaign" value={name} />
          ))}
        />
        {/* What an assistant says about where the lead stands (AGL-2917): read on its own site. */}
        <CrmRecordInsightsZone
          hostId={siteHostId}
          org={org as Record<string, unknown> | undefined}
          kind="lead"
          recordId={id}
          name={label ?? ''}
        />
        <LeadCampaignsCard
          hostId={siteHostId}
          leadId={id}
          lead={lead}
          leadStatus={status}
          fromCache={fromCache}
          options={campaigns.options}
          optionsReady={campaigns.ready}
          onFiled={({ added, removed }) => {
            const named = (ids: string[]) =>
              ids.map((campaignId) => ({
                id: campaignId,
                name: campaigns.options.find((option) => option.value === campaignId)?.label ?? '',
              }))
            void logFiling({ leadId: id }, { filed: named(added), removed: named(removed) })
          }}
        />
        <LeadHistoryCard hostId={siteHostId} leadId={id} lead={lead} />
        <RecordActivityCard hostId={siteHostId} org={org} leadId={id} />
      </Stack>
      <LeadConvertDialog
        open={converting}
        onClose={() => setConverting(false)}
        hostId={siteHostId}
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
        hostId={siteHostId}
        leadId={id}
        leadLabel={label ?? id}
      />
      {erase.dialog}
    </CrmCreateSiteDefault>
  )
}
LeadDetailPage.displayName = 'LeadDetailPage'

export default LeadDetailPage
