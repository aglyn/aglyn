/**
 * @jest-environment jsdom
 */
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
  advertisingConsentGranted,
  advertisingConsentWire,
  readAdvertisingConsentWire,
} from './advertising-consent'
import { storeVisitorConsent } from './visitor-consent'

/**
 * A visitor's advertising consent, carried to the server (AGL-3694): carried
 * only when it grants, re-judged on arrival by the browser gate's own
 * predicate, and refused by GPC either way.
 */

const HOST_ID = 'host-1'
const HOST = {
  analytics: { adTags: { meta: '1234567890' } },
  consent: { advertising: true },
}

beforeEach(() => {
  window.localStorage.clear()
  document.cookie = '_fbp=fb.1.1700000000.123; path=/'
  Object.defineProperty(navigator, 'globalPrivacyControl', { value: undefined, configurable: true })
})

describe('advertisingConsentWire (browser)', () => {
  it('carries the record and the vendors’ browser ids when advertising is granted', () => {
    storeVisitorConsent(HOST_ID, { status: 'accepted', country: 'US', advertising: true })
    const wire = advertisingConsentWire(HOST_ID, { lead: 'lead-1' })
    expect(wire).toMatchObject({ v: 1, status: 'accepted', advertising: true, lead: 'lead-1', ids: { fbp: 'fb.1.1700000000.123' } })
  })

  it('carries NOTHING without a grant: no record, analytics only, or a refusal', () => {
    expect(advertisingConsentWire(HOST_ID)).toBeNull()
    storeVisitorConsent(HOST_ID, { status: 'accepted', country: 'US', advertising: false })
    expect(advertisingConsentWire(HOST_ID)).toBeNull()
    storeVisitorConsent(HOST_ID, { status: 'declined', country: 'US', advertising: true })
    expect(advertisingConsentWire(HOST_ID)).toBeNull()
  })

  it('carries nothing from a browser sending Global Privacy Control', () => {
    storeVisitorConsent(HOST_ID, { status: 'accepted', country: 'US', advertising: true })
    Object.defineProperty(navigator, 'globalPrivacyControl', { value: true, configurable: true })
    expect(advertisingConsentWire(HOST_ID)).toBeNull()
  })
})

describe('the server’s verdict', () => {
  const wire = (overrides: Record<string, unknown> = {}) =>
    readAdvertisingConsentWire({ v: 1, status: 'accepted', advertising: true, at: 1, country: 'US', ids: {}, ...overrides })

  it('grants for an explicit yes on a site that asks', () => {
    expect(advertisingConsentGranted(HOST, wire(), { gpc: false })).toBe(true)
  })

  it('grants for the implied default outside the prior-consent regions, as the browser gate does', () => {
    expect(advertisingConsentGranted(HOST, wire({ status: 'implied' }), { gpc: false })).toBe(true)
  })

  it.each([
    ['declined', wire({ status: 'declined' }), HOST, false],
    ['opted out', wire({ status: 'opted-out' }), HOST, false],
    ['GPC on the record', wire({ status: 'gpc-opt-out' }), HOST, false],
    ['GPC on the request', wire(), HOST, true],
    ['a hand-edited grant on a refusal', wire({ status: 'declined', advertising: true }), HOST, false],
    ['a site that does not ask', wire(), { ...HOST, consent: {} }, false],
    ['a site on its own consent tool', wire(), { ...HOST, consent: { advertising: true, disabled: true } }, false],
    ['no wire', null, HOST, false],
  ])('refuses %s', (_label, carried, host, gpc) => {
    expect(advertisingConsentGranted(host as never, carried, { gpc })).toBe(false)
  })

  it('drops anything malformed rather than repairing it', () => {
    expect(readAdvertisingConsentWire({ v: 2, status: 'accepted' })).toBeNull()
    expect(readAdvertisingConsentWire({ v: 1, status: 'yes' })).toBeNull()
    expect(readAdvertisingConsentWire('accepted')).toBeNull()
    const parsed = readAdvertisingConsentWire({
      v: 1, status: 'accepted', advertising: true, at: 1, ids: { fbp: 'bad value<script>' }, lead: 'x y', url: 'javascript:alert(1)',
    })
    expect(parsed?.ids).toEqual({})
    expect(parsed?.lead).toBeUndefined()
    expect(parsed?.url).toBeUndefined()
  })
})
