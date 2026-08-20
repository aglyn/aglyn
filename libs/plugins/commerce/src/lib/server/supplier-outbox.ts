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
  firebaseAdmin,
  notifyHostManagers,
} from '@aglyn/tenant-data-admin'
import { isDocumentId } from '@aglyn/tenant-data-admin/server/document-id'
import { createHmac } from 'crypto'

/**
 * The durable outbox for the dropship supplier notification (AGL-2473).
 *
 * ## What was wrong
 *
 * `billing-webhook.ts` routed a paid dropship order inside
 * `void (async () => { … })()`, and the last thing that block did was
 * `await fetch(supplier.webhookUrl, …)` — an endpoint the MERCHANT typed into
 * a console field, on a host Aglyn neither runs nor monitors. Vercel freezes
 * the container the instant the response is written, so a supplier that is
 * slow, rate-limiting, or simply down is a supplier that is never told. The
 * order is paid, the buyer is thanked, the merchant sees "Sent to supplier X"
 * on the timeline, and NOTHING ANYWHERE records that the POST is still owed —
 * so no later pass can find it and no report can list it. It surfaces when the
 * customer asks where their parcel is.
 *
 * ## Why not just `await` it
 *
 * AGL-2161 fixed the other four fire-and-forget sites in that file and
 * deliberately left this one, because awaiting it is worse rather than better:
 * a supplier taking 30s pushes the handler past Stripe's delivery window,
 * Stripe redelivers, and the redelivery re-enters a fan-out whose only
 * idempotency is one `created` flag upstream. A silently dropped notification
 * would have been traded for a DUPLICATED order. `refund.ts` awaits its own
 * sibling and says so in a comment — correctly, because that sibling only
 * touches our own Firestore.
 *
 * So the line this module draws is not "fast vs slow" but **ours vs theirs**.
 * Everything the routing block does to Aglyn's own storage — the callback
 * token, the timeline entry, the supplier email through our own provider — is
 * now AWAITED on the response path, exactly like `refund.ts`. The one call to a
 * stranger's server becomes a row here, and the response no longer waits on it.
 *
 * ## The mechanism
 *
 * A Firestore-backed outbox drained by the plugin-job beat that already runs
 * the two commerce recovery passes (`server.ts`). No new infrastructure: the
 * beat is a Cloud Scheduler function POSTing the tenant runner route, and it
 * has carried bounded scans since AGL-2227.
 *
 *  * **Idempotent enqueue.** The id is `{hostId}__{orderId}__{supplierId}` and
 *    the write is `create()`, which REFUSES an existing document, so a
 *    redelivery cannot reset a retry part-way through its backoff. The AGL-498
 *    existence guard upstream already returns before this fan-out, but
 *    `reconcile-stock.ts` documents at length why one flag over a dozen effects
 *    is not something to lean on.
 *  * **Backoff.** 1m, 5m, 15m, 1h, 6h — about seven and a half hours of cover,
 *    which is a supplier's overnight deploy but not their week off.
 *  * **Dead letter.** After {@link SUPPLIER_DELIVERY_MAX_ATTEMPTS} the row is
 *    left as `failed`, the ORDER's own timeline is stamped, and host managers
 *    get a notification. The merchant reading the order they were paid for can
 *    see that it never reached the supplier — the thing the old code could not
 *    tell anyone, because it wrote nothing down.
 *
 * ## Two placement decisions, both deliberate
 *
 * **TOP-LEVEL, not `hosts/{hostId}/supplierDeliveries`.** The host catch-all in
 * the rules file is PERMISSIVE by default — a subcollection nobody names in its
 * three exclusion lists is one every site editor can write from the browser —
 * and the row carries the exact JSON body we sign and POST, so an editor-
 * writable row is an editor-chosen payload delivered under the supplier's own
 * shared secret. A top-level collection matches no rule in
 * `cloud/firebase-firestore.rules` at all and is therefore denied to every
 * client by default, the same footing as `platform/pluginJobs`. It also keeps
 * the drain on an ordinary collection query: a collection-GROUP `where` would
 * need a `COLLECTION_GROUP_ASC` fieldOverride, and AGL-1793 is the record of
 * both commerce crons being silently dead in production for want of exactly
 * that. Neither a rules deploy nor an index deploy is owed for this change.
 *
 * **A delivered row is DELETED, not stamped `delivered`.** The body holds the
 * buyer's email and name, and a top-level document is outside the
 * `hosts/{hostId}` recursive delete an erasure request runs. Retaining the
 * happy path would accumulate third-party PII in a place erasure does not
 * reach, to record something the order's own `routed` timeline entry already
 * says. Dead-lettered rows survive, because those are the ones a human has to
 * act on and the merchant has been told about them.
 */

