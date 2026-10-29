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

import type { HostProduct, ProductType } from './commerce'
import type { QuoteRequestRef } from './commerce-quote-request'
import { liftLegacyProduct, variantHasPrice } from './commerce'
import type {
  HostOrder,
  OrderAddress,
  OrderLineItem,
  OrderStatus,
  OrderTotals,
} from './commerce-orders'
import { computeTaxCents, resolveTaxRate, type TaxSettings } from './commerce-tax'
import { storefrontTaxDecision, type StorefrontTaxMode } from './commerce-tax-decision'
import { allocateCentsByWeight } from './commerce-tax-engine'
import {
  lineLabelWithModifiers,
  resolveLineModifiers,
  type ModifierSelection,
} from './product-modifiers'

/*==========================================
 * QUOTES (AGL-4093).
 *
 * A quote is an order that has not been paid yet: a document in
 * `hosts/{hostId}/orders` with `channel: 'quote'`, `status: 'pending'` and a
 * `quote` section holding what only a quote has (the customer it is for, its
 * notes and terms, its discount and shipping, where it stands with the
 * business). Its `number` comes from the store's order counter, so the quote
 * and the order it becomes are one number and one document: paying it flips
 * `status` the way a paid draft order flips.
 *
 * WHAT KEEPS AN UNPAID QUOTE OUT OF EVERY ORDER LIST. A quote document
 * carries none of the fields the order readers ask their queries about:
 * no `createdAtMs` (the Orders list, its filters, the money tiles, the
 * analytics, the exports and the reports all order or range on it), none of
 * the list fields `withOrderListFields` stamps (`customerEmailLower`, the
 * search tokens, `requiresShipping`, `productIds`), and no top-level
 * `customerEmail`, `shippingAddress` or `billingAddress` (the customer's
 * account page, gated content and reviews look orders up by the buyer's
 * address). The customer lives in `quote.customer` until the quote is paid,
 * and whatever pays it writes those order fields then. `isUnpaidQuote` is the
 * test for the few readers that reach orders some other way (by number, by
 * document id, or by a header sort on `status`, `channel` or `number`).
 *
 * Pure: the console's live totals, the server's stored totals, and later the
 * quote's PDF and pay page all come from `computeQuoteTotals`.
 *=========================================*/

/** Where a quote stands with the business. The customer side has no states. */
export type QuoteStage = 'draft' | 'sent' | 'changes_requested' | 'approved'

export const QUOTE_STAGE_LABELS: Record<QuoteStage, string> = {
  draft: 'Draft',
  sent: 'Sent',
  changes_requested: 'Changes requested',
  approved: 'Approved',
}

/** The person a quote is for: a record the workspace keeps, typed details, or both. */
export interface QuoteCustomer {
  /** The person record, as the person-records seam names it (`contact`, …). */
  record?: { kind: string; id: string } | null
  name?: string
  company?: string
  email?: string
  /** `email` lower-cased: what a person erasure finds the quote by. */
  emailLower?: string
  phone?: string
}

/** Money off the whole quote: an amount, or a percentage of the charged lines. */
export interface QuoteDiscount {
  kind: 'amount' | 'percent'
  /** With `amount`: the cents off. */
  amountCents?: number
  /** With `percent`: the percentage off. */
  pct?: number
}

/** Shipping the business prices by hand. */
export interface QuoteShipping {
  amountCents: number
}

/** Why a quote carries no tax. */
export type QuoteNoTaxReason =
  | 'not-collected'
  | 'prices-include-tax'
  | 'no-rate'
  | 'undecided'

/** Where a quote's tax comes from. */
export type QuoteTaxKind = 'rate' | 'service' | 'at-payment' | 'none'

/**
 * How a quote's tax was worked out, stored beside the figure so the quote can
 * say it: one of the store's own rates (`rate`, with `pct` and its `label`),
 * its connected tax service's answer (`service`, with `taxCents` and
 * `providerLabel`), Stripe Tax at payment (`at-payment`), or no tax and why
 * (`none`, with `reason`). One flat shape, so the apps can read it as is.
 */
