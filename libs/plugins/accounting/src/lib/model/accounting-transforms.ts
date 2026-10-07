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

/**
 * FROM AN ORDER TO A LEDGER DOCUMENT (AGL-3614).
 *
 * Pure functions from the snapshots in `accounting-sources.ts` and a
 * mapping to provider-neutral documents, which each adapter then spells in
 * its own API's shape. Nothing here knows QuickBooks or Xero, so the money
 * is proven once.
 *
 * ## The books every document keeps balanced
 *
 * A sale is paid into the CLEARING account — the "Stripe clearing" bank
 * account — for its full total. Aglyn's platform fee leaves clearing as an
 * expense. A refund leaves clearing. A payout moves what is left from
 * clearing to the bank. Followed through, clearing returns to zero with every
 * payout, which is how a bookkeeper proves nothing was missed.
 *
 * ## Exact to the cent
 *
 * A document's lines always sum to the order's own total. Line amounts are
 * quantity × unit price; when the order's total differs from what the lines
 * add up to by a rounding amount (at most a cent a line, or two), the
 * difference is posted as a "Rounding" line rather than silently moving a
 * line's price. A larger difference is not rounding: it refuses with
 * `totals-mismatch`, and the sync item asks a person.
 */

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import {
  allocateCents,
  centsToDecimal,
  dateInZone,
  formatMoney,
  normalizeCurrency,
  toCents,
} from './accounting-money'
import type {
  AccountingOrderSnapshot,
  AccountingPayoutSnapshot,
  AccountingRefundSnapshot,
} from './accounting-sources'
import type { AccountingAccountRole, AccountingMapping } from './accounting.types'

export type AccountingTransformErrorCode = 'totals-mismatch' | 'unmapped' | 'invalid'

/** A snapshot that cannot become a document without a person. Never retried. */
export class AccountingTransformError extends Error {
  readonly code: AccountingTransformErrorCode

  constructor(code: AccountingTransformErrorCode, message: string) {
    super(message)
    this.name = 'AccountingTransformError'
    this.code = code
  }
}

export type AccountingTaxTreatment = 'exclusive' | 'inclusive' | 'none'

export interface AccountingDocLine {
  kind: 'item' | 'shipping' | 'discount' | 'adjustment' | 'refund'
  description: string
  quantity: number
  /** Per unit, in the document's tax treatment (gross when tax-inclusive). */
  unitAmountCents: number
  /** quantity × unit; negative for a discount. */
  amountCents: number
  accountId: string
  taxCodeId: string | null
  /** This line's share of the document's tax. */
  taxCents: number
  sku: string | null
}

export interface AccountingCustomerRef {
  name: string
  email: string | null
}

interface AccountingSalesDocBase {
  externalId: string
  /** `YYYY-MM-DD`. */
  date: string
  /** ISO 4217, upper case. */
  currency: string
  memo: string
  customer: AccountingCustomerRef
  taxTreatment: AccountingTaxTreatment
  taxCodeId: string | null
  lines: AccountingDocLine[]
  taxCents: number
  totalCents: number
  /** The clearing account the money was paid into, or refunded out of. */
  depositAccountId: string
}

export interface AccountingSaleDoc extends AccountingSalesDocBase {
  kind: 'sale'
}

export interface AccountingRefundDoc extends AccountingSalesDocBase {
  kind: 'refund'
  /** The sale it reverses, by its external id. */
  saleExternalId: string
}

/** A fee paid out of clearing, or (`credit`) one given back into it. */
export interface AccountingExpenseDoc {
  kind: 'fee' | 'fee-refund'
  externalId: string
  date: string
  currency: string
  memo: string
  amountCents: number
  expenseAccountId: string
  bankAccountId: string
  credit: boolean
  /** Who was paid: the platform the fee went to. */
  payeeName: string
}

