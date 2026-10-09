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

import type { Firestore } from 'firebase-admin/firestore'
import { COURIER_CONNECTIONS_COLLECTION, COURIER_DELIVERIES_COLLECTION } from '../constants'
import { isCourierProviderId, type CourierKeyMode, type CourierProviderId, type CourierState } from '../model/couriers'

/**
 * Where couriers keep their state (AGL-3695). TWO TOP-LEVEL collections,
 * each document carrying `orgId` and `hostId`, both closed to every client by
 * the Firestore rules — staff included — because one holds a merchant's
 * sealed keys and the other decides whether a courier is booked:
 *
 *   courierConnections/(hostId)_(provider)  the keys (sealed), webhook token hash
 *   courierDeliveries/(hostId)_(orderId)    the quote, the run, the runs before
 *
 * Top level so org erasure removes them by `orgId` (`orgKeyedCollections`).
 * The sealed secret and the webhook token's hash carry `secret` and `token`
 * in their names, which the personal-data export redacts by.
 */

/** One mode's keys, the signing secret still sealed. */
export interface StoredKeys {
  developerId: string
  keyId: string
  sealedSigningSecret: string
  /** The keyring entry that sealed it. */
  sealedWith: string
  lastTestOk: boolean
  lastTestAtMs: number | null
  lastError: string | null
}

export interface StoredConnection {
  id: string
  orgId: string
  hostId: string
  provider: CourierProviderId
  live: StoredKeys | null
  test: StoredKeys | null
  pickupPhone: string | null
  pickupNote: string | null
  /** SHA-256 of the token DoorDash's webhooks carry; the token is shown once. */
  webhookTokenHash: string | null
  connectedByUid: string
  createdAtMs: number
  updatedAtMs: number
}

export interface StoredQuote {
  provider: CourierProviderId
  deliveryRef: string
  feeCents: number
  currency: string
  pickupEtaMs: number | null
  dropoffEtaMs: number | null
  expiresAtMs: number
  testMode: boolean
  createdAtMs: number
  createdByUid: string
}

export interface StoredRun {
  provider: CourierProviderId
  deliveryRef: string
  state: CourierState
  /** Booked, and the courier's answer was lost: confirmed by the job. */
  pending: boolean
  /** The attempt key the console booked under: a retry with it finds this run. */
  idempotencyKey: string
  trackingUrl: string | null
  etaMs: number | null
  pickupEtaMs: number | null
  feeCents: number | null
  currency: string
  reason: string | null
  testMode: boolean
  /** A refund or cancel of the order asked for the courier to be called off. */
  cancelRequested: boolean
  cancelReason: string | null
  /** The store called it off itself: no "Delivery failed" follows. */
  cancelledByStore: boolean
  createdAtMs: number
  createdByUid: string
  updatedAtMs: number
}

export interface StoredDelivery {
  id: string
  orgId: string
  hostId: string
  orderId: string
  quote: StoredQuote | null
  run: StoredRun | null
  history: StoredRun[]
  /** Quotes asked for, so each gets its own courier reference. */
  attempts: number
  /** Webhook events already applied, newest last. */
  seenEvents: string[]
  /** Whether a run is under way: the job's query. */
  open: boolean
  /** When the job next asks the courier, epoch ms. */
  nextCheckAtMs: number
  updatedAtMs: number
}

export interface CourierStore {
  getConnection(hostId: string, provider: CourierProviderId): Promise<StoredConnection | null>
  putConnection(connection: StoredConnection): Promise<void>
  patchConnection(id: string, patch: Partial<StoredConnection>): Promise<void>
  deleteConnection(id: string): Promise<void>
  getDelivery(hostId: string, orderId: string): Promise<StoredDelivery | null>
  /**
   * Reads one order's record and writes what `change` answers, atomically: a
   * second writer racing this one re-runs `change` on what the first wrote.
   * `next === undefined` writes nothing.
   */
  updateDelivery<T>(
    hostId: string,
    orderId: string,
    change: (current: StoredDelivery | null) => { next?: StoredDelivery; result: T },
  ): Promise<T>
  /** Open runs due a look, oldest first. */
  dueDeliveries(nowMs: number, limit: number): Promise<StoredDelivery[]>
  /** Whether a site has a run under way (a disconnect would orphan it). */
  hasOpenRun(hostId: string): Promise<boolean>
}

