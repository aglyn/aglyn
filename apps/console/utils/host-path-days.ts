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

import { doc, getDoc, type Firestore } from 'firebase/firestore'
import { readAnalyticsDays } from './analytics-day-cache'

/** One day's per-path counts from `hosts/{hostId}/analytics/{day}`. */
export interface HostPathDay {
  day: string
  /** Every path counted that day, keyed by `analyticsPathKey`. */
  paths: Record<string, number>
  /** The day could not be read: its counts are NOT zero, they are unknown. */
  failed: boolean
}

/**
 * The per-path counts of `dayIds`, in the order given (AGL-2498, AGL-4253).
 *
 * The ONE reader of the `traffic-paths` cache key. `readAnalyticsDays` hands a
 * hit back without calling `read`, so every panel sharing a key must get the
 * same shape (`feedback_analytics_day_cache_field_key_is_a_shape_contract`):
 * the entry and product traffic cards and the Pages table all come through
 * here, so they cannot drift apart.
 *
 * A failed day comes back `failed: true` with no counts, never as a measured
 * zero, so a caller can say which days it is missing.
 */
export async function readHostPathDays(options: {
  firestore: Firestore
  hostId: string
  /** Day ids, in the order wanted back; the first newest-first id is live. */
  dayIds: readonly string[]
  liveDay: string
  now?: number
}): Promise<HostPathDay[]> {
  const { firestore, hostId, dayIds, liveDay } = options
  const stats = await readAnalyticsDays<{ day: string; paths: Record<string, number> }>({
    scopeKey: `hosts/${hostId}`,
    field: 'traffic-paths',
    dayIds,
    liveDay,
    now: options.now ?? Date.now(),
    fallback: { day: '', paths: {} },
    read: async (id) => {
      const snapshot = await getDoc(doc(firestore, 'hosts', hostId, 'analytics', id))
      return {
        day: id,
        paths: (snapshot.get('paths') ?? {}) as Record<string, number>,
      }
    },
  })
  return stats.map((stat, index) => ({
    day: dayIds[index],
    paths: stat.paths,
    failed: stat.day === '',
  }))
}