/** Money moved from clearing to the bank. */
export interface AccountingTransferDoc {
  kind: 'payout'
  externalId: string
  date: string
  currency: string
  memo: string
  amountCents: number
  fromAccountId: string
  toAccountId: string
}

export interface AccountingJournalLine {
  accountId: string
  description: string
  debitCents: number
  creditCents: number
}

/** One day's sales, refunds, tax and fees, in totals. */
export interface AccountingJournalDoc {
  kind: 'summary'
  externalId: string
  date: string
  currency: string
  memo: string
  lines: AccountingJournalLine[]
}

export type AccountingDoc =
  | AccountingSaleDoc
  | AccountingRefundDoc
  | AccountingExpenseDoc
  | AccountingTransferDoc
  | AccountingJournalDoc

/** Who a fee is paid to, in every ledger. */
export const ACCOUNTING_FEE_PAYEE = PLATFORM_BRAND_NAME

/** The customer a sale with no name or address is filed under. */
export const ACCOUNTING_WALK_IN_CUSTOMER = 'Online customer'

/** QuickBooks' DocNumber limit, which every external id fits. */
export const ACCOUNTING_EXTERNAL_ID_MAX = 21

/**
 * Four characters standing for a site, so two sites' order #1042 are two
 * documents in one ledger. FNV-1a, base 36: stable across processes and
 * releases, and free of `node:crypto` so the page can show it too.
 */
export function hostCode(hostId: string): string {
  let hash = 0x811c9dc5
  for (const char of String(hostId ?? '')) {
    hash ^= char.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36).toUpperCase().padStart(4, '0').slice(-4)
}

/** A short, stable code for any id: four base-36 characters. */
export const shortCode = hostCode

/** `K3XQ-1042`: the sale's document number. */
export function orderExternalId(order: Pick<AccountingOrderSnapshot, 'hostId' | 'orderId' | 'number'>): string {
  const number =
    typeof order.number === 'number' && Number.isFinite(order.number) && order.number > 0
      ? String(Math.trunc(order.number))
      : String(order.orderId ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 8)
  return `${hostCode(order.hostId)}-${number}`.slice(0, ACCOUNTING_EXTERNAL_ID_MAX - 6)
}

export const refundExternalId = (refund: AccountingRefundSnapshot) =>
  `${orderExternalId(refund.order)}-R${shortCode(refund.refundId)}`

export const feeExternalId = (order: AccountingOrderSnapshot) => `${orderExternalId(order)}-F`

export const feeRefundExternalId = (refund: AccountingRefundSnapshot) =>
  `${orderExternalId(refund.order)}-FR${shortCode(refund.refundId).slice(-3)}`

export const payoutExternalId = (payout: Pick<AccountingPayoutSnapshot, 'payoutId'>) =>
  `PO-${String(payout.payoutId).replace(/^po_/, '').slice(-12)}`

export const summaryExternalId = (date: string, currency: string) =>
  `AGD-${date.replace(/-/g, '')}-${normalizeCurrency(currency)}`

/** "Order #1042" or "Order a1b2c3d4". */
export function orderLabel(order: Pick<AccountingOrderSnapshot, 'number' | 'orderId'>): string {
  return typeof order.number === 'number' && order.number > 0
    ? `Order #${order.number}`
    : `Order ${String(order.orderId).slice(0, 8)}`
}

/** The account a role posts to; `shippingIncome` falls back to `income`. */
export function accountFor(mapping: AccountingMapping, role: AccountingAccountRole): string {
  const id = mapping.accounts[role] ?? (role === 'shippingIncome' ? mapping.accounts.income : undefined)
  if (!id) {
    throw new AccountingTransformError('unmapped', `Choose the ${ROLE_WORDS[role]} in Accounting settings.`)
  }
  return id
}

const ROLE_WORDS: Readonly<Record<AccountingAccountRole, string>> = {
  income: 'income account',
  shippingIncome: 'shipping income account',
  clearing: 'Stripe clearing account',
  feeExpense: 'fee expense account',
  payoutBank: 'payout bank account',
  taxLiability: 'sales tax liability account',
}

