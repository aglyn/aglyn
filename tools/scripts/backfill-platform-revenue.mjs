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

// AGL-2486 — record the paid invoices that settled BEFORE the revenue mirror
// existed, so `/admin/revenue` and the Texas return can see them.
//
// WHY THIS SCRIPT EXISTS. `platformRevenue` is written by the billing webhook
// and that recording only landed with AGL-1811 (`c2e24f4d0`, 2026-08-16).
// Every invoice paid before that deploy was never mirrored, and no query can
// find what was never written — so the revenue page answered a confident
// $0.00 for July 2026, a month in which Aglyn collected $25.00. The row is
// also what the tax return files from, which is why this is worth doing
// properly rather than leaving the page to caveat it.
//
// A WRONG ROW HERE IS WORSE THAN A MISSING ONE. This feeds a tax filing, so
// nothing is reconstructed, inferred or defaulted:
//
//   * Live Stripe is the source of truth, read with GETs ONLY. This script
//     issues no Stripe write of any kind — no create, no update, no refund.
//   * Every stored field is derived by `platformInvoiceRevenue()`, the SAME
//     function the webhook calls, imported from the app rather than copied.
//     A second implementation of the gross/tax/net split is exactly how a
//     backfilled row comes to disagree with a webhook-written one, and the
//     tax split is the half that would be wrong.
//   * `taxCents` comes from the invoice's own `total_taxes[]` breakdown (or
//     the older `total_tax_amounts[]`), never from a rate applied here. If a
//     figure cannot be derived from the invoice, the run STOPS.
//
// WHICH INVOICES. Not a hardcoded list — every PAID invoice on the platform
// account that has no `platformRevenue` row yet. The customer must resolve
// through the `stripeCustomers` index, which is the same test the webhook
// applies and the only thing separating Aglyn's own invoices from a tenant
// storefront's or a marketplace buyer's. An invoice whose customer does not
// resolve is skipped and reported, never guessed at.
//
// HOW IT RUNS, in four phases, because a production write is not a count:
//
//   1. PLAN   — fetches the invoices, resolves each org, decomposes each one
//               and prints the row it intends to write IN FULL: invoice id,
//               org, gross, tax, net, date, currency. Nothing is written.
//   2. GUARD  — refuses the whole run on anything it cannot stand behind: an
//               unresolved org, a missing or unparseable paid date, a
//               negative or non-arithmetic tax split, an invoice that is not
//               actually paid. It ABORTS rather than writing the good subset,
//               because a partial tax base is harder to notice than an empty
//               one.
//   3. APPLY  — writes with `create()`, which FAILS if the document already
//               exists. That is the additive-only guarantee expressed in the
//               database rather than in a comment: this script structurally
//               cannot modify an existing revenue row.
//   4. VERIFY — RE-READS every row from Firestore and prints what is actually
//               stored, separately from the plan. A write that silently did
//               not land is otherwise indistinguishable from one that did.
//               Exits non-zero on any mismatch.
//
// Dry-run by default (phases 1 and 2 only). Pass --commit to apply.
// Idempotent: an invoice that already has a row is skipped in PLAN, so a
// second run writes nothing and reports every candidate as already present.
//
//   node tools/scripts/backfill-platform-revenue.mjs [--commit]

import { existsSync, readFileSync } from 'node:fs'
import { cert, getApps, initializeApp } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { platformInvoiceRevenue } from '../../apps/console/utils/server/platform-revenue.ts'

// Load admin creds from the repo's local env files so this script is
// self-contained. Already-set process.env wins.
function loadLocalEnv() {
  const roots = ['.', 'apps/console', 'cloud']
  const names = [
    '.env',
    '.env.local',
    '.env.development',
    '.env.development.local',
    '.env.production',
    '.env.production.local',
  ]
  const files = roots.flatMap((r) => names.map((n) => `${r}/${n}`))
  for (const file of files) {
    if (!existsSync(file)) continue
    let text
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    for (const line of text.split('\n')) {
      const match = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/)
      if (!match) continue
      const key = match[1]
      if (process.env[key] !== undefined) continue
      let value = match[2].trim()
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1)
      }
      process.env[key] = value
    }
  }
}
loadLocalEnv()

const args = process.argv.slice(2)
const COMMIT = args.includes('--commit')

