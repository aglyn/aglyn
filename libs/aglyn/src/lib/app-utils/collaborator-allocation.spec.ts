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
  checkHostCollaboratorQuota,
  checkSeatQuota,
  PLAN_ENTITLEMENTS,
  resolveCollaboratorSeatPool,
  resolveHostCollaboratorCap,
  UNLIMITED,
} from './plan-entitlements'

/**
 * The collaborator seat add-on is a POOL allocated per site (AGL-2439,
 * the 2026-08-19 decision) — the AGL-1775 register mechanism, applied to
 * the `members` key that never got it.
 *
 * `seatAddons.members` is bought once, org-wide; `membersPerHost` is enforced
 * PER SITE. Adding one to the other handed the whole purchase to every site,
 * so an org running 20 sites bought ONE extra collaborator seat and received
 * twenty. The purchase is now a pool; `org.collaboratorAllocations` says which
 * site holds each seat.
 *
 * TWO GUARDS live here and each was forced red on purpose:
 *
 *  1. AN UNALLOCATED SITE RESOLVES TO THE PLAN'S CAP. Not the pooled total —
 *     that is the old defect, restored. Not unbounded from a malformed
 *     allocation — that is the `checkQuota(undefined)` = Free-tier lesson
 *     inverted, where an absent input answered in the permissive direction.
 *     And not past the plan's band, which is the one thing that differs from
 *     registers: collaborator seats are sold up to `maxMembersPerHost`.
 *
 *  2. THE GRANDFATHER. An org already above the corrected cap keeps every
 *     collaborator it has. `allowed` refuses the NEXT one and `retainedOverCap`
 *     names how many are kept — the cap binds ALLOCATION, never ACCESS.
 */
