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

import type { PluginSiteBeaconRequest } from '@aglyn/aglyn/plugin-manager/plugin-site-beacons'
import firebaseAdmin from '@aglyn/tenant-data-admin/server/firebase-admin'
import { FieldValue } from 'firebase-admin/firestore'

type Firestore = FirebaseFirestore.Firestore

/**
 * OVERLAY ENGAGEMENT (AGL-200), as the site runtime reports it.
 *
 * The announcement bar and the popup post `{ overlay, overlayId? }` to the
 * platform's site collector, which hands the beacon here after its host and
 * lockdown gates. Two counters move, and neither is a pageview:
 *
 *  - the site's day document (`hosts/{hostId}/analytics/{day}`) gains one
 *    under `overlays.{event}`, the host-wide totals the dashboard reads —
 *    stamped with the platform's expiry so a day created by overlay events
 *    alone is still swept (AGL-1844);
 *  - with an `overlayId` (AGL-271), that overlay's own document gains one
 *    under `stats.impressions`, `stats.clicks` or `stats.dismissals`, so the
 *    console shows engagement per bar and popup.
 */

/** The events an overlay reports; anything else is counted nowhere. */
export const OVERLAY_BEACON_EVENTS: readonly string[] = [
  'barImpression',
  'popupImpression',
  'popupDismiss',
  'popupClick',
  'barClick',
  'barDismiss',
]

/** The body field that marks a beacon as an overlay's. */
export const OVERLAY_BEACON_FIELD = 'overlay'

/** The longest overlay id the per-overlay counter accepts. */
const OVERLAY_ID_MAX = 64

/** Which of an overlay's lifetime counters an event moves. */
function statKeyOf(event: string): 'impressions' | 'clicks' | 'dismissals' {
  if (event.endsWith('Impression')) return 'impressions'
  if (event.endsWith('Click')) return 'clicks'
  return 'dismissals'
}

/** Counts one overlay beacon, on the Firestore it is handed. */
export async function countOverlayBeacon(
  request: PluginSiteBeaconRequest,
  firestore: Firestore,
): Promise<void> {
  const event = String(request.body[OVERLAY_BEACON_FIELD] ?? '')
  if (!OVERLAY_BEACON_EVENTS.includes(event)) return
  const hostRef = firestore.collection('hosts').doc(request.hostId)
  await hostRef
    .collection('analytics')
    .doc(request.day)
    .set(
      {
        overlays: { [event]: FieldValue.increment(1) },
        expiresAt: request.dayExpiresAt,
      },
      { merge: true },
    )
  const overlayId = String(request.body['overlayId'] ?? '')
  if (!overlayId || overlayId.length > OVERLAY_ID_MAX) return
  // update(), not set(): a beacon from a stale cached page must not
  // resurrect a deleted overlay as a stats-only stray document.
  await hostRef
    .collection('overlays')
    .doc(overlayId)
    .update({ [`stats.${statKeyOf(event)}`]: FieldValue.increment(1) })
    .catch(() => undefined)
}

/**
 * Counts one overlay beacon on the platform's Firestore: what the server
 * declarations hand the collector, with this module and the Admin SDK loaded
 * on the first beacon.
 */
export async function countOverlayBeaconOnPlatform(
  request: PluginSiteBeaconRequest,
): Promise<void> {
  await countOverlayBeacon(request, firebaseAdmin.app().firestore())
}
