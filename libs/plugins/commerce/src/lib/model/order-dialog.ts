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

import { orderLineRefundCents, type HostOrder } from './commerce-orders'
import { orderDisputeBlocksRefund, orderHasOpenDispute } from './commerce-dispute'
import {
  FULFILLMENT_CARRIER_CHOICES,
  orderLineFulfillmentStates,
  remainingFulfillmentLines,
  type OrderFulfillmentLine,
} from './order-fulfillment'
import { carrierLabelFor } from './tracking-url'

/*
 * THE ORDER DIALOG'S OWN RULES (AGL-3841): the Fulfill items panel's starting
 * counts, its selection and whether it is everything left to ship, the
 * carrier select's value, and the refund question. Pure, so the apps replay
 * them; kept out of the model barrel, which the storefront loads, as only the
 * console's order dialog (loaded on demand) and the apps need them.
 */

/** The carrier select's value for a carrier typed by hand. */
export const FULFILLMENT_OTHER_CARRIER = 'other'

/**
 * The carrier select's value for a typed carrier: empty for none, the named
 * carrier it spells (`ups` is UPS), or {@link FULFILLMENT_OTHER_CARRIER}.
 */
export function fulfillmentCarrierChoice(carrier: string | null | undefined): string {
  if (!carrier) return ''
  const label = carrierLabelFor(carrier)
  return FULFILLMENT_CARRIER_CHOICES.includes(label) ? label : FULFILLMENT_OTHER_CARRIER
}

/**
 * Fulfill items' starting count for each line, by index: what is left of each
 * shippable line, so the common case (ship everything) is one click. Digital
 * and service lines start at zero, as there is nothing to ship; when nothing
 * physical is left they start full instead, so the panel still closes a
 * digital-only order in one click.
 */
export function fulfillItemsStartQuantities(order: Pick<HostOrder, 'lineItems' | 'fulfillments'>): number[] {
  const states = orderLineFulfillmentStates(order)
  const physicalLeft = states.some((state) => state.requiresShipping && state.remainingQuantity > 0)
  return states.map((state) =>
    physicalLeft ? (state.requiresShipping ? state.remainingQuantity : 0) : state.remainingQuantity,
  )
}

/** The units picked in Fulfill items, by line index: the lines with a count above zero. */
export function fulfillItemsSelection(quantities: readonly number[]): OrderFulfillmentLine[] {
  return quantities
    .map((quantity, lineItemId) => ({ lineItemId, quantity: Math.max(0, Math.floor(Number(quantity) || 0)) }))
    .filter((entry) => entry.quantity > 0)
}

/**
 * Whether the picked units are exactly everything still to ship, in which
 * case the request names no lines and the route ships what is left.
 */
export function fulfillItemsIsEverything(
  order: Pick<HostOrder, 'lineItems' | 'fulfillments'>,
  selection: readonly OrderFulfillmentLine[],
): boolean {
  const remaining = remainingFulfillmentLines(order)
  return (
    remaining.length > 0 &&
    remaining.length === selection.length &&
    remaining.every(
      (entry, index) =>
        selection[index]?.lineItemId === entry.lineItemId && selection[index]?.quantity === entry.quantity,
    )
  )
}

/** Dollars as the order dialog prints them. */
const dialogUsd = (cents: number | undefined) => `$${((cents ?? 0) / 100).toFixed(2)}`

/**
 * The order dialog's refund question: the whole order, or the named lines
 * (AGL-2454), with the figure the route will refund (the server's own
 * `orderLineRefundCents` for lines) and, while an inquiry is open, that a full
 * refund resolves it (AGL-1820).
 */
export function orderRefundPrompt(
  order: Pick<HostOrder, 'lineItems' | 'totals' | 'amountCents' | 'refundedCents' | 'dispute'>,
  lineItemIds: readonly number[] = [],
): { title: string; text: string } {
  const lines = order.lineItems ?? []
  const scoped = lineItemIds.length > 0
  const text =
    (scoped
      ? `Refunds ${dialogUsd(orderLineRefundCents(order, lineItemIds))} for ${lineItemIds
          .map((index) => lines[index]?.name ?? `line ${index}`)
          .join(', ')} through Stripe, and withdraws that line's ` +
        'downloads, license keys and gated content. A license key already ' +
        'sent to the buyer is retired, not returned to your pool — they ' +
        'still hold the string, so reissuing it would give two people one ' +
        'working key.'
      : `Refunds ${dialogUsd(
          (order.totals?.totalCents ?? order.amountCents ?? 0) - (order.refundedCents ?? 0),
        )} to the buyer through Stripe.`) +
    (orderHasOpenDispute(order) && !orderDisputeBlocksRefund(order)
      ? ' An inquiry is open on this charge — a full refund resolves it' +
        ' before it can become a chargeback.'
      : '')
  return { title: scoped ? 'Refund this line?' : 'Refund this order?', text }
}

/** Why Refund is unavailable while a chargeback is open (AGL-1820), as the order dialog says it. */
export const REFUND_BLOCKED_BY_DISPUTE =
  'A chargeback is open on this order, and refunding would not' +
  ' withdraw it — the bank has already taken the disputed' +
  ' amount, so a refund on top would pay the shopper twice.' +
  ' Respond to the dispute or accept it in the Stripe' +
  ' dashboard; refund any remainder once it settles.'
