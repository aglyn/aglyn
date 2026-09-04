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

import { screenRoutePathToUrl } from '@aglyn/aglyn/server'
import { screenIdsUsingFormDeep } from './scan-artifact-usage'
import { readUsageCandidates } from './read-usage-candidates'
import { postTenantRevalidate } from './tenant-revalidate'

/**
 * How many documents per collection the placement scan reads — the console
 * route's `SCAN_LIMIT`, restated here because this runs the same scan and the
 * two must not drift into reading different amounts of the same site.
 */
const SCAN_LIMIT = 2000

/**
 * Drop the cached pages that place `formId`, after its design was published.
 *
 * The SERVER half of the announcement. `/api/screens/revalidate` is the client
 * half — a browser cannot call the tenant itself, because that route is
 * secret-authenticated — but `/api/hosts/forms/promote` writes the published
 * design server-side and already holds the secret, so it announces directly
 * rather than asking the browser to make a second authenticated hop.
 *
 * Both halves run the same walk (`screenIdsUsingFormDeep`) over the same
 * corpus, so the two promotion paths cannot disagree about which pages a form
 * publish changes.
 *
 * BEST EFFORT, ALWAYS. The publish has already succeeded by the time this
 * runs, so a failed cache hint must never make it look failed — every failure
 * here resolves, and the render cache's TTL stays underneath as the backstop.
 */
export async function announceFormPublish(options: {
  firestore: FirebaseFirestore.Firestore
  hostId: string
  formId: string
}): Promise<{ revalidated: number; screenIds: string[] }> {
  const { firestore, hostId, formId } = options
  const empty = { revalidated: 0, screenIds: [] as string[] }
  if (!hostId || !formId) return empty

  try {
    const hostRef = firestore.collection('hosts').doc(hostId)
    const [hostSnapshot, screens, layouts, components] = await Promise.all([
      hostRef.get(),
      readUsageCandidates(hostRef, 'screens', {
        withNodes: true,
        limit: SCAN_LIMIT,
      }),
      readUsageCandidates(hostRef, 'layouts', {
        withNodes: true,
        limit: SCAN_LIMIT,
      }),
      readUsageCandidates(hostRef, 'components', {
        withNodes: true,
        limit: SCAN_LIMIT,
      }),
    ])
    const subdomain = String(hostSnapshot.get('subdomain') ?? '')
    if (!subdomain) return empty

    const screenIds = screenIdsUsingFormDeep(formId, {
      screens: screens.candidates,
      layouts: layouts.candidates,
      components: components.candidates,
    })
    // The routing map is `screenId → path`; a screen not in it is not routable,
    // so it has no live page to drop.
    const routes = (hostSnapshot.get('screens') ?? {}) as Record<string, string>
    const paths = screenIds
      .map((id) => routes[id])
      .filter((path): path is string => Boolean(path))
      .map((path) => screenRoutePathToUrl(path))
    // A form nothing routable places still needs the DOCUMENT cache dropped —
    // but the tenant route refuses a call with no paths, so there is nothing
    // to send and nothing stale that a visitor can reach.
    if (!paths.length) return { revalidated: 0, screenIds }

    const cname = String(hostSnapshot.get('cname') ?? '')
    const result = await postTenantRevalidate({
      subdomain,
      hostId,
      paths,
      ...(cname ? { cname } : {}),
    })
    return { revalidated: result.revalidated.length, screenIds }
  } catch (error) {
    // Logged, never thrown: see BEST EFFORT above.
    console.error('[announce-form-publish]', error)
    return empty
  }
}

export default announceFormPublish
