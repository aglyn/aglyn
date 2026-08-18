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
 * Every path that can put an org on a paid subscription must meter it
 * (AGL-1352).
 *
 * This is the check that would have caught AGL-1352 with nobody reasoning
 * about it. The bug was not a mistake inside a path — each of the two paths
 * that attached the metered item did so correctly. The bug was a path NOBODY
 * COUNTED: Stripe's own customer portal, writing back through a webhook that
 * had never heard of `subscription_items`.
 *
 * That failure has no symptom. The plan is right, the entitlements are right,
 * the invoice looks right, and the only trace is usage revenue that never
 * arrives. No test of any individual path can find it, because every
 * individual path passes. Only an exhaustive sweep can — so this enumerates
 * the subscription-mutating surfaces from the SOURCE and forces each one to be
 * either metered or explicitly, reasonedly exempt.
 *
 * Adding a fifth path and forgetting the metered item therefore fails here,
 * naming the file, instead of shipping and billing $0 forever.
 *
 * The population-level companion is `tools/scripts/audit-metered-coverage.mjs`,
 * which asks the same question of live Stripe: which paying subscriptions
 * carry no metered item TODAY. This spec guards the code; that script guards
 * the data.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const CONSOLE_ROOT = join(__dirname, '..')
const API_ROOT = join(CONSOLE_ROOT, 'app', 'api')

/**
 * Source shapes that create or re-price a PLAN subscription on our own Stripe
 * account. Deliberately about the Stripe call, not about the file name: a new
 * route called anything at all is caught the moment it makes one of these.
 */
