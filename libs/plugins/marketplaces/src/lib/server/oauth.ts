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

import { platformConsoleOrigin } from '@aglyn/aglyn/app-utils/platform-brand'
import { createHash, randomBytes } from 'node:crypto'
import { MARKETPLACES_API_ROUTES } from '../constants'

/**
 * CONNECTING A MARKETPLACE (AGL-3638): the merchant signs in at the
 * marketplace and grants this deployment's app access to their own seller
 * account. Each adapter builds its own consent page and trades its own code
 * (`providers/*.ts`); this module holds what every connect shares.
 *
 * The state the browser carries is `{connectionId}.{nonce}`. The connection
 * document holds only the nonce's SHA-256, PKCE's verifier sealed, its
 * expiry, who started it and where to send them back; the callback compares,
 * then clears it before anything else, so a state is good once.
 */

export const MARKETPLACE_OAUTH_CALLBACK_PATH = `/api/${MARKETPLACES_API_ROUTES.oauthCallback}`

/** The console address a path of this plugin answers on, or `null` when the deployment has none. */
export function consoleAddress(path: string, requestUrl: string): string | null {
  if (process.env['NODE_ENV'] !== 'production') {
    try {
      const url = new URL(requestUrl)
      if (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) {
        return `${url.origin}${path}`
      }
    } catch {
      // Not a URL: the canonical origin below.
    }
  }
  try {
    const url = new URL(platformConsoleOrigin())
    return url.protocol === 'https:' || url.protocol === 'http:' ? `${url.origin}${path}` : null
  } catch {
    return null
  }
}

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

const base64Url = (bytes: Buffer): string =>
  bytes.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** A fresh single-use secret: an OAuth nonce. */
export const newSecret = (): string => base64Url(randomBytes(24))

/** A PKCE pair (RFC 7636, S256): the verifier stays sealed here, the challenge goes to the marketplace. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = base64Url(randomBytes(48))
  return { verifier, challenge: base64Url(createHash('sha256').update(verifier).digest()) }
}

const STATE = /^([A-Za-z0-9_-]{1,200})\.([A-Za-z0-9_-]{16,64})$/

/** Splits a state the callback received, or `null` for one this module did not mint. */
export function readOAuthState(state: string | null): { connectionId: string; nonce: string } | null {
  const match = STATE.exec(String(state ?? ''))
  return match ? { connectionId: match[1], nonce: match[2] } : null
}

/** A console path a member may be sent back to: same-origin and absolute, nothing else. */
export function safeReturnTo(value: unknown): string {
  const path = typeof value === 'string' ? value.trim() : ''
  return /^\/(?!\/)[A-Za-z0-9/_\-.~%?=&]{0,400}$/.test(path) && !path.includes('\\') ? path : '/'
}
