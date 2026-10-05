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
  buildTransferPlan,
  isBlankTransferValue,
  TRANSFER_FILE_SAMPLE_ROW,
  TRANSFER_SYSTEM_GROUP,
  type BuildTransferPlanInput,
  type MatchKeySpec,
  type PlannedTransferRow,
  type TransferField,
  type TransferFieldChange,
  type TransferPlan,
  type TransferPlanSummary,
  type TransferWarningSample,
} from '@aglyn/aglyn/data-transfer'
import { hostRoleFor } from '@aglyn/aglyn/app-utils/organizations'
import type { PicklistSpec } from '@aglyn/aglyn/app-utils/picklists'
import { commerceSlug } from '../model/commerce'
import type { DiscountKind, HostDiscount } from '../model/commerce-discounts'
import { GIFT_CARD_CONFIRM_STEP_ID } from './transfer-keys'
import {
  GIFT_CARD_CURRENCY,
  giftCardAmountProblem,
  giftCardCodeOf,
  giftCardCodeProblem,
  type HostGiftCard,
} from '../model/commerce-gift-cards'
import {
  ORDER_CHANNEL_LABELS,
  ORDER_STATUS_LABELS,
  liftLegacyOrder,
  type HostOrder,
  type OrderAddress,
} from '../model/commerce-orders'

/*
 * ORDERS, DISCOUNTS, COUPONS, GIFT CARDS AND CATEGORIES AS FILES (AGL-3531):
 * each resource's fields, and its stored document as the record a file
 * names. Pure — the server half is `records.server.ts`.
 *
 * ## What imports, and why the rest does not
 *
 * - Categories, discounts and coupons import: each is a document a person
 *   writes from the console with nothing derived behind it, so a file
 *   writes the same fields the console's card does. A discount or coupon
 *   created from a file starts SWITCHED OFF unless the file says Active —
 *   a promotion going live from a spreadsheet is money leaving the store.
 *   How many times one was used is history, exported and never written.
 * - Orders are exported only: an order is the record of a sale, written by
 *   checkout, the register or a paid draft.
 * - Gift cards import by ISSUING each card (AGL-3551, below), never by
 *   writing a balance: a balance is money a shopper can spend. A gift
 *   card's ID is its code, so the file is worth what the cards are.
 */

const iso = (ms: unknown): string | null => {
  const time =
    typeof ms === 'number'
      ? ms
      : ms && typeof (ms as { toMillis?: () => number }).toMillis === 'function'
        ? (ms as { toMillis: () => number }).toMillis()
        : ms && typeof (ms as { toDate?: () => Date }).toDate === 'function'
          ? ((ms as { toDate: () => Date }).toDate()?.getTime() ?? NaN)
          : NaN
  return Number.isFinite(time) ? new Date(time).toISOString() : null
}

const dollars = (cents: unknown): number | null => {
  const value = Number(cents)
  return cents === null || cents === undefined || !Number.isFinite(value) ? null : Math.round(value) / 100
}

const text = (value: unknown): string => (value === null || value === undefined ? '' : String(value).trim())

/** A planned row's changes, by field id. */
export function rowChanges(row: PlannedTransferRow): Record<string, unknown> {
  return Object.fromEntries(row.diff.map((change) => [change.fieldId, change.after]))
}

/**
 * The core's plan with the fields a NEW record cannot be made without
 * marked required — never in the catalog, where a required field must be
 * mapped, and a file that only switches discounts off would be refused.
 */
export function planWithCreateRequired(input: BuildTransferPlanInput, required: readonly string[]): TransferPlan {
  return buildTransferPlan({
    ...input,
    fields: input.fields.map((field) => (required.includes(field.id) ? { ...field, required: true } : field)),
  })
}

/*==========================================
 * ORDERS
 *=========================================*/

