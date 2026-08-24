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

import { billingHrefFor, resolveBillingEntry } from './billing-entry'

/**
 * The one decision behind `/billing` (AGL-2430), driven per branch.
 *
 * The href is asserted through `buildRoute`, never as a hand-typed string:
 * the whole point of the entry point is that Stripe's one static link
 * resolves to whatever the route table says billing is, so a spec that
 * transcribes `/acme/billing` would keep passing after the table moved.
 */
describe('resolveBillingEntry', () => {
  it('sends a single-workspace account straight to its billing page', () => {
    expect(
      resolveBillingEntry([{ $id: 'o1', slug: 'acme', orgName: 'Acme' }]),
    ).toEqual({
      kind: 'billing',
      href: billingHrefFor('acme'),
      org: { $id: 'o1', slug: 'acme', orgName: 'Acme' },
    })
  })

  it('offers a choice when the account manages several', () => {
    const destination = resolveBillingEntry([
      { $id: 'o1', slug: 'acme' },
      { $id: 'o2', slug: 'globex' },
    ])
    expect(destination.kind).toBe('choose')
    expect(
      destination.kind === 'choose'
        ? destination.orgs.map((org) => billingHrefFor(org.slug as string))
        : null,
    ).toEqual([billingHrefFor('acme'), billingHrefFor('globex')])
  })

  it('says there is nothing to bill when the account has no workspace', () => {
    expect(resolveBillingEntry([])).toEqual({ kind: 'no-workspace' })
    expect(resolveBillingEntry(null)).toEqual({ kind: 'no-workspace' })
    expect(resolveBillingEntry(undefined)).toEqual({ kind: 'no-workspace' })
  })

  /**
   * A membership row with no slug cannot be linked to at all, so it is
   * dropped BEFORE the count is taken. Counting first would turn one real
   * workspace beside one broken projection into a picker holding a card
   * whose only button goes to `/undefined/billing`.
   */
  it('drops an unlinkable membership before counting, not after', () => {
    expect(
      resolveBillingEntry([{ $id: 'o1' }, { $id: 'o2', slug: 'acme' }]),
    ).toEqual({
      kind: 'billing',
      href: billingHrefFor('acme'),
      org: { $id: 'o2', slug: 'acme' },
    })
    expect(resolveBillingEntry([{ $id: 'o1' }, { $id: 'o2', slug: '' }])).toEqual(
      { kind: 'no-workspace' },
    )
  })

  /**
   * THE DEADLOCK GUARD (AGL-2430). A workspace whose card just failed is the
   * likeliest arrival at this entry point, and a locked or delinquent one is
   * the case the whole feature exists for. Nothing about suspension may
   * change the answer — the resolver is not given a place to look.
   *
   * Compared against the HEALTHY answer for the same slug rather than
   * against a transcribed destination, so it fails the moment someone adds a
   * filter, no matter which shape of "skip the locked ones" they reach for.
   */
  it('routes a suspended, past-due workspace exactly like a healthy one', () => {
    const delinquent = {
      $id: 'o1',
      slug: 'acme',
      orgName: 'Acme',
      suspendedAt: 1_755_043_200_000,
      suspendedReasonCode: 'billing',
      billingStatus: 'past_due',
    } as never
    const verdict = ({ kind, href }: { kind: string; href?: string }) => ({
      kind,
      href,
    })
    expect(verdict(resolveBillingEntry([delinquent]) as never)).toEqual(
      verdict(
        resolveBillingEntry([{ $id: 'o1', slug: 'acme', orgName: 'Acme' }]) as never,
      ),
    )
    expect(resolveBillingEntry([delinquent]).kind).toBe('billing')
  })
})