export interface QuoteTaxBasis {
  kind: QuoteTaxKind
  pct?: number
  label?: string
  taxCents?: number
  providerLabel?: string
  reason?: QuoteNoTaxReason
}

/** A proof attached to one revision of a quote: what names it, and the revision it is for. */
export interface QuoteProofRef {
  id: string
  revision: number
}

/**
 * A proof the business attached to a revision (AGL-4096): an image or a
 * design file in the site's private storage, under the quote.
 */
export interface QuoteProof extends QuoteProofRef {
  name: string
  contentType: string
  size: number
  /** The private Storage object. Never sent to the customer. */
  path: string
  addedAtMs: number
  /** Who attached it: an email, else a uid. */
  addedBy: string
}

/** A file the customer sent with a response. */
export interface QuoteResponseFile {
  id: string
  name: string
  contentType: string
  size: number
  /** The private Storage object. Never sent to the customer. */
  path: string
}

/**
 * The customer's answer to a revision's proofs (AGL-4096): approved under a
 * typed name, or changes asked for in a comment, with artwork if they had
 * some. The address and browser are kept as the record of who answered.
 */
export interface QuoteCustomerResponse {
  action: 'approve' | 'changes'
  revision: number
  atMs: number
  /** With `approve`: the name they typed. */
  name?: string
  /** With `changes`: what to change. */
  comment?: string
  /** With `changes`: files they sent. */
  files?: QuoteResponseFile[]
  ip: string | null
  userAgent: string | null
}

/** The record of a revision's approval. */
export interface QuoteApproval {
  revision: number
  name: string
  atMs: number
  ip: string | null
  userAgent: string | null
}

/**
 * A payment that reached a quote it could not pay: one made through a pay
 * link the business replaced or for a price it has since changed
 * (`superseded`), or one made after the quote was already paid
 * (`already-paid`). The money is in Stripe and the quote records no sale for
 * it; the business refunds it or reconciles it by hand.
 */
export interface QuoteUnmatchedPayment {
  sessionId: string
  paymentIntentId: string | null
  amountCents: number
  atMs: number
  reason: 'superseded' | 'already-paid'
}

/**
 * The conversation the quote's emails keep in the customer's mailbox
 * (AGL-4097): the latest message's `Message-ID`, every id in the
 * conversation oldest first, and the subject it runs under. The shape of
 * `EmailThread` (`@aglyn/shared-util-email`), spelled out so the model needs
 * no email library. Started by the first email about the quote (a request's
 * confirmation, or the quote itself); every later one replies into it.
 */
export interface QuoteEmailThread {
  messageId: string
  references: string[]
  subject: string
}

/** One time the quote was emailed to the customer (AGL-4097). */
export interface QuoteSendRecord {
  /** The revision the email carried. */
  revision: number
  to: string
  subject: string
  atMs: number
  /** Who sent it: an email, else a uid. */
  by: string
  /** The `Message-ID` the email was sent with. */
  messageId: string
  /** The mail provider's own id for the message, when it answered one. */
  providerId: string | null
  /** The pay link version the email carried. */
  linkVersion: number
}

/** One shipping rate a draft order offered (AGL-4099), as checkout's resolved rates name it. */
export interface OrderDraftShippingRate {
  rateId: string
  name: string
  amountCents: number
}

/** The shipping a draft order offered when it was made (AGL-4099); see `HostOrder.draftShipping`. */
export interface OrderDraftShipping {
  /** Where its rates ship; empty when it offers none. */
  countries: string[]
  /** The rates the buyer picks from at payment; empty when it ships nothing. */
  options: OrderDraftShippingRate[]
}

/** The lasting pay link of an order that is not a quote (AGL-4099); see `HostOrder.payLink`. */
export interface OrderPayLink {
  /** The link's version, absent reading as 1. */
  version?: number
  /** Payments through the link the order could not take, as a quote records them. */
  unmatchedPayments?: QuoteUnmatchedPayment[]
}

