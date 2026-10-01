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

import { nodesPlaceForm, screenRoutePathToUrl } from '@aglyn/aglyn/server'
import { dropPluginSiteCache } from '@aglyn/aglyn/plugin-manager/plugin-site-cache'
import {
  isLiveUsageCandidate,
  readUsageSources,
  screenIdsUsingComponentDeep,
  screenIdsUsingLayoutDeep,
  type UsageSources,
} from '@aglyn/tenant-data-admin/server/live-page-usage'

/**
 * How many documents per collection the placement scan reads — the bound the
 * platform's own publish scans use, so a form publish and a component publish
 * read the same amount of the same site.
 */
const SCAN_LIMIT = 2000

/**
 * Every live screen whose rendered output contains the form `formId`, however
 * indirectly.
 *
 * The form twin of {@link screenIdsUsingComponentDeep}, and the same walk for
 * the same reason: a placed form is found by SEARCHING node trees, not by
 * matching a pointer, and it can sit on a screen, inside page chrome, or
 * inside a reusable component that a third component nests. Publishing a form
 * changes every page that renders it, so anything this misses keeps serving
 * the old fields for the whole revalidate window while the editor reports that
 * the live sites now serve the new design.
 *
 * The first level is the only thing that differs from the component walk: a
 * document uses a form by PLACING it. After that the fan-out is identical, so
 * it is delegated rather than restated — a component that holds the form is
 * reached by whatever reaches that component, and a layout by whatever renders
 * inside it.
 *
 * Pure, and separate from the Firestore read, so the closure is testable
 * without a database. Cycle-safe by delegation: both walks it defers to bound
 * themselves.
 */
export function screenIdsUsingFormDeep(
  formId: string,
  sources: UsageSources,
): string[] {
  if (!formId) return []
  const screenIds = new Set<string>()

  for (const candidate of sources.screens) {
    if (!isLiveUsageCandidate(candidate)) continue
    if (nodesPlaceForm(candidate.nodes, formId)) screenIds.add(candidate.id)
  }
  for (const candidate of sources.layouts) {
    if (!isLiveUsageCandidate(candidate)) continue
    if (!nodesPlaceForm(candidate.nodes, formId)) continue
    // The layout itself renders no URL; the screens beneath it do.
    for (const screenId of screenIdsUsingLayoutDeep(
      candidate.id,
      sources.screens,
      sources.layouts,
    )) {
      screenIds.add(screenId)
    }
  }
  for (const candidate of sources.components) {
    if (!isLiveUsageCandidate(candidate)) continue
    if (!nodesPlaceForm(candidate.nodes, formId)) continue
    // And a component renders wherever it is placed, however deeply nested.
    for (const screenId of screenIdsUsingComponentDeep(candidate.id, sources)) {
      screenIds.add(screenId)
    }
  }

  return [...screenIds]
}

/**
 * Drop the cached pages that place `formId`, after its design was published.
 *
 * The plugin knows WHICH pages — the ones whose node trees place the form,
 * found by {@link screenIdsUsingFormDeep} over the site's screens, layouts and
 * components — and the app knows how to drop one on every address the site
 * answers at, so the addresses go through the platform's site cache
 * (`dropPluginSiteCache`, narrowed by `paths`).
 *
 * BEST EFFORT, ALWAYS. The publish has already succeeded by the time this
 * runs, so a failed cache hint must never make it look failed: every failure
 * resolves, and the render cache's TTL stays underneath as the backstop. A
 * scan the bound truncated drops the whole site instead, because a prefix of
 * the site would report a publish while leaving placed pages stale.
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
    const [hostSnapshot, sources] = await Promise.all([
      hostRef.get(),
      readUsageSources(hostRef, SCAN_LIMIT),
    ])
    const reason = 'a form was published'
    if (sources.truncated) {
      const result = await dropPluginSiteCache({ hostIds: [hostId], reason })
      return { revalidated: result.dropped, screenIds: [] }
    }
    const screenIds = screenIdsUsingFormDeep(formId, sources.candidates)
    // The routing map is `screenId → path`; a screen not in it is not
    // routable, so it has no live page to drop.
    const routes = (hostSnapshot.get('screens') ?? {}) as Record<string, string>
    const paths = screenIds
      .map((id) => routes[id])
      .filter((path): path is string => Boolean(path))
      .map((path) => screenRoutePathToUrl(path))
    if (!paths.length) return { revalidated: 0, screenIds }
    const result = await dropPluginSiteCache({
      hostIds: [hostId],
      paths: { [hostId]: paths },
      reason,
    })
    return { revalidated: result.dropped ? paths.length : 0, screenIds }
  } catch (error) {
    // Logged, never thrown: see BEST EFFORT above.
    console.error('[forms] announcing a publish failed', error)
    return empty
  }
}
