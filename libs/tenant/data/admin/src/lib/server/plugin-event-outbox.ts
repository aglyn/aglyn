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
  deliverPluginDomainEvent,
  type PluginDomainEvent,
} from '@aglyn/aglyn/plugin-manager/plugin-domain-events'
import { createHash } from 'crypto'

/**
 * The outbox behind plugin events (AGL-3611): raising an event is a write
 * here, and a scheduled drain delivers it. See `plugin-domain-events.ts` in
 * core for the contract a raiser and a subscriber see.
 *
 * WHY AN OUTBOX. A fact a plugin reports — an order paid, a return refunded —
 * must reach accounting, shipping and the merchant's webhooks even when one of
 * them is down, and even when the process that made the write dies a moment
 * later. Calling the subscribers in the request loses the event on either.
 * Writing it here, in the raiser's own transaction where it has one, makes
 * the event exist exactly when the fact does.
 *
 * AT LEAST ONCE, PER SUBSCRIBER. The document records which subscribers
 * took the event (`delivered`), and a retry calls only the rest. A
 * subscriber can still see an event twice — its handler succeeded and the
 * write recording that did not — so the envelope's `id` is the key it
 * dedupes on.
 *
 * ONE DRAIN AT A TIME PER EVENT. A pass leases the document for a minute in
 * a transaction before it delivers, so two overlapping beats do not both
 * deliver it. A pass that dies holding the lease is retried once the lease
 * lapses.
 *
 * A delivered event is deleted: the collection holds what is still owed, so
 * the drain's query reads nothing on an idle platform. One that runs out of
 * attempts stays, `failed`, with each subscriber's last error.
 */

export const PLUGIN_EVENT_OUTBOX_COLLECTION = 'pluginEventOutbox'

/** Attempts per event before it is left as a dead letter. */
export const PLUGIN_EVENT_MAX_ATTEMPTS = 8

/** Wait before attempt n+1, by attempts made; the last step repeats. */
export const PLUGIN_EVENT_BACKOFF_MS: readonly number[] = [
  30_000,
  120_000,
  600_000,
  1_800_000,
  3_600_000,
  21_600_000,
  43_200_000,
]

/** How long a drain pass holds an event while it delivers. */
export const PLUGIN_EVENT_LEASE_MS = 60_000

/** Events one pass reads. */
export const PLUGIN_EVENT_SCAN_LIMIT = 100

export type PluginEventOutboxStatus = 'pending' | 'failed'

/** `pluginEventOutbox/{id}`. Written and read only by the Admin SDK. */
export interface PluginEventOutboxRecord {
  status: PluginEventOutboxStatus
  event: string
  /** The plugin that raised it. */
  pluginId: string
  hostId: string
  orgId: string | null
  occurredAtMs: number
  payload: Record<string, unknown>
  attempts: number
  nextAttemptAtMs: number
  createdAtMs: number
  /** Subscribers that took it, by plugin id, when. */
  delivered?: Record<string, number>
  /** Attempts per subscriber, for the envelope's `attempt`. */
  subscriberAttempts?: Record<string, number>
  /** Each failing subscriber's last error. */
  lastErrors?: Record<string, string>
  leaseUntilMs?: number
  failedAtMs?: number
}

export function pluginEventBackoffMs(attempts: number): number {
  const last = PLUGIN_EVENT_BACKOFF_MS.length - 1
  return PLUGIN_EVENT_BACKOFF_MS[Math.max(0, Math.min(attempts - 1, last))]
}

/**
 * The event's document id: the same raise twice is the same document. `key`
 * names the occurrence (a fulfillment id, a refund id); without one every
 * raise is new.
 */
export function pluginEventId(hostId: string, event: string, key: string): string {
  return createHash('sha256').update(`${hostId}\u0000${event}\u0000${key}`).digest('hex').slice(0, 40)
}

