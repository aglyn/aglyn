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
  type MobileApiClient,
  MOBILE_CARD_READER_BACKEND,
  type MobileCardReaderAddress,
  type MobileCardReaderSession,
  resolveMobileService,
} from '@aglyn/mobile-plugin-host'
import type { Reader } from '@stripe/stripe-terminal-react-native'

/*==========================================
 * WHICH SITE THE TERMINAL SDK WORKS FOR (AGL-3618).
 *
 * The SDK asks for a connection token whenever it needs one (at
 * initialization and again when one expires), with no arguments. A token is
 * minted for ONE site, scoped to that site's Terminal Location, by the
 * card-reader backend a plugin provides (commerce's token route, gated like a
 * sale). So the app keeps the site it is working for here, and the provider
 * reads it.
 *
 * Switching site therefore clears the SDK's cached credentials and
 * disconnects the reader: a reader connected under one store's Location must
 * never take a payment for another. No merchant account is ever named here:
 * card-present payments settle on the platform account (ToS §10.7), and the
 * server's intent route alone decides where a payment goes.
 *=========================================*/

let currentHostId: string | null = null
let lastSession: MobileCardReaderSession | null = null

export function setTerminalHost(hostId: string | null): void {
  if (hostId !== currentHostId) lastSession = null
  currentHostId = hostId
}

export function terminalHost(): string | null {
  return currentHostId
}

/** The last session the backend returned for the current site. */
export function terminalSession(): MobileCardReaderSession | null {
  return lastSession
}

function backend() {
  const provided = resolveMobileService(MOBILE_CARD_READER_BACKEND)
  if (!provided) throw new Error('Card readers are not available in this build.')
  return provided
}

export async function fetchTerminalSession(api: MobileApiClient, hostId: string): Promise<MobileCardReaderSession> {
  const session = await backend().session(api, hostId)
  if (hostId === currentHostId) lastSession = session
  return session
}

export async function registerTerminalLocation(
  api: MobileApiClient,
  hostId: string,
  address: MobileCardReaderAddress,
): Promise<void> {
  await backend().registerLocation(api, hostId, address)
}

/** The `tokenProvider` the `StripeTerminalProvider` calls. */
export function createTokenProvider(api: MobileApiClient): () => Promise<string> {
  return async () => {
    const hostId = currentHostId
    if (!hostId) throw new Error('Choose a store first.')
    return (await fetchTerminalSession(api, hostId)).secret
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