/** One time an order's (or a quote's) invoice was emailed to the customer (AGL-4099). */
export interface OrderInvoiceSendRecord {
  to: string
  subject: string
  atMs: number
  /** Who sent it: an email, else a uid. */
  by: string
  /** The `Message-ID` the email was sent with. */
  messageId: string
  /** The mail provider's own id for the message, when it answered one. */
  providerId: string | null
  /** The invoice said it was paid (the record), rather than asking for payment. */
  paid: boolean
  /** The pay link version an unpaid invoice carried; null on a paid one. */
  linkVersion: number | null
  /** The total the invoice showed. */
  totalCents: number
}

/** What only a quote has, on its order document. */
export interface OrderQuote {
  stage: QuoteStage
  /** Which version of the quote this is; versions are what proofs and approvals name. */
  revision: number
  customer: QuoteCustomer
  billTo?: OrderAddress | null
  shipTo?: OrderAddress | null
  notes?: string
  terms?: string
  discount?: QuoteDiscount | null
  shipping?: QuoteShipping | null
  tax: QuoteTaxBasis
  /** The customer approves the current revision's proof before they can pay. Absent reads as off. */
  requireProofApproval?: boolean
  /** The current revision's proofs; earlier revisions keep theirs in `revisions/{n}`. */
  proofs?: QuoteProof[]
  /** The customer's answers to the current revision, oldest first; the last one counts. */
  responses?: QuoteCustomerResponse[]
  /** The current revision's approval, while its latest answer is one. */
  approval?: QuoteApproval | null
  /** The revision the customer approved, when they have. */
  approvedRevision?: number | null
  /**
   * Which pay link opens the quote: a link signed for an older version shows
   * the customer that the quote was replaced, and nothing of it. Absent reads
   * as 1. Bumped when the business replaces the link.
   */
  linkVersion?: number
  /** The conversation its emails keep in the customer's mailbox (AGL-4097). */
  emailThread?: QuoteEmailThread | null
  /** Every time it was emailed to the customer, oldest first (AGL-4097). */
  sends?: QuoteSendRecord[]
  /**
   * The request it was started from (AGL-4098): a "Request a quote" form's
   * submission, by id. Its files are listed on the quote as the customer's
   * ({@link requestFiles}), and its confirmation's conversation is the
   * quote's {@link emailThread} until the quote is first sent.
   */
  request?: QuoteRequestRef | null
  /** The request's files, where the request keeps them; downloaded through the quote's own route. */
  requestFiles?: QuoteResponseFile[]
  /** When the customer paid it. */
  paidAtMs?: number
  /** Payments the quote could not take; see {@link QuoteUnmatchedPayment}. */
  unmatchedPayments?: QuoteUnmatchedPayment[]
  createdAtMs: number
  updatedAtMs: number
  /** Who created and last changed it: an email, else a uid. */
  createdBy: string
  updatedBy: string
}

/** The store-wide quote defaults, at `hosts/{hostId}/settings/store` under `quotes`. */
export interface QuoteStoreSettings {
  /** What `requireProofApproval` a new quote starts with. Absent reads as off. */
  requireProofApproval?: boolean
}

/** Whether new quotes start out asking the customer to approve the proof first. */
export function quoteRequiresProofApprovalByDefault(
  settings: QuoteStoreSettings | null | undefined,
): boolean {
  return settings?.requireProofApproval === true
}

/**
 * Whether paying waits on the customer approving the proof: the quote asks for
 * approval, its current revision has a proof, and that revision is not the
 * one the customer approved. A revision with no proof never holds a payment.
 */
export function quotePaymentBlockedByApproval(
  quote:
    | (Pick<OrderQuote, 'requireProofApproval' | 'revision' | 'approvedRevision'> & {
        proofs?: readonly QuoteProofRef[]
      })
    | null
    | undefined,
): boolean {
  if (!quote || quote.requireProofApproval !== true) return false
  const revision = Number(quote.revision ?? 1)
  const proofed = (quote.proofs ?? []).some((proof) => Number(proof?.revision) === revision)
  if (!proofed) return false
  return Number(quote.approvedRevision) !== revision
}

/** Whether an order document is a quote, paid or not. */
export function isQuote(order: Pick<Partial<HostOrder>, 'channel'> | null | undefined): boolean {
  return order?.channel === 'quote'
}

