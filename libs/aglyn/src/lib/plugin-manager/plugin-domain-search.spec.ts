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
 * The domain search slot (AGL-3958): core asks, one plugin answers, and a
 * deployment without one offers no search at all.
 */

import {
  domainSearchRegistered,
  registerPluginDomainSearch,
  searchDomains,
} from './plugin-domain-search'
import { resetPluginServicesForTests } from './plugin-services'

beforeEach(() => resetPluginServicesForTests())

describe('plugin-domain-search', () => {
  it('is unavailable, and not offered, when no plugin registers a search', async () => {
    expect(domainSearchRegistered()).toBe(false)
    await expect(searchDomains('harbor')).resolves.toEqual({ status: 'unavailable' })
  })

  it('is unavailable when the provider has no registrar configured here', async () => {
    registerPluginDomainSearch({ search: async () => null }, { pluginId: 'domains' })
    expect(domainSearchRegistered()).toBe(true)
    await expect(searchDomains('harbor')).resolves.toEqual({ status: 'unavailable' })
  })

  it('answers the names with both prices, lower case, dropping what cannot be shown', async () => {
    const search = jest.fn(async () => [
      { name: 'HarborPlumbing.com', available: true, firstYearUsd: 11.25, renewalUsd: 18.99 },
      { name: 'harborplumbing.net', available: false, firstYearUsd: 13, renewalUsd: 13 },
      // A price that is not a number cannot be shown beside the other one.
      { name: 'harbor.io', available: true, firstYearUsd: Number.NaN, renewalUsd: 40 },
      { name: '', available: true, firstYearUsd: 1, renewalUsd: 1 },
    ])
    registerPluginDomainSearch({ search }, { pluginId: 'domains' })
    await expect(searchDomains('harborplumbing')).resolves.toEqual({
      status: 'ok',
      results: [
        { name: 'harborplumbing.com', available: true, firstYearUsd: 11.25, renewalUsd: 18.99 },
        { name: 'harborplumbing.net', available: false, firstYearUsd: 13, renewalUsd: 13 },
      ],
    })
    expect(search).toHaveBeenCalledWith('harborplumbing')
  })

  it('turns a throw into failed, and never logs the query', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    registerPluginDomainSearch(
      {
        search: async () => {
          throw new Error('registrar down')
        },
      },
      { pluginId: 'domains' },
    )
    await expect(searchDomains('harbor plumbing')).resolves.toEqual({ status: 'failed' })
    const logged = error.mock.calls.map((call) => String(call[0])).join('\n')
    expect(logged).not.toContain('harbor')
    error.mockRestore()
  })

  it('is a slot: one owner, and a second plugin is refused naming both', () => {
    const impl = { search: async () => [] }
    expect(() => registerPluginDomainSearch(impl)).toThrow(/no owner/)
    registerPluginDomainSearch(impl, { pluginId: 'domains' })
    expect(() => registerPluginDomainSearch(impl, { pluginId: 'acme-domains' })).toThrow(
      /already registered by "domains"; refused "acme-domains"/,
    )
  })
})
