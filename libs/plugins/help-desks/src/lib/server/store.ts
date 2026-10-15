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

import { createHash } from 'node:crypto'
import { createResourceUid } from '@aglyn/aglyn/app-utils/create-resource-uid'
import {
  HELP_DESK_CONNECTIONS_COLLECTION,
  HELP_DESK_CUSTOMERS_COLLECTION,
  HELP_DESK_LOG_SUBCOLLECTION,
  HELP_DESK_OUTBOX_COLLECTION,
  LOG_ROWS_KEPT,
  OUTBOX_MAX_ATTEMPTS,
} from '../constants'
import type {
  HelpDeskConnectionStatus,
  HelpDeskConnectionView,
  HelpDeskLogEntry,
  HelpDeskProviderId,
  HelpDeskTarget,
} from '../model/connections'
import type { HelpDeskOrder, HelpDeskOrderBuyer } from '../model/orders'
import type { HelpDeskTicket } from '../providers/provider'

/**
 * Where connections, their logs, the work owed to them and what they know
 * of each buyer are kept (AGL-3824): `helpDeskConnections/{hostId}_{provider}`
 * with its `log` subcollection, `helpDeskOutbox/{connectionId}_{kind}_{key}`
 * and `helpDeskCustomers/{connectionId}_{emailHash}`. Every client is refused
 * all of them by the rules; this module is the only writer, through the
 * Admin SDK.
 *
 * Plain fields, epoch-ms numbers rather than server timestamps: the engine
 * compares them with its own clock, and a spec drives that clock.
 */

/** A connection as stored. The sealed field carries `token` in its name, which the data export redacts by. */
export interface StoredConnection {
  orgId: string
  hostId: string
  provider: HelpDeskProviderId
  status: HelpDeskConnectionStatus
  accountName: string | null
  /** The account's subdomain, for a help desk addressed by one. Not a secret. */
  account: string | null
  /** Richpanel's support address. Not a secret. */
  supportEmail: string | null
  targetId: string | null
  targets: HelpDeskTarget[]
  syncCustomers: boolean
  sendTickets: boolean
  /** The token, login and app client id, sealed together. */
  sealedToken: string | null
  tokenKeyId: string | null
  cursors: {
    /** The people walk (`pluginPeopleChangedSince`). */
    people: string | null
    /** The order backfill: the creation time it reads on from. */
    ordersMs: number | null
  }
  backfill: { people: boolean; orders: boolean }
  nextRunAtMs: number
  leaseUntilMs: number
  consecutiveFailures: number
  lastRunAtMs: number | null
  lastSuccessAtMs: number | null
  lastError: string | null
  totals: HelpDeskConnectionView['totals']
  connectedAtMs: number | null
  connectedByUid: string | null
  updatedAtMs: number
}

/** Work owed to one connection: an order to file under its buyer, or a message to open as a ticket. */
export interface StoredOutboxItem {
  /** The owning org, which the workspace erasure deletes by. */
  orgId: string
  connectionId: string
  hostId: string
  kind: 'order' | 'ticket'
  /** The buyer's or sender's address, which a person erasure deletes by. */
  email: string
  status: 'pending' | 'failed'
  attempts: number
  nextAttemptAtMs: number
  createdAtMs: number
  lastError: string | null
  buyer?: HelpDeskOrderBuyer
  order?: HelpDeskOrder
  ticket?: HelpDeskTicket
}

/** What one connection knows of one buyer. */
export interface StoredCustomer {
  orgId: string
  connectionId: string
  hostId: string
  email: string
  /** The help desk's id for them; `null` once it said they are gone. */
  remoteId: string | null
  name: string | null
  /** Their latest orders, newest first. */
  orders: HelpDeskOrder[]
  updatedAtMs: number
}

export function emptyConnection(input: {
  orgId: string
  hostId: string
  provider: HelpDeskProviderId
  nowMs: number
}): StoredConnection {
  return {
    orgId: input.orgId,
    hostId: input.hostId,
    provider: input.provider,
    status: 'active',
    accountName: null,
    account: null,
    supportEmail: null,
    targetId: null,
    targets: [],
    syncCustomers: true,
    sendTickets: false,
    sealedToken: null,
    tokenKeyId: null,
    cursors: { people: null, ordersMs: null },
    backfill: { people: false, orders: false },
    nextRunAtMs: input.nowMs,
    leaseUntilMs: 0,
    consecutiveFailures: 0,
    lastRunAtMs: null,
    lastSuccessAtMs: null,
    lastError: null,
    totals: { customersPushed: 0, ordersPushed: 0, ticketsCreated: 0 },
    connectedAtMs: null,
    connectedByUid: null,
    updatedAtMs: input.nowMs,
  }
}

