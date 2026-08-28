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
 * A last-resort region signal, read from the browser's own time zone.
 *
 * ## Why this exists
 *
 * The consent posture is decided from the request's country, and the country
 * comes from an edge header. `readRequestGeo` now tries eight of them, but a
 * deployment can still have none: a self-hosted container behind a plain
 * reverse proxy, a preview build, or `localhost`. Every one of those resolves
 * to "region unknown", which is deliberately the STRICTEST posture — so the
 * visitor is asked to opt in.
 *
 * That is the safe direction and it is still wrong for most of the world. It
 * also means a self-host operator in the US sees a prior-consent banner they
 * do not need and cannot switch off, and has no way to tell that the cause is
 * a missing header rather than a deliberate setting.
 *
 * ## Why the time zone, and not an IP lookup
 *
 * ⛔ Deliberately NOT a geolocation service. Sending a visitor's IP address to
 * a third party in order to decide what to ask them about privacy is its own
 * disclosure and its own subprocessor — the cure would be worse than the
 * problem it treats.
 *
 * The time zone is already in the page, costs no request, identifies no one,
 * and is exactly as coarse as the question: this is not "where are you", it is
 * "are you somewhere that requires asking first".
 *
 * ## What it will not do
 *
 * It never returns a country for a non-European zone. `America/Chicago` is
 * ninety-nine percent the United States and it is also `US`, `CA` and `MX`
 * territory in places — and the country is STORED on the consent record, where
 * a confident guess is worse than an absent value. So the answer for those is
 * "not a prior-consent region, country unknown", which is all the posture
 * needs and all this can honestly say.
 *
 * ⚠️ A VPN, a travelling laptop or a manually-set clock can all disagree with
 * the visitor's actual location. This ranks BELOW every header for that
 * reason, and the strict posture is still what an unrecognized zone gets.
 */

/**
 * The IANA area prefixes that are never a prior-consent region.
 *
 * Listed positively rather than as "anything that is not Europe/": an unknown
 * or malformed zone must fall through to the strict posture, and a negative
 * test would hand it the permissive one.
 */
const NON_EUROPEAN_AREAS = [
  'America/',
  'Asia/',
  'Australia/',
  'Africa/',
  'Pacific/',
  'Antarctica/',
  'US/',
  'Canada/',
  'Brazil/',
  'Mexico/',
  'Japan',
  'Singapore',
  'Hongkong',
  'NZ',
]

/**
 * Zones inside a prior-consent country that do NOT start with `Europe/`.
 *
 * The EU's outermost regions and the EEA's islands are the reason this list
 * exists: the GDPR applies in Guadeloupe and the Canaries exactly as it does
 * in Paris and Madrid, and every one of them is filed by IANA under `America/`,
 * `Atlantic/` or `Indian/`. Matching on `Europe/` alone would place all of
 * them on the permissive side, which is the one direction this must never get
 * wrong.
 */
const PRIOR_CONSENT_NON_EUROPE_ZONES: Readonly<Record<string, string>> = {
  'Atlantic/Canary': 'ES',
  'Atlantic/Madeira': 'PT',
  'Atlantic/Azores': 'PT',
  'Atlantic/Reykjavik': 'IS',
  'Atlantic/Faroe': 'DK',
  'Atlantic/Jan_Mayen': 'NO',
  'America/Cayenne': 'GF',
  'America/Guadeloupe': 'GP',
  'America/Martinique': 'MQ',
  'America/Marigot': 'GP',
  'America/St_Barthelemy': 'GP',
  'Indian/Reunion': 'RE',
  'Indian/Mayotte': 'YT',
  'Arctic/Longyearbyen': 'NO',
}

/**
 * `Europe/<City>` zones whose country is NOT in the prior-consent set.
 *
 * The EEA is not the same shape as the continent. Without these, a visitor in
 * Moscow or Istanbul would be treated as a European one — harmless for the
 * consent posture, since it only makes it stricter, but it would store a
 * region claim that is simply untrue.
 */
const EUROPE_ZONES_OUTSIDE_THE_SET = [
  'Europe/Moscow',
  'Europe/Istanbul',
  'Europe/Kiev',
  'Europe/Kyiv',
  'Europe/Minsk',
  'Europe/Belgrade',
  'Europe/Sarajevo',
  'Europe/Skopje',
  'Europe/Tirane',
  'Europe/Podgorica',
  'Europe/Chisinau',
  'Europe/Volgograd',
  'Europe/Samara',
  'Europe/Kaliningrad',
  'Europe/Simferopol',
]

export interface TimeZoneGeoHint {
  /**
   * The country, when the zone identifies one honestly. `null` means "not a
   * prior-consent region, and this cannot say which country" — a real answer
   * for the posture, and the only truthful one for the record.
   */
  country: string | null
  /** Whether this zone sits in a region that must be asked before tracking. */
  priorConsent: boolean
}

/** The browser's IANA zone, or `''` where `Intl` cannot answer. */
export function readBrowserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || ''
  } catch {
    // Some locked-down and embedded runtimes throw rather than return.
    return ''
  }
}

/**
 * The region hint for an IANA zone, or `null` when it says nothing useful.
 *
 * `null` is the answer for an unknown zone, and callers must treat it exactly
 * as they treat a missing header: strictest posture. It is never a licence to
 * assume the permissive side.
 */
export function geoHintFromTimeZone(
  timeZone: string | null | undefined,
): TimeZoneGeoHint | null {
  const zone = (timeZone ?? '').trim()
  if (!zone) return null

  const mapped = PRIOR_CONSENT_NON_EUROPE_ZONES[zone]
  if (mapped) return { country: mapped, priorConsent: true }

  if (zone.indexOf('Europe/') === 0) {
    if (EUROPE_ZONES_OUTSIDE_THE_SET.indexOf(zone) >= 0) {
      // Europe, but outside the EEA/UK/CH set. No country claim: the zone
      // identifies a city, and several of these span more than one country.
      return { country: null, priorConsent: false }
    }
    /*
     * Prior consent, with no country named. The posture is all that is needed
     * and it is all this can support — `Europe/Zurich` is Switzerland, but
     * `Europe/Brussels` is also Luxembourg's zone in practice, and a stored
     * country that is merely probable is worse than an absent one.
     */
    return { country: null, priorConsent: true }
  }

  for (const area of NON_EUROPEAN_AREAS) {
    const matches = area.endsWith('/') ? zone.indexOf(area) === 0 : zone === area
    if (matches) return { country: null, priorConsent: false }
  }

  // UTC, GMT, `Etc/*`, a fixed offset, or anything unrecognized. A visitor
  // hiding their zone is not a visitor to assume the permissive side about.
  return null
}
