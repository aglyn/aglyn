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

import { OUTREACH_API_ROUTES } from '../constants/api-routes'

/**
 * WHERE GOOGLE SENDS A REP BACK TO (AGL-2978).
 *
 * Google redirects only to an address registered on the OAuth client, matched
 * exactly, so the redirect cannot follow whichever host a rep happened to open
 * the console on: it is the deployment's canonical console origin,
 * `NEXT_PUBLIC_CONSOLE_URL`, plus the callback route. That is the one address
 * an operator registers.
 *
 * Local development is the one exception, and never in production: a request
 * from `http://localhost` or `127.0.0.1` is sent back to itself, so a developer
 * registering their local address on a test client is not bounced to the
 * deployed console after consenting. Anything else a request claims about its
 * origin is ignored — the host Google redirects to is where the authorization
 * code arrives, and a request header does not get to choose it.
 */

/** The callback's path on the console. */
export const OUTREACH_OAUTH_CALLBACK_PATH = `/api/${OUTREACH_API_ROUTES.mailboxesOAuthCallback}`

const stripTrailingSlash = (value: string) => value.replace(/\/+$/, '')

/** The canonical console origin, or `null` when it is unset or not http(s). */
export function canonicalConsoleOrigin(): string | null {
  const raw = stripTrailingSlash(String(process.env.NEXT_PUBLIC_CONSOLE_URL ?? '').trim())
  if (!raw) return null
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null
  } catch {
    return null
  }
}

/**
 * The redirect address for a connect started by `requestUrl`, or `null` when
 * the deployment names no console origin to register.
 */
export function outreachOAuthRedirectUri(requestUrl: string): string | null {
  if (process.env['NODE_ENV'] !== 'production') {
    try {
      const url = new URL(requestUrl)
      if (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) {
        return `${url.origin}${OUTREACH_OAUTH_CALLBACK_PATH}`
      }
    } catch {
      // Not a URL: fall through to the canonical origin.
    }
  }
  const origin = canonicalConsoleOrigin()
  return origin ? `${origin}${OUTREACH_OAUTH_CALLBACK_PATH}` : null
}
