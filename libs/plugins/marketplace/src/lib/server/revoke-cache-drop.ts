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
 * A PLATFORM EVENT CHANGED WHICH PLUGINS MAY LOAD (AGL-1152, AGL-4121).
 *
 * ## Why a revocation needs it
 *
 * The tenant stamps each `marketplacePlugin` node with its pinned install
 * and its kill-switch state AT COMPOSE TIME, and resolves the signed realm
 * installs once per site, so a page cached before a takedown, a revoked
 * version or withdrawn realm trust goes on serving the old answer until it
 * re-renders. Dropping the cache is what makes the stop take effect on
 * already-cached HTML.
 *
 * ## One tag, not a host walk (AGL-4121)
 *
 * This used to walk the `installs` collection group, expand org-tier pins to
 * their hosts and fan out a whole-site drop to each — capped at 200 sites, and
 * only as good as the walk. Every read that decides which plugins load now
 * carries the platform-wide plugin tag, and so does every page that made one,
 * so a single `plugins: 'everywhere'` drop expires exactly those, on every
 * site, under every cache key, with nothing to walk and nothing to cap. Sites
 * that never ran the listing regenerate their plugin-reading pages once on
 * their next visit; takedowns are rare enough for that to be the right trade.
 *
 * ## It must not be lost
 *
 * The app stages the drop in its durable publish outbox before it sends it,
 * so a refused call is retried by the drain. When neither landed, this
 * THROWS: the stop itself is already written, and the staff action that made
 * it must come back as a failure to retry rather than a success that left the
 * stopped bundle running on cached pages for the week-long backstop.
 */
export class PluginCacheDropLostError extends Error {
  constructor(readonly listingId: string) {
    super(
      `The live sites could not be told that marketplace listing ${listingId} ` +
        'was stopped, and the drop could not be queued for a retry. The stop ' +
        'is saved; retry the action to drop the cached pages.',
    )
    this.name = 'PluginCacheDropLostError'
  }
}

export async function dropCachesForListing(
  _firestore: Firestore,
  listingId: string,
): Promise<PluginSiteCacheResult> {
  if (!listingId) return { dropped: 0, skipped: 0, complete: true }
  const result = await dropPluginSiteCache({
    hostIds: [],
    plugins: 'everywhere',
    reason: `marketplace listing ${listingId} stopped`,
  })
  if (!result.complete) throw new PluginCacheDropLostError(listingId)
  return result
}