export const connectionId = (hostId: string, provider: CourierProviderId): string => `${hostId}_${provider}`
export const deliveryId = (hostId: string, orderId: string): string => `${hostId}_${orderId}`

/** The context a mode's secret is sealed under: a copy pasted into another site's document will not open. */
export const keysSealContext = (hostId: string, provider: CourierProviderId, mode: CourierKeyMode): string =>
  `${COURIER_CONNECTIONS_COLLECTION}/${connectionId(hostId, provider)}#${mode}`

const str = (value: unknown, max = 300): string => String(value ?? '').slice(0, max)
const numOrNull = (value: unknown): number | null => {
  const parsed = Number(value)
  return value === null || value === undefined || !Number.isFinite(parsed) ? null : parsed
}

function readKeys(value: unknown): StoredKeys | null {
  const raw = (value ?? null) as Record<string, unknown> | null
  if (!raw || typeof raw['sealedSigningSecret'] !== 'string' || !raw['sealedSigningSecret']) return null
  return {
    developerId: str(raw['developerId'], 120),
    keyId: str(raw['keyId'], 120),
    sealedSigningSecret: String(raw['sealedSigningSecret']),
    sealedWith: str(raw['sealedWith'], 60),
    lastTestOk: raw['lastTestOk'] === true,
    lastTestAtMs: numOrNull(raw['lastTestAtMs']),
    lastError: raw['lastError'] ? str(raw['lastError']) : null,
  }
}

export function readConnection(id: string, data: unknown): StoredConnection | null {
  const raw = (data ?? null) as Record<string, unknown> | null
  if (!raw || !isCourierProviderId(raw['provider'])) return null
  return {
    id,
    orgId: str(raw['orgId'], 128),
    hostId: str(raw['hostId'], 128),
    provider: raw['provider'],
    live: readKeys(raw['live']),
    test: readKeys(raw['test']),
    pickupPhone: raw['pickupPhone'] ? str(raw['pickupPhone'], 20) : null,
    pickupNote: raw['pickupNote'] ? str(raw['pickupNote'], 280) : null,
    webhookTokenHash: raw['webhookTokenHash'] ? str(raw['webhookTokenHash'], 128) : null,
    connectedByUid: str(raw['connectedByUid'], 128),
    createdAtMs: Number(raw['createdAtMs']) || 0,
    updatedAtMs: Number(raw['updatedAtMs']) || 0,
  }
}

function readQuote(value: unknown): StoredQuote | null {
  const raw = (value ?? null) as Record<string, unknown> | null
  if (!raw || !isCourierProviderId(raw['provider']) || !raw['deliveryRef']) return null
  return {
    provider: raw['provider'],
    deliveryRef: str(raw['deliveryRef'], 120),
    feeCents: Number(raw['feeCents']) || 0,
    currency: str(raw['currency'], 3) || 'usd',
    pickupEtaMs: numOrNull(raw['pickupEtaMs']),
    dropoffEtaMs: numOrNull(raw['dropoffEtaMs']),
    expiresAtMs: Number(raw['expiresAtMs']) || 0,
    testMode: raw['testMode'] === true,
    createdAtMs: Number(raw['createdAtMs']) || 0,
    createdByUid: str(raw['createdByUid'], 128),
  }
}

const STATES = new Set<CourierState>([
  'requested',
  'assigned',
  'at_pickup',
  'picked_up',
  'at_dropoff',
  'delivered',
  'cancelled',
  'returning',
  'returned',
])

