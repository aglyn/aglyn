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
 * A SERVER CALL TO A URL A TENANT TYPED (AGL-3363).
 *
 * Some features call an address the merchant configured, from the
 * platform's own servers: a dropship supplier's order webhook is the first.
 * That address is author data, so it gets the checks the plugin fetch proxy
 * (`serve-plugin-fetch.ts`, AGL-515/1881) gives a plugin's declared origin,
 * through the same two primitives, rather than a bare `fetch`:
 *
 * - https only, on the default port, with no credentials in the authority;
 * - a host that wears a brand it is not (`lookalikeBrandForHost`) is refused
 *   for every workspace, the phishing screen's strong tier;
 * - the name must resolve to PUBLIC addresses only, and the connection is
 *   pinned to the address that was checked (`resolvePublicIp` +
 *   `createPinnedDispatcher`), so a name cannot be rebound to the cloud
 *   metadata endpoint or a private range between the check and the connect;
 * - a redirect is not followed (`redirect: 'manual'`): a 3xx is the answer,
 *   which a caller that wants a 2xx treats as a failure.
 *
 * This sits beside the plugin fetch proxy and is not it: that one proxies a
 * browser's request to an allowlisted origin and streams the reply; this is
 * a server's own call with no allowlist but the rules above.
 *=========================================*/

import { lookalikeBrandForHost } from '@aglyn/shared-util-email/outbound-phishing-screen'
import { createPinnedDispatcher, resolvePublicIp } from './serve-plugin-fetch'

/** Why a configured URL was not called. */
export type ConfiguredUrlRefusal =
  | 'malformed'
  | 'not-https'
  | 'credentials'
  | 'port'
  | 'lookalike'
  | 'private-address'

/** The checks that need no network: shape, scheme, port, credentials, brand. */
export function configuredUrlRefusal(url: unknown): ConfiguredUrlRefusal | null {
  let parsed: URL
  try {
    parsed = new URL(String(url ?? ''))
  } catch {
    return 'malformed'
  }
  if (parsed.protocol !== 'https:') return 'not-https'
  if (parsed.username || parsed.password) return 'credentials'
  if (parsed.port && parsed.port !== '443') return 'port'
  if (lookalikeBrandForHost(parsed.hostname)) return 'lookalike'
  return null
}

/** What the merchant is told a refusal means, in their words. */
export function describeConfiguredUrlRefusal(refusal: ConfiguredUrlRefusal): string {
  switch (refusal) {
    case 'malformed':
      return 'the address is not a valid web address'
    case 'not-https':
      return 'the address must start with https://'
    case 'credentials':
      return 'the address must not contain a user name or password'
    case 'port':
      return 'the address must use the standard https port'
    case 'lookalike':
      return 'the address looks like another company’s website'
    case 'private-address':
      return 'the address does not lead to a public server'
  }
}

export type ConfiguredUrlFetchResult =
  /** Called: the status it answered. The body is discarded. */
  | { ok: true; status: number }
  | { ok: false; refusal: ConfiguredUrlRefusal; host: string }

/**
 * Call `url` under the rules above and answer its status; the body is
 * discarded, because a notification's receiver answers with a status and
 * nothing a caller should read. Never follows a redirect. Throws only what
 * `fetch` throws (a timeout, a reset), for the caller to retry.
 */
export async function fetchConfiguredPublicUrl(
  url: string,
  init: Omit<RequestInit, 'redirect'>,
  deps: { resolve?: typeof resolvePublicIp } = {},
): Promise<ConfiguredUrlFetchResult> {
  const refusal = configuredUrlRefusal(url)
  let host: string
  try {
    host = new URL(url).hostname
  } catch {
    host = ''
  }
  if (refusal) return { ok: false, refusal, host }
  const pinned = await (deps.resolve ?? resolvePublicIp)(host)
  if (!pinned) return { ok: false, refusal: 'private-address', host }
  const dispatcher = createPinnedDispatcher(pinned)
  try {
    // `dispatcher` is undici's, which the global fetch honors; spread from a
    // variable so the DOM `RequestInit` type does not reject the field.
    const pinnedInit = { ...init, redirect: 'manual' as const, dispatcher }
    const response = await fetch(url, pinnedInit as RequestInit)
    // Released before the dispatcher closes: `close` waits for requests in
    // flight, and an unread body is one.
    await response.body?.cancel().catch(() => undefined)
    return { ok: true, status: Number(response.status ?? 0) }
  } finally {
    await dispatcher.close().catch(() => undefined)
  }
}
