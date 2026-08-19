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

// READ-ONLY audit of money the BACK BOOK owes, against live Stripe (AGL-2361,
// AGL-2323). Writes NOTHING, to Stripe or to Firestore, and enforces that:
// under an `sk_live` key any non-GET request throws before a socket opens.
//
//   STRIPE_SECRET_KEY=sk_live_… node tools/scripts/audit-money-back-book.mjs [--json]
//
// ⚠️ The localhost/production key IS live (`apps/console/.env.production.local`).
// That is deliberate here — these questions are only meaningful against live —
// but it is why the write guard exists rather than being left to discipline.
//
// TWO INDEPENDENT QUESTIONS, deliberately in one script because both ask "what
// does the back book owe that no product surface will ever show?":
//
//   AGL-2361 — bookings paid BEFORE the AGL-2315 Connect fix (`344a072a0`).
//     The pre-fix path opened a Checkout Session with no `transfer_data`, no
//     `application_fee_amount` and no connected-account read AT ALL, so 100%
//     of a paid booking settled in Aglyn's own platform balance and the
//     merchant was never paid. Nothing in the product surfaces this: the
//     booking document reads `confirmed` and records `paidAmountCents`, which
//     is what the GUEST paid, not what anyone received.
//
//   AGL-2323 — storefront subscriptions sold BEFORE AGL-1751 (`77a88bfe0`).
//     Manual tax was a one-time `line_items[1]` product line, and Stripe bills
//     one-time items on the FIRST invoice only, so cycle 2 onward bills
//     untaxed forever. AGL-1751 fixed new sales by attaching a real Tax Rate
//     to the subscription item; nothing backfills the ones already sold.
//
// WHERE THE VERDICTS LIVE: `lib/money-back-book.mjs`, as pure functions, so
// `npm run test:money-back-book` can drive them RED over the pre-fix and
// post-fix object shapes. A query that can never match anything fails that
// suite instead of reporting a reassuring zero here. Keep it honest before
// trusting a zero from this script.
//
// A ZERO HERE IS NOT A PROOF ON ITS OWN. The stronger check is the balance
// ledger the script also prints: `/v1/balance_transactions` is every movement
// that has ever touched the platform balance, so merchant money cannot hide
// from it even if a metadata filter is wrong. Read the two together.

import {
  classifyBookingSession,
  classifySubscription,
} from './lib/money-back-book.mjs'

const asJson = process.argv.includes('--json')

// Resolved in `main()`, never at import time: the test suite imports the
// classifiers below and must not need a credential (or open a socket) to do it.
let KEY = null
let KEY_PREFIX = null
let IS_LIVE = false
let requestCount = 0

function initKey() {
  KEY = process.env.STRIPE_SECRET_KEY
  if (!KEY) {
    console.error('Missing STRIPE_SECRET_KEY env var')
    process.exit(1)
  }
  KEY_PREFIX = KEY.slice(0, KEY.indexOf('_', 3) + 1)
  IS_LIVE = KEY.startsWith('sk_live')
}

