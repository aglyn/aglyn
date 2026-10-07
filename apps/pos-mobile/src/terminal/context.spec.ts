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
import {
  batteryLabel,
  createTokenProvider,
  isSupportedBluetoothReader,
  parseTerminalContext,
  readerName,
  registerTerminalLocation,
  setTerminalHost,
  terminalAddressProblem,
  terminalContext,
  TerminalSetupError,
} from './context'
import { updateIsDue } from './use-pos-terminal'

jest.mock('@stripe/stripe-terminal-react-native', () => ({}))

const GOOD = { secret: 'pst_test_abc', locationId: 'tml_123', onBehalfOf: 'acct_1', merchantDisplayName: 'Shop', testMode: true }

function fakeApi(body: unknown) {
  const request = jest.fn(async () => body)
  return { api: { request } as unknown as ConsoleApiClient, request }
}

describe('parseTerminalContext', () => {
  it('reads the route answer', () => {
    expect(parseTerminalContext(GOOD)).toEqual(GOOD)
  })

  it('drops an onBehalfOf that is not an account and caps the name', () => {
    expect(parseTerminalContext({ ...GOOD, onBehalfOf: 'evil', merchantDisplayName: 'x'.repeat(200) })).toMatchObject({
      onBehalfOf: null,
      merchantDisplayName: 'x'.repeat(100),
    })
  })

  it('refuses an answer without a token and a location', () => {
    expect(() => parseTerminalContext({ secret: 'pst_x' })).toThrow(/not set up/)
    expect(() => parseTerminalContext({ ...GOOD, secret: 'sk_live_x' })).toThrow()
  })
})

describe('createTokenProvider', () => {
  afterEach(() => setTerminalHost(null))

  it('asks for a token for the current site only', async () => {
    const { api, request } = fakeApi(GOOD)
    const provider = createTokenProvider(api)
    await expect(provider()).rejects.toThrow(/store/)
    setTerminalHost('host-1')
    await expect(provider()).resolves.toBe('pst_test_abc')
    expect(request).toHaveBeenCalledWith('/api/commerce/pos-terminal-connection-token', {
      method: 'POST',
      body: { hostId: 'host-1' },
    })
    expect(terminalContext()).toEqual(GOOD)
  })

  it('forgets the old site context when the site changes', async () => {
    const { api } = fakeApi(GOOD)
    setTerminalHost('host-1')
    await createTokenProvider(api)()
    setTerminalHost('host-2')
    expect(terminalContext()).toBeNull()
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

describe('setup', () => {
  function refusing(status: number, body: unknown) {
    const request = jest.fn(async () => {
      throw Object.assign(new Error('refused'), { status, body })
    })
    return { request } as unknown as ConsoleApiClient
  }

  it('turns the route’s 409 code into a setup error the panel acts on', async () => {
    setTerminalHost('host-1')
    const provider = createTokenProvider(
      refusing(409, { error: 'Add the store address card readers are used at.', code: 'location-required' }),
    )
    const caught = await provider().catch((error: unknown) => error)
    expect(caught).toBeInstanceOf(TerminalSetupError)
    expect(caught).toMatchObject({ code: 'location-required', message: 'Add the store address card readers are used at.' })
  })

  it('passes any other failure through unchanged', async () => {
    setTerminalHost('host-1')
    const caught = await createTokenProvider(refusing(403, { error: 'Not permitted' }))().catch((error: unknown) => error)
    expect(caught).not.toBeInstanceOf(TerminalSetupError)
    expect(caught).toMatchObject({ status: 403 })
    const unknownCode = await createTokenProvider(refusing(409, { code: 'something-else' }))().catch((error: unknown) => error)
    expect(unknownCode).not.toBeInstanceOf(TerminalSetupError)
  })

  it('checks an address before sending it, and uppercases the country', async () => {
    expect(terminalAddressProblem({ line1: '1 Main', city: 'Austin', postalCode: '78701', country: 'USA' })).toMatch(/two-letter/)
    expect(terminalAddressProblem({ line1: '', city: 'Austin', postalCode: '78701', country: 'US' })).toMatch(/street/)
    const { api, request } = fakeApi({ locationId: 'tml_9' })
    await expect(
      registerTerminalLocation(api, 'host-1', { line1: '1 Main', city: 'Austin', postalCode: '78701', country: 'us' }),
    ).resolves.toBe('tml_9')
    expect(request).toHaveBeenCalledWith('/api/commerce/pos-terminal-connection-token', {
      method: 'POST',
      body: { hostId: 'host-1', action: 'location', address: { line1: '1 Main', city: 'Austin', postalCode: '78701', country: 'US' } },
    })
    await expect(
      registerTerminalLocation(fakeApi({}).api, 'host-1', { line1: '1 Main', city: 'Austin', postalCode: '78701', country: 'US' }),
    ).rejects.toThrow(/could not be saved/)
  })
})
