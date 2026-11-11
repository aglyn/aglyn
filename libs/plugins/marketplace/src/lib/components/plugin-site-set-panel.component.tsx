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

import { Alert, CircularProgress, Stack, Typography } from '@mui/material'
import { doc, getDoc } from 'firebase/firestore'
import { useEffect, useMemo, useState } from 'react'
import {
  useFirestore,
  useFirestoreDoc,
  useHostOrgIdState,
} from '@aglyn/tenant-feature-instance'
import { offeredPluginVersion } from '@aglyn/aglyn'
import {
  installPictureReadPhase,
  resolveOrgInstallSummary,
  type OrgInstallHost,
} from '../model/marketplace'
import { useMarketplaceActions } from '../hooks/use-marketplace-actions'
import PluginSiteSet from './plugin-site-set.component'

export interface PluginSiteSetPanelProps {
  /** Acting site — org pins still resolve their org through one. */
  hostId: string
  listingId: string
  /**
   * Every site, with its own `disabledPlugins` when the page has it
   * (AGL-4047): a site that switched this listing off is pinned but does not
   * run it, and the panel says so instead of listing it as running.
   */
  hosts?: ReadonlyArray<OrgInstallHost>
  /**
   * Whether `hosts` is the whole site list yet (AGL-4047). Absent reads as
   * true, for a caller that only mounts this once its sites are known.
   */
  hostsReady?: boolean
  /**
   * The workspace, when the page knows it (AGL-4047). Read through the
   * acting site otherwise, and that lookup is a one-shot read that settles
   * to "no org" when it fails, after which no org pin is ever read.
   */
  orgId?: string
}

/**
 * The `pluginSiteSet` slot (AGL-1007): the site-set control as something the
 * console can drop onto the installation detail page without importing this
 * plugin.
 *
 * It reads its own pins rather than taking them as props, because the page
 * that hosts it has no other use for them — unlike the listing page, which
 * also gates its pre-install picker and primary button on the same state and
 * therefore keeps ownership of it there.
 */
