/**
 * @jest-environment jsdom
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

/**
 * THE ORG DATA PAGE RENDERED A COMPLETELY BLANK BODY (AGL-1152).
 *
 * Reported against a plan-less workspace, but that is not the population. The
 * Data console extension registers its widgets behind `featureFlag:
 * 'dataStore'`, `free` does not carry it, and a plan-less org RESOLVES as free
 * — so the registry filtered the extension out, the `orgData` widget slot
 * found nothing, and the page painted its header over empty space. No empty
 * state, no explanation, no upgrade path. Indistinguishable from the console
 * being broken, which is exactly how it arrived.
 *
 * Every free workspace saw it.
 *
 * The two properties below are the fix, and the second is the one that is easy
 * to lose: `checkEntitlement(undefined)` resolves the FREE tier rather than
 * "unknown", so a gate that refuses before the billing doc settles shows a
 * PAYING customer an upgrade prompt for a render or two. That is the same
 * three-state trap AGL-2080 documents on the commerce cards, and the
 * `orgReady` hold is what keeps this page out of it.
 */
import { checkEntitlement, planLabelGrantingFeature } from '@aglyn/aglyn'

describe('org Data entitlement gate (AGL-1152)', () => {
  it('free — and therefore a plan-less org — does NOT carry dataStore', () => {
    // The premise. If this ever flips, the blank page stops being reachable
    // and the gate below becomes dead code rather than a fix.
    expect(checkEntitlement({ plan: 'free' } as never, 'dataStore')).toBe(false)
    expect(checkEntitlement(null, 'dataStore')).toBe(false)
    expect(checkEntitlement(undefined, 'dataStore')).toBe(false)
  })

  it('a paid plan does carry it, so the gate is not refusing everyone', () => {
    expect(checkEntitlement({ plan: 'starter' } as never, 'dataStore')).toBe(
      true,
    )
  })

  it('names a real plan to upgrade TO', () => {
    // "This is a paid feature" is a dead end; the plan name plus a button is
    // the upgrade path. Derived from PLAN_ENTITLEMENTS on every call, so the
    // upsell can never name a tier that stopped carrying the feature.
    const label = planLabelGrantingFeature('dataStore')
    expect(label).toBeTruthy()
    expect(label).not.toBe('Free')
  })

  it('THE LAPSED-PAYER CASE: a dead subscription resolves to free', () => {
    // Which means a lapsed org sees the upsell rather than a blank page —
    // the whole point of routing the refusal through `checkEntitlement`
    // rather than reading `org.plan` directly.
    expect(
      checkEntitlement(
        { plan: 'pro', subscription: { status: 'canceled' } } as never,
        'dataStore',
      ),
    ).toBe(false)
  })
})