/** Whether an order document is a quote nobody has paid yet, which no order list counts. */
export function isUnpaidQuote(
  order: { channel?: unknown; status?: unknown } | null | undefined,
): boolean {
  return order?.channel === 'quote' && order?.status === 'pending'
}

/** `Quote #1042`; an order number until it is paid. */
export function formatQuoteNumber(order: Pick<HostOrder, 'number'>, docId?: string): string {
  if (order.number != null) return `Quote #${order.number}`
  return docId ? `Quote #${docId.slice(-6).toUpperCase()}` : 'Quote'
}

/** A quote's status as its list shows it: its stage until it is paid. */
export function quoteDisplayStatus(order: {
  status?: OrderStatus | string
  quote?: Pick<OrderQuote, 'stage'> | null
}): { key: QuoteStage | 'paid' | 'cancelled' | 'refunded'; label: string } {
  if (order.status === 'cancelled') return { key: 'cancelled', label: 'Canceled' }
  if (order.status === 'refunded') return { key: 'refunded', label: 'Refunded' }
  if (order.status && order.status !== 'pending') return { key: 'paid', label: 'Paid' }
  const stage = (order.quote?.stage ?? 'draft') as QuoteStage
  return { key: stage, label: QUOTE_STAGE_LABELS[stage] ?? QUOTE_STAGE_LABELS.draft }
}

/** Chip colors for {@link quoteDisplayStatus}, as the orders list colors its statuses. */
export const QUOTE_STATUS_COLOR: Record<
  ReturnType<typeof quoteDisplayStatus>['key'],
  'default' | 'success' | 'info' | 'warning' | 'error'
> = {
  draft: 'default',
  sent: 'info',
  changes_requested: 'warning',
  approved: 'info',
  paid: 'success',
  cancelled: 'default',
  refunded: 'error',
}

/*==========================================
 * TOTALS
 *=========================================*/

/** A line as the totals read it. */
export type QuoteTotalsLine = Pick<OrderLineItem, 'unitAmountCents' | 'quantity'> & {
  included?: boolean
  taxExempt?: boolean
}

export interface QuoteTotalsInput {
  lines: readonly QuoteTotalsLine[]
  discount?: QuoteDiscount | null
  shippingCents?: number
  tax: QuoteTaxBasis
}

/** A quote's totals: the order's, plus what the tax was computed on. */
export interface QuoteTotals extends OrderTotals {
  /** The taxable lines after their share of the discount. */
  taxableCents: number
  /** Stripe Tax works the tax out when the customer pays; `taxCents` is 0 until then. */
  taxAtPayment: boolean
}

const whole = (value: unknown): number => {
  const number = Math.round(Number(value))
  return Number.isFinite(number) && number > 0 ? number : 0
}

/** One line's charge: nothing for an included line. */
export function quoteLineCents(line: QuoteTotalsLine): number {
  if (line.included) return 0
  return whole(line.unitAmountCents) * whole(line.quantity)
}

/** The discount in cents on `itemsCents`, never more than it. */
export function quoteDiscountCents(
  itemsCents: number,
  discount: QuoteDiscount | null | undefined,
): number {
  const items = whole(itemsCents)
  if (!discount) return 0
  if (discount.kind === 'amount') return Math.min(items, whole(discount.amountCents))
  if (discount.kind !== 'percent') return 0
  const pct = Math.min(100, Math.max(0, Number(discount.pct) || 0))
  return Math.min(items, Math.round((items * pct) / 100))
}

/**
 * Each line's charge, its share of the discount (in proportion to the
 * charges, as a checkout spreads a coupon) and what is left: the amounts a tax
 * service is asked about, line by line.
 */
export function quoteLineAmounts(
  lines: readonly QuoteTotalsLine[],
  discount: QuoteDiscount | null | undefined,
): { grossCents: number[]; discountCents: number[]; netCents: number[]; itemsCents: number; totalDiscountCents: number } {
  const grossCents = lines.map(quoteLineCents)
  const itemsCents = grossCents.reduce((sum, cents) => sum + cents, 0)
  const totalDiscountCents = quoteDiscountCents(itemsCents, discount)
  const discountCents = allocateCentsByWeight(totalDiscountCents, grossCents)
  return {
    grossCents,
    discountCents,
    netCents: grossCents.map((cents, index) => cents - discountCents[index]),
    itemsCents,
    totalDiscountCents,
  }
}

