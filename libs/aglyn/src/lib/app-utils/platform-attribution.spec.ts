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
 * The one gate behind the Aglyn fingerprint (AGL-2088).
 *
 * Both signals — the `<meta name="generator">` tag in the page head and the
 * `x-powered-by` response header — read this predicate and nothing else, so
 * this file is where the rule is pinned. The surface suites assert that each
 * signal obeys it; this one asserts what it says.
 *
 * The expensive failure is asymmetric and worth naming, because it decides
 * every ambiguous case below: hiding the fingerprint from a site that could
 * have carried it costs one sample out of a corpus, and the next published
 * page supplies another. Emitting it on a site whose owner paid for the
 * `whiteLabel` entitlement breaks a promise on a customer's own domain, in
 * front of their customers, in a place a competitor is reading. So absent
 * beats present in every case where the answer is not certain.
 */

import {
  PLATFORM_GENERATOR_NAME,
  checkEntitlement,
  showsPlatformAttribution,
} from './plan-entitlements'

/** Agency and enterprise are the two plans that grant `whiteLabel`. */
const WHITE_LABEL_PLANS = ['agency', 'enterprise'] as const
/** Everything below them, which is where the corpus comes from. */
const ATTRIBUTED_PLANS = [
  'free',
  'starter',
  'pro',
  'business',
  'scale',
  'advanced',
] as const

describe('showsPlatformAttribution', () => {
  it('CONTROL — the fixtures actually differ on `whiteLabel`', () => {
    // Every assertion below is about a boolean flipping between two org
    // shapes. If both shapes resolved the same way — a renamed plan, a
    // re-tiered entitlement — the positive and negative cases would both keep
    // passing while testing one thing twice. This is the assertion that
    // notices.
    for (const plan of WHITE_LABEL_PLANS) {
      expect(checkEntitlement({ plan } as never, 'whiteLabel')).toBe(true)
    }
    for (const plan of ATTRIBUTED_PLANS) {
      expect(checkEntitlement({ plan } as never, 'whiteLabel')).toBe(false)
    }
  })

  it('EMITS for a paying org without the entitlement', () => {
    for (const plan of ATTRIBUTED_PLANS) {
      expect(showsPlatformAttribution({ plan } as never)).toBe(true)
    }
  })

  it('SUPPRESSES for every plan that grants `whiteLabel`', () => {
    for (const plan of WHITE_LABEL_PLANS) {
      expect(showsPlatformAttribution({ plan } as never)).toBe(false)
    }
  })

  it('SUPPRESSES for a comped org carrying a per-org `whiteLabel` override', () => {
    // An Enterprise-style grant on an otherwise ordinary plan. The override
    // path is how comped orgs get the entitlement, and reading only `plan`
    // would miss all of them.
    const org = {
      plan: 'pro',
      entitlements: { features: { whiteLabel: true } },
    }
    expect(showsPlatformAttribution(org as never)).toBe(false)
  })

  it('⚠️ SUPPRESSES for an org that has not resolved', () => {
    // THE ONE THAT MATTERS. `resolveOrgEntitlements(null)` resolves to the
    // FREE plan — a loading default answering a question it was never asked —
    // so `!checkEntitlement(null, 'whiteLabel')` is `true` and the naive gate
    // EMITS on an unresolved org.
    //
    // That null is not hypothetical. The tenant's `getOrgBilling` fails open
    // with `org: null` on any Firestore error, so under the naive gate a
    // transient read failure while serving an Agency customer's site would
    // stamp the platform's name onto exactly the site that paid to hide it —
    // and it would do so silently, on a code path that only runs when
    // something else is already going wrong.
    expect(showsPlatformAttribution(null)).toBe(false)
    expect(showsPlatformAttribution(undefined)).toBe(false)
  })

  it('SUPPRESSES for an empty org object, which is also not a free org', () => {
    // A partially-read or placeholder doc. `{}` resolves to the free plan for
    // every quota in the codebase, and that default is right for quotas —
    // being generous with a screen limit is recoverable. It is wrong here for
    // the same reason `null` is: the question "is this org white-labelled" has
    // no answer yet, and the safe answer to an unanswered question is silence.
    expect(showsPlatformAttribution({})).toBe(false)
  })

  it('names the platform without a version', () => {
    // The accidental headers this replaced carried `1.0.0-alpha.0` and a Node
    // version. A detector needs the product name; a version only dates our
    // deployments for whoever is looking.
    expect(PLATFORM_GENERATOR_NAME).toBe('Aglyn')
    expect(PLATFORM_GENERATOR_NAME).not.toMatch(/\d/)
  })
})
