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

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Revenue-truth guard (AGL-1070). `org.plan` is NOT revenue.
 *
 * A staff override sets `plan` and never writes `subscription`, so a comped
 * or dark-launched org resolves to a paid tier while billing nothing
 * (AGL-925). On production today THREE of four orgs are on paid tiers with
 * no subscription behind them — reading the plan column as revenue
 * overstates MRR by 4×.
 *
 * `isBillingSubscription` / `orgMonthlyRevenueUsd` encode that rule, and
 * `/api/admin/overview` uses them correctly. But the rule lived in exactly
 * one consumer with nothing keeping it there, and a second surface — a new
 * dashboard tile, a CSV export, an investor metric — summing
 * `PLAN_PRICING[org.plan]` would be quietly, confidently wrong. It would
 * look right in every environment, because the override case is invisible
 * unless you ask `subscription.status`.
 *
 * So: any file that talks about a revenue AGGREGATE and also reads `plan`
 * must go through the helpers, or be exempted here with a reason.
 *
 * Deliberately file-level rather than an AST walk, matching
 * `help-coverage.spec.ts`. It catches the real risk — a whole new revenue
 * surface computed from the wrong field — not partial misuse inside a file
 * that already imports the helpers.
 *
 * Deliberately NOT applied to files that read `PLAN_PRICING` to show a
 * customer the price they are about to pay (`www/pages/pricing.tsx`,
 * `billing-plan-cards`, `billing/page.tsx`, `billing-addons.ts`). Quoting a
 * price is a different question from aggregating revenue across orgs, and
 * folding them in would make this noisy enough that someone disables it.
 */

const REPO_ROOT = join(__dirname, '../../..')
const SCAN_ROOTS = ['apps', 'libs']

/** Words that mean "a revenue total", as opposed to one org's price. */
const AGGREGATE = /\b(mrr|arr|revenue)\b/i

/** Reading the plan field in any of the shapes used in this repo. */
const READS_PLAN = /\.plan\b|\['plan'\]|\bplan:\s/

/** The sanctioned way to turn plan state into money. */
const USES_HELPERS = /isBillingSubscription|orgMonthlyRevenueUsd/

/**
 * Files that mention both and legitimately compute nothing. Each entry is a
 * repo-relative path with a reason; the list doubles as the record of
 * deliberate exemptions. Adding one asserts the file does not derive a
 * revenue figure from `plan`.
 */
const EXCEPTIONS: Record<string, string> = {
  'libs/aglyn/src/lib/app-utils/plan-entitlements.ts':
    'Home of isBillingSubscription/orgMonthlyRevenueUsd — it IS the rule.',
  'apps/console/app/(app)/admin/overview/page.tsx':
    'Renders metrics.mrrUsd straight from /api/admin/overview; its `plan` references are the broadcast-audience selector and a per-org label, not a computation.',
  'apps/console/app/(app)/admin/orgs/[orgId]/page.tsx':
    'Enterprise custom-billing card (AGL-1110) provisions ONE org\'s custom price and shows its net margin from the entered amount; the "MRR" mention is a doc comment. It reads the truthful subscription.customMonthlyUsd, never sums PLAN_PRICING[plan] across orgs.',
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
      if (entry.name.startsWith('.')) continue
      walk(full, out)
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.spec\.tsx?$/.test(entry.name) &&
      !/\.d\.ts$/.test(entry.name)
    ) {
      out.push(full)
    }
  }
  return out
}

describe('revenue is derived from billing state, never from org.plan (AGL-1070)', () => {
  const offenders = SCAN_ROOTS.flatMap((root) =>
    walk(join(REPO_ROOT, root)),
  ).filter((file) => {
    const source = readFileSync(file, 'utf8')
    if (!AGGREGATE.test(source) || !READS_PLAN.test(source)) return false
    if (USES_HELPERS.test(source)) return false
    return !(relative(REPO_ROOT, file) in EXCEPTIONS)
  })

  it('has no file computing a revenue total outside the helpers', () => {
    const named = offenders.map((file) => relative(REPO_ROOT, file))
    // Thrown rather than asserted so the guidance actually reaches whoever
    // tripped it — Jest's `expect` takes no message argument, and a bare
    // array diff would not say what to do about it. Name the fix, not the
    // rule: whoever hits this is mid-feature and needs the call.
    if (named.length > 0) {
      throw new Error(
        `These files mention a revenue aggregate AND read \`plan\`, but do ` +
          `not use isBillingSubscription/orgMonthlyRevenueUsd:\n\n` +
          `${named.map((n) => `  • ${n}`).join('\n')}\n\n` +
          `org.plan is NOT revenue — a staff override sets plan and writes ` +
          `no subscription, so comped orgs read as paying (AGL-925). Gate ` +
          `on isBillingSubscription(org) and sum orgMonthlyRevenueUsd(org). ` +
          `If the file genuinely computes nothing, add it to EXCEPTIONS in ` +
          `this spec with a reason.`,
      )
    }
    expect(named).toEqual([])
  })

  it('actually scanned the tree, so an empty result means something', () => {
    // Without this, a broken walk() or a bad regex yields zero offenders and
    // the guard above passes forever while checking nothing — the failure
    // mode this repo keeps rediscovering.
    const scanned = SCAN_ROOTS.flatMap((root) => walk(join(REPO_ROOT, root)))
    expect(scanned.length).toBeGreaterThan(500)
    // If this is false the guard is pointed at the wrong tree.
    expect(scanned.some((f) => /plan-entitlements\.ts$/.test(f))).toBe(true)
  })

  it('keeps the known revenue consumer honest', () => {
    // The one surface that legitimately sums money across orgs. If someone
    // rewrites it without the helpers, that is the exact regression this
    // issue exists to prevent, and it must not merely fall out of scope.
    const route = readFileSync(
      join(REPO_ROOT, 'apps/console/app/api/admin/overview/route.ts'),
      'utf8',
    )
    expect(USES_HELPERS.test(route)).toBe(true)
    expect(AGGREGATE.test(route)).toBe(true)
  })
})