export const ORDER_TRANSFER_FIELDS: readonly TransferField[] = [
  { id: 'number', label: 'Order number', group: 'order', type: 'integer', readOnly: true },
  { id: 'date', label: 'Date', group: 'order', type: 'datetime', readOnly: true },
  { id: 'status', label: 'Status', group: 'order', type: 'text', readOnly: true },
  { id: 'channel', label: 'Channel', group: 'order', type: 'text', readOnly: true },
  { id: 'customerEmail', label: 'Customer email', group: 'customer', type: 'email', readOnly: true },
  { id: 'customerName', label: 'Customer name', group: 'customer', type: 'text', readOnly: true },
  {
    id: 'product',
    label: 'Product',
    group: 'items',
    type: 'text',
    readOnly: true,
    description: 'The first line’s product, and how many more the order holds.',
  },
  { id: 'items', label: 'Items', group: 'items', type: 'longText', readOnly: true, description: 'Every line: quantity × name (variant), SKU.' },
  { id: 'itemCount', label: 'Units', group: 'items', type: 'integer', readOnly: true },
  { id: 'subtotal', label: 'Items subtotal', group: 'money', type: 'number', readOnly: true },
  { id: 'shipping', label: 'Shipping', group: 'money', type: 'number', readOnly: true },
  { id: 'tax', label: 'Tax', group: 'money', type: 'number', readOnly: true },
  { id: 'discount', label: 'Discount', group: 'money', type: 'number', readOnly: true },
  { id: 'total', label: 'Total', group: 'money', type: 'number', readOnly: true, description: 'What was charged, in dollars.' },
  { id: 'fee', label: 'Fee', group: 'money', type: 'number', readOnly: true },
  { id: 'refunded', label: 'Refunded', group: 'money', type: 'number', readOnly: true },
  { id: 'net', label: 'Net', group: 'money', type: 'number', readOnly: true, description: 'The total less what was refunded.' },
  { id: 'coupon', label: 'Coupon', group: 'money', type: 'text', readOnly: true },
  { id: 'shippingAddress', label: 'Shipping address', group: 'customer', type: 'text', readOnly: true },
  { id: 'billingAddress', label: 'Billing address', group: 'customer', type: 'text', readOnly: true },
  { id: 'note', label: 'Note', group: 'order', type: 'longText', readOnly: true },
  { id: 'dispute', label: 'Dispute', group: 'order', type: 'text', readOnly: true },
  { id: 'paymentIntentId', label: 'Payment ID', group: TRANSFER_SYSTEM_GROUP.id, type: 'text', system: true },
]

export const ORDER_TRANSFER_GROUPS = [
  { id: 'order', label: 'Order' },
  { id: 'customer', label: 'Customer' },
  { id: 'items', label: 'Items' },
  { id: 'money', label: 'Money' },
]

/** An order as a stored document, with the id the export reads it under. */
export type StoredOrder = Partial<HostOrder> & {
  createdAt?: unknown
  createdAtMs?: number
  amountCents?: number
  feeCents?: number
  productId?: string
}

const addressLine = (address: OrderAddress | undefined): string | null => {
  if (!address) return null
  const parts = [address.name, address.line1, address.line2, address.city, address.state, address.postalCode, address.country]
    .map(text)
    .filter(Boolean)
  return parts.length ? parts.join(', ') : null
}

/**
 * One order as a file names it. The money is what was ACTUALLY charged:
 * the order's `totals`, and the legacy flat fields only where a buy-now order
 * of old carries nothing else (AGL-1747) — a POS or draft order has no flat
 * field, and reading those first exported every one of them at $0.00. A
 * legacy row is named from `productNames`, never as "Product".
 */
export function orderRecord(
  id: string,
  stored: StoredOrder,
  productNames: Readonly<Record<string, string>> = {},
): Record<string, unknown> {
  const lifted = liftLegacyOrder(stored)
  const lineItems = stored.lineItems ?? []
  const first = lineItems[0]?.name ?? productNames[stored.productId ?? ''] ?? stored.productId ?? ''
  const totals = lifted.totals
  const totalCents = Number(totals?.totalCents ?? stored.amountCents ?? 0)
  const refundedCents = Number(stored.refundedCents ?? 0)
  return {
    id,
    number: typeof stored.number === 'number' ? stored.number : null,
    date: iso(stored.createdAt) ?? iso(stored.createdAtMs),
    status: ORDER_STATUS_LABELS[lifted.status] ?? lifted.status,
    channel: ORDER_CHANNEL_LABELS[lifted.channel ?? 'online'] ?? lifted.channel ?? 'online',
    customerEmail: stored.customerEmail ?? null,
    customerName: stored.customerName ?? null,
    product: lineItems.length > 1 ? `${first} +${lineItems.length - 1} more` : first || null,
    items: lineItems.length
      ? lineItems
          .map(
            (line) =>
              `${line.quantity} × ${line.name}${line.variantLabel ? ` (${line.variantLabel})` : ''}${line.sku ? `, ${line.sku}` : ''}`,
          )
          .join('; ')
      : null,
    itemCount: lineItems.reduce((sum, line) => sum + (Number(line.quantity) || 0), 0),
    subtotal: dollars(totals?.itemsCents),
    shipping: dollars(totals?.shippingCents),
    tax: dollars(totals?.taxCents),
    discount: dollars(totals?.discountCents),
    total: dollars(totalCents),
    fee: dollars(totals?.feeCents ?? stored.feeCents ?? 0),
    refunded: dollars(refundedCents),
    net: dollars(totalCents - refundedCents),
    coupon: stored.couponCode ?? null,
    shippingAddress: addressLine(stored.shippingAddress),
    billingAddress: addressLine(stored.billingAddress),
    note: stored.note ?? null,
    dispute: stored.dispute ? text((stored.dispute as { status?: string }).status) || 'open' : null,
    paymentIntentId: stored.paymentIntentId ?? null,
  }
}

