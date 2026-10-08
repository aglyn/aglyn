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

import { createResourceUid } from '@aglyn/aglyn/app-utils/create-resource-uid'
import { createHash } from 'node:crypto'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import { ZAPIER_DELIVERY_MARKER_RETENTION_MS } from '../constants'
import type { ZapierHookEvent, ZapierHookView } from '../model/hook-events'

/**
 * Where the REST hooks live (AGL-3643). Two top-level collections, closed to
 * every client and written only by this plugin's server half through the
 * Admin SDK; org erasure removes both by `orgId`.
 *
 *  - `zapierHooks/{id}`: one subscription — the site, the events, the URL
 *    Zapier minted for the Zap (a capability: whoever holds it can post into
 *    the Zap, so it never leaves the server again), and the API key that
 *    made it, which every delivery asks again.
 *  - `zapierHookDeliveries/{sha}`: that one event reached one hook, so a
 *    retry of the event does not post it there twice. No customer data; the
 *    TTL policy removes it after `ZAPIER_DELIVERY_MARKER_RETENTION_MS`.
 *
 * Every module takes the narrow `ZapierHookStore` below, so a spec drives
 * them with the in-memory one (`testing/memory-store.ts`) and this file is
 * the only one that reaches Firestore.
 */

export const ZAPIER_HOOKS_COLLECTION = 'zapierHooks'
export const ZAPIER_DELIVERIES_COLLECTION = 'zapierHookDeliveries'

export type ZapierDeliveryStatus = 'delivered' | 'failed'

/** `zapierHooks/{id}`. */
export interface ZapierHookRecord {
  orgId: string
  hostId: string
  events: ZapierHookEvent[]
  targetUrl: string
  /** The public id of the API key that subscribed it. */
  keyId: string
  keyName: string | null
  createdAtMs: number
  updatedAtMs: number
  /** Deliveries that failed in a row; a success resets it. */
  consecutiveFailures: number
  lastDeliveryAtMs?: number | null
  lastDeliveryStatus?: ZapierDeliveryStatus | null
}

export interface ZapierHook extends ZapierHookRecord {
  id: string
}

export type ZapierUpsertResult = { hook: ZapierHook; created: boolean } | { limit: true }

export interface ZapierHookStore {
  /** A site's hooks, newest first; with `event`, only those taking it. */
  listHooks(hostId: string, event?: ZapierHookEvent): Promise<ZapierHook[]>
  /** Whether any hook of the site takes `event`: one read, for a relay to skip when none does. */
  hasHook(hostId: string, event: ZapierHookEvent): Promise<boolean>
  getHook(id: string): Promise<ZapierHook | null>
  /**
   * Makes a hook, or — when the site already has one for the same URL, a Zap
   * re-subscribing — gives that one the new events and key. One
   * transaction, so two subscribes cannot pass `max` together.
   */
  upsertHook(record: ZapierHookRecord, max: number): Promise<ZapierUpsertResult>
  updateHook(id: string, patch: Partial<ZapierHookRecord>): Promise<void>
  deleteHook(id: string): Promise<void>
  wasDelivered(eventId: string, hookId: string): Promise<boolean>
  markDelivered(input: { eventId: string; hookId: string; orgId: string; nowMs: number }): Promise<void>
}

/** The marker's id: one per event per hook, the same on every retry. */
export function zapierDeliveryId(eventId: string, hookId: string): string {
  return createHash('sha256').update(`${eventId}\u0000${hookId}`).digest('hex').slice(0, 40)
}

/** When a delivered marker expires, for the TTL policy. */
export function deliveryMarkerExpiry(nowMs: number): FirebaseFirestore.Timestamp {
  return firebaseAdmin.firestore.Timestamp.fromMillis(nowMs + ZAPIER_DELIVERY_MARKER_RETENTION_MS)
}

const iso = (ms: number | null | undefined): string | null =>
  typeof ms === 'number' && Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : null

function hostOf(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

/** A hook as anyone outside this plugin sees it: never its URL. */
export function zapierHookView(hook: ZapierHook): ZapierHookView {
  return {
    id: hook.id,
    object: 'hook',
    siteId: hook.hostId,
    events: [...hook.events],
    target: hostOf(hook.targetUrl),
    keyName: hook.keyName ?? null,
    created: iso(hook.createdAtMs) ?? new Date(0).toISOString(),
    lastDeliveryAt: iso(hook.lastDeliveryAtMs),
    lastDeliveryStatus: hook.lastDeliveryStatus ?? null,
  }
}

const newestFirst = (a: ZapierHook, b: ZapierHook) => b.createdAtMs - a.createdAtMs || a.id.localeCompare(b.id)

/** The production store, over the Admin SDK's Firestore. */
export function createFirestoreZapierHookStore(
  firestore: () => FirebaseFirestore.Firestore,
): ZapierHookStore {
  const hooks = () => firestore().collection(ZAPIER_HOOKS_COLLECTION)
  const deliveries = () => firestore().collection(ZAPIER_DELIVERIES_COLLECTION)
  const toHook = (doc: FirebaseFirestore.DocumentSnapshot): ZapierHook => ({
    ...(doc.data() as ZapierHookRecord),
    id: doc.id,
  })
  return {
    async listHooks(hostId, event) {
      let query: FirebaseFirestore.Query = hooks().where('hostId', '==', hostId)
      if (event) query = query.where('events', 'array-contains', event)
      const snapshot = await query.orderBy('createdAtMs', 'desc').limit(200).get()
      return snapshot.docs.map(toHook).sort(newestFirst)
    },
    async hasHook(hostId, event) {
      const snapshot = await hooks()
        .where('hostId', '==', hostId)
        .where('events', 'array-contains', event)
        .limit(1)
        .get()
      return !snapshot.empty
    },
    async getHook(id) {
      const snapshot = await hooks().doc(id).get()
      return snapshot.exists ? toHook(snapshot) : null
    },
    async upsertHook(record, max) {
      return firestore().runTransaction(async (transaction) => {
        const existing = await transaction.get(
          hooks().where('hostId', '==', record.hostId).orderBy('createdAtMs', 'desc').limit(max + 1),
        )
        const same = existing.docs.find((doc) => doc.get('targetUrl') === record.targetUrl)
        if (same) {
          const patch = {
            events: record.events,
            keyId: record.keyId,
            keyName: record.keyName,
            updatedAtMs: record.updatedAtMs,
          }
          transaction.update(same.ref, patch)
          return { hook: { ...toHook(same), ...patch }, created: false }
        }
        if (existing.size >= max) return { limit: true } as const
        const ref = hooks().doc(createResourceUid())
        transaction.create(ref, record)
        return { hook: { ...record, id: ref.id }, created: true }
      })
    },
    async updateHook(id, patch) {
      await hooks().doc(id).update(patch)
    },
    async deleteHook(id) {
      await hooks().doc(id).delete()
    },
    async wasDelivered(eventId, hookId) {
      return (await deliveries().doc(zapierDeliveryId(eventId, hookId)).get()).exists
    },
    async markDelivered(input) {
      await deliveries()
        .doc(zapierDeliveryId(input.eventId, input.hookId))
        .set({
          orgId: input.orgId,
          hookId: input.hookId,
          eventId: input.eventId,
          deliveredAtMs: input.nowMs,
          expiresAt: deliveryMarkerExpiry(input.nowMs),
        })
    },
  }
}
