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
 * The headers carrying the request's country and subdivision, named by
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
 *  - the tenant's consent-region endpoint had no region to answer with.
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
export function readRequestGeo(headers: HeaderReader): RequestGeo {
  const country = (headers.get(GEO_COUNTRY_HEADER) ?? '').trim().toUpperCase()
  const region = (headers.get(GEO_REGION_HEADER) ?? '').trim()
  return {
    country: country || null,
    region: region ? normalizeRegion(region) : null,
  }
}