const MUTATES_SUBSCRIPTION: RegExp[] = [
  // A subscription-mode Checkout session.
  /mode:\s*'subscription'/,
  // POST /v1/subscriptions — create, or update by id.
  /['"`]subscriptions(\/\$\{|['"`])/,
  /stripe\.com\/v1\/subscriptions/,
  // POST /v1/subscription_items — adding or re-pricing one item.
  /stripe\.com\/v1\/subscription_items/,
]

/**
 * Evidence that a file has actually thought about metering: it resolves the
 * interval-matched price, or it delegates to the back-fill helper.
 */
const METERS = [
  /\bmeteredPriceId\s*\(/,
  /\bbackfillMeteredItem\s*\(/,
  /\bmeteredBackfillDecision\s*\(/,
]

/**
 * Paths that mutate a subscription and are metered ELSEWHERE or on purpose.
 * A reason is mandatory — the point of the sweep is that "we decided" is
 * recorded, not that the list is short.
 */
const EXEMPT: Record<string, string> = {
  'app/api/admin/enterprise-billing/route.ts':
    'Enterprise is quoted per deal and billed on an ad-hoc price, not a plan SKU (AGL-1110). Usage terms are part of the signed agreement, so metering it self-serve would silently add a charge nobody negotiated. Deliberately unmetered — and `meteredBackfillDecision` refuses `enterprise` for the same reason, so the webhook cannot add one behind the deal.',
  'app/api/admin/org-billing/route.ts':
    'Staff read-only view: it LISTS a customer\'s subscriptions (GET) and never creates or re-prices one.',
  'app/api/billing/addons/route.ts':
    'Changes ONE add-on item\'s quantity (`items[0]`). Stripe leaves unmentioned items alone, so it neither adds nor drops the metered item, and it cannot change the plan or the interval that would decide which metered price applies. Its update emits customer.subscription.updated, so the webhook back-fill covers the subscription anyway.',
  'app/api/admin/org-discount/route.ts':
    'Applies or clears a coupon (`subscriptions/{id}` with `coupon`, and `/discount` to delete). It never sends `items`, so no item is added, re-priced or dropped. Covered by the webhook back-fill like any other subscription update.',
  'app/api/billing/retention/route.ts':
    'The retention funnel\'s winback (AGL-1863) attaches a bounded coupon to an EXISTING subscription — `subscriptions/{id}` with `discounts[0][coupon]` and nothing else. Same shape as `admin/org-discount` above: it never sends `items`, so the metered item is neither added nor dropped, and it cannot change the plan or the interval that would decide which metered price applies. Its update emits customer.subscription.updated, so the webhook back-fill covers the subscription anyway. Metering the discount would also be wrong on the merits: a percent-off coupon must not reduce usage overage, which is the floor the offer is margin-checked against.',
}

function walk(dir: string, out: string[] = []): string[] {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      walk(full, out)
    } else if (/\.tsx?$/.test(entry.name) && !/\.spec\.tsx?$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

describe('every paid-subscription path is metered (AGL-1352)', () => {
  const routes = walk(API_ROOT).filter((file) =>
    MUTATES_SUBSCRIPTION.some((pattern) => pattern.test(readFileSync(file, 'utf8'))),
  )

  it('finds the subscription-mutating routes at all', () => {
    // A sweep that matches nothing passes vacuously, which is the failure mode
    // of every source guard. Anchor it on the paths we KNOW exist: if this
    // count collapses, the patterns above have rotted and the rest of this
    // file is proving nothing.
    const named = routes.map((file) => relative(CONSOLE_ROOT, file))
    expect(named).toEqual(
      expect.arrayContaining([
        join('app', 'api', 'billing', 'checkout', 'route.ts'),
        join('app', 'api', 'billing', 'subscription', 'route.ts'),
      ]),
    )
    expect(routes.length).toBeGreaterThanOrEqual(3)
  })

  it('has no subscription-mutating route that forgets the metered item', () => {
    const offenders = routes
      .map((file) => relative(CONSOLE_ROOT, file))
      .filter((name) => !(name.split(/[\\/]/).join('/') in EXEMPT))
      .filter((name) => {
        const source = readFileSync(join(CONSOLE_ROOT, name), 'utf8')
        return !METERS.some((pattern) => pattern.test(source))
      })
    if (offenders.length > 0) {
      // Thrown rather than asserted so the guidance reaches whoever tripped
      // it — a bare array diff would not say what to do about it.
      throw new Error(
        `These routes create or re-price a plan subscription but never ` +
          `resolve the metered usage price:\n\n` +
          `${offenders.map((name) => `  • ${name}`).join('\n')}\n\n` +
          `A subscription without the metered item bills NO usage overage, ` +
          `forever, with no visible symptom — the plan, the entitlements and ` +
          `the invoice all look correct (AGL-1352). Attach it with ` +
          `meteredPriceId(interval) — the argument is required because Stripe ` +
          `rejects mixed recurring.interval on one subscription (AGL-1340). ` +
          `If the path is metered elsewhere or deliberately unmetered, add it ` +
          `to EXEMPT in this spec WITH A REASON.`,
      )
    }
  })

  it('the webhook CALLS the back-fill, not merely imports it', () => {
    // The exact shape of AGL-1352 was a capability that existed and was never
    // invoked, so an import is not evidence of anything.
    const source = readFileSync(
      join(API_ROOT, 'billing', 'webhook', 'route.ts'),
      'utf8',
    )
    expect(source).toMatch(
      /import\s*\{[^}]*\bbackfillMeteredItem\b[^}]*\}\s*from\s*'[^']*metered-backfill'/s,
    )
    expect(source).toMatch(/\bmeteredBackfillDecision\s*\(\s*\{/)
    expect(source).toMatch(/await\s+backfillMeteredItem\s*\(\s*\{/)
    // Reached on the subscription events the portal and the dashboard emit.
    expect(source).toContain("type === 'customer.subscription.updated'")
  })

  it('resolves the metered price through the required-argument helper', () => {
    // A bare env read would reintroduce the monthly-price-on-an-annual-plan
    // crash the required argument exists to make unrepresentable (AGL-1340).
    for (const file of routes) {
      const name = relative(CONSOLE_ROOT, file)
      if (name.split(/[\\/]/).join('/') in EXEMPT) continue
      const source = readFileSync(file, 'utf8')
      expect(source).not.toMatch(/process\.env\.STRIPE_PRICE_METERED\b/)
      expect(source).not.toMatch(/process\.env\.STRIPE_PRICE_METERED_YEARLY\b/)
    }
    // Including the helper module itself: `meteredPriceId` is the ONE place
    // those two env names may be spelled.
    const helper = readFileSync(
      join(CONSOLE_ROOT, 'utils', 'server', 'metered-backfill.ts'),
      'utf8',
    )
    expect(helper).not.toMatch(/process\.env\.STRIPE_PRICE_METERED/)
  })
})
