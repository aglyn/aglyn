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
 * AGL-1649 — the advertising category: a way for a host to OBTAIN a basis for
 * advertising storage, with default-deny left exactly where it was.
 *
 * AGL-1622 made `ad_storage`, `ad_user_data` and `ad_personalization` denied
 * from the first hit on every gated site. That is correct and it is not what
 * changes here. What changes is that a host who needs Ads storage previously
 * had ONE workaround — switch the whole consent tool off and run their own
 * CMP — which is a far bigger hammer than the problem.
 *
 * Every test below exists to hold one line: a grant requires a visitor's
 * explicit yes to THIS category, on a site whose host turned the question on.
 * Nothing else — not an implied default, not a legacy record, not a
 * hand-edited localStorage entry — may produce one.
 */

import {
  advertisingGrantedByRecord,
  analyticsConsentSignals,
  consentGatedCategories,
  consentModeSignals,
  GA_CONSENT_DEFAULT_SNIPPET,
  hostAsksAboutAdvertising,
  readStoredVisitorConsent,
  storeVisitorConsent,
  visitorConsentStorageKey,
} from './visitor-consent'

const GA = { analytics: { gaMeasurementId: 'G-ABCD1234' } }
const GA_ADS = { ...GA, consent: { advertising: true } }

beforeEach(() => {
  window.localStorage.clear()
})

describe('the host has to turn the question on (AGL-1649)', () => {
  it('does not gate advertising on a site that never asked for it', () => {
    // The default for every existing site, and it must not move.
    expect(consentGatedCategories(GA)).toEqual(['analytics'])
    expect(hostAsksAboutAdvertising(GA)).toBe(false)
  })

  it('gates advertising once the host opts in', () => {
    expect(consentGatedCategories(GA_ADS)).toEqual(['analytics', 'advertising'])
    expect(hostAsksAboutAdvertising(GA_ADS)).toBe(true)
  })

  it('treats a missing, false or junk flag as OFF', () => {
    expect(hostAsksAboutAdvertising({ ...GA, consent: {} })).toBe(false)
    expect(hostAsksAboutAdvertising({ ...GA, consent: { advertising: false } })).toBe(false)
    // Only the boolean true. A truthy string from a hand-edited document
    // must not turn a category on.
    expect(
      hostAsksAboutAdvertising({
        ...GA,
        consent: { advertising: 'yes' },
      } as never),
    ).toBe(false)
    expect(hostAsksAboutAdvertising(null)).toBe(false)
  })

  it('asks nothing on a site with no analytics id, opted in or not', () => {
    // A banner with no question behind it is decoration (AGL-1498).
    expect(consentGatedCategories({ consent: { advertising: true } })).toEqual([])
  })
})

describe('only an explicit yes to THIS category grants it', () => {
  it('records an advertising grant from an explicit accept', () => {
    const record = storeVisitorConsent('h1', {
      status: 'accepted',
      advertising: true,
    })
    expect(record.analytics).toBe(true)
    expect(record.advertising).toBe(true)
  })

  it('accepts analytics WITHOUT advertising — the two are separable', () => {
    const record = storeVisitorConsent('h1', {
      status: 'accepted',
      advertising: false,
    })
    expect(record.analytics).toBe(true)
    expect(record.advertising).toBe(false)
  })

  it('NEVER grants advertising from an implied default', () => {
    // The load-bearing one. In the opt-out posture a US visitor is defaulted
    // INTO analytics; advertising carries obligations analytics does not, so
    // being defaulted in must not produce an advertising basis. "Implied
    // consent to advertising" is a declaration to Google we could not
    // support with anything on file — the AGL-1622 defect shape exactly.
    const record = storeVisitorConsent('h1', {
      status: 'implied',
      advertising: true,
    })
    expect(record.analytics).toBe(true)
    expect(record.advertising).toBe(false)
  })

  it('withdraws advertising with every non-granting status', () => {
    for (const status of ['declined', 'opted-out', 'gpc-opt-out'] as const) {
      const record = storeVisitorConsent('h1', { status, advertising: true })
      expect(record.advertising).toBe(false)
      expect(record.analytics).toBe(false)
    }
  })

  it('defaults to no advertising when the caller says nothing', () => {
    expect(storeVisitorConsent('h1', { status: 'accepted' }).advertising).toBe(
      false,
    )
  })
})

