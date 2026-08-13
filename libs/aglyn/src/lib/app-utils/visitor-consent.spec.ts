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

import {
  analyticsGrantedByStatus,
  consentGatedCategories,
  hasGlobalPrivacyControl,
  hostConsentRequired,
  isAnalyticsAllowed,
  isConsentToolDisabled,
  isExplicitConsentStatus,
  readStoredVisitorConsent,
  resolveConsentPosture,
  resolveGaMeasurementId,
  resolveHostConsentMode,
  resolveVisitorIdPersistence,
  storeVisitorConsent,
  VISITOR_CONSENT_CHANGED_EVENT,
  VISITOR_ID_STORAGE_KEY,
  visitorConsentStorageKey,
} from './visitor-consent'

const GA_HOST = { analytics: { gaMeasurementId: 'G-ABCD1234' } }

const stored = (status: Parameters<typeof analyticsGrantedByStatus>[0]) => ({
  v: 1 as const,
  at: 1,
  status,
  analytics: analyticsGrantedByStatus(status),
})

describe('visitor consent model (AGL-1498)', () => {
  describe('resolveGaMeasurementId', () => {
    it('accepts only the strict G- format — the id lands in an inline script', () => {
      expect(resolveGaMeasurementId(GA_HOST)).toBe('G-ABCD1234')
      expect(resolveGaMeasurementId({})).toBeNull()
      expect(resolveGaMeasurementId(undefined)).toBeNull()
      expect(
        resolveGaMeasurementId({ analytics: { gaMeasurementId: 'UA-1234-5' } }),
      ).toBeNull()
      expect(
        resolveGaMeasurementId({
          analytics: { gaMeasurementId: 'G-1"</script>' },
        }),
      ).toBeNull()
    })
  })

  describe('hostConsentRequired / consentGatedCategories', () => {
    it('a site with no gated features asks nobody for anything', () => {
      expect(consentGatedCategories({})).toEqual([])
      expect(hostConsentRequired({})).toBe(false)
      expect(hostConsentRequired(undefined)).toBe(false)
    })

    it('configuring GA activates the machinery — the auto-enable posture', () => {
      expect(consentGatedCategories(GA_HOST)).toEqual(['analytics'])
      expect(hostConsentRequired(GA_HOST)).toBe(true)
    })

    it('the host opt-out disables it; absent means ACTIVE', () => {
      expect(
        hostConsentRequired({ ...GA_HOST, consent: { disabled: true } }),
      ).toBe(false)
      expect(hostConsentRequired({ ...GA_HOST, consent: {} })).toBe(true)
      expect(isConsentToolDisabled({ consent: { disabled: false } })).toBe(false)
      expect(isConsentToolDisabled({})).toBe(false)
    })
  })

  describe('resolveConsentPosture — the geo-conditional mode', () => {
    it('prior-consent regions get opt-in: EU, EEA, UK, outermost regions', () => {
      for (const country of ['DE', 'FR', 'IE', 'IS', 'NO', 'GB', 'GI', 'RE']) {
        expect(resolveConsentPosture(GA_HOST, country)).toBe('opt-in')
      }
      expect(resolveConsentPosture(GA_HOST, 'de')).toBe('opt-in')
    })

    it('everywhere else gets implied consent (opt-out posture)', () => {
      for (const country of ['US', 'CA', 'BR', 'JP', 'AU', 'CH']) {
        expect(resolveConsentPosture(GA_HOST, country)).toBe('opt-out')
      }
    })

    it('UNKNOWN region falls to opt-in — never maximize tracking blind', () => {
      expect(resolveConsentPosture(GA_HOST, null)).toBe('opt-in')
      expect(resolveConsentPosture(GA_HOST, undefined)).toBe('opt-in')
      expect(resolveConsentPosture(GA_HOST, '')).toBe('opt-in')
    })

    it("host 'strict' mode forces opt-in everywhere; unset reads as 'geo'", () => {
      const strict = { ...GA_HOST, consent: { mode: 'strict' as const } }
      expect(resolveConsentPosture(strict, 'US')).toBe('opt-in')
      expect(resolveHostConsentMode(strict)).toBe('strict')
      expect(resolveHostConsentMode(GA_HOST)).toBe('geo')
      expect(resolveHostConsentMode(undefined)).toBe('geo')
      expect(
        resolveHostConsentMode({ consent: { mode: 'geo' } }),
      ).toBe('geo')
    })
  })

  describe('status semantics', () => {
    it('grants: accepted and implied track; the three refusals do not', () => {
      expect(analyticsGrantedByStatus('accepted')).toBe(true)
      expect(analyticsGrantedByStatus('implied')).toBe(true)
      expect(analyticsGrantedByStatus('declined')).toBe(false)
      expect(analyticsGrantedByStatus('opted-out')).toBe(false)
      expect(analyticsGrantedByStatus('gpc-opt-out')).toBe(false)
    })

    it('explicit = a click: accepted/declined/opted-out; not implied or GPC', () => {
      expect(isExplicitConsentStatus('accepted')).toBe(true)
      expect(isExplicitConsentStatus('declined')).toBe(true)
      expect(isExplicitConsentStatus('opted-out')).toBe(true)
      expect(isExplicitConsentStatus('implied')).toBe(false)
      expect(isExplicitConsentStatus('gpc-opt-out')).toBe(false)
      expect(isExplicitConsentStatus(null)).toBe(false)
    })
  })

  describe('stored record round-trip', () => {
    afterEach(() => window.localStorage.clear())

    it('is null when never resolved, and keyed per host', () => {
      expect(readStoredVisitorConsent('host-1')).toBeNull()
      storeVisitorConsent('host-1', { status: 'accepted' })
      expect(readStoredVisitorConsent('host-1')?.status).toBe('accepted')
      // One site's yes never leaks to another host on the same origin.
      expect(readStoredVisitorConsent('host-2')).toBeNull()
    })

    it('records the implied,country shape for the opt-out posture', () => {
      storeVisitorConsent('host-1', { status: 'implied', country: 'US' })
      const record = readStoredVisitorConsent('host-1')
      expect(record?.status).toBe('implied')
      expect(record?.country).toBe('US')
      expect(record?.analytics).toBe(true)
    })

    it('rejects unrecognized shapes as undecided', () => {
      window.localStorage.setItem(visitorConsentStorageKey('host-1'), '"yes"')
      expect(readStoredVisitorConsent('host-1')).toBeNull()
      window.localStorage.setItem(
        visitorConsentStorageKey('host-1'),
        JSON.stringify({ v: 1, status: 'whatever' }),
      )
      expect(readStoredVisitorConsent('host-1')).toBeNull()
    })

    it('derives the grant from the STATUS — a hand-edited record cannot widen it', () => {
      window.localStorage.setItem(
        visitorConsentStorageKey('host-1'),
        JSON.stringify({ v: 1, at: 1, status: 'declined', analytics: true }),
      )
      expect(readStoredVisitorConsent('host-1')?.analytics).toBe(false)
    })

    it('every non-granting state removes the persistent visitor id', () => {
      for (const status of ['declined', 'opted-out', 'gpc-opt-out'] as const) {
        window.localStorage.setItem(VISITOR_ID_STORAGE_KEY, 'v-abc')
        storeVisitorConsent('host-1', { status })
        expect(window.localStorage.getItem(VISITOR_ID_STORAGE_KEY)).toBeNull()
      }
    })

    it('granting states keep the visitor id and announce the change', () => {
      window.localStorage.setItem(VISITOR_ID_STORAGE_KEY, 'v-abc')
      const heard = jest.fn()
      window.addEventListener(VISITOR_CONSENT_CHANGED_EVENT, heard)
      storeVisitorConsent('host-1', { status: 'implied', country: 'US' })
      window.removeEventListener(VISITOR_CONSENT_CHANGED_EVENT, heard)
      expect(window.localStorage.getItem(VISITOR_ID_STORAGE_KEY)).toBe('v-abc')
      expect(heard).toHaveBeenCalled()
    })
  })

  describe('hasGlobalPrivacyControl', () => {
    afterEach(() => {
      delete (navigator as unknown as Record<string, unknown>)[
        'globalPrivacyControl'
      ]
    })

    it('reads the live navigator signal', () => {
      expect(hasGlobalPrivacyControl()).toBe(false)
      Object.defineProperty(navigator, 'globalPrivacyControl', {
        value: true,
        configurable: true,
      })
      expect(hasGlobalPrivacyControl()).toBe(true)
    })
  })

  describe('isAnalyticsAllowed — the gate verdict, posture-independent', () => {
    it('no machinery configured: allowed (nothing gated / host opted out)', () => {
      expect(isAnalyticsAllowed({}, null)).toBe(true)
      expect(
        isAnalyticsAllowed({ ...GA_HOST, consent: { disabled: true } }, null),
      ).toBe(true)
    })

    it('machinery active: only a GRANTING recorded state loads the script', () => {
      expect(isAnalyticsAllowed(GA_HOST, null)).toBe(false)
      expect(isAnalyticsAllowed(GA_HOST, stored('declined'))).toBe(false)
      expect(isAnalyticsAllowed(GA_HOST, stored('opted-out'))).toBe(false)
      expect(isAnalyticsAllowed(GA_HOST, stored('gpc-opt-out'))).toBe(false)
      expect(isAnalyticsAllowed(GA_HOST, stored('accepted'))).toBe(true)
      expect(isAnalyticsAllowed(GA_HOST, stored('implied'))).toBe(true)
    })
  })

  describe('resolveVisitorIdPersistence', () => {
    it('persists across visits only when analytics may run', () => {
      expect(resolveVisitorIdPersistence({}, null)).toBe('local')
      expect(resolveVisitorIdPersistence(GA_HOST, null)).toBe('session')
      expect(resolveVisitorIdPersistence(GA_HOST, stored('accepted'))).toBe(
        'local',
      )
      expect(resolveVisitorIdPersistence(GA_HOST, stored('implied'))).toBe(
        'local',
      )
      expect(resolveVisitorIdPersistence(GA_HOST, stored('opted-out'))).toBe(
        'session',
      )
    })
  })
})