/**
 * A quote's totals. The discount comes off before tax; a store rate taxes the
 * taxable lines (not shipping, as a draft order's rate does); a tax service's
 * answer is taken as given; Stripe Tax and no-tax add nothing now.
 */
export function computeQuoteTotals(input: QuoteTotalsInput): QuoteTotals {
  const amounts = quoteLineAmounts(input.lines, input.discount)
  const taxableCents = amounts.netCents.reduce(
    (sum, cents, index) => sum + (input.lines[index]?.taxExempt ? 0 : cents),
    0,
  )
  const shippingCents = whole(input.shippingCents)
  const tax = input.tax
  const taxCents =
    tax.kind === 'rate'
      ? computeTaxCents(taxableCents, Number(tax.pct) || 0)
      : tax.kind === 'service'
        ? whole(tax.taxCents)
        : 0
  return {
    itemsCents: amounts.itemsCents,
    discountCents: amounts.totalDiscountCents,
    shippingCents,
    taxCents,
    // The platform fee is set when a payment is created, from what it charges.
    feeCents: 0,
    totalCents: amounts.itemsCents - amounts.totalDiscountCents + shippingCents + taxCents,
    taxableCents,
    taxAtPayment: tax.kind === 'at-payment',
  }
}

/** The order totals a quote document stores. */
export function quoteOrderTotals(totals: QuoteTotals): OrderTotals {
  return {
    itemsCents: totals.itemsCents,
    discountCents: totals.discountCents,
    shippingCents: totals.shippingCents,
    taxCents: totals.taxCents,
    feeCents: totals.feeCents,
    totalCents: totals.totalCents,
  }
}

/*==========================================
 * TAX
 *=========================================*/

/**
 * The tax basis the store's own settings give a quote, before any tax service
 * is asked: Stripe Tax at payment, no tax (and why), or the store's rate for
 * where the quote ships — its ship-to when it has a country, else the store's
 * own address, as the storefront taxes a sale it cannot see the destination of.
 */
export function quoteTaxBasisFromSettings(
  settings: TaxSettings | null | undefined,
  shipTo: Pick<OrderAddress, 'country' | 'state'> | null | undefined,
): QuoteTaxBasis {
  const decision = storefrontTaxDecision({ settings })
  if (decision.kind === 'undecided') return { kind: 'none', reason: 'undecided' }
  if (decision.kind === 'stripe-automatic') return { kind: 'at-payment' }
  if (decision.kind !== 'manual') return { kind: 'none', reason: 'not-collected' }
  if (settings?.pricesIncludeTax) return { kind: 'none', reason: 'prices-include-tax' }
  const address = String(shipTo?.country ?? '').trim()
    ? { country: shipTo?.country, state: shipTo?.state }
    : (settings?.origin ?? {})
  const rate = resolveTaxRate(settings ?? undefined, address)
  if (!rate || !(Number(rate.pct) > 0)) return { kind: 'none', reason: 'no-rate' }
  return { kind: 'rate', pct: Number(rate.pct), ...(rate.label ? { label: rate.label } : {}) }
}

/** The tax line's label on a quote. */
export function describeQuoteTax(basis: QuoteTaxBasis | null | undefined): string {
  if (!basis) return 'Tax'
  switch (basis.kind) {
    case 'rate':
      return basis.label ? `${basis.label} (${basis.pct ?? 0}%)` : `Tax (${basis.pct ?? 0}%)`
    case 'service':
      return basis.providerLabel ? `Tax (${basis.providerLabel})` : 'Tax'
    case 'at-payment':
      return 'Tax is added at payment'
    case 'none':
      return basis.reason === 'prices-include-tax'
        ? 'Prices include tax'
        : basis.reason === 'no-rate'
          ? 'No tax rate for this address'
          : basis.reason === 'undecided'
            ? 'Sales tax is not set up'
            : 'No sales tax'
    default:
      return 'Tax'
  }
}

