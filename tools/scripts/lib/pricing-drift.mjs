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

// Reconciles every CHARGED price across the three places one can live
// (AGL-1885). Pure functions only — no network, no filesystem — so the
// self-test can pin the shapes that would otherwise produce a wrong answer,
// exactly as `legal-doc-diff.mjs` does for the legal documents.
//
// ## The three sources, and why disagreement is not hypothetical
//
//  1. **Code** — `PLAN_PRICING` and `PLAN_ENTITLEMENTS` in
//     `plan-entitlements.ts`, plus `METERED_UNIT_RATES_USD` in
//     `usage-metering.ts`. This is what the console shows and what the
//     entitlement checks enforce.
//  2. **Stripe live mode** — what a customer is ACTUALLY charged. Code can
//     say $56 all it likes; the invoice comes from the Stripe price.
//  3. **The source-of-truth doc** — `Platform Docs/Pricing & Packaging/
//     00-Pricing-Source-of-Truth`, the human record the pricing LOCK was
//     verified against on 2026-08-18.
//
// Every published price is HAND-AUTHORED copy on `/pricing`, and the tier
// visibility work keeps republishing that page. A republish is a chance for
// silent drift, and the thing that drifts is the number a customer pays.
//
// ## What this refuses to do
//
// It does not "fix" anything and it does not rank one source above another.
// It reports disagreement and exits non-zero, because which side is right is
// a pricing decision and belongs to Zach, not to a script.
//
// ⛔ THE TWO PER-GB-MONTH PRICES ARE NOT A BUG. `storagePerGbMonth` ($0.026,
// metered infra pass-through, published at ×1.30 = $0.0338) and
// `extraDataGbMonthlyUsd` ($0.25, dataset add-on retail) are different
// quantities that read identically on the page. Anyone reconciling "the
// storage price" has two plausible targets. This module keeps them in
// SEPARATE checks under their own names so a fix cannot land on the wrong one.

/** Plans that are deliberately not purchasable through Stripe. */
export const NON_PURCHASABLE_PLANS = Object.freeze(['free', 'enterprise'])

/** Every self-serve plan, in ladder order. */
export const SELF_SERVE_PLANS = Object.freeze([
  'starter',
  'pro',
  'business',
  'scale',
  'advanced',
  'agency',
])

export const ALL_PLANS = Object.freeze([
  'free',
  ...SELF_SERVE_PLANS,
  'enterprise',
])

/**
 * Per-plan money fields in `PLAN_PRICING`, mapped to the Stripe lookup key
 * that must carry the same number and the multiplier between them.
 *
 * Yearly Stripe prices are the MONTHLY figure times twelve — that is the
 * repo's convention (`_yearly` = monthly × 12), and encoding it here is what
 * lets the check catch an annual price that was updated without its monthly
 * twin, which is the drift a human reading two tables will not see.
 */
export const PRICE_FIELD_MAP = Object.freeze([
  { field: 'basePriceMonthlyUsd', key: (p) => `aglyn_${p}_v2`, mult: 1 },
  { field: 'basePriceAnnualMonthlyUsd', key: (p) => `aglyn_${p}_v2_yearly`, mult: 12 },
  { field: 'extraHostMonthlyUsd', key: (p) => `aglyn_${p}_extra_host`, mult: 1 },
  { field: 'extraHostMonthlyUsd', key: (p) => `aglyn_${p}_extra_host_yearly`, mult: 12 },
  { field: 'extraSeatMonthlyUsd', key: (p) => `aglyn_${p}_extra_seat`, mult: 1 },
  { field: 'extraSeatMonthlyUsd', key: (p) => `aglyn_${p}_extra_seat_yearly`, mult: 12 },
  { field: 'extraCollaboratorMonthlyUsd', key: (p) => `aglyn_${p}_extra_member`, mult: 1 },
  { field: 'extraCollaboratorMonthlyUsd', key: (p) => `aglyn_${p}_extra_member_yearly`, mult: 12 },
  { field: 'extraDatasetMonthlyUsd', key: (p) => `aglyn_${p}_extra_dataset`, mult: 1 },
  { field: 'extraDatasetMonthlyUsd', key: (p) => `aglyn_${p}_extra_dataset_yearly`, mult: 12 },
])

