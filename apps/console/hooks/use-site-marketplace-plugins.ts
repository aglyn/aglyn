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

import { collection, limit, query } from 'firebase/firestore'
import { useMemo } from 'react'
import { useFirestore, useFirestoreCollection } from '@aglyn/tenant-feature-instance'

/** One marketplace plugin as a site sees it. */
export interface SiteMarketplacePlugin {
  /** The listing document id — the id `enabledPlugins` and the pins key by. */
  listingId: string
  /** The publisher's name for it, denormalized onto the pin. */
  displayName: string
  version?: string
  /**
   * `org` — pinned for every site in the workspace; `site` — pinned for this
   * one. The distinction changes what switching it off here means, so it is
   * carried rather than flattened.
   */
  scope: 'org' | 'site'
}

/**
 * Every marketplace plugin that can run on one site (AGL-1014).
 *
 * The site's plugin switchboard used to derive this from `org.enabledPlugins`
 * alone, and that field is EMPTY for most workspaces: `syncEnabledPlugins`
 * appends a listing id only for an org that has already configured the
 * switchboard, because an absent field means default-open and adding the first
 * id would switch off every plugin not in it. So a workspace that never
 * touched the built-in switches had its marketplace installs running on every
 * site with nothing in the console listing them, and no way to switch one off
 * for one site.
 *
 * The pins are the durable record, so they are the source here: org-tier pins
 * apply to every site, host-tier pins to this one, and the ids already on
 * `enabledPlugins` are unioned in so a listing whose pin this reader cannot
 * see still gets a row rather than silently vanishing.
 */
export function useSiteMarketplacePlugins(
  orgId: string,
  hostId: string,
  /** Non-first-party ids already on the org's switchboard. */
  switchboardIds: readonly string[] = [],
): SiteMarketplacePlugin[] {
  const firestore = useFirestore()

  // Held at null while the scope is unknown, never `orgs/-pending-`
  // (AGL-1440): installs are member-gated, so a sentinel id is a
  // guaranteed-denied listen on every mount.
  const { data: orgInstalls } = useFirestoreCollection<any>(
    () =>
      orgId
        ? query(collection(firestore, 'orgs', orgId, 'installs'), limit(100))
        : null,
    [firestore, orgId],
    { idField: '$id' },
  )
  const { data: hostInstalls } = useFirestoreCollection<any>(
    () =>
      hostId
        ? query(collection(firestore, 'hosts', hostId, 'installs'), limit(100))
        : null,
    [firestore, hostId],
    { idField: '$id' },
  )

  const switchboardKey = [...switchboardIds].sort().join('|')

  return useMemo(() => {
    const byListing = new Map<string, SiteMarketplacePlugin>()
    const add = (pin: any, scope: 'org' | 'site') => {
      const listingId = String(pin?.$id ?? '')
      if (!listingId) return
      // A host pin is the more specific fact about THIS site, so it wins the
      // scope; the display name and version are the same either way.
      const existing = byListing.get(listingId)
      if (existing && scope === 'org') return
      byListing.set(listingId, {
        listingId,
        displayName: String(
          pin?.displayName ?? pin?.manifest?.name ?? pin?.pluginId ?? listingId,
        ),
        version: pin?.version ? String(pin.version) : undefined,
        scope,
      })
    }
    for (const pin of orgInstalls ?? []) add(pin, 'org')
    for (const pin of hostInstalls ?? []) add(pin, 'site')
    // An id the switchboard carries with no readable pin still gets a row,
    // named by its id. A row that says less is better than a plugin running on
    // the site with no row at all — which is the state this hook exists to end.
    for (const listingId of switchboardKey ? switchboardKey.split('|') : []) {
      if (byListing.has(listingId)) continue
      byListing.set(listingId, { listingId, displayName: listingId, scope: 'org' })
    }
    return [...byListing.values()].sort((left, right) =>
      left.displayName.localeCompare(right.displayName),
    )
  }, [orgInstalls, hostInstalls, switchboardKey])
}

export default useSiteMarketplacePlugins
