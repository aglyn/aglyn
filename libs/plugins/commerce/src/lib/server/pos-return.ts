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

import { claimAttempt, type PluginApiHandler, type PluginApiRequest } from '@aglyn/aglyn/server'
import { createResourceUid } from '@aglyn/aglyn/app-utils/create-resource-uid'
import { nameSearchKey } from '@aglyn/aglyn/app-utils/name-search'
import { recordPluginPersonRefund } from '@aglyn/aglyn/plugin-manager/plugin-person-records'
import { reverseOrderConversion } from '@aglyn/aglyn/plugin-manager/plugin-conversion-credit'
import * as CommerceModel from '../model'
import {
  planPosReturn,
  posMoney,
  posRefundableByTender,
  posReturnedQuantities,
  posReturnLineValues,
  posTenderLabel,
  POS_STRIPE_TENDERS,
  splitPosRefund,
  type PosCashEvent,
  type PosRefundAllocation,
  type PosRegisterReturn,
  type PosReturnPick,
  type PosReturnSource,
} from '../model/commerce-pos-ops'
import { ORDER_REFUNDED_EVENT, RETURN_REFUNDED_EVENT } from '../model/order-events'
import { raiseOrderEvent } from './order-events'
import { applyGiftCardRiskToOrder } from './gift-card-risk'
import { notifyOrderBuyer } from './order-notifications'
import { decidePosRefundAuthority } from './pos-refund-authority'
import {
  authorizePosOps,
  defaultPosOpsDeps,
  posOpsBody,
  posOpsCleanId,
  posOpsIdempotencyKey,
  readPosRegister,
  isPosManager,
  resolvePosCashier,
  type PosOpsDeps,
} from './pos-ops-gate'
import { createStripeRefund } from './stripe-refund'

/*==========================================
 * RETURNS AT THE REGISTER (AGL-3609): `POST /api/commerce/pos-return`.
 *
 *   find    an order by its number (typed or scanned off the receipt's
 *           barcode), its id, or the customer's email
 *   refund  picked lines and quantities back, restocked to the register's
 *           location, the money sent back to the sale's OWN payments
 *
 * Each payment gets its money back the way it came: a card through Stripe
 * (the same refund the order dialog sends), cash out of the drawer — a cash
 * event on the open shift, so the count still balances — a gift card
 * re-credited, and a room charge reversed on the stay's folio.
 *
 * THE ORDER OF WORK is what keeps a failure honest:
 *   1. every refusal that needs no money to move (role, limit, quantities,
 *      the split, the shift rule) — before anything is written;
 *   2. the attempt claim, so a retried tap replays instead of refunding twice;
 *   3. the RESERVATION on the order, in a transaction that re-reads it: the
 *      cents, the units and each payment's share are taken before any money
 *      moves, so two registers returning the same line cannot both succeed;
 *   4. the Stripe refunds first, because they are the ones that can say no —
 *      if the first one does, nothing has moved and the reservation is
 *      handed back whole;
 *   5. then the tenders that cannot fail for a reason outside this database.
 *   A card that fails after another payment already went back leaves a
 *   PARTIAL return: what moved is recorded, what did not is handed back on
 *   the order, and the cashier is told the amount still owed.
 *=========================================*/

export interface PosReturnSideEffects {
  hostId: string
  orderId: string
  /** The return's id, the same under the register and in the store's returns. */
  returnId: string
  /** The return as the store's returns list holds it, for the return event. */
  storeReturn: CommerceModel.HostReturn
  /** The Stripe refunds the return made, if any, for the refund event. */
  refundIds: string[]
  email: string | null | undefined
  refundCents: number
  closedTheOrder: boolean
  returnedProductIds: string[]
  fullyRefunded: boolean
  lineIndexes: number[]
  /** The lines this return finished taking back in full. */
  fullLineIndexes: number[]
}

export interface PosReturnDeps extends PosOpsDeps {
  /** What every refund tells the rest of the workspace, after the money moved. Never throws. */
  afterRefund(input: PosReturnSideEffects): Promise<void>
}