/** The tax code a sale or refund posts under: the order's own key, then the base key. */
export function taxCodeFor(mapping: AccountingMapping, order: AccountingOrderSnapshot): string | null {
  const taxed = toCents(order.totals?.taxCents) > 0
  if (!taxed) return mapping.taxCodes['untaxed'] ?? null
  return (order.taxKey ? mapping.taxCodes[order.taxKey] : undefined) ?? mapping.taxCodes['taxed'] ?? null
}

/** The tax treatment an order's figures are in. */
export function taxTreatmentOf(order: AccountingOrderSnapshot): AccountingTaxTreatment {
  if (toCents(order.totals?.taxCents) <= 0) return 'none'
  return order.taxInclusive ? 'inclusive' : 'exclusive'
}

function customerOf(order: AccountingOrderSnapshot): AccountingCustomerRef {
  const email = typeof order.customerEmail === 'string' && order.customerEmail.includes('@')
    ? order.customerEmail.trim().toLowerCase()
    : null
  const name = typeof order.customerName === 'string' && order.customerName.trim()
    ? order.customerName.trim().slice(0, 100)
    : email ?? ACCOUNTING_WALK_IN_CUSTOMER
  return { name, email }
}

/** The most a total may differ from its lines and still be rounding. */
function roundingTolerance(lineCount: number): number {
  return Math.max(2, lineCount)
}

function assertSnapshot(order: AccountingOrderSnapshot): void {
  if (!order || !order.orderId || !order.hostId || !order.totals) {
    throw new AccountingTransformError('invalid', 'The order this sync item names is incomplete.')
  }
  if (toCents(order.totals.totalCents) < 0) {
    throw new AccountingTransformError('invalid', 'The order total is negative.')
  }
}

/** One order → one sales document, paid in full into clearing. */
export function buildSaleDoc(
  order: AccountingOrderSnapshot,
  mapping: AccountingMapping,
): AccountingSaleDoc {
  assertSnapshot(order)
  const income = accountFor(mapping, 'income')
  const shippingIncome = accountFor(mapping, 'shippingIncome')
  const clearing = accountFor(mapping, 'clearing')
  const treatment = taxTreatmentOf(order)
  const taxCodeId = taxCodeFor(mapping, order)
  const totals = order.totals
  const taxCents = treatment === 'none' ? 0 : toCents(totals.taxCents)
  const totalCents = toCents(totals.totalCents)

  const lines: AccountingDocLine[] = []
  for (const line of order.lines ?? []) {
    const quantity = Math.max(0, Math.round(Number(line?.quantity ?? 0)))
    if (!quantity) continue
    const unit = toCents(line?.unitAmountCents)
    const description = [line?.name, line?.variantLabel].filter((part) => part && String(part).trim()).join(' — ')
    lines.push({
      kind: 'item',
      description: (description || 'Item').slice(0, 4000),
      quantity,
      unitAmountCents: unit,
      amountCents: quantity * unit,
      accountId: income,
      taxCodeId,
      taxCents: 0,
      sku: line?.sku ? String(line.sku) : null,
    })
  }
  const shipping = toCents(totals.shippingCents)
  if (shipping > 0) {
    lines.push({
      kind: 'shipping',
      description: 'Shipping',
      quantity: 1,
      unitAmountCents: shipping,
      amountCents: shipping,
      accountId: shippingIncome,
      taxCodeId,
      taxCents: 0,
      sku: null,
    })
  }
  const discount = toCents(totals.discountCents)
  if (discount > 0) {
    lines.push({
      kind: 'discount',
      description: 'Discount',
      quantity: 1,
      unitAmountCents: -discount,
      amountCents: -discount,
      accountId: income,
      taxCodeId,
      taxCents: 0,
      sku: null,
    })
  }

  const linesSum = lines.reduce((sum, line) => sum + line.amountCents, 0)
  const expected = treatment === 'exclusive' ? linesSum + taxCents : linesSum
  const difference = totalCents - expected
  if (difference !== 0) {
    if (Math.abs(difference) > roundingTolerance(lines.length)) {
      throw new AccountingTransformError(
        'totals-mismatch',
        `${orderLabel(order)}'s lines come to ${formatMoney(expected, order.currency)}, ` +
          `but it was paid ${formatMoney(totalCents, order.currency)}.`,
      )
    }
    lines.push({
      kind: 'adjustment',
      description: 'Rounding',
      quantity: 1,
      unitAmountCents: difference,
      amountCents: difference,
      accountId: income,
      taxCodeId,
      taxCents: 0,
      sku: null,
    })
  }
  if (!lines.length) {
    throw new AccountingTransformError('invalid', `${orderLabel(order)} has no lines to post.`)
  }

  // The tax, spread over the lines that earned it, exact to the cent.
  if (taxCents > 0) {
    const shares = allocateCents(
      taxCents,
      lines.map((line) => (line.kind === 'item' || line.kind === 'shipping' ? line.amountCents : 0)),
    )
    lines.forEach((line, index) => {
      line.taxCents = shares[index]
    })
  }

  return {
    kind: 'sale',
    externalId: orderExternalId(order),
    date: dateInZone(order.paidAtMs, mapping.timeZone),
    currency: normalizeCurrency(order.currency),
    memo: `${orderLabel(order)} — ${PLATFORM_BRAND_NAME} ${order.channel === 'pos' ? 'point of sale' : 'store'}`,
    customer: customerOf(order),
    taxTreatment: treatment,
    taxCodeId,
    lines,
    taxCents,
    totalCents,
    depositAccountId: clearing,
  }
}

