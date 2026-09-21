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

import {
  dropPluginSiteCache,
  type PluginSiteCacheResult,
} from '@aglyn/aglyn/plugin-manager/plugin-site-cache'
import type { Firestore } from 'firebase-admin/firestore'

/**
 * WHICH SITES ARE RUNNING THIS LISTING (AGL-1152, moved here by AGL-3080).
 *
 * ## Why a revocation needs it
 *
 * The tenant stamps each `marketplacePlugin` node with its pinned install
 * and its kill-switch state AT COMPOSE TIME, so a page cached before a
 * revocation goes on serving the pre-revocation answer until it re-renders.
 * The per-install revocation read is deliberately on a short TTL as a
 * security bound — but that bound is only consulted DURING a render, so on a
 * page nobody is requesting it bounds nothing at all. Dropping the cache is
 * what actually makes a kill switch take effect on already-cached HTML.
 *
 * ## Scope
 *
 * Installs live at BOTH `orgs/{orgId}/installs/{listingId}` (org-tier,
 * applies to every host in the org — AGL-237) and
 * `hosts/{hostId}/installs/{listingId}`, so the collection-group query finds
 * both and org hits are expanded to their hosts. Backed by the
 * `installs.listingId` COLLECTION_GROUP field override; Firestore
 * auto-creates single-field indexes at COLLECTION scope only.
 *
 * ## Why this half is the plugin's
 *
 * `installs` is this plugin's own collection — its `hostCollections` entry
 * names it — and what an org-tier pin means is its rule. It used to sit in
 * the console's `tenant-revalidate.ts` beside the fan-out, which meant the
 * console knew what an install pin was. The fan-out stayed there and is
 * reached through `dropPluginSiteCache`: dropping a site's pages takes the
 * tenant's revalidation paths and cache tags, which are the app's.
 *
 * BEST EFFORT, and never throws: the tenant still refuses a revoked plugin
 * at render time. This only shrinks the window in which cached HTML shows
 * the old answer. Read `complete` before reading `dropped` — see
 * {@link dropPluginSiteCache}.
 */
export interface RevokeCacheDropResult extends PluginSiteCacheResult {
  /** Install pins matched by the collection-group query. */
  installsFound: number
}

export async function dropCachesForListing(
  firestore: Firestore,
  listingId: string,
): Promise<RevokeCacheDropResult> {
  const nothing: RevokeCacheDropResult = {
    installsFound: 0,
    dropped: 0,
    skipped: 0,
    complete: true,
  }
  if (!listingId) return nothing
  let hostIds: string[]
  let installsFound: number
  try {
    const installs = await firestore
      .collectionGroup('installs')
      .where('listingId', '==', listingId)
      .get()
    if (installs.empty) return nothing
    installsFound = installs.size

    const hosts = new Set<string>()
    const orgIds = new Set<string>()
    for (const doc of installs.docs) {
      const owner = doc.ref.parent.parent
      if (!owner) continue
      if (owner.parent.id === 'hosts') hosts.add(owner.id)
      else if (owner.parent.id === 'orgs') orgIds.add(owner.id)
    }
    // An org-tier pin applies to every host in the org, so it is the org's
    // hosts that hold the cached HTML — the org itself renders nothing.
    await Promise.all(
      [...orgIds].map(async (orgId) => {
        const owned = await firestore
          .collection('hosts')
          .where('orgId', '==', orgId)
          .get()
        for (const host of owned.docs) hosts.add(host.id)
      }),
    )
    hostIds = [...hosts]
  } catch (error) {
    /*
     * The READ failed, so nothing is known about which sites are affected —
     * which is not the same as none being affected. `complete: false` for
     * the same reason the shell uses it: a zero that reads as an answer is
     * how a kill switch quietly does not take effect.
     */
    console.error(
      '[marketplace] could not find the sites running',
      listingId,
      error,
    )
    return { installsFound: 0, dropped: 0, skipped: 0, complete: false }
  }

  const result = await dropPluginSiteCache({
    hostIds,
    reason: `marketplace listing ${listingId} revoked`,
  })
  return { ...result, installsFound }
}