/*==========================================
 * DISCOUNTS
 *=========================================*/

export const DISCOUNT_KIND_PICKLIST = 'commerce.discountKind'

const DISCOUNT_KIND_LABELS: Record<DiscountKind, string> = {
  percent: 'Percent off',
  fixed: 'Amount off',
  free_shipping: 'Free shipping',
}

export const DISCOUNT_KIND_SPEC: PicklistSpec = {
  restricted: true,
  standardValues: Object.entries(DISCOUNT_KIND_LABELS).map(([id, label]) => ({ id, label })),
  defaultValueId: 'percent',
}

/** A discount kind's id from a label or id in any case, or `null`. */
export function discountKindOf(value: unknown): DiscountKind | null {
  const key = text(value).toLowerCase()
  const found = Object.entries(DISCOUNT_KIND_LABELS).find(
    ([id, label]) => id === key || label.toLowerCase() === key,
  )
  return found ? (found[0] as DiscountKind) : null
}

export const DISCOUNT_TRANSFER_FIELDS: readonly TransferField[] = [
  {
    id: 'code',
    label: 'Code',
    group: 'discount',
    type: 'text',
    aliases: ['discount code', 'promo code', 'coupon code'],
    description: 'What a shopper types; blank for a discount that applies on its own.',
  },
  { id: 'name', label: 'Name', group: 'discount', type: 'text', aliases: ['title', 'discount name'] },
  {
    id: 'kind',
    label: 'Kind',
    group: 'discount',
    type: 'picklist',
    picklistId: DISCOUNT_KIND_PICKLIST,
    aliases: ['type', 'discount type', 'value type'],
    description: 'Percent off, Amount off or Free shipping. Needed for a new discount.',
  },
  { id: 'percentOff', label: 'Percent off', group: 'discount', type: 'integer', aliases: ['percent', 'percentage'] },
  { id: 'amountOff', label: 'Amount off', group: 'discount', type: 'currency', aliases: ['amount', 'value'] },
  {
    id: 'minimumSubtotal',
    label: 'Minimum subtotal',
    group: 'conditions',
    type: 'currency',
    aliases: ['minimum', 'minimum purchase', 'minimum subtotal'],
  },
  {
    id: 'productIds',
    label: 'Product IDs',
    group: 'conditions',
    type: 'text',
    description: 'The products it covers, by their IDs separated by commas; blank covers the whole store.',
  },
  { id: 'maxRedemptions', label: 'Use limit', group: 'conditions', type: 'integer', aliases: ['usage limit', 'max uses'] },
  { id: 'startsAt', label: 'Starts', group: 'conditions', type: 'datetime', aliases: ['start date', 'starts at'] },
  { id: 'endsAt', label: 'Ends', group: 'conditions', type: 'datetime', aliases: ['end date', 'ends at', 'expires'] },
  {
    id: 'active',
    label: 'Active',
    group: 'discount',
    type: 'boolean',
    aliases: ['enabled', 'status'],
    description: 'A new discount starts switched off unless the file says it is active.',
  },
  { id: 'redemptions', label: 'Times used', group: 'conditions', type: 'integer', readOnly: true },
]

export const DISCOUNT_MATCH_KEYS: readonly MatchKeySpec[] = [
  { fieldId: 'code', normalizer: 'caseless' },
  { fieldId: 'name', normalizer: 'name' },
  { fieldId: 'id', normalizer: 'aglynId' },
]

/** A code as the discounts card stores it: upper case, letters, digits, `_` and `-`. */
export function promotionCode(value: unknown, max = 40): string {
  return text(value)
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, max)
}

const cents = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'object' && 'amountMinor' in (value as object)) return Math.round(Number((value as { amountMinor: number }).amountMinor))
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(number * 100) : null
}

const msOf = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null
  const time = typeof value === 'number' ? value : Date.parse(String(value))
  return Number.isFinite(time) ? time : null
}

export function discountRecord(id: string, stored: Partial<HostDiscount> & { code?: string | null }): Record<string, unknown> {
  return {
    id,
    code: stored.code || null,
    name: stored.name ?? null,
    kind: DISCOUNT_KIND_LABELS[stored.kind as DiscountKind] ?? stored.kind ?? null,
    percentOff: stored.kind === 'percent' ? (stored.valuePct ?? null) : null,
    amountOff: stored.kind === 'fixed' ? dollars(stored.valueCents) : null,
    minimumSubtotal: dollars(stored.minSubtotalCents),
    productIds: stored.productIds?.length ? stored.productIds.join(', ') : null,
    maxRedemptions: stored.maxRedemptions ?? null,
    startsAt: iso(stored.startAtMs),
    endsAt: iso(stored.endAtMs),
    active: stored.enabled !== false,
    redemptions: stored.redemptions ?? 0,
  }
}

