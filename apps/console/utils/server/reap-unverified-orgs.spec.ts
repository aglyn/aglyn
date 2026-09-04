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
 * AGL-2585 — the tests that matter here are the REFUSALS.
 *
 * A reaper is judged by what it declines to destroy. The block below takes
 * one workspace that is unambiguously junk, changes exactly one fact about
 * it, and asserts that the single change is enough to save it — once per
 * fact. Any future edit that collapses two questions into one, or that lets
 * an absent lookup mean "nothing is here", fails a named test rather than
 * quietly widening what a scheduled job deletes.
 */

import {
  ORG_BIRTH_ACTIVITY_ROWS,
  planUnverifiedOrgReap,
  refuseUnverifiedOrgReap,
  UNVERIFIED_ORG_GRACE_MS,
  type UnverifiedOrgFacts,
} from './reap-unverified-orgs'

const NOW = Date.parse('2026-09-04T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000

/** A workspace a signup made and nobody ever came back to. */
function junk(overrides: Partial<UnverifiedOrgFacts> = {}): UnverifiedOrgFacts {
  return {
    orgId: 'org-junk',
    slug: 'acme-inc',
    createdAtMs: NOW - 30 * DAY,
    ownerUid: 'uid-owner',
    createdByUid: 'uid-owner',
    erasureRequested: false,
    owner: {
      uid: 'uid-owner',
      emailVerified: false,
      tenantId: null,
      providerIds: ['password'],
    },
    memberUids: ['uid-owner'],
    hostCount: 0,
    subcollections: ['members', 'billing', 'activity'],
    activityCount: ORG_BIRTH_ACTIVITY_ROWS,
    hasBillingRelationship: false,
    ...overrides,
  }
}

describe('refuseUnverifiedOrgReap — the one workspace it may erase', () => {
  it('selects a workspace with an unverified password owner and nothing in it', () => {
    // The anchor. Without this passing, every refusal below is vacuous — a
    // predicate that refuses everything proves nothing about its rules.
    expect(refuseUnverifiedOrgReap(junk(), { now: NOW })).toBeNull()
  })

  it('erases nothing at all before the grace has run', () => {
    expect(
      refuseUnverifiedOrgReap(
        junk({ createdAtMs: NOW - (UNVERIFIED_ORG_GRACE_MS - 1) }),
        { now: NOW },
      ),
    ).toBe('too-new')
    // On the boundary it is eligible — the grace is "at least this long".
    expect(
      refuseUnverifiedOrgReap(
        junk({ createdAtMs: NOW - UNVERIFIED_ORG_GRACE_MS }),
        { now: NOW },
      ),
    ).toBeNull()
  })
})

describe('⛔ refuseUnverifiedOrgReap — what it MUST NOT delete', () => {
  /*
   * One fact each, changed on an otherwise-reapable workspace. Every case
   * here is a real customer's workspace wearing junk's clothes, and the
   * assertion is that the reaper can tell.
   */
  const saved: [string, Partial<UnverifiedOrgFacts>, string][] = [
    [
      'an owner who confirmed their address',
      { owner: { ...junk().owner!, emailVerified: true } },
      'owner-verified',
    ],
    [
      'an owner no auth pool could produce',
      { owner: null },
      'owner-unknown',
    ],
    [
      'an auth record that answered for a DIFFERENT uid',
      { owner: { ...junk().owner!, uid: 'uid-someone-else' } },
      'owner-unknown',
    ],
    [
      'an owner in an enterprise SSO pool',
      { owner: { ...junk().owner!, tenantId: 'tenant-acme' } },
      'owner-in-sso-tenant',
    ],
    [
      'an owner who signed in with Google',
      { owner: { ...junk().owner!, providerIds: ['google.com'] } },
      'owner-not-password-only',
    ],
    [
      'an owner who has linked a second provider',
      {
        owner: { ...junk().owner!, providerIds: ['password', 'google.com'] },
      },
      'owner-not-password-only',
    ],
    [
      'an owner with no provider on the record at all',
      { owner: { ...junk().owner!, providerIds: [] } },
      'owner-not-password-only',
    ],
    [
      'a workspace that changed hands',
      { createdByUid: 'uid-founder' },
      'ownership-transferred',
    ],
    [
      'a workspace whose creator was never stamped',
      { createdByUid: null },
      'ownership-transferred',
    ],
    [
      'a workspace somebody has already asked to erase',
      { erasureRequested: true },
      'erasure-already-requested',
    ],
    [
      'a second person on the roster',
      { memberUids: ['uid-owner', 'uid-colleague'] },
      'has-other-members',
    ],
    [
      'a roster that does not contain the owner',
      { memberUids: ['uid-colleague'] },
      'has-other-members',
    ],
    [
      'an empty roster — a read that returned nothing is not proof of nothing',
      { memberUids: [] },
      'has-other-members',
    ],
    ['a site', { hostCount: 1 }, 'has-sites'],
    [
      'a subcollection nothing writes at birth',
      { subcollections: ['members', 'billing', 'activity', 'apiKeys'] },
      'has-content',
    ],
    [
      'activity beyond its own creation',
      { activityCount: ORG_BIRTH_ACTIVITY_ROWS + 1 },
      'has-activity',
    ],
    [
      'a relationship with the billing processor',
      { hasBillingRelationship: true },
      'has-billing',
    ],
    [
      'no creation stamp to measure the grace against',
      { createdAtMs: null },
      'no-created-at',
    ],
    [
      'a creation stamp that is not a number',
      { createdAtMs: Number.NaN },
      'no-created-at',
    ],
    ['no owner on the document', { ownerUid: null }, 'no-owner'],
  ]

  it.each(saved)('spares %s', (_label, overrides, reason) => {
    expect(refuseUnverifiedOrgReap(junk(overrides), { now: NOW })).toBe(reason)
  })

  it('spares a workspace that is a week old and already has a site', () => {
    // The combination, not just the isolated facts: an early adopter who
    // built something and never got round to clicking the email is the
    // person this sweep would hurt most, and two independent rules stop it.
    const facts = junk({
      createdAtMs: NOW - 8 * DAY,
      hostCount: 1,
      subcollections: ['members', 'billing', 'activity', 'plugins'],
    })
    expect(refuseUnverifiedOrgReap(facts, { now: NOW })).not.toBeNull()
  })
})

describe('planUnverifiedOrgReap', () => {
  it('names every reason it left a workspace standing', () => {
    const plan = planUnverifiedOrgReap(
      [
        { ...junk({ orgId: 'a' }), slugReservedUntilMs: NOW + DAY },
        {
          ...junk({ orgId: 'b', hostCount: 1 }),
          slugReservedUntilMs: NOW + DAY,
        },
        {
          ...junk({ orgId: 'c', createdAtMs: NOW - DAY }),
          slugReservedUntilMs: NOW + DAY,
        },
      ],
      { now: NOW },
    )
    expect(plan.scanned).toBe(3)
    expect(plan.toReap.map((candidate) => candidate.orgId)).toEqual(['a'])
    expect(plan.refusedCounts).toEqual({ 'has-sites': 1, 'too-new': 1 })
    expect(plan.toReap[0].ageDays).toBe(30)
  })

  it('stops at the ceiling and reports the remainder as deferred', () => {
    const plan = planUnverifiedOrgReap(
      ['a', 'b', 'c'].map((orgId) => ({
        ...junk({ orgId }),
        slugReservedUntilMs: null,
      })),
      { now: NOW, maxReaps: 2 },
    )
    expect(plan.toReap).toHaveLength(2)
    expect(plan.deferredByCap).toBe(1)
    expect(plan.refusedCounts['deferred-by-cap']).toBe(1)
  })

  it('promotes the address of an owner who verified, and erases nothing', () => {
    // The other half of AGL-2585. A held address that is never promoted
    // becomes claimable on day twenty-one, and this is the sweep that stops
    // that happening to somebody who did confirm their email.
    const verified = {
      ...junk({
        orgId: 'real',
        owner: { ...junk().owner!, emailVerified: true },
      }),
      slugReservedUntilMs: NOW + 5 * DAY,
    }
    const plan = planUnverifiedOrgReap([verified], { now: NOW })
    expect(plan.toReap).toEqual([])
    expect(plan.toPromote).toEqual([{ orgId: 'real', slug: 'acme-inc' }])
  })

  it('promotes nothing when the address was already granted', () => {
    const plan = planUnverifiedOrgReap(
      [
        {
          ...junk({
            orgId: 'real',
            owner: { ...junk().owner!, emailVerified: true },
          }),
          slugReservedUntilMs: null,
        },
      ],
      { now: NOW },
    )
    expect(plan.toPromote).toEqual([])
  })

  it('never promotes on an auth record that answered for another uid', () => {
    const plan = planUnverifiedOrgReap(
      [
        {
          ...junk({
            orgId: 'real',
            owner: {
              uid: 'uid-someone-else',
              emailVerified: true,
              tenantId: null,
              providerIds: ['password'],
            },
          }),
          slugReservedUntilMs: NOW + DAY,
        },
      ],
      { now: NOW },
    )
    expect(plan.toPromote).toEqual([])
    expect(plan.toReap).toEqual([])
  })
})