/** The tax a refund gives back: the order's tax in proportion, never more than it. */
export function refundTaxCents(order: AccountingOrderSnapshot, amountCents: number): number {
  const tax = taxTreatmentOf(order) === 'none' ? 0 : toCents(order.totals.taxCents)
  const total = toCents(order.totals.totalCents)
  if (tax <= 0 || total <= 0) return 0
  return Math.min(tax, Math.round((tax * amountCents) / total))
}

/**
 * A refund → one refund receipt (QuickBooks) or credit note (Xero), paid out
 * of clearing. One line for the amount, because a refund names an amount and
 * not always the lines it is for; the tax it gives back is the order's tax in
 * the same proportion.
 */
export function buildRefundDoc(
  refund: AccountingRefundSnapshot,
  mapping: AccountingMapping,
): AccountingRefundDoc {
  const order = refund?.order
  assertSnapshot(order)
  const amount = toCents(refund.amountCents)
  if (amount <= 0) throw new AccountingTransformError('invalid', 'The refund amount is not positive.')
  if (amount > toCents(order.totals.totalCents)) {
    throw new AccountingTransformError('invalid', `The refund is more than ${orderLabel(order)} was paid.`)
  }
  const treatment = taxTreatmentOf(order)
  const taxCodeId = taxCodeFor(mapping, order)
  const tax = refundTaxCents(order, amount)
  const lineAmount = treatment === 'exclusive' ? amount - tax : amount
  return {
    kind: 'refund',
    externalId: refundExternalId(refund),
    saleExternalId: orderExternalId(order),
    date: dateInZone(refund.refundedAtMs, mapping.timeZone),
    currency: normalizeCurrency(order.currency),
    memo: `Refund on ${orderLabel(order).toLowerCase()}`,
    customer: customerOf(order),
    taxTreatment: treatment,
    taxCodeId,
    lines: [
      {
        kind: 'refund',
        description: `Refund on ${orderLabel(order).toLowerCase()}`,
        quantity: 1,
        unitAmountCents: lineAmount,
        amountCents: lineAmount,
        accountId: accountFor(mapping, 'income'),
        taxCodeId,
        taxCents: tax,
        sku: null,
      },
    ],
    taxCents: tax,
    totalCents: amount,
    depositAccountId: accountFor(mapping, 'clearing'),
  }
}

