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

import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import type { PluginSiteCache } from '@aglyn/aglyn/plugin-manager/plugin-site-cache'
import { announceLivePaths } from './announce-live-paths'
import { dropPluginsEverywhere, dropSiteCaches } from './tenant-revalidate'

/**
 * This app's implementation of `core.site-cache` (AGL-3080), in its own file
 * so `instrumentation.ts` can DEFER IT BY RELATIVE PATH.
 *
 * ⛔ THAT IS THE WHOLE REASON THIS FILE EXISTS, and it is the AGL-1921 rule
 * one file over. `instrumentation.ts` must keep firebase-admin out of the
 * edge bundle, so the reach for it has to be deferred — but deferring the
 * LIB SPECIFIER (`await import('@aglyn/tenant-data-admin')`) makes nx treat
 * that lib as lazy-loaded EVERYWHERE, and
 * `@nx/enforce-module-boundaries` then forbids all 181 static imports of it
 * across this app. `report-server-error.ts` is the same shape for the same
 * reason: hold the static import in a relative module, defer the module.
 *
 * `complete` is a claim worth stating (AGL-4121). Every whole-site drop is
 * staged in the publish outbox before it is sent, so a site whose drop the
 * tenant refused — or that the fan-out cap held back — is still dropped by
 * the drain. `complete` is false only when a drop neither landed nor could be
 * staged, which `dropSiteCaches` has already raised as an operator alert; a
 * security caller fails loudly on it. The sites a cap held back come back as
 * `skipped`: that was a decision, it is logged, and they are queued.
 *
 * `plugins: 'everywhere'` is one call, not a fan-out: the tenant expires the
 * global plugin tag that every plugin read and every page that made one
 * carries, so a platform event reaches every site with no host walk.
 */
export const consoleSiteCache: PluginSiteCache = {
  drop: async ({ hostIds, reason, paths, plugins }) => {
    const firestore = firebaseAdmin.app().firestore()
    if (plugins === 'everywhere') {
      const complete = await dropPluginsEverywhere(firestore, {
        reason,
        carrierHostIds: hostIds,
      })
      return { dropped: complete ? 1 : 0, skipped: 0, complete }
    }
    // A site the caller placed exactly loses only the pages it named, through
    // the same announcement a server publish route makes; every other site
    // named loses every page, as a revoke needs.
    const placed = hostIds.filter((hostId) => paths?.[hostId])
    const whole = hostIds.filter((hostId) => !paths?.[hostId])
    let dropped = 0
    for (const hostId of placed) {
      const addresses = [...(paths?.[hostId] ?? [])]
      if (!addresses.length) continue
      const hostSnapshot = await firestore.collection('hosts').doc(hostId).get()
      if (await announceLivePaths({ hostSnapshot, hostId, paths: addresses })) {
        dropped += 1
      }
    }
    const { hosts, hostsDropped, lost } = await dropSiteCaches(firestore, {
      hostIds: whole,
      reason,
      ...(plugins === 'host' ? { plugins: 'host' as const } : {}),
    })
    return {
      dropped: dropped + hosts.length,
      skipped: hostsDropped,
      complete: !lost,
    }
  },
}

export default consoleSiteCache
