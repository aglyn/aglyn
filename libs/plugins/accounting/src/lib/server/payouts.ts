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
 * PAYOUTS, READ FROM THE MERCHANT'S OWN STRIPE ACCOUNT (AGL-3614).
 *
 * A storefront's sales settle into the merchant's Stripe Connect account,
 * and Stripe pays that balance out to their bank on its schedule. Nothing in
 * Aglyn records a payout that succeeded — the platform's payment provider
 * only writes down the ones that FAILED — so the sync reads them where they
 * are: `GET /v1/payouts` on the connected account, with the platform's key
 * and the `Stripe-Account` header, which is the read Connect gives a
 * platform over the accounts it created.
 *
 * The connected account is the workspace owner's: the storefront onboards
 * Stripe on the owner's profile (`profiles/{ownerUid}.stripeAccountId`), so
 * every workspace one person owns shares one account and one stream of
 * payouts. When more than one of them connects a ledger, which books a
 * payout belongs to is not something the sync can know; each such payout
 * waits in "needs attention" with that said, rather than landing in two sets
 * of books.
 *
 * Stripe's own fees are read with each payout, from the balance transactions
 * it paid out (`GET /v1/balance_transactions?payout=…`). On a sale charged on
 * the seller's own account Stripe takes its card fee from the seller's
 * balance, and the order records only Aglyn's application fee; reading the
 * payout's transactions finds every fee Stripe took, those on no charge
 * (Stripe Tax's own fee, a dispute fee) among them, and posting them with the
 * payout is what brings clearing back to what Stripe still holds.
 */

import { normalizeCurrency, toCents } from '../model/accounting-money'
import type { AccountingPayoutSnapshot } from '../model/accounting-sources'
import { ACCOUNTING_CONNECTIONS_COLLECTION } from '../model/accounting.types'
import { AccountingProviderError, accountingRequest } from './providers/http'

export const STRIPE_API_BASE = 'https://api.stripe.com/v1'

/** The pages one read takes at most: 500 payouts, far more than a day brings. */
const MAX_PAGES = 5

/**
 * The pages one payout's balance transactions are read across at most:
 * 10,000 transactions. A payout with more is refused rather than posted with
 * part of its fees.
 */
export const MAX_BALANCE_TRANSACTION_PAGES = 100

/** Balance transaction types that are themselves a fee Stripe took. */
const STRIPE_FEE_TRANSACTION_TYPES: ReadonlySet<string> = new Set(['stripe_fee', 'stripe_fx_fee', 'tax_fee'])

/** The `fee_details` entry that is Aglyn's application fee, posted with each sale. */
const APPLICATION_FEE_DETAIL = 'application_fee'

/** The workspace's owner and their connected Stripe account, when they have one. */
export async function readConnectedAccount(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
): Promise<{ ownerUid: string; accountId: string } | null> {
  const org = await firestore.collection('orgs').doc(orgId).get()
  const ownerUid = org.exists ? String(org.get('ownerUid') ?? '') : ''
  if (!ownerUid) return null
  const profile = await firestore.collection('profiles').doc(ownerUid).get()
  const accountId = profile.exists ? String(profile.get('stripeAccountId') ?? '') : ''
  return accountId.startsWith('acct_') ? { ownerUid, accountId } : null
}

/**
 * The other workspaces of the same owner that also have a ledger connected,
 * by id. Empty is the ordinary answer.
 */
export async function otherConnectedOrgsOfOwner(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  ownerUid: string,
): Promise<string[]> {
  const owned = await firestore.collection('orgs').where('ownerUid', '==', ownerUid).limit(25).get()
  const others: string[] = []
  for (const doc of owned.docs) {
    if (doc.id === orgId) continue
    const connections = await doc.ref.collection(ACCOUNTING_CONNECTIONS_COLLECTION).limit(1).get()
    if (!connections.empty) others.push(doc.id)
  }
  return others
}

interface StripeBalanceTransaction {
  id?: unknown
  type?: unknown
  amount?: unknown
  fee_details?: unknown
}

/** Stripe's answer to a failed read, for the error's message. */
const describeStripeError = (error: unknown) => (error as { error?: { message?: string } })?.error?.message ?? null

/**
 * Stripe's own fees inside one payout, in cents: positive when Stripe took
 * fees, negative when it gave more back than it took.
 *
 * Every transaction the payout paid out is read. A transaction's
 * `fee_details` name who earned each part of its fee: every part but Aglyn's
 * application fee is Stripe's. A transaction that is itself a fee (a
 * `stripe_fee`, such as Stripe Tax's or a dispute's; an exchange fee; a tax
 * fee) is money out of the balance, so its amount is negative and counts
 * negated. Nothing else counts: a refund keeps Stripe's fee and carries none,
 * and an application fee given back arrives as an `adjustment` the sale's
 * refund already posts.
 *
 * Never a partial total: every page is read, and a failed read, or a payout
 * with more transactions than {@link MAX_BALANCE_TRANSACTION_PAGES} pages
 * hold, throws.
 */
export async function payoutStripeFeeCents(input: {
  stripeKey: string
  accountId: string
  payoutId: string
  fetch?: typeof fetch
}): Promise<number> {
  let total = 0
  let startingAfter: string | null = null
  for (let page = 0; page < MAX_BALANCE_TRANSACTION_PAGES; page += 1) {
    const params = new URLSearchParams({ payout: input.payoutId, limit: '100' })
    if (startingAfter) params.set('starting_after', startingAfter)
    const body = await accountingRequest<{ data?: StripeBalanceTransaction[]; has_more?: boolean }>(
      `${STRIPE_API_BASE}/balance_transactions?${params.toString()}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${input.stripeKey}`, 'Stripe-Account': input.accountId },
      },
      { fetch: input.fetch, describeError: describeStripeError },
    )
    const rows = Array.isArray(body?.data) ? body.data : []
    for (const row of rows) {
      const details = Array.isArray(row.fee_details) ? (row.fee_details as Array<{ type?: unknown; amount?: unknown }>) : []
      for (const detail of details) {
        if (detail?.type === APPLICATION_FEE_DETAIL) continue
        total += Math.round(Number(detail?.amount ?? 0)) || 0
      }
      if (typeof row.type === 'string' && STRIPE_FEE_TRANSACTION_TYPES.has(row.type)) {
        total -= Math.round(Number(row.amount ?? 0)) || 0
      }
    }
    if (!body?.has_more) return total
    const last = rows[rows.length - 1]
    startingAfter = typeof last?.id === 'string' ? last.id : null
    if (!startingAfter) {
      throw new AccountingProviderError(
        'transient',
        `Stripe's list of the transactions in payout ${input.payoutId} could not be paged.`,
      )
    }
  }
  throw new AccountingProviderError(
    'validation',
    `Payout ${input.payoutId} holds more transactions than can be read to total its Stripe fees.`,
  )
}

