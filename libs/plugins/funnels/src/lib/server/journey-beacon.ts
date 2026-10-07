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

import {
  isSiteJourneyStepType,
  SITE_JOURNEY_BEACON_FIELD,
  SITE_JOURNEY_ID_PATTERN,
  SITE_JOURNEY_KEY_MAX,
} from '@aglyn/aglyn/app-utils/site-journey'
import type { PluginSiteBeaconRequest } from '@aglyn/aglyn/plugin-manager/plugin-site-beacons'
import firebaseAdmin from '@aglyn/tenant-data-admin/server/firebase-admin'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import {
  FUNNEL_JOURNEY_RETENTION_DAYS,
  FUNNEL_JOURNEYS_COLLECTION,
} from '../model/funnels.types'

/**
 * Counts one journey step (AGL-3605) into
 * `hosts/{hostId}/funnelJourneys/{visitId}`, after the collector's host,
 * lockdown and rate gates.
 *
 * Nothing in the body is believed as sent: the visit id must have the shape
 * the recorder mints, the type must be one of the platform's, the key is cut
 * to length, and the time is the SERVER's — a visitor's clock decides nothing
 * about the order of a visit. Where the visit came from is read only from its
 * first beacon, cut to length, and never overwritten.
 *
 * A site that does not record journeys — no funnel saved, or the beacon
 * spoofed at a site that has none — is refused before any write, from a
 * per-process answer refreshed every few minutes, so this costs one host read
 * per site per process per refresh rather than one per beacon.
 *
 * One write per step: an `arrayUnion` of the step (whose server time makes
 * it distinct) and the visit's expiry. The recorder caps a visit at 60 steps;
 * the document limit is the backstop against a beacon that ignores it.
 */

const DAY_MS = 24 * 60 * 60 * 1000
const RECORDING_TTL_MS = 5 * 60 * 1000
const RECORDING_CACHE_MAX = 5_000
const SOURCE_FIELDS = ['utmSource', 'utmMedium', 'utmCampaign', 'referrerHost'] as const

const recording = new Map<string, { value: boolean; at: number }>()

async function hostRecordsJourneysNow(hostId: string, firestore: any, now: number): Promise<boolean> {
  const held = recording.get(hostId)
  if (held && now - held.at < RECORDING_TTL_MS) return held.value
  const snapshot = await firestore.collection('hosts').doc(hostId).get()
  const value = snapshot.exists && snapshot.get('funnelRecording') === true
  if (recording.size >= RECORDING_CACHE_MAX) recording.clear()
  recording.set(hostId, { value, at: now })
  return value
}

/** Test seam: forget every site's recording answer. */
export function resetJourneyRecordingCache(): void {
  recording.clear()
}

/** When a visit that started at `startMs` may be swept. */
export function journeyExpiresAt(startMs: number): Date {
  return new Date(startMs + FUNNEL_JOURNEY_RETENTION_DAYS * DAY_MS)
}

/** Writes one step, or returns false for a beacon that is not one. */
export async function countJourneyBeacon(
  request: Pick<PluginSiteBeaconRequest, 'hostId' | 'body'>,
  firestore: any = firebaseAdmin.app().firestore(),
  now: number = Date.now(),
): Promise<boolean> {
  const { hostId, body } = request
  const visitId = String(body[SITE_JOURNEY_BEACON_FIELD] ?? '')
  if (!SITE_JOURNEY_ID_PATTERN.test(visitId)) return false
  const type = body['stepType']
  if (!isSiteJourneyStepType(type)) return false
  const key = String(body['stepKey'] ?? '').trim().slice(0, SITE_JOURNEY_KEY_MAX)
  if (type === 'page' && !key.startsWith('/')) return false
  if (type === 'event' && !key) return false
  if (!(await hostRecordsJourneysNow(hostId, firestore, now))) return false

  const start = body['journeyStart'] === true
  const source: Record<string, string> = {}
  if (start) {
    for (const field of SOURCE_FIELDS) {
      const value = body[field]
      if (typeof value === 'string' && value.trim()) {
        source[field] = value.trim().slice(0, 100)
      }
    }
  }

  await firestore
    .collection('hosts')
    .doc(hostId)
    .collection(FUNNEL_JOURNEYS_COLLECTION)
    .doc(visitId)
    .set(
      {
        steps: FieldValue.arrayUnion({ t: type, k: key, at: now }),
        lastAt: now,
        // Every write stamps it, so a visit whose first beacon was lost is
        // still swept. A visit lasts a tab, so the last step's clock and the
        // first's differ by that and no more.
        expiresAt: journeyExpiresAt(now),
        ...(start ? { startedAt: Timestamp.fromMillis(now), source } : {}),
      },
      { merge: true },
    )
  return true
}