// MUST match `INTERNAL_TRAFFIC_PARAM` / `INTERNAL_TRAFFIC_VALUE` in
// `libs/aglyn/src/lib/app-utils/internal-traffic.ts`, and the webhook's own
// read of them. An arbitrary metadata value must not read as internal.
const INTERNAL_TRAFFIC_PARAM = 'traffic_type'
const INTERNAL_TRAFFIC_VALUE = 'internal'
// MUST match `STRIPE_CUSTOMER_INDEX_COLLECTION` in
// `libs/aglyn/src/lib/app-utils/org-billing-doc.ts`.
const STRIPE_CUSTOMER_INDEX_COLLECTION = 'stripeCustomers'

// ── Admin init ──────────────────────────────────────────────────────────────
const projectId = process.env.FIREBASE_PROJECT_ID ?? 'aglyn-main'
if (!getApps().length) {
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
  // Application Default Credentials are an accepted fallback here — this is a
  // one-off operator script, not a deployed service.
  if (clientEmail && privateKey) {
    initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) })
  } else {
    initializeApp({ projectId })
  }
}
const firestore = getFirestore(process.env.FIRESTORE_DATABASE_ID)

const STRIPE_KEY = process.env.STRIPE_SECRET_KEY
if (!STRIPE_KEY) {
  console.error('Missing STRIPE_SECRET_KEY env var')
  process.exit(1)
}
const STRIPE_MODE = STRIPE_KEY.startsWith('sk_live') ? 'LIVE' : 'test'

// A TEST-mode key must never source rows written into the PRODUCTION
// database. This repo keeps both keys in local env files and the loader above
// takes whichever it finds first, so the default is genuinely ambiguous —
// the first dry run of this script picked up `sk_test` and listed eleven
// test-mode invoices belonging to nobody. None of them resolved to a
// workspace, so nothing would have been written, but that is the customer
// index doing its job by luck rather than this script being safe by design.
// Test-mode amounts in `platformRevenue` would be fabricated money in a tax
// filing, so the mismatch aborts instead.
const PRODUCTION_PROJECTS = new Set(['aglyn-main'])
if (STRIPE_MODE === 'test' && PRODUCTION_PROJECTS.has(projectId)) {
  console.error(
    `\nRefusing to run: STRIPE_SECRET_KEY is a TEST key but the target is\n` +
      `the production project "${projectId}". Rows derived from test-mode\n` +
      `invoices would be fabricated money in the revenue page and the tax\n` +
      `return.\n\n` +
      `Pass the live key explicitly, e.g.\n` +
      `  STRIPE_SECRET_KEY=$(grep -m1 '^STRIPE_SECRET_KEY=' \\\n` +
      `    apps/console/.env.production.local | cut -d= -f2-) \\\n` +
      `    node tools/scripts/backfill-platform-revenue.mjs\n`,
  )
  process.exit(1)
}

/** Stripe GET. The ONLY verb this script uses — it never writes to Stripe. */
async function stripeGet(path, params = {}) {
  const url = new URL(`https://api.stripe.com/v1/${path}`)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value))
  }
  const response = await fetch(url, {
    method: 'GET',
    headers: { authorization: `Bearer ${STRIPE_KEY}` },
  })
  const body = await response.json()
  if (body?.error) throw new Error(`Stripe: ${body.error.message}`)
  return body
}

const money = (cents) => `$${(Number(cents ?? 0) / 100).toFixed(2)}`

console.log(
  `\nBackfill platformRevenue from paid Stripe invoices (AGL-2486) — ` +
    `project=${projectId} stripe=${STRIPE_MODE} ` +
    `mode=${COMMIT ? 'COMMIT' : 'dry-run'}\n`,
)

/*==========================================
 *
 * MARK - PHASE 1: PLAN (reads only)
 *
 *=========================================*/

/** Every paid invoice on the platform account, oldest first. */
async function paidInvoices() {
  const out = []
  let startingAfter
  for (;;) {
    const page = await stripeGet('invoices', {
      limit: 100,
      starting_after: startingAfter,
    })
    out.push(...(page.data ?? []))
    if (!page.has_more) break
    startingAfter = page.data[page.data.length - 1]?.id
    if (!startingAfter) break
  }
  return out
    .filter((invoice) => invoice?.paid === true)
    .sort((a, b) => a.created - b.created)
}

const invoices = await paidInvoices()
console.log(`Stripe reports ${invoices.length} paid invoice(s).\n`)

