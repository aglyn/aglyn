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

import {
  isSlugReservationClaimable,
  isSlugReservationLapsed,
  isWithinSignupProvisioningGrace,
  SIGNUP_PROVISIONING_GRACE_MS,
  SLUG_RESERVATION_MS,
} from './organizations'

// AGL-585: a slug an org renamed AWAY from leaves a `movedTo` tombstone so
// old URLs redirect — but it must stay claimable by anyone. Only an ACTIVE
// reservation (no movedTo) held by another org blocks a claim.
describe('isSlugReservationClaimable (AGL-585)', () => {
  it('treats a missing reservation as free', () => {
    expect(isSlugReservationClaimable(undefined, 'org-b')).toBe(true)
    expect(isSlugReservationClaimable(undefined, null)).toBe(true)
  })

  it('blocks another org’s ACTIVE slug', () => {
    expect(
      isSlugReservationClaimable({ orgId: 'org-a' }, 'org-b'),
    ).toBe(false)
    // Creation flow (no claiming org yet) is blocked the same way.
    expect(isSlugReservationClaimable({ orgId: 'org-a' }, null)).toBe(false)
  })

  it('lets an org reclaim its own reservation (moving back)', () => {
    expect(
      isSlugReservationClaimable(
        { orgId: 'org-a', movedTo: 'new-slug' },
        'org-a',
      ),
    ).toBe(true)
    expect(isSlugReservationClaimable({ orgId: 'org-a' }, 'org-a')).toBe(true)
  })

  it('lets ANY org claim another org’s tombstone (the AGL-585 fix)', () => {
    // org-a renamed away (movedTo set): org-b may take the abandoned slug,
    // both on slug change and on org creation.
    expect(
      isSlugReservationClaimable(
        { orgId: 'org-a', movedTo: 'org-a-new' },
        'org-b',
      ),
    ).toBe(true)
    expect(
      isSlugReservationClaimable({ orgId: 'org-a', movedTo: 'org-a-new' }, null),
    ).toBe(true)
  })

  it('ignores empty/false movedTo values (still an active reservation)', () => {
    expect(
      isSlugReservationClaimable({ orgId: 'org-a', movedTo: '' }, 'org-b'),
    ).toBe(false)
    expect(
      isSlugReservationClaimable({ orgId: 'org-a', movedTo: null }, 'org-b'),
    ).toBe(false)
  })
})

/*
 * AGL-2585 — the address a signup takes is HELD, not granted.
 *
 * A workspace's name is its URL, and it used to be handed over before
 * anything proved the email belonged to the person typing it. These hold the
 * two halves of the rule that ends that: a reservation with an expiry lapses,
 * and a reservation without one — every workspace made by a verified owner,
 * and every workspace that predates the field — never does.
 */
describe('isSlugReservationLapsed (AGL-2585)', () => {
  const NOW = Date.parse('2026-09-04T12:00:00Z')

  it('never lapses a GRANT', () => {
    // The load-bearing case. Every existing reservation on the platform looks
    // like this, and a rule that expired them would put every workspace URL
    // in the product up for grabs.
    expect(isSlugReservationLapsed({ orgId: 'org-a' }, NOW)).toBe(false)
    expect(isSlugReservationLapsed(undefined, NOW)).toBe(false)
  })

  it('lapses a hold whose window has run out', () => {
    expect(
      isSlugReservationLapsed({ reservedUntil: NOW - 1 }, NOW),
    ).toBe(true)
    expect(isSlugReservationLapsed({ reservedUntil: NOW }, NOW)).toBe(true)
  })

  it('holds a reservation that is still inside its window', () => {
    expect(
      isSlugReservationLapsed(
        { reservedUntil: NOW + SLUG_RESERVATION_MS },
        NOW,
      ),
    ).toBe(false)
  })

  it('never lapses on an expiry it cannot read', () => {
    // A corrupt or half-written expiry is a reason to leave an address alone.
    for (const reservedUntil of [
      '1757000000000',
      null,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      {},
      true,
    ]) {
      expect(isSlugReservationLapsed({ reservedUntil }, NOW)).toBe(false)
    }
  })

  it('makes a lapsed hold claimable and an unexpired one not', () => {
    expect(
      isSlugReservationClaimable(
        { orgId: 'org-a', reservedUntil: NOW - 1 },
        'org-b',
        NOW,
      ),
    ).toBe(true)
    expect(
      isSlugReservationClaimable(
        { orgId: 'org-a', reservedUntil: NOW + 1 },
        'org-b',
        NOW,
      ),
    ).toBe(false)
    // And a grant is still refused, which is the whole of AGL-585 unchanged.
    expect(
      isSlugReservationClaimable({ orgId: 'org-a' }, 'org-b', NOW),
    ).toBe(false)
  })

  it('holds the address for longer than the reaper waits', () => {
    // The ordering the two mechanisms depend on: the ordinary way an address
    // comes back is the sweep erasing the workspace at seven days, and this
    // window is the sweep's outage budget rather than a second deadline
    // racing it.
    expect(SLUG_RESERVATION_MS).toBeGreaterThan(7 * 24 * 60 * 60 * 1000)
  })
})

// AGL-1523: the signup flow posts its collected org name seconds after
// account creation — a moment at which a password account is ALWAYS
// unverified. The grace admits exactly that shape (brand-new account, no org
// yet) and nothing else; everything malformed fails CLOSED.
describe('isWithinSignupProvisioningGrace (AGL-1523)', () => {
  const NOW = Date.parse('2026-08-14T00:00:00Z')
  const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString()

  it('admits a brand-new account with no org (the signup moment)', () => {
    expect(
      isWithinSignupProvisioningGrace({
        creationTime: iso(30_000),
        ownsAnyOrg: false,
        now: NOW,
      }),
    ).toBe(true)
  })

  it('tolerates slight clock skew (creation "in the future")', () => {
    expect(
      isWithinSignupProvisioningGrace({
        creationTime: iso(-5_000),
        ownsAnyOrg: false,
        now: NOW,
      }),
    ).toBe(true)
  })

  it('denies once the account already owns an org — grace is ONE workspace', () => {
    expect(
      isWithinSignupProvisioningGrace({
        creationTime: iso(30_000),
        ownsAnyOrg: true,
        now: NOW,
      }),
    ).toBe(false)
  })

  it('denies an old unverified account — the AGL-479 gate stands', () => {
    expect(
      isWithinSignupProvisioningGrace({
        creationTime: iso(SIGNUP_PROVISIONING_GRACE_MS + 1),
        ownsAnyOrg: false,
        now: NOW,
      }),
    ).toBe(false)
  })

  it('admits right up to the window edge', () => {
    expect(
      isWithinSignupProvisioningGrace({
        creationTime: iso(SIGNUP_PROVISIONING_GRACE_MS),
        ownsAnyOrg: false,
        now: NOW,
      }),
    ).toBe(true)
  })

  it('fails CLOSED on a missing or malformed creation time', () => {
    expect(
      isWithinSignupProvisioningGrace({
        creationTime: undefined,
        ownsAnyOrg: false,
        now: NOW,
      }),
    ).toBe(false)
    expect(
      isWithinSignupProvisioningGrace({
        creationTime: 'not-a-date',
        ownsAnyOrg: false,
        now: NOW,
      }),
    ).toBe(false)
  })
})