/** Top-level collection. Matches no rule, so no client may read or write it. */
export const SUPPLIER_DELIVERY_COLLECTION = 'supplierDeliveries'

/** Attempts before a delivery is dead-lettered. */
export const SUPPLIER_DELIVERY_MAX_ATTEMPTS = 6

/**
 * Delay before the next retry, indexed by attempts ALREADY made.
 *
 * The first entry is 60s and the job beat is also 60s, so a supplier that
 * blipped is retried on the next tick rather than a quarter of an hour later —
 * the difference between a parcel that ships today and one that does not.
 */
export const SUPPLIER_DELIVERY_BACKOFF_MS: readonly number[] = [
  60_000,
  300_000,
  900_000,
  3_600_000,
  21_600_000,
]

/**
 * Per-attempt timeout. Nothing user-facing waits on this — it exists so one
 * hung supplier cannot hold the shared job beat open for the whole scan.
 */
export const SUPPLIER_DELIVERY_TIMEOUT_MS = 10_000

/** Rows examined per drain. Bounded like every other scan on the beat. */
export const SUPPLIER_DELIVERY_SCAN_LIMIT = 100

export type SupplierDeliveryStatus = 'pending' | 'failed'

export interface SupplierDeliveryRecord {
  status: SupplierDeliveryStatus
  hostId: string
  orderId: string
  supplierId: string
  supplierName: string
  /** The endpoint as configured when the order was routed, for the record. */
  url: string
  /** The exact JSON the supplier is sent; signed at delivery time. */
  body: string
  attempts: number
  nextAttemptAtMs: number
  createdAtMs: number
  lastError?: string
  lastStatus?: number
  failedAtMs?: number
}

export interface SupplierDeliveryScanResult {
  scanned: number
  delivered: number
  retried: number
  deadLettered: number
  /** Retired without delivery because the merchant removed the endpoint. */
  cancelled: number
}

/** gRPC `Status.ALREADY_EXISTS` — what `create()` on a live path carries. */
const GRPC_ALREADY_EXISTS = 6

/**
 * The delay owed after `attempts` failures, clamped to the last step.
 *
 * Clamped rather than extrapolated: the tail entry is already six hours, and a
 * dead letter is what comes after it, not a longer and longer silence.
 */
export function supplierDeliveryBackoffMs(attempts: number): number {
  const last = SUPPLIER_DELIVERY_BACKOFF_MS.length - 1
  return SUPPLIER_DELIVERY_BACKOFF_MS[
    Math.max(0, Math.min(attempts - 1, last))
  ]
}

/**
 * The outbox document id for one host/order/supplier triple.
 *
 * Deterministic, so `create()` is the idempotency. `__` rather than `:` or `/`:
 * a slash would make `.doc()` build a PATH instead of an id (AGL-1771), and the
 * separator has to survive a Stripe session id, which already contains `_`.
 * Firestore reserves ids fully matching `__.*__`; this never is, because all
 * three parts are non-empty and the id neither starts nor ends with `__`.
 */
export function supplierDeliveryId(
  hostId: string,
  orderId: string,
  supplierId: string,
): string {
  return `${hostId}__${orderId}__${supplierId}`
}

/**
 * Records that a supplier POST is owed. One Firestore write, awaited.
 *
 * Returns `'queued'`, `'exists'` when a row for this triple is already in
 * flight, or `'skipped'`. NEVER THROWS: the caller is a paid order's fulfilment
 * path, and a queue that cannot be written must not take the receipt down with
 * it. The refusal is logged, which is strictly more than the old code managed
 * on the same failure.
 */
