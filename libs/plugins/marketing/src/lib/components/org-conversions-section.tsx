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

import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { MenuItem, Stack, TextField, Typography } from '@mui/material'
import { useEffect, useState } from 'react'
import CampaignConversionsCard from './campaign-conversions-card'
import { useMarketingOrgMount } from './marketing-org-mount'

/**
 * The session's memory of the site this section reads, per org. Session
 * storage rather than local, for the reason the CRM's own site pick gives:
 * it is a convenience for one sitting, and a site remembered for weeks
 * would open on figures the reader had forgotten choosing.
 */
export const conversionsSiteStorageKey = (orgId: string) =>
  `aglyn.marketing.conversionsSite.${orgId}`

function readRememberedSite(orgId: string): string | null {
  try {
    return window.sessionStorage.getItem(conversionsSiteStorageKey(orgId))
  } catch {
    return null
  }
}

function writeRememberedSite(orgId: string, hostId: string): void {
  try {
    window.sessionStorage.setItem(conversionsSiteStorageKey(orgId), hostId)
  } catch {
    // A browser that refuses storage still gets the pick for this page.
  }
}

export interface OrgConversionsSectionProps {
  /** The org Marketing hub, `/[orgSlug]/marketing` — each credited campaign opens under it. */
  basePath: string
  /** One campaign's conversions, from `…/conversions/{campaignId}`. */
  campaignId?: string
}

/**
 * The organization's Conversions section: ONE site's conversions at a time.
 *
 * A conversion is recorded by the site the visitor converted on — its
 * attribution records, its submissions, its bookings — and the card that
 * reads them is the site hub's own, unchanged, handed the site picked here.
 * Merging several sites into one list would put two different sites'
 * "not credited" figures under one heading, and there is no org-wide
 * collection of attributions to read instead.
 *
 * The pick defaults to the org's first site and is remembered for the
 * session. A remembered site the org no longer lists is forgotten rather
 * than read.
 */
export function OrgConversionsSection(props: OrgConversionsSectionProps) {
  const { basePath, campaignId } = props
  const mount = useMarketingOrgMount()
  const orgId = mount?.orgId ?? ''
  /*
   * Resolved after mount rather than in the initializer, so the first client
   * paint agrees with the server's — and the card waits for it, because
   * mounting on the first site and then remounting on the remembered one
   * would pay for the first site's reads on the way.
   */
  const [picked, setPicked] = useState<{
    orgId: string
    hostId: string | null
  } | null>(null)
  useEffect(() => {
    if (orgId) setPicked({ orgId, hostId: readRememberedSite(orgId) })
  }, [orgId])

  if (!mount || !mount.hostsReady || picked?.orgId !== orgId) return null

  const sites = mount.hosts
  const hostId =
    picked.hostId && sites.some((site) => site.id === picked.hostId)
      ? picked.hostId
      : (sites[0]?.id ?? null)

  if (!hostId) {
    return (
      <CardDisplay header="Conversions" contentGutterX contentGutterY>
        <Typography variant="body2" color="text.secondary">
          {'Conversions are recorded by the site a visitor converts on, and ' +
            'this organization has no sites yet.'}
        </Typography>
      </CardDisplay>
    )
  }

  return (
    <Stack spacing={2}>
      {sites.length > 1 ? (
        <TextField
          select
          size="small"
          label="Conversions on"
          value={hostId}
          onChange={(event) => {
            const next = event.target.value
            setPicked({ orgId, hostId: next })
            writeRememberedSite(orgId, next)
          }}
          sx={{ maxWidth: 320 }}
        >
          {sites.map((site) => (
            <MenuItem key={site.id} value={site.id}>
              {site.name || site.subdomain || site.id}
            </MenuItem>
          ))}
        </TextField>
      ) : null}
      {/* Keyed by site, so nothing one site's card was holding survives into another's. */}
      <CampaignConversionsCard
        key={hostId}
        hostId={hostId}
        basePath={basePath}
        campaignId={campaignId}
      />
    </Stack>
  )
}
OrgConversionsSection.displayName = 'OrgConversionsSection'

export default OrgConversionsSection
