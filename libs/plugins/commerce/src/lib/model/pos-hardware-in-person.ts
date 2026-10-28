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

/*==========================================
 * A REGISTER SALE OF HARDWARE BECOMES A HARDWARE ORDER (AGL-4038).
 *
 * The platform's own store sells readers at its register like anything else
 * it sells: its prices, its promotions, its tax rate, its tenders, its
 * account. What follows the sale is a hardware order for the buyer's
 * workspace, built here from the register sale as it was paid — pure, so the
 * money is specced without Firestore.
 *
 * THE HARDWARE'S SHARE OF THE SALE. A sale may hold a reader and a T-shirt.
 * The order takes the hardware lines at the prices they were rung at, and
 * the sale's discount and tax fall on them in proportion — the discount by
 * the lines' share of the items, the tax by their share of what was taxed
 * (the register taxes the whole basket, less its discount, at one rate).
 * Each share is rounded half up to the cent in integer math, and a sale of
 * hardware alone takes the whole discount and the whole tax, to the cent.
 *
 * WHO IT BELONGS TO. A sale a register user attached to an account and a
 * workspace is that workspace's order. Every other one — a kiosk sale, an
 * offline sale, a buyer with no account yet or no workspace yet — is
 * PENDING: kept in the selling workspace's own orders, on its "To attach"
 * list, until it is attached.
 *=========================================*/

import type { OrderHardwareBuyer } from './commerce-orders'
import {
  POS_HARDWARE_CURRENCY,
  POS_HARDWARE_IN_PERSON_SHIPPING_LABEL,
  posHardwareBuyerAddress,
  posHardwareSku,
  type PosHardwareAttachment,
  type PosHardwareLine,
  type PosHardwareOrder,
  type PosHardwareSkuId,
  type PosHardwareTaxLine,
  type PosHardwareTaxRegion,
  type PosHardwareUnit,
} from './pos-hardware'
import { posHardwareTermsAcceptance, posHardwareTermsAcceptanceOf } from './pos-hardware-terms'

/** One register line, with the hardware item its product is, when it is one. */
export interface PosHardwareRegisterLine {
  sku: PosHardwareSkuId | null
  quantity: number
  unitAmountCents: number
}

export interface PosHardwareRegisterShare {
  lines: PosHardwareLine[]
  /** The hardware lines at the prices rung. */
  itemsCents: number
  discountCents: number
  /** What tax was charged on: the items less the discount. */
  taxableCents: number
  taxCents: number
  totalCents: number
}

const whole = (value: unknown): number => {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : 0
}

/** `amount × part / of`, rounded half up, in integer math; 0 when `of` is 0. */
function shareOf(amount: number, part: number, of: number): number {
  if (of <= 0 || amount <= 0 || part <= 0) return 0
  if (part >= of) return amount
  return Math.floor((amount * part * 2 + of) / (of * 2))
}

/**
 * The hardware's share of a register sale, or `null` when the sale sold no
 * hardware. `discountCents` and `taxCents` are the SALE's.
 */
export function posHardwareRegisterShare(input: {
  lines: readonly PosHardwareRegisterLine[]
  discountCents: number
  taxCents: number
}): PosHardwareRegisterShare | null {
  const lines: PosHardwareLine[] = []
  let saleItemsCents = 0
  for (const line of input.lines) {
    const quantity = whole(line.quantity)
    const unitCents = whole(line.unitAmountCents)
    saleItemsCents += quantity * unitCents
    const sku = line.sku ? posHardwareSku(line.sku) : null
    if (!sku || !quantity) continue
    lines.push({ sku: sku.id, name: sku.displayName, quantity, unitCents, lineCents: quantity * unitCents })
  }
  if (!lines.length) return null
  const itemsCents = lines.reduce((sum, line) => sum + line.lineCents, 0)
  const saleDiscountCents = Math.min(whole(input.discountCents), saleItemsCents)
  const discountCents = shareOf(saleDiscountCents, itemsCents, saleItemsCents)
  const taxableCents = Math.max(0, itemsCents - discountCents)
  const taxCents = shareOf(whole(input.taxCents), taxableCents, saleItemsCents - saleDiscountCents)
  return { lines, itemsCents, discountCents, taxableCents, taxCents, totalCents: taxableCents + taxCents }
}

/**
 * One unit per reader sold, in line order; accessories carry no serial and
 * have no unit. `serials` are the serial numbers taken at the sale, in the
 * same order, already normalized; a reader with none waits for one.
 */
export function posHardwareUnits(
  lines: readonly PosHardwareLine[],
  serials: readonly string[] = [],
): PosHardwareUnit[] {
  const units: PosHardwareUnit[] = []
  for (const line of lines) {
    if (posHardwareSku(line.sku)?.kind !== 'reader') continue
    for (let index = 0; index < line.quantity; index += 1) {
      units.push({
        sku: line.sku,
        serialNumber: serials[units.length] || null,
        readerId: null,
        hostId: null,
        registeredAtMs: null,
      })
    }
  }
  return units
}

/**
 * Whose the order is: the workspace the register attached, or pending. A
 * buyer with an account and a workspace is attached; one with only an
 * account or only an address is pending until they have a workspace.
 */