/** The card's view of a connection: never a credential, a cursor or a lease. */
export function connectionView(id: string, stored: StoredConnection): HelpDeskConnectionView {
  return {
    id,
    provider: stored.provider,
    hostId: stored.hostId,
    status: stored.status,
    accountName: stored.accountName ?? stored.account ?? null,
    targetId: stored.targetId ?? null,
    targets: Array.isArray(stored.targets) ? stored.targets : [],
    syncCustomers: stored.syncCustomers !== false,
    sendTickets: stored.sendTickets === true,
    backfillDone: stored.backfill?.people === true && stored.backfill?.orders === true,
    lastRunAtMs: stored.lastRunAtMs ?? null,
    lastSuccessAtMs: stored.lastSuccessAtMs ?? null,
    nextRunAtMs: stored.status === 'active' ? (stored.nextRunAtMs ?? null) : null,
    lastError: stored.lastError ?? null,
    consecutiveFailures: stored.consecutiveFailures ?? 0,
    totals: {
      customersPushed: stored.totals?.customersPushed ?? 0,
      ordersPushed: stored.totals?.ordersPushed ?? 0,
      ticketsCreated: stored.totals?.ticketsCreated ?? 0,
    },
    connectedAtMs: stored.connectedAtMs ?? null,
  }
}

/** A buyer's address as the key of what a connection knows of them: never the address itself. */
export const customerKey = (email: string): string =>
  createHash('sha256').update(email.trim().toLowerCase()).digest('hex').slice(0, 32)

export const customerDocId = (connectionId: string, email: string): string => `${connectionId}_${customerKey(email)}`

/** An outbox item's id: one per connection, kind and key, so the same fact is owed once. */
export const outboxItemId = (connectionId: string, kind: StoredOutboxItem['kind'], key: string): string =>
  `${connectionId}_${kind}_${key}`.replace(/[^A-Za-z0-9_.:-]/g, '-').slice(0, 700)

/** What one person erasure removed. */
export interface PersonEraseCounts {
  customers: number
  outbox: number
}

/** The storage the engine, the intake and the routes use. A spec supplies an in-memory one. */
export interface ConnectionStore {
  get(id: string): Promise<StoredConnection | null>
  /** Creates or replaces fields; a missing document is created from `patch`. */
  patch(id: string, patch: Partial<StoredConnection>): Promise<void>
  /** Deletes the connection, its log, everything owed to it and everything it knows of buyers. */
  remove(id: string): Promise<void>
  listForHost(hostId: string): Promise<Array<{ id: string; connection: StoredConnection }>>
  /** Active connections due to run, oldest due first. */
  listDue(nowMs: number, limit: number): Promise<string[]>
  /**
   * Takes the run lease in a transaction: answers the connection when it is
   * active, due, and not leased by another run; `null` otherwise.
   */
  lease(id: string, nowMs: number, leaseMs: number): Promise<StoredConnection | null>
  appendLog(id: string, entry: Omit<HelpDeskLogEntry, 'id'>): Promise<void>
  /** The log, newest first, from before `beforeMs` when given. */
  readLog(id: string, limit: number, beforeMs?: number | null): Promise<HelpDeskLogEntry[]>
  /** A site's connections that take orders, or contact form messages, now. */
  connectionsTaking(hostId: string, kind: StoredOutboxItem['kind']): Promise<string[]>
  /** Owes an item to a connection. Idempotent by its id. */
  enqueue(id: string, item: StoredOutboxItem): Promise<void>
  /** A connection's pending items, oldest first. */
  pendingItems(connectionId: string, limit: number): Promise<Array<{ id: string; stored: StoredOutboxItem }>>
  itemDelivered(id: string): Promise<void>
  /** Records a failed attempt; past {@link OUTBOX_MAX_ATTEMPTS} the item is marked failed. */
  itemFailed(id: string, stored: StoredOutboxItem, error: string, nowMs: number): Promise<'retry' | 'failed'>
  /** Forgets everything a connection knows of buyers (a different account was connected). */
  clearCustomers(connectionId: string): Promise<void>
  getCustomer(connectionId: string, email: string): Promise<StoredCustomer | null>
  putCustomer(connectionId: string, customer: StoredCustomer): Promise<void>
  /** Deletes what every connection of an org holds about one address. */
  erasePerson(orgId: string, email: string, dryRun: boolean): Promise<PersonEraseCounts>
}

/** The retry delay after an item's `attempts`th failure: a minute, doubling, at most six hours. */
export const outboxRetryDelayMs = (attempts: number): number =>
  Math.min(6 * 60 * 60 * 1000, 60_000 * 2 ** Math.max(0, attempts - 1))

/** Whether a connection takes this kind of item now. */
export function connectionTakes(stored: StoredConnection, kind: StoredOutboxItem['kind']): boolean {
  // A failing connection is still owed what happens meanwhile; a paused one,
  // or one waiting to be connected again, is not.
  if (stored.status !== 'active' && stored.status !== 'error') return false
  return kind === 'order' ? stored.syncCustomers !== false : stored.sendTickets === true
}

