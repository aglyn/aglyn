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
  EVENT_MAX_ATTEMPTS,
  LOG_ROWS_KEPT,
  MARKETING_PLATFORM_CONNECTIONS_COLLECTION,
  MARKETING_PLATFORM_EVENTS_COLLECTION,
  MARKETING_PLATFORM_LOG_SUBCOLLECTION,
} from '../constants'
import {
  MARKETING_PROVIDERS,
  type MarketingConnectionLogEntry,
  type MarketingConnectionStatus,
  type MarketingConnectionView,
  type MarketingProviderId,
  type MarketingProviderList,
} from '../model/connections'
import type { MarketingEvent } from '../providers/provider'

/**
 * Where connections, their logs and their owed events are kept (AGL-3639):
 * `marketingPlatformConnections/{hostId}_{provider}`, its `log`
 * subcollection, and `marketingPlatformEvents/{connectionId}_{eventId}`.
 * Every client is refused all three by the rules; this module and the
 * plugin's routes are the only writers, through the Admin SDK.
 *
 * Plain fields, epoch-ms numbers rather than server timestamps: the engine
 * compares them with its own clock, and a spec drives that clock.
 */

/** A connection as stored. The sealed fields carry `token` in their names, which the data export redacts by. */
export interface StoredConnection {
  orgId: string
  hostId: string
  provider: MarketingProviderId
  status: MarketingConnectionStatus
  authKind: 'api-key' | 'oauth'
  accountName: string | null
  listId: string | null
  lists: MarketingProviderList[]
  tag: string
  syncContacts: boolean
  syncEvents: boolean
  /** The API key or access token, sealed. */
  sealedToken: string | null
  /** An OAuth refresh token, sealed, for a provider whose access tokens expire. */
  sealedRefreshToken: string | null
  tokenExpiresAtMs: number | null
  tokenKeyId: string | null
  apiBase: string | null
  cursors: {
    /** The people walk (`pluginPeopleChangedSince`). */
    contacts: string | null
    /** The site suppression walk. */
    suppressions: string | null
    /** The provider's consent walk. */
    provider: string | null
  }
  backfillDone: boolean
  nextRunAtMs: number
  leaseUntilMs: number
  consecutiveFailures: number
  lastRunAtMs: number | null
  lastSuccessAtMs: number | null
  lastError: string | null
  totals: MarketingConnectionView['totals']
  connectedAtMs: number | null
  connectedByUid: string | null
  /** An OAuth connect in progress: the hash of its state's nonce, its expiry and who started it. */
  pendingOAuth: PendingOAuth | null
  updatedAtMs: number
}

/**
 * An OAuth connect between the start and the provider's redirect back. The
 * nonce itself rides only in the state the browser carries; this holds its
 * hash, so a stolen read of the document cannot finish someone's connect.
 */
export interface PendingOAuth {
  nonceHash: string
  expMs: number
  uid: string
  /** The PKCE verifier, for a provider that asks for one (Klaviyo). */
  verifier: string | null
  /** The console path the member is sent back to. */
  returnTo: string
}

/** A commerce event owed to one connection. */
export interface StoredEvent {
  /** The owning org, which the workspace erasure deletes by. */
  orgId: string
  connectionId: string
  hostId: string
  status: 'pending' | 'failed'
  attempts: number
  nextAttemptAtMs: number
  createdAtMs: number
  lastError: string | null
  event: MarketingEvent
}

export function emptyConnection(input: {
  orgId: string
  hostId: string
  provider: MarketingProviderId
  nowMs: number
}): StoredConnection {
  return {
    orgId: input.orgId,
    hostId: input.hostId,
    provider: input.provider,
    status: 'active',
    authKind: 'api-key',
    accountName: null,
    listId: null,
    lists: [],
    tag: 'Aglyn',
    syncContacts: true,
    syncEvents: true,
    sealedToken: null,
    sealedRefreshToken: null,
    tokenExpiresAtMs: null,
    tokenKeyId: null,
    apiBase: null,
    cursors: { contacts: null, suppressions: null, provider: null },
    backfillDone: false,
    nextRunAtMs: input.nowMs,
    leaseUntilMs: 0,
    consecutiveFailures: 0,
    lastRunAtMs: null,
    lastSuccessAtMs: null,
    lastError: null,
    totals: { contactsPushed: 0, consentPulled: 0, eventsSent: 0 },
    connectedAtMs: null,
    connectedByUid: null,
    pendingOAuth: null,
    updatedAtMs: input.nowMs,
  }
}