describe('collaborator seat allocation (AGL-2439)', () => {
  /** Pro includes 10 collaborators per site; the org bought 4 more. */
  const purchaser = {
    plan: 'pro',
    seatAddons: { members: 4 },
    collaboratorAllocations: { 'host-flagship': 3 },
  } as any
  const PRO_CAP = PLAN_ENTITLEMENTS.pro.membersPerHost
  const PRO_MAX = PLAN_ENTITLEMENTS.pro.maxMembersPerHost

  describe('an unallocated site resolves to the PLAN cap', () => {
    it('never inherits the pool — the AGL-2439 defect itself', () => {
      // The site that holds seats gets them.
      expect(resolveHostCollaboratorCap(purchaser, 'host-flagship')).toBe(
        PRO_CAP + 3,
      )
      // Every OTHER site gets the plan's cap and nothing else. Restoring the
      // `+ purchased` fold in `checkSeatQuota` reds this line: it would read
      // PRO_CAP + 4 on a site that was never assigned a seat.
      expect(resolveHostCollaboratorCap(purchaser, 'host-second')).toBe(PRO_CAP)
      expect(resolveHostCollaboratorCap(purchaser, 'host-third')).toBe(PRO_CAP)
    })

    it('answers the plan cap for a missing org, host or allocation map', () => {
      expect(resolveHostCollaboratorCap(undefined, 'host-any')).toBe(
        PLAN_ENTITLEMENTS.free.membersPerHost,
      )
      expect(resolveHostCollaboratorCap(purchaser, null)).toBe(PRO_CAP)
      expect(
        resolveHostCollaboratorCap({ plan: 'pro', seatAddons: { members: 4 } } as any, 'host-x'),
      ).toBe(PRO_CAP)
    })

    it('is never unbounded from a malformed allocation', () => {
      // Dropping the `Number.isFinite` coercion in the pool resolver makes
      // this an uncapped Pro site — the outcome the guard exists to prevent.
      for (const poison of [Infinity, NaN, -5, 'lots', null, {}]) {
        const org = {
          plan: 'pro',
          seatAddons: { members: 4 },
          collaboratorAllocations: { 'host-a': poison },
        } as any
        expect(resolveHostCollaboratorCap(org, 'host-a')).toBe(PRO_CAP)
      }
    })

    it('never hands out more than was purchased, however stale the map', () => {
      // One seat bought, three sites each claiming two. Dropping the pool
      // clamp gives one purchase away three times.
      const stale = {
        plan: 'pro',
        seatAddons: { members: 1 },
        collaboratorAllocations: { 'host-a': 2, 'host-b': 2, 'host-c': 2 },
      } as any
      const pool = resolveCollaboratorSeatPool(stale)
      expect(pool.purchased).toBe(1)
      expect(pool.allocated).toBe(1)
      expect(pool.available).toBe(0)
      // Sorted-id order, so the answer is deterministic across readers.
      expect(pool.byHost).toEqual({ 'host-a': 1 })
      expect(resolveHostCollaboratorCap(stale, 'host-b')).toBe(PRO_CAP)
    })

    it('empties the pool when the subscription is dead', () => {
      const dead = {
        plan: 'pro',
        subscription: { status: 'canceled' },
        seatAddons: { members: 4 },
        collaboratorAllocations: { 'host-flagship': 3 },
      } as any
      expect(resolveCollaboratorSeatPool(dead).purchased).toBe(0)
      // …and the plan itself downgrades, so the site falls to Free's cap.
      expect(resolveHostCollaboratorCap(dead, 'host-flagship')).toBe(
        PLAN_ENTITLEMENTS.free.membersPerHost,
      )
    })
  })

  describe('the plan BAND still clamps — the one difference from registers', () => {
    it('assigning past `maxMembersPerHost` cannot raise the cap', () => {
      const overBand = {
        plan: 'pro',
        seatAddons: { members: 100 },
        collaboratorAllocations: { 'host-a': 100 },
      } as any
      // Dropping the `Math.min(…, maxSeats)` in `resolveHostCollaboratorCap`
      // reds this: the site would resolve to 110 on a plan that sells 25.
      expect(resolveHostCollaboratorCap(overBand, 'host-a')).toBe(PRO_MAX)
      expect(checkHostCollaboratorQuota(overBand, 'host-a', 0).upgradeRequired).toBe(
        true,
      )
    })

    it('leaves UNLIMITED unlimited rather than clamping it to a number', () => {
      const enterprise = {
        plan: 'enterprise',
        seatAddons: { members: 4 },
        collaboratorAllocations: { 'host-a': 4 },
      } as any
      expect(resolveHostCollaboratorCap(enterprise, 'host-a')).toBe(UNLIMITED)
      expect(resolveHostCollaboratorCap(enterprise, 'host-unallocated')).toBe(
        UNLIMITED,
      )
    })
  })

  describe('`checkSeatQuota` stops folding the pool into an org-level number', () => {
    it('answers the PLAN cap for `members`, whatever was purchased', () => {
      // THIS IS THE FIX. Before AGL-2439 this returned PRO_CAP + 4 and every
      // site in the org inherited it.
      const quota = checkSeatQuota(purchaser, 'members', 0)
      expect(quota.limit).toBe(PRO_CAP)
      expect(quota.purchased).toBe(0)
    })

    it('still folds for `managers`, which really is org-level', () => {
      const org = { plan: 'pro', seatAddons: { managers: 3 } } as any
      const quota = checkSeatQuota(org, 'managers', 0)
      expect(quota.purchased).toBe(3)
      expect(quota.limit).toBe(PLAN_ENTITLEMENTS.pro.managersPerOrg + 3)
    })
  })

  describe('THE GRANDFATHER: the cap binds allocation, never access', () => {
    /** Pro site holding 14 collaborators against a corrected cap of 10. */
    const overCap = { plan: 'pro' } as any

    it('refuses the NEXT collaborator', () => {
      const quota = checkHostCollaboratorQuota(overCap, 'host-a', 14)
      expect(quota.allowed).toBe(false)
      expect(quota.limit).toBe(PRO_CAP)
      expect(quota.remaining).toBe(0)
    })

    it('names how many seats are RETAINED above the cap', () => {
      // Dropping the `Math.max(0, currentUsage - limit)` and returning a bare
      // difference reds the under-cap case below; hardcoding 0 reds this one.
      expect(
        checkHostCollaboratorQuota(overCap, 'host-a', 14).retainedOverCap,
      ).toBe(4)
    })

    it('reports zero retention for a site UNDER its cap', () => {
      // A negative here would be headroom a caller could add and spend.
      expect(
        checkHostCollaboratorQuota(overCap, 'host-a', 3).retainedOverCap,
      ).toBe(0)
      expect(checkHostCollaboratorQuota(overCap, 'host-a', 3).allowed).toBe(true)
    })

    it('lapses on its own when the plan or the allocation changes', () => {
      // The retention is DERIVED, not stored — this is what makes "until they
      // next change plan or seat count" automatic rather than a migration.
      const upgraded = { plan: 'business' } as any
      expect(checkHostCollaboratorQuota(upgraded, 'host-a', 14).allowed).toBe(
        true,
      )
      expect(
        checkHostCollaboratorQuota(upgraded, 'host-a', 14).retainedOverCap,
      ).toBe(0)

      const assigned = {
        plan: 'pro',
        seatAddons: { members: 5 },
        collaboratorAllocations: { 'host-a': 5 },
      } as any
      expect(checkHostCollaboratorQuota(assigned, 'host-a', 14).allowed).toBe(
        true,
      )
      expect(
        checkHostCollaboratorQuota(assigned, 'host-a', 14).retainedOverCap,
      ).toBe(0)
    })

    it('surfaces the seats assigned to THIS site so the console can say so', () => {
      const quota = checkHostCollaboratorQuota(purchaser, 'host-flagship', 0)
      expect(quota.assignedSeats).toBe(3)
      expect(quota.limit).toBe(PRO_CAP + 3)
      expect(checkHostCollaboratorQuota(purchaser, 'host-second', 0).assignedSeats).toBe(
        0,
      )
    })
  })

  describe('a FRESH org is held to the corrected cap', () => {
    it('a free org gets one collaborator per site and no more', () => {
      const free = { plan: 'free' } as any
      expect(resolveHostCollaboratorCap(free, 'host-a')).toBe(1)
      expect(checkHostCollaboratorQuota(free, 'host-a', 0).allowed).toBe(true)
      expect(checkHostCollaboratorQuota(free, 'host-a', 1).allowed).toBe(false)
      expect(checkHostCollaboratorQuota(free, 'host-a', 1).retainedOverCap).toBe(
        0,
      )
    })

    it('a purchaser with an UNASSIGNED pool is held to the plan cap', () => {
      // The seat is bought and paid for, and until it is assigned it raises
      // nothing. That is the trade the pool makes, and the allocation card is
      // why it is not a loss.
      const unassigned = { plan: 'pro', seatAddons: { members: 4 } } as any
      expect(checkHostCollaboratorQuota(unassigned, 'host-a', PRO_CAP).allowed).toBe(
        false,
      )
      expect(resolveCollaboratorSeatPool(unassigned).available).toBe(4)
    })
  })
})