/** The order's `taxMode` for a quote's basis; absent while nobody has decided. */
export function quoteTaxMode(basis: QuoteTaxBasis, taxCents: number): StorefrontTaxMode | undefined {
  if (basis.kind === 'at-payment') return 'stripe-automatic'
  if (basis.kind === 'none' && basis.reason === 'undecided') return undefined
  return taxCents > 0 ? 'manual' : 'none'
}

/*==========================================
 * WHAT THE CONSOLE SENDS
 *=========================================*/

export const QUOTE_MAX_LINES = 100
export const QUOTE_MAX_QUANTITY = 9_999
/** $1,000,000 a unit: the most a typed line may cost. */
export const QUOTE_MAX_UNIT_CENTS = 100_000_000
export const QUOTE_MAX_TEXT = 5_000
const SHORT_TEXT = 200

/** A product line as the console asks for it: what it is, never what it costs. */
export interface QuoteCatalogLineRequest {
  kind: 'catalog'
  productId: string
  variantId?: string
  quantity: number
  modifiers?: ModifierSelection[]
  included?: boolean
  description?: string
}

/** A line typed on the quote, which no product stands behind. */
export interface QuoteCustomLineRequest {
  kind: 'custom'
  name: string
  description?: string
  sku?: string
  unitAmountCents: number
  quantity: number
  /** Whether it is something to ship (else a service, which never ships). */
  ships?: boolean
  included?: boolean
}

export type QuoteLineRequest = QuoteCatalogLineRequest | QuoteCustomLineRequest

/** Everything a business edits on a quote. */
export interface QuoteInput {
  lines: QuoteLineRequest[]
  customer: QuoteCustomer
  billTo: OrderAddress | null
  shipTo: OrderAddress | null
  notes: string
  terms: string
  discount: QuoteDiscount | null
  shipping: QuoteShipping | null
  /** Absent: the store's default (on create) or unchanged (on update). */
  requireProofApproval?: boolean
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const DOC_ID = /^(?!__.*__$)[^/]{1,200}$/

const clean = (value: unknown, max = SHORT_TEXT): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : ''

const intIn = (value: unknown, min: number, max: number): number | null => {
  const number = Number(value)
  return Number.isInteger(number) && number >= min && number <= max ? number : null
}

function parseAddress(raw: unknown): OrderAddress | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Record<string, unknown>
  const address: OrderAddress = {}
  for (const key of ['name', 'line1', 'line2', 'city', 'state', 'postalCode', 'phone'] as const) {
    const value = clean(source[key])
    if (value) address[key] = value
  }
  const country = clean(source['country'], 2).toUpperCase()
  if (/^[A-Z]{2}$/.test(country)) address.country = country
  return Object.keys(address).length ? address : null
}

function parseLine(raw: unknown, index: number): QuoteLineRequest | string {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const at = `Line ${index + 1}`
  const quantity = intIn(source['quantity'], 1, QUOTE_MAX_QUANTITY)
  if (quantity === null) return `${at}: enter a quantity from 1 to ${QUOTE_MAX_QUANTITY.toLocaleString('en-US')}.`
  const included = source['included'] === true
  const description = clean(source['description'], QUOTE_MAX_TEXT)
  if (source['kind'] === 'catalog') {
    const productId = clean(source['productId'])
    if (!DOC_ID.test(productId)) return `${at}: choose a product.`
    const variantId = clean(source['variantId'])
    const modifiers = Array.isArray(source['modifiers'])
      ? (source['modifiers'] as unknown[]).slice(0, 200).map((entry) => {
          const pick = (entry ?? {}) as Record<string, unknown>
          return { groupId: clean(pick['groupId']), optionId: clean(pick['optionId']) }
        })
      : []
    return {
      kind: 'catalog',
      productId,
      ...(variantId ? { variantId } : {}),
      quantity,
      ...(modifiers.length ? { modifiers } : {}),
      ...(included ? { included } : {}),
      ...(description ? { description } : {}),
    }
  }
  if (source['kind'] === 'custom') {
    const name = clean(source['name'])
    if (!name) return `${at}: name the item.`
    const unitAmountCents = included ? 0 : intIn(source['unitAmountCents'], 0, QUOTE_MAX_UNIT_CENTS)
    if (unitAmountCents === null) return `${at}: enter a price from $0 to $1,000,000.`
    const sku = clean(source['sku'], 100)
    return {
      kind: 'custom',
      name,
      ...(description ? { description } : {}),
      ...(sku ? { sku } : {}),
      unitAmountCents,
      quantity,
      ships: source['ships'] !== false,
      ...(included ? { included } : {}),
    }
  }
  return `${at}: add a product or type an item.`
}