/** A transaction or a batch: anything that can `set` a document. */
export interface PluginEventWriter {
  set(ref: FirebaseFirestore.DocumentReference, data: FirebaseFirestore.DocumentData): unknown
}

export interface RaisePluginEventRequest<Payload> {
  event: PluginDomainEvent<Payload> | string
  /** The raising plugin's id. */
  pluginId: string
  hostId: string
  orgId?: string | null
  payload: Payload
  /** The occurrence: the same key raises the same event once. */
  key: string
  occurredAtMs?: number
}

/** Firestore refuses `undefined`; the payload is data, so it is plain JSON. */
function plainPayload(payload: unknown): Record<string, unknown> {
  const plain = JSON.parse(JSON.stringify(payload ?? {}))
  return plain && typeof plain === 'object' && !Array.isArray(plain) ? plain : { value: plain }
}

function recordFor<Payload>(request: RaisePluginEventRequest<Payload>, now: number): PluginEventOutboxRecord {
  return {
    status: 'pending',
    event: typeof request.event === 'string' ? request.event : request.event.id,
    pluginId: request.pluginId,
    hostId: request.hostId,
    orgId: request.orgId ?? null,
    occurredAtMs: request.occurredAtMs ?? now,
    payload: plainPayload(request.payload),
    attempts: 0,
    nextAttemptAtMs: now,
    createdAtMs: now,
  }
}

/**
 * Raises an event INSIDE the caller's transaction or batch, so it is written
 * exactly when the fact is. The write is a `set` (a transaction cannot read
 * after it writes), so the caller's own "already done" guard is what keeps a
 * retry from raising it twice — and the id is keyed, so if it does, the
 * event is the same document. Returns the id.
 */
export function stagePluginEvent<Payload>(
  writer: PluginEventWriter,
  firestore: FirebaseFirestore.Firestore,
  request: RaisePluginEventRequest<Payload>,
  now = Date.now(),
): string {
  const record = recordFor(request, now)
  const id = pluginEventId(request.hostId, record.event, request.key)
  writer.set(
    firestore.collection(PLUGIN_EVENT_OUTBOX_COLLECTION).doc(id),
    record as unknown as FirebaseFirestore.DocumentData,
  )
  return id
}

const GRPC_ALREADY_EXISTS = 6

/**
 * Raises an event after the fact is already written, for a raiser with no
 * transaction to ride. `create`, so the same key raised twice — a webhook
 * redelivered — is one event: the second answers `exists`.
 */
export async function raisePluginEvent<Payload>(
  firestore: FirebaseFirestore.Firestore,
  request: RaisePluginEventRequest<Payload>,
  now = Date.now(),
): Promise<{ id: string; outcome: 'queued' | 'exists' | 'failed' }> {
  const record = recordFor(request, now)
  const id = pluginEventId(request.hostId, record.event, request.key)
  try {
    await firestore
      .collection(PLUGIN_EVENT_OUTBOX_COLLECTION)
      .doc(id)
      .create(record as unknown as FirebaseFirestore.DocumentData)
    return { id, outcome: 'queued' }
  } catch (error) {
    if ((error as { code?: number })?.code === GRPC_ALREADY_EXISTS) return { id, outcome: 'exists' }
    console.error('[plugin-events] not queued', record.event, request.hostId, error)
    return { id, outcome: 'failed' }
  }
}

export interface PluginEventDrainResult {
  scanned: number
  delivered: number
  retried: number
  deadLettered: number
  skippedLocked: number
  skippedLeased: number
}

type AttemptOutcome = 'delivered' | 'retried' | 'dead-lettered' | 'leased'

/**
 * Delivers one event: lease, hand it to the subscribers still owed it, and
 * record what happened. Exported for a raiser that wants an event out now
 * rather than on the next beat; the drain is the backstop either way.
 */
