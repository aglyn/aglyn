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
 * The region-conditional analytics default on Aglyn's own surfaces
 * (AGL-1597).
 *
 * Every assertion here reads the SHIPPED declaration —
 * `PLATFORM_CONSENT_DEFAULT_COMMANDS` — through the same resolver the module
 * exports, rather than re-stating the intended answer as a second constant.
 * A test that keeps its own copy of the expected payload passes whatever the
 * payload becomes.
 *
 * PLANTED REDS (both verified by hand before this file was committed, by
 * mutating `platform-consent-default.ts` and re-running):
 *
 * 1. Global default flipped to `analytics_storage: 'denied'` → the US /
 *    rest-of-world cases fail. Proves the granted side is really asserted.
 * 2. The region-scoped command deleted (or its `region` emptied) → every
 *    EEA/UK/CH case fails. Proves the denied side is really asserted, and
 *    that it comes from the region override rather than from the global.
 *
 * Neither red is reachable by accident: the two branches fail on disjoint
 * sets of these tests.
 */

import {
  PLATFORM_CONSENT_DEFAULT_COMMANDS,
  PLATFORM_CONSENT_DEFAULT_SNIPPET,
  PLATFORM_PRIOR_CONSENT_REGIONS,
  pushPlatformConsentDefault,
  resolvePlatformConsentDefault,
} from './platform-consent-default'
import { PRIOR_CONSENT_COUNTRY_CODES } from './visitor-consent'

/** Prior-consent regions: analytics must be DENIED by default. */
const PRIOR_CONSENT_SAMPLES = [
  ['DE', 'Germany — EU'],
  ['FR', 'France — EU'],
  ['IE', 'Ireland — EU'],
  ['GB', 'the UK'],
  ['GI', 'Gibraltar — UK GDPR extends there'],
  ['NO', 'Norway — EEA/EFTA'],
  ['IS', 'Iceland — EEA/EFTA'],
  ['LI', 'Liechtenstein — EEA/EFTA'],
  ['GF', 'French Guiana — EU outermost region'],
  ['CH', 'Switzerland — stricter than the tenant set, on purpose'],
] as const

/** Implied-consent regions: analytics must be GRANTED by default. */
const IMPLIED_CONSENT_SAMPLES = [
  ['US', 'the United States'],
  ['CA', 'Canada — PIPEDA, opt-out'],
  ['BR', 'Brazil — LGPD, opt-out'],
  ['AU', 'Australia'],
  ['JP', 'Japan'],
  ['IN', 'India'],
  ['MX', 'Mexico'],
  ['ZA', 'South Africa'],
] as const

