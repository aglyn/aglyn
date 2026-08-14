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
 * AGL-1582 — which console sessions count as our own traffic.
 *
 * The impersonation case is the whole reason this predicate is a named
 * function rather than an inline `claims.staff` read, so it is pinned here:
 * an impersonation token belongs to the CUSTOMER and carries `staff: false`,
 * and the obvious simplification of this function silently stops flagging the
 * traffic it exists for. A GA4 data filter is not retroactive, so that
 * regression would not be recoverable after the fact.
 */

import {
  INTERNAL_TRAFFIC_PARAM,
  INTERNAL_TRAFFIC_VALUE,
  isInternalTrafficSession,
} from '../utils/internal-traffic'

describe('isInternalTrafficSession (AGL-1582)', () => {
  it('flags a staff session', () => {
    expect(isInternalTrafficSession({ staff: true })).toBe(true)
  })

  it('flags an impersonation session, whose token is the CUSTOMER’s', () => {
    // What /api/admin/impersonate actually mints: the target account's token,
    // with `impersonatedBy` naming the staff actor. `staff` is false because
    // staff accounts cannot be impersonated at all — so a `claims.staff` read
    // would report this customer-shaped token as real user traffic.
    expect(
      isInternalTrafficSession({
        staff: false,
        impersonatedBy: 'staff-uid-1',
        impersonatedByEmail: 'zach@aglyn.com',
      }),
    ).toBe(true)
  })

  it('does NOT flag an ordinary customer session', () => {
    // The expensive direction: a false positive here deletes a paying
    // customer from every launch metric.
    expect(isInternalTrafficSession({ email_verified: true })).toBe(false)
  })

  it('does not flag a session whose claims are missing or unreadable', () => {
    expect(isInternalTrafficSession(null)).toBe(false)
    expect(isInternalTrafficSession(undefined)).toBe(false)
    expect(isInternalTrafficSession({})).toBe(false)
  })

  it('treats falsy claim values as not internal', () => {
    // A revoked staff grant leaves the key present and false rather than
    // removing it.
    expect(
      isInternalTrafficSession({ staff: false, impersonatedBy: '' }),
    ).toBe(false)
  })

  it('uses the parameter name and value GA4’s built-in filter matches', () => {
    // These two strings have to agree with a setting in the GA UI that no
    // typechecker can see. If either changes, the filter silently stops
    // matching and staff traffic rejoins the metrics.
    expect(INTERNAL_TRAFFIC_PARAM).toBe('traffic_type')
    expect(INTERNAL_TRAFFIC_VALUE).toBe('internal')
  })
})