export async function enqueueSupplierDelivery(options: {
  firestore: FirebaseFirestore.Firestore
  hostId: string
  orderId: string
  supplierId: string
  supplierName: string
  url: string
  body: string
  now?: number
}): Promise<'queued' | 'exists' | 'skipped'> {
  const { firestore, hostId, orderId, supplierId, supplierName, url, body } =
    options
  const now = options.now ?? Date.now()
  const id = supplierDeliveryId(hostId, orderId, supplierId)
  if (!isDocumentId(id)) {
    console.error('Supplier delivery not queued: unusable id', id)
    return 'skipped'
  }
  const record: SupplierDeliveryRecord = {
    status: 'pending',
    hostId,
    orderId,
    supplierId,
    supplierName,
    url,
    body,
    attempts: 0,
    // Due immediately: the next beat picks it up, at most a minute out.
    nextAttemptAtMs: now,
    createdAtMs: now,
  }
  try {
    await firestore
      .collection(SUPPLIER_DELIVERY_COLLECTION)
      .doc(id)
      .create(record as unknown as FirebaseFirestore.DocumentData)
    return 'queued'
  } catch (error) {
    if ((error as { code?: number })?.code === GRPC_ALREADY_EXISTS) {
      return 'exists'
    }
    console.error('Supplier delivery not queued', hostId, orderId, error)
    return 'skipped'
  }
}

/**
 * Stamps a routing failure on the order the merchant actually reads.
 *
 * `update()`, not a merge-set, for `recordRedemptionOrphan`'s reason: the order
 * exists — the delivery was queued from its own fulfilment — and a merge would
 * mint an order stub on the one path where it does not.
 */
async function stampOrderRoutingFailure(
  firestore: FirebaseFirestore.Firestore,
  hostId: string,
  orderId: string,
  detail: string,
): Promise<void> {
  if (!isDocumentId(hostId) || !isDocumentId(orderId)) return
  await firestore
    .collection('hosts')
    .doc(hostId)
    .collection('orders')
    .doc(orderId)
    .update({
      timeline: firebaseAdmin.firestore.FieldValue.arrayUnion({
        atMs: Date.now(),
        event: 'routing-failed',
        detail,
      }),
    })
    .catch(() => undefined)
}

type DeliveryOutcome = 'delivered' | 'retried' | 'dead-lettered' | 'cancelled'

/**
 * One delivery attempt.
 *
 * Never throws: the drain is a shared beat, and one merchant's supplier must
 * not abort every other merchant's queue — the `process-restock.ts` lesson,
 * where a single poisoned row killed back-in-stock email platform-wide.
 */
async function attemptSupplierDelivery(
  firestore: FirebaseFirestore.Firestore,
  snapshot: FirebaseFirestore.QueryDocumentSnapshot,
  now: number,
): Promise<DeliveryOutcome> {
  const data = snapshot.data() as SupplierDeliveryRecord
  const hostId = String(data.hostId ?? '')
  const attempts = Number(data.attempts ?? 0) + 1

  const retire = async (): Promise<'cancelled'> => {
    await snapshot.ref.delete().catch(() => undefined)
    return 'cancelled'
  }
  if (!isDocumentId(hostId) || !isDocumentId(String(data.supplierId ?? ''))) {
    return retire()
  }

  // The endpoint and the secret are read FRESH rather than frozen into the row:
  // a merchant correcting a typo'd URL corrects what is already queued, and the
  // supplier's shared secret is never copied into a second document.
  const supplierSnapshot = await firestore
    .collection('hosts')
    .doc(hostId)
    .collection('suppliers')
    .doc(String(data.supplierId))
    .get()
    .catch(() => null)
  // A read that FAILED is not a supplier that is gone. Retrying beats retiring
  // a real delivery on a transient Firestore error — the `reconcile-stock.ts`
  // rule that a failed read is not an absent marker.
  if (!supplierSnapshot) {
    return recordFailure(
      firestore,
      snapshot,
      data,
      attempts,
      now,
      'could not read the supplier record',
      undefined,
    )
  }
  const url = String(supplierSnapshot.get('webhookUrl') ?? '')
  if (!url) {
    // Deliberately NOT a dead letter: the merchant removed the endpoint (or the
    // supplier), which is a decision rather than an outage. Alarming them about
    // a delivery they cancelled is how an alert stops being read.
    return retire()
  }
  const secret = String(supplierSnapshot.get('webhookSecret') ?? '')
  const body = String(data.body ?? '')

  let status = 0
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // NO EMPTY-KEY HMAC (AGL-2455). A signature computed under `''` is one
        // any party can compute, and a supplier who also left their secret
        // unset would verify it and believe the delivery was authenticated. An
        // absent header fails their check closed; a forgeable one passes it.
        ...(secret
          ? {
              'x-aglyn-signature': createHmac('sha256', secret)
                .update(body)
                .digest('hex'),
            }
          : {}),
      },
      body,
      signal: AbortSignal.timeout(SUPPLIER_DELIVERY_TIMEOUT_MS),
    })
    status = Number(response?.status ?? 0)
    if (!response?.ok) {
      return recordFailure(
        firestore,
        snapshot,
        data,
        attempts,
        now,
        `supplier answered HTTP ${status}`,
        status,
      )
    }
  } catch (error) {
    return recordFailure(
      firestore,
      snapshot,
      data,
      attempts,
      now,
      String((error as Error)?.message ?? error),
      undefined,
    )
  }

  // Delivered rows are DELETED rather than stamped — see the module note: the
  // body holds the buyer's email and name, and a top-level document is outside
  // the recursive delete an erasure request runs over `hosts/{hostId}`.
  await snapshot.ref.delete().catch(() => undefined)
  return 'delivered'
}

