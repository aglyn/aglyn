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
 * The ONE request-geo reader (AGL-1492/1498).
 *
 * Extracted from the console's sanctions module so the tenant's consent-mode
 * endpoint reads the identical signal the sanctions gate does — two geo
 * layers would eventually disagree about the same request. The sanctions
 * POLICY (embargo sets, verdicts, the 451) stays in
 * `apps/console/constants/sanctions-geo.ts`; this is only the signal.
 */

/**
 * The headers carrying the request's country, subdivision and city, named by
 * configuration with Vercel's own as the default (AGL-2436).
 *
 * These were bare `x-vercel-*` literals, under a comment calling them "the
 * only geo signal this deployment has" — true of Aglyn's cloud and false of
 * every self-host install, where no edge sets them. Nothing else supplies the
 * signal, so on a container `readRequestGeo` returned `null` for every request
 * and the two things built on it were off in production:
 *
 *  - the sanctions gate FAILED OPEN on every request, logging it once per
 *    instance — an embargo control that is silently not running,
 *  - the tenant's consent-region endpoint had no region to answer with,
 *  - the new-device sign-in alert reported "Unknown location" to every user,
 *    and stored that string, so the breach-notification report that reads a
 *    data subject's country back off it counted nobody.
 *
 * An operator's proxy has the signal under its own name: Cloudflare sends
 * `cf-ipcountry`, and Caddy/nginx/Traefik can set whatever they are told to.
 * Naming the header is all that was missing.
 *
 * ⚠️ Read with DOT notation and mapped through the `env` block of both
 * `next.config.js` files, because `apps/console/middleware.ts` imports the
 * sanctions gate and therefore this module into the EDGE bundle. Next inlines
 * `process.env.NAME` there at build time and never the bracket form (AGL-2037)
 * — so these are fixed when the image is built, not when it starts, exactly
 * like `AGLYN_TENANT_HOST_CNAME`.
 *
 * Lower-cased because the value is used as a `Vary` header, where it is echoed
 * verbatim rather than matched case-insensitively.
 */
export const GEO_COUNTRY_HEADER = (
  process.env.AGLYN_GEO_COUNTRY_HEADER || 'x-vercel-ip-country'
).toLowerCase()
export const GEO_REGION_HEADER = (
  process.env.AGLYN_GEO_REGION_HEADER || 'x-vercel-ip-country-region'
).toLowerCase()
export const GEO_CITY_HEADER = (
  process.env.AGLYN_GEO_CITY_HEADER || 'x-vercel-ip-city'
).toLowerCase()

export interface RequestGeo {
  /** ISO 3166-1 alpha-2, uppercased. `null` when the edge sent no signal. */
  country: string | null
  /** Bare ISO 3166-2 subdivision code, uppercased. `null` when absent. */
  region: string | null
}

/** A minimal `Headers`, so route handlers and middleware share one reader. */
export interface HeaderReader {
  get(name: string): string | null
}

/**
 * Normalize a subdivision code to the bare, zero-padded ISO 3166-2 form.
 *
 * Providers disagree on `UA-43` vs `43`, and on `9` vs `09` for Luhansk. All
 * three spellings have to land on the same set member or a sub-country
 * control silently answers "allowed" for a region it was written to catch.
 */
function normalizeRegion(raw: string): string {
  const upper = raw.trim().toUpperCase()
  const bare = upper.includes('-') ? upper.slice(upper.indexOf('-') + 1) : upper
  return /^\d$/.test(bare) ? `0${bare}` : bare
}

/** Reads the edge geo signal off a request's headers. */
/**
 * The country headers tried after the configured one, in order.
 *
 * `GEO_COUNTRY_HEADER` is a single name fixed at BUILD time (see its comment —
 * Next inlines `process.env.NAME` into the edge bundle), so an operator who
 * did not set it before building has no way to supply the signal afterwards,
 * and a deployment that later moves behind a different proxy silently loses
 * it. Every consumer then reads "no country", which is the strictest consent
 * posture and a sanctions gate that fails open.
 *
 * These are the names the common edges actually send. They are tried only
 * AFTER the configured header, so an explicit configuration always wins and
 * nothing here can override a deliberate choice.
 *
 * ⛔ Header-only, and deliberately so: no IP-geolocation lookup. Sending a
 * visitor's address to a third party to decide what to ask them about privacy
 * would be its own disclosure, and a subprocessor.
 */
const FALLBACK_COUNTRY_HEADERS = [
  // Cloudflare.
  'cf-ipcountry',
  // Google Cloud: App Engine, and Cloud Run behind a load balancer.
  'x-appengine-country',
  'x-client-geo-country',
  // AWS CloudFront.
  'cloudfront-viewer-country',
  // Fastly.
  'fastly-geo-country',
  // What a hand-rolled nginx/Caddy/Traefik rule is most often called.
  'x-geo-country',
  'x-country-code',
  'x-country',
] as const

/**
 * `XX` is Cloudflare's answer for "unknown", and `T1` for a Tor exit node —
 * neither is a country, and treating them as one would place the visitor in a
 * region nobody is in. `ZZ` appears from some proxies for the same purpose.
 */
const NON_COUNTRIES = ['XX', 'T1', 'ZZ']

/**
 * Every header consulted for the country, in order, configured one first.
 *
 * Exported because a caller that varies a cached response on the country has
 * to name ALL of them: a `Vary` that lists only the configured header is
 * correct on the one platform whose header that is, and on every other one it
 * lets a CDN serve a US answer to a European visitor from cache. Aglyn is
 * self-hostable on Docker with the operator's own Firebase and no particular
 * edge, so "the one platform" is not an assumption this may make.
 */