describe('the platform analytics consent default (AGL-1597)', () => {
  describe('denies analytics by default where prior consent is required', () => {
    it.each(PRIOR_CONSENT_SAMPLES)('%s — %s', (country) => {
      expect(resolvePlatformConsentDefault(country).analytics_storage).toBe(
        'denied',
      )
    })

    it('covers EVERY code in the tenant prior-consent set', () => {
      // The derivation is the point: an EU membership change edited in
      // `visitor-consent.ts` must reach this surface without a second edit.
      // A hand-typed second list is what this assertion exists to forbid.
      for (const code of PRIOR_CONSENT_COUNTRY_CODES) {
        expect(resolvePlatformConsentDefault(code).analytics_storage).toBe(
          'denied',
        )
      }
    })

    it('is case-insensitive, as ISO codes off the wire are not normalized', () => {
      expect(resolvePlatformConsentDefault('de').analytics_storage).toBe(
        'denied',
      )
    })
  })

  describe('grants analytics by default where implied consent is lawful', () => {
    it.each(IMPLIED_CONSENT_SAMPLES)('%s — %s', (country) => {
      expect(resolvePlatformConsentDefault(country).analytics_storage).toBe(
        'granted',
      )
    })
  })

  describe('the advertising signals', () => {
    it('are denied in the prior-consent branch', () => {
      const signals = resolvePlatformConsentDefault('DE')
      expect(signals.ad_storage).toBe('denied')
      expect(signals.ad_user_data).toBe('denied')
      expect(signals.ad_personalization).toBe('denied')
    })

    it('are GRANTED in the implied-consent branch, with analytics', () => {
      /*
       * Aglyn advertises, remarkets and retargets on its own surfaces, and the
       * Privacy Policy names the console among them. Outside the prior-consent
       * regions the posture is implied consent and all four signals follow it
       * together — a declaration that granted analytics while denying ads
       * would describe a surface that does not exist.
       */
      const signals = resolvePlatformConsentDefault('US')
      expect(signals.ad_storage).toBe('granted')
      expect(signals.ad_user_data).toBe('granted')
      expect(signals.ad_personalization).toBe('granted')
    })

    it('are denied in a prior-consent region until the visitor accepts', () => {
      // The half that must never move. A grant here would be pre-consent
      // advertising for exactly the population the law asks first.
      const signals = resolvePlatformConsentDefault('DE')
      expect(signals.ad_storage).toBe('denied')
      expect(signals.ad_user_data).toBe('denied')
      expect(signals.ad_personalization).toBe('denied')
      expect(signals.analytics_storage).toBe('denied')
    })

    it('the EMITTED region-scoped command denies all four, not just analytics', () => {
      // The resolver is derived; the snippet is what actually ships, and a
      // region-scoped command that forgot the ad signals would leave them at
      // the granted global default for European visitors.
      const scoped = PLATFORM_CONSENT_DEFAULT_COMMANDS.filter(
        (command) => command.region,
      )
      expect(scoped.length).toBe(1)
      for (const command of scoped) {
        expect(command.ad_storage).toBe('denied')
        expect(command.ad_user_data).toBe('denied')
        expect(command.ad_personalization).toBe('denied')
        expect(command.analytics_storage).toBe('denied')
      }
    })
  })

  describe('the emitted declaration', () => {
    it('is exactly one global default and one region-scoped override', () => {
      const global = PLATFORM_CONSENT_DEFAULT_COMMANDS.filter(
        (command) => command.region === undefined,
      )
      const regional = PLATFORM_CONSENT_DEFAULT_COMMANDS.filter(
        (command) => command.region !== undefined,
      )
      expect(global).toHaveLength(1)
      expect(regional).toHaveLength(1)
      expect(global[0].analytics_storage).toBe('granted')
      expect(regional[0].analytics_storage).toBe('denied')
    })

    it('declares `default`, never `update`', () => {
      // An `update` arrives after `config`, so the session's first pageview
      // would carry a state nobody declared.
      expect(PLATFORM_CONSENT_DEFAULT_SNIPPET).toContain(
        "gtag('consent','default',",
      )
      expect(PLATFORM_CONSENT_DEFAULT_SNIPPET).not.toContain("'update'")
    })

    it('names the prior-consent regions in the snippet itself', () => {
      expect(PLATFORM_CONSENT_DEFAULT_SNIPPET).toContain('"region"')
      expect(PLATFORM_CONSENT_DEFAULT_SNIPPET).toContain('"DE"')
      expect(PLATFORM_CONSENT_DEFAULT_SNIPPET).toContain('"GB"')
      expect(PLATFORM_CONSENT_DEFAULT_SNIPPET).toContain('"CH"')
    })

    it('is byte-stable, so the docs copy can be checked verbatim', () => {
      expect(PLATFORM_PRIOR_CONSENT_REGIONS).toEqual(
        [...PLATFORM_PRIOR_CONSENT_REGIONS].sort(),
      )
    })
  })

  describe('the tenant boundary', () => {
    it('leaves the tenant prior-consent set UNWIDENED', () => {
      // Switzerland is added for Aglyn's own surfaces only. Adding it to the
      // shared set would flip Swiss visitors on every CUSTOMER site from
      // tracked to banner-gated — a change to a customer's compliance
      // posture, made on their behalf, which this work is scoped out of.
      expect(PRIOR_CONSENT_COUNTRY_CODES.has('CH')).toBe(false)
    })

    it('is a strict superset of the tenant set', () => {
      for (const code of PRIOR_CONSENT_COUNTRY_CODES) {
        expect(PLATFORM_PRIOR_CONSENT_REGIONS).toContain(code)
      }
      expect(PLATFORM_PRIOR_CONSENT_REGIONS.length).toBe(
        PRIOR_CONSENT_COUNTRY_CODES.size + 1,
      )
    })
  })

  describe('pushing onto a dataLayer (the console path)', () => {
    it('queues both declarations as `arguments` objects, not arrays', () => {
      // gtag.js reads `arguments` objects. `dataLayer.push(['consent', …])`
      // is the classic silent no-op: no error, and no declaration.
      const win: { dataLayer?: unknown[] } = {}
      expect(pushPlatformConsentDefault(win)).toBe(true)
      expect(win.dataLayer).toHaveLength(2)
      for (const entry of win.dataLayer) {
        expect(Array.isArray(entry)).toBe(false)
        expect(Object.prototype.toString.call(entry)).toBe(
          '[object Arguments]',
        )
      }
      expect([...(win.dataLayer[0] as IArguments)]).toEqual([
        'consent',
        'default',
        PLATFORM_CONSENT_DEFAULT_COMMANDS[0],
      ])
    })

    it('preserves anything already queued', () => {
      const win: { dataLayer?: unknown[] } = { dataLayer: ['pre-existing'] }
      pushPlatformConsentDefault(win)
      expect(win.dataLayer[0]).toBe('pre-existing')
      expect(win.dataLayer).toHaveLength(3)
    })

    it('is idempotent, so a re-entrant boot cannot stack duplicates', () => {
      const win: { dataLayer?: unknown[] } = {}
      pushPlatformConsentDefault(win)
      expect(pushPlatformConsentDefault(win)).toBe(false)
      expect(win.dataLayer).toHaveLength(2)
    })
  })
})
