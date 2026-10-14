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

import type { AdvertisingBrowserIds } from '@aglyn/aglyn/app-utils/advertising-consent'
import {
  AD_CONVERSION_CONNECTIONS_COLLECTION,
  AD_CONVERSION_CONSENTS_COLLECTION,
  AD_CONVERSION_EVENTS_COLLECTION,
} from '../constants'
import type { AdConnectionStatus, AdConnectionView, AdProviderId } from '../model/connections'
import type { ConversionEvent } from '../providers/event'

/**
 * Where connections, recorded consents and owed events are kept (AGL-3694).
 * Every client is refused all three by the rules; this module is the only
 * writer, through the Admin SDK. Epoch-ms numbers rather than server
 * timestamps, so a spec drives the clock; `expiresAt` is a `Date` because it
 * is what the Firestore TTL policy deletes by.
 */

/** A connection as stored. The sealed token carries `token` in its name, which the data export redacts by. */
export interface StoredConnection {
  orgId: string
  hostId: string
  provider: AdProviderId
  status: AdConnectionStatus
  sealedToken: string | null
  tokenKeyId: string | null
  adAccountId: string | null
  testEventCode: string | null
  lastSentAtMs: number | null
  lastSentEvent: string | null
  lastSentTest: boolean
  lastFailedAtMs: number | null
  lastError: string | null
  totals: { sent: number; failed: number }
  connectedAtMs: number | null
  connectedByUid: string | null
  updatedAtMs: number
}

/** A checkout's advertising consent, waiting for its order to be paid. */
export interface StoredConsent {
  orgId: string
  hostId: string
  orderKey: string
  /** The record the visitor carried: its status and when it was decided. */
  status: string
  consentAtMs: number
  country: string | null
  url: string | null
  ids: AdvertisingBrowserIds
  userAgent: string | null
  ip: string | null
  createdAtMs: number
  expiresAt: Date
}

/** One conversion owed to one connection. */
export interface StoredEvent {
  orgId: string
  connectionId: string
  hostId: string
  provider: AdProviderId
  /** `sent` is a tombstone kept until it expires, so a redelivered order event is not owed twice. */
  status: 'pending' | 'sent' | 'failed'
  /** `null` live; the vendor's test code, or `true` for Pinterest's test flag. */
  test: string | true | null
  /** The browser tag id the event goes to (Meta, TikTok), as the site had it at intake. */
  pixelId: string | null
  attempts: number
  nextAttemptAtMs: number
  createdAtMs: number
  lastError: string | null
  /** The hashed address, for a person's erasure; `null` when none was given. */
  emailHash: string | null
  event: ConversionEvent
  expiresAt: Date
}

export function emptyConnection(input: {
  orgId: string
  hostId: string
  provider: AdProviderId
  nowMs: number
}): StoredConnection {
  return {
    orgId: input.orgId,
    hostId: input.hostId,
    provider: input.provider,
    status: 'active',
    sealedToken: null,
    tokenKeyId: null,
    adAccountId: null,
    testEventCode: null,
    lastSentAtMs: null,
    lastSentEvent: null,
    lastSentTest: false,
    lastFailedAtMs: null,
    lastError: null,
    totals: { sent: 0, failed: 0 },
    connectedAtMs: null,
    connectedByUid: null,
    updatedAtMs: input.nowMs,
  }
}

/** The card's view of a connection: never the token. */
export function connectionView(id: string, stored: StoredConnection): AdConnectionView {
  return {
    id,
    provider: stored.provider,
    hostId: stored.hostId,
    status: stored.status,
    adAccountId: stored.adAccountId ?? null,
    testEventCode: stored.testEventCode ?? null,
    lastSentAtMs: stored.lastSentAtMs ?? null,
    lastSentEvent: stored.lastSentEvent ?? null,
    lastSentTest: stored.lastSentTest === true,
    lastFailedAtMs: stored.lastFailedAtMs ?? null,
    lastError: stored.lastError ?? null,
    totals: { sent: stored.totals?.sent ?? 0, failed: stored.totals?.failed ?? 0 },
    connectedAtMs: stored.connectedAtMs ?? null,
  }
}

/** The retry delay after an event's `attempts`th failure: a minute, doubling, at most six hours. */
export const eventRetryDelayMs = (attempts: number): number =>
  Math.min(6 * 60 * 60 * 1000, 60_000 * 2 ** Math.max(0, attempts - 1))

/** A document id for one owed event: the connection and the event id, path-safe. */
export const eventDocId = (connectionId: string, eventId: string): string =>
  `${connectionId}_${eventId}`.replace(/[^A-Za-z0-9_.:-]/g, '-').slice(0, 700)

/** A document id for one checkout's consent. */
export const consentDocId = (hostId: string, orderKey: string): string =>
  `${hostId}_${orderKey}`.replace(/[^A-Za-z0-9_.:-]/g, '-').slice(0, 700)

