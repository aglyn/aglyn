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

// Reconciles every CHARGED price: repo code ↔ the LOCKED pin below ↔ Stripe
// live mode, plus the source-of-truth doc when its Drive path is mounted
// (AGL-1885).
//
//   npm run check:pricing-drift               # code ↔ pin ↔ Stripe
//   npm run check:pricing-drift -- --summary  # verdicts only
//   npm run check:pricing-drift -- --no-stripe
//
// EXIT CODES mirror `legal-doc-diff.mjs`, deliberately: 0 = something was
// compared and everything agrees, 1 = drift, 2 = could not check. A run that
// compared nothing exits 2, because "no disagreements found" and "no
// comparison performed" must never render the same.
//
// ## Why the pin exists as well as the code
//
// The pin is a SECOND copy on purpose — the same mechanism as the committed
// legal snapshots. Code is edited every day by whoever is closest to a
// feature; the pin is an independent record of the locked price set,
// verified line-by-line against
// `Platform Docs/Pricing & Packaging/00-Pricing-Source-of-Truth` at the time.
// One copy cannot detect its own drift. Changing a charged price is supposed
// to cost two deliberate edits and a review, and that is the point.
//
// Tier VISIBILITY may change freely; the CHARGED price may not. That is the
// boundary this guard polices.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { driveDocPath } from './lib/drive-mount.mjs'
import {
  parsePlanRecord,
  parseUnitRates,
  indexStripePrices,
  comparePlansToStripe,
  compareFeeLadder,
  compareUnitRateTables,
  publishedMeteredRates,
  overallExitCode,
} from './lib/pricing-drift.mjs'

const PLAN_ENTITLEMENTS_TS = 'libs/aglyn/src/lib/app-utils/plan-entitlements.ts'
const USAGE_METERING_TS = 'apps/console/utils/usage-metering.ts'

/**
 * The price set LOCKED for the Sept 1 public beta.
 * Recorded on AGL-1885 and in the Pricing Decision Log entry
 * "2026-08-18 — Pricing LOCK for the Sept 1 public beta".
 *
 * ⚑ Do not edit to make a failing check pass. A disagreement here means the
 * code moved a charged price; the fix is to decide which is right, not to
 * re-pin. A price change moves this pin and the Decision Log together.
 */
const LOCKED = {
  monthly: { free: 0, starter: 25, pro: 56, business: 139, scale: 249, advanced: 399, agency: 799 },
  annualPerMonth: { free: 0, starter: 16, pro: 39, business: 99, scale: 179, advanced: 299, agency: 649 },
  ladder: {
    free: { digital: 0, physical: 0 },
    starter: { digital: 5, physical: 2 },
    pro: { digital: 3, physical: 0 },
    business: { digital: 2, physical: 0 },
    scale: { digital: 1, physical: 0 },
    advanced: { digital: 0, physical: 0 },
    agency: { digital: 0, physical: 0 },
  },
  // What `/pricing` publishes: unit cost × 1.30, in the units the page quotes.
  publishedMetered: {
    storagePerGbMonth: 0.0338,
    perThousandPageViews: 0.13,
    perThousandFormSubmissions: 0.065,
  },
}

/** Where the source-of-truth doc lives, when the shared drive is mounted. */
const SOURCE_OF_TRUTH_MD = driveDocPath(
  'Platform Docs',
  'Pricing & Packaging',
  '00-Pricing-Source-of-Truth',
  'Pricing-Source-of-Truth.md',
)


/**
 * DOCS MUST NOT RESTATE A PRICE (AGL-1885).
 *
 * The docs carried the full plan table, the add-on table and the metered
 * rates, and one of them had already drifted: storage read "about $0.034 per
 * GB per month" where the rate is $0.0338. Nothing was wrong with the words —
 * the problem is that a second copy of a number is a copy that goes stale, and
 * the docs are the copy nobody re-reads when a price changes.
 *
 * They now describe SHAPE ("cheaper on higher plans", "flat per register") and
 * link to `/pricing` for figures. This keeps it that way.
 *
 * Scoped to Aglyn's OWN prices, deliberately. An example order total of $100
 * or a sample plugin at $29 is legitimate documentation and must stay legal;
 * only the locked plan, annual and add-on figures are refused.
 *
 * `whats-new.md` is exempt for the reason CHANGELOG.md is exempt from the
 * naming sweep: it is an append-only record of what shipped, and editing it to
 * remove a price falsifies the record of the release that set it.
 */
