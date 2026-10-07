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

import { Timestamp } from 'firebase-admin/firestore'
import { computeFunnel } from '../model/funnel-compute'
import {
  FUNNEL_JOURNEY_READ_CAP,
  FUNNEL_JOURNEYS_COLLECTION,
  FUNNEL_RESULTS_COLLECTION,
  type FunnelResult,
  type FunnelStep,
  type JourneyForCompute,
} from '../model/funnels.types'

/**
 * A funnel's result over a range (AGL-3605): read the visits that STARTED in
 * the range, newest first, in pages, up to {@link FUNNEL_JOURNEY_READ_CAP},
 * and compute.
 *
 * ## The read is a query, never a scan
 *
 * One range on `startedAt`, ordered on the same field — Firestore indexes
 * every field in both directions on its own, so no composite index is owed —
 * with a projection to the two fields a computation reads. A visit is read
 * once per computation however many funnels the site has.
 *
 * ## Cached per (funnel, version, range)
 *
 * In `funnelResults`, keyed by the funnel, the range and the definition's
 * last update, so an edited funnel never serves its old numbers. A range that
 * ends before today cannot change, and is kept for a day; one that includes
 * today is kept {@link LIVE_RESULT_TTL_MS}. The documents expire on their own.
 */

const PAGE_SIZE = 1_000
export const LIVE_RESULT_TTL_MS = 15 * 60 * 1000
export const CLOSED_RESULT_TTL_MS = 24 * 60 * 60 * 1000

/** The cache key for one funnel version over one range. */
export function funnelResultKey(funnelId: string, version: number, from: string, to: string): string {
  return `${funnelId}_${version}_${from}_${to}`.replace(/[^A-Za-z0-9_-]/g, '-')
}

/** Every visit that started in `[startMs, endMs)`, newest first, capped. */
export async function readJourneys(
  firestore: any,
  hostId: string,
  startMs: number,
  endMs: number,
  cap: number = FUNNEL_JOURNEY_READ_CAP,
): Promise<{ journeys: JourneyForCompute[]; capped: boolean }> {
  const base = firestore
    .collection('hosts')
    .doc(hostId)
    .collection(FUNNEL_JOURNEYS_COLLECTION)
    .where('startedAt', '>=', Timestamp.fromMillis(startMs))
    .where('startedAt', '<', Timestamp.fromMillis(endMs))
    .orderBy('startedAt', 'desc')
    .select('steps', 'source', 'startedAt')
  const journeys: JourneyForCompute[] = []
  let cursor: unknown = null
  while (journeys.length < cap) {
    const size = Math.min(PAGE_SIZE, cap - journeys.length)
    const page = await (cursor ? base.startAfter(cursor) : base).limit(size).get()
    for (const doc of page.docs) {
      const data = doc.data() ?? {}
      journeys.push({
        steps: Array.isArray(data.steps) ? data.steps : [],
        source: data.source ?? null,
      })
    }
    if (page.docs.length < size) return { journeys, capped: false }
    cursor = page.docs[page.docs.length - 1]
  }
  return { journeys, capped: true }
}

export async function funnelResult(options: {
  firestore: any
  hostId: string
  funnelId: string
  steps: readonly FunnelStep[]
  /** The definition's last update, in ms: part of the cache key. */
  version: number
  from: string
  to: string
  startMs: number
  endMs: number
  now?: number
  /** Skip the cache, e.g. a person asked to refresh. */
  fresh?: boolean
}): Promise<FunnelResult> {
  const now = options.now ?? Date.now()
  const { firestore, hostId, funnelId, from, to } = options
  const cacheRef = firestore
    .collection('hosts')
    .doc(hostId)
    .collection(FUNNEL_RESULTS_COLLECTION)
    .doc(funnelResultKey(funnelId, options.version, from, to))
  const live = options.endMs > now
  const ttl = live ? LIVE_RESULT_TTL_MS : CLOSED_RESULT_TTL_MS
  if (!options.fresh) {
    const cached = await cacheRef.get().catch(() => null)
    const held = cached?.exists ? (cached.data()?.result as FunnelResult | undefined) : undefined
    if (held && now - Number(held.computedAt ?? 0) < ttl) return held
  }
  const { journeys, capped } = await readJourneys(firestore, hostId, options.startMs, options.endMs)
  const computed = computeFunnel(options.steps, journeys)
  const result: FunnelResult = {
    funnelId,
    from,
    to,
    ...computed,
    journeysRead: journeys.length,
    capped,
    computedAt: now,
  }
  await cacheRef
    .set({ funnelId, result, expiresAt: new Date(now + 2 * CLOSED_RESULT_TTL_MS) })
    .catch(() => undefined)
  return result
}
