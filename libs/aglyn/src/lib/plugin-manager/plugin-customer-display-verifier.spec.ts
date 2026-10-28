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
  customerDisplayShows,
  registerCustomerDisplayVerifier,
  verifyCustomerDisplay,
  type VerifiedCustomerDisplay,
} from './plugin-customer-display-verifier'
import { resetPluginServicesForTests } from './plugin-services'

/**
 * Who a paired customer display is, for a plugin's server (AGL-4042): the
 * one verifier the pairing plugin registers, a refusal for every credential
 * when there is none or it fails, and the question a screen's server asks
 * before it acts for the display. Names no plugin: the fixtures are invented.
 */

const CREDENTIAL = 'display-credential-0123456789abcdefghijkl'
const SHOWING: VerifiedCustomerDisplay = {
  hostId: 'host-1',
  orgId: 'org-1',
  screen: { pluginId: 'acme-forms', path: '/display-fill', params: { host: 'host-1' } },
  shownBy: 'uid-clerk',
}

afterEach(() => resetPluginServicesForTests())

describe('verifying a display’s credential', () => {
  it('refuses every credential while no plugin vouches for displays', async () => {
    expect(await verifyCustomerDisplay(CREDENTIAL)).toBeNull()
  })

  it('answers what the registered verifier vouches for, and nothing for what it refuses', async () => {
    const verify = jest.fn(async (credential: string) => (credential === CREDENTIAL ? SHOWING : null))
    registerCustomerDisplayVerifier({ verify }, { pluginId: 'acme-pos' })
    expect(await verifyCustomerDisplay(CREDENTIAL)).toEqual(SHOWING)
    expect(await verifyCustomerDisplay(`${CREDENTIAL}x`)).toBeNull()
  })

  it('never asks the verifier about a credential out of shape', async () => {
    const verify = jest.fn(async () => SHOWING)
    registerCustomerDisplayVerifier({ verify }, { pluginId: 'acme-pos' })
    for (const bad of [undefined, null, 42, '', 'short', 'has spaces in it but is long enough', 'x'.repeat(513)]) {
      expect(await verifyCustomerDisplay(bad)).toBeNull()
    }
    expect(verify).not.toHaveBeenCalled()
  })

  it('fails closed when the verifier throws or answers out of shape', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    registerCustomerDisplayVerifier({ verify: async () => { throw new Error('down') } }, { pluginId: 'acme-pos' })
    expect(await verifyCustomerDisplay(CREDENTIAL)).toBeNull()
    resetPluginServicesForTests()
    registerCustomerDisplayVerifier({ verify: async () => ({ ...SHOWING, hostId: '' }) }, { pluginId: 'acme-pos' })
    expect(await verifyCustomerDisplay(CREDENTIAL)).toBeNull()
    error.mockRestore()
  })

  it('passes a screen through core’s sanitizer, and names who showed it only with a screen', async () => {
    registerCustomerDisplayVerifier(
      { verify: async () => ({ ...SHOWING, screen: { pluginId: 'acme-forms', path: 'https://evil.example.com', params: {} } }) },
      { pluginId: 'acme-pos' },
    )
    expect(await verifyCustomerDisplay(CREDENTIAL)).toEqual({ ...SHOWING, screen: null, shownBy: null })
  })

  it('takes one verifier: a second plugin’s is refused', () => {
    registerCustomerDisplayVerifier({ verify: async () => null }, { pluginId: 'acme-pos' })
    expect(() => registerCustomerDisplayVerifier({ verify: async () => null }, { pluginId: 'other-pos' })).toThrow()
  })
})

describe('whether a display shows a plugin’s screen', () => {
  const screen = { pluginId: 'acme-forms', path: '/display-fill', params: { host: 'host-1' } }

  it('matches the plugin, the page and every parameter asked about', () => {
    expect(customerDisplayShows(SHOWING, screen)).toBe(true)
    expect(customerDisplayShows(SHOWING, { pluginId: 'acme-forms', path: '/display-fill' })).toBe(true)
    expect(customerDisplayShows(SHOWING, { ...screen, params: { host: 'host-2' } })).toBe(false)
    expect(customerDisplayShows(SHOWING, { ...screen, path: '/other' })).toBe(false)
    expect(customerDisplayShows(SHOWING, { ...screen, pluginId: 'other' })).toBe(false)
  })

  it('is false once the register shows its own screen, or for no display at all', () => {
    expect(customerDisplayShows({ ...SHOWING, screen: null, shownBy: null }, screen)).toBe(false)
    expect(customerDisplayShows(null, screen)).toBe(false)
  })
})
