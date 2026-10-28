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

/*==========================================
 * AGLYNBOT THROUGH AGLYN'S OWN EDGE (AGL-4085).
 *
 * The tenant deployment's bot protection answers a client that runs no
 * JavaScript with a 429 challenge page, and AglynBot is such a client. So a
 * site we host, aglyn.com included, could not be brought in: on 2026-10-20 the
 * import read 10 of 121 pages, the ten the store-review bypass happens to
 * admit, and no home page.
 *
 * The edge rule "Site import crawler bypass" (declared in
 * `tools/scripts/lib/firewall-posture.mjs`) lifts that challenge, and nothing
 * else, for a request carrying BOTH this header with the secret AND a
 * user agent starting `AglynBot/`. This module is the only place that holds
 * the secret, and it gives it out for one reason: a request to a hostname this
 * platform serves (`isPlatformServedDomain`: our host records, then the hosting
 * platform's live view). A site anywhere else never sees it.
 *
 * - The secret is `SITE_IMPORT_EDGE_TOKEN`, a server variable on the console,
 *   where the crawl runs. Read in the bracket form, so Next never substitutes
 *   it into a bundle. Unset, or not shaped like a secret, nothing is sent and
 *   nothing is read: the crawler is challenged as it was before.
 * - The decision is per hostname and per request: the fetch asks
 *   `headersFor(url)` again on every redirect hop, so a hop to another host
 *   carries nothing even where the caller would follow it.
 * - Rotation: a new value in the console's env and the same value in the
 *   rule, together. See `apps/docs/docs/operations/firewall-posture.md`.
 *=========================================*/

/** The header the edge rule matches. Lowercase, as the rule declares it. */
export const SITE_IMPORT_EDGE_HEADER = 'x-aglyn-import'

/** A secret shorter than this is treated as unset: `openssl rand -hex 32` makes 64. */
export const SITE_IMPORT_EDGE_TOKEN_MIN_LENGTH = 32

/** Header-safe characters only, so the value can neither break a header nor fail the rule's match. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/

/** Extra headers for one request, asked per address. */
export type SiteImportHeadersFor = (url: URL) => Readonly<Record<string, string>>

/** Sends nothing anywhere. */
export const NO_SITE_IMPORT_HEADERS: SiteImportHeadersFor = () => ({})

export interface SiteImportEdgeDeps {
  /** Where the secret is read from; `process.env` by default. */
  env?: Readonly<Record<string, string | undefined>>
  /** Whether this platform serves a hostname; `isPlatformServedDomain` by default. */
  served?: (hostname: string) => Promise<boolean>
}

/** The edge secret, or null when it is unset or not shaped like one. Never logged. */
export function siteImportEdgeToken(env?: SiteImportEdgeDeps['env']): string | null {
  // The direct read is spelled out so the self-host env reference guard sees it.
  const token = String((env ? env['SITE_IMPORT_EDGE_TOKEN'] : process.env['SITE_IMPORT_EDGE_TOKEN']) ?? '').trim()
  if (token.length < SITE_IMPORT_EDGE_TOKEN_MIN_LENGTH || token.length > 256) return null
  return TOKEN_PATTERN.test(token) ? token : null
}

async function defaultServed(hostname: string): Promise<boolean> {
  // Loaded only once a secret is configured, so a crawl that has none (every
  // spec, every self-hosted deployment without the rule) never opens Firestore.
  // By relative path: see `site-import-edge-server.ts`.
  const { isPlatformServedDomain } = await import('./site-import-edge-server')
  return isPlatformServedDomain(hostname)
}

/**
 * The edge header for requests to one hostname: the secret when this platform
 * serves it, else nothing. Never throws.
 */
export async function siteImportEdgeHeaders(
  hostname: string,
  deps: SiteImportEdgeDeps = {},
): Promise<Readonly<Record<string, string>>> {
  const token = siteImportEdgeToken(deps.env)
  if (!token) return {}
  const name = String(hostname ?? '').trim().toLowerCase()
  if (!name) return {}
  try {
    const served = await (deps.served ?? defaultServed)(name)
    return served ? { [SITE_IMPORT_EDGE_HEADER]: token } : {}
  } catch (error) {
    console.error('[site-import-edge] could not tell whether the platform serves', name, error)
    return {}
  }
}

/**
 * Per-request headers for a crawl of these origins: each origin's hostname is
 * decided once, and a request is given the header only when it is https on
 * the default port to an origin decided "served". Anything else, a hop to
 * another host included, gets nothing.
 */
export async function siteImportEdgeHeadersFor(
  origins: readonly string[],
  deps: SiteImportEdgeDeps = {},
): Promise<SiteImportHeadersFor> {
  if (!siteImportEdgeToken(deps.env)) return NO_SITE_IMPORT_HEADERS
  const decided = new Map<string, Readonly<Record<string, string>>>()
  for (const raw of origins) {
    let origin: URL
    try {
      origin = new URL(raw)
    } catch {
      continue
    }
    if (!isPlainHttpsOrigin(origin) || decided.has(origin.origin)) continue
    const headers = await siteImportEdgeHeaders(origin.hostname, deps)
    if (Object.keys(headers).length) decided.set(origin.origin, headers)
  }
  if (!decided.size) return NO_SITE_IMPORT_HEADERS
  return (url: URL) => (isPlainHttpsOrigin(url) ? decided.get(url.origin) ?? {} : {})
}

function isPlainHttpsOrigin(url: URL): boolean {
  return url.protocol === 'https:' && (!url.port || url.port === '443') && !url.username && !url.password
}