export function posHardwareAttachmentOf(buyer: OrderHardwareBuyer | null | undefined): PosHardwareAttachment {
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null)
  const uid = text(buyer?.uid)
  const orgId = text(buyer?.orgId)
  const attached = Boolean(uid && orgId)
  return {
    state: attached ? 'attached' : 'pending',
    email: text(buyer?.email)?.toLowerCase() ?? null,
    uid,
    orgId: attached ? orgId : null,
    hostId: attached ? text(buyer?.hostId) : null,
    attachedBy: text(buyer?.attachedBy),
    attachedAtMs: attached && Number.isFinite(buyer?.attachedAtMs) ? Number(buyer?.attachedAtMs) : null,
    // The reseller's records of who bought it (AGL-4038), when known.
    name: text(buyer?.name)?.slice(0, 200) ?? null,
    address: posHardwareBuyerAddress(buyer?.address),
  }
}

/** The register sale, as the builder reads it. */
export interface InPersonRegisterSale {
  sellerHostId: string
  sellerOrgId: string
  registerOrderId: string
  number: number | null
  registerId: string | null
  kiosk: boolean
  offline: boolean
  share: PosHardwareRegisterShare
  /** When the sale was paid: the order's own stamp. */
  paidAtMs: number
  /** The tenders that paid it, as its payments name them. */
  tenders: string[]
  paymentLinkSessionId: string | null
  /** The address the receipt went to, kept for staff when nobody is attached. */
  receiptEmail: string | null
  buyer: OrderHardwareBuyer | null | undefined
  /** Serial numbers taken at the sale, normalized, in reader order. */
  serials?: readonly string[]
  /** Where the store taxes from: its own address's region. */
  taxRegion: PosHardwareTaxRegion | null
  /** The store's rate, in percent, when it charged one. */
  ratePct: number | null
  stripeAccountId: string | null
  livemode: boolean
  currency?: string
  /**
   * How the buyer agreed to the terms of sale before paying (AGL-4038), from
   * the register sale; absent, the receipt-and-sign notice at the sale.
   */
  termsAcceptance?: unknown
}

/**
 * The hardware order a register sale becomes. In-person hardware is handed
 * over at the sale, so the order starts at Delivered, and moves to Set up
 * once its readers are registered.
 *
 * The tax line states the base the store's rate was applied to — the
 * hardware's share of what the register taxed — so the platform's return
 * reads a stated base, never an inferred one.
 */
export function inPersonPosHardwareOrder(sale: InPersonRegisterSale): PosHardwareOrder {
  const attachment = posHardwareAttachmentOf(sale.buyer)
  const attached = attachment.state === 'attached'
  const units = posHardwareUnits(sale.share.lines, sale.serials ?? [])
  const state = sale.taxRegion?.state ?? null
  const taxLines: PosHardwareTaxLine[] =
    sale.share.taxCents > 0
      ? [
          {
            amountCents: sale.share.taxCents,
            taxabilityReason: null,
            taxRateId: null,
            taxableAmountCents: sale.share.taxableCents,
            jurisdiction: state,
            rateState: state,
            percentage: sale.ratePct,
          },
        ]
      : []
  return {
    orgId: attached ? (attachment.orgId as string) : sale.sellerOrgId,
    // The buyer's store once they chose one; until then the workspace's,
    // and the buyer picks the store when they set the reader up.
    hostId: attached ? (attachment.hostId ?? '') : '',
    createdBy: attachment.uid,
    contactEmail: attachment.email ?? sale.receiptEmail,
    lines: sale.share.lines,
    subtotalCents: sale.share.itemsCents,
    discountCents: sale.share.discountCents,
    shipping: {
      method: 'in_person',
      label: POS_HARDWARE_IN_PERSON_SHIPPING_LABEL,
      cents: 0,
      name: null,
      phone: null,
      address: null,
      // Sold at the counter: taxed where the store is, as every sale it rings.
      taxRegion: sale.taxRegion,
    },
    taxCents: sale.share.taxCents,
    totalCents: sale.share.totalCents,
    currency: sale.currency ?? POS_HARDWARE_CURRENCY,
    automaticTax: false,
    taxLines,
    stripeCheckoutSessionId: null,
    stripePaymentIntentId: null,
    stripeHardwareOrderId: null,
    tracking: null,
    status: 'delivered',
    livemode: sale.livemode,
    createdAtMs: sale.paidAtMs,
    updatedAtMs: sale.paidAtMs,
    paidAtMs: sale.paidAtMs,
    deliveredAtMs: sale.paidAtMs,
    source: 'in_person',
    // Accepted on the tablet or the display before paying, or else agreed by
    // paying under the receipt's and the booth sign's notice (Terms 4.28).
    termsAcceptance:
      posHardwareTermsAcceptanceOf(sale.termsAcceptance) ??
      posHardwareTermsAcceptance({ method: 'notice', atMs: sale.paidAtMs }),
    posSale: {
      hostId: sale.sellerHostId,
      orgId: sale.sellerOrgId,
      orderId: sale.registerOrderId,
      number: sale.number,
      registerId: sale.registerId,
      kiosk: sale.kiosk,
      offline: sale.offline,
      paymentLinkSessionId: sale.paymentLinkSessionId,
    },
    paidTo: {
      account: 'seller_store',
      hostId: sale.sellerHostId,
      orgId: sale.sellerOrgId,
      tenders: [...new Set(sale.tenders)],
      stripeAccountId: sale.stripeAccountId,
    },
    attachment,
    units,
    serialNumbers: units.flatMap((unit) => (unit.serialNumber ? [unit.serialNumber] : [])),
  }
}
