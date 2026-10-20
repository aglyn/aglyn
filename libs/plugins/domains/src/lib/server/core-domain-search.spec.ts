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

import type { RegistrarDriver, RegistrarQuote, RegistrarResult } from './registrar'

const mockSelling = { configured: true }
const mockSearch = jest.fn<Promise<RegistrarResult<RegistrarQuote[]>>, [string[]]>()

jest.mock('./routes', () => ({
  sellingConfigured: () => mockSelling.configured,
}))
jest.mock('./platform-effects', () => ({
  platformEffects: () => ({
    driver: { search: (domains: string[]) => mockSearch(domains) } as Partial<RegistrarDriver>,
  }),
}))

import {
  PLUGIN_DOMAIN_SEARCH,
  registerPluginDomainSearch,
  searchDomains,
} from '@aglyn/aglyn/plugin-manager/plugin-domain-search'
import {
  resetPluginServicesForTests,
  resolvePluginServices,
} from '@aglyn/aglyn/plugin-manager/plugin-services'
import { domainRetailCents } from '../model/pricing'
import { searchDomainsForCore } from './core-domain-search'

/**
 * Domains' answer to `core.domain-search` (AGL-3958): the Get a domain
 * card's own search and prices, in dollars, or nothing on a deployment that
 * does not sell names.
 */

function quote(domain: string, patch: Partial<RegistrarQuote> = {}): RegistrarQuote {
  return {
    domain,
    available: true,
    premium: false,
    years: 1,
    purchaseUsd: 11.25,
    renewalUsd: 11.25,
    ...patch,
  }
}

beforeEach(() => {
  mockSelling.configured = true
  mockSearch.mockReset()
  resetPluginServicesForTests()
})

describe('core.domain-search, as the domains plugin answers it', () => {
  it('answers null, asking no registrar, on a deployment that does not sell names', async () => {
    mockSelling.configured = false
    expect(await searchDomainsForCore('test bakery')).toBeNull()
    expect(mockSearch).not.toHaveBeenCalled()
  })

  it('prices each name as the owner will be charged, in dollars, not at our cost in cents', async () => {
    mockSearch.mockImplementation(async (domains) => ({
      ok: 'yes',
      value: domains.map((domain) =>
        domain === 'testbakery.shop'
          ? quote(domain, { purchaseUsd: 3, renewalUsd: 40 })
          : domain === 'testbakery.net'
            ? quote(domain, { available: false })
            : quote(domain),
      ),
    }))

    const results = (await searchDomainsForCore('Test Bakery')) ?? []

    expect(results.find((result) => result.name === 'testbakery.com')).toEqual({
      name: 'testbakery.com',
      available: true,
      // $11.25 at the registrar is $15.99 on the card (1599 cents).
      firstYearUsd: 15.99,
      renewalUsd: 15.99,
    })
    expect(results.find((result) => result.name === 'testbakery.shop')).toEqual({
      name: 'testbakery.shop',
      available: true,
      firstYearUsd: domainRetailCents(3) / 100,
      renewalUsd: domainRetailCents(40) / 100,
    })
    expect(results.find((result) => result.name === 'testbakery.net')).toEqual({
      name: 'testbakery.net',
      available: false,
      firstYearUsd: 0,
      renewalUsd: 0,
    })
  })

  it('leaves out what the card does not sell: premium names and endings past the cost cap', async () => {
    mockSearch.mockImplementation(async (domains) => ({
      ok: 'yes',
      value: domains.map((domain) =>
        domain === 'testbakery.com'
          ? quote(domain, { premium: true, purchaseUsd: 2400 })
          : domain === 'testbakery.io'
            ? quote(domain, { renewalUsd: 95 })
            : quote(domain),
      ),
    }))
    const names = ((await searchDomainsForCore('testbakery')) ?? []).map((result) => result.name)
    expect(names).not.toContain('testbakery.com')
    expect(names).not.toContain('testbakery.io')
    expect(names).toContain('testbakery.net')
  })

  it('throws when the registrar does not answer, so core reports a failed search', async () => {
    mockSearch.mockResolvedValue({ ok: 'no', code: 'timeout', retryable: true })
    await expect(searchDomainsForCore('test bakery')).rejects.toThrow('timeout')
  })

  it('answers no names for an empty query, asking no registrar', async () => {
    expect(await searchDomainsForCore('   ')).toEqual([])
    expect(mockSearch).not.toHaveBeenCalled()
  })

  it('fits core: the slot passes every result through as it is', async () => {
    mockSearch.mockImplementation(async (domains) => ({
      ok: 'yes',
      value: domains.map((domain) => quote(domain)),
    }))
    registerPluginDomainSearch({ search: searchDomainsForCore }, { pluginId: 'domains' })
    const direct = await searchDomainsForCore('testbakery.com')
    expect(direct?.[0]).toEqual({
      name: 'testbakery.com',
      available: true,
      firstYearUsd: 15.99,
      renewalUsd: 15.99,
    })
    // Nothing is dropped as unshowable or renamed on the way through.
    expect(await searchDomains('testbakery.com')).toEqual({ status: 'ok', results: direct })
  })

  it('is registered from the console-server declarations, under the plugin’s id', async () => {
    const { registerDomainsConsoleServerDeclarations } = await import('../declarations.console-server')
    registerDomainsConsoleServerDeclarations()
    expect(resolvePluginServices(PLUGIN_DOMAIN_SEARCH).map((entry) => entry.pluginId)).toEqual([
      'domains',
    ])
    mockSelling.configured = false
    expect(await searchDomains('test bakery')).toEqual({ status: 'unavailable' })
  })
})
