/**
 * @jest-environment jsdom
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored.
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

import {
  checkEntitlement,
  isEnterpriseOrg,
  type AglynOrgBilling,
} from '@aglyn/aglyn'

/**
 * The Enterprise card must not tick an entitlement the org does not hold
 * (AGL-2297).
 *
 * `isEnterpriseOrg` is true three ways and only ONE of them grants anything:
 * `plan === 'enterprise'` resolves the Enterprise row, while
 * `org.enterprise === true` (comped) and `subscription.customMonthlyUsd > 0`
 * (negotiated price) are read nowhere but that function — they are display
 * overlays on a lower base plan. The card rendered five green ticks against
 * all three, above a `Current plan` badge.
 *
 * ## The premise is asserted first, because it is the whole finding
 *
 * If a comped org DID resolve Enterprise entitlements, there would be no bug
 * and this guard would be noise. So the first block pins the actual
 * resolution: reads as Enterprise, holds nothing. That is the fact the fix is
 * built on, and it is exactly the kind of premise a sweep gets wrong — the
 * `isEnterpriseOrg` docblock asserted the opposite ("full Enterprise
 * capability + SSO") for as long as the marker has existed.
 */

/** Comped: the marker set, parked on a lower base plan. */
const COMPED: Partial<AglynOrgBilling> = {
  $id: 'org-comped',
  plan: 'pro',
  enterprise: true,
} as Partial<AglynOrgBilling>

/** The real thing. */
const REAL_ENTERPRISE: Partial<AglynOrgBilling> = {
  $id: 'org-ent',
  plan: 'enterprise',
} as Partial<AglynOrgBilling>

/** Comped, with SSO granted by a per-org override but not white-label. */
const COMPED_WITH_SSO_OVERRIDE: Partial<AglynOrgBilling> = {
  $id: 'org-comped-sso',
  plan: 'pro',
  enterprise: true,
  entitlements: { features: { ssoEnabled: true } },
} as unknown as Partial<AglynOrgBilling>

describe('the premise: reading as Enterprise is not holding Enterprise', () => {
  it('a comped org reads as Enterprise', () => {
    expect(isEnterpriseOrg(COMPED)).toBe(true)
  })

  it('...and holds none of the Enterprise entitlements', () => {
    // The bug in one line: the badge said Current plan, the ticks said SSO
    // and full white-label, and both of these are false.
    expect(checkEntitlement(COMPED, 'ssoEnabled')).toBe(false)
    expect(checkEntitlement(COMPED, 'whiteLabel')).toBe(false)
  })

  it('a custom-priced org is the same shape', () => {
    const custom = {
      $id: 'org-custom',
      plan: 'business',
      subscription: { status: 'active', customMonthlyUsd: 4000 },
    } as unknown as Partial<AglynOrgBilling>
    expect(isEnterpriseOrg(custom)).toBe(true)
    expect(checkEntitlement(custom, 'ssoEnabled')).toBe(false)
  })

  it('a real enterprise org both reads and holds', () => {
    // The other half of the instrument. Without this, a `checkEntitlement`
    // that always returned false would satisfy every assertion above.
    expect(isEnterpriseOrg(REAL_ENTERPRISE)).toBe(true)
    expect(checkEntitlement(REAL_ENTERPRISE, 'ssoEnabled')).toBe(true)
    expect(checkEntitlement(REAL_ENTERPRISE, 'whiteLabel')).toBe(true)
  })

  it('an override grants one entitlement without granting the rest', () => {
    // This is the org the card lied to most specifically: SSO really is on,
    // white-label really is not, and it was ticked for both.
    expect(checkEntitlement(COMPED_WITH_SSO_OVERRIDE, 'ssoEnabled')).toBe(true)
    expect(checkEntitlement(COMPED_WITH_SSO_OVERRIDE, 'whiteLabel')).toBe(false)
  })
})

/**
 * The card's highlight rows are no longer strings — each carries a `holds`
 * predicate that ASKS the entitlement model. Imported and exercised directly
 * so the check is about the predicate rather than about pixels: a DOM query
 * for a tick icon would pass against a card that ticked everything, since the
 * label text is identical either way.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  ENTERPRISE_HIGHLIGHTS,
} = require('../components/billing/billing-plan-cards.component')

type Highlight = {
  label: string
  holds: (org: Partial<AglynOrgBilling> | null | undefined) => boolean
}

const highlights = ENTERPRISE_HIGHLIGHTS as Highlight[]

const labelled = (needle: string): Highlight => {
  const found = highlights.find((one) => one.label.includes(needle))
  if (!found) throw new Error(`no Enterprise highlight mentioning "${needle}"`)
  return found
}

describe('the Enterprise highlights ask the entitlement model', () => {
  it('is a derived list, not a bare array of strings', () => {
    // The shape change IS the fix — a `string[]` cannot express "this org
    // does not have that one". Guarding the shape stops a later edit
    // flattening it back for tidiness.
    expect(highlights.length).toBeGreaterThanOrEqual(5)
    for (const one of highlights) {
      expect(typeof one.label).toBe('string')
      expect(typeof one.holds).toBe('function')
    }
  })

  it('a real enterprise org holds every highlight', () => {
    for (const one of highlights) {
      expect(`${one.label}: ${one.holds(REAL_ENTERPRISE)}`).toBe(
        `${one.label}: true`,
      )
    }
  })

  it('a comped org holds only what an agreement inherently gives', () => {
    expect(labelled('single sign-on').holds(COMPED)).toBe(false)
    expect(labelled('white-label').holds(COMPED)).toBe(false)
    expect(labelled('Unlimited sites').holds(COMPED)).toBe(false)
    // Having an agreement at all is not an entitlement flag, and every org the
    // card marks current has one by construction.
    expect(labelled('Custom pricing').holds(COMPED)).toBe(true)
  })

  it('tracks a per-org override exactly', () => {
    expect(labelled('single sign-on').holds(COMPED_WITH_SSO_OVERRIDE)).toBe(true)
    expect(labelled('white-label').holds(COMPED_WITH_SSO_OVERRIDE)).toBe(false)
  })

  it('ticks nothing for an absent org rather than everything', () => {
    // The safe direction for a loading default: undefined checks as free, so
    // a card rendered before the doc lands under-claims instead of promising
    // SSO to someone who does not have it (the AGL-887 trap, pointed the way
    // that costs a customer nothing).
    expect(labelled('single sign-on').holds(undefined)).toBe(false)
    expect(labelled('white-label').holds(null)).toBe(false)
  })

  it('no longer claims 0% fees on EVERY sale', () => {
    // `marketplaceFeePct` is 20 on Enterprise exactly as on every paid tier,
    // and the price list is frozen — so the claim could not be made true.
    // The docs billing table already scopes the 0% to storefront sales.
    const fees = labelled('platform fees')
    expect(fees.label).toContain('storefront')
    expect(fees.label).not.toContain('every sale')
  })
})
