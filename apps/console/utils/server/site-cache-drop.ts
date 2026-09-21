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
import { dropSiteCaches } from './tenant-revalidate'

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
 * `complete: true` unconditionally, and that is a claim worth stating.
 * `dropSiteCaches` never throws and each site is best effort, so reaching
 * the end means every site we were given was attempted — which is what the
 * contract's `complete` asks. The sites a cap held back come back as
 * `skipped`, not as incompleteness: that was a decision, and it is logged.
 */
export const consoleSiteCache: PluginSiteCache = {
  drop: async ({ hostIds, reason }) => {
    const { hosts, hostsDropped } = await dropSiteCaches(
      firebaseAdmin.app().firestore(),
      { hostIds, reason },
    )
    return { dropped: hosts.length, skipped: hostsDropped, complete: true }
  },
}

export default consoleSiteCache
