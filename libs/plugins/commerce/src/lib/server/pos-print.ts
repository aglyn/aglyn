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

import { firebaseAdmin, getOrgForHost, getPluginConfig } from '@aglyn/tenant-data-admin'
import type { HostOrder } from '../model/commerce-orders'
import { orderPayments } from '../model/commerce-pos'
import type { PosCashEventType } from '../model/commerce-pos-ops'
import type { PrintReport } from '../model/commerce-printers'
import { posRegisterSettings, type PosRegisterSettings } from '../plugin-config'
import { onPosSaleCompleted, type PosSaleCompletedEvent } from './pos-sale'
import { orderReceipt, queueRegisterPrint } from './printers'

/*==========================================
 * THE REGISTER'S PAPER AND DRAWER (AGL-3609), through the cloud printer
 * queue (AGL-3619) rather than a second one:
 *
 *   a completed sale    its receipt, when the site always prints or the
 *                       customer chose print, a kitchen ticket on the
 *                       printers that print them, and a drawer kick when
 *                       cash was taken
 *   a cash event        paid in, paid out, a safe drop or a cash refund
 *                       opens the drawer
 *   an X or Z report    printed on the register's receipt printer
 *
 * Every job is keyed on its cause (the order, the event, the return), so a
 * cause delivered twice prints once. Nothing here can fail the money that
 * caused it: each entry point logs and returns.
 *=========================================*/

export interface PosPrintDeps {
  firestore(): any
  queue: typeof queueRegisterPrint
  receipt: typeof orderReceipt
  /** The site's register settings (tips, receipts, display). */
  registerSettings(hostId: string): Promise<PosRegisterSettings>
  /** A member's name as the receipt prints it. */
  memberName(uid: string): Promise<string>
}

export function defaultPosPrintDeps(): PosPrintDeps {
  return {
    firestore: () => firebaseAdmin.app().firestore(),
    queue: queueRegisterPrint,
    receipt: orderReceipt,
    registerSettings: async (hostId) => {
      const owner = await getOrgForHost(hostId).catch(() => null)
      return posRegisterSettings(
        owner?.orgId ? await getPluginConfig(owner.orgId, 'commerce', { hostId }).catch(() => ({})) : {},
      )
    },
    memberName: async (uid) => {
      try {
        const user = await firebaseAdmin.app().auth().getUser(uid)
        return user.displayName || user.email || ''
      } catch {
        return ''
      }
    },
  }
}

/** The one key a sale's receipt prints under, whichever path asks first. */
const SALE_RECEIPT_REASON = 'sale'

/**
 * What a completed sale puts on paper: the receipt when the site always
 * prints or the customer asked for print, never when they chose email, a
 * text or nothing — and the drawer whenever cash changed hands.
 */
export function posSalePrintPlan(
  order: Pick<HostOrder, 'payments' | 'status' | 'channel'> & {
    receiptRequest?: { channel?: string } | null
  },
  receiptDefault: PosRegisterSettings['receiptDefault'],
): { receipt: boolean; drawer: boolean } {
  const drawer = orderPayments(order as Parameters<typeof orderPayments>[0]).some(
    (payment) => payment.status === 'succeeded' && payment.method === 'cash',
  )
  const choice = order.receiptRequest?.channel
  const receipt = choice ? choice === 'print' : receiptDefault === 'print'
  return { receipt, drawer }
}

/**
 * True when the customer chose a printed receipt: it then prints on the
 * register's first printer even when none is set to print every sale.
 */
function customerAskedForPrint(order: { receiptRequest?: { channel?: string } | null }): boolean {
  return order.receiptRequest?.channel === 'print'
}

async function readOrder(deps: PosPrintDeps, hostId: string, orderId: string) {
  const snapshot = await deps
    .firestore()
    .collection('hosts')
    .doc(hostId)
    .collection('orders')
    .doc(orderId)
    .get()
  return snapshot.exists ? (snapshot.data() as HostOrder & Record<string, any>) : null
}

async function saleReceipt(
  deps: PosPrintDeps,
  hostId: string,
  orderId: string,
  order: HostOrder & Record<string, any>,
) {
  const [receipt, cashierName] = await Promise.all([
    deps.receipt(hostId, orderId, order, { firestore: deps.firestore() }),
    order.cashierId ? deps.memberName(order.cashierId) : Promise.resolve(''),
  ])
  return cashierName ? { ...receipt, cashierName } : receipt
}