const planned = []
const skipped = []
const problems = []

for (const invoice of invoices) {
  const invoiceId = invoice.id
  const existing = await firestore
    .collection('platformRevenue')
    .doc(invoiceId)
    .get()
  if (existing.exists) {
    skipped.push({ invoiceId, reason: 'already recorded' })
    continue
  }

  const customerId =
    typeof invoice.customer === 'string'
      ? invoice.customer
      : invoice.customer?.id
  if (!customerId) {
    skipped.push({ invoiceId, reason: 'invoice has no customer' })
    continue
  }
  // The SAME test the webhook applies: only a customer in this index is one
  // of Aglyn's own billing customers. A storefront shopper or marketplace
  // buyer never appears in it, and their charges are not Aglyn's revenue.
  const indexDoc = await firestore
    .collection(STRIPE_CUSTOMER_INDEX_COLLECTION)
    .doc(customerId)
    .get()
  const orgId = indexDoc.exists ? indexDoc.get('orgId') : null
  if (!orgId) {
    skipped.push({
      invoiceId,
      reason: `customer ${customerId} is not a workspace`,
    })
    continue
  }

  // Derived by the app's own function — never re-implemented here.
  const revenue = platformInvoiceRevenue(invoice)
  if (!revenue) {
    problems.push(`${invoiceId}: could not be decomposed into a revenue row`)
    continue
  }
  const internalTraffic =
    invoice?.subscription_details?.metadata?.[INTERNAL_TRAFFIC_PARAM] ===
    INTERNAL_TRAFFIC_VALUE
  planned.push({ invoiceId, orgId, revenue, internalTraffic, invoice })
}

console.log('PLAN — rows this run intends to CREATE:\n')
if (planned.length === 0) console.log('  (none)\n')
for (const row of planned) {
  const { revenue } = row
  console.log(`  ${row.invoiceId}`)
  console.log(`    org         : ${row.orgId}`)
  console.log(`    customer    : ${revenue.stripeCustomerId}`)
  console.log(`    subscription: ${revenue.subscriptionId ?? '—'}`)
  console.log(
    `    gross       : ${money(revenue.grossCents)}  (invoice.amount_paid)`,
  )
  console.log(
    `    sales tax   : ${money(revenue.taxCents)}  (${
      revenue.taxLines.length
    } tax line(s) from the invoice)`,
  )
  console.log(`    net         : ${money(revenue.netCents)}  (gross − tax)`)
  console.log(`    total       : ${money(revenue.totalCents)}`)
  console.log(`    currency    : ${revenue.currency}`)
  console.log(`    paidAt      : ${revenue.paidAt?.toISOString() ?? 'MISSING'}`)
  console.log(`    automaticTax: ${revenue.automaticTax}`)
  console.log(`    internal    : ${row.internalTraffic}`)
  console.log('')
}
if (skipped.length > 0) {
  console.log('Skipped (no row will be written):')
  for (const entry of skipped) {
    console.log(`  ${entry.invoiceId} — ${entry.reason}`)
  }
  console.log('')
}

/*==========================================
 *
 * MARK - PHASE 2: GUARD (refuses what it cannot stand behind)
 *
 *=========================================*/

for (const row of planned) {
  const { invoiceId, revenue, invoice } = row
  const where = `${invoiceId}`
  if (revenue.invoiceId !== invoiceId) {
    problems.push(`${where}: decomposed id disagrees with the invoice id`)
  }
  if (invoice.status !== 'paid') {
    problems.push(`${where}: status is "${invoice.status}", not "paid"`)
  }
  // A row with no readable date is invisible to EVERY period query — the
  // exact fault the page already has to warn about. Never write another one.
  if (!(revenue.paidAt instanceof Date) || Number.isNaN(+revenue.paidAt)) {
    problems.push(`${where}: no readable paid date`)
  }
  if (!revenue.currency) problems.push(`${where}: no currency`)
  if (!(revenue.grossCents >= 0)) problems.push(`${where}: negative gross`)
  if (!(revenue.taxCents >= 0)) problems.push(`${where}: negative tax`)
  if (revenue.taxCents > revenue.grossCents) {
    problems.push(`${where}: tax ${revenue.taxCents} exceeds gross`)
  }
  // The arithmetic the tax return depends on, asserted rather than assumed.
  if (revenue.netCents !== revenue.grossCents - revenue.taxCents) {
    problems.push(`${where}: net is not gross − tax`)
  }
  // A tax figure must be backed by the invoice's own breakdown. A non-zero
  // tax with no line behind it would be a number this script invented.
  if (revenue.taxCents > 0 && revenue.taxLines.length === 0) {
    problems.push(`${where}: tax ${revenue.taxCents} with no tax line`)
  }
}

