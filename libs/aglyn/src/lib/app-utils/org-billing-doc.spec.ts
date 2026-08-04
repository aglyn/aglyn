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
 * AGL-1028. `stripeCustomerId` and `subscription` moved to a manager-gated
 * subcollection.
 *
 * The dangerous half of that move is not the rule — it is entitlement
 * resolution. `resolveEffectivePlan` downgrades a paid plan to free on a dead
 * subscription, and it runs in the tenant runtime and in console components
 * belonging to members who cannot read the manager-gated doc. If it stopped
 * seeing the subscription status it would not throw; it would quietly resolve
 * every org as still-paid, and a canceled workspace would keep its entitlements.
 * The `billingStatus` mirror exists for that, and these assert it works from the
 * org doc alone.
 */
import {
  isBillingSubscription,
  resolveEffectivePlan,
} from './plan-entitlements'
import {
  ORG_BILLING_MOVED_KEYS,
  hasInlineOrgBilling,
  orgBillingStatusFrom,
  pickOrgBillingFields,
} from './org-billing-doc'

describe('org billing document (AGL-1028)', () => {
  describe('what moves', () => {
    it('moves the Stripe keys and NOT seatAddons', () => {
      // seatAddons is an entitlement input — `seatAddons.hosts` raises
      // `hostLimit`. Moving it behind canManageOrg() would drop every paying
      // org to base plan limits for exactly the members the org doc stays
      // readable for.
      expect([...ORG_BILLING_MOVED_KEYS]).toEqual([
        'stripeCustomerId',
        'subscription',
      ])
    })

    it('picks only the moved keys, leaving the rest on the org doc', () => {
      const picked = pickOrgBillingFields({
        stripeCustomerId: 'cus_1',
        subscription: { status: 'active' },
        seatAddons: { hosts: 3 },
        plan: 'pro',
      } as never)
      expect(picked).toEqual({
        stripeCustomerId: 'cus_1',
        subscription: { status: 'active' },
      })
    })

    it('drops undefined but KEEPS null', () => {
      // The webhook uses null to mean "Stripe says this is gone", which is a
      // real value. Treating it as absent would make a cancellation unable to
      // clear the mirror.
      const picked = pickOrgBillingFields({
        stripeCustomerId: null,
        subscription: undefined,
      } as never)
      expect(picked).toEqual({ stripeCustomerId: null })
    })
  })

  describe('the status mirror', () => {
    it('derives the bare status string', () => {
      expect(
        orgBillingStatusFrom({ subscription: { status: 'past_due' } } as never),
      ).toBe('past_due')
    })

    it('is null when there is no subscription at all', () => {
      // A pre-billing workspace is not in dunning.
      expect(orgBillingStatusFrom({} as never)).toBeNull()
      expect(orgBillingStatusFrom(null)).toBeNull()
      expect(
        orgBillingStatusFrom({ subscription: { status: '' } } as never),
      ).toBeNull()
    })
  })

  describe('entitlements survive the move', () => {
    it('downgrades a canceled org read from the MIRROR alone', () => {
      // The post-migration shape: no inline `subscription` on the org doc,
      // because it lives in a doc this reader cannot see.
      const org = { plan: 'pro', billingStatus: 'canceled' }
      expect(resolveEffectivePlan(org as never)).toBe('free')
    })

    it('keeps a past_due org on its paid plan', () => {
      // past_due is the dunning grace window, not a dead subscription.
      const org = { plan: 'pro', billingStatus: 'past_due' }
      expect(resolveEffectivePlan(org as never)).toBe('pro')
    })

    it('CONTROL — still reads the inline subscription pre-backfill', () => {
      // Without this the migration would break every org the backfill has not
      // reached yet, which is the entire window in which it runs.
      const org = { plan: 'pro', subscription: { status: 'canceled' } }
      expect(resolveEffectivePlan(org as never)).toBe('free')
    })

    it('CONTROL — a healthy org keeps its plan under both shapes', () => {
      // The test that stops the two above passing for the wrong reason: if
      // resolution simply denied everything, they would still be green.
      expect(
        resolveEffectivePlan({ plan: 'pro', billingStatus: 'active' } as never),
      ).toBe('pro')
      expect(
        resolveEffectivePlan({
          plan: 'pro',
          subscription: { status: 'active' },
        } as never),
      ).toBe('pro')
    })

    it('prefers the mirror when the inline copy is stale', () => {
      // Mid-migration an org can carry both. The billing doc is authoritative,
      // and the mirror is written from it, so the mirror wins.
      const org = {
        plan: 'pro',
        billingStatus: 'canceled',
        subscription: { status: 'active' },
      }
      expect(resolveEffectivePlan(org as never)).toBe('free')
    })

    it('counts revenue from the mirror, so MRR does not silently drop', () => {
      // `isBillingSubscription` is what separates real revenue from a staff
      // plan override. Blind to the status it would report every comped org as
      // paying — inflating MRR rather than deflating it.
      expect(
        isBillingSubscription({ plan: 'pro', billingStatus: 'active' } as never),
      ).toBe(true)
      expect(
        isBillingSubscription({
          plan: 'pro',
          billingStatus: 'canceled',
        } as never),
      ).toBe(false)
      // A staff override writes `plan` and no subscription anywhere.
      expect(isBillingSubscription({ plan: 'pro' } as never)).toBe(false)
    })
  })

  describe('migration state', () => {
    it('detects an org that has not been backfilled', () => {
      expect(hasInlineOrgBilling({ stripeCustomerId: 'cus_1' } as never)).toBe(
        true,
      )
      expect(hasInlineOrgBilling({ plan: 'pro', seatAddons: {} } as never)).toBe(
        false,
      )
      expect(hasInlineOrgBilling(null)).toBe(false)
    })
  })
})