export const GEO_COUNTRY_HEADERS: readonly string[] = [
  GEO_COUNTRY_HEADER,
  ...FALLBACK_COUNTRY_HEADERS,
].filter((name, index, all) => all.indexOf(name) === index)

const readCountry = (headers: HeaderReader): string | null => {
  for (const name of GEO_COUNTRY_HEADERS) {
    const value = (headers.get(name) ?? '').trim().toUpperCase()
    // Two letters exactly: a proxy that passes through a city name, a list or
    // an IP under one of these names must not become a "country".
    if (!/^[A-Z]{2}$/.test(value)) continue
    if (NON_COUNTRIES.indexOf(value) >= 0) continue
    return value
  }
  return null
}

/**
 * The subdivision headers tried after the configured one, in order.
 *
 * The sub-country half of the embargo check — Crimea, Donetsk, Luhansk,
 * Sevastopol — matches on this and on nothing else, so an operator who named
 * a country header but no region header had the country gate running and the
 * REGION gate quietly inert: a Donetsk request reads `UA`, which is not
 * embargoed, and passes. Cloudflare sends no subdivision at all, so a
 * deployment behind it has no sub-country signal by any name; the rest do.
 */
const FALLBACK_REGION_HEADERS = [
  'x-appengine-region',
  'x-client-geo-region',
  'cloudfront-viewer-country-region',
  'x-geo-region',
  'x-region-code',
] as const

/** Every header consulted for the subdivision, in order, configured one first. */
export const GEO_REGION_HEADERS: readonly string[] = [
  GEO_REGION_HEADER,
  ...FALLBACK_REGION_HEADERS,
].filter((name, index, all) => all.indexOf(name) === index)

const rawRegion = (headers: HeaderReader): string => {
  for (const name of GEO_REGION_HEADERS) {
    const value = (headers.get(name) ?? '').trim()
    if (value) return value
  }
  return ''
}

export function readRequestGeo(headers: HeaderReader): RequestGeo {
  const region = rawRegion(headers)
  return {
    country: readCountry(headers),
    region: region ? normalizeRegion(region) : null,
  }
}

/**
 * The subdivision as a person should read it, rather than as an embargo set
 * matches it.
 *
 * `readRequestGeo().region` is upper-cased and zero-padded because
 * `EMBARGOED_UA_REGIONS` is an exact-membership test that every spelling of a
 * code has to land on. That normalization is wrong for anything a person
 * reads: a proxy configured to send a subdivision NAME rather than a code
 * reaches a user's security email shouting `CAPITAL`.
 *
 * Same headers, same precedence — only the normalization differs, so the two
 * readers can never disagree about WHICH subdivision a request came from.
 */
export function readRequestRegionLabel(headers: HeaderReader): string | null {
  const raw = rawRegion(headers)
  if (!raw) return null
  const bare = raw.includes('-') ? raw.slice(raw.indexOf('-') + 1) : raw
  // Commas are the delimiter callers join these parts on; see `readRequestCity`.
  const label = bare.replace(/,/g, ' ').replace(/\s+/g, ' ').trim()
  return label || null
}

/**
 * The city names the common edges send, tried after the configured one.
 *
 * Same ordering rule as the country list: the configured header wins, and
 * these only fill in for an operator who never named one. Cloudflare's
 * `cf-ipcity` arrives only on plans where the visitor-location transform is
 * available, so its absence is normal rather than a misconfiguration.
 */
const FALLBACK_CITY_HEADERS = [
  'cf-ipcity',
  'x-appengine-city',
  'x-client-geo-city',
  'cloudfront-viewer-city',
  'x-geo-city',
  'x-city',
] as const

/** Every header consulted for the city, in order, configured one first. */
export const GEO_CITY_HEADERS: readonly string[] = [
  GEO_CITY_HEADER,
  ...FALLBACK_CITY_HEADERS,
].filter((name, index, all) => all.indexOf(name) === index)

/**
 * The longest city name treated as a city.
 *
 * A proxy that passes something else through one of these names — a header
 * list, a user agent, a path — would otherwise be rendered to a person as
 * their sign-in location. 64 characters clears the longest real place names
 * with room to spare.
 */
const MAX_CITY_LENGTH = 64

/**
 * The request's city, decoded, or `null` when no edge sent one.
 *
 * Percent-decoded because every edge that sends this header sends non-ASCII
 * names encoded (`S%C3%A3o%20Paulo`), and an undecoded value reaches a person
 * as mojibake in a security email. A value that is not valid percent-encoding
 * is kept verbatim rather than dropped — a literal `%` in a name is not a
 * reason to lose the city.
 *
 * Commas become spaces. Callers join city, region and country with `", "`
 * into one stored string, and `deviceLocationCountry` reads the country back
 * off the LAST comma-separated token; a comma arriving inside the city half
 * would add a token to a string that a breach-notification report parses.
 */
export function readRequestCity(headers: HeaderReader): string | null {
  for (const name of GEO_CITY_HEADERS) {
    const raw = (headers.get(name) ?? '').trim()
    if (!raw) continue
    let decoded: string
    try {
      decoded = decodeURIComponent(raw)
    } catch {
      decoded = raw
    }
    const city = decoded.replace(/,/g, ' ').replace(/\s+/g, ' ').trim()
    if (!city || city.length > MAX_CITY_LENGTH) continue
    return city
  }
  return null
}