/** The page's view of a connection: never a credential, a cursor or a lease. */
export function connectionView(id: string, stored: StoredConnection): MarketingConnectionView {
  return {
    id,
    provider: stored.provider,
    hostId: stored.hostId,
    status: stored.status,
    authKind: stored.authKind,
    accountName: stored.accountName ?? null,
    listId: stored.listId ?? null,
    lists: Array.isArray(stored.lists) ? stored.lists : [],
    tag: stored.tag ?? '',
    syncContacts: stored.syncContacts !== false,
    syncEvents: stored.syncEvents !== false,
    backfillDone: stored.backfillDone === true,
    lastRunAtMs: stored.lastRunAtMs ?? null,
    lastSuccessAtMs: stored.lastSuccessAtMs ?? null,
    nextRunAtMs: stored.status === 'active' ? (stored.nextRunAtMs ?? null) : null,
    lastError: stored.lastError ?? null,
    consecutiveFailures: stored.consecutiveFailures ?? 0,
    totals: {
      contactsPushed: stored.totals?.contactsPushed ?? 0,
      consentPulled: stored.totals?.consentPulled ?? 0,
      eventsSent: stored.totals?.eventsSent ?? 0,
    },
    connectedAtMs: stored.connectedAtMs ?? null,
  }
}

/** The storage the engine and the routes use. A spec supplies an in-memory one. */
export interface ConnectionStore {
  get(id: string): Promise<StoredConnection | null>
  /** Creates or replaces fields; a missing document is created from `patch`. */
  patch(id: string, patch: Partial<StoredConnection>): Promise<void>
  remove(id: string): Promise<void>
  listForHost(hostId: string): Promise<Array<{ id: string; connection: StoredConnection }>>
  /** Active connections due to run, oldest due first. */
  listDue(nowMs: number, limit: number): Promise<string[]>
  /**
   * Takes the run lease in a transaction: answers the connection when it is
   * active, due, and not leased by another run; `null` otherwise.
   */
  lease(id: string, nowMs: number, leaseMs: number): Promise<StoredConnection | null>
  appendLog(id: string, entry: Omit<MarketingConnectionLogEntry, 'id'>): Promise<void>
  /** The log, newest first, from before `beforeMs` when given. */
  readLog(id: string, limit: number, beforeMs?: number | null): Promise<MarketingConnectionLogEntry[]>
  /** A site's connections that are owed events, for the event subscriber. */
  eventConnectionsForHost(hostId: string): Promise<string[]>
  /** Owes an event to a connection. Idempotent by event id. */
  enqueueEvent(
    connectionId: string,
    owner: { orgId: string; hostId: string },
    event: MarketingEvent,
    nowMs: number,
  ): Promise<void>
  /** A connection's pending events, oldest first. */
  pendingEvents(connectionId: string, limit: number): Promise<Array<{ id: string; stored: StoredEvent }>>
  eventDelivered(id: string): Promise<void>
  /** Records a failed attempt; past {@link EVENT_MAX_ATTEMPTS} the event is marked failed. */
  eventFailed(id: string, stored: StoredEvent, error: string, nowMs: number): Promise<'retry' | 'failed'>
  /** Deletes a connection's owed events (on disconnect). */
  clearEvents(connectionId: string): Promise<void>
}

/** The retry delay after an event's `attempts`th failure: a minute, doubling, at most six hours. */
export const eventRetryDelayMs = (attempts: number): number =>
  Math.min(6 * 60 * 60 * 1000, 60_000 * 2 ** Math.max(0, attempts - 1))

