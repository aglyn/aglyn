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

import { funnelWatches, type WatchedFunnel } from '../model/drop-off'
import { normalizeFunnelDefinition } from '../model/funnel-definition'
import { FUNNELS_COLLECTION, FUNNELS_MAX_PER_SITE, isFunnelDraft } from '../model/funnels.types'

/**
 * What a site holds that the person-facing paths ask on every event (AGL-3605)
 * — does it record visits, and which of its funnels have drop-off watches —
 * held per process for a few minutes, so a form submission or an email open
 * on a site with no funnel costs one read per refresh, not one per event.
 */

const TTL_MS = 5 * 60 * 1000
const CACHE_MAX = 5_000

export interface FunnelHostState {
  recording: boolean
  /** The site's ACTIVE funnels that have at least one watch. */
  watched: WatchedFunnel[]
}

const held = new Map<string, { state: FunnelHostState; at: number }>()

/** The site's state, from the cache while it is fresh. */
export async function funnelHostState(
  firestore: any,
  hostId: string,
  now: number = Date.now(),
): Promise<FunnelHostState> {
  const cached = held.get(hostId)
  if (cached && now - cached.at < TTL_MS) return cached.state
  const hostRef = firestore.collection('hosts').doc(hostId)
  const host = await hostRef.get()
  const recording = Boolean(host.exists && host.get('funnelRecording') === true)
  const watched: WatchedFunnel[] = []
  if (recording) {
    const rows = await hostRef.collection(FUNNELS_COLLECTION).limit(FUNNELS_MAX_PER_SITE).get()
    for (const row of rows.docs) {
      const data = row.data() ?? {}
      // A draft follows nobody up until a person activates it (AGL-3616).
      if (isFunnelDraft(data)) continue
      const normalized = normalizeFunnelDefinition(data)
      if ('error' in normalized) continue
      const watches = funnelWatches(data['dropOffWatches'], normalized.funnel.steps.length)
      if (watches.length) {
        watched.push({ id: row.id, name: normalized.funnel.name, steps: normalized.funnel.steps, watches })
      }
    }
  }
  const state = { recording, watched }
  if (held.size >= CACHE_MAX) held.clear()
  held.set(hostId, { state, at: now })
  return state
}

/** Drops one site's state, after a save in this process changed it. */
export function forgetFunnelHostState(hostId: string): void {
  held.delete(hostId)
}

/** Test seam. */
export function resetFunnelHostStateForTests(): void {
  held.clear()
}
