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

import { POS_HARDWARE_TERMS_SECTIONS } from './pos-hardware-terms'

/*==========================================
 * THE HARDWARE SHOP AS A MERCHANT READS IT (AGL-4038): the words and the
 * small rules of the Hardware card and the Card readers to set up card, in
 * one pure module so the console and the native apps (through the native
 * contracts) say and decide the same things. The route
 * (`/api/commerce/pos-hardware`) still decides every one of them again.
 *=========================================*/

/** What the buyer reads of their return request. */
export const POS_HARDWARE_RETURN_LABELS: Record<string, string> = {
  requested: 'Return requested',
  declined: 'Return declined',
  refunded: 'Returned',
}

/** The Hardware card's words. */
export const POS_HARDWARE_SHOP_TEXT = {
  header: 'Hardware',
  subheader: 'Card readers and accessories, set up and shipped to you',
  /** The card while the shop is closed: the purchase history alone. */
  historySubheader: 'Your card reader orders',
  intro:
    'Choose the readers and accessories you need. We set each reader up and ship your order to the address you enter at checkout. The delivery email says how to start taking payments with it.',
  shipsTo: 'Ships to street addresses in the United States. P.O. boxes and military addresses are not accepted.',
  placed: 'Thanks, your order is in. It shows under Your orders within a minute, and we email you as it ships.',
  canceled: 'Checkout was canceled. Nothing was charged.',
  ordersTitle: 'Your orders',
  noOrders: 'No hardware orders yet.',
  quantity: 'Quantity',
  shipping: 'Shipping',
  items: 'Items',
  tax: 'Tax',
  taxAtCheckout: 'Calculated at checkout',
  total: 'Total',
  totalBeforeTax: 'Total before tax',
  termsBefore: 'I accept the ',
  termsLink: `hardware terms of sale (Terms, Sections ${POS_HARDWARE_TERMS_SECTIONS})`,
  termsAfter: '.',
  businessUse: 'I am buying this hardware for use in my business.',
  checkout: 'Check out',
  checkoutFailed: 'Checkout could not be started',
  buyKeyReason:
    'Only a member with the "Buy point of sale hardware" permission can place an order. Ask an organization admin.',
  termsReason: 'Accept the hardware terms of sale and confirm the hardware is for your business first.',
  returnAction: 'Request a return',
  returnBody:
    'Tell us why. Our team gets your request and arranges the return with you. Returns follow the hardware terms of sale: the return shipping is yours to pay, the original shipping is not refunded, and any restocking fee charged for the return comes off the refund.',
  returnField: 'Why are you returning it?',
  returnCancel: 'Cancel',
  returnSend: 'Request return',
  returnSent: 'Return requested. Our team arranges it with you.',
  returnFailed: 'The request did not go through',
  columnOrder: 'Order',
  columnPlaced: 'Placed',
  columnItems: 'Items',
  columnTotal: 'Total',
  columnStatus: 'Status',
  columnReturn: 'Return',
  columnTracking: 'Tracking',
} as const

/** The Card readers to set up card's words. */
export const POS_HARDWARE_WAITING_TEXT = {
  header: 'Card readers to set up',
  subheader: 'Bought in person, ready for your store',
  planPrompt:
    'A card reader takes payments at the register, which comes with the point of sale. Add it, then set the reader up here.',
  planReason: 'Add a plan with the point of sale first.',
  openDevices: 'Open POS devices',
  markSetUp: 'Mark set up',
  marked: 'Marked set up',
  whichStore: 'Which store is it for?',
  choose: 'Choose',
  chosen: 'Store chosen',
  failed: 'That did not work. Try again.',
} as const

/** The title of the return request: `Return HW-1A2B3C?`. */
export function posHardwareReturnTitle(number: string): string {
  return `Return ${number}?`
}

/** Whether a return reason is long enough to send (the route asks the same). */
export function posHardwareReturnReasonReady(reason: string): boolean {
  return String(reason ?? '').trim().length >= 3
}

/**
 * Whether an order offers "Request a return": none asked yet, and a reader
 * bought in person, or an order shipped to you once it has shipped.
 */
