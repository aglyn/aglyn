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

import { pluginRecordIndex } from '@aglyn/aglyn/plugin-manager/plugin-record-index'
import {
  listPluginEventHandlers,
  resetPluginEventHandlersForTests,
} from '@aglyn/aglyn/plugin-manager/plugin-events'
import {
  PLUGIN_PRODUCT_CATALOG,
  pluginProductCatalog,
} from '@aglyn/aglyn/plugin-manager/plugin-product-catalog'
import {
  PLUGIN_PRODUCT_WRITER,
  pluginProductWriter,
} from '@aglyn/aglyn/plugin-manager/plugin-product-writer'
import { resolvePluginServices } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { pluginStockLevels } from '@aglyn/aglyn/plugin-manager/plugin-stock-levels'
import { pluginChannelOrders } from '@aglyn/aglyn/plugin-manager/plugin-channel-orders'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { BUNDLE_ID } from './constants/bundle-common'
import { registerCommerceServerDeclarations } from './declarations.server'

/**
 * The commerce plugin's boot registrations — the ones every app runs before a
 * surface loads, so a reader in any server process finds them.
 */
describe('registerCommerceServerDeclarations', () => {
  beforeEach(() => resetPluginServicesForTests())

  it('publishes the product and category indexes as this plugin’s (AGL-3080)', () => {
    registerCommerceServerDeclarations()
    expect(pluginRecordIndex('product')?.pluginId).toBe(BUNDLE_ID)
    expect(pluginRecordIndex('productCategory')?.pluginId).toBe(BUNDLE_ID)
  })

  it('subscribes to domain connects and releases for payment method domains (AGL-3629)', () => {
    resetPluginEventHandlersForTests()
    registerCommerceServerDeclarations()
    registerCommerceServerDeclarations()
    expect(listPluginEventHandlers('host.domain.attached')).toEqual([BUNDLE_ID])
    expect(listPluginEventHandlers('host.domain.released')).toEqual([BUNDLE_ID])
  })

  it('publishes the store catalog shopping channels read as this plugin’s (AGL-3637)', () => {
    registerCommerceServerDeclarations()
    expect(pluginProductCatalog()).toBeDefined()
    expect(resolvePluginServices(PLUGIN_PRODUCT_CATALOG)[0]?.pluginId).toBe(BUNDLE_ID)
  })

  it('applies counts other warehouses report through the stock-levels seam (AGL-3634)', () => {
    registerCommerceServerDeclarations()
    expect(typeof pluginStockLevels()?.setAvailable).toBe('function')
  })

  it('records orders other channels sold through the channel-orders seam (AGL-3638)', () => {
    registerCommerceServerDeclarations()
    const orders = pluginChannelOrders()
    expect(typeof orders?.importOrder).toBe('function')
    expect(typeof orders?.cancelOrder).toBe('function')
    expect(typeof orders?.recordFees).toBe('function')
  })

  it('keeps the products another plugin brings from its source (AGL-3641)', () => {
    registerCommerceServerDeclarations()
    expect(pluginProductWriter()).toBeDefined()
    expect(resolvePluginServices(PLUGIN_PRODUCT_WRITER)[0]?.pluginId).toBe(BUNDLE_ID)
  })

  it('registers again without refusing itself', () => {
    registerCommerceServerDeclarations()
    expect(() => registerCommerceServerDeclarations()).not.toThrow()
  })
})