interface StripePayout {
  id?: unknown
  amount?: unknown
  currency?: unknown
  arrival_date?: unknown
  status?: unknown
  statement_descriptor?: unknown
}

/**
 * Every payout that reached the bank after `sinceMs`, oldest first, each with
 * Stripe's own fees inside it ({@link payoutStripeFeeCents}). Stripe lists
 * newest first; this pages back and reverses. A payout whose fees cannot be
 * read fails the whole read, so none is queued without them.
 */
export async function listPaidPayouts(input: {
  stripeKey: string
  accountId: string
  orgId: string
  sinceMs: number
  fetch?: typeof fetch
}): Promise<AccountingPayoutSnapshot[]> {
  const collected: AccountingPayoutSnapshot[] = []
  let startingAfter: string | null = null
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params = new URLSearchParams({
      status: 'paid',
      limit: '100',
      'arrival_date[gt]': String(Math.floor(input.sinceMs / 1000)),
    })
    if (startingAfter) params.set('starting_after', startingAfter)
    const body = await accountingRequest<{ data?: StripePayout[]; has_more?: boolean }>(
      `${STRIPE_API_BASE}/payouts?${params.toString()}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${input.stripeKey}`, 'Stripe-Account': input.accountId },
      },
      { fetch: input.fetch, describeError: describeStripeError },
    )
    const rows = Array.isArray(body?.data) ? body.data : []
    for (const row of rows) {
      const id = typeof row.id === 'string' ? row.id : ''
      const amount = toCents(row.amount)
      if (!id || amount <= 0 || row.status !== 'paid') continue
      collected.push({
        orgId: input.orgId,
        payoutId: id,
        amountCents: amount,
        currency: normalizeCurrency(row.currency),
        arrivedAtMs: Number(row.arrival_date) * 1000,
        statementDescriptor: typeof row.statement_descriptor === 'string' ? row.statement_descriptor : null,
      })
    }
    if (!body?.has_more || !rows.length) break
    startingAfter = typeof rows[rows.length - 1]?.id === 'string' ? String(rows[rows.length - 1].id) : null
    if (!startingAfter) break
  }
  for (const payout of collected) {
    payout.stripeFeeCents = await payoutStripeFeeCents({
      stripeKey: input.stripeKey,
      accountId: input.accountId,
      payoutId: payout.payoutId,
      fetch: input.fetch,
    })
  }
  return collected.sort((a, b) => a.arrivedAtMs - b.arrivedAtMs)
}

export { AccountingProviderError }
