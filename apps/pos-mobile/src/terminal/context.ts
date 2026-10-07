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

import type { ConsoleApiClient } from '@aglyn/mobile-core'
import type { Reader } from '@stripe/stripe-terminal-react-native'

/*==========================================
 * WHICH SITE THE TERMINAL SDK WORKS FOR (AGL-3618).
 *
 * The SDK asks for a connection token whenever it needs one (at
 * initialization and again when one expires), with no arguments. A token is
 * minted by `/api/commerce/pos-terminal-connection-token` for ONE site,
 * scoped to that site's Terminal Location, after the same gate as a sale
 * (`managePos`, a host role that may sell, the `pos` entitlement). So the
 * app keeps the site it is working for here, and the provider reads it.
 *
 * Switching site therefore clears the SDK's cached credentials and
 * disconnects the reader: a reader connected under one store's Location must
 * never take a payment for another.
 *=========================================*/

export interface TerminalContext {
  /** Connection token secret. Never stored beyond the SDK's own cache. */
  secret: string
  /** The site's Terminal Location on the platform account. */
  locationId: string
  /** The merchant's connected account: Tap to Pay shows its name. */
  onBehalfOf: string | null
  merchantDisplayName: string
  /** Test-mode keys: simulated readers only, and offered by default. */
  testMode: boolean
}

let currentHostId: string | null = null
let lastContext: TerminalContext | null = null

export function setTerminalHost(hostId: string | null): void {
  if (hostId !== currentHostId) lastContext = null
  currentHostId = hostId
}

export function terminalHost(): string | null {
  return currentHostId
}

/** The last context the token route returned for the current site. */
export function terminalContext(): TerminalContext | null {
  return lastContext
}

export function parseTerminalContext(body: unknown): TerminalContext {
  const record = (body ?? {}) as Record<string, unknown>
  const secret = typeof record['secret'] === 'string' ? record['secret'] : ''
  const locationId = typeof record['locationId'] === 'string' ? record['locationId'] : ''
  if (!secret.startsWith('pst_') || !locationId.startsWith('tml_')) {
    throw new Error('Card readers are not set up for this store yet.')
  }
  return {
    secret,
    locationId,
    onBehalfOf:
      typeof record['onBehalfOf'] === 'string' && record['onBehalfOf'].startsWith('acct_')
        ? record['onBehalfOf']
        : null,
    merchantDisplayName:
      typeof record['merchantDisplayName'] === 'string' && record['merchantDisplayName']
        ? record['merchantDisplayName'].slice(0, 100)
        : 'Store',
    testMode: record['testMode'] === true,
  }
}

/**
 * What stops this store from taking cards, as the token route names it:
 * Terminal not offered yet, payments not set up, or no store address (the
 * Location every reader connects under).
 */
export type TerminalSetupCode = 'terminal-unavailable' | 'merchant-not-ready' | 'location-required'

export class TerminalSetupError extends Error {
  readonly code: TerminalSetupCode
  constructor(code: TerminalSetupCode, message: string) {
    super(message)
    this.name = 'TerminalSetupError'
    this.code = code
  }
}

const SETUP_CODES: readonly TerminalSetupCode[] = ['terminal-unavailable', 'merchant-not-ready', 'location-required']

/**
 * The route's refusal as a setup error the readers panel can act on, or the
 * error unchanged. Reads the API client's `{ status, body }` without naming
 * its class, so any client that carries the response body works.
 */
export function asTerminalSetupError(error: unknown): unknown {
  const record = (error ?? {}) as { status?: unknown; body?: unknown; message?: unknown }
  const body = (record.body ?? {}) as Record<string, unknown>
  const code = body['code']
  if (record.status === 409 && typeof code === 'string' && (SETUP_CODES as readonly string[]).includes(code)) {
    const message = typeof body['error'] === 'string' ? body['error'] : String(record.message ?? '')
    return new TerminalSetupError(code as TerminalSetupCode, message)
  }
  return error
}

const TOKEN_ROUTE = '/api/commerce/pos-terminal-connection-token'

export async function fetchTerminalContext(api: ConsoleApiClient, hostId: string): Promise<TerminalContext> {
  let body: unknown
  try {
    body = await api.request(TOKEN_ROUTE, { method: 'POST', body: { hostId } })
  } catch (error) {
    throw asTerminalSetupError(error)
  }
  const context = parseTerminalContext(body)
  if (hostId === currentHostId) lastContext = context
  return context
}

/** A store address for the Terminal Location, as the route takes it. */
export interface TerminalAddress {
  line1: string
  line2?: string
  city: string
  state?: string
  postalCode: string
  country: string
}

/** Null when the address can register a Location; otherwise what to fix. */
export function terminalAddressProblem(address: Partial<TerminalAddress>): string | null {
  if (!address.line1?.trim() || !address.city?.trim() || !address.postalCode?.trim() || !address.country?.trim()) {
    return 'Enter the street, city, postal code and country where you take payments.'
  }
  if (!/^[A-Za-z]{2}$/.test(address.country.trim())) return 'Use a two-letter country code, like US.'
  return null
}

/** Registers the store's Location once; the server keeps the first one. */
export async function registerTerminalLocation(
  api: ConsoleApiClient,
  hostId: string,
  address: TerminalAddress,
): Promise<string> {
  const problem = terminalAddressProblem(address)
  if (problem) throw new Error(problem)
  const body = (await api.request(TOKEN_ROUTE, {
    method: 'POST',
    body: {
      hostId,
      action: 'location',
      address: { ...address, country: address.country.trim().toUpperCase() },
    },
  })) as { locationId?: unknown }
  if (typeof body?.locationId !== 'string' || !body.locationId.startsWith('tml_')) {
    throw new Error('The store address could not be saved. Try again.')
  }
  return body.locationId
}

/** The `tokenProvider` the `StripeTerminalProvider` calls. */
export function createTokenProvider(api: ConsoleApiClient): () => Promise<string> {
  return async () => {
    const hostId = currentHostId
    if (!hostId) throw new Error('Choose a store first.')
    return (await fetchTerminalContext(api, hostId)).secret
  }
}

/** Bluetooth readers this app supports. */
export const BLUETOOTH_READER_TYPES: readonly Reader.DeviceType[] = ['stripeM2', 'wisePad3', 'wisePad3s']

export function isSupportedBluetoothReader(reader: Pick<Reader.Type, 'deviceType'>): boolean {
  return BLUETOOTH_READER_TYPES.includes(reader.deviceType)
}

export function readerName(reader: Pick<Reader.Type, 'deviceType' | 'label' | 'serialNumber' | 'simulated'>): string {
  const model =
    reader.deviceType === 'tapToPay'
      ? 'Tap to Pay'
      : reader.deviceType === 'stripeM2'
        ? 'Stripe Reader M2'
        : reader.deviceType === 'wisePad3' || reader.deviceType === 'wisePad3s'
          ? 'BBPOS WisePad 3'
          : 'Card reader'
  const name = reader.label || (reader.deviceType === 'tapToPay' ? '' : reader.serialNumber)
  const base = name && name !== model ? `${model} (${name})` : model
  return reader.simulated ? `${base}, simulated` : base
}

/** Battery as a percentage label, when the reader reports one. */
export function batteryLabel(level: number | undefined): string | null {
  if (typeof level !== 'number' || !Number.isFinite(level)) return null
  return `${Math.round(Math.max(0, Math.min(1, level)) * 100)}% battery`
}