/** The production store, over the Admin SDK's Firestore. */
export function createFirestoreConnectionStore(firestore: () => any): ConnectionStore {
  const connections = () => firestore().collection(HELP_DESK_CONNECTIONS_COLLECTION)
  const outbox = () => firestore().collection(HELP_DESK_OUTBOX_COLLECTION)
  const customers = () => firestore().collection(HELP_DESK_CUSTOMERS_COLLECTION)

  const deleteAll = async (query: () => any): Promise<number> => {
    let deleted = 0
    for (let round = 0; round < 25; round += 1) {
      const snapshot = await query().limit(400).get()
      if (snapshot.empty) return deleted
      await Promise.all(snapshot.docs.map((doc: any) => doc.ref.delete()))
      deleted += snapshot.size
    }
    return deleted
  }

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
      await deleteAll(() => ref.collection(HELP_DESK_LOG_SUBCOLLECTION))
      await deleteAll(() => outbox().where('connectionId', '==', id))
      await deleteAll(() => customers().where('connectionId', '==', id))
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
      const log = connections().doc(id).collection(HELP_DESK_LOG_SUBCOLLECTION)
      await log.doc(createResourceUid()).set(entry)
      // Kept short: the card shows the latest, and a failing connection
      // writes a row every attempt.
      const stale = await log.orderBy('atMs', 'desc').offset(LOG_ROWS_KEPT).limit(50).get()
      await Promise.all(stale.docs.map((doc: any) => doc.ref.delete()))
    },

    async readLog(id, limit, beforeMs) {
      let query = connections().doc(id).collection(HELP_DESK_LOG_SUBCOLLECTION).orderBy('atMs', 'desc')
      if (typeof beforeMs === 'number' && Number.isFinite(beforeMs)) query = query.where('atMs', '<', beforeMs)
      const snapshot = await query.limit(limit).get()
      return snapshot.docs.map((doc: any) => ({ id: doc.id, ...(doc.data() as Omit<HelpDeskLogEntry, 'id'>) }))
    },

    async connectionsTaking(hostId, kind) {
      const snapshot = await connections().where('hostId', '==', hostId).limit(10).get()
      return snapshot.docs
        .filter((doc: any) => connectionTakes(doc.data() as StoredConnection, kind))
        .map((doc: any) => doc.id)
    },

    async enqueue(id, item) {
      // `create`, so a fact delivered twice by the outbox is owed once; a
      // second create fails with ALREADY_EXISTS, which is the dedupe.
      await outbox()
        .doc(id)
        .create(item)
        .catch((error: any) => {
          if (error?.code === 6 || /already exists/i.test(String(error?.message ?? ''))) return
          throw error
        })
    },

    async pendingItems(connectionId, limit) {
      const snapshot = await outbox()
        .where('connectionId', '==', connectionId)
        .where('status', '==', 'pending')
        .orderBy('createdAtMs', 'asc')
        .limit(limit)
        .get()
      return snapshot.docs.map((doc: any) => ({ id: doc.id, stored: doc.data() as StoredOutboxItem }))
    },

    async itemDelivered(id) {
      await outbox().doc(id).delete()
    },

    async itemFailed(id, stored, error, nowMs) {
      const attempts = (stored.attempts ?? 0) + 1
      const failed = attempts >= OUTBOX_MAX_ATTEMPTS
      await outbox()
        .doc(id)
        .set(
          {
            attempts,
            lastError: error.slice(0, 300),
            status: failed ? 'failed' : 'pending',
            nextAttemptAtMs: nowMs + outboxRetryDelayMs(attempts),
          },
          { merge: true },
        )
      return failed ? 'failed' : 'retry'
    },

    async clearCustomers(connectionId) {
      await deleteAll(() => customers().where('connectionId', '==', connectionId))
    },

    async getCustomer(connectionId, email) {
      const snapshot = await customers().doc(customerDocId(connectionId, email)).get()
      return snapshot.exists ? (snapshot.data() as StoredCustomer) : null
    },

    async putCustomer(connectionId, customer) {
      await customers().doc(customerDocId(connectionId, customer.email)).set(customer)
    },

    async erasePerson(orgId, email, dryRun) {
      const address = email.trim().toLowerCase()
      const owned = await connections().where('orgId', '==', orgId).limit(100).get()
      let customerCount = 0
      for (const doc of owned.docs) {
        const ref = customers().doc(customerDocId(doc.id, address))
        const snapshot = await ref.get()
        if (!snapshot.exists) continue
        customerCount += 1
        if (!dryRun) await ref.delete()
      }
      const owed = () => outbox().where('orgId', '==', orgId).where('email', '==', address)
      const outboxCount = dryRun ? (await owed().limit(1000).get()).size : await deleteAll(owed)
      return { customers: customerCount, outbox: outboxCount }
    },
  }
}