async function stripe(method, path, params) {
  if (IS_LIVE && method !== 'GET') {
    throw new Error(
      `REFUSED: ${method} ${path} attempted with a LIVE key — this audit is read-only`,
    )
  }
  const url = new URL(`https://api.stripe.com${path}`)
  for (const [k, v] of Object.entries(params ?? {})) {
    url.searchParams.append(k, String(v))
  }
  requestCount++
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${KEY}` },
  })
  const json = await res.json()
  if (!res.ok) {
    throw new Error(
      `Stripe ${method} ${path} -> ${res.status}: ${json?.error?.message ?? 'unknown'}`,
    )
  }
  return json
}

async function listAll(path, params = {}) {
  const out = []
  let startingAfter
  for (;;) {
    const page = await stripe('GET', path, {
      limit: 100,
      ...params,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    })
    out.push(...page.data)
    if (!page.has_more || page.data.length === 0) break
    startingAfter = page.data[page.data.length - 1].id
  }
  return out
}

const iso = (unix) => (unix ? new Date(unix * 1000).toISOString() : null)
const money = (cents, cur) =>
  `${((cents ?? 0) / 100).toFixed(2)} ${String(cur ?? 'usd').toUpperCase()}`

async function auditBookings() {
  const sessions = await listAll('/v1/checkout/sessions', {
    'expand[]': 'data.payment_intent',
  })
  const rows = []
  for (const s of sessions) {
    const verdict = classifyBookingSession(s)
    if (!verdict.relevant) continue
    const pi = typeof s.payment_intent === 'object' ? s.payment_intent : null
    rows.push({
      sessionId: s.id,
      created: iso(s.created),
      hostId: s.metadata?.hostId ?? null,
      bookingId: s.metadata?.bookingId ?? null,
      paymentIntentId:
        pi?.id ??
        (typeof s.payment_intent === 'string' ? s.payment_intent : null),
      amountTotal: s.amount_total,
      currency: s.currency,
      paymentStatus: s.payment_status,
      transferDestination: pi?.transfer_data?.destination ?? null,
      applicationFeeAmount: pi?.application_fee_amount ?? null,
      misrouted: verdict.misrouted,
      reason: verdict.reason,
    })
  }
  return { totalSessionsScanned: sessions.length, rows }
}

async function auditSubscriptions() {
  const subs = await listAll('/v1/subscriptions', { status: 'all' })
  const rows = []
  for (const sub of subs) {
    const verdict = classifySubscription(sub)
    if (!verdict.relevant) continue
    const items = sub.items?.data ?? []
    rows.push({
      subscriptionId: sub.id,
      created: iso(sub.created),
      status: sub.status,
      hostId: sub.metadata?.hostId ?? null,
      productId: sub.metadata?.productId ?? null,
      perCycleCents: items.reduce(
        (n, i) => n + (i.price?.unit_amount ?? 0) * (i.quantity ?? 1),
        0,
      ),
      currency: sub.currency,
      interval: items[0]?.price?.recurring?.interval ?? null,
      automaticTax: sub.automatic_tax?.enabled === true,
      untaxed: verdict.untaxed,
      reason: verdict.reason,
    })
  }
  return { totalSubscriptionsScanned: subs.length, rows }
}

async function main() {
  initKey()
  const account = await stripe('GET', '/v1/account')
  const bookings = await auditBookings()
  const subscriptions = await auditSubscriptions()

  // The corroborating ledger: merchant money cannot be in the balance without
  // having entered it here, whatever a metadata filter says.
  const ledger = await listAll('/v1/balance_transactions')
  const transfers = await listAll('/v1/transfers')
  const connected = await listAll('/v1/accounts')
  const balance = await stripe('GET', '/v1/balance')

  const misrouted = bookings.rows.filter((r) => r.misrouted === true)
  const indeterminate = bookings.rows.filter((r) => r.misrouted === null)
  const untaxed = subscriptions.rows.filter((r) => r.untaxed)

  const owedByHost = {}
  for (const r of misrouted) {
    const cur = (owedByHost[r.hostId] ??= {
      bookings: 0,
      grossCents: 0,
      currency: r.currency,
    })
    cur.bookings++
    cur.grossCents += r.amountTotal ?? 0
  }

  const report = {
    keyPrefix: KEY_PREFIX,
    mode: IS_LIVE ? 'LIVE (read-only enforced)' : 'TEST',
    accountId: account.id,
    ranAt: new Date().toISOString(),
    bookings: {
      ...bookings,
      misrouted: misrouted.length,
      indeterminate: indeterminate.length,
      owedByHost,
    },
    subscriptions: { ...subscriptions, untaxed: untaxed.length },
    corroboration: {
      lifetimeBalanceTransactions: ledger.length,
      transfersEver: transfers.length,
      connectedAccounts: connected.length,
      available: balance.available.map((b) => money(b.amount, b.currency)),
      pending: balance.pending.map((b) => money(b.amount, b.currency)),
    },
    stripeRequests: requestCount,
  }

  if (asJson) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(`key prefix : ${report.keyPrefix} (${report.mode})`)
    console.log(`account    : ${report.accountId}`)
    console.log(`ran at     : ${report.ranAt}`)

    console.log(
      `\n=== AGL-2361 — bookings that paid the platform, not the merchant ===`,
    )
    console.log(`checkout sessions scanned : ${bookings.totalSessionsScanned}`)
    console.log(`booking-payment sessions  : ${bookings.rows.length}`)
    console.log(`MISROUTED                 : ${misrouted.length}`)
    console.log(`indeterminate             : ${indeterminate.length}`)
    for (const r of bookings.rows) {
      const tag =
        r.misrouted === true
          ? 'MISROUTED'
          : r.misrouted === null
            ? 'UNKNOWN  '
            : 'ok       '
      console.log(
        `  ${tag} ${r.sessionId} ${r.created} host=${r.hostId} booking=${r.bookingId} ` +
          `${money(r.amountTotal, r.currency)} — ${r.reason}`,
      )
    }
    for (const [host, v] of Object.entries(owedByHost)) {
      console.log(
        `  OWED host=${host} bookings=${v.bookings} gross=${money(v.grossCents, v.currency)}`,
      )
    }

    console.log(`\n=== AGL-2323 — storefront subscriptions billing untaxed ===`)
    console.log(
      `subscriptions scanned      : ${subscriptions.totalSubscriptionsScanned}`,
    )
    console.log(`commerce-subscription rows : ${subscriptions.rows.length}`)
    console.log(`UNTAXED                    : ${untaxed.length}`)
    for (const r of subscriptions.rows) {
      console.log(
        `  ${r.untaxed ? 'UNTAXED' : 'ok     '} ${r.subscriptionId} ${r.created} ` +
          `status=${r.status} host=${r.hostId} ${money(r.perCycleCents, r.currency)}/${r.interval} — ${r.reason}`,
      )
    }

    console.log(`\n=== corroboration (independent of any metadata filter) ===`)
    console.log(`lifetime balance transactions : ${ledger.length}`)
    for (const t of ledger) {
      console.log(
        `  ${iso(t.created)?.slice(0, 10)} ${t.type} ${money(t.amount, t.currency)} net=${money(t.net, t.currency)} ${t.description ?? ''}`,
      )
    }
    console.log(`transfers ever      : ${transfers.length}`)
    console.log(`connected accounts  : ${connected.length}`)
    console.log(
      `balance available   : ${report.corroboration.available.join(', ')}`,
    )
    console.log(`\nstripe requests made: ${requestCount} (all GET)`)
  }
}

if (import.meta.main) {
  await main()
}