export function defaultPosReturnDeps(): PosReturnDeps {
  const base = defaultPosOpsDeps()
  return {
    ...base,
    afterRefund: async (input) => {
      const settle = async (label: string, work: () => Promise<unknown>) => {
        try {
          await work()
        } catch (error) {
          console.error(`[pos-return] ${label} failed`, input.orderId, error)
        }
      }
      const hostRef = base.firestore().collection('hosts').doc(input.hostId)
      if (input.returnedProductIds.length) {
        await settle('gift card void', () =>
          applyGiftCardRiskToOrder({
            firestore: base.firestore(),
            hostRef,
            orderId: input.orderId,
            action: {
              kind: 'void',
              reason: 'refund',
              ...(input.fullyRefunded ? {} : { productIds: input.returnedProductIds }),
            },
          }),
        )
      }
      await settle('person refund', () =>
        recordPluginPersonRefund({
          hostId: input.hostId,
          refId: input.orderId,
          email: input.email,
          amountCents: input.refundCents,
          closedTheSale: input.closedTheOrder,
        }),
      )
      await settle('conversion reversal', () =>
        reverseOrderConversion({
          hostId: input.hostId,
          orderId: input.orderId,
          amountCents: input.refundCents,
          closedTheOrder: input.closedTheOrder,
        }),
      )
      // The same events a refund from the order dialog and a refunded online
      // return raise, so accounting and the merchant's webhooks hear a
      // register return too (AGL-3611's events).
      await settle('refund event', () =>
        raiseOrderEvent(ORDER_REFUNDED_EVENT, {
          hostId: input.hostId,
          orderId: input.orderId,
          key: `pos-return:${input.returnId}`,
          extra: {
            refund: {
              id: input.refundIds[0] ?? null,
              amountCents: input.refundCents,
              lineItemIds: input.fullLineIndexes,
              full: input.fullyRefunded,
            },
          },
        }),
      )
      await settle('return event', () =>
        raiseOrderEvent(RETURN_REFUNDED_EVENT, {
          hostId: input.hostId,
          orderId: input.orderId,
          key: `return-refunded:${input.returnId}`,
          extra: {
            return: {
              id: input.returnId,
              status: input.storeReturn.status,
              lines: input.storeReturn.lines.map((line) => ({ ...line })),
              refundCents: input.storeReturn.refundCents ?? null,
            },
          },
        }),
      )
      await settle('buyer notice', () =>
        notifyOrderBuyer({ hostId: input.hostId, orderId: input.orderId }, 'refunded', {
          refundId: '',
          refundCents: input.refundCents,
          refundLineIndexes: input.lineIndexes,
          fullyRefunded: input.fullyRefunded,
        }),
      )
    },
  }
}

type Outcome = { status: number; body: Record<string, unknown> }

/** The statuses a return may be taken against. */
const RETURNABLE: ReadonlySet<string> = new Set([
  'paid',
  'partially_fulfilled',
  'fulfilled',
  'delivered',
])

/** One order as the return dialog lists it. */
function returnSummary(id: string, raw: Record<string, any>, held: readonly number[] = []) {
  const order = CommerceModel.liftLegacyOrder(raw as any) as unknown as PosReturnSource &
    Record<string, any>
  const values = posReturnLineValues(order)
  const returned = posReturnedQuantities(order)
  return {
    id,
    number: order['number'] ?? null,
    label: CommerceModel.formatOrderNumber(order as any, id),
    status: order['status'],
    channel: order['channel'] ?? 'online',
    createdAtMs: Number(order['createdAtMs'] ?? 0),
    customerEmail: order['customerEmail'] ?? null,
    customerName: order['customerName'] ?? null,
    totalCents: Number(order.totals?.totalCents ?? order.amountCents ?? 0),
    refundedCents: Number(order.refundedCents ?? 0),
    returnable: RETURNABLE.has(String(order['status'])),
    lines: (order.lineItems ?? []).map((line: any, index: number) => ({
      index,
      name: String(line?.name ?? ''),
      variantLabel: line?.variantLabel ?? null,
      quantity: Math.max(1, Math.round(Number(line?.quantity ?? 1))),
      returned: returned[index] ?? 0,
      // Units an online return holds or already took (AGL-3611).
      held: held[index] ?? 0,
      valueCents: values[index] ?? 0,
    })),
    tenders: posRefundableByTender(order).map((tender) => ({
      id: tender.id,
      method: tender.method,
      label: posTenderLabel(tender),
      amountCents: tender.amountCents,
      refundableCents: tender.refundableCents,
    })),
  }
}

