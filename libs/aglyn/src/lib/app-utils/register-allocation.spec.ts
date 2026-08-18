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
  checkHostRegisterQuota,
  PLAN_ENTITLEMENTS,
  resolveHostRegisterCap,
  resolveOrgEntitlements,
  resolveRegisterSeatPool,
  POS_REGISTERS_ADDON_MAX,
  UNLIMITED,
} from './plan-entitlements'

/**
 * The POS register add-on is a POOL allocated per site (AGL-1775, Zach's
 * 2026-08-17 decision — direction 1, per-host enforcement, explicitly
 * choosing the expensive option over re-documenting the add-on as org-wide).
 *
 * $89/mo is priced "per extra register/location". It used to raise an
 * org-level entitlement that every site inherited, so an agency org running
 * 20 sites bought one register and received twenty. The purchase is now a
 * pool; `org.registerAllocations` says which site holds each seat.
 *
 * THE GUARD THIS FILE EXISTS FOR is the first `describe` below: an
 * unallocated site must resolve to the PLAN's cap. Not the pooled total —
 * that is the old defect, restored. And not an unbounded value when the
 * allocation is missing, malformed, or the org has not arrived — that is the
 * `checkQuota(undefined)` = Free-tier lesson inverted, where an absent input
 * quietly answered in the permissive direction.
 *
 * Every expectation here was forced red once against the code it guards.
 */
