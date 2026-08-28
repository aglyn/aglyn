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

import { geoHintFromTimeZone } from './timezone-geo-hint'
import { PLATFORM_PRIOR_CONSENT_REGIONS } from './platform-consent-default'

/**
 * The time-zone region hint, the last resort when no edge sends a country.
 *
 * The asymmetry is the whole design and every case below is written against
 * it: guessing PERMISSIVE for a European visitor tracks somebody the law says
 * to ask first, while guessing STRICT for an American shows a banner nobody
 * needed. So an unrecognized zone must resolve to strict, and only a zone that
 * is positively identified as non-European may resolve to permissive.
 */
describe('a zone that requires asking first', () => {
  it('THE CONTROL: an ordinary European city is prior-consent', () => {
    // Without this, every "not prior consent" case below could be passing
    // because the function returns null for everything.
    expect(geoHintFromTimeZone('Europe/Berlin')?.priorConsent).toBe(true)
    expect(geoHintFromTimeZone('Europe/Dublin')?.priorConsent).toBe(true)
    expect(geoHintFromTimeZone('Europe/London')?.priorConsent).toBe(true)
    expect(geoHintFromTimeZone('Europe/Zurich')?.priorConsent).toBe(true)
  })

  it('the EU outermost regions, which are NOT filed under Europe/', () => {
    /*
     * The case this exists for. The GDPR applies in Guadeloupe and the
     * Canaries exactly as in Paris, and IANA files both under `America/` and
     * `Atlantic/` — so a `Europe/` prefix test alone puts every one of them on
     * the permissive side, which is the one direction this must never get
     * wrong.
     */
    for (const zone of [
      'Atlantic/Canary',
      'Atlantic/Madeira',
      'Atlantic/Azores',
      'Atlantic/Reykjavik',
      'America/Guadeloupe',
      'America/Martinique',
      'America/Cayenne',
      'Indian/Reunion',
      'Indian/Mayotte',
    ]) {
      expect(geoHintFromTimeZone(zone)?.priorConsent).toBe(true)
    }
  })

  it('names a country only where the mapping is unambiguous', () => {
    // These carry a country because the territory IS the country. A
    // `Europe/<City>` zone does not, because several span more than one and a
    // merely probable country is worse on the record than an absent one.
    expect(geoHintFromTimeZone('Atlantic/Canary')?.country).toBe('ES')
    expect(geoHintFromTimeZone('Indian/Reunion')?.country).toBe('RE')
    expect(geoHintFromTimeZone('Europe/Berlin')?.country).toBeNull()
  })

  it('every country it does name is actually in the prior-consent set', () => {
    // A mapped country that is not in the set would produce the contradiction
    // "prior consent, from a region that does not require it".
    for (const zone of ['Atlantic/Canary', 'America/Martinique', 'Indian/Mayotte']) {
      const hint = geoHintFromTimeZone(zone)
      expect(hint?.priorConsent).toBe(true)
      expect(PLATFORM_PRIOR_CONSENT_REGIONS).toContain(hint?.country as string)
    }
  })
})

describe('a zone that does not', () => {
  it('the Americas, Asia and the Pacific', () => {
    for (const zone of [
      'America/Chicago',
      'America/New_York',
      'America/Los_Angeles',
      'Asia/Tokyo',
      'Australia/Sydney',
      'Africa/Lagos',
      'Pacific/Auckland',
    ]) {
      expect(geoHintFromTimeZone(zone)?.priorConsent).toBe(false)
    }
  })

  it('claims no country for them, even the obvious ones', () => {
    /*
     * `America/Chicago` is overwhelmingly the United States and is also `CA`
     * and `MX` territory in places. The country is STORED on the consent
     * record; the posture is all that is needed, and all this can honestly
     * support.
     */
    expect(geoHintFromTimeZone('America/Chicago')?.country).toBeNull()
    expect(geoHintFromTimeZone('Asia/Tokyo')?.country).toBeNull()
  })

  it('European zones OUTSIDE the EEA/UK/CH set', () => {
    // Europe the continent is not the EEA. Getting this wrong is harmless for
    // the posture — it only makes it stricter — but it would store a region
    // claim that is untrue.
    for (const zone of ['Europe/Moscow', 'Europe/Istanbul', 'Europe/Kyiv']) {
      expect(geoHintFromTimeZone(zone)?.priorConsent).toBe(false)
    }
  })
})

describe('anything it cannot read falls to the strict side', () => {
  it('returns null, never a permissive answer', () => {
    /*
     * `null` means "says nothing", and every caller must treat it exactly as a
     * missing header: opt-in. Returning `{priorConsent: false}` here would
     * hand the permissive posture to a visitor hiding their zone, which is the
     * population most likely to object to it.
     */
    for (const zone of ['UTC', 'GMT', 'Etc/GMT+5', 'Etc/UTC', 'Nonsense/Place', '', '   ']) {
      expect(geoHintFromTimeZone(zone)).toBeNull()
    }
    expect(geoHintFromTimeZone(null)).toBeNull()
    expect(geoHintFromTimeZone(undefined)).toBeNull()
  })

  it('THE CONTRAST: a readable zone does answer', () => {
    // Otherwise the case above passes on a function that returns null always.
    expect(geoHintFromTimeZone('America/Chicago')).not.toBeNull()
    expect(geoHintFromTimeZone('Europe/Paris')).not.toBeNull()
  })
})