/**
 * The console's quote, checked and trimmed, or what to fix. Prices on product
 * lines are not read from here: the server prices them from the product.
 */
export function parseQuoteInput(raw: unknown): { ok: true; input: QuoteInput } | { ok: false; error: string } {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const rawLines = Array.isArray(source['lines']) ? (source['lines'] as unknown[]) : []
  if (rawLines.length === 0) return { ok: false, error: 'Add at least one line to the quote.' }
  if (rawLines.length > QUOTE_MAX_LINES) {
    return { ok: false, error: `A quote holds up to ${QUOTE_MAX_LINES} lines.` }
  }
  const lines: QuoteLineRequest[] = []
  for (const [index, entry] of rawLines.entries()) {
    const line = parseLine(entry, index)
    if (typeof line === 'string') return { ok: false, error: line }
    lines.push(line)
  }

  const customerSource = (source['customer'] && typeof source['customer'] === 'object'
    ? source['customer']
    : {}) as Record<string, unknown>
  const email = clean(customerSource['email'])
  if (email && !EMAIL.test(email)) return { ok: false, error: 'Enter a valid email for the customer.' }
  const recordSource = (customerSource['record'] ?? null) as Record<string, unknown> | null
  const recordKind = clean(recordSource?.['kind'], 40)
  const recordId = clean(recordSource?.['id'])
  const customer: QuoteCustomer = {
    ...(recordKind && DOC_ID.test(recordId) ? { record: { kind: recordKind, id: recordId } } : {}),
    ...(clean(customerSource['name']) ? { name: clean(customerSource['name']) } : {}),
    ...(clean(customerSource['company']) ? { company: clean(customerSource['company']) } : {}),
    ...(email ? { email, emailLower: email.toLowerCase() } : {}),
    ...(clean(customerSource['phone'], 40) ? { phone: clean(customerSource['phone'], 40) } : {}),
  }

  let discount: QuoteDiscount | null = null
  const discountSource = (source['discount'] ?? null) as Record<string, unknown> | null
  if (discountSource?.['kind'] === 'amount') {
    const amountCents = intIn(discountSource['amountCents'], 0, QUOTE_MAX_UNIT_CENTS)
    if (amountCents === null) return { ok: false, error: 'Enter a discount from $0 to $1,000,000.' }
    if (amountCents > 0) discount = { kind: 'amount', amountCents }
  } else if (discountSource?.['kind'] === 'percent') {
    const pct = Number(discountSource['pct'])
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      return { ok: false, error: 'Enter a discount from 0% to 100%.' }
    }
    if (pct > 0) discount = { kind: 'percent', pct: Math.round(pct * 100) / 100 }
  }

  let shipping: QuoteShipping | null = null
  const shippingSource = (source['shipping'] ?? null) as Record<string, unknown> | null
  if (shippingSource) {
    const amountCents = intIn(shippingSource['amountCents'], 0, QUOTE_MAX_UNIT_CENTS)
    if (amountCents === null) return { ok: false, error: 'Enter shipping from $0 to $1,000,000.' }
    shipping = { amountCents }
  }

  return {
    ok: true,
    input: {
      lines,
      customer,
      billTo: parseAddress(source['billTo']),
      shipTo: parseAddress(source['shipTo']),
      notes: clean(source['notes'], QUOTE_MAX_TEXT),
      terms: clean(source['terms'], QUOTE_MAX_TEXT),
      discount,
      shipping,
      ...(typeof source['requireProofApproval'] === 'boolean'
        ? { requireProofApproval: source['requireProofApproval'] }
        : {}),
    },
  }
}