async function findOrders(
  hostRef: FirebaseFirestore.DocumentReference,
  rawText: unknown,
): Promise<Array<{ id: string; data: Record<string, any> }>> {
  const text = String(rawText ?? '').trim().slice(0, 200)
  if (!text) return []
  const orders = hostRef.collection('orders')
  const digits = text.replace(/^#/, '')
  if (/^\d{1,12}$/.test(digits)) {
    const snapshot = await orders.where('number', '==', Number(digits)).limit(5).get()
    return snapshot.docs.map((doc) => ({ id: doc.id, data: (doc.data() ?? {}) as Record<string, any> }))
  }
  if (text.includes('@')) {
    const snapshot = await orders
      .where('customerEmailLower', '==', nameSearchKey(text))
      .orderBy('createdAtMs', 'desc')
      .limit(10)
      .get()
    return snapshot.docs.map((doc) => ({ id: doc.id, data: (doc.data() ?? {}) as Record<string, any> }))
  }
  const id = posOpsCleanId(text)
  if (!id) return []
  const snapshot = await orders.doc(id).get()
  return snapshot.exists ? [{ id, data: (snapshot.data() ?? {}) as Record<string, any> }] : []
}

function parsePicks(raw: unknown): PosReturnPick[] {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, 200).map((entry: any) => ({
    index: Number(entry?.index),
    quantity: Number(entry?.quantity),
  }))
}

function parseSplit(raw: unknown): Array<{ paymentId: string; amountCents: number }> | null {
  if (!Array.isArray(raw) || !raw.length) return null
  return raw.slice(0, 20).map((entry: any) => ({
    paymentId: String(entry?.paymentId ?? ''),
    amountCents: Number(entry?.amountCents),
  }))
}

/** What a refunded tender moved, and how to hand back a reservation it did not. */
interface TenderResult {
  allocation: PosRefundAllocation
  status: 'refunded' | 'failed'
  refundId?: string
  error?: string
}