if (problems.length > 0) {
  console.error('GUARD FAILED — nothing written:\n')
  for (const problem of problems) console.error(`  ✗ ${problem}`)
  console.error(
    '\nThese rows feed the tax return. A field that cannot be derived\n' +
      'faithfully from the invoice is not defaulted — fix the source or\n' +
      'narrow the run.\n',
  )
  process.exit(1)
}
console.log(`GUARD passed — ${planned.length} row(s) safe to create.\n`)

if (!COMMIT) {
  console.log('Dry run — nothing written. Re-run with --commit to apply.\n')
  process.exit(0)
}
if (planned.length === 0) {
  console.log('Nothing to write.\n')
  process.exit(0)
}

/*==========================================
 *
 * MARK - PHASE 3: APPLY (create-only, never modify)
 *
 *=========================================*/

const { FieldValue } = await import('firebase-admin/firestore')
for (const row of planned) {
  const { invoiceId, ...recorded } = row.revenue
  try {
    // `create()` REJECTS if the document exists. The additive-only promise is
    // therefore enforced by Firestore, not by this script remembering to
    // check — and a row that appeared between PLAN and APPLY cannot be
    // silently overwritten.
    await firestore
      .collection('platformRevenue')
      .doc(invoiceId)
      .create({
        ...recorded,
        orgId: row.orgId,
        ...(row.internalTraffic ? { internalTraffic: true } : {}),
        recordedAt: FieldValue.serverTimestamp(),
      })
    console.log(`  created platformRevenue/${invoiceId}`)
  } catch (error) {
    console.error(
      `\n✗ ${invoiceId} was NOT created: ${error?.message ?? error}\n` +
        '  (an existing row is never modified — that would not be a backfill)',
    )
    process.exitCode = 1
  }
}

/*==========================================
 *
 * MARK - PHASE 4: VERIFY (re-reads what actually landed)
 *
 *=========================================*/

console.log('\nVERIFY — what Firestore actually holds now:\n')
let mismatches = 0
for (const row of planned) {
  const stored = await firestore
    .collection('platformRevenue')
    .doc(row.invoiceId)
    .get()
  if (!stored.exists) {
    console.error(`  ✗ ${row.invoiceId} — NOT PRESENT`)
    mismatches += 1
    continue
  }
  const storedPaidAt = stored.get('paidAt')?.toDate?.()
  console.log(`  ${row.invoiceId}`)
  console.log(`    org       : ${stored.get('orgId')}`)
  console.log(`    gross     : ${money(stored.get('grossCents'))}`)
  console.log(`    sales tax : ${money(stored.get('taxCents'))}`)
  console.log(`    net       : ${money(stored.get('netCents'))}`)
  console.log(`    currency  : ${stored.get('currency')}`)
  console.log(`    paidAt    : ${storedPaidAt?.toISOString() ?? 'MISSING'}`)
  // Compared against the PLAN, field by field, rather than eyeballed.
  const checks = [
    ['orgId', stored.get('orgId'), row.orgId],
    ['grossCents', stored.get('grossCents'), row.revenue.grossCents],
    ['taxCents', stored.get('taxCents'), row.revenue.taxCents],
    ['netCents', stored.get('netCents'), row.revenue.netCents],
    ['currency', stored.get('currency'), row.revenue.currency],
    [
      'paidAt',
      storedPaidAt?.toISOString(),
      row.revenue.paidAt?.toISOString(),
    ],
  ]
  for (const [field, actual, expected] of checks) {
    if (actual !== expected) {
      console.error(
        `    ✗ ${field}: stored ${actual} but planned ${expected}`,
      )
      mismatches += 1
    }
  }
  console.log('')
}

if (mismatches > 0) {
  console.error(`VERIFY FAILED — ${mismatches} mismatch(es).\n`)
  process.exit(1)
}
console.log(`VERIFY passed — ${planned.length} row(s) stored as planned.\n`)
