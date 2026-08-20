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
 * The "not configured is not failed" vocabulary (AGL-2019).
 *
 * Two audiences, two sentences, and the difference between them is the whole
 * reason this module exists rather than a bare `status === 501` at each call
 * site. A shopper is a stranger on someone else's site and gets no cause; an
 * operator can fix it and is told how.
 */

import {
  PAYMENTS_NOT_CONFIGURED_STATUS,
  isPaymentsNotConfigured,
  operatorMarketplaceNotConfiguredText,
  operatorPaymentsNotConfiguredText,
  storefrontPaymentsNotConfiguredText,
} from './payments-configured'

describe('isPaymentsNotConfigured', () => {
  it('recognises 501 and nothing else', () => {
    expect(PAYMENTS_NOT_CONFIGURED_STATUS).toBe(501)
    expect(isPaymentsNotConfigured(501)).toBe(true)
    // 423 is the lockdown pause and has its own state; 500 is a real failure.
    for (const status of [200, 400, 409, 423, 500, 502]) {
      expect(isPaymentsNotConfigured(status)).toBe(false)
    }
  })

  it('treats a missing status as "not this case", never as this case', () => {
    // A fetch that threw has no status. Defaulting to "unconfigured" would
    // convert every network error into a calm, permanent, latched refusal.
    expect(isPaymentsNotConfigured(undefined)).toBe(false)
    expect(isPaymentsNotConfigured(null)).toBe(false)
  })
})

describe('the STOREFRONT sentence is safe to show a stranger', () => {
  const text = storefrontPaymentsNotConfiguredText()

  it('says it about the store, in the present tense', () => {
    expect(text).toMatch(/store/i)
    expect(text).toMatch(/not set up to take payments/i)
  })

  it('leaks no variable name, no platform name and no deployment detail', () => {
    // The operator's deployment shape is not a shopper's business, and this
    // string is rendered on the public internet.
    for (const leak of [
      /STRIPE/i,
      /SECRET/i,
      /\benv\b/i,
      /deployment/i,
      /self-host/i,
      /Aglyn/i,
    ]) {
      expect(text).not.toMatch(leak)
    }
  })

  it('does not imply a transient outage that invites a retry', () => {
    // "right now" / "temporarily" would say wait and try again; nothing about
    // this resolves without the operator acting.
    expect(text).not.toMatch(/right now|temporarily|try again|later/i)
  })
})

describe('the OPERATOR sentence tells the person who can fix it', () => {
  it('names the variable to set — they are the audience for it', () => {
    expect(operatorPaymentsNotConfiguredText()).toMatch(/STRIPE_SECRET_KEY/)
  })

  it('leads with what still works, so nothing reads as broken', () => {
    const text = operatorMarketplaceNotConfiguredText()
    expect(text).toMatch(/browsing and free installs work/i)
    expect(text).not.toMatch(/error|failed|broken/i)
  })

  it('uses the platform brand, so a rebranded install does not read our name', () => {
    // A self-hoster who set NEXT_PUBLIC_PLATFORM_BRAND_NAME should not be told
    // about "Aglyn" in an explanation of their own deployment. The constant is
    // resolved at module scope, so the module registry has to be reset.
    const original = process.env.NEXT_PUBLIC_PLATFORM_BRAND_NAME
    try {
      process.env.NEXT_PUBLIC_PLATFORM_BRAND_NAME = 'Beacon'
      jest.resetModules()
      const reloaded =
        require('./payments-configured') as typeof import('./payments-configured')
      expect(reloaded.operatorPaymentsNotConfiguredText()).toMatch(/^Beacon /)
      expect(reloaded.operatorPaymentsNotConfiguredText()).not.toMatch(/Aglyn/)
    } finally {
      if (original === undefined)
        delete process.env.NEXT_PUBLIC_PLATFORM_BRAND_NAME
      else process.env.NEXT_PUBLIC_PLATFORM_BRAND_NAME = original
      jest.resetModules()
    }
  })

  it('AGLYN-OPERATED shape: unset still says our name', () => {
    // The guard above has to be testing configuration, not just asserting a
    // string it also produced by default.
    const original = process.env.NEXT_PUBLIC_PLATFORM_BRAND_NAME
    try {
      delete process.env.NEXT_PUBLIC_PLATFORM_BRAND_NAME
      jest.resetModules()
      const reloaded =
        require('./payments-configured') as typeof import('./payments-configured')
      expect(reloaded.operatorPaymentsNotConfiguredText()).toMatch(/^Aglyn /)
    } finally {
      if (original === undefined)
        delete process.env.NEXT_PUBLIC_PLATFORM_BRAND_NAME
      else process.env.NEXT_PUBLIC_PLATFORM_BRAND_NAME = original
      jest.resetModules()
    }
  })
})