export async function handlePosReturn(deps: PosReturnDeps, req: PluginApiRequest): Promise<Outcome> {
  if (req.method !== 'POST') return { status: 405, body: { error: 'Method not allowed' } }
  const body = posOpsBody(req)
  const gate = await authorizePosOps(deps, req, body['hostId'])
  if ('error' in gate) return { status: gate.status, body: { error: gate.error } }
  const staff = gate.staff
  const action = String(body['action'] ?? '')

  if (action === 'find') {
    const found = await findOrders(staff.hostRef, body['text'])
    const held = await Promise.all(
      found.map(async (entry) =>
        unitsHeldByOnlineReturns(
          (await staff.hostRef.collection('returns').where('orderId', '==', entry.id).get()).docs,
        ),
      ),
    )
    return {
      status: 200,
      body: { orders: found.map((entry, at) => returnSummary(entry.id, entry.data, held[at])) },
    }
  }
  if (action !== 'refund') return { status: 400, body: { error: 'Unknown action' } }

  const register = await readPosRegister(staff, body['registerId'])
  if ('error' in register) return { status: register.status, body: { error: register.error } }
  const registerId = register.ref.id
  const orderId = posOpsCleanId(body['orderId'])
  if (!orderId) return { status: 400, body: { error: 'Missing orderId' } }
  const idempotencyKey = posOpsIdempotencyKey(req)
  if (!idempotencyKey) {
    return { status: 400, body: { error: 'A refund needs an Idempotency-Key header.' } }
  }
  const picks = parsePicks(body['lines'])
  const requestedSplit = parseSplit(body['tenders'])
  const restock = body['restock'] !== false
  const reason = String(body['reason'] ?? '').trim().slice(0, 200)
  const reasonCode: CommerceModel.ReturnReason = CommerceModel.RETURN_REASONS.includes(
    body['reasonCode'] as CommerceModel.ReturnReason,
  )
    ? (body['reasonCode'] as CommerceModel.ReturnReason)
    : 'other'
  const firestore = deps.firestore()
  const orderRef = staff.hostRef.collection('orders').doc(orderId)
  const storeReturns = staff.hostRef.collection('returns').where('orderId', '==', orderId)

  // 1. Every refusal that needs no money to move.
  const snapshot = await orderRef.get()
  if (!snapshot.exists) return { status: 404, body: { error: 'Unknown order' } }
  const order = CommerceModel.liftLegacyOrder(snapshot.data() as any) as unknown as PosReturnSource &
    Record<string, any>
  if (!RETURNABLE.has(String(order['status']))) {
    return { status: 409, body: { error: `Orders in "${order['status']}" cannot be returned.` } }
  }
  if (CommerceModel.orderDisputeBlocksRefund(order as any)) {
    return {
      status: 409,
      body: {
        error:
          'A chargeback is open on this order, so it was not refunded. Respond to the ' +
          'dispute or accept it in the Stripe dashboard first.',
      },
    }
  }
  const plan = planPosReturn(order, picks, unitsHeldByOnlineReturns((await storeReturns.get()).docs))
  if ('error' in plan) return { status: 400, body: { error: plan.error } }
  const split = splitPosRefund(order, plan.refundCents, requestedSplit)
  if ('error' in split) return { status: 400, body: { error: split.error } }

  const cashier = await resolvePosCashier(deps, staff, registerId, body['cashierAssertion'])
  // The limit is the person at the till's: a PIN-switched cashier is held
  // to it even on a device a workspace admin signed in on.
  const cashierIsManager =
    cashier.cashierId === staff.uid
      ? staff.isManager
      : await memberIsPosManager(deps, staff.hostRef, staff.hostId, cashier.cashierId)
  const authority = await decidePosRefundAuthority(deps, {
    hostId: staff.hostId,
    hostRef: staff.hostRef,
    registerId,
    refundCents: plan.refundCents,
    limitCents: staff.settings.refundLimitCents,
    isManager: cashierIsManager,
    managerAssertion: body['managerAssertion'],
  })
  if ('body' in authority) return { status: 403, body: authority.body }

  const needsCash = split.allocations.some((slice) => slice.method === 'cash')
  const needsStripe = split.allocations.some((slice) => POS_STRIPE_TENDERS.has(slice.method))
  const openShiftId = String(register.data['openShiftId'] ?? '') || null
  if (needsCash && !openShiftId && staff.settings.requireOpenShift) {
    return { status: 409, body: { error: 'Open a shift before paying cash out of the drawer.' } }
  }
  if (needsStripe && !process.env.STRIPE_SECRET_KEY) {
    return { status: 501, body: { error: 'Payments are not configured.' } }
  }

  // 2. The attempt claim.
  const claimed = await claimAttempt(firestore as any, {
    kind: 'pos-return',
    scopeId: staff.hostId,
    orgId: staff.orgId,
    key: `${orderId}:${idempotencyKey}`,
    busyMessage: 'This return is already being refunded',
  })
  if ('replay' in claimed) return { status: claimed.replay.status, body: claimed.replay.body as any }
  const claim = claimed.claim

  // 3. The reservation, re-read under the transaction.
  type Reserved = {
    refundCents: number
    lineCents: number[]
    completedLines: number[]
    allocations: PosRefundAllocation[]
    prior: { refundedCents: number; returnedQuantities: Record<string, number>; posPaymentRefunds: Record<string, number> }
  }
  let reserved: Reserved
  try {
    reserved = await firestore.runTransaction(async (transaction) => {
      const fresh = CommerceModel.liftLegacyOrder(
        ((await transaction.get(orderRef)).data() ?? {}) as any,
      ) as unknown as PosReturnSource & Record<string, any>
      if (!RETURNABLE.has(String(fresh['status']))) {
        throw new ReturnRefusal(409, `Orders in "${fresh['status']}" cannot be returned.`)
      }
      const freshPlan = planPosReturn(
        fresh,
        picks,
        unitsHeldByOnlineReturns((await transaction.get(storeReturns)).docs),
      )
      if ('error' in freshPlan) throw new ReturnRefusal(409, freshPlan.error)
      const freshSplit = splitPosRefund(fresh, freshPlan.refundCents, requestedSplit)
      if ('error' in freshSplit) throw new ReturnRefusal(409, freshSplit.error)
      const prior = {
        refundedCents: Number(fresh.refundedCents ?? 0),
        returnedQuantities: { ...(fresh.returnedQuantities ?? {}) },
        posPaymentRefunds: { ...(fresh.posPaymentRefunds ?? {}) },
      }
      const posPaymentRefunds = { ...prior.posPaymentRefunds }
      for (const slice of freshSplit.allocations) {
        posPaymentRefunds[slice.paymentId] = (posPaymentRefunds[slice.paymentId] ?? 0) + slice.amountCents
      }
      transaction.update(orderRef, {
        refundedCents: prior.refundedCents + freshPlan.refundCents,
        returnedQuantities: freshPlan.returnedQuantities,
        posPaymentRefunds,
      })
      return {
        refundCents: freshPlan.refundCents,
        lineCents: freshPlan.lineCents,
        completedLines: freshPlan.completedLines,
        allocations: freshSplit.allocations,
        prior,
      }
    })
  } catch (error) {
    await claim.release()
    if (error instanceof ReturnRefusal) return { status: error.status, body: { error: error.message } }
    throw error
  }

  // 4–5. The money, Stripe first.
  const tenders = posRefundableByTender(order)
  const tenderOf = (paymentId: string) => tenders.find((tender) => tender.id === paymentId)
  const ordered = [...reserved.allocations].sort(
    (a, b) => Number(POS_STRIPE_TENDERS.has(b.method)) - Number(POS_STRIPE_TENDERS.has(a.method)),
  )
  const results: TenderResult[] = []
  for (const allocation of ordered) {
    const tender = tenderOf(allocation.paymentId)
    const anyMoved = results.some((result) => result.status === 'refunded')
    try {
      if (POS_STRIPE_TENDERS.has(allocation.method)) {
        const paymentIntentId = tender?.paymentIntentId ?? String(order['paymentIntentId'] ?? '')
        if (!paymentIntentId) throw new ReturnRefusal(409, 'That card payment has nothing Stripe can refund.')
        const refund = await createStripeRefund({
          paymentIntentId,
          amountCents: allocation.amountCents,
          idempotencyKey: claim.stripeKey ? `${claim.stripeKey}:${allocation.paymentId}` : null,
          metadata: { hostId: staff.hostId, orderId, registerId, kind: 'pos-return' },
          fetch: deps.fetch,
        })
        if ('error' in refund) throw new ReturnRefusal(refund.status, refund.error)
        results.push({ allocation, status: 'refunded', refundId: refund.refundId })
      } else if (allocation.method === 'gift_card') {
        await creditGiftCard(firestore, staff.hostRef, tender?.giftCardId ?? '', allocation.amountCents, orderId, deps.now())
        results.push({ allocation, status: 'refunded' })
      } else if (allocation.method === 'folio') {
        await reverseFolio(staff.hostRef, tender?.reservationId ?? String(order['reservationId'] ?? ''), allocation.amountCents, orderId, deps.now())
        results.push({ allocation, status: 'refunded' })
      } else {
        // Cash: recorded on the drawer with the return itself, below.
        results.push({ allocation, status: 'refunded' })
      }
    } catch (error) {
      const message = error instanceof ReturnRefusal ? error.message : 'Refund failed'
      if (!(error instanceof ReturnRefusal)) console.error('[pos-return] tender failed', allocation, error)
      if (!anyMoved) {
        // Nothing has moved: hand the whole reservation back and let the
        // same attempt be tried again.
        await firestore
          .runTransaction(async (transaction) => {
            await transaction.get(orderRef)
            transaction.update(orderRef, reserved.prior)
          })
          .catch((rollback) => console.error('[pos-return] rollback failed', orderId, rollback))
        await claim.release()
        return {
          status: error instanceof ReturnRefusal ? error.status : 502,
          body: { error: message },
        }
      }
      results.push({ allocation, status: 'failed', error: message })
    }
  }

  const failed = results.filter((result) => result.status === 'failed')
  const refundedCents = results
    .filter((result) => result.status === 'refunded')
    .reduce((sum, result) => sum + result.allocation.amountCents, 0)
  const cashCents = results
    .filter((result) => result.status === 'refunded' && result.allocation.method === 'cash')
    .reduce((sum, result) => sum + result.allocation.amountCents, 0)
  const now = deps.now()
  // One id names the return under the register (its tenders and shift) and
  // in the store's returns list beside the online ones (AGL-3611).
  const returnId = createResourceUid()
  const returnRef = register.ref.collection('returns').doc(returnId)
  const storeReturnRef = staff.hostRef.collection('returns').doc(returnId)
  const orderLabel = CommerceModel.formatOrderNumber(order as any, orderId)
  const lines = picks.map((pick, at) => ({
    index: pick.index,
    quantity: pick.quantity,
    name: String(order.lineItems?.[pick.index]?.name ?? ''),
    refundCents: reserved.lineCents[at] ?? 0,
  }))

  // The record, the drawer, the order: one transaction.
  let closedTheOrder = false
  let fullyRefunded = false
  let shiftIdForReturn: string | null = null
  let storeReturn: CommerceModel.HostReturn | null = null
  await firestore.runTransaction(async (transaction) => {
    const freshRegister = await transaction.get(register.ref)
    const shiftId = String(freshRegister.get('openShiftId') ?? '') || null
    const shiftRef = shiftId ? register.ref.collection('shifts').doc(shiftId) : null
    const shiftSnapshot = shiftRef ? await transaction.get(shiftRef) : null
    const fresh = CommerceModel.liftLegacyOrder(
      ((await transaction.get(orderRef)).data() ?? {}) as any,
    ) as unknown as PosReturnSource & Record<string, any>
    const shiftOpen = Boolean(shiftSnapshot?.exists && shiftSnapshot.get('status') === 'open')
    shiftIdForReturn = shiftOpen ? shiftId : null

    // Hand back what a failed card did not refund.
    const failedCents = failed.reduce((sum, result) => sum + result.allocation.amountCents, 0)
    const posPaymentRefunds = { ...(fresh.posPaymentRefunds ?? {}) }
    for (const result of failed) {
      posPaymentRefunds[result.allocation.paymentId] = Math.max(
        0,
        (posPaymentRefunds[result.allocation.paymentId] ?? 0) - result.allocation.amountCents,
      )
    }
    const orderRefunded = Math.max(0, Number(fresh.refundedCents ?? 0) - failedCents)
    const totalCents = Number(fresh.totals?.totalCents ?? fresh.amountCents ?? 0)
    fullyRefunded = orderRefunded >= totalCents && totalCents > 0
    closedTheOrder =
      fullyRefunded &&
      fresh['status'] !== 'refunded' &&
      CommerceModel.canTransitionOrder(fresh['status'] as CommerceModel.OrderStatus, 'refunded')
    const completedLines = Object.entries(fresh.returnedQuantities ?? {})
      .filter(([index, count]) => count >= Math.max(1, Number(fresh.lineItems?.[Number(index)]?.quantity ?? 1)))
      .map(([index]) => Number(index))
    const tenderWords = results
      .map(
        (result) =>
          `${posMoney(result.allocation.amountCents)} to ${posTenderLabel(
            tenderOf(result.allocation.paymentId) ?? { method: result.allocation.method },
          )}${result.status === 'failed' ? ' (FAILED)' : ''}`,
      )
      .join(', ')
    const units = picks.reduce((sum, pick) => sum + pick.quantity, 0)
    transaction.update(orderRef, {
      refundedCents: orderRefunded,
      posPaymentRefunds,
      ...(closedTheOrder ? { status: 'refunded' } : {}),
      ...(completedLines.length
        ? {
            refundedLineItemIds: [
              ...new Set([...(fresh.refundedLineItemIds ?? []), ...completedLines]),
            ].sort((a, b) => a - b),
          }
        : {}),
      timeline: CommerceModel.appendOrderEvent(
        fresh as any,
        'refund',
        `Returned at the register: ${units} ${units === 1 ? 'item' : 'items'}, ${tenderWords}` +
          (restock ? '; restocked' : '') +
          (authority.approvedBy ? '; approved by a manager' : ''),
        now,
      ),
    })
    const record: PosRegisterReturn = {
      hostId: staff.hostId,
      registerId,
      orderId,
      ...(typeof order['number'] === 'number' ? { orderNumber: order['number'] } : {}),
      ...(shiftOpen && shiftId ? { shiftId } : {}),
      lines,
      refundedCents,
      tenders: results.map((result) => ({
        ...result.allocation,
        status: result.status,
        ...(result.refundId ? { refundId: result.refundId } : {}),
        ...(result.error ? { error: result.error } : {}),
      })),
      restocked: restock,
      ...(register.data['locationId'] ? { locationId: String(register.data['locationId']) } : {}),
      cashierId: cashier.cashierId,
      ...(authority.approvedBy ? { approvedBy: authority.approvedBy } : {}),
      ...(reason ? { reason } : {}),
      status: failed.length ? 'partial' : 'refunded',
      atMs: now,
    }
    transaction.create(returnRef, record)
    const restockedLines = picks.map((pick) => ({ lineItemId: pick.index, quantity: pick.quantity }))
    const registerLocationId = register.data['locationId'] ? String(register.data['locationId']) : undefined
    storeReturn = {
      orderId,
      orderNumber: orderLabel,
      customerEmail: (order['customerEmail'] as string | undefined) ?? null,
      customerName: (order['customerName'] as string | undefined) ?? null,
      lines: picks.map((pick) => ({ lineItemId: pick.index, quantity: pick.quantity, reason: reasonCode })),
      status: 'refunded',
      requestedBy: 'merchant',
      source: 'register',
      registerId,
      ...(reason ? { merchantNote: reason } : {}),
      ...(restock
        ? {
            restock: {
              lines: restockedLines,
              ...(registerLocationId ? { locationId: registerLocationId } : {}),
              atMs: now,
            },
          }
        : {}),
      refundedAtMs: now,
      refundCents: refundedCents,
      timeline: [
        {
          atMs: now,
          event: 'refunded',
          detail: `At the register${failed.length ? `; ${posMoney(failed.reduce((sum, result) => sum + result.allocation.amountCents, 0))} still owed` : ''}`,
        },
      ],
      createdAtMs: now,
      updatedAtMs: now,
    }
    transaction.create(storeReturnRef, storeReturn)
    if (shiftOpen && shiftRef && cashCents > 0) {
      const event: PosCashEvent = {
        id: returnRef.id,
        type: 'refund',
        amountCents: cashCents,
        reason: `Return ${orderLabel}`,
        by: cashier.cashierId,
        atMs: now,
        orderId,
      }
      const cashEvents = Array.isArray(shiftSnapshot?.get('cashEvents')) ? shiftSnapshot!.get('cashEvents') : []
      transaction.update(shiftRef, { cashEvents: [...cashEvents, event] })
    }
  })

  // Restock what came back to the register's location.
  let restockedUnits = 0
  if (restock) {
    restockedUnits = await restockReturn(
      firestore,
      staff.hostRef,
      order,
      picks,
      String(register.data['locationId'] ?? order['locationId'] ?? '') || undefined,
      orderId,
      now,
    ).catch((error) => {
      console.error('[pos-return] restock failed', orderId, error)
      return 0
    })
  }

  // The drawer opens for the cash being handed back.
  if (cashCents > 0) {
    await deps.printer.kickDrawer({
      hostId: staff.hostId,
      registerId,
      reason: 'cash_refund',
      causeId: returnRef.id,
      createdBy: cashier.cashierId,
    })
  }

  const payload = {
    returnId: returnRef.id,
    refundedCents,
    outstandingCents: failed.reduce((sum, result) => sum + result.allocation.amountCents, 0),
    partial: failed.length > 0,
    tenders: results.map((result) => ({
      method: result.allocation.method,
      label: posTenderLabel(tenderOf(result.allocation.paymentId) ?? { method: result.allocation.method }),
      amountCents: result.allocation.amountCents,
      status: result.status,
      ...(result.error ? { error: result.error } : {}),
    })),
    cashOutCents: cashCents,
    restockedUnits,
    shiftId: shiftIdForReturn,
    fullyRefunded,
  }
  await claim.record(200, payload)
  if (refundedCents > 0) {
    await deps.afterRefund({
      hostId: staff.hostId,
      orderId,
      email: order['customerEmail'] ?? null,
      refundCents: refundedCents,
      closedTheOrder,
      fullyRefunded,
      returnedProductIds: [
        ...new Set(
          picks
            .map((pick) => String((order.lineItems?.[pick.index] as { productId?: string } | undefined)?.productId ?? ''))
            .filter(Boolean),
        ),
      ],
      lineIndexes: picks.map((pick) => pick.index),
      fullLineIndexes: reserved.completedLines,
      returnId,
      storeReturn: storeReturn as unknown as CommerceModel.HostReturn,
      refundIds: results.flatMap((result) => (result.refundId ? [result.refundId] : [])),
    })
  }
  return { status: 200, body: payload }
}

