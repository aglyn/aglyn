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

import { cardReaderAddressProblem, MOBILE_CARD_READER_BACKEND } from './card-reader'
import { loadMobilePlugins } from './loader'
import { registerMobileScreen, resetMobileRegistry } from './registry'
import {
  defineMobileServiceContract,
  registerMobileService,
  resetMobileServices,
  resolveMobileService,
} from './services'

const greeter = defineMobileServiceContract<{ hello(): string }>('spec-greeter')

describe('mobile services (AGL-3618)', () => {
  beforeEach(() => {
    resetMobileRegistry()
    resetMobileServices()
  })

  it('resolves what a plugin registered, attributed to the plugin whose registrar ran', async () => {
    const result = await loadMobilePlugins([
      {
        id: 'shop',
        register: 'registerShop',
        contributes: {},
        load: async () => ({ registerShop: () => registerMobileService(greeter, { hello: () => 'hi' }) }),
      },
    ])
    expect(result.failed).toEqual([])
    expect(resolveMobileService(greeter)?.hello()).toBe('hi')
    // A second plugin cannot take the slot.
    expect(() => registerMobileService(greeter, { hello: () => 'no' }, { pluginId: 'crm' })).toThrow(
      /already provided by "shop"; refused "crm"/,
    )
  })

  it('needs an owner, and a contract from defineMobileServiceContract', () => {
    expect(() => registerMobileService(greeter, { hello: () => '' })).toThrow(/no owner/)
    expect(() => registerMobileService({ id: 'spec-greeter' }, {}, { pluginId: 'x' })).toThrow(/defineMobileServiceContract/)
    expect(defineMobileServiceContract('spec-greeter')).toBe(greeter)
  })

  it('drops the services of a plugin that failed to load', async () => {
    const result = await loadMobilePlugins([
      {
        id: 'shop',
        register: 'registerShop',
        contributes: { screens: ['shop.list'] },
        load: async () => ({
          registerShop: () => {
            registerMobileService(MOBILE_CARD_READER_BACKEND, {
              session: async () => {
                throw new Error('unused')
              },
              registerLocation: async () => undefined,
            })
            // Declared but never registered: the load fails.
            void registerMobileScreen
          },
        }),
      },
    ])
    expect(result.failed.map((failure) => failure.pluginId)).toEqual(['shop'])
    expect(resolveMobileService(MOBILE_CARD_READER_BACKEND)).toBeUndefined()
  })

  it('checks a store address before it registers a location', () => {
    expect(cardReaderAddressProblem({ line1: '1 Main', city: 'Austin', postalCode: '78701', country: 'US' })).toBeNull()
    expect(cardReaderAddressProblem({ line1: '1 Main', city: 'Austin', postalCode: '', country: 'US' })).toMatch(/postal code/)
    expect(cardReaderAddressProblem({ line1: '1 Main', city: 'Austin', postalCode: '78701', country: 'USA' })).toMatch(
      /two-letter/,
    )
  })
})