describe('the stored record is derived, never trusted', () => {
  it('ignores an advertising grant a hand-edited record claims', () => {
    // `readStoredVisitorConsent` already re-derives `analytics` from status
    // for this reason; advertising gets the same treatment.
    window.localStorage.setItem(
      visitorConsentStorageKey('h1'),
      JSON.stringify({ v: 1, at: 1, status: 'declined', analytics: true, advertising: true }),
    )
    const record = readStoredVisitorConsent('h1')
    expect(record?.analytics).toBe(false)
    expect(record?.advertising).toBe(false)
  })

  it('reads a LEGACY record with no advertising key as never-asked', () => {
    // Every record written before this change. "Was never asked about
    // advertising" is not "said yes" — the whole reason the shape is
    // versioned. A migration that read absent as granted would hand Google a
    // basis for every visitor who ever clicked Allow on an analytics banner.
    window.localStorage.setItem(
      visitorConsentStorageKey('h1'),
      JSON.stringify({ v: 1, at: 1, status: 'accepted', analytics: true }),
    )
    const record = readStoredVisitorConsent('h1')
    expect(record?.analytics).toBe(true)
    expect(record?.advertising).toBe(false)
  })

  it('will not grant advertising on a host that never turned it on', () => {
    // Belt and braces: a record carried over from a site that DID ask, or
    // left behind after the host switched the category back off.
    const record = storeVisitorConsent('h1', {
      status: 'accepted',
      advertising: true,
    })
    expect(advertisingGrantedByRecord(GA_ADS, record)).toBe(true)
    expect(advertisingGrantedByRecord(GA, record)).toBe(false)
  })

  it('grants nothing when there is no record at all', () => {
    expect(advertisingGrantedByRecord(GA_ADS, null)).toBe(false)
  })
})

describe('the consent-mode signals', () => {
  it('denies all three advertising signals without a grant', () => {
    expect(consentModeSignals({ analytics: true, advertising: false })).toEqual({
      analytics_storage: 'granted',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
    })
  })

  it('grants all three only with an advertising grant', () => {
    expect(consentModeSignals({ analytics: true, advertising: true })).toEqual({
      analytics_storage: 'granted',
      ad_storage: 'granted',
      ad_user_data: 'granted',
      ad_personalization: 'granted',
    })
  })

  it('never grants advertising while analytics is denied', () => {
    // Ads storage without analytics storage is not a state the tool can
    // arrive at honestly: the refusal paths deny both together.
    expect(consentModeSignals({ analytics: false, advertising: true })).toEqual({
      analytics_storage: 'denied',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
    })
  })

  it('leaves analyticsConsentSignals exactly as AGL-1622 left it', () => {
    // The issue says not to widen these three literals, and nothing here
    // does. The analytics-only helper stays the narrow, ads-denied shape;
    // the advertising path is a SEPARATE function a caller has to reach for.
    expect(analyticsConsentSignals(true)).toEqual({
      analytics_storage: 'granted',
      ad_storage: 'denied',
      ad_user_data: 'denied',
      ad_personalization: 'denied',
    })
    expect(analyticsConsentSignals(false).ad_storage).toBe('denied')
  })

  it('keeps the LOAD-TIME default denying advertising', () => {
    // The default is emitted as a constant into an inline script before the
    // tag loads, and it must not vary by visitor: a granting default would
    // be a declaration made before the record is even read. The grant
    // travels as a later `update` instead.
    expect(GA_CONSENT_DEFAULT_SNIPPET).toContain('"ad_storage":"denied"')
    expect(GA_CONSENT_DEFAULT_SNIPPET).not.toContain('"ad_storage":"granted"')
  })
})