/**
 * Units per order line that the store's OTHER returns — the online returns
 * flow (AGL-3611) — hold or already took back. The register's own returns are
 * left out: `returnedQuantities` on the order already counts them.
 */
export function unitsHeldByOnlineReturns(
  docs: ReadonlyArray<{ data(): FirebaseFirestore.DocumentData | undefined }>,
): number[] {
  const held: number[] = []
  for (const doc of docs) {
    const entry = (doc.data() ?? {}) as CommerceModel.HostReturn
    if (entry.source === 'register' || !CommerceModel.returnHoldsUnits(entry)) continue
    for (const line of entry.lines ?? []) {
      const index = Number(line?.lineItemId)
      if (!Number.isInteger(index) || index < 0) continue
      held[index] = (held[index] ?? 0) + Math.max(0, Math.floor(Number(line?.quantity) || 0))
    }
  }
  return held
}

/** Whether a member is a workspace admin and this site's admin, asked now. */
async function memberIsPosManager(
  deps: PosOpsDeps,
  hostRef: FirebaseFirestore.DocumentReference,
  hostId: string,
  uid: string,
): Promise<boolean> {
  const host = await hostRef.get()
  const role = (host.get('memberRoles') ?? {})[uid]
  return isPosManager(role, await deps.membership(uid, hostId))
}

