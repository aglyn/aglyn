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
 * WHERE INTUIT AND XERO SEND A MEMBER BACK TO (AGL-3614).
 *
 * Both match the redirect address exactly against the ones registered on
 * the app, so it is the deployment's canonical console origin —
 * `NEXT_PUBLIC_CONSOLE_URL`, the production console when unset — plus the
 * callback route: `https://app.aglyn.com/api/accounting/oauth/callback` in
 * production. That is the address an operator registers.
 *
 * Local development is the one exception, and never in production: a
 * request from `http://localhost` or `127.0.0.1` is sent back to itself, so a
 * developer who registers `http://localhost:4200/api/accounting/oauth/callback`
 * on a development app is not bounced to the deployed console. Anything else
 * a request claims about its origin is ignored: the host the provider
 * redirects to is where the authorization code arrives.
 */

import { ACCOUNTING_API_ROUTES } from '../constants/api-routes'

export const ACCOUNTING_OAUTH_CALLBACK_PATH = `/api/${ACCOUNTING_API_ROUTES.oauthCallback}`

/** The production console, which an unset `NEXT_PUBLIC_CONSOLE_URL` means. */
export const DEFAULT_CONSOLE_ORIGIN = 'https://app.aglyn.com'

const stripTrailingSlash = (value: string) => value.replace(/\/+$/, '')

/** The canonical console origin, or `null` when it is set to something that is not http(s). */
export function canonicalConsoleOrigin(): string | null {
  const raw = stripTrailingSlash(String(process.env.NEXT_PUBLIC_CONSOLE_URL ?? '').trim()) || DEFAULT_CONSOLE_ORIGIN
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.origin : null
  } catch {
    return null
  }
}

/** The redirect address for a connect started by `requestUrl`, or `null` when none is usable. */
export function accountingOAuthRedirectUri(requestUrl: string): string | null {
  if (process.env['NODE_ENV'] !== 'production') {
    try {
      const url = new URL(requestUrl)
      if (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) {
        return `${url.origin}${ACCOUNTING_OAUTH_CALLBACK_PATH}`
      }
    } catch {
      // Not a URL: the canonical origin below.
    }
  }
  const origin = canonicalConsoleOrigin()
  return origin ? `${origin}${ACCOUNTING_OAUTH_CALLBACK_PATH}` : null
}