export function posHardwareReturnOffered(order: {
  status: string
  source?: string | null
  returnRequest?: { state: string } | null
}): boolean {
  if (order.returnRequest) return false
  return (
    order.status === 'delivered' ||
    order.status === 'registered' ||
    ((order.source ?? 'online') !== 'in_person' && order.status === 'shipped')
  )
}

/**
 * The orders shipped from the Hardware card that have arrived, by number, for
 * the point of sale prompt. A reader bought from the platform's own store is
 * prompted on the Card readers to set up card instead, so it is not named twice.
 */
export function posHardwareArrivedNumbers(
  orders: ReadonlyArray<{ number: string; status: string; source?: string | null }>,
): string[] {
  return orders
    .filter((order) => (order.source ?? 'online') === 'online' && (order.status === 'delivered' || order.status === 'registered'))
    .map((order) => order.number)
}

/** An order's items as Your orders lists them: `Pocket reader (M2) × 2, …`. */
export function posHardwareOrderItems(lines: ReadonlyArray<{ name: string; quantity: number }>): string {
  return lines.map((line) => `${line.name} × ${line.quantity}`).join(', ')
}

/** A waiting reader's items as its card heads them: `2 × Pocket reader (M2), …`. */
export function posHardwareWaitingItems(lines: ReadonlyArray<{ name: string; quantity: number }>): string {
  return lines.map((line) => `${line.quantity} × ${line.name}`).join(', ')
}

/** What a reader waiting for its store still needs, once the store is chosen. */
export function posHardwareWaitingNote(input: { storeName: string; serialsTaken: number; hasLocation: boolean }): string {
  const base = input.serialsTaken
    ? `For ${input.storeName}. Add it on the POS devices card with the code it shows, and it is set up: we know its serial number.`
    : `For ${input.storeName}. Add it on the POS devices card with the code it shows, then mark it set up.`
  return input.hasLocation ? base : `${base} The first reader asks for the store’s address.`
}

/**
 * The basket's lines and summary, from the quantities chosen: the lines a
 * checkout sends (quantity above 0, in the catalog's order), the items'
 * subtotal, the shipping chosen and the total before any tax.
 */
export function posHardwareBasket(input: {
  offers: ReadonlyArray<{ sku: string; unitCents: number }>
  quantities: Readonly<Record<string, number>>
  shippingCents: number | null
  automaticTax: boolean
}): {
  lines: Array<{ sku: string; quantity: number }>
  itemsCents: number
  totalCents: number
  totalLabel: string
} {
  const lines = input.offers
    .map((offer) => ({ sku: offer.sku, quantity: Math.max(0, Math.floor(Number(input.quantities[offer.sku] ?? 0))) }))
    .filter((line) => line.quantity > 0)
  const itemsCents = lines.reduce(
    (sum, line) => sum + (input.offers.find((offer) => offer.sku === line.sku)?.unitCents ?? 0) * line.quantity,
    0,
  )
  return {
    lines,
    itemsCents,
    totalCents: itemsCents + (input.shippingCents ?? 0),
    totalLabel: input.automaticTax ? POS_HARDWARE_SHOP_TEXT.totalBeforeTax : POS_HARDWARE_SHOP_TEXT.total,
  }
}

/**
 * Check out's state: `blocked` with the reason the button names when the
 * member may not buy or has not ticked both boxes, and otherwise whether it
 * is pressable (a basket and a shipping speed).
 */
export function posHardwareCheckoutState(input: {
  canBuy: boolean
  termsAccepted: boolean
  businessUse: boolean
  hasLines: boolean
  hasShipping: boolean
}): { blockedReason: string | null; enabled: boolean } {
  const blockedReason = !input.canBuy
    ? POS_HARDWARE_SHOP_TEXT.buyKeyReason
    : !input.termsAccepted || !input.businessUse
      ? POS_HARDWARE_SHOP_TEXT.termsReason
      : null
  return { blockedReason, enabled: blockedReason === null && input.hasLines && input.hasShipping }
}
