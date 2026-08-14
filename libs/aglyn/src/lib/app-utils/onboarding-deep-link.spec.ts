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
  onboardingDestination,
  onboardingPlanQuery,
  parseOnboardingPlanIntent,
} from './onboarding-deep-link'

const query = (search: string) => new URLSearchParams(search)

describe('parseOnboardingPlanIntent', () => {
  it('reads the contract the marketing pricing CTAs will use', () => {
    expect(parseOnboardingPlanIntent(query('plan=pro&interval=year'))).toEqual({
      plan: 'pro',
      interval: 'year',
      intervalStated: true,
      contactSales: false,
    })
  })

  it('defaults to monthly when the interval is absent or junk', () => {
    // Never guess the longer commitment from a malformed link — that is the
    // expensive direction to be wrong in.
    for (const search of ['plan=pro', 'plan=pro&interval=', 'plan=pro&interval=decade']) {
      expect(parseOnboardingPlanIntent(query(search))?.interval).toBe('month')
    }
  })

  it('accepts "annual" as a synonym for year', () => {
    // The marketing site is edited by people who have not read our enum.
    expect(parseOnboardingPlanIntent(query('plan=pro&interval=annual'))?.interval).toBe(
      'year',
    )
  })

  it('routes enterprise to contact-sales instead of a checkout', () => {
    expect(parseOnboardingPlanIntent(query('plan=enterprise'))).toEqual({
      plan: 'enterprise',
      interval: 'month',
      intervalStated: false,
      contactSales: true,
    })
  })

  it('returns null for free — a plan, but not a purchase', () => {
    // A new org already starts on it; an intent would send someone to billing
    // to buy what they have.
    expect(parseOnboardingPlanIntent(query('plan=free'))).toBeNull()
  })

  it('degrades to ordinary signup on a bad or missing plan', () => {
    // The contract is with a site we cannot deploy in lockstep with, so a
    // typo in a CTA must not break signup — and must never silently start
    // someone on a plan they did not choose.
    for (const search of ['', 'plan=', 'plan=platinum', 'interval=year', 'plan=PRO%20']) {
      const intent = parseOnboardingPlanIntent(query(search))
      if (search === 'plan=PRO%20') {
        // ...but casing and stray whitespace ARE the same intent.
        expect(intent?.plan).toBe('pro')
      } else {
        expect(intent).toBeNull()
      }
    }
  })

  it('takes the first value when a param is repeated', () => {
    // Next hands back string[] for repeats; joining would produce "pro,free"
    // and lose a valid intent.
    expect(parseOnboardingPlanIntent({ plan: ['pro', 'free'] })?.plan).toBe('pro')
  })

  it('tolerates a null or empty param bag', () => {
    expect(parseOnboardingPlanIntent(null)).toBeNull()
    expect(parseOnboardingPlanIntent(undefined)).toBeNull()
    expect(parseOnboardingPlanIntent({})).toBeNull()
  })
})

describe('onboardingDestination', () => {
  it('lands a plain signup in the new workspace', () => {
    expect(onboardingDestination('acme', null)).toBe('/acme')
  })

  it('carries a paid plan through to billing', () => {
    expect(
      onboardingDestination('acme', {
        plan: 'business',
        interval: 'year',
        intervalStated: true,
        contactSales: false,
      }),
    ).toBe('/acme/billing?plan=business&interval=year')
  })

  it('sends enterprise to support, not billing', () => {
    const destination = onboardingDestination('acme', {
      plan: 'enterprise',
      interval: 'month',
      intervalStated: false,
      contactSales: true,
    })
    expect(destination).toContain('/acme/support')
    expect(destination).not.toContain('billing')
  })

  it('falls back to the workspace picker without a slug', () => {
    // Org creation can fail after the account exists; the user is signed in
    // and must land somewhere real rather than on `/undefined`.
    expect(
      onboardingDestination('', {
        plan: 'pro',
        interval: 'month',
        intervalStated: true,
        contactSales: false,
      }),
    ).toBe('/')
  })
})

describe('an interval the link never stated (AGL-1535)', () => {
  it('marks a defaulted interval as NOT stated', () => {
    // The value is still 'month' — the safe reading for checkout — but the
    // reader has to be able to tell the default from a statement.
    for (const search of ['plan=pro', 'plan=pro&interval=', 'plan=pro&interval=decade']) {
      const intent = parseOnboardingPlanIntent(query(search))
      expect(intent?.interval).toBe('month')
      expect(intent?.intervalStated).toBe(false)
    }
  })

  it('marks a stated interval as stated, including the "annual" synonym', () => {
    for (const search of ['plan=pro&interval=month', 'plan=pro&interval=year', 'plan=pro&interval=annual']) {
      expect(parseOnboardingPlanIntent(query(search))?.intervalStated).toBe(true)
    }
  })

  it('does not re-serialize an unstated interval as a stated one', () => {
    // This is the whole bug: `?plan=scale` became `…&interval=month` at the
    // first hop, and the billing page — which deliberately only lets a stated
    // interval move its toggle — could no longer tell that nobody had said.
    const intent = parseOnboardingPlanIntent(query('plan=scale'))
    expect(onboardingPlanQuery(intent)).toBe('plan=scale')
    expect(onboardingDestination('acme', intent)).toBe('/acme/billing?plan=scale')
  })

  it('round-trips a stated interval unchanged', () => {
    const intent = parseOnboardingPlanIntent(query('plan=scale&interval=annual'))
    expect(onboardingPlanQuery(intent)).toBe('plan=scale&interval=year')
    expect(parseOnboardingPlanIntent(query(onboardingPlanQuery(intent)))).toEqual(
      intent,
    )
  })
})
