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
 * Every customer-facing billing route must have a place a customer can reach
 * it from (AGL-1947, the AGL-1900 rule).
 *
 * `/api/billing/register-allocations` shipped complete and correct — pool
 * arithmetic, permission gate, over-allocation refusal, audit row — and no
 * screen in the product called it. A merchant could buy POS register seats at
 * $89/mo and had nowhere to assign them. That is worse than not selling the
 * add-on: it is money taken for capacity the product gives no way to deploy.
 *
 * The failure has no symptom anywhere. The route's own specs pass, its
 * permission gate is right, `nx build` is green, and nothing in the repo is
 * broken — the endpoint simply sits there. Only a sweep can find it, because
 * every individual artifact is fine.
 *
 * ## Why a CLIENT reference, not any reference
 *
 * The obvious version of this check — "is the path mentioned anywhere?" —
 * would have been satisfied by this very spec file, and by a doc, and by
 * Next's generated `.next/dev/types/routes.d.ts`. A guard a test can satisfy
 * by naming the thing it guards proves nothing. So the reference must come
 * from a component, page, hook or util: somewhere a browser can actually
 * originate the call.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = join(__dirname, '..', '..', '..')
const BILLING_API = join(REPO_ROOT, 'apps', 'console', 'app', 'api', 'billing')

/**
 * Where a call may legitimately originate. Deliberately excludes
 * `apps/console/app/api/**` (a route calling a route is not a surface),
 * every `*.spec.*` file, and all build output.
 */
const CLIENT_ROOTS = [
  'apps/console/components',
  'apps/console/app',
  'apps/console/hooks',
  'apps/console/utils',
  'libs',
]

/**
 * Routes with no client caller BY DESIGN. A reason is mandatory: the point of
 * the sweep is that "we decided" is recorded, not that the list is short.
 */
const EXEMPT: Record<string, string> = {
  'report-usage':
    'Cron-invoked usage rollup (AGL-635). It is called on a schedule by Vercel Cron against the deployed URL, so there is no in-repo caller and there should not be one — a browser-originated call would let a client decide when usage is billed.',
  // The three AGL-2115 uncovered. All were already passing, on a comment
  // apiece, so none is a new exemption in substance — but each is now a
  // recorded decision instead of an accident of how the grep worked.
  'usage-alerts':
    'Cron-invoked threshold sweep (AGL-1528/AGL-2052), scheduled in .github/workflows/scheduled-crons.yml and gated on CRON_SECRET, which no browser holds. It sends the 80%/100% notification and email; a client-triggered run would let a customer decide when they are warned, and re-triggering it is how alert state gets churned. The customer-facing half of this feature IS surfaced — the budget it reads is set on the Billing page through /api/billing/usage-budget.',
  'usage-email':
    'Cron-invoked monthly usage summary, scheduled alongside the alerts sweep and gated on CRON_SECRET. Nothing a customer does should send themselves a billing email on demand; the same figures are readable any time on the Billing page.',
  webhook:
    'Stripe webhook endpoint. Called by Stripe with a signed payload and verified against STRIPE_WEBHOOK_SECRET — it is the ONLY thing that fulfils a subscription change, so a browser-originated call is precisely what the signature check exists to refuse.',
}

/** Routes we know exist, so a collapsed sweep cannot pass vacuously. */
const KNOWN_ROUTES = [
  'addons',
  'checkout',
  'register-allocations',
  'storage-overage',
  'subscription',
  'webhook',
]

function billingRoutes(): string[] {
  return readdirSync(BILLING_API, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(join(BILLING_API, entry.name, 'route.ts')),
    )
    .map((entry) => entry.name)
}

/**
 * Files outside the route's own directory that reference `/api/billing/<name>`
 * from somewhere a browser can originate the call.
 *
 * `git grep` rather than a filesystem walk: it respects `.gitignore`, so
 * `.next/` build output — which mentions every route path and would satisfy
 * this check for all of them — cannot be counted.
 */
