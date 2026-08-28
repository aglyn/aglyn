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
 * The console's consent decision, and the three things it answers differently
 * from a customer site.
 *
 * This module is deliberately thin — every grant rule, record shape and sweep
 * belongs to `visitor-consent.ts` — so what is worth pinning is exactly the
 * seams: which region set it answers over, what it writes (and does not write)
 * for a first-time visitor, and that the advertising question is DERIVED from
 * what this surface declares rather than set by hand beside it.
 *
 * PLANTED REDS (all four run, counts observed):
 *  1. Answer the posture over the TENANT's `PRIOR_CONSENT_COUNTRY_CODES`
 *     instead of the platform's → 1 fails, the Switzerland case, and it is the
 *     only difference between the two sets.
 *  2. Record an `accepted` default in the opt-in branch of
 *     `decidePlatformConsent` → 1 fails, and it is the case that says no
 *     consent is fabricated for a visitor who never gave one.
 *  3. Drop the `isExplicitConsentStatus` clause so GPC overwrites an explicit
 *     accept → 1 fails, and it is the override CONTROL rather than the GPC
 *     case, which is the pair working: the signal still opts out, it just
 *     stopped losing to a real choice.
 *  4. Hardcode `platformAsksAboutAdvertising` to `true` → 2 fail, the
 *     derivation and the "grants nothing today" case together.
 */

import {
  PLATFORM_CONSENT_DEFAULT_COMMANDS,
  PLATFORM_PRIOR_CONSENT_REGIONS,
} from './platform-consent-default'
import {
  decidePlatformConsent,
  platformAdvertisingAllowed,
  platformAnalyticsAllowed,
  platformAsksAboutAdvertising,
  PLATFORM_CONSENT_SUBJECT,
  platformConsentPosture,
  platformRefusalStatus,
  readPlatformConsent,
  resetPlatformConsentPriming,
  storePlatformConsent,
} from './platform-visitor-consent'
import {
  PRIOR_CONSENT_COUNTRY_CODES,
  visitorConsentStorageKey,
} from './visitor-consent'

const KEY = visitorConsentStorageKey(PLATFORM_CONSENT_SUBJECT)

function serveRegion(country: string | null): void {
  ;(global as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({ country }),
  }))
}

function setGlobalPrivacyControl(on: boolean): void {
  Object.defineProperty(navigator, 'globalPrivacyControl', {
    value: on ? true : undefined,
    configurable: true,
  })
}

beforeEach(() => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  setGlobalPrivacyControl(false)
  resetPlatformConsentPriming()
})

describe('the console consent posture', () => {
  it('asks first in Switzerland, which the TENANT set does not', () => {
    // The one deliberate disagreement between the two country sets, and the
    // reason this module answers over its own. Aglyn's brief treats CH as
    // prior opt-in for Aglyn's OWN surfaces; widening the tenant set would
    // change customers' compliance posture on their behalf, which is the thing
    // that work is scoped out of.
    expect(PRIOR_CONSENT_COUNTRY_CODES.has('CH')).toBe(false)
    expect(platformConsentPosture('CH')).toBe('opt-in')
  })

  it('asks first across the UK, the EU and the EEA', () => {
    for (const code of ['GB', 'DE', 'FR', 'IE', 'NO', 'IS', 'LI', 'GI']) {
      expect(platformConsentPosture(code)).toBe('opt-in')
    }
    // The set is READ, not restated: a country that leaves the EU is edited
    // once, in `platform-consent-default.ts`, and this follows.
    expect(PLATFORM_PRIOR_CONSENT_REGIONS).toContain('DE')
  })

  it('applies implied consent everywhere else — the control', () => {
    for (const code of ['US', 'CA', 'BR', 'AU', 'JP', 'IN']) {
      expect(platformConsentPosture(code)).toBe('opt-out')
    }
  })

  it('treats an unknown region as prior-consent', () => {
    expect(platformConsentPosture(null)).toBe('opt-in')
    expect(platformConsentPosture('')).toBe('opt-in')
  })
})

