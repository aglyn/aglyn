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
 * ONE WRITE FOR A SERVE THAT LEAVES FROM SOMEWHERE ELSE.
 *
 * Bytes a visitor fetches straight from a delivery provider or a signed
 * Storage URL never pass through a route of ours, so the only request we see
 * is the one that handed out the link. That request counts them, at the size
 * of what the link opens — the most one sitting or one download sends — on the
 * same analytics day document the media CDN writes, so every bandwidth reader
 * (`analyticsBandwidthReading`) sees them without knowing where they left from
 * (AGL-3474: every origin-served or provider-served video, audio and file
 * byte counts toward the band, at its weight).
 */

import { MEDIA_BANDWIDTH_DAY_FIELD } from '@aglyn/aglyn/app-utils/media-bandwidth'
import { analyticsDayExpiresAt } from './analytics-retention'
import { firebaseAdmin } from './firebase-admin'

/** The minimal Firestore surface the write needs, so a route's double reaches it. */
interface DayDocFirestore {
  collection(name: string): {
    doc(id: string): {
      collection(name: string): {
        doc(id: string): {
          set(
            data: Record<string, unknown>,
            options: { merge: true },
          ): Promise<unknown>
        }
      }
    }
  }
}

export interface MediaServeCount {
  firestore: DayDocFirestore
  /** Whose library: a site's (`hosts`) or the organization's (`orgs`). */
  collection: 'hosts' | 'orgs'
  scopeId: string
  /** The bytes counted toward the bandwidth band; 0 counts only the serve. */
  bandwidthBytes: number
  /** The asset, when the link opens one: its per-asset delivery figures move too. */
  mediaId?: string
  /** A redirect to a delivery provider rather than a body of ours. */
  redirect?: boolean
}

/**
 * Records one serve on today's day document. Resolves whether or not the
 * write landed — a dropped count is logged, never thrown, because the visitor
 * already has the link — and is meant to be awaited after the response so the
 * function lives until it is written.
 */
export async function recordMediaServe(count: MediaServeCount): Promise<void> {
  const day = new Date().toISOString().slice(0, 10)
  const increment = firebaseAdmin.firestore.FieldValue.increment
  const bytes = count.bandwidthBytes > 0 ? Math.round(count.bandwidthBytes) : 0
  // Async, so a write that throws before it is sent still lands in the
  // logging branch below rather than in the caller, whose response has gone.
  return Promise.resolve()
    .then(() =>
      count.firestore
        .collection(count.collection)
        .doc(count.scopeId)
        .collection('analytics')
        .doc(day)
        .set(
          {
            expiresAt: analyticsDayExpiresAt(day),
            ...(bytes > 0
              ? { [MEDIA_BANDWIDTH_DAY_FIELD]: increment(bytes) }
              : {}),
            ...(count.mediaId
              ? {
                  media: {
                    [count.mediaId]: {
                      serves: increment(1),
                      ...(count.redirect ? { redirects: increment(1) } : {}),
                    },
                  },
                }
              : {}),
          },
          { merge: true },
        ),
    )
    .then(
      () => undefined,
      (error: unknown) => {
        console.error(
          '[media-cdn] serve not counted',
          `${count.collection}/${count.scopeId}`,
          count.mediaId ?? null,
          error,
        )
      },
    )
}