function clientCallers(route: string): string[] {
  let output = ''
  try {
    // `-n`, not `-l` (AGL-2115). The line is needed to tell a call from a
    // comment ABOUT a call; see `isCommentLine`.
    output = execFileSync(
      'git',
      ['grep', '-n', '--', `/api/billing/${route}`, '--', ...CLIENT_ROOTS],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    )
  } catch {
    // `git grep` exits 1 on no matches. That is a legitimate answer here.
    return []
  }
  const files = new Set<string>()
  for (const line of output.split('\n')) {
    if (!line.trim()) continue
    // `path:lineno:content` — the content may itself contain colons, so
    // split only the first two fields.
    const firstColon = line.indexOf(':')
    const secondColon = line.indexOf(':', firstColon + 1)
    if (firstColon < 0 || secondColon < 0) continue
    const file = line.slice(0, firstColon)
    const content = line.slice(secondColon + 1)
    if (!/\.tsx?$/.test(file)) continue
    if (file.includes('/app/api/')) continue
    if (/\.spec\.tsx?$/.test(file)) continue
    if (isNonCallReference(content, route)) continue
    files.add(file)
  }
  return [...files]
}

/**
 * Whether a matching line NAMES the route rather than CALLS it (AGL-2115).
 *
 * THE DEFECT THIS CLOSES. `git grep -l` answers "does this file contain the
 * string", and three routes passed this sweep on a mention alone. Both
 * shapes were live in the repo, and they are different:
 *
 * 1. **Prose.** `usage-alerts` was satisfied by a doc comment in
 *    `billing-auto-lock.ts`, `webhook` by a comment in
 *    `embedded-checkout-dialog.component.tsx`.
 * 2. **A repo path.** `usage-email` was satisfied by
 *    `source: 'apps/console/app/api/billing/usage-email/route.ts'` in the
 *    system-email catalog — real code, on a real code line, and still not a
 *    call: it is provenance metadata saying where the sender lives. A
 *    comment filter alone does not catch this one, which is why the first
 *    version of this fix went red here and was widened rather than trimmed.
 *
 * All three are genuinely exempt, so nothing was broken; what was broken is
 * the guard. A future billing route whose only mention is the comment
 * explaining why nobody calls it — or the catalog row pointing at its file —
 * would have shipped with no surface and a green check. This is the AGL-1900
 * rule applied to its own instrument.
 *
 * Deliberately conservative in both directions. It rejects only a line whose
 * FIRST non-space characters open or continue a comment, so a real
 * `fetch('/api/billing/x')` with a trailing `// note` still counts; and it
 * rejects a path reference only when the match is bounded as a module path
 * (`app/api/…` before, or `/route.ts` after). A false RED here is as broken
 * as a false green — it would send someone to build a surface that exists.
 */
function isNonCallReference(content: string, route: string): boolean {
  const trimmed = content.trim()
  if (
    trimmed.startsWith('*') ||
    trimmed.startsWith('//') ||
    trimmed.startsWith('/*')
  ) {
    return true
  }
  // A reference to the route's own MODULE, not its URL.
  const path = `/api/billing/${route}`
  return (
    content.includes(`app${path}`) || content.includes(`${path}/route.ts`)
  )
}

