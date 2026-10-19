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

// AGL-3965: move every Aglyn AI add-on item still on a per-plan price
// (`aglyn_{plan}_ai_addon[_yearly]`) to the tier with the same price and band
// (`aglyn_ai_{tier}[_yearly]`), so the per-plan prices can be archived.
//
//   STRIPE_SECRET_KEY=sk_… node tools/scripts/migrate-ai-addon-tiers.mjs           # dry run
//   STRIPE_SECRET_KEY=sk_… node tools/scripts/migrate-ai-addon-tiers.mjs --commit  # apply
//
// Optional, with --commit: FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL /
// FIREBASE_PRIVATE_KEY also stamp `orgs/{orgId}.aiTier` right away. Without
// them the billing webhook writes it from the `customer.subscription.updated`
// event each move raises, and the console reads an absent `aiTier` as the
// same tier meanwhile — so the org write is a convenience, never a step.
//
// SAFE BY CONSTRUCTION:
//  - dry run by default; nothing is written without --commit. The dry run
//    makes GET requests only (prices, subscriptions) and counts every item on
//    a legacy price even before the tier prices are minted;
//  - --commit refuses when any tier price is unminted or any legacy price
//    does not charge exactly what its tier charges (amount, currency,
//    interval), and then changes nothing;
//  - the item keeps its id and quantity, and `proration_behavior: none`, so
//    no invoice line is raised — the amount is the same either side;
//  - a subscription a schedule manages is skipped (its future phase would put
//    the legacy price back) and listed for a re-run;
//  - idempotent: a moved item no longer carries a legacy price.
//
// ORDER (the PR's runbook): mint the tier prices, set STRIPE_PRICE_AI_* on
// Vercel, deploy the console that reads them, THEN run this. A console that
// predates AGL-3965 does not recognise a tier price and would mirror the
// add-on as gone on the event each move raises.

import {
  legacyToTierLookupKeys,
  moveParams,
  pairLegacyPrices,
  planAiTierMoves,
  stripeKeyMode,
  summarizeAiTierMoves,
} from './lib/ai-tier-migration.mjs'

const COMMIT = process.argv.includes('--commit')
const SECRET = process.env.STRIPE_SECRET_KEY
if (!SECRET) {
  console.error('Missing STRIPE_SECRET_KEY (sk_test_… or sk_live_…)')
  process.exit(1)
}

async function stripe(path, params) {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: params ? 'POST' : 'GET',
    headers: {
      Authorization: `Bearer ${SECRET}`,
      ...(params && { 'Content-Type': 'application/x-www-form-urlencoded' }),
    },
    body: params ?? undefined,
  })
  const payload = await response.json()
  if (!response.ok) throw new Error(`${path}: ${payload?.error?.message ?? response.status}`)
  return payload
}

/** Every price carrying one of the lookup keys, active or not. */
async function pricesByLookupKey(keys) {
  const out = {}
  // Stripe takes up to 10 lookup keys per call.
  for (let i = 0; i < keys.length; i += 10) {
    const query = keys
      .slice(i, i + 10)
      .map((key) => `lookup_keys[]=${encodeURIComponent(key)}`)
      .join('&')
    const page = await stripe(`prices?${query}&limit=100`)
    for (const price of page.data ?? []) out[price.lookup_key] = price
  }
  return out
}

/** Every subscription on a price, any status, paged. */
async function subscriptionsOnPrice(priceId) {
  const out = []
  let after = null
  for (;;) {
    const page = await stripe(
      `subscriptions?price=${encodeURIComponent(priceId)}&status=all&limit=100` +
        (after ? `&starting_after=${encodeURIComponent(after)}` : ''),
    )
    out.push(...(page.data ?? []))
    if (!page.has_more || !page.data?.length) return out
    after = page.data[page.data.length - 1].id
  }
}

async function orgWriter() {
  const projectId = process.env.FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  if (!projectId || !clientEmail || !privateKey) return null
  const { cert, getApps, initializeApp } = await import('firebase-admin/app')
  const { getFirestore } = await import('firebase-admin/firestore')
  if (!getApps().length) initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) })
  const db = getFirestore(process.env.FIRESTORE_DATABASE_ID)
  return (orgId, tier) => db.collection('orgs').doc(orgId).set({ aiTier: tier }, { merge: true })
}

const keys = legacyToTierLookupKeys()
const prices = await pricesByLookupKey([...new Set(keys.flatMap((key) => [key.from, key.to]))])
console.log(`Stripe mode: ${stripeKeyMode(SECRET)} · ${COMMIT ? 'COMMIT' : 'dry run'}`)

const { pairs, problems, unminted } = pairLegacyPrices(prices)
if (COMMIT && (problems.length || unminted.length)) {
  for (const problem of [...problems, ...unminted]) console.error(`REFUSED  ${problem}`)
  console.error('\nNothing was changed.')
  process.exit(1)
}
// A dry run reports the same faults and still counts what would move.
for (const problem of problems) console.log(`WOULD REFUSE  ${problem}`)
for (const missing of unminted) console.log(`not yet  ${missing}`)

const subscriptions = new Map()
for (const pair of pairs) {
  for (const subscription of await subscriptionsOnPrice(pair.fromPriceId)) {
    subscriptions.set(subscription.id, subscription)
  }
}
const { moves, skipped } = planAiTierMoves([...subscriptions.values()], pairs)

for (const move of moves) {
  console.log(
    `${COMMIT ? 'move' : 'would move'}  ${move.subscriptionId} item ${move.itemId} ` +
      `(org ${move.orgId ?? '?'}): ${move.from} → ${move.to}` +
      (move.toPriceId ? '' : ' (tier price not minted yet)'),
  )
}
for (const skip of skipped) {
  console.log(`skip  ${skip.subscriptionId} (org ${skip.orgId ?? '?'}): ${skip.reason}`)
}

if (COMMIT) {
  const writeOrg = await orgWriter()
  let moved = 0
  for (const move of moves) {
    await stripe(`subscriptions/${encodeURIComponent(move.subscriptionId)}`, moveParams(move))
    if (writeOrg && move.orgId) await writeOrg(move.orgId, move.tier)
    moved += 1
  }
  console.log(
    `\nmoved ${moved}, skipped ${skipped.length}` +
      (writeOrg ? ' · org aiTier written' : ' · org aiTier left to the webhook'),
  )
} else {
  const summary = summarizeAiTierMoves(moves, skipped)
  console.log(
    `\n${summary.toMove} item(s) on ${summary.subscriptions} subscription(s) to move, ` +
      `${summary.skipped} skipped`,
  )
  for (const row of summary.byFrom) console.log(`  ${row.from} → ${row.to}: ${row.items}`)
  for (const [reason, count] of Object.entries(summary.skips)) console.log(`  skipped (${reason}): ${count}`)
  console.log('Dry run: nothing was changed. Re-run with --commit to apply.')
}
