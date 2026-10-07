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
 */

import { normalizeCurrency, toCents } from '../model/accounting-money'
import type { AccountingPayoutSnapshot } from '../model/accounting-sources'
import { ACCOUNTING_CONNECTIONS_COLLECTION } from '../model/accounting.types'
import { AccountingProviderError, accountingRequest } from './providers/http'

export const STRIPE_API_BASE = 'https://api.stripe.com/v1'

/** The pages one read takes at most: 500 payouts, far more than a day brings. */
const MAX_PAGES = 5

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

interface StripePayout {
  id?: unknown
  amount?: unknown
  currency?: unknown
  arrival_date?: unknown
  status?: unknown
  statement_descriptor?: unknown
}

/**
 * Every payout that reached the bank after `sinceMs`, oldest first.
 * Stripe lists newest first; this pages back and reverses.
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
      {
        fetch: input.fetch,
        describeError: (error) =>
          (error as { error?: { message?: string } })?.error?.message ?? null,
      },
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
  return collected.sort((a, b) => a.arrivedAtMs - b.arrivedAtMs)
}

export { AccountingProviderError }
