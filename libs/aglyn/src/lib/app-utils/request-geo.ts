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

/** Vercel's edge geo headers, the only geo signal this deployment has. */
export const GEO_COUNTRY_HEADER = 'x-vercel-ip-country'
export const GEO_REGION_HEADER = 'x-vercel-ip-country-region'

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
