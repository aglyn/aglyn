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

/**
 * The tenant's half of a dataset record refresh (AGL-3113).
 *
 * The caches this drops are THIS process's own, so it drops them directly
 * rather than posting a request to itself. `/api/revalidate` exists because
 * the console is somewhere else; a form submission and an automation step run
 * here, and sending them out through the CDN and back would put the platform's
 * own bot protection between a write and its refresh — the exact hop that
 * silently 429'd every publish on the estate for eleven days (AGL-2573).
 *
 * The same two moves that route makes, in the same order and for the same
 * reasons: the host's document tag FIRST, so the regeneration each dropped
 * path triggers cannot race a still-warm rows cache, then one `revalidatePath`
 * per scheme per cache host. The console's `dataset-write-announces` spec pins
 * that ordering, because getting it backwards is invisible — the page does
 * regenerate, from the rows it was told to stop showing.
 */

/**
 * STATIC, every one of them. A deferred first-party import registers a DYNAMIC
 * nx graph edge, and nx then treats the whole library as lazy-loaded — which
 * forbids every static import of `@aglyn/tenant-data-admin` in every project
 * that reaches it (AGL-949/1329/2282). `publish-schedule-job.ts` next door is
 * one of them, so a lazy import here would red the lint of a file this change
 * never touched. The deferring that boot needs is the RELATIVE import of this
 * module from `instrumentation.ts`.
 */
import { SCHEME_ROUTE_SEGMENTS } from '@aglyn/shared-ui-theme/util/scheme-route-segment'
import { tenantDataTag } from '@aglyn/tenant-data-admin/render-cache'
import {
  registerLivePageDropper,
  type LivePageDropper,
} from '@aglyn/tenant-data-admin/server/dataset-live-pages'
import { revalidatePath, revalidateTag } from 'next/cache'

/**
 * The tenant route's own cap, restated because this path never goes through
 * it. Above any plausible site, and each accepted path costs two cache-key
 * deletes and no render.
 */
const MAX_PATHS = 250

/**
 * The cache-key prefix the middleware rewrites to — the subdomain label, and
 * the `cname--` sentinel for an attached domain.
 *
 * BOTH, because they are two keys for the same page and the custom domain is
 * the one visitors read (AGL-1152). A drop that named only the subdomain
 * refreshed a URL nobody asks for.
 */
function cacheHosts(subdomain: string, cname?: string): string[] {
  const hosts = [subdomain]
  const domain = (cname ?? '').trim().toLowerCase()
  // Must match the middleware's sentinel byte for byte, or the drop lands on
  // a key nothing reads.
  if (domain) hosts.push(`cname--${domain}`)
  return hosts
}

/**
 * Drops one site's cached rows and pages, in this process.
 *
 * Every failure is caught and answered as a drop that did not land. Outside a
 * Next server context — a script, a worker, a spec — `revalidatePath` throws,
 * and that must read as "the cache hint had nowhere to go", never as a record
 * that failed to be written.
 */
export const dropLivePagesInProcess: LivePageDropper = async (target) => {
  try {
    // The ROWS first. A page dropped before its data tag regenerates from the
    // records it was just told to stop showing (AGL-1302).
    revalidateTag(tenantDataTag(target.hostId), 'max')
    for (const host of cacheHosts(target.subdomain, target.cname)) {
      for (const path of target.paths.slice(0, MAX_PATHS)) {
        // One tenant must never be able to bust another's cache: `..` is not a
        // filesystem traversal here, it is a way to name a page on a different
        // host's tree.
        if (!path.startsWith('/') || path.includes('..')) continue
        for (const scheme of SCHEME_ROUTE_SEGMENTS) {
          revalidatePath(`/${host}/${scheme}${path === '/' ? '' : path}`)
        }
      }
    }
    return true
  } catch (error) {
    // Best effort: the record is written, and the TTL is still underneath.
    console.error('[live-page-dropper] in-process drop failed', error)
    return false
  }
}

/**
 * Registers the dropper for this server instance.
 *
 * Called BY NAME from `instrumentation.ts`, never from a module's top level:
 * a bundler deletes a module imported only for its side effect when its
 * package says it has none (AGL-3025), and this registration is the only
 * thing that makes a tenant-side record write refresh anything at all.
 */
export function registerLivePageDropping(): void {
  registerLivePageDropper(dropLivePagesInProcess)
}
