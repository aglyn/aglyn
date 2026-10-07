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
  pluginShipmentRecords,
  type PluginShipmentAnnouncement,
  type PluginTrackingStatus,
} from '@aglyn/aglyn/plugin-manager/plugin-shipment-records'
import { createHash } from 'node:crypto'
import { SHIPPING_COLLECTIONS } from '../constants/bundle-common'
import { TRACKING_PROGRESS } from '../model/tracking-status'
import type { ShippingProviderId } from '../providers/types'
import { openShippingAccount } from './account-store'
import { isShippingSurfaceConfigured } from './config'
import { resolveOrgShippingConfig } from './own-accounts'
import { orgRef, shippingDb } from './db'
import { resolveShippingSite } from './site-context'

/**
 * WHICH PARCEL A WEBHOOK IS ABOUT (AGL-3612): `shippingTrackers/{id}`, one
 * per tracking number this plugin follows, naming the workspace, the site
 * and the record. Top level, because a carrier's event names a tracking
 * number and nothing of ours, and keyed by a hash of the provider and the
 * number so the lookup is one read. Org erasure removes them by `orgId`.
 *
 * A tracker exists for every label bought here, and for every shipment a
 * merchant enters by hand — the seller announces it, and this plugin asks the
 * provider to follow it — so a parcel shipped either way updates the order.
 */

export interface StoredTracker {
  orgId: string
  hostId: string
  recordId: string
  labelId?: string
  providerId: ShippingProviderId
  carrier: string
  trackingNumber: string
  kind?: 'outbound' | 'return'
  status?: PluginTrackingStatus
  lastEventAtMs?: number
  createdAtMs: number
}

export function trackerDocId(providerId: string, trackingNumber: string): string {
  return `trk_${createHash('sha256')
    .update(`${providerId}\n${trackingNumber.trim().toUpperCase()}`)
    .digest('hex')
    .slice(0, 40)}`
}

/** A carrier name as the provider spells it in a tracking call. */
export function providerCarrierToken(providerId: ShippingProviderId, carrier: string): string | null {
  const key = carrier.trim().toLowerCase().replace(/[^a-z]/g, '')
  const table: Record<string, [string, string]> = {
    usps: ['usps', 'USPS'],
    unitedstatespostalservice: ['usps', 'USPS'],
    ups: ['ups', 'UPS'],
    fedex: ['fedex', 'FedEx'],
    dhl: ['dhl_express', 'DHLExpress'],
    dhlexpress: ['dhl_express', 'DHLExpress'],
    canadapost: ['canada_post', 'CanadaPost'],
    royalmail: ['royal_mail', 'RoyalMail'],
    australiapost: ['australia_post', 'AustraliaPost'],
  }
  const row = table[key]
  if (!row) return null
  if (providerId === 'shippo') return row[0]
  return providerId === 'easypost' ? row[1] : null
}

/**
 * The seller announced a shipment. One typed by hand is followed from here
 * on; one this plugin bought a label for already is.
 */
export async function onShipmentAnnounced(announcement: PluginShipmentAnnouncement): Promise<void> {
  if (announcement.labelRef || !announcement.trackingNumber || !announcement.carrier) return
  if (!isShippingSurfaceConfigured()) return
  const site = await resolveShippingSite(announcement.hostId)
  if (!site) return
  const configured = await resolveOrgShippingConfig(site.orgId)
  // The merchant's own Easyship or Sendcloud account (AGL-3632) follows only
  // the parcels it labelled, and reports them by its own webhook.
  if (!configured.configured || configured.config.ownAccount) return
  const carrier = providerCarrierToken(configured.config.providerId, announcement.carrier)
  if (!carrier) return
  const account = await openShippingAccount(site.orgId, configured.config).catch(() => null)
  if (!account) return
  const ref = shippingDb()
    .collection(SHIPPING_COLLECTIONS.trackers)
    .doc(trackerDocId(configured.config.providerId, announcement.trackingNumber))
  const existing = await ref.get()
  if (existing.exists) return
  await configured.config.provider.registerTracker(account, {
    carrier,
    trackingNumber: announcement.trackingNumber,
    reference: `${announcement.hostId}/${announcement.recordId}`,
  })
  await ref.set({
    orgId: site.orgId,
    hostId: announcement.hostId,
    recordId: announcement.recordId,
    providerId: configured.config.providerId,
    carrier: announcement.carrier,
    trackingNumber: announcement.trackingNumber,
    kind: 'outbound',
    createdAtMs: Date.now(),
  } satisfies StoredTracker)
}

export type TrackingEventOutcome = 'recorded' | 'ignored' | 'stale' | 'unknown_parcel'

/**
 * A carrier's event, already verified and read into our words. Applied
 * once and forward only: an event older than the last one, or one that
 * would walk the parcel back (in transit after delivered), is kept off the
 * record, because providers redeliver and reorder webhooks.
 */
export async function applyTrackingEvent(event: {
  providerId: ShippingProviderId
  /**
   * The workspace a per-workspace webhook spoke for (AGL-3632): a parcel of
   * another workspace's is not this one's to move.
   */
  orgId?: string
  trackingNumber: string
  status: PluginTrackingStatus
  detail?: string
  atMs: number
}): Promise<TrackingEventOutcome> {
  const ref = shippingDb()
    .collection(SHIPPING_COLLECTIONS.trackers)
    .doc(trackerDocId(event.providerId, event.trackingNumber))
  const outcome = await shippingDb().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    const tracker = snapshot.data() as StoredTracker | undefined
    if (!tracker || (event.orgId !== undefined && tracker.orgId !== event.orgId)) {
      return { result: 'unknown_parcel' as const }
    }
    if (tracker.lastEventAtMs && event.atMs < tracker.lastEventAtMs) return { result: 'stale' as const }
    if (tracker.status && TRACKING_PROGRESS[event.status] < TRACKING_PROGRESS[tracker.status]) {
      return { result: 'stale' as const }
    }
    if (tracker.status === event.status) return { result: 'ignored' as const }
    transaction.set(ref, { status: event.status, lastEventAtMs: event.atMs }, { merge: true })
    return { result: 'recorded' as const, tracker }
  })
  if (outcome.result !== 'recorded' || !outcome.tracker) return outcome.result
  const tracker = outcome.tracker
  if (tracker.labelId) {
    await orgRef(tracker.orgId)
      .collection(SHIPPING_COLLECTIONS.labels)
      .doc(tracker.labelId)
      .set({ trackingStatus: event.status }, { merge: true })
      .catch(() => undefined)
  }
  // A return's parcel is the merchant's to receive; the order's own
  // delivery is not what it tracks.
  if (tracker.kind === 'return') return 'recorded'
  const seller = pluginShipmentRecords()
  if (seller) {
    await seller.recordTracking({
      hostId: tracker.hostId,
      recordId: tracker.recordId,
      trackingNumber: tracker.trackingNumber,
      status: event.status,
      ...(event.detail ? { detail: event.detail.slice(0, 300) } : {}),
      atMs: event.atMs,
    })
  }
  return 'recorded'
}