/** The storage intake, delivery and routes use. A spec supplies an in-memory one. */
export interface AdConversionStore {
  getConnection(id: string): Promise<StoredConnection | null>
  /** Creates or merges fields. */
  patchConnection(id: string, patch: Partial<StoredConnection>): Promise<void>
  removeConnection(id: string): Promise<void>
  listConnectionsForHost(hostId: string): Promise<Array<{ id: string; connection: StoredConnection }>>
  putConsent(id: string, consent: StoredConsent): Promise<void>
  getConsent(id: string): Promise<StoredConsent | null>
  removeConsent(id: string): Promise<void>
  /** Owes an event. `false` when it was already owed: the de-duplication. */
  enqueueEvent(id: string, event: StoredEvent): Promise<boolean>
  /** Pending events due by `nowMs`, oldest due first. */
  dueEvents(nowMs: number, limit: number): Promise<Array<{ id: string; stored: StoredEvent }>>
  /** Marks an event sent: its personal data is dropped, the tombstone kept. */
  eventSent(id: string, nowMs: number): Promise<void>
  eventRetry(id: string, attempts: number, nextAttemptAtMs: number, error: string): Promise<void>
  eventFailed(id: string, error: string): Promise<void>
  /** Deletes a connection's owed events (on disconnect). */
  clearEvents(connectionId: string): Promise<void>
  /** Deletes an org's events carrying one hashed address; answers how many. `dryRun` only counts. */
  eraseEventsByEmailHash(orgId: string, emailHash: string, dryRun: boolean): Promise<number>
}

/** The production store, over the Admin SDK's Firestore. */
export function createFirestoreAdConversionStore(firestore: () => any): AdConversionStore {
  const connections = () => firestore().collection(AD_CONVERSION_CONNECTIONS_COLLECTION)
  const consents = () => firestore().collection(AD_CONVERSION_CONSENTS_COLLECTION)
  const events = () => firestore().collection(AD_CONVERSION_EVENTS_COLLECTION)

  return {
    async getConnection(id) {
      const snapshot = await connections().doc(id).get()
      return snapshot.exists ? (snapshot.data() as StoredConnection) : null
    },

    async patchConnection(id, patch) {
      await connections().doc(id).set(patch, { merge: true })
    },

    async removeConnection(id) {
      await connections().doc(id).delete()
    },

    async listConnectionsForHost(hostId) {
      const snapshot = await connections().where('hostId', '==', hostId).limit(10).get()
      return snapshot.docs.map((doc: any) => ({ id: doc.id, connection: doc.data() as StoredConnection }))
    },

    async putConsent(id, consent) {
      await consents().doc(id).set(consent)
    },

    async getConsent(id) {
      const snapshot = await consents().doc(id).get()
      return snapshot.exists ? (snapshot.data() as StoredConsent) : null
    },

    async removeConsent(id) {
      await consents().doc(id).delete()
    },

    async enqueueEvent(id, event) {
      // `create`, so an order event delivered twice by the outbox is owed
      // once: the second create fails with ALREADY_EXISTS, which is the dedupe.
      try {
        await events().doc(id).create(event)
        return true
      } catch (error: any) {
        if (error?.code === 6 || /already exists/i.test(String(error?.message ?? ''))) return false
        throw error
      }
    },

    async dueEvents(nowMs, limit) {
      const snapshot = await events()
        .where('status', '==', 'pending')
        .where('nextAttemptAtMs', '<=', nowMs)
        .orderBy('nextAttemptAtMs', 'asc')
        .limit(limit)
        .get()
      return snapshot.docs.map((doc: any) => ({ id: doc.id, stored: doc.data() as StoredEvent }))
    },

    async eventSent(id, nowMs) {
      // `update`, whose dotted keys are field PATHS (a merging `set` would
      // write a field literally named `event.user`).
      await events().doc(id).update({
        status: 'sent',
        lastError: null,
        nextAttemptAtMs: nowMs,
        emailHash: null,
        'event.user': {},
        'event.browser': { ip: null, userAgent: null },
      })
    },

    async eventRetry(id, attempts, nextAttemptAtMs, error) {
      await events().doc(id).set({ attempts, nextAttemptAtMs, lastError: error.slice(0, 300) }, { merge: true })
    },

    async eventFailed(id, error) {
      await events().doc(id).update({
        status: 'failed',
        lastError: error.slice(0, 300),
        emailHash: null,
        'event.user': {},
        'event.browser': { ip: null, userAgent: null },
      })
    },

    async clearEvents(connectionId) {
      for (let round = 0; round < 20; round += 1) {
        const snapshot = await events().where('connectionId', '==', connectionId).limit(400).get()
        if (snapshot.empty) return
        await Promise.all(snapshot.docs.map((doc: any) => doc.ref.delete()))
      }
    },

    async eraseEventsByEmailHash(orgId, emailHash, dryRun) {
      const snapshot = await events().where('emailHash', '==', emailHash).limit(500).get()
      const mine = snapshot.docs.filter((doc: any) => (doc.data() as StoredEvent).orgId === orgId)
      if (!dryRun) await Promise.all(mine.map((doc: any) => doc.ref.delete()))
      return mine.length
    },
  }
}