/**
 * Pull one `Record<OrgPlan, …>` object literal's per-plan blocks out of TS
 * source.
 *
 * Deliberately a text parse and not an import: `plan-entitlements.ts` is a
 * TypeScript module inside an nx lib with path aliases, and making this
 * script able to import it would drag a build step into a guard whose whole
 * value is being runnable anywhere, instantly, with no toolchain. The shape
 * it parses is pinned by the self-test, so a refactor that breaks the parse
 * fails loudly rather than silently reporting "nothing to compare".
 *
 * @param source - the .ts file contents
 * @param constName - e.g. `PLAN_PRICING`
 * @returns plan → { field: number | null | boolean }
 */
export function parsePlanRecord(source, constName) {
  const start = source.indexOf(`export const ${constName}`)
  if (start === -1) return {}
  const block = source.slice(start)
  const out = {}
  for (const plan of ALL_PLANS) {
    const match = block.match(
      new RegExp(`\\n  ${plan}: \\{([\\s\\S]*?)\\n  \\},`),
    )
    if (!match) continue
    const fields = {}
    for (const line of match[1].split('\n')) {
      const f = line.match(/^\s*(\w+):\s*([^,]+),/)
      if (!f) continue
      const raw = f[2].trim()
      if (raw === 'null') fields[f[1]] = null
      else if (raw === 'true') fields[f[1]] = true
      else if (raw === 'false') fields[f[1]] = false
      else if (/^-?[\d._]+$/.test(raw)) fields[f[1]] = Number(raw.replace(/_/g, ''))
      else fields[f[1]] = raw
    }
    out[plan] = fields
  }
  return out
}

/** The three metered unit rates, read off a `const X = { … }` literal. */
export function parseUnitRates(source, constName) {
  const start = source.indexOf(`export const ${constName}`)
  if (start === -1) return null
  const block = source.slice(start, source.indexOf('}', start) + 1)
  const rates = {}
  for (const [, k, v] of block.matchAll(/(\w+):\s*([\d._]+)/g)) {
    rates[k] = Number(v.replace(/_/g, ''))
  }
  return Object.keys(rates).length ? rates : null
}

/** Index Stripe's `prices.list` payload by lookup key. */
export function indexStripePrices(payload) {
  const out = {}
  for (const p of payload?.data ?? []) {
    if (!p.lookup_key) continue
    out[p.lookup_key] = {
      amount: p.unit_amount != null ? p.unit_amount / 100 : null,
      active: p.active !== false,
      interval: p.recurring?.interval ?? null,
    }
  }
  return out
}

/** Round to cents; floating point must not manufacture a disagreement. */
const cents = (n) => Math.round(n * 100) / 100

/**
 * Compare code's plan prices against Stripe live mode.
 *
 * @returns array of verdicts: `{ status, key, detail }` where status is
 *   'in-sync' | 'differs' | 'unreadable'
 */