/**
 * The document a discount's changes make, over what it holds: the stored
 * shape the discounts card writes, or the sentence refusing it.
 */
export function discountWrite(
  current: (Partial<HostDiscount> & { code?: string | null }) | null,
  changes: Readonly<Record<string, unknown>>,
): { doc: Record<string, unknown> } | { problem: string } {
  const doc: Record<string, unknown> = current ? { ...current } : { enabled: false, redemptions: 0 }
  const has = (fieldId: string) => fieldId in changes
  if (has('code')) doc['code'] = promotionCode(changes['code']) || null
  if (has('name')) doc['name'] = text(changes['name']).slice(0, 80) || null
  if (has('kind')) doc['kind'] = discountKindOf(changes['kind'])
  if (has('percentOff')) doc['valuePct'] = changes['percentOff'] === null ? null : Math.round(Number(changes['percentOff']))
  if (has('amountOff')) doc['valueCents'] = cents(changes['amountOff'])
  if (has('minimumSubtotal')) doc['minSubtotalCents'] = cents(changes['minimumSubtotal'])
  if (has('productIds')) {
    const ids = text(changes['productIds']).split(/[,;|\s]+/).map(text).filter(Boolean)
    doc['productIds'] = ids.length ? [...new Set(ids)] : null
  }
  if (has('maxRedemptions')) {
    const limit = Number(changes['maxRedemptions'])
    doc['maxRedemptions'] = changes['maxRedemptions'] === null || !Number.isFinite(limit) ? null : Math.max(1, Math.round(limit))
  }
  if (has('startsAt')) doc['startAtMs'] = msOf(changes['startsAt'])
  if (has('endsAt')) doc['endAtMs'] = msOf(changes['endsAt'])
  if (has('active')) doc['enabled'] = changes['active'] === true
  if (!('code' in doc)) doc['code'] = null
  const kind = doc['kind'] as DiscountKind | null | undefined
  if (!kind) return { problem: 'Say what kind of discount it is: Percent off, Amount off or Free shipping.' }
  if (kind === 'percent') {
    const pct = Number(doc['valuePct'])
    if (!(pct >= 1 && pct <= 100)) return { problem: 'A percent-off discount takes 1 to 100 percent.' }
  }
  if (kind === 'fixed' && !(Number(doc['valueCents']) > 0)) return { problem: 'An amount-off discount needs an amount.' }
  if (!doc['code'] && !text(doc['name'])) return { problem: 'A discount with no code needs a name shoppers see.' }
  const start = doc['startAtMs'] as number | null
  const end = doc['endAtMs'] as number | null
  if (start != null && end != null && end <= start) return { problem: 'A discount ends after it starts.' }
  return { doc }
}

/*==========================================
 * COUPONS
 *=========================================*/

export const COUPON_TRANSFER_FIELDS: readonly TransferField[] = [
  {
    id: 'code',
    label: 'Code',
    group: 'coupon',
    type: 'text',
    matchKey: true,
    aliases: ['coupon code', 'promo code', 'discount code'],
    description: 'What a shopper types; a coupon’s code is its ID, so it is never changed.',
  },
  { id: 'percentOff', label: 'Percent off', group: 'coupon', type: 'integer', aliases: ['percent', 'percentage', 'value'] },
  { id: 'maxRedemptions', label: 'Use limit', group: 'coupon', type: 'integer', aliases: ['usage limit', 'max uses'] },
  { id: 'expiresAt', label: 'Expires', group: 'coupon', type: 'datetime', aliases: ['expiry', 'expires at', 'end date'] },
  {
    id: 'active',
    label: 'Active',
    group: 'coupon',
    type: 'boolean',
    aliases: ['enabled', 'status'],
    description: 'A new coupon starts switched off unless the file says it is active.',
  },
  { id: 'redemptions', label: 'Times used', group: 'coupon', type: 'integer', readOnly: true },
  { id: 'createdAt', label: 'Created', group: TRANSFER_SYSTEM_GROUP.id, type: 'datetime', system: true },
]

export const COUPON_MATCH_KEYS: readonly MatchKeySpec[] = [
  { fieldId: 'code', normalizer: 'caseless' },
  { fieldId: 'id', normalizer: 'aglynId' },
]

