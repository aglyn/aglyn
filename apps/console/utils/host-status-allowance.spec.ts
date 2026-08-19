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

import { resolveOrgEntitlements, UNLIMITED } from '@aglyn/aglyn'
import { describeSiteAllowance } from './host-status'

/**
 * The site-allowance line, against the values the entitlement table really
 * produces (AGL-2223).
 *
 * `describeSiteAllowance` tested `limit < 0` for "unlimited". `UNLIMITED` is
 * `Number.POSITIVE_INFINITY`, so that branch was unreachable for the only plan
 * it existed to serve, and an Enterprise organization read
 * `4 of Infinity sites · Enterprise plan` opposite the Sites heading.
 *
 * The lesson is in how it was written rather than in the arithmetic: the
 * existing tests fed the function hand-picked numbers, and `-1` is a plausible
 * way to spell "no limit" for anyone not looking at `plan-entitlements.ts`. So
 * this spec takes its limit from `resolveOrgEntitlements` rather than from a
 * literal — a fixture that agrees with the code under test about a value
 * neither of them gets from the real source proves only that they agree.
 */
describe('the site allowance line (AGL-2223)', () => {
  const enterpriseLimit = resolveOrgEntitlements({
    plan: 'enterprise',
  } as never).hostLimit

  it('the enterprise host limit really is the unlimited sentinel', () => {
    // Anti-vacuity for the case below: if this ever became a finite number the
    // next assertion would pass for the wrong reason.
    expect(enterpriseLimit).toBe(UNLIMITED)
    expect(Number.isFinite(enterpriseLimit)).toBe(false)
  })

  it('reads Unlimited for the enterprise limit, not Infinity', () => {
    expect(
      describeSiteAllowance({
        used: 4,
        limit: enterpriseLimit,
        planLabel: 'Enterprise',
        ready: true,
      }),
    ).toBe('4 of Unlimited sites · Enterprise plan')
  })

  it('still reads a finite cap as a number', () => {
    expect(
      describeSiteAllowance({
        used: 6,
        limit: 10,
        planLabel: 'Business',
        ready: true,
      }),
    ).toBe('6 of 10 sites · Business plan')
    expect(
      describeSiteAllowance({
        used: 1,
        limit: 1,
        planLabel: 'Free',
        ready: true,
      }),
    ).toBe('1 of 1 site · Free plan')
  })

  it('still treats a negative override as unlimited', () => {
    expect(
      describeSiteAllowance({
        used: 2,
        limit: -1,
        planLabel: 'Enterprise',
        ready: true,
      }),
    ).toBe('2 of Unlimited sites · Enterprise plan')
  })

  it('says nothing at all until the organization has resolved', () => {
    // An unresolved org resolves to FREE, and telling a Business customer they
    // are at "1 of 1 sites" is a correct-looking page delivering a false
    // upgrade prompt.
    expect(
      describeSiteAllowance({
        used: 6,
        limit: 1,
        planLabel: 'Free',
        ready: false,
      }),
    ).toBeUndefined()
    expect(
      describeSiteAllowance({
        used: 6,
        limit: 10,
        planLabel: undefined,
        ready: true,
      }),
    ).toBeUndefined()
  })
})