/** A completed register sale's receipt and drawer, by {@link posSalePrintPlan}. */
export async function printPosSale(
  event: Pick<PosSaleCompletedEvent, 'hostId' | 'orderId'>,
  deps: PosPrintDeps = defaultPosPrintDeps(),
): Promise<{ jobIds: string[] }> {
  try {
    const order = await readOrder(deps, event.hostId, event.orderId)
    if (!order || order.channel !== 'pos' || !order.registerId) return { jobIds: [] }
    const settings = await deps.registerSettings(event.hostId)
    const plan = posSalePrintPlan(order, settings.receiptDefault)
    // The kitchen ticket prints whatever the customer chose for their own
    // receipt (AGL-3619): it is an order to make, not paper for the customer,
    // and only printers set to print kitchen tickets receive it.
    const receipt = await saleReceipt(deps, event.hostId, event.orderId, order)
    return await deps.queue({
      hostId: event.hostId,
      registerId: order.registerId,
      ...(plan.receipt ? { receipt } : {}),
      ...(customerAskedForPrint(order) ? { receiptChoice: 'print' as const } : {}),
      kitchenTicket: receipt,
      openDrawer: plan.drawer,
      orderId: event.orderId,
      reason: SALE_RECEIPT_REASON,
      idempotencyKey: event.orderId,
      firestore: deps.firestore(),
    })
  } catch (error) {
    console.error('[pos-print] sale print failed', event.orderId, error)
    return { jobIds: [] }
  }
}

/**
 * The receipt a customer asked for on the display AFTER the sale completed.
 * Under the sale's own key, so a receipt the completion already printed is
 * not printed twice.
 */
export async function printPosSaleReceipt(
  hostId: string,
  orderId: string,
  deps: PosPrintDeps = defaultPosPrintDeps(),
): Promise<{ jobIds: string[] }> {
  try {
    const order = await readOrder(deps, hostId, orderId)
    if (!order || order.channel !== 'pos' || !order.registerId) return { jobIds: [] }
    return await deps.queue({
      hostId,
      registerId: order.registerId,
      receipt: await saleReceipt(deps, hostId, orderId, order),
      // Asked for by name, so it prints even when no printer auto-prints.
      receiptChoice: 'print',
      orderId,
      reason: SALE_RECEIPT_REASON,
      idempotencyKey: orderId,
      firestore: deps.firestore(),
    })
  } catch (error) {
    console.error('[pos-print] receipt print failed', orderId, error)
    return { jobIds: [] }
  }
}

/** Opens the drawer for cash that moved without a sale. */
export async function kickPosDrawer(
  input: {
    hostId: string
    registerId: string
    reason: PosCashEventType | 'cash_refund'
    /** The event or return id: a retried tap kicks once. */
    causeId: string
    createdBy?: string
  },
  deps: PosPrintDeps = defaultPosPrintDeps(),
): Promise<{ jobIds: string[] }> {
  try {
    return await deps.queue({
      hostId: input.hostId,
      registerId: input.registerId,
      openDrawer: true,
      reason: input.reason,
      idempotencyKey: input.causeId,
      ...(input.createdBy ? { createdBy: input.createdBy } : {}),
      firestore: deps.firestore(),
    })
  } catch (error) {
    console.error('[pos-print] drawer kick failed', input.causeId, error)
    return { jobIds: [] }
  }
}

/** Queues a shift report on the register's receipt printer; no printer, no jobs. */
export async function printPosShiftReport(
  input: {
    hostId: string
    registerId: string
    shiftId: string
    report: PrintReport
    createdBy?: string
    /** Distinguishes a second deliberate print of the same report. */
    attemptKey: string
  },
  deps: PosPrintDeps = defaultPosPrintDeps(),
): Promise<{ jobIds: string[] }> {
  try {
    return await deps.queue({
      hostId: input.hostId,
      registerId: input.registerId,
      report: input.report,
      reason: input.report.title === 'Z REPORT' ? 'z_report' : 'x_report',
      idempotencyKey: `${input.shiftId}-${input.attemptKey}`,
      ...(input.createdBy ? { createdBy: input.createdBy } : {}),
      firestore: deps.firestore(),
    })
  } catch (error) {
    console.error('[pos-print] report print failed', input.shiftId, error)
    return { jobIds: [] }
  }
}

let subscribed = false

/** Prints every completed register sale; safe to call more than once. */
export function registerPosSalePrinting(): void {
  if (subscribed) return
  subscribed = true
  onPosSaleCompleted((event) => printPosSale(event).then(() => undefined))
}