describe('resolving a first-time console visitor', () => {
  it('records implied consent outside the prior-consent regions', async () => {
    serveRegion('US')
    const resolved = await decidePlatformConsent()
    expect(resolved.posture).toBe('opt-out')
    expect(resolved.stored).toMatchObject({ status: 'implied', analytics: true })
    expect(platformAnalyticsAllowed()).toBe(true)
  })

  it('records NOTHING inside them, and grants nothing', async () => {
    serveRegion('DE')
    const resolved = await decidePlatformConsent()
    expect(resolved.posture).toBe('opt-in')
    expect(resolved.stored).toBeNull()
    // The half that matters for an existing user with no record: resolution
    // must not manufacture one. An `accepted` written on their behalf here
    // would be a consent nobody gave.
    expect(window.localStorage.getItem(KEY)).toBeNull()
    expect(platformAnalyticsAllowed()).toBe(false)
  })

  it('honours GPC as an opt-out even where consent would be implied', async () => {
    setGlobalPrivacyControl(true)
    serveRegion('US')
    const resolved = await decidePlatformConsent()
    expect(resolved.stored?.status).toBe('gpc-opt-out')
    expect(platformAnalyticsAllowed()).toBe(false)
  })

  it('lets an explicit accept outrank GPC — the control for the case above', async () => {
    // A signal is a default; a specific, informed choice is not. Without this
    // the GPC case above would also pass against code that simply never grants.
    storePlatformConsent({ status: 'accepted', country: 'US' })
    setGlobalPrivacyControl(true)
    serveRegion('US')
    const resolved = await decidePlatformConsent()
    expect(resolved.stored?.status).toBe('accepted')
    expect(platformAnalyticsAllowed()).toBe(true)
  })

  it('keeps a stored refusal without asking the region endpoint again', async () => {
    storePlatformConsent({ status: 'declined', country: 'DE' })
    serveRegion('US')
    const resolved = await decidePlatformConsent()
    expect(resolved.stored?.status).toBe('declined')
    expect(platformAnalyticsAllowed()).toBe(false)
    expect((global as unknown as { fetch: jest.Mock }).fetch).not.toHaveBeenCalled()
  })
})

describe('withdrawal', () => {
  it('drops the grant and the analytics identifiers', async () => {
    serveRegion('US')
    await decidePlatformConsent()
    document.cookie = '_ga=GA1.1.1.1'
    document.cookie = '_ga_YW5PG16YTM=GS1.1.1'

    storePlatformConsent({ status: 'opted-out', country: 'US' })

    expect(platformAnalyticsAllowed()).toBe(false)
    expect(readPlatformConsent()?.status).toBe('opted-out')
    // The sweep is the shared writer's, not this module's — asserted because
    // "stops adding" and "cleans up" are different promises and only the
    // second one is the one that was made.
    expect(document.cookie).not.toContain('_ga=')
    expect(document.cookie).not.toContain('_ga_YW5PG16YTM')
  })

  it('names the refusal by how the visitor got here', () => {
    // `opted-out` for someone defaulted in, `declined` for someone asked
    // first. Same gate, different record — and the difference is the answer to
    // "how many visitors were tracked before they said no".
    expect(
      platformRefusalStatus(
        { v: 1, at: 0, status: 'implied', analytics: true },
        null,
      ),
    ).toBe('opted-out')
    expect(platformRefusalStatus(null, 'opt-in')).toBe('declined')
    expect(platformRefusalStatus(null, 'opt-out')).toBe('opted-out')
  })
})

describe('the advertising question on this surface', () => {
  it('is asked only where the declaration grants ad storage somewhere', () => {
    // DERIVED, not declared twice. The predicate and the consent-mode defaults
    // are two statements about the same fact, and a hand-kept flag beside them
    // is how a surface comes to ask about a category it denies — or to deny
    // one it has quietly started using.
    const declarationGrantsAds = PLATFORM_CONSENT_DEFAULT_COMMANDS.some(
      (command) => command.ad_storage !== 'denied',
    )
    expect(platformAsksAboutAdvertising()).toBe(declarationGrantsAds)
  })

  it('grants nothing today, on any path', async () => {
    // The console loads no advertising vendor's script and declares ad
    // storage denied in every region, so no route through this module may
    // produce an advertising grant — not the implied default, and not an
    // explicit yes typed into the call.
    serveRegion('US')
    await decidePlatformConsent()
    expect(readPlatformConsent()?.advertising).toBe(false)
    expect(platformAdvertisingAllowed()).toBe(false)

    storePlatformConsent({ status: 'accepted', country: 'US', advertising: true })
    expect(platformAdvertisingAllowed()).toBe(false)
  })
})