export function PluginSiteSetPanel(props: PluginSiteSetPanelProps) {
  const { hostId, listingId, hosts, hostsReady = true } = props
  const firestore = useFirestore()
  const hostOrg = useHostOrgIdState(props.orgId ? undefined : hostId)
  const orgId = props.orgId || hostOrg.orgId
  const { installPlan, uninstall } = useMarketplaceActions(hostId)

  // Held at null while `useHostOrgId` is in flight, never `orgs/-pending-`
  // (AGL-1440): installs are member-gated, so the sentinel was a
  // guaranteed-denied listen on every mount of this panel.
  const orgPinRead = useFirestoreDoc<any>(
    () =>
      orgId && listingId
        ? doc(firestore, 'orgs', orgId, 'installs', listingId)
        : null,
    [firestore, orgId, listingId],
  )
  const orgPin = orgPinRead.data
  const [sitePins, setSitePins] = useState<Record<string, any>>({})
  const [pinsNonce, setPinsNonce] = useState(0)
  const hostIdsKey = (hosts ?? []).map((host) => host.id).join('|')
  /** The site set the pins answer for, or that reading them failed (AGL-4047). */
  const [sitePinsFor, setSitePinsFor] = useState<string | null>(null)
  const [sitePinsFailed, setSitePinsFailed] = useState(false)
  useEffect(() => {
    setSitePinsFailed(false)
    if (!listingId || !hosts?.length) return
    let active = true
    void Promise.all(
      hosts.map(async (host) => {
        const snapshot = await getDoc(
          doc(firestore, 'hosts', host.id, 'installs', listingId),
        )
        return [host.id, snapshot.exists() ? snapshot.data() : null] as const
      }),
    )
      .then((entries) => {
        if (!active) return
        setSitePins(Object.fromEntries(entries))
        setSitePinsFor(`${listingId}:${hostIdsKey}`)
      })
      .catch(() => {
        if (active) setSitePinsFailed(true)
      })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firestore, listingId, hostIdsKey, pinsNonce])

  // The listing, for the version actually on offer (AGL-1017). This used to
  // pass a PIN's own version as `latestVersion`, which is by definition the
  // version that pin is already at — so no site ever looked stale and the
  // update control never appeared on this page at all.
  const { data: listing } = useFirestoreDoc<any>(
    () => doc(firestore, 'marketplaceListings', listingId || '-missing-'),
    [firestore, listingId],
  )

  // The kill switch (AGL-2368). This panel offers an UPDATE, so it is asking
  // "what installs today" and had only the review-verdict mirror to ask —
  // which nothing cleared on revoke, so it offered a version the install
  // route refuses. Listing-scoped and public, one read for the panel.
  const { data: revocation } = useFirestoreDoc<any>(
    () =>
      listingId ? doc(firestore, 'revocations', listingId) : null,
    [firestore, listingId],
  )

  const orgInstall = useMemo(
    () =>
      resolveOrgInstallSummary(hosts ?? [], sitePins, orgPin ?? null, listingId),
    [hosts, sitePins, orgPin, listingId],
  )
  // The listing doc the actions need. The pin carries the denormalised copy
  // the actions actually read (`$id`, `displayName`, `pluginId`), so this page
  // does not pay for a second read of the listing itself. `pluginId` is what
  // the uninstall dialog scans published pages by; without it the impact is
  // unknown and every uninstall asks for the typed acknowledgement.
  const anyPin = orgPin ?? Object.values(sitePins).find(Boolean) ?? null
  const actionListing = useMemo(
    () => ({
      $id: listingId,
      displayName: listing?.displayName ?? anyPin?.displayName ?? listingId,
      artifactType: 'plugin',
      latestVersion: listing?.latestVersion ?? anyPin?.version,
      pluginId: listing?.pluginId ?? anyPin?.pluginId,
    }),
    [
      listingId,
      listing?.displayName,
      listing?.latestVersion,
      listing?.pluginId,
      anyPin?.displayName,
      anyPin?.version,
      anyPin?.pluginId,
    ],
  )

  /*
   * Loading is said as loading (AGL-4047). "Not installed" rests on no pin
   * anywhere, and a pin the server has not answered for yet is not absent:
   * this page said "Not installed on any site" for seconds about a plugin
   * running org-wide.
   */
  const readPhase = installPictureReadPhase({
    orgPin: !listingId
      ? null
      : orgId
        ? orgPinRead
        : props.orgId || !hostOrg.loaded
          ? 'pending'
          : null,
    sitePins: sitePinsFailed
      ? 'failed'
      : !hostsReady
        ? 'loading'
        : !hosts?.length || sitePinsFor === `${listingId}:${hostIdsKey}`
          ? 'answered'
          : 'loading',
  })
  if (readPhase === 'loading') {
    return (
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <CircularProgress size={16} />
        <Typography variant="body2" color="text.secondary">
          {'Loading where it is installed…'}
        </Typography>
      </Stack>
    )
  }
  if (readPhase === 'error') {
    return (
      <Alert severity="warning">
        {'Could not load where this plugin is installed. Reload the page to ' +
          'try again.'}
      </Alert>
    )
  }

  if (!orgInstall.installedAnywhere) {
    return (
      <Typography variant="body2" color="text.secondary">
        {'Not installed on any site in this organization.'}
      </Typography>
    )
  }

  return (
    <PluginSiteSet
      listing={actionListing}
      hosts={hosts ?? []}
      orgInstall={orgInstall}
      // The newest INSTALLABLE version (AGL-1016/2368) — never `latestVersion`,
      // and never the review verdict alone, or the page offers an update the
      // install route refuses.
      latestVersion={offeredPluginVersion(listing, revocation) ?? undefined}
      installPlan={installPlan}
      uninstall={uninstall}
      onChanged={() => setPinsNonce((current) => current + 1)}
    />
  )
}

PluginSiteSetPanel.displayName = 'PluginSiteSetPanel'

export default PluginSiteSetPanel