function docsRestatingPrices() {
  const root = 'apps/docs/docs'
  if (!existsSync(root)) return []
  const locked = new Set([
    ...Object.values(LOCKED.monthly), ...Object.values(LOCKED.annualPerMonth),
    // Add-on figures, from the same Stripe-verified set.
    10, 8, 5, 4, 3, 2, 1, 89, 9,
  ].filter((n) => n > 0).map(String))
  // Only the DISTINCTIVE ones: single digits appear in prose constantly and a
  // guard that flags "$2" in an example is a guard people switch off.
  const distinctive = [...locked].filter((n) => Number(n) >= 16)
  const re = new RegExp(`\\$(${distinctive.join('|')})\\b`, 'g')
  const hits = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) { walk(full); continue }
      if (!/\.mdx?$/.test(name)) continue
      if (name === 'whats-new.md') continue
      const text = readFileSync(full, 'utf8')
      for (const m of text.matchAll(re)) hits.push({ file: full, price: m[0] })
    }
  }
  walk(root)
  return hits
}

function parseArgs(argv) {
  const args = { summary: false, stripe: true }
  for (const raw of argv) {
    if (raw === '--summary') args.summary = true
    else if (raw === '--no-stripe') args.stripe = false
    else {
      console.error(`Unknown argument: ${raw}`)
      console.error('Usage: check:pricing-drift [--summary] [--no-stripe]')
      process.exit(2)
    }
  }
  return args
}

/**
 * Stripe live prices, from the API when a key is configured and otherwise
 * from the authenticated CLI.
 *
 * READ ONLY — `prices.list`, nothing else. A pricing GUARD must never be
 * able to mutate the prices it is guarding, so there is no code path here
 * that writes.
 */
function fetchStripePrices() {
  // ONE variable. Extra accepted names are extra places for an unrestricted
  // key to hide, and each one has to be remembered by every future reader.
  const key = process.env['STRIPE_RESTRICTED_KEY']

  // Refuse an UNRESTRICTED key outright. `sk_live_…` can create and delete
  // prices, issue refunds and move money; this guard needs `prices.list` and
  // nothing else, and a guard must not hold permission to change the thing it
  // guards. Naming the variable `STRIPE_SECRET_KEY` invited exactly this
  // the tell that the NAME was the defect. Renamed, and now enforced rather
  // than merely documented, because a convention nobody can violate beats a
  // sentence in a comment.
  if (key && key.startsWith('sk_')) {
    return {
      ok: false,
      detail:
        'an UNRESTRICTED sk_ key was supplied. Use a RESTRICTED rk_ key with ' +
        'read access to Prices and nothing else — this check only ever calls ' +
        'prices.list, and it must not be able to change what it checks.',
    }
  }
  if (key) {
    const res = execFileSync('curl', [
      '-s', '-G', 'https://api.stripe.com/v1/prices',
      '-H', `Authorization: Bearer ${key}`,
      '-d', 'limit=100', '-d', 'active=true',
    ], { encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })
    const parsed = JSON.parse(res)
    if (parsed.error) return { ok: false, detail: parsed.error.message }
    return { ok: true, payload: parsed, via: 'api key' }
  }
  try {
    const res = execFileSync('stripe', ['prices', 'list', '--live', '--limit', '100'], {
      encoding: 'utf8', maxBuffer: 20 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
    })
    return { ok: true, payload: JSON.parse(res), via: 'stripe CLI' }
  } catch {
    return {
      ok: false,
      detail:
        'no STRIPE_RESTRICTED_KEY and the `stripe` CLI is unavailable or not ' +
        'logged in. In CI set STRIPE_RESTRICTED_KEY to a RESTRICTED rk_ key with ' +
        'read access to Prices and nothing else.',
    }
  }
}

const args = parseArgs(process.argv.slice(2))
const verdicts = []
const note = (status, key, detail) => verdicts.push({ status, key, detail })

if (!existsSync(PLAN_ENTITLEMENTS_TS)) {
  console.error(`CANNOT CHECK: ${PLAN_ENTITLEMENTS_TS} not found — run from the repo root.`)
  process.exit(2)
}

const entitlementsSrc = readFileSync(PLAN_ENTITLEMENTS_TS, 'utf8')
const meteringSrc = existsSync(USAGE_METERING_TS) ? readFileSync(USAGE_METERING_TS, 'utf8') : ''

const planPricing = parsePlanRecord(entitlementsSrc, 'PLAN_PRICING')
const entitlements = parsePlanRecord(entitlementsSrc, 'PLAN_ENTITLEMENTS')

if (!Object.keys(planPricing).length) {
  console.error('CANNOT CHECK: PLAN_PRICING could not be parsed — the literal shape changed.')
  process.exit(2)
}