export interface StoredCoupon {
  percentOff?: number
  enabled?: boolean
  redemptions?: number
  maxRedemptions?: number
  expiresAtMs?: number
  createdAt?: unknown
}

export function couponRecord(id: string, stored: StoredCoupon): Record<string, unknown> {
  return {
    id,
    code: id,
    percentOff: stored.percentOff ?? null,
    maxRedemptions: stored.maxRedemptions ?? null,
    expiresAt: iso(stored.expiresAtMs),
    active: stored.enabled !== false,
    redemptions: stored.redemptions ?? 0,
    createdAt: iso(stored.createdAt),
  }
}

/** A coupon's document from its changes, as the coupons card writes one, or the refusal. */
export function couponWrite(
  current: StoredCoupon | null,
  changes: Readonly<Record<string, unknown>>,
): { doc: Record<string, unknown> } | { problem: string } {
  const doc: Record<string, unknown> = current ? { ...current } : { enabled: false, redemptions: 0 }
  if ('percentOff' in changes) doc['percentOff'] = Math.round(Number(changes['percentOff']))
  if ('maxRedemptions' in changes) {
    const limit = Number(changes['maxRedemptions'])
    doc['maxRedemptions'] = changes['maxRedemptions'] === null || !Number.isFinite(limit) ? null : Math.max(1, Math.round(limit))
  }
  if ('expiresAt' in changes) doc['expiresAtMs'] = msOf(changes['expiresAt'])
  if ('active' in changes) doc['enabled'] = changes['active'] === true
  const pct = Number(doc['percentOff'])
  if (!(pct > 0 && pct <= 100)) return { problem: 'A coupon takes 1 to 100 percent off.' }
  return { doc }
}

/*==========================================
 * GIFT CARDS
 *=========================================*/

/*
 * A GIFT CARD IMPORT ISSUES CARDS (AGL-3551). A row is never written as a
 * balance: each one the dry run passes is issued through the same path as
 * the Gift cards card's Issue (`issueGiftCard`), so its amount is bounded,
 * its code is never overwritten and its activity line is written.
 *
 * - The plan mints the code a row will carry — the file's own, a new one for
 *   a blank cell, or a new one for a row whose code another card holds and
 *   whose Conflicts choice is "create a new record" — so the dry run shows
 *   every card exactly as it will be issued.
 * - A row whose code another card holds and whose choice is "update" is
 *   refused: a file never changes a card. "Skip" leaves the card as it is.
 * - Every card the dry run passes adds to a total the person types back on
 *   the wizard's Confirm step (`GIFT_CARD_CONFIRM_STEP_ID`). The server reads
 *   the typed total from `extras` and issues nothing unless it is exactly
 *   the total of the cards about to be issued.
 */

export const GIFT_CARD_TRANSFER_FIELDS: readonly TransferField[] = [
  {
    id: 'code',
    label: 'Code',
    group: 'card',
    type: 'text',
    matchKey: true,
    aliases: ['gift card code', 'card code', 'gift card number', 'card number'],
    description:
      'The card’s code, which spends its balance: keep the file as safe as the cards. On import, a blank code gets a new one.',
  },
  {
    id: 'balance',
    label: 'Balance',
    group: 'card',
    type: 'currency',
    aliases: ['amount', 'value', 'current balance', 'remaining balance', 'balance remaining'],
    description: 'On import, what the card is issued for, in US dollars — the balance it carries over.',
  },
  {
    id: 'currency',
    label: 'Currency',
    group: 'card',
    type: 'text',
    aliases: ['currency code'],
    description: 'Optional. Cards are held in US dollars; a row in another currency is refused, never converted.',
  },
  { id: 'initial', label: 'Issued for', group: 'card', type: 'number', readOnly: true },
  { id: 'status', label: 'Status', group: 'card', type: 'text', readOnly: true, description: 'Active, Used up, Frozen or Voided.' },
  {
    id: 'recipientEmail',
    label: 'Recipient email',
    group: 'card',
    type: 'email',
    aliases: ['email', 'customer email', 'recipient'],
  },
  { id: 'orderId', label: 'Order ID', group: 'card', type: 'text', readOnly: true, description: 'Blank for a card issued by hand.' },
  { id: 'note', label: 'Note', group: 'card', type: 'text', aliases: ['notes', 'message'] },
  { id: 'issuedAt', label: 'Issued', group: 'card', type: 'datetime', readOnly: true },
  { id: 'lastUsedAt', label: 'Last used', group: 'card', type: 'datetime', readOnly: true },
]

/** A card is found by its code, which is its ID. */
export const GIFT_CARD_MATCH_KEYS: readonly MatchKeySpec[] = [
  { fieldId: 'code', normalizer: 'caseless' },
  { fieldId: 'id', normalizer: 'aglynId' },
]

