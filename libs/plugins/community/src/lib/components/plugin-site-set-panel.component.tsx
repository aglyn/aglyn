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

import { Typography } from '@mui/material'
import { doc, getDoc } from 'firebase/firestore'
import { useEffect, useMemo, useState } from 'react'
import {
  useFirestore,
  useFirestoreDoc,
  useHostOrgId,
} from '@aglyn/tenant-feature-instance'
import { resolveOrgInstallSummary } from '../model/community'
import { useCommunityActions } from '../hooks/use-community-actions'
import PluginSiteSet from './plugin-site-set.component'

export interface PluginSiteSetPanelProps {
  /** Acting site — org pins still resolve their org through one. */
  hostId: string
  listingId: string
  hosts?: ReadonlyArray<{ id: string; label: string }>
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
  const { hostId, listingId, hosts } = props
  const firestore = useFirestore()
  const orgId = useHostOrgId(hostId)
  const { installPlan, uninstall } = useCommunityActions(hostId)

  const { data: orgPin } = useFirestoreDoc<any>(
    () =>
      doc(
        firestore,
        'orgs',
        orgId ?? '-pending-',
        'installs',
        listingId || '-missing-',
      ),
    [firestore, orgId, listingId],
  )
  const [sitePins, setSitePins] = useState<Record<string, any>>({})
  const [pinsNonce, setPinsNonce] = useState(0)
  const hostIdsKey = (hosts ?? []).map((host) => host.id).join('|')
  useEffect(() => {
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
        if (active) setSitePins(Object.fromEntries(entries))
      })
      .catch(() => undefined)
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
    () => doc(firestore, 'communityListings', listingId || '-missing-'),
    [firestore, listingId],
  )

  const orgInstall = useMemo(
    () => resolveOrgInstallSummary(hosts ?? [], sitePins, orgPin ?? null),
    [hosts, sitePins, orgPin],
  )
  // The listing doc the actions need. The pin carries the denormalised copy
  // the actions actually read (`$id`, `displayName`), so this page does not
  // pay for a second read of the listing itself.
  const anyPin = orgPin ?? Object.values(sitePins).find(Boolean) ?? null
  const actionListing = useMemo(
    () => ({
      $id: listingId,
      displayName: listing?.displayName ?? anyPin?.displayName ?? listingId,
      artifactType: 'plugin',
      latestVersion: listing?.latestVersion ?? anyPin?.version,
    }),
    [listingId, listing?.displayName, listing?.latestVersion, anyPin?.displayName, anyPin?.version],
  )

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
      // The newest APPROVED version (AGL-1016) — never `latestVersion`, or the
      // page would offer an update the install route refuses.
      latestVersion={listing?.latestApprovedVersion}
      installPlan={installPlan}
      uninstall={uninstall}
      onChanged={() => setPinsNonce((current) => current + 1)}
    />
  )
}

PluginSiteSetPanel.displayName = 'PluginSiteSetPanel'

export default PluginSiteSetPanel