/** The production store, over the Admin SDK's Firestore. */
export function createFirestoreConnectionStore(firestore: () => any): ConnectionStore {
  const connections = () => firestore().collection(MARKETING_PLATFORM_CONNECTIONS_COLLECTION)
  const events = () => firestore().collection(MARKETING_PLATFORM_EVENTS_COLLECTION)

  return {
    async get(id) {
      const snapshot = await connections().doc(id).get()
      return snapshot.exists ? (snapshot.data() as StoredConnection) : null
    },

    async patch(id, patch) {
      await connections().doc(id).set(patch, { merge: true })
    },

    async remove(id) {
      const ref = connections().doc(id)
      const log = await ref.collection(MARKETING_PLATFORM_LOG_SUBCOLLECTION).limit(500).get()
      await Promise.all(log.docs.map((doc: any) => doc.ref.delete()))
      await ref.delete()
    },

    async listForHost(hostId) {
      const snapshot = await connections().where('hostId', '==', hostId).limit(10).get()
      return snapshot.docs.map((doc: any) => ({ id: doc.id, connection: doc.data() as StoredConnection }))
    },

    async listDue(nowMs, limit) {
      const snapshot = await connections()
        .where('status', '==', 'active')
        .where('nextRunAtMs', '<=', nowMs)
        .orderBy('nextRunAtMs', 'asc')
        .limit(limit)
        .get()
      return snapshot.docs.map((doc: any) => doc.id)
    },

    async lease(id, nowMs, leaseMs) {
      const db = firestore()
      const ref = connections().doc(id)
      return db.runTransaction(async (transaction: any) => {
        const snapshot = await transaction.get(ref)
        if (!snapshot.exists) return null
        const stored = snapshot.data() as StoredConnection
        if (stored.status !== 'active') return null
        if ((stored.nextRunAtMs ?? 0) > nowMs) return null
        if ((stored.leaseUntilMs ?? 0) > nowMs) return null
        transaction.set(ref, { leaseUntilMs: nowMs + leaseMs }, { merge: true })
        return { ...stored, leaseUntilMs: nowMs + leaseMs }
      })
    },

    async appendLog(id, entry) {
      const log = connections().doc(id).collection(MARKETING_PLATFORM_LOG_SUBCOLLECTION)
      await log.add(entry)
      // Kept short: the page shows the latest, and a failing connection
      // writes a row every attempt.
      const stale = await log.orderBy('atMs', 'desc').offset(LOG_ROWS_KEPT).limit(50).get()
      await Promise.all(stale.docs.map((doc: any) => doc.ref.delete()))
    },

    async readLog(id, limit, beforeMs) {
      let query = connections().doc(id).collection(MARKETING_PLATFORM_LOG_SUBCOLLECTION).orderBy('atMs', 'desc')
      if (typeof beforeMs === 'number' && Number.isFinite(beforeMs)) query = query.where('atMs', '<', beforeMs)
      const snapshot = await query.limit(limit).get()
      return snapshot.docs.map((doc: any) => ({ id: doc.id, ...(doc.data() as Omit<MarketingConnectionLogEntry, 'id'>) }))
    },

    async eventConnectionsForHost(hostId) {
      const snapshot = await connections().where('hostId', '==', hostId).limit(10).get()
      return snapshot.docs
        .filter((doc: any) => {
          const stored = doc.data() as StoredConnection
          // A failing connection is still owed what happens meanwhile: the
          // event waits for the run that recovers it. A paused one, or one
          // waiting to be connected again, is not — a flow fired weeks late
          // by a backlog is worse than none.
          return (
            (stored.status === 'active' || stored.status === 'error') &&
            stored.syncEvents !== false &&
            MARKETING_PROVIDERS[stored.provider]?.events === true
          )
        })
        .map((doc: any) => doc.id)
    },

    async enqueueEvent(connectionId, owner, event, nowMs) {
      const ref = events().doc(`${connectionId}_${event.id}`.replace(/[^A-Za-z0-9_.:-]/g, '-').slice(0, 700))
      // `create`, so an event delivered twice by the outbox is owed once; a
      // second create fails with ALREADY_EXISTS, which is the dedupe.
      await ref
        .create({
          orgId: owner.orgId,
          connectionId,
          hostId: owner.hostId,
          status: 'pending',
          attempts: 0,
          nextAttemptAtMs: nowMs,
          createdAtMs: nowMs,
          lastError: null,
          event,
        } satisfies StoredEvent)
        .catch((error: any) => {
          if (error?.code === 6 || /already exists/i.test(String(error?.message ?? ''))) return
          throw error
        })
    },

    async pendingEvents(connectionId, limit) {
      const snapshot = await events()
        .where('connectionId', '==', connectionId)
        .where('status', '==', 'pending')
        .orderBy('createdAtMs', 'asc')
        .limit(limit)
        .get()
      return snapshot.docs.map((doc: any) => ({ id: doc.id, stored: doc.data() as StoredEvent }))
    },

    async eventDelivered(id) {
      await events().doc(id).delete()
    },

    async eventFailed(id, stored, error, nowMs) {
      const attempts = (stored.attempts ?? 0) + 1
      const failed = attempts >= EVENT_MAX_ATTEMPTS
      await events()
        .doc(id)
        .set(
          {
            attempts,
            lastError: error.slice(0, 300),
            status: failed ? 'failed' : 'pending',
            nextAttemptAtMs: nowMs + eventRetryDelayMs(attempts),
          },
          { merge: true },
        )
      return failed ? 'failed' : 'retry'
    },

    async clearEvents(connectionId) {
      for (let round = 0; round < 20; round += 1) {
        const snapshot = await events().where('connectionId', '==', connectionId).limit(400).get()
        if (snapshot.empty) return
        await Promise.all(snapshot.docs.map((doc: any) => doc.ref.delete()))
      }
    },
  }
}
