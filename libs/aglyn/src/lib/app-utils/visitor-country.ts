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
 * The country a site visitor browses from, asked of the site's own
 * `/api/consent/region` door (a per-visitor request header, so it can never
 * be baked into a cached page).
 *
 * One lookup per visit, shared by every caller: the consent hook asks it to
 * pick a posture (AGL-1498), and a store's shopper currency asks it to pick
 * the currency a visitor sees (AGL-4248). Imports nothing, so the consent
 * subtree it serves stays independent of the plugin gate (AGL-1550).
 */

/** Where a site asks which country its visitor is in. */
export const VISITOR_REGION_ENDPOINT = '/api/consent/region'

/** Session-scoped region cache — one lookup per visit, not per pageview. */
export const VISITOR_REGION_CACHE_KEY = 'aglyn:consent:region'

/**
 * The lookup that is CURRENTLY IN FLIGHT, shared by every caller that arrives
 * while it is (AGL-2710).
 *
 * The session cache below is written when the response lands, so it dedupes
 * a later pageview and nothing sooner: the consent kick fires during render,
 * its hook from an effect, and a store's currency from another, all inside
 * one hydration. Released once the promise settles rather than kept as a
 * memo: the session cache is the durable answer and it is the one that
 * carries the "a successful null is still an answer" rule. A rejected or
 * headerless lookup writes nothing, so the next pageview re-asks instead of
 * pinning a blip's verdict for the session.
 */
let regionInFlight: Promise<string | null> | null = null

async function fetchVisitorCountry(): Promise<string | null> {
  try {
    const response = await fetch(VISITOR_REGION_ENDPOINT)
    if (!response.ok) return null
    const payload = await response.json().catch((): null => null)
    const country = typeof payload?.country === 'string' ? payload.country : null
    try {
      // A successful `null` is cached too: "the edge sends no geo here" is
      // an answer, and re-asking cannot improve it this session.
      window.sessionStorage.setItem(VISITOR_REGION_CACHE_KEY, JSON.stringify({ country }))
    } catch {
      // Best-effort cache only.
    }
    return country
  } catch {
    // Network failure reads as an unknown region.
    return null
  }
}

/** The visitor's country (ISO 3166 alpha-2), or null when the site cannot tell. */
export async function resolveVisitorCountry(): Promise<string | null> {
  if (typeof window === 'undefined') return null
  try {
    const cached = window.sessionStorage.getItem(VISITOR_REGION_CACHE_KEY)
    if (cached) {
      const parsed = JSON.parse(cached)
      if (parsed && 'country' in parsed) {
        return typeof parsed.country === 'string' ? parsed.country : null
      }
    }
  } catch {
    // No storage — fetch every pageview; correct, just less frugal.
  }
  if (regionInFlight) return regionInFlight
  const pending = fetchVisitorCountry().finally(() => {
    if (regionInFlight === pending) regionInFlight = null
  })
  regionInFlight = pending
  return pending
}