// ---- 1. code ↔ the locked pin -------------------------------------------
for (const [plan, want] of Object.entries(LOCKED.monthly)) {
  const got = planPricing[plan]?.basePriceMonthlyUsd
  if (got === want) note('in-sync', `locked:${plan}:monthly`, `$${want}`)
  else note('differs', `locked:${plan}:monthly`, `code $${got} vs LOCKED $${want}`)
}
for (const [plan, want] of Object.entries(LOCKED.annualPerMonth)) {
  const got = planPricing[plan]?.basePriceAnnualMonthlyUsd
  if (got === want) note('in-sync', `locked:${plan}:annual`, `$${want}/mo`)
  else note('differs', `locked:${plan}:annual`, `code $${got} vs LOCKED $${want}`)
}

// ---- 2. the fee ladder ---------------------------------------------------
verdicts.push(...compareFeeLadder(entitlements, LOCKED.ladder))

// ---- 3. the two rate tables that must never drift ------------------------
const metered = parseUnitRates(meteringSrc, 'METERED_UNIT_RATES_USD')
const cogs = parseUnitRates(entitlementsSrc, 'ORG_COGS_UNIT_RATES_USD')
verdicts.push(...compareUnitRateTables(metered, cogs))

// ---- 4. published metered rates = unit cost × markup ---------------------
const markupMatch = entitlementsSrc.match(/export const METERED_MARKUP\s*=\s*([\d.]+)/)
if (metered && markupMatch) {
  const published = publishedMeteredRates(metered, Number(markupMatch[1]))
  for (const [key, want] of Object.entries(LOCKED.publishedMetered)) {
    if (published[key] === want) note('in-sync', `published:${key}`, `$${want}`)
    else note('differs', `published:${key}`, `derived $${published[key]} vs published $${want}`)
  }
} else {
  note('unreadable', 'published:metered', 'METERED_MARKUP or the unit rates could not be parsed')
}

// ---- 5. code ↔ Stripe live ----------------------------------------------
if (args.stripe) {
  const stripe = fetchStripePrices()
  if (!stripe.ok) note('unreadable', 'stripe', stripe.detail)
  else verdicts.push(...comparePlansToStripe(planPricing, indexStripePrices(stripe.payload)))
} else {
  note('unreadable', 'stripe', 'skipped with --no-stripe')
}

// ---- 6. the source-of-truth doc, when Drive is mounted -------------------
// `existsSync` is TRUE for a Google Drive placeholder whose contents have not
// been materialised locally, and the read then throws ENOENT — so presence is
// not readability here, and the optimistic version crashed the whole check on
// a machine where Drive had simply evicted the file.
let sourceOfTruthMd = null
try {
  if (SOURCE_OF_TRUTH_MD && existsSync(SOURCE_OF_TRUTH_MD)) {
    sourceOfTruthMd = readFileSync(SOURCE_OF_TRUTH_MD, 'utf8')
  }
} catch {
  sourceOfTruthMd = null
}
if (sourceOfTruthMd) {
  const md = sourceOfTruthMd
  for (const [plan, want] of Object.entries(LOCKED.monthly)) {
    if (plan === 'free') continue
    // The doc's plan table writes `| Pro | $56 / $39 | …`.
    const row = md.match(new RegExp(`\\|\\s*\\*{0,2}${plan}\\*{0,2}\\s*\\|\\s*\\*{0,2}\\$([\\d,]+)`, 'i'))
    if (!row) { note('unreadable', `doc:${plan}`, 'no plan row found in the source-of-truth table'); continue }
    const docPrice = Number(row[1].replace(/,/g, ''))
    if (docPrice === want) note('in-sync', `doc:${plan}`, `$${want}`)
    else note('differs', `doc:${plan}`, `source-of-truth $${docPrice} vs LOCKED $${want}`)
  }
} else {
  console.log('note: the source-of-truth doc is not mounted; skipping that leg (it is not a gate).')
}

// ---- 7. the docs must not restate a price -------------------------------
for (const hit of docsRestatingPrices()) {
  note('differs', `docs:${hit.file.replace('apps/docs/docs/', '')}`,
    `restates ${hit.price} — link to /pricing instead; a second copy of a price is one that goes stale`)
}
if (!docsRestatingPrices().length) note('in-sync', 'docs:prices', 'no Aglyn price is restated in the docs')

// ---- report --------------------------------------------------------------
const differs = verdicts.filter((v) => v.status === 'differs')
const unreadable = verdicts.filter((v) => v.status === 'unreadable')
const inSync = verdicts.filter((v) => v.status === 'in-sync')

for (const v of differs) console.log(`DIFFERS     ${v.key} — ${v.detail}`)
for (const v of unreadable) console.log(`UNREADABLE  ${v.key} — ${v.detail}`)
if (!args.summary) for (const v of inSync) console.log(`in sync     ${v.key} — ${v.detail}`)

const code = overallExitCode(verdicts)
console.log(
  `\n${inSync.length} in-sync, ${differs.length} differs, ${unreadable.length} unreadable — exit ${code}`,
)
process.exit(code)