class ReturnRefusal extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

/**
 * Store credit back on the card it came off. A voided or frozen card takes
 * nothing: a void is a fraud or refund decision, and re-crediting it would
 * undo that decision by the back door.
 */
async function creditGiftCard(
  firestore: FirebaseFirestore.Firestore,
  hostRef: FirebaseFirestore.DocumentReference,
  code: string,
  amountCents: number,
  orderId: string,
  now: number,
): Promise<void> {
  const id = String(code ?? '').trim()
  if (!id || id.includes('/') || id.length > 64) throw new ReturnRefusal(409, 'That gift card payment does not name its card.')
  const ref = hostRef.collection('giftCards').doc(id)
  await firestore.runTransaction(async (transaction) => {
    const card = await transaction.get(ref)
    if (!card.exists) throw new ReturnRefusal(409, 'That gift card no longer exists.')
    if (card.get('voidedAtMs') != null || card.get('frozenAtMs') != null) {
      throw new ReturnRefusal(409, 'That gift card is voided or frozen, so it cannot take a refund.')
    }
    transaction.update(ref, {
      balanceCents: Math.max(0, Math.round(Number(card.get('balanceCents') ?? 0))) + amountCents,
      lastCreditAtMs: now,
      lastCreditOrderId: orderId,
    })
  })
}

