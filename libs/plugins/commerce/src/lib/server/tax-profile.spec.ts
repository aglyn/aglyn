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
 * The merchant's rates, read where this plugin keeps them (AGL-2028, AGL-3080).
 *
 * A plugin that charges asks the tax-profile contract for a site's rate for
 * its kind of charge and never reads the store settings itself, so this is
 * where "the rate a booking is charged is the one the Taxes card saved" is
 * held: the read addresses the store settings document of the site asked
 * about, answers the stored rate as stored, and answers nothing for a kind
 * this plugin keeps no rate for.
 */

const mockReads: string[] = []
let mockStore: { exists: boolean; tax?: Record<string, unknown> } = { exists: false }

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      firestore: () => ({
        collection: (root: string) => ({
          doc: (hostId: string) => ({
            collection: (sub: string) => ({
              doc: (id: string) => ({
                get: async () => {
                  mockReads.push(`${root}/${hostId}/${sub}/${id}`)
                  return {
                    exists: mockStore.exists,
                    get: (field: string) =>
                      field === 'tax' ? mockStore.tax : undefined,
                  }
                },
              }),
            }),
          }),
        }),
      }),
    }),
  },
}))

import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import {
  pluginTaxProfile,
  pluginTaxProfileOwner,
} from '@aglyn/aglyn/plugin-manager/plugin-tax-profile'
import { readFlatRate, registerCommerceTaxProfile } from './tax-profile'

beforeEach(() => {
  mockReads.length = 0
  mockStore = { exists: false }
})

describe('the merchant’s flat rate for a kind of charge', () => {
  it('is read off the site’s store settings, as stored', async () => {
    mockStore = { exists: true, tax: { service: { pct: 6, label: 'Service tax' }, lodging: { pct: 12 } } }
    await expect(readFlatRate('host-1', 'service')).resolves.toEqual({ pct: 6, label: 'Service tax' })
    await expect(readFlatRate('host-1', 'lodging')).resolves.toEqual({ pct: 12 })
    expect(mockReads).toEqual([
      'hosts/host-1/settings/store',
      'hosts/host-1/settings/store',
    ])
  })

  it('is unset for a site with no settings, and for a rate nobody typed', async () => {
    await expect(readFlatRate('host-1', 'service')).resolves.toBeUndefined()
    mockStore = { exists: true, tax: { mode: 'manual' } }
    await expect(readFlatRate('host-1', 'service')).resolves.toBeUndefined()
  })

  it('reads nothing for a kind of charge this plugin keeps no rate for', async () => {
    // The goods table is resolved against an address, never handed out as a
    // flat rate: a caller asking for `rates` must not be given it.
    mockStore = { exists: true, tax: { rates: [{ country: 'US', pct: 8.25 }] } }
    await expect(readFlatRate('host-1', 'rates')).resolves.toBeUndefined()
    await expect(readFlatRate('', 'service')).resolves.toBeUndefined()
    expect(mockReads).toEqual([])
  })

  it('is what the registered profile answers', async () => {
    resetPluginServicesForTests()
    registerCommerceTaxProfile()
    expect(pluginTaxProfileOwner()).toBe('commerce')
    mockStore = { exists: true, tax: { service: { pct: 6 } } }
    const profile = pluginTaxProfile()
    const rate = await profile.flatRate('host-1', 'service')
    expect(profile.flatTax(rate, 7500, 'Service tax')).toEqual({
      taxCents: 450,
      label: 'Service tax',
      pct: 6,
    })
    resetPluginServicesForTests()
  })
})
