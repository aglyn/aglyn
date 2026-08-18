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
  'storage-overage':
    'NO SURFACE, and that is a known defect rather than a decision — tracked in AGL-1957. It is Bearer-authenticated and `billing.manage`-gated, so it is a customer consent surface with no way for a customer to reach it, exactly the AGL-1947 shape. Listed here so the guard stays green while the gap stays VISIBLE; removing this entry is the acceptance test for AGL-1957.',
}

/** Routes we know exist, so a collapsed sweep cannot pass vacuously. */
const KNOWN_ROUTES = [
  'addons',
  'checkout',
  'register-allocations',
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
    output = execFileSync(
      'git',
      ['grep', '-l', '--', `/api/billing/${route}`, '--', ...CLIENT_ROOTS],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    )
  } catch {
    // `git grep` exits 1 on no matches. That is a legitimate answer here.
    return []
  }
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => /\.tsx?$/.test(file))
    .filter((file) => !file.includes('/app/api/'))
    .filter((file) => !/\.spec\.tsx?$/.test(file))
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
})