/** The platform fee on a sale, paid out of clearing; `null` when there was none. */
export function buildFeeDoc(order: AccountingOrderSnapshot, mapping: AccountingMapping): AccountingExpenseDoc | null {
  assertSnapshot(order)
  const fee = toCents(order.totals.feeCents)
  if (fee <= 0) return null
  return {
    kind: 'fee',
    externalId: feeExternalId(order),
    date: dateInZone(order.paidAtMs, mapping.timeZone),
    currency: normalizeCurrency(order.currency),
    memo: `${PLATFORM_BRAND_NAME} fee on ${orderLabel(order).toLowerCase()}`,
    amountCents: fee,
    expenseAccountId: accountFor(mapping, 'feeExpense'),
    bankAccountId: accountFor(mapping, 'clearing'),
    credit: false,
    payeeName: ACCOUNTING_FEE_PAYEE,
  }
}

/** The fee given back with a refund, into clearing; `null` when none was. */
export function buildFeeRefundDoc(
  refund: AccountingRefundSnapshot,
  mapping: AccountingMapping,
): AccountingExpenseDoc | null {
  const fee = toCents(refund?.feeRefundedCents)
  if (fee <= 0) return null
  assertSnapshot(refund.order)
  return {
    kind: 'fee-refund',
    externalId: feeRefundExternalId(refund),
    date: dateInZone(refund.refundedAtMs, mapping.timeZone),
    currency: normalizeCurrency(refund.order.currency),
    memo: `${PLATFORM_BRAND_NAME} fee returned on ${orderLabel(refund.order).toLowerCase()}`,
    amountCents: fee,
    expenseAccountId: accountFor(mapping, 'feeExpense'),
    bankAccountId: accountFor(mapping, 'clearing'),
    credit: true,
    payeeName: ACCOUNTING_FEE_PAYEE,
  }
}

/** A payout → a transfer from clearing to the bank. */
export function buildPayoutDoc(payout: AccountingPayoutSnapshot, mapping: AccountingMapping): AccountingTransferDoc {
  const amount = toCents(payout?.amountCents)
  if (!payout?.payoutId || amount <= 0) {
    throw new AccountingTransformError('invalid', 'The payout is incomplete or not positive.')
  }
  return {
    kind: 'payout',
    externalId: payoutExternalId(payout),
    date: dateInZone(payout.arrivedAtMs, mapping.timeZone),
    currency: normalizeCurrency(payout.currency),
    memo: `Stripe payout ${payout.payoutId}${payout.statementDescriptor ? ` (${payout.statementDescriptor})` : ''}`,
    amountCents: amount,
    fromAccountId: accountFor(mapping, 'clearing'),
    toAccountId: accountFor(mapping, 'payoutBank'),
  }
}

/** One side of a summary: a role and how much it moves (debit positive, credit negative). */
export interface AccountingPosting {
  role: AccountingAccountRole
  /** Debit positive, credit negative. */
  cents: number
}