/** A priced quote line, and whether its product is tax-exempt. */
export type PricedQuoteLine = OrderLineItem & { taxExempt?: boolean }

/** The variant's label as order lines print it: its option values, or nothing for a default. */
function variantOptionsLabel(options: Record<string, string> | undefined): string | undefined {
  return options && Object.keys(options).length ? Object.values(options).join(' / ') : undefined
}

/**
 * A product line priced from the PRODUCT: its variant's price plus the chosen
 * add-ons, as the register prices one. An included line keeps what it is and
 * charges nothing.
 */
export function priceQuoteCatalogLine(
  rawProduct: Partial<HostProduct> | null | undefined,
  request: QuoteCatalogLineRequest,
): { ok: true; line: PricedQuoteLine } | { ok: false; error: string } {
  if (!rawProduct || rawProduct.deletedAt) {
    return { ok: false, error: 'A product on this quote no longer exists. Remove it and add it again.' }
  }
  const product = liftLegacyProduct(rawProduct)
  const variant = request.variantId
    ? product.variants.find((entry) => entry.id === request.variantId)
    : product.variants[0]
  if (!variant) return { ok: false, error: `Choose an option of ${product.name} that still exists.` }
  if (!request.included && !variantHasPrice(variant)) {
    return { ok: false, error: `Set a price for ${product.name} before quoting it.` }
  }
  const chosen = resolveLineModifiers(product, request.modifiers, variant.id)
  if (!chosen.ok) return { ok: false, error: chosen.error ?? `Check the choices on ${product.name}.` }
  const variantLabel = lineLabelWithModifiers(variantOptionsLabel(variant.options), chosen.modifiers)
  return {
    ok: true,
    line: {
      productId: request.productId,
      ...(variant.id !== 'default' ? { variantId: variant.id } : {}),
      name: product.name,
      ...(variantLabel ? { variantLabel } : {}),
      ...(variant.sku ? { sku: variant.sku } : {}),
      productType: (product.type ?? 'physical') as ProductType,
      quantity: request.quantity,
      unitAmountCents: request.included
        ? 0
        : Math.round(Number(variant.priceUsd) * 100) + chosen.extraCents,
      ...(chosen.modifiers.length ? { modifiers: chosen.modifiers } : {}),
      ...(request.included ? { included: true } : {}),
      ...(request.description ? { description: request.description } : {}),
      ...(product.taxExempt ? { taxExempt: true } : {}),
    },
  }
}

/** A typed line: no product, so nothing reads stock, a supplier or a download for it. */
export function priceQuoteCustomLine(request: QuoteCustomLineRequest): PricedQuoteLine {
  return {
    productId: '',
    custom: true,
    name: request.name,
    ...(request.sku ? { sku: request.sku } : {}),
    productType: request.ships === false ? 'service' : 'physical',
    quantity: request.quantity,
    unitAmountCents: request.included ? 0 : request.unitAmountCents,
    ...(request.included ? { included: true } : {}),
    ...(request.description ? { description: request.description } : {}),
  }
}

/** The request a stored line is edited as: what the console sends back on a save. */
export function quoteLineRequestFromLine(line: OrderLineItem): QuoteLineRequest {
  if (line.custom || !line.productId) {
    return {
      kind: 'custom',
      name: line.name,
      ...(line.description ? { description: line.description } : {}),
      ...(line.sku ? { sku: line.sku } : {}),
      unitAmountCents: line.unitAmountCents,
      quantity: line.quantity,
      ships: line.productType !== 'service' && line.productType !== 'digital',
      ...(line.included ? { included: true } : {}),
    }
  }
  return {
    kind: 'catalog',
    productId: line.productId,
    ...(line.variantId ? { variantId: line.variantId } : {}),
    quantity: line.quantity,
    ...(line.modifiers?.length
      ? { modifiers: line.modifiers.map(({ groupId, optionId }) => ({ groupId, optionId })) }
      : {}),
    ...(line.included ? { included: true } : {}),
    ...(line.description ? { description: line.description } : {}),
  }
}