describe('every customer-facing billing route has a surface (AGL-1947)', () => {
  const routes = billingRoutes()

  it('finds the billing routes at all', () => {
    // A sweep that enumerates nothing passes vacuously — the failure mode of
    // every source guard. Anchor it on routes we KNOW are there.
    expect(routes.length).toBeGreaterThanOrEqual(10)
    for (const known of KNOWN_ROUTES) {
      expect(`${known}: present`).toBe(
        `${known}: ${routes.includes(known) ? 'present' : 'MISSING'}`,
      )
    }
  })

  it('can tell a called route from an uncalled one', () => {
    // The guard's own instrument, checked before it is trusted. `checkout` is
    // called from the billing page; a route name that does not exist is
    // called from nowhere. If both answered the same, every assertion below
    // would be meaningless.
    expect(clientCallers('checkout').length).toBeGreaterThan(0)
    expect(clientCallers('no-such-route-xyz')).toHaveLength(0)
  })

  it('does not count a MENTION of a route as a surface (AGL-2115)', () => {
    // The instrument, checked before it is trusted — the same discipline the
    // called/uncalled check above applies. These are the exact lines that let
    // three routes pass this sweep without a caller.
    expect(
      isNonCallReference(
        ' * apps/console/app/api/billing/usage-alerts/route.ts.',
        'usage-alerts',
      ),
    ).toBe(true)
    expect(
      isNonCallReference('  // calls /api/billing/webhook eventually', 'webhook'),
    ).toBe(true)
    // The one a comment filter alone misses: real code, real code line, and
    // still provenance rather than a call.
    expect(
      isNonCallReference(
        `      source: 'apps/console/app/api/billing/usage-email/route.ts',`,
        'usage-email',
      ),
    ).toBe(true)
    // And a real call still counts, including one with a trailing comment —
    // a guard that rejected those would be a false RED, which is as broken
    // as a false green and sends someone to rebuild a surface that exists.
    expect(
      isNonCallReference(`  await fetch('/api/billing/addons', {`, 'addons'),
    ).toBe(false)
    expect(
      isNonCallReference(
        `  const r = fetch('/api/billing/addons') // note`,
        'addons',
      ),
    ).toBe(false)
  })

  it('the three mention-only routes are now exempt by decision, not by accident', () => {
    // Each was green before AGL-2115 on a mention alone. Discounting mentions
    // turns them red unless the exemption is recorded — so this asserts the
    // recording, and that they really do have no caller left.
    for (const route of ['usage-alerts', 'usage-email', 'webhook']) {
      expect(`${route}: ${EXEMPT[route] ? 'recorded' : 'UNRECORDED'}`).toBe(
        `${route}: recorded`,
      )
      expect(clientCallers(route)).toHaveLength(0)
    }
  })

  it('does not count the route itself, a spec, or build output as a surface', () => {
    // The three ways this check could be satisfied without a customer ever
    // being able to reach the endpoint.
    for (const file of clientCallers('register-allocations')) {
      expect(`${file}: countable`).toBe(
        `${file}: ${
          file.includes('/app/api/') ||
          /\.spec\.tsx?$/.test(file) ||
          file.includes('.next/')
            ? 'NOT countable'
            : 'countable'
        }`,
      )
    }
  })

  it.each(
    billingRoutes().map((route) => [route] as [string]),
  )('%s is reachable from a client surface', (route: string) => {
    if (EXEMPT[route]) {
      expect(EXEMPT[route].length).toBeGreaterThan(40)
      return
    }
    const callers = clientCallers(route)
    expect(
      `${route}: ${callers.length > 0 ? 'has a surface' : 'NO CALLER'}`,
    ).toBe(`${route}: has a surface`)
  })

  it('register-allocations specifically is wired to the billing page', () => {
    // The regression test for this issue by name. The card must exist AND the
    // page must render it — a component nothing mounts is the same defect one
    // layer in.
    const callers = clientCallers('register-allocations')
    expect(
      callers.some((file) =>
        file.includes('billing-register-allocations-card.component.tsx'),
      ),
    ).toBe(true)

    const page = execFileSync(
      'git',
      ['grep', '-c', '--', 'BillingRegisterAllocationsCardComponent', '--', 'apps/console/app'],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    )
    // Imported and rendered: two occurrences on the billing page.
    expect(page).toMatch(/billing\/page\.tsx:[2-9]/)
  })

  it('storage-overage specifically is wired to the billing page (AGL-1957)', () => {
    // The second instance of the same defect, and the worse one: the media
    // ingress gate refuses an upload with "turn it on in Billing", and until
    // AGL-1957 there was nothing in Billing to turn on. The refusal pointed
    // customers at a control that did not exist.
    const callers = clientCallers('storage-overage')
    expect(
      callers.some((file) =>
        file.includes('billing-storage-overage-card.component.tsx'),
      ),
    ).toBe(true)

    const page = execFileSync(
      'git',
      [
        'grep',
        '-c',
        '--',
        'BillingStorageOverageCardComponent',
        '--',
        'apps/console/app',
      ],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    )
    expect(page).toMatch(/billing\/page\.tsx:[2-9]/)
  })

  it('the exemption list records decisions, never open defects (AGL-1957)', () => {
    // `storage-overage` sat in EXEMPT with a reason that said, in terms, "this
    // is a known defect". That was the right way to keep a gap visible while
    // it was open — and it is exactly what must not survive the fix, or the
    // list quietly becomes the place uncalled routes go to stop being
    // counted. An exemption is "we decided", never "we noticed".
    for (const [route, reason] of Object.entries(EXEMPT)) {
      expect(`${route}: ${/\bdefect\b|\bAGL-1957\b/i.test(reason) ? 'OPEN DEFECT' : 'a decision'}`).toBe(
        `${route}: a decision`,
      )
    }
  })
})