describe('POS register allocation (AGL-1775)', () => {
  /** Pro includes 1 register per site; the org bought 4 more. */
  const purchaser = {
    plan: 'pro',
    seatAddons: { posRegisters: 4 },
    registerAllocations: { 'host-flagship': 3 },
  } as any
  const PRO_CAP = PLAN_ENTITLEMENTS.pro.posRegisters

  describe('an unallocated site resolves to the PLAN cap', () => {
    it('never inherits the pool — the AGL-1775 defect itself', () => {
      // The site that holds seats gets them.
      expect(resolveHostRegisterCap(purchaser, 'host-flagship')).toBe(
        PRO_CAP + 3,
      )
      // Every OTHER site gets the plan cap and nothing else. Forced red by
      // restoring `posRegisters: resolved.posRegisters + extraRegisters` in
      // `resolveOrgEntitlements`: this read 5 (1 + the whole pool of 4) on a
      // site that has been allocated nothing.
      expect(resolveHostRegisterCap(purchaser, 'host-second')).toBe(PRO_CAP)
      expect(resolveHostRegisterCap(purchaser, 'host-third')).toBe(PRO_CAP)
      // Stated as money, and decomposed rather than asserted as one total
      // (AGL-1402's hazard): four sites, one purchase of 4 seats, 3 of them
      // assigned. The org-wide fold delivered 4 extra registers on EVERY
      // site — 16 registers' worth of entitlement for four registers' price.
      // The pool delivers what was assigned, and never more than was bought.
      const sites = ['host-flagship', 'host-second', 'host-third', 'host-4th']
      const perSiteExtra = sites.map(
        (hostId) => resolveHostRegisterCap(purchaser, hostId) - PRO_CAP,
      )
      expect(perSiteExtra).toEqual([3, 0, 0, 0])
      const extraDelivered = perSiteExtra.reduce((sum, n) => sum + n, 0)
      expect(extraDelivered).toBe(3)
      expect(extraDelivered).toBeLessThanOrEqual(
        resolveRegisterSeatPool(purchaser).purchased,
      )
    })

    it('resolves the plan cap for a missing org, map, or host id', () => {
      // Org still loading / absent → free plan's cap. Free sells no
      // registers at all, so this is 0 — refused, not unbounded.
      expect(resolveHostRegisterCap(undefined, 'host-1')).toBe(
        PLAN_ENTITLEMENTS.free.posRegisters,
      )
      expect(resolveHostRegisterCap(null, 'host-1')).toBe(0)
      // A purchaser whose allocation map has not been written yet.
      expect(
        resolveHostRegisterCap(
          { plan: 'pro', seatAddons: { posRegisters: 4 } } as any,
          'host-1',
        ),
      ).toBe(PRO_CAP)
      // No host id at all (a caller that has the org but not the site).
      expect(resolveHostRegisterCap(purchaser, '')).toBe(PRO_CAP)
      expect(resolveHostRegisterCap(purchaser, undefined)).toBe(PRO_CAP)
    })

    it('never resolves UNBOUNDED from a malformed allocation', () => {
      // The inverted `checkQuota(undefined)` lesson. Each of these is a value
      // a corrupt write, a JSON round-trip or a hand edit can produce, and
      // each one used to be a candidate for `planCap + garbage`. Forced red
      // by removing the `Number.isFinite` coercion in
      // `resolveRegisterSeatPool`, which made the `Infinity` row resolve to
      // `Infinity` — an uncapped register count on a Pro site.
      for (const bad of [
        Number.POSITIVE_INFINITY,
        Number.NaN,
        -5,
        'lots',
        null,
        undefined,
        {},
      ] as unknown[]) {
        const cap = resolveHostRegisterCap(
          {
            plan: 'pro',
            seatAddons: { posRegisters: 4 },
            registerAllocations: { 'host-1': bad },
          } as any,
          'host-1',
        )
        expect(cap).toBe(PRO_CAP)
        expect(Number.isFinite(cap)).toBe(true)
      }
      // A non-object map is ignored wholesale rather than indexed into.
      expect(
        resolveHostRegisterCap(
          {
            plan: 'pro',
            seatAddons: { posRegisters: 4 },
            registerAllocations: 'all of them',
          } as any,
          'host-1',
        ),
      ).toBe(PRO_CAP)
    })

    it('keeps UNLIMITED unlimited on enterprise', () => {
      // Enterprise's plan cap IS unbounded — that is what was sold — and
      // `Infinity + n` must not become `NaN` or a finite number downstream.
      const enterprise = {
        plan: 'enterprise',
        seatAddons: { posRegisters: 5 },
        registerAllocations: { 'host-1': 5 },
      } as any
      expect(resolveOrgEntitlements(enterprise).posRegisters).toBe(UNLIMITED)
      expect(resolveHostRegisterCap(enterprise, 'host-1')).toBe(UNLIMITED)
      expect(resolveHostRegisterCap(enterprise, 'host-2')).toBe(UNLIMITED)
      expect(checkHostRegisterQuota(enterprise, 'host-2', 9_999).allowed).toBe(
        true,
      )
    })
  })

  describe('the pool', () => {
    it('reports purchased / allocated / available', () => {
      expect(resolveRegisterSeatPool(purchaser)).toEqual({
        purchased: 4,
        allocated: 3,
        available: 1,
        byHost: { 'host-flagship': 3 },
      })
    })

    it('never hands out more than was purchased, however stale the map', () => {
      // A purchase reduced from 4 to 1 without the allocation being trimmed.
      // Forced red by dropping the `purchased - allocated` clamp in
      // `resolveRegisterSeatPool`: `host-a` resolved to 1 + 3 = 4 registers
      // off a single $89 seat, which is the original defect wearing an
      // allocation map.
      const stale = {
        plan: 'pro',
        seatAddons: { posRegisters: 1 },
        registerAllocations: { 'host-a': 3, 'host-b': 2 },
      } as any
      const pool = resolveRegisterSeatPool(stale)
      expect(pool.purchased).toBe(1)
      expect(pool.allocated).toBe(1)
      expect(pool.available).toBe(0)
      // Deterministic: sorted host id order, so every reader agrees which
      // site holds the surviving seat.
      expect(pool.byHost).toEqual({ 'host-a': 1 })
      expect(resolveHostRegisterCap(stale, 'host-a')).toBe(PRO_CAP + 1)
      expect(resolveHostRegisterCap(stale, 'host-b')).toBe(PRO_CAP)
      // The sum, decomposed: total extra capacity delivered across every
      // site can never exceed what was bought.
      const delivered = Object.values(pool.byHost).reduce(
        (sum, seats) => sum + seats,
        0,
      )
      expect(delivered).toBeLessThanOrEqual(pool.purchased)
    })

    it('empties on a dead subscription, like every other add-on', () => {
      // The seats bill on the subscription; a dead one takes them with it,
      // and the allocation map must not keep them alive.
      const dead = {
        plan: 'pro',
        subscription: { status: 'canceled' },
        seatAddons: { posRegisters: 4 },
        registerAllocations: { 'host-flagship': 3 },
      } as any
      expect(resolveRegisterSeatPool(dead)).toEqual({
        purchased: 0,
        allocated: 0,
        available: 0,
        byHost: {},
      })
      // Dead → free plan, which sells no registers.
      expect(resolveHostRegisterCap(dead, 'host-flagship')).toBe(0)
    })

    it('returns a deleted site’s seats to the pool by arithmetic', () => {
      // `eraseHost` deletes `registerAllocations[hostId]`. The pool is
      // `purchased - sum(allocations)`, so the release needs no counter to
      // keep in step — dropping the key IS the release.
      const { 'host-flagship': _released, ...rest } =
        purchaser.registerAllocations
      const afterDelete = { ...purchaser, registerAllocations: rest } as any
      expect(resolveRegisterSeatPool(afterDelete).available).toBe(4)
      expect(resolveHostRegisterCap(afterDelete, 'host-flagship')).toBe(PRO_CAP)
    })
  })

  describe('enforcement', () => {
    it('gates creation on the SITE cap, not the org value', () => {
      // The flagship holds 3 seats on top of Pro's 1: the 4th register is
      // creatable, the 5th is not.
      expect(
        checkHostRegisterQuota(purchaser, 'host-flagship', 3).allowed,
      ).toBe(true)
      expect(
        checkHostRegisterQuota(purchaser, 'host-flagship', 4).allowed,
      ).toBe(false)
      expect(checkHostRegisterQuota(purchaser, 'host-flagship', 4).limit).toBe(
        PRO_CAP + 3,
      )
      // The unallocated sibling is refused its SECOND register.
      expect(checkHostRegisterQuota(purchaser, 'host-second', 0).allowed).toBe(
        true,
      )
      expect(checkHostRegisterQuota(purchaser, 'host-second', 1).allowed).toBe(
        false,
      )
      expect(checkHostRegisterQuota(purchaser, 'host-second', 1).remaining).toBe(
        0,
      )
    })

    it('honours the full purchase ceiling on one site', () => {
      // AGL-1738's ceiling survives the move: a merchant who buys the flat
      // maximum and puts it all on one site gets all of it there. The pool
      // changed WHERE the purchase applies, not how much is honoured.
      const maxed = {
        plan: 'agency',
        seatAddons: { posRegisters: POS_REGISTERS_ADDON_MAX },
        registerAllocations: { 'host-1': POS_REGISTERS_ADDON_MAX },
      } as any
      expect(resolveHostRegisterCap(maxed, 'host-1')).toBe(
        PLAN_ENTITLEMENTS.agency.posRegisters + POS_REGISTERS_ADDON_MAX,
      )
    })
  })
})