export async function attemptPluginEvent(
  firestore: FirebaseFirestore.Firestore,
  id: string,
  now = Date.now(),
): Promise<AttemptOutcome> {
  const ref = firestore.collection(PLUGIN_EVENT_OUTBOX_COLLECTION).doc(id)
  const leased = await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    if (!snapshot.exists) return null
    const data = snapshot.data() as PluginEventOutboxRecord
    if (data.status !== 'pending') return null
    if (Number(data.leaseUntilMs ?? 0) > now) return null
    if (Number(data.nextAttemptAtMs ?? 0) > now) return null
    transaction.update(ref, { leaseUntilMs: now + PLUGIN_EVENT_LEASE_MS })
    return data
  })
  if (!leased) return 'leased'

  const delivered = { ...(leased.delivered ?? {}) }
  const subscriberAttempts = { ...(leased.subscriberAttempts ?? {}) }
  const result = await deliverPluginDomainEvent(
    {
      id,
      event: leased.event,
      hostId: leased.hostId,
      orgId: leased.orgId ?? null,
      occurredAtMs: leased.occurredAtMs,
      payload: leased.payload,
    },
    { skip: new Set(Object.keys(delivered)), attempts: subscriberAttempts },
  )
  for (const pluginId of result.delivered) {
    delivered[pluginId] = now
    subscriberAttempts[pluginId] = (subscriberAttempts[pluginId] ?? 0) + 1
  }
  for (const { pluginId } of result.failed) {
    subscriberAttempts[pluginId] = (subscriberAttempts[pluginId] ?? 0) + 1
  }

  if (result.failed.length === 0) {
    await ref.delete()
    return 'delivered'
  }
  const attempts = Number(leased.attempts ?? 0) + 1
  const exhausted = attempts >= PLUGIN_EVENT_MAX_ATTEMPTS
  const lastErrors = { ...(leased.lastErrors ?? {}) }
  for (const { pluginId, error } of result.failed) lastErrors[pluginId] = error
  await ref.update({
    status: exhausted ? 'failed' : 'pending',
    attempts,
    delivered,
    subscriberAttempts,
    lastErrors,
    leaseUntilMs: 0,
    ...(exhausted ? { failedAtMs: now } : { nextAttemptAtMs: now + pluginEventBackoffMs(attempts) }),
  })
  if (exhausted) {
    console.error(
      `[plugin-events] ${leased.event} ${id} on ${leased.hostId} gave up after ${attempts} attempts:`,
      lastErrors,
    )
    return 'dead-lettered'
  }
  return 'retried'
}

/**
 * One beat of the drain: the events owed now, oldest first. A locked site's
 * events wait, untouched, for the lock to lift.
 */
export async function drainPluginEvents(
  gate: { isLocked(hostId: string): Promise<boolean> },
  firestore: FirebaseFirestore.Firestore,
  now = Date.now(),
): Promise<PluginEventDrainResult> {
  const due = await firestore
    .collection(PLUGIN_EVENT_OUTBOX_COLLECTION)
    .where('status', '==', 'pending')
    .where('nextAttemptAtMs', '<=', now)
    .orderBy('nextAttemptAtMs')
    .limit(PLUGIN_EVENT_SCAN_LIMIT)
    .get()
  const result: PluginEventDrainResult = {
    scanned: due.size,
    delivered: 0,
    retried: 0,
    deadLettered: 0,
    skippedLocked: 0,
    skippedLeased: 0,
  }
  for (const snapshot of due.docs) {
    const hostId = String(snapshot.get('hostId') ?? '')
    if (await gate.isLocked(hostId)) {
      result.skippedLocked += 1
      continue
    }
    const outcome = await attemptPluginEvent(firestore, snapshot.id, now).catch((error) => {
      console.error('[plugin-events] attempt failed', snapshot.id, error)
      return null
    })
    if (outcome === 'delivered') result.delivered += 1
    else if (outcome === 'retried') result.retried += 1
    else if (outcome === 'dead-lettered') result.deadLettered += 1
    else if (outcome === 'leased') result.skippedLeased += 1
  }
  return result
}