export function comparePlansToStripe(planPricing, stripe) {
  const verdicts = []
  for (const plan of ALL_PLANS) {
    const fields = planPricing[plan]
    if (!fields) continue
    for (const { field, key, mult } of PRICE_FIELD_MAP) {
      const lookupKey = key(plan)
      const codeValue = fields[field]
      const live = stripe[lookupKey]

      if (codeValue == null) {
        // Code says this is not purchasable. A live price that IS purchasable
        // is drift in the direction that costs money: a checkout could charge
        // for something the product believes is free.
        if (live && live.active) {
          verdicts.push({
            status: 'differs',
            key: lookupKey,
            detail: `code has no price (${field} is null) but Stripe has an ACTIVE $${live.amount}`,
          })
        }
        continue
      }

      if (!live) {
        const expected = NON_PURCHASABLE_PLANS.includes(plan)
        verdicts.push({
          status: expected ? 'in-sync' : 'unreadable',
          key: lookupKey,
          detail: expected
            ? `no Stripe price, as expected for ${plan}`
            : `code says $${codeValue} but there is no live Stripe price`,
        })
        continue
      }

      const expected = cents(codeValue * mult)
      if (live.amount !== expected) {
        verdicts.push({
          status: 'differs',
          key: lookupKey,
          detail: `code $${expected} vs Stripe $${live.amount}`,
        })
      } else if (!live.active) {
        verdicts.push({
          status: 'differs',
          key: lookupKey,
          detail: `amount agrees ($${expected}) but the Stripe price is INACTIVE — checkout would fail`,
        })
      } else {
        verdicts.push({ status: 'in-sync', key: lookupKey, detail: `$${expected}` })
      }
    }
  }
  return verdicts
}

/**
 * Compare the transaction-fee ladder in code against an expected ladder.
 *
 * @param entitlements - parsed `PLAN_ENTITLEMENTS`
 * @param expected - plan → { digital, physical }
 */
export function compareFeeLadder(entitlements, expected) {
  const verdicts = []
  for (const [plan, want] of Object.entries(expected)) {
    const fields = entitlements[plan]
    if (!fields) {
      verdicts.push({ status: 'unreadable', key: `fee:${plan}`, detail: 'no entitlements block' })
      continue
    }
    const digital = fields.transactionFeeDigitalPct
    const physical = fields.transactionFeePhysicalPct
    if (digital !== want.digital || physical !== want.physical) {
      verdicts.push({
        status: 'differs',
        key: `fee:${plan}`,
        detail: `code ${digital}/${physical} vs source-of-truth ${want.digital}/${want.physical}`,
      })
    } else {
      verdicts.push({ status: 'in-sync', key: `fee:${plan}`, detail: `${digital}%/${physical}%` })
    }
  }
  return verdicts
}

/**
 * The two rate tables that carry the same three figures must never drift
 * (the 2026-08-09 correction changed both together).
 *
 * `ORG_COGS_UNIT_RATES_USD` also carries figures the meter does not bill —
 * dataset storage and per-API-request — which are cost-model inputs, not
 * pass-through rates, so only the shared keys are compared.
 */
export function compareUnitRateTables(metered, cogs) {
  const verdicts = []
  if (!metered || !cogs) {
    return [{ status: 'unreadable', key: 'unit-rates', detail: 'a rate table could not be parsed' }]
  }
  for (const key of Object.keys(metered)) {
    if (!(key in cogs)) continue
    if (metered[key] !== cogs[key]) {
      verdicts.push({
        status: 'differs',
        key: `rate:${key}`,
        detail: `METERED_UNIT_RATES_USD ${metered[key]} vs ORG_COGS_UNIT_RATES_USD ${cogs[key]} — the billing rollup and the COGS model disagree about what an org costs`,
      })
    } else {
      verdicts.push({ status: 'in-sync', key: `rate:${key}`, detail: String(metered[key]) })
    }
  }
  return verdicts
}

/**
 * What `/pricing` publishes for the three meters: unit cost × markup, scaled
 * to the unit the page quotes.
 */
export function publishedMeteredRates(rates, markup) {
  return {
    storagePerGbMonth: cents(rates.storagePerGbMonth * markup * 10000) / 10000,
    perThousandPageViews: cents(rates.perPageView * markup * 1000 * 10000) / 10000,
    perThousandFormSubmissions: cents(rates.perFormSubmission * markup * 1000 * 10000) / 10000,
  }
}

/**
 * Same ladder as the legal checker, and for the same reason: a run that
 * compared NOTHING must never render as "everything agrees".
 */
export function overallExitCode(verdicts) {
  if (verdicts.some((v) => v.status === 'differs')) return 1
  if (verdicts.some((v) => v.status === 'unreadable')) return 2
  if (!verdicts.some((v) => v.status === 'in-sync')) return 2
  return 0
}
