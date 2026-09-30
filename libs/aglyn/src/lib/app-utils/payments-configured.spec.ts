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
 * The status, and the sentence for the one audience that can act on it: an
 * operator is told how. A visitor's sentence is the plugin's whose page they
 * are on, and is specced there.
 */

import {
  PAYMENTS_NOT_CONFIGURED_STATUS,
  isPaymentsNotConfigured,
  operatorPaymentsNotConfiguredText,
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

describe('the OPERATOR sentence tells the person who can fix it', () => {
  it('names the variable to set — they are the audience for it', () => {
    expect(operatorPaymentsNotConfiguredText()).toMatch(/STRIPE_SECRET_KEY/)
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