/** Books one failure: another retry, or the dead letter and its two alarms. */
async function recordFailure(
  firestore: FirebaseFirestore.Firestore,
  snapshot: FirebaseFirestore.QueryDocumentSnapshot,
  data: SupplierDeliveryRecord,
  attempts: number,
  now: number,
  reason: string,
  status: number | undefined,
): Promise<'retried' | 'dead-lettered'> {
  const exhausted = attempts >= SUPPLIER_DELIVERY_MAX_ATTEMPTS
  await snapshot.ref
    .update({
      status: exhausted ? 'failed' : 'pending',
      attempts,
      lastError: reason,
      ...(status ? { lastStatus: status } : {}),
      ...(exhausted
        ? { failedAtMs: now }
        : { nextAttemptAtMs: now + supplierDeliveryBackoffMs(attempts) }),
    })
    .catch(() => undefined)
  if (!exhausted) return 'retried'

  const hostId = String(data.hostId ?? '')
  const orderId = String(data.orderId ?? '')
  const supplierName = String(data.supplierName ?? '') || 'the supplier'
  await stampOrderRoutingFailure(
    firestore,
    hostId,
    orderId,
    `Could not reach ${supplierName} after ${attempts} attempts ` +
      `(${reason}). This order was never routed.`,
  )
  // The bell as well as the timeline: nobody opens an order they have no
  // reason to suspect.
  await notifyHostManagers(hostId, {
    type: 'content.order',
    title: `Order not routed to ${supplierName}`,
    body: `Order ${orderId} could not be sent after ${attempts} attempts.`,
    link: `/${hostId}/products`,
  }).catch(() => undefined)
  return 'dead-lettered'
}

/**
 * Drains the supplier outbox. Bounded, and safe to run twice.
 *
 * `nextAttemptAtMs` is filtered IN MEMORY rather than added to the query, which
 * would need a composite index for one field's worth of selectivity. The cost
 * is that a row still inside its backoff occupies one of the
 * {@link SUPPLIER_DELIVERY_SCAN_LIMIT} slots; with at most
 * {@link SUPPLIER_DELIVERY_MAX_ATTEMPTS} attempts per row the queue always
 * drains rather than growing a permanent head.
 */
export async function scanSupplierDeliveries(
  now: number = Date.now(),
): Promise<SupplierDeliveryScanResult> {
  const firestore = firebaseAdmin.app().firestore()
  const pending = await firestore
    .collection(SUPPLIER_DELIVERY_COLLECTION)
    .where('status', '==', 'pending')
    .limit(SUPPLIER_DELIVERY_SCAN_LIMIT)
    .get()
  const result: SupplierDeliveryScanResult = {
    scanned: pending.size,
    delivered: 0,
    retried: 0,
    deadLettered: 0,
    cancelled: 0,
  }
  for (const snapshot of pending.docs) {
    const data = snapshot.data() as SupplierDeliveryRecord
    if (Number(data?.nextAttemptAtMs ?? 0) > now) continue
    const outcome = await attemptSupplierDelivery(
      firestore,
      snapshot,
      now,
    ).catch((error) => {
      console.error(
        'Supplier delivery attempt failed',
        snapshot.ref.path,
        error,
      )
      return null
    })
    if (outcome === 'delivered') result.delivered += 1
    else if (outcome === 'retried') result.retried += 1
    else if (outcome === 'dead-lettered') result.deadLettered += 1
    else if (outcome === 'cancelled') result.cancelled += 1
  }
  return result
}
