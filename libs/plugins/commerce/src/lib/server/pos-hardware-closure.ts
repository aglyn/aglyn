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

import type {
  PluginOrgEraser,
  PluginOrgErasureReport,
} from '@aglyn/aglyn/plugin-manager/plugin-org-erasure'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { addAdminAudit } from '@aglyn/tenant-data-admin/server/admin-audit-write'
import {
  POS_HARDWARE_ORDERS_COLLECTION,
  type PosHardwareCancelReason,
  type PosHardwareOrder,
} from '../model/pos-hardware'
import { cancelAndRefundPosHardwareOrder } from './pos-hardware-cancel'
import {
  raisePosHardwareCanceledAfterOrderingAlert,
  raisePosHardwareRefundFailedAlert,
  sendPosHardwareEmail,
} from './pos-hardware-notify'

/*==========================================
 * A CLOSURE CANCELS EVERY UNSHIPPED HARDWARE ORDER (AGL-4038).
 *
 * When the workspace that bought hardware is deleted, or the account that
 * placed an order is closed, every order of theirs that has not shipped —
 * `paid` or `ordered` — is canceled and refunded in full on the platform's
 * Stripe account, through the staff page's own path and its idempotency
 * (`pos-hardware-cancel.ts`). Then:
 *
 *   - the buyer gets the "canceled and refunded" email;
 *   - staff get an alert when the order was already placed with Stripe
 *     (`ordered`), because Stripe will still ship it unless someone cancels
 *     it there, and another when Stripe refuses the refund;
 *   - an `adminAudit` row records the cancel, with the closure as its actor.
 *
 * THE CLOSURE NEVER WAITS ON THIS. A refusal, or a throw, is counted and
 * alerted and the next order is tried; nothing here fails the erasure, so
 * the workspace or the account closes right away whatever Stripe says.
 * Shipped, delivered and registered orders are untouched, and the retained
 * sale record (`posHardwareSales`) records the refund and outlives both.
 *
 * Idempotent: a canceled order is no longer `paid` or `ordered`, so a second
 * closure run finds nothing to refund, sends no second email, raises no
 * second alert and makes no second Stripe call. A run that died after Stripe
 * refunded and before the order said so reads that refund back instead of
 * making another (`pos-hardware-cancel.ts`).
 *=========================================*/

type Firestore = FirebaseFirestore.Firestore

export type PosHardwareClosureOutcome = 'canceled' | 'already' | 'skipped' | 'failed'

/** The unshipped statuses a closure cancels. */
const UNSHIPPED = ['paid', 'ordered'] as const

/** The audit row's actor: the closure, never a person. */
const CLOSURE_ACTOR: Record<Exclude<PosHardwareCancelReason, 'staff'>, string> = {
  'workspace-closed': 'system:workspace-closed',
  'account-closed': 'system:account-closed',
}

/**
 * Cancels and refunds one unshipped order because of a closure, and tells
 * the buyer and staff. Never throws. `known` is the order as the closure read
 * it, for the alert should the cancel itself throw.
 */
export async function closeUnshippedPosHardwareOrder(
  orgId: string,
  orderId: string,
  reason: Exclude<PosHardwareCancelReason, 'staff'>,
  known?: PosHardwareOrder,
): Promise<PosHardwareClosureOutcome> {
  try {
    const result = await cancelAndRefundPosHardwareOrder({ orgId, orderId, finalStatus: 'canceled', reason })
    switch (result.outcome) {
      case 'missing':
      case 'not-refundable':
        return 'skipped'
      case 'already':
        // Canceled between the closure's read and the lock: whoever canceled
        // it told the buyer and staff.
        return 'already'
      case 'no-payment':
        await raisePosHardwareRefundFailedAlert(orderId, result.order, reason, 'the order has no payment to refund')
        return 'failed'
      case 'refused':
        await raisePosHardwareRefundFailedAlert(orderId, result.order, reason, result.message)
        return 'failed'
    }
    const firestore = firebaseAdmin.app().firestore()
    await addAdminAudit(firestore, {
      action: 'pos-hardware-order-cancel',
      actorUid: CLOSURE_ACTOR[reason],
      actorEmail: null,
      scope: 'posHardwareOrder',
      target: `orgs/${orgId}/${POS_HARDWARE_ORDERS_COLLECTION}/${orderId}`,
      orgId,
      before: { status: result.before.status },
      after: {
        status: result.order.status,
        refundId: result.order.refundId ?? null,
        refundedCents: result.order.refundedCents ?? null,
        reason,
      },
      at: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
    }).catch((error: unknown) => console.error('[pos-hardware] closure audit failed', orderId, error))
    await sendPosHardwareEmail('canceled', orderId, result.order)
    if (result.before.status === 'ordered') {
      await raisePosHardwareCanceledAfterOrderingAlert(orderId, result.order, reason)
    }
    return 'canceled'
  } catch (error) {
    console.error('[pos-hardware] closure cancel failed', orderId, error)
    await raisePosHardwareRefundFailedAlert(
      orderId,
      known ?? ({ orgId, hostId: '', status: 'paid', totalCents: 0, stripePaymentIntentId: null } as unknown as PosHardwareOrder),
      reason,
      error instanceof Error ? error.message : String(error),
    )
    return 'failed'
  }
}

