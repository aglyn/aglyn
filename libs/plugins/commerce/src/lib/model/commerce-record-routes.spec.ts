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
 * Where a product and an order are read (AGL-3080): what this plugin
 * publishes under `product` and `order`, for the surfaces that link to them —
 * an assistant job's drafted product, a contact's timeline opening an order,
 * a person's page listing their orders.
 */

import {
  pluginRecordByEmailHref,
  pluginRecordHref,
  pluginRecordListHref,
  pluginRecordRoute,
} from '@aglyn/aglyn/plugin-manager/plugin-record-routes'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { registerCommerceRecordRoutes } from './commerce-record-routes'

const SITE = { orgSlug: 'acme', host: 'shop' }
const ORG = { orgSlug: 'acme', host: null }

beforeEach(() => {
  resetPluginServicesForTests()
  registerCommerceRecordRoutes()
})

describe('the commerce record routes', () => {
  it('publishes both kinds under this plugin', () => {
    expect(pluginRecordRoute('product')?.pluginId).toBe('commerce')
    expect(pluginRecordRoute('order')?.pluginId).toBe('commerce')
  })

  it('answers the catalog for a product, which opens in its editor', () => {
    expect(pluginRecordListHref('product', SITE)).toBe('/acme/hosts/shop/products')
    expect(pluginRecordHref('product', SITE, 'p-1')).toBe('/acme/hosts/shop/products')
  })

  it('opens an order in its dialog over the Orders list, and narrows the list to one buyer', () => {
    expect(pluginRecordListHref('order', SITE)).toBe('/acme/hosts/shop/products/orders')
    expect(pluginRecordHref('order', SITE, 'ord-1')).toBe('/acme/hosts/shop/products/orders?order=ord-1')
    expect(pluginRecordByEmailHref('order', SITE, 'ada@example.test')).toBe(
      '/acme/hosts/shop/products/orders?email=ada%40example.test',
    )
  })

  it('answers the store settings, where payments, shipping and tax are set (AGL-3676)', () => {
    expect(pluginRecordRoute('store-settings')?.pluginId).toBe('commerce')
    expect(pluginRecordListHref('store-settings', SITE)).toBe('/acme/hosts/shop/products/settings')
    expect(pluginRecordListHref('store-settings', ORG)).toBeNull()
  })

  it('has no address at the organization, where neither lives', () => {
    expect(pluginRecordListHref('product', ORG)).toBeNull()
    expect(pluginRecordHref('order', ORG, 'ord-1')).toBeNull()
  })
})
