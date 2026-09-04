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

import { postTenantRevalidate } from './tenant-revalidate'

/**
 * Drop cached HTML for addresses a SERVER route just changed (AGL-2573).
 *
 * The server counterpart to `revalidateLivePages`. A browser cannot call the
 * tenant itself — that route is secret-authenticated — so the client half
 * hops through `/api/screens/revalidate`; a route running here already holds
 * the secret and announces directly, exactly as `announceFormPublish` does
 * for a form promotion.
 *
 * This exists because the routes that need it have a host snapshot and a list
 * of addresses and nothing else: no screen graph to walk and no id whose
 * dependents need finding. Pulling the subdomain and the custom domain off
 * that snapshot is the whole job, and doing it in one place stops the three
 * callers from disagreeing about which cache keys a site has — the mistake
 * AGL-1152 cost a release to find, where a publish dropped the subdomain's
 * copy of a page and left the custom domain's, which is the one visitors
 * read.
 *
 * BEST EFFORT, ALWAYS, and it never throws. The write has already landed by
 * the time this runs, so a cache hint that fails must not make a completed
 * operation report failure; the render cache's TTL stays underneath as the
 * backstop. `postTenantRevalidate` emits the telemetry line on every outcome,
 * success included, so a path wired through here is observable rather than
 * merely hoped for.
 */
export async function announceLivePaths(options: {
  /** The host document, already read by the caller. */
  hostSnapshot: {
    get: (field: string) => unknown
  }
  hostId: string
  /**
   * Site-absolute addresses (`/`, `/pricing`).
   *
   * Must be non-empty: the tenant route refuses a call carrying no paths, so
   * an empty list would spend a round trip to be told `400` and record a
   * failure that is really "there was nothing to say".
   */
  paths: string[]
}): Promise<boolean> {
  const { hostSnapshot, hostId, paths } = options
  const unique = [...new Set(paths.filter(Boolean))]
  if (!hostId || !unique.length) return false
  try {
    const subdomain = String(hostSnapshot.get('subdomain') ?? '')
    // Without a subdomain there is no tenant deployment to ask, which is the
    // ordinary state of a site that has not been given one yet — not a
    // failure worth logging on every write.
    if (!subdomain) return false
    const cname = String(hostSnapshot.get('cname') ?? '')
    const result = await postTenantRevalidate({
      subdomain,
      hostId,
      paths: unique,
      ...(cname ? { cname } : {}),
    })
    return result.reason === 'ok'
  } catch (error) {
    // Logged, never thrown: see BEST EFFORT above.
    console.error('[announce-live-paths]', error)
    return false
  }
}

export default announceLivePaths
