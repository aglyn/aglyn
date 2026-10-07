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

import {
  cardReaderAddressProblem,
  type MobileApiClient,
  type MobileCardReaderAddress,
  type MobileCardReaderBackend,
  type MobileCardReaderSession,
  type MobileCardReaderSetupCode,
  MobileCardReaderSetupError,
} from '@aglyn/mobile-plugin-host'

/*==========================================
 * THE CARD READER'S SERVER SIDE, FROM COMMERCE (AGL-3618).
 *
 * The app's Terminal SDK asks for a connection token whenever it needs one.
 * `commerce/pos-terminal-connection-token` mints it for ONE site, scoped to
 * the site's Terminal Location, after the same gate as a sale (`managePos`,
 * a site role that may sell, the `pos` entitlement). Commerce provides it as
 * the foundation's card-reader backend, so the app never names this plugin.
 *=========================================*/

const TOKEN_ROUTE = '/api/commerce/pos-terminal-connection-token'

/** The route's own words for what is missing, as the foundation's codes. */
const SETUP_CODES: Record<string, MobileCardReaderSetupCode> = {
  'terminal-unavailable': 'unavailable',
  'merchant-not-ready': 'merchant-not-ready',
  'location-required': 'location-required',
}

/** The route's 409 as a setup error the reader screen can act on; anything else unchanged. */
export function asSetupError(error: unknown): unknown {
  const record = (error ?? {}) as { status?: unknown; body?: unknown; message?: unknown }
  const body = (record.body ?? {}) as Record<string, unknown>
  const code = SETUP_CODES[String(body['code'] ?? '')]
  if (record.status === 409 && code) {
    const message = typeof body['error'] === 'string' ? body['error'] : String(record.message ?? '')
    return new MobileCardReaderSetupError(code, message)
  }
  return error
}

export function readReaderSession(body: unknown): MobileCardReaderSession {
  const record = (body ?? {}) as Record<string, unknown>
  const secret = typeof record['secret'] === 'string' ? record['secret'] : ''
  const locationId = typeof record['locationId'] === 'string' ? record['locationId'] : ''
  if (!secret.startsWith('pst_') || !locationId.startsWith('tml_')) {
    throw new Error('Card readers are not set up for this store yet.')
  }
  const onBehalfOf = record['onBehalfOf']
  const name = record['merchantDisplayName']
  return {
    secret,
    locationId,
    onBehalfOf: typeof onBehalfOf === 'string' && onBehalfOf.startsWith('acct_') ? onBehalfOf : null,
    merchantDisplayName: typeof name === 'string' && name ? name.slice(0, 100) : 'Store',
    testMode: record['testMode'] === true,
  }
}

export const commerceCardReaderBackend: MobileCardReaderBackend = {
  async session(api: MobileApiClient, hostId: string) {
    let body: unknown
    try {
      body = await api.request(TOKEN_ROUTE, { method: 'POST', body: { hostId } })
    } catch (error) {
      throw asSetupError(error)
    }
    return readReaderSession(body)
  },

  async registerLocation(api: MobileApiClient, hostId: string, address: MobileCardReaderAddress) {
    const problem = cardReaderAddressProblem(address)
    if (problem) throw new Error(problem)
    const body = (await api.request(TOKEN_ROUTE, {
      method: 'POST',
      body: {
        hostId,
        action: 'location',
        address: { ...address, country: address.country.trim().toUpperCase() },
      },
    })) as { locationId?: unknown } | null
    if (typeof body?.locationId !== 'string' || !body.locationId.startsWith('tml_')) {
      throw new Error('The store address could not be saved. Try again.')
    }
  },
}