/** The fields an issued card's undo entry holds: any of them moving means the card was spent. */
export const GIFT_CARD_UNDO_FIELDS = ['balance', 'status', 'lastUsedAt'] as const

export type StoredGiftCard = HostGiftCard & {
  initialCents?: number
  recipientEmail?: string | null
  orderId?: string | null
  note?: string
  createdAtMs?: number
  lastUsedAtMs?: number
  importJobId?: string
  importRow?: number
}

export function giftCardRecord(id: string, stored: StoredGiftCard): Record<string, unknown> {
  const balance = Number(stored.balanceCents ?? 0)
  return {
    id,
    code: id,
    balance: dollars(balance),
    currency: GIFT_CARD_CURRENCY,
    initial: dollars(stored.initialCents),
    status: stored.voidedAtMs ? 'Voided' : stored.frozenAtMs ? 'Frozen' : balance > 0 ? 'Active' : 'Used up',
    recipientEmail: stored.recipientEmail ?? null,
    orderId: stored.orderId ?? null,
    note: stored.note ?? null,
    issuedAt: iso(stored.createdAtMs),
    lastUsedAt: iso(stored.lastUsedAtMs),
  }
}

/** Dollars and cents as a person reads them: `$1,250.00`. */
export function giftCardMoney(amountCents: number): string {
  return `$${(amountCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** A total as a person types it (`1250`, `$1,250.00`), in cents; `null` for anything else. */
export function typedDollarsToCents(typed: unknown): number | null {
  const body = String(typed ?? '')
    .trim()
    .replace(/^\$|^usd\s*/i, '')
    .replace(/\s*usd$/i, '')
    .replace(/,/g, '')
    .trim()
  if (!/^\d+(\.\d{1,2})?$/.test(body)) return null
  return Math.round(Number(body) * 100)
}

/** The Confirm step's answer. */
export interface GiftCardConfirmation {
  /** The total the person typed, in cents. */
  totalCents: number
  /** Email each card's recipient their code as it is issued. */
  email: boolean
}

/** The Confirm step's answer from `extras`, or `null` for none: a total is a whole number of cents. */
export function readGiftCardConfirmation(
  extras: Readonly<Record<string, unknown>> | undefined,
): GiftCardConfirmation | null {
  const value = extras?.[GIFT_CARD_CONFIRM_STEP_ID]
  if (!value || typeof value !== 'object') return null
  const totalCents = (value as Record<string, unknown>)['totalCents']
  if (typeof totalCents !== 'number' || !Number.isInteger(totalCents) || totalCents <= 0) return null
  return { totalCents, email: (value as Record<string, unknown>)['email'] === true }
}

/**
 * Whether a member may issue gift cards from a file: the workspace's owners
 * and admins, and a collaborator who is an admin of this site. Money a
 * shopper can spend is minted by the people who answer for the store.
 */
export function canImportGiftCards(member: Parameters<typeof hostRoleFor>[0], hostId: string): boolean {
  return hostRoleFor(member, hostId) === 'admin'
}

/** The card one planned row issues, as the plan decided it. */
export interface GiftCardRowPlan {
  /** The code the card is issued under. */
  code: string
  /** The file's code was taken, and the person chose a new one. */
  newCode: boolean
  /** The file named no code, so one was made. */
  madeCode: boolean
  amountCents: number
  recipientEmail: string | null
  note: string | null
  /** Why the row issues nothing; the `gift-card-issuable` invariant fails it. */
  problem?: string
  /** What every card this import issues adds up to. */
  totalCents: number
  /** Whether the person typed exactly that total on the Confirm step. */
  confirmed: boolean
}

export type GiftCardPlannedRow = PlannedTransferRow & { giftCard?: GiftCardRowPlan }

/** A money cell in cents and its currency: the derived amount, or a number as dollars. */
function giftCardAmount(value: unknown): { cents: number; currency: string } | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'object' && 'amountMinor' in (value as object)) {
    const amount = value as { amountMinor: number; currency?: string }
    return { cents: Math.round(Number(amount.amountMinor)), currency: text(amount.currency).toUpperCase() || GIFT_CARD_CURRENCY }
  }
  const number = Number(value)
  return Number.isFinite(number) ? { cents: Math.round(number * 100), currency: GIFT_CARD_CURRENCY } : null
}

/** The card a row's changes issue, or the sentence refusing it. */
export function giftCardIssueOf(
  changes: Readonly<Record<string, unknown>>,
  code: { value: string; fromFile: boolean },
): Omit<GiftCardRowPlan, 'newCode' | 'madeCode' | 'totalCents' | 'confirmed'> {
  const recipientEmail = text(changes['recipientEmail']).toLowerCase().slice(0, 200) || null
  const note = text(changes['note']).slice(0, 200) || null
  const base = { code: code.value, amountCents: 0, recipientEmail, note }
  const codeProblem = code.fromFile ? giftCardCodeProblem(code.value) : null
  if (codeProblem) return { ...base, problem: codeProblem }
  const amount = giftCardAmount(changes['balance'])
  if (!amount) return { ...base, problem: 'Say what the card is issued for in the Balance column.' }
  const named = text(changes['currency']).toUpperCase()
  for (const currency of [amount.currency, named].filter(Boolean)) {
    if (currency !== GIFT_CARD_CURRENCY) {
      return { ...base, problem: `Gift cards are held in US dollars; ${currency} is not converted.` }
    }
  }
  const amountProblem = giftCardAmountProblem(amount.cents)
  if (amountProblem) return { ...base, problem: amountProblem }
  return { ...base, amountCents: amount.cents }
}

/**
 * The core's plan for a gift card file, made into the cards it issues: each
 * create carrying the card it issues ({@link GiftCardRowPlan}), each row
 * that would change an existing card refused, the total of every card
 * counted, and a `screening` warning stating that total — and, when the
 * Confirm step's answer is missing or names another total, that nothing is
 * issued until it is confirmed.
 */
export function planGiftCardRows(
  plan: TransferPlan,
  input: {
    confirmation: GiftCardConfirmation | null
    mintCode: () => string
    /** The file's codes a card on the site already holds, however the file spelled them. */
    taken?: ReadonlySet<string>
  },
): TransferPlan {
  const issuing = new Map<string, number>()
  const rows = plan.rows.map((row): GiftCardPlannedRow => {
    if (row.verdict === 'update' || row.verdict === 'unchanged') {
      const code = row.recordId ?? ''
      return {
        ...row,
        verdict: 'update',
        diff: [],
        giftCard: {
          code,
          newCode: false,
          madeCode: false,
          amountCents: 0,
          recipientEmail: null,
          note: null,
          problem:
            `A gift card with the code ${code} already exists, and a file never changes a card. ` +
            'On the Conflicts step, skip this row, or create a new record to issue it under a new code.',
          totalCents: 0,
          confirmed: false,
        },
      }
    }
    if (row.verdict !== 'create') return row
    const changes = rowChanges(row)
    const fileCode = giftCardCodeOf(changes['code'])
    // A create for a row that matched a card is the person's "create a new
    // record": the card it names keeps its code, and this one gets another.
    const newCode = Boolean(fileCode) && row.match.kind !== 'new'
    const madeCode = !fileCode
    const code = newCode || madeCode ? input.mintCode() : fileCode
    const fromFile = !newCode && !madeCode
    let issue = giftCardIssueOf(changes, { value: code, fromFile })
    const earlier = issuing.get(code)
    if (!issue.problem && fromFile && input.taken?.has(code)) {
      issue = { ...issue, problem: `A gift card with the code ${code} already exists, and a file never changes a card.` }
    } else if (!issue.problem && earlier !== undefined) {
      issue = { ...issue, problem: `Row ${earlier + 1} issues the code ${code} already.` }
    }
    if (!issue.problem) issuing.set(code, row.index)
    const diff: TransferFieldChange[] = [
      ...row.diff.filter((change) => change.fieldId !== 'code'),
      { fieldId: 'code', before: null, after: code, mode: 'overwrite', source: 'default', rule: 'written' },
    ]
    return { ...row, diff, giftCard: { ...issue, newCode, madeCode, totalCents: 0, confirmed: false } }
  })

  const issued = rows.filter(
    (row): row is GiftCardPlannedRow & { giftCard: GiftCardRowPlan } =>
      row.verdict === 'create' && Boolean(row.giftCard) && !row.giftCard?.problem,
  )
  const totalCents = issued.reduce((sum, row) => sum + row.giftCard.amountCents, 0)
  const confirmed = input.confirmation?.totalCents === totalCents
  for (const row of rows) {
    if (row.giftCard) row.giftCard = { ...row.giftCard, totalCents, confirmed }
  }

  const warnings = plan.warnings.filter((warning) => warning.class !== 'screening')
  if (issued.length) {
    const samples: TransferWarningSample[] = [
      {
        row: TRANSFER_FILE_SAMPLE_ROW,
        fieldId: 'balance',
        value: giftCardMoney(totalCents),
        detail: `Issues ${issued.length.toLocaleString('en-US')} gift card${issued.length === 1 ? '' : 's'} worth ${giftCardMoney(totalCents)} in total.`,
      },
    ]
    if (!confirmed) {
      samples.push({
        row: TRANSFER_FILE_SAMPLE_ROW,
        detail: input.confirmation
          ? `The total confirmed was ${giftCardMoney(input.confirmation.totalCents)}, not ${giftCardMoney(totalCents)}: no card is issued until the total is confirmed again on the Confirm step.`
          : 'The total has not been confirmed: no card is issued until it is typed on the Confirm step.',
      })
    }
    warnings.push({
      class: 'screening',
      count: issued.length,
      rows: issued.length,
      fieldIds: ['balance'],
      samples,
      requiresAcknowledgement: true,
    })
  }
  const summary: TransferPlanSummary = { create: 0, update: 0, unchanged: 0, skip: 0, fail: 0, total: rows.length }
  for (const row of rows) summary[row.verdict] += 1
  return {
    rows,
    summary,
    warnings,
    acknowledgementsRequired: warnings.filter((warning) => warning.requiresAcknowledgement).map((warning) => warning.class),
  }
}

/*==========================================
 * CATEGORIES
 *=========================================*/

export const CATEGORY_TRANSFER_FIELDS: readonly TransferField[] = [
  { id: 'name', label: 'Name', group: 'category', type: 'text', aliases: ['category', 'category name', 'title'] },
  {
    id: 'slug',
    label: 'Slug',
    group: 'category',
    type: 'text',
    readOnly: true,
    matchKey: true,
    aliases: ['handle'],
    description: 'Made from the name, as the console makes it; a file finds a category by it.',
  },
  {
    id: 'parent',
    label: 'Parent',
    group: 'category',
    type: 'text',
    aliases: ['parent category', 'parent slug'],
    description: 'The parent category’s slug or name; blank for a top-level category.',
  },
  { id: 'order', label: 'Position', group: 'category', type: 'integer', aliases: ['sort order', 'order'] },
]

export const CATEGORY_MATCH_KEYS: readonly MatchKeySpec[] = [
  { fieldId: 'slug', normalizer: 'slug' },
  { fieldId: 'name', normalizer: 'name' },
  { fieldId: 'id', normalizer: 'aglynId' },
]

export interface StoredCategory {
  name?: string
  slug?: string
  parentId?: string | null
  order?: number
}

export function categoryRecord(
  id: string,
  stored: StoredCategory,
  slugs: ReadonlyMap<string, string> = new Map(),
): Record<string, unknown> {
  return {
    id,
    name: stored.name ?? null,
    slug: stored.slug ?? null,
    parent: stored.parentId ? (slugs.get(stored.parentId) ?? stored.parentId) : null,
    order: typeof stored.order === 'number' ? stored.order : null,
  }
}

/** Every category's slug, name and parent, by id: what a parent is resolved against. */
export type CategoryIndex = Map<string, StoredCategory>

/** The category a parent cell names — by id, slug, then name — or `null`. */
export function resolveCategoryParent(index: CategoryIndex, value: unknown): string | null {
  const wanted = text(value)
  if (!wanted) return null
  if (index.has(wanted)) return wanted
  const slug = commerceSlug(wanted)
  for (const [id, category] of index) if (category.slug === slug) return id
  const name = wanted.toLowerCase()
  for (const [id, category] of index) if (text(category.name).toLowerCase() === name) return id
  return null
}

/**
 * A category's document from its changes: the name and the slug made from
 * it, the parent resolved — never itself or one of its own descendants —
 * and the position. A parent the site does not have is refused, not
 * guessed.
 */
export function categoryWrite(
  id: string,
  current: StoredCategory | null,
  changes: Readonly<Record<string, unknown>>,
  index: CategoryIndex,
): { doc: Record<string, unknown> } | { problem: string } {
  const doc: Record<string, unknown> = current ? { ...current } : { parentId: null }
  if ('name' in changes) {
    const name = text(changes['name']).slice(0, 80)
    if (!name) return { problem: 'A category needs a name.' }
    doc['name'] = name
    doc['slug'] = commerceSlug(name) || id
  }
  if (!text(doc['name'])) return { problem: 'A category needs a name.' }
  if ('parent' in changes) {
    if (isBlankTransferValue(changes['parent'])) doc['parentId'] = null
    else {
      const parentId = resolveCategoryParent(index, changes['parent'])
      if (!parentId) return { problem: `No category "${text(changes['parent'])}" to put it under.` }
      for (let at: string | null = parentId, steps = 0; at && steps < 100; steps += 1) {
        if (at === id) return { problem: 'A category cannot sit under itself or one of its own.' }
        at = index.get(at)?.parentId ?? null
      }
      doc['parentId'] = parentId
    }
  }
  if ('order' in changes) {
    const order = Number(changes['order'])
    doc['order'] = changes['order'] === null || !Number.isFinite(order) ? null : Math.round(order)
  }
  return { doc }
}