export function readRun(value: unknown): StoredRun | null {
  const raw = (value ?? null) as Record<string, unknown> | null
  if (!raw || !isCourierProviderId(raw['provider']) || !STATES.has(raw['state'] as CourierState)) return null
  return {
    provider: raw['provider'],
    deliveryRef: str(raw['deliveryRef'], 120),
    state: raw['state'] as CourierState,
    pending: raw['pending'] === true,
    idempotencyKey: str(raw['idempotencyKey'], 120),
    trackingUrl: raw['trackingUrl'] ? str(raw['trackingUrl'], 500) : null,
    etaMs: numOrNull(raw['etaMs']),
    pickupEtaMs: numOrNull(raw['pickupEtaMs']),
    feeCents: numOrNull(raw['feeCents']),
    currency: str(raw['currency'], 3) || 'usd',
    reason: raw['reason'] ? str(raw['reason']) : null,
    testMode: raw['testMode'] === true,
    cancelRequested: raw['cancelRequested'] === true,
    cancelReason: raw['cancelReason'] ? str(raw['cancelReason']) : null,
    cancelledByStore: raw['cancelledByStore'] === true,
    createdAtMs: Number(raw['createdAtMs']) || 0,
    createdByUid: str(raw['createdByUid'], 128),
    updatedAtMs: Number(raw['updatedAtMs']) || 0,
  }
}

export function readDelivery(id: string, data: unknown): StoredDelivery | null {
  const raw = (data ?? null) as Record<string, unknown> | null
  if (!raw || !raw['hostId'] || !raw['orderId']) return null
  return {
    id,
    orgId: str(raw['orgId'], 128),
    hostId: str(raw['hostId'], 128),
    orderId: str(raw['orderId'], 200),
    quote: readQuote(raw['quote']),
    run: readRun(raw['run']),
    history: (Array.isArray(raw['history']) ? raw['history'] : [])
      .map(readRun)
      .filter((run): run is StoredRun => Boolean(run)),
    attempts: Number(raw['attempts']) || 0,
    seenEvents: (Array.isArray(raw['seenEvents']) ? raw['seenEvents'] : []).map((entry) => str(entry, 300)),
    open: raw['open'] === true,
    nextCheckAtMs: Number(raw['nextCheckAtMs']) || 0,
    updatedAtMs: Number(raw['updatedAtMs']) || 0,
  }
}

/** A document as Firestore takes it: no `undefined` anywhere, and no `id` (the path carries it). */
function toDoc<T extends { id: string }>(value: T): Record<string, unknown> {
  const rest: Record<string, unknown> = { ...value }
  delete rest['id']
  return JSON.parse(JSON.stringify(rest)) as Record<string, unknown>
}

export function createFirestoreCourierStore(db: () => Firestore): CourierStore {
  const connections = () => db().collection(COURIER_CONNECTIONS_COLLECTION)
  const deliveries = () => db().collection(COURIER_DELIVERIES_COLLECTION)
  return {
    async getConnection(hostId, provider) {
      const id = connectionId(hostId, provider)
      const snapshot = await connections().doc(id).get()
      return snapshot.exists ? readConnection(id, snapshot.data()) : null
    },
    async putConnection(connection) {
      await connections().doc(connection.id).set(toDoc(connection))
    },
    async patchConnection(id, patch) {
      await connections().doc(id).set(JSON.parse(JSON.stringify(patch)), { merge: true })
    },
    async deleteConnection(id) {
      await connections().doc(id).delete()
    },
    async getDelivery(hostId, orderId) {
      const id = deliveryId(hostId, orderId)
      const snapshot = await deliveries().doc(id).get()
      return snapshot.exists ? readDelivery(id, snapshot.data()) : null
    },
    async updateDelivery(hostId, orderId, change) {
      const id = deliveryId(hostId, orderId)
      const ref = deliveries().doc(id)
      return db().runTransaction(async (transaction) => {
        const snapshot = await transaction.get(ref)
        const current = snapshot.exists ? readDelivery(id, snapshot.data()) : null
        const { next, result } = change(current)
        if (next) transaction.set(ref, toDoc(next))
        return result
      })
    },
    async dueDeliveries(nowMs, limit) {
      const snapshot = await deliveries()
        .where('open', '==', true)
        .where('nextCheckAtMs', '<=', nowMs)
        .orderBy('nextCheckAtMs', 'asc')
        .limit(limit)
        .get()
      return snapshot.docs
        .map((doc) => readDelivery(doc.id, doc.data()))
        .filter((delivery): delivery is StoredDelivery => Boolean(delivery))
    },
    async hasOpenRun(hostId) {
      const snapshot = await deliveries().where('hostId', '==', hostId).where('open', '==', true).limit(1).get()
      return !snapshot.empty
    },
  }
}