/** A room charge taken back: a negative line on the same stay's folio. */
async function reverseFolio(
  hostRef: FirebaseFirestore.DocumentReference,
  reservationId: string,
  amountCents: number,
  orderId: string,
  now: number,
): Promise<void> {
  const id = posOpsCleanId(reservationId)
  if (!id) throw new ReturnRefusal(409, 'That room charge does not name its stay.')
  const ref = hostRef.collection('reservations').doc(id)
  const firestore = hostRef.firestore
  await firestore.runTransaction(async (transaction) => {
    const stay = await transaction.get(ref)
    if (!stay.exists) throw new ReturnRefusal(409, 'That stay no longer exists.')
    const folio = Array.isArray(stay.get('folio')) ? stay.get('folio') : []
    transaction.update(ref, {
      folio: [...folio, { orderId, amountCents: -amountCents, note: 'Return at the register', atMs: now }],
    })
  })
}

/**
 * The returned units back on the shelf, at the register's location, with an
 * adjustment row each so the stock history says why the count went up.
 * Only variants that track stock move.
 */
async function restockReturn(
  firestore: FirebaseFirestore.Firestore,
  hostRef: FirebaseFirestore.DocumentReference,
  order: PosReturnSource & Record<string, any>,
  picks: readonly PosReturnPick[],
  locationId: string | undefined,
  orderId: string,
  now: number,
): Promise<number> {
  const byProduct = new Map<string, Array<{ variantId?: string; quantity: number }>>()
  for (const pick of picks) {
    const line = (order.lineItems ?? [])[pick.index] as Record<string, any> | undefined
    const productId = String(line?.['productId'] ?? '')
    if (!productId) continue
    byProduct.set(productId, [
      ...(byProduct.get(productId) ?? []),
      { ...(line?.['variantId'] ? { variantId: String(line['variantId']) } : {}), quantity: pick.quantity },
    ])
  }
  let units = 0
  for (const [productId, lines] of byProduct) {
    const ref = hostRef.collection('products').doc(productId)
    units += await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref)
      if (!snapshot.exists) return 0
      const product = CommerceModel.liftLegacyProduct(snapshot.data() as any)
      let variants = product.variants
      const rows: Array<{ variantId: string; quantity: number }> = []
      for (const line of lines) {
        const variantId = line.variantId ?? product.variants[0]?.id
        const variant = variants.find((candidate) => candidate.id === variantId)
        if (!variantId || !variant || variant.inventory == null) continue
        variants = CommerceModel.adjustVariantInventory({ variants }, variantId, line.quantity, locationId)
        rows.push({ variantId, quantity: line.quantity })
      }
      if (!rows.length) return 0
      transaction.update(ref, {
        variants,
        ...CommerceModel.productStockFields({ ...product, variants }),
        updatedAtMs: now,
      })
      for (const row of rows) {
        transaction.create(hostRef.collection('inventoryAdjustments').doc(createResourceUid()), {
          productId,
          variantId: row.variantId,
          delta: row.quantity,
          reason: 'refund',
          orderId,
          ...(locationId ? { locationId } : {}),
          atMs: now,
        } satisfies CommerceModel.InventoryAdjustment)
      }
      return rows.reduce((sum, row) => sum + row.quantity, 0)
    })
  }
  return units
}

export function createPosReturnHandler(
  deps: () => PosReturnDeps = defaultPosReturnDeps,
): PluginApiHandler {
  return async (req, res) => {
    try {
      const outcome = await handlePosReturn(deps(), req)
      return res.status(outcome.status).json(outcome.body)
    } catch (error) {
      console.error('[pos-return] failed', error)
      return res.status(500).json({ error: 'The return could not be refunded' })
    }
  }
}

export const posReturnHandler = createPosReturnHandler()
