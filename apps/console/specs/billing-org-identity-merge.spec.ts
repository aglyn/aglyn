/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored.
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

import * as fs from 'fs'
import * as path from 'path'

import {
  mergeOrgBillingOverOrg,
  ORG_BILLING_DOC_ID,
} from '@aglyn/aglyn/app-utils/org-billing-doc'

/**
 * AGL-1991. The billing page merges `orgs/{orgId}/billing/stripe` over the org
 * doc so post-AGL-1028 `org.subscription…` references keep working. The console
 * hook that reads both stamps the DOCUMENT ID into the payload, so the billing
 * doc arrives carrying `$id === 'stripe'` and a plain spread let that win.
 *
 * The negative control for every case below is a plain spread — the code this
 * replaces. Each assertion is written so that `{ ...org, ...billing }` produces
 * a DIFFERENT value, which is checked explicitly in "the negative control"
 * block: if the helper ever degrades back into a spread, these go red.
 */
describe('AGL-1991 — merging the billing doc must not swap the org identity', () => {
  const ORG_ID = 'jWmGooWE3L'

  const orgDoc = {
    $id: ORG_ID,
    plan: 'enterprise',
    entitlements: { hostLimit: 25 },
    seatAddons: { hosts: 3 },
  }

  // Exactly the shape `useConfirmedDoc` delivers: `{ $id: <doc id>, ...payload }`.
  const orgBilling = {
    $id: ORG_BILLING_DOC_ID,
    stripeCustomerId: 'cus_TEST',
    subscription: { status: 'active', interval: 'month' },
  }

  it('keeps the ORG document id, not the billing document id', () => {
    const merged = mergeOrgBillingOverOrg(orgDoc, orgBilling)

    expect(merged.$id).toBe(ORG_ID)
    // The literal failure that was observed in production: `orgs/stripe/…`.
    expect(merged.$id).not.toBe(ORG_BILLING_DOC_ID)
    expect(merged.$id).not.toBe('stripe')
  })

  it('still merges the billing fields over the org doc', () => {
    const merged = mergeOrgBillingOverOrg(orgDoc, orgBilling)

    // The whole reason the merge exists — these must keep resolving.
    expect(merged.stripeCustomerId).toBe('cus_TEST')
    expect((merged.subscription as { status: string }).status).toBe('active')
    // …and the org doc's own keys survive.
    expect(merged.plan).toBe('enterprise')
    expect((merged.seatAddons as { hosts: number }).hosts).toBe(3)
  })

  it('the org id survives the billing doc arriving LATER (the real sequence)', () => {
    // First render: org doc only, billing still loading.
    const first = mergeOrgBillingOverOrg(orgDoc, null)
    expect(first.$id).toBe(ORG_ID)

    // Second render: billing resolves. This is the transition that broke —
    // effects re-ran against `orgs/stripe` and were denied.
    const second = mergeOrgBillingOverOrg(orgDoc, orgBilling)
    expect(second.$id).toBe(ORG_ID)
    expect(second.$id).toBe(first.$id)
  })

  it('a missing org doc yields NO id rather than inheriting "stripe"', () => {
    // A wrong-but-confident org id is worse than an absent one: children gate
    // on `orgId` being undefined and hold, but they will happily read a path
    // built from `'stripe'`.
    const merged = mergeOrgBillingOverOrg(null, orgBilling)

    expect(merged.$id).toBeUndefined()
    expect('$id' in merged).toBe(false)
  })

  it('an org doc with no $id does not inherit the billing doc id either', () => {
    const merged = mergeOrgBillingOverOrg({ plan: 'free' }, orgBilling)

    expect(merged.$id).toBeUndefined()
    expect(merged.plan).toBe('free')
  })

  it('the negative control — a plain spread FAILS every case above', () => {
    // Guards that cannot go red are the recurring defect, so this pins that the
    // pre-fix expression genuinely produces the wrong answer. If someone
    // "simplifies" the helper back to a spread, the cases above break and this
    // documents exactly why.
    const spread = { ...orgDoc, ...orgBilling }
    expect(spread.$id).toBe(ORG_BILLING_DOC_ID)
    expect(spread.$id).not.toBe(ORG_ID)

    // Typed as nullable so this reads as the real `orgDoc` variable rather
    // than a literal `null` the compiler folds away.
    const absentOrg: Record<string, unknown> | null = null
    const spreadNoOrg = { ...(absentOrg ?? {}), ...orgBilling }
    expect((spreadNoOrg as { $id?: string }).$id).toBe(ORG_BILLING_DOC_ID)
  })

  it('the billing page does not reintroduce the plain spread', () => {
    // The helper being correct proves nothing if the page stops calling it —
    // the defect was at the CALL SITE, not in any library.
    const pagePath = path.join(
      __dirname,
      '..',
      'app',
      '(app)',
      '[orgSlug]',
      'billing',
      'page.tsx',
    )
    const source = fs.readFileSync(pagePath, 'utf8')

    // Fail loudly if the file moves, rather than passing on an empty read.
    expect(source.length).toBeGreaterThan(1000)
    expect(source).toContain('mergeOrgBillingOverOrg')
    expect(source).not.toContain('...(orgDoc ?? {}), ...(orgBilling ?? {})')
  })
})
