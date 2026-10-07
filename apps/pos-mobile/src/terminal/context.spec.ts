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
  type MobileCardReaderBackend,
  registerMobileService,
  resetMobileServices,
} from '@aglyn/mobile-plugin-host'
import {
  batteryLabel,
  createTokenProvider,
  isSupportedBluetoothReader,
  readerName,
  registerTerminalLocation,
  setTerminalHost,
  terminalSession,
} from './context'
import { updateIsDue } from './use-pos-terminal'

jest.mock('@stripe/stripe-terminal-react-native', () => ({}))

const SESSION = { secret: 'pst_test_abc', locationId: 'tml_123', merchantDisplayName: 'Shop', testMode: true }
const api = { request: jest.fn() } as unknown as MobileApiClient

function provide(backend: Partial<MobileCardReaderBackend>) {
  const full: MobileCardReaderBackend = {
    session: jest.fn(async () => SESSION),
    registerLocation: jest.fn(async () => undefined),
    ...backend,
  }
  registerMobileService(MOBILE_CARD_READER_BACKEND, full, { pluginId: 'shop' })
  return full
}

afterEach(() => {
  setTerminalHost(null)
  resetMobileServices()
})

describe('createTokenProvider', () => {
  it('asks the card-reader backend for the current site only', async () => {
    const backend = provide({})
    const provider = createTokenProvider(api)
    await expect(provider()).rejects.toThrow(/store/)
    setTerminalHost('host-1')
    await expect(provider()).resolves.toBe('pst_test_abc')
    expect(backend.session).toHaveBeenCalledWith(api, 'host-1')
    expect(terminalSession()).toEqual(SESSION)
  })

  it('forgets the old site session when the site changes', async () => {
    provide({})
    setTerminalHost('host-1')
    await createTokenProvider(api)()
    setTerminalHost('host-2')
    expect(terminalSession()).toBeNull()
  })

  it('says so when no plugin provides the backend', async () => {
    setTerminalHost('host-1')
    await expect(createTokenProvider(api)()).rejects.toThrow(/not available/)
  })

  it('registers the Location through the backend', async () => {
    const backend = provide({})
    const address = { line1: '1 Main', city: 'Austin', postalCode: '78701', country: 'US' }
    await registerTerminalLocation(api, 'host-1', address)
    expect(backend.registerLocation).toHaveBeenCalledWith(api, 'host-1', address)
  })
})

describe('readers', () => {
  it('names the supported models', () => {
    expect(readerName({ deviceType: 'stripeM2', serialNumber: 'STRM2-1', label: undefined, simulated: false })).toBe(
      'Stripe Reader M2 (STRM2-1)',
    )
    expect(readerName({ deviceType: 'tapToPay', serialNumber: '', simulated: true })).toBe('Tap to Pay, simulated')
    expect(isSupportedBluetoothReader({ deviceType: 'wisePad3' })).toBe(true)
    expect(isSupportedBluetoothReader({ deviceType: 'chipper2X' })).toBe(false)
  })

  it('labels battery and update deadlines', () => {
    expect(batteryLabel(0.456)).toBe('46% battery')
    expect(batteryLabel(undefined)).toBeNull()
    expect(updateIsDue(undefined)).toBe(false)
    expect(updateIsDue('2026-01-01T00:00:00Z', Date.parse('2026-02-01'))).toBe(true)
    expect(updateIsDue('2026-03-01T00:00:00Z', Date.parse('2026-02-01'))).toBe(false)
  })
})
