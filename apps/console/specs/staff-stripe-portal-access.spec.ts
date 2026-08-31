/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
 *
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

import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * SUPPORT KEEPS A DOOR INTO STRIPE'S OWN VIEW OF A CUSTOMER.
 *
 * The console owns payment methods, invoices and the plan switch in its own
 * design, so the Billing Portal is not a customer surface — sending a paying
 * customer out to a second product to do what this app already does is the
 * thing being removed, not preserved.
 *
 * What the portal still holds is the part nobody can reconstruct from our
 * mirrors: raw payment-method state, the dunning attempt history, and the tax
 * ids exactly as Stripe recorded them. Someone diagnosing "my card was
 * declined and I do not know why" needs that. Removing every entry point at
 * once would trade a visible wart for a blind spot, and a blind spot in
 * support is invisible until the ticket that needs it arrives.
 *
 * So there is exactly one door, on the staff org page, behind `StaffOnly`.
 *
 * WHAT THIS FILE CAN AND CANNOT SEE. These are SOURCE assertions: the staff
 * page is the console's largest client component and is not rendered in any
 * suite. A green here means the entry point and its authority are still
 * wired; it is not an observation of an operator opening a real portal.
 */

const REPO_ROOT = resolve(__dirname, '../../..')
const read = (path: string) => readFileSync(join(REPO_ROOT, path), 'utf8')

const STAFF_ORG_PAGE = 'apps/console/app/(app)/admin/orgs/[orgId]/page.tsx'
const SUBSCRIPTION_ROUTE = 'apps/console/app/api/billing/subscription/route.ts'

describe('the staff door into a customer’s Stripe portal', () => {
  it('PREMISE — both files exist and are the ones this suite thinks they are', () => {
    // Without this, a moved file would make every assertion below vacuous:
    // `not.toContain` on a string that was never there is always green.
    expect(read(STAFF_ORG_PAGE)).toContain('Billing history & payment method')
    expect(read(SUBSCRIPTION_ROUTE)).toContain('billing_portal/sessions')
  })

  it('the staff org page asks the subscription route for a portal session', () => {
    const source = read(STAFF_ORG_PAGE)
    expect(source).toContain("action: 'portal'")
    // `authorizedFetch`, not a bare `fetch`: the route answers 401 without a
    // bearer token, so a header assembled conditionally would send an
    // operator's portal request anonymously and report it as a refusal.
    expect(source).toMatch(
      /authorizedFetch\(\s*user,\s*'\/api\/billing\/subscription'/,
    )
    expect(source).toContain('Open Stripe billing portal')
  })

  it('opens it in a new tab, so the investigation keeps its place', () => {
    // `location.assign` is what the customer-side handler does, and it is
    // wrong here: it navigates the operator's org page away to Stripe.
    const source = read(STAFF_ORG_PAGE)
    expect(source).toContain("window.open(String(payload.url), '_blank'")
  })

  it('needs no new authority — the route already admits staff on any org', () => {
    // This is the load-bearing half. A staff member is not a member of the
    // customer's org, so an entry point that relied on `billing.manage`
    // would 403 for exactly the person it was built for.
    const source = read(SUBSCRIPTION_ROUTE)
    expect(source).toContain("const isStaff = decoded['staff'] === true")
    expect(source).toMatch(/!isStaff\s*&&\s*\n?\s*!\(await memberHasOrgPermission\(/)
  })

  it('REFUSAL — a caller who is neither staff nor billing.manage is turned away', () => {
    const source = read(SUBSCRIPTION_ROUTE)
    expect(source).toContain("{ error: 'billing.manage required' }, { status: 403 }")
  })
})

/**
 * The customer side of the same decision. `pay-invoice` is the native
 * settlement path; until it has been exercised against a real failed payment
 * INCLUDING the bank-challenge leg, the portal stays reachable from
 * `Outstanding` — the one place its absence would cost somebody money.
 *
 * This is a deliberate hold, so it is written down rather than left to be
 * rediscovered. Deleting the portal link from the Outstanding card is the
 * change this guard exists to make someone justify.
 */
describe('the customer-facing portal is confined to dunning recovery', () => {
  const OUTSTANDING_CARD =
    'apps/console/components/billing/billing-open-invoices-card.component.tsx'
  const BILLING_PAGE =
    'apps/console/app/(app)/[orgSlug]/billing/(sections)/page.tsx'

  it('PREMISE — the Outstanding card is where the portal link lives', () => {
    expect(read(OUTSTANDING_CARD)).toContain('Open the Stripe billing portal')
  })

  it('the plan card sends "Manage payment methods" to Settings, not to Stripe', () => {
    const source = read(BILLING_PAGE)
    const at = source.indexOf("{'Manage payment methods'}")
    expect(at).toBeGreaterThan(-1)
    // The button and the portal handler are different jobs; the surface that
    // manages payment methods is the one the button is named after.
    const around = source.slice(Math.max(0, at - 900), at)
    expect(around).toContain('Route.MANAGE_BILLING_SETTINGS')
    expect(around).not.toContain('handleOpenPortal')
  })

  it('no OTHER customer surface grows a portal entry point', () => {
    // The settings and usage sections are the two customer billing surfaces
    // that could plausibly acquire one. Neither should.
    for (const path of [
      'apps/console/app/(app)/[orgSlug]/billing/(sections)/settings/page.tsx',
      'apps/console/app/(app)/[orgSlug]/billing/(sections)/usage/page.tsx',
    ]) {
      const source = read(path)
      // PREMISE for this loop: the file is a real billing section.
      expect(source).toContain('CardDisplay')
      expect(source).not.toContain("action: 'portal'")
    }
  })
})