/** A sale's postings, for the daily summary. They sum to zero. */
export function salePostings(order: AccountingOrderSnapshot): AccountingPosting[] {
  assertSnapshot(order)
  const treatment = taxTreatmentOf(order)
  const total = toCents(order.totals.totalCents)
  const tax = treatment === 'none' ? 0 : toCents(order.totals.taxCents)
  const shipping = Math.max(0, toCents(order.totals.shippingCents))
  const revenue = total - tax
  let shippingCredit = shipping
  if (treatment === 'inclusive' && shipping > 0) {
    const itemsNet = Math.max(0, toCents(order.totals.itemsCents) - toCents(order.totals.discountCents))
    shippingCredit = shipping - allocateCents(tax, [itemsNet, shipping])[1]
  }
  shippingCredit = Math.max(0, Math.min(shippingCredit, revenue))
  const postings: AccountingPosting[] = [
    { role: 'clearing', cents: total },
    { role: 'income', cents: -(revenue - shippingCredit) },
  ]
  if (shippingCredit) postings.push({ role: 'shippingIncome', cents: -shippingCredit })
  if (tax) postings.push({ role: 'taxLiability', cents: -tax })
  const fee = toCents(order.totals.feeCents)
  if (fee > 0) postings.push({ role: 'feeExpense', cents: fee }, { role: 'clearing', cents: -fee })
  return postings
}

/** A refund's postings, for the daily summary. They sum to zero. */
export function refundPostings(refund: AccountingRefundSnapshot): AccountingPosting[] {
  const order = refund.order
  assertSnapshot(order)
  const amount = toCents(refund.amountCents)
  const tax = refundTaxCents(order, amount)
  const postings: AccountingPosting[] = [
    { role: 'clearing', cents: -amount },
    { role: 'income', cents: amount - tax },
  ]
  if (tax) postings.push({ role: 'taxLiability', cents: tax })
  const fee = toCents(refund.feeRefundedCents)
  if (fee > 0) postings.push({ role: 'clearing', cents: fee }, { role: 'feeExpense', cents: -fee })
  return postings
}

/**
 * A day's postings in one currency → one balanced journal entry. Roles that
 * map to one account are netted onto one line, and a role that nets to zero
 * leaves no line. `null` when the day nets to nothing at all.
 */
export function buildSummaryDoc(
  input: { date: string; currency: string; postings: readonly AccountingPosting[]; orderCount: number },
  mapping: AccountingMapping,
): AccountingJournalDoc | null {
  const byAccount = new Map<string, { cents: number; roles: Set<AccountingAccountRole> }>()
  for (const posting of input.postings) {
    if (!posting.cents) continue
    const accountId = accountFor(mapping, posting.role)
    const entry = byAccount.get(accountId) ?? { cents: 0, roles: new Set<AccountingAccountRole>() }
    entry.cents += posting.cents
    entry.roles.add(posting.role)
    byAccount.set(accountId, entry)
  }
  const lines: AccountingJournalLine[] = []
  for (const [accountId, entry] of byAccount) {
    if (!entry.cents) continue
    lines.push({
      accountId,
      description: [...entry.roles].map((role) => ROLE_WORDS[role]).join(', '),
      debitCents: entry.cents > 0 ? entry.cents : 0,
      creditCents: entry.cents < 0 ? -entry.cents : 0,
    })
  }
  if (!lines.length) return null
  const debits = lines.reduce((sum, line) => sum + line.debitCents, 0)
  const credits = lines.reduce((sum, line) => sum + line.creditCents, 0)
  if (debits !== credits) {
    throw new AccountingTransformError('invalid', `The ${input.date} summary does not balance.`)
  }
  return {
    kind: 'summary',
    externalId: summaryExternalId(input.date, input.currency),
    date: input.date,
    currency: normalizeCurrency(input.currency),
    memo: `${PLATFORM_BRAND_NAME} sales summary for ${input.date}: ${input.orderCount} ${input.orderCount === 1 ? 'order' : 'orders'}`,
    lines,
  }
}

/** A document's amount, for its log row. */
export function docAmountCents(doc: AccountingDoc): number {
  switch (doc.kind) {
    case 'sale':
    case 'refund':
      return doc.totalCents
    case 'fee':
    case 'fee-refund':
    case 'payout':
      return doc.amountCents
    case 'summary':
      return doc.lines.reduce((sum, line) => sum + line.debitCents, 0)
  }
}

/** Decimal amounts, for an adapter: `centsToDecimal` re-exported where the docs are read. */
export { centsToDecimal }