/** What a closure did to one buyer's or workspace's hardware orders. */
export interface PosHardwareClosureCounts {
  hardwareOrdersCanceled: number
  /** Of those, the ones staff had already placed with Stripe. */
  hardwareOrdersPlacedWithStripe: number
  /** Unshipped orders whose refund Stripe refused; staff were alerted. */
  hardwareRefundsFailed: number
}

/**
 * Cancels every order given that is still unshipped. `orders` is read before
 * the call; each order is re-read under the lock by the cancel itself, so one
 * that shipped in between is left alone.
 */
export async function closeUnshippedPosHardwareOrders(
  orders: ReadonlyArray<{ orderId: string; order: PosHardwareOrder }>,
  reason: Exclude<PosHardwareCancelReason, 'staff'>,
): Promise<PosHardwareClosureCounts> {
  const counts: PosHardwareClosureCounts = {
    hardwareOrdersCanceled: 0,
    hardwareOrdersPlacedWithStripe: 0,
    hardwareRefundsFailed: 0,
  }
  for (const { orderId, order } of orders) {
    if (!(UNSHIPPED as readonly string[]).includes(order?.status)) continue
    const outcome = await closeUnshippedPosHardwareOrder(order.orgId, orderId, reason, order)
    if (outcome === 'canceled') {
      counts.hardwareOrdersCanceled += 1
      if (order.status === 'ordered') counts.hardwareOrdersPlacedWithStripe += 1
    }
    if (outcome === 'failed') counts.hardwareRefundsFailed += 1
  }
  return counts
}

export interface PosHardwareOrgEraserDeps {
  firestore(): Firestore
}

/**
 * COMMERCE'S SHARE OF A WORKSPACE ERASURE: the workspace's unshipped hardware
 * orders, canceled and refunded before the erasure deletes them with the
 * workspace. It runs first among the erasure's steps (plugin erasers run
 * while the workspace still stands), so the buyer's email can still name the
 * site and the workspace.
 *
 * A plan (`dryRun`) counts what it would cancel and touches neither Stripe
 * nor Firestore.
 */
export function createPosHardwareOrgEraser(deps: PosHardwareOrgEraserDeps): PluginOrgEraser {
  return async ({ orgId, dryRun }): Promise<PluginOrgErasureReport> => {
    const orders = deps.firestore().collection('orgs').doc(orgId).collection(POS_HARDWARE_ORDERS_COLLECTION)
    // One equality query per status, each served by the automatic
    // single-field index: a workspace's hardware orders are few.
    const found = await Promise.all(UNSHIPPED.map((status) => orders.where('status', '==', status).get()))
    const unshipped = found.flatMap((snapshot) =>
      snapshot.docs.map((doc) => ({
        orderId: doc.id,
        // The path names the workspace; the field is what the order says.
        order: { ...(doc.data() as PosHardwareOrder), orgId },
      })),
    )
    if (dryRun) {
      return {
        hardwareOrdersCanceled: unshipped.length,
        hardwareOrdersPlacedWithStripe: unshipped.filter(({ order }) => order.status === 'ordered').length,
        hardwareRefundsFailed: 0,
      }
    }
    return { ...(await closeUnshippedPosHardwareOrders(unshipped, 'workspace-closed')) }
  }
}

/** The eraser over the platform's own Firestore, as the declarations register it. */
export const posHardwareOrgEraser: PluginOrgEraser = (request) =>
  createPosHardwareOrgEraser({ firestore: () => firebaseAdmin.app().firestore() })(request)
