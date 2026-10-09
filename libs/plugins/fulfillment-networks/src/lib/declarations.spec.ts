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

import { listPluginConsoleCrons } from '@aglyn/aglyn/plugin-manager/plugin-console-crons'
import {
  listPluginDomainEventSubscribers,
  resetPluginDomainEventsForTests,
} from '@aglyn/aglyn/plugin-manager/plugin-domain-events'
import { listPluginFulfillmentProviders } from '@aglyn/aglyn/plugin-manager/plugin-fulfillment-providers'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { FULFILLMENT_NETWORKS_JOB_ID, FULFILLMENT_NETWORKS_PLUGIN_ID } from './constants'
import { registerFulfillmentNetworksConsoleServerDeclarations } from './declarations.console-server'
import {
  FULFILLMENT_NETWORKS_SUBSCRIBED_EVENTS,
  registerFulfillmentNetworksServerDeclarations,
} from './declarations.server'

describe('the plugin’s boot registrations (AGL-3634)', () => {
  beforeEach(() => {
    resetPluginServicesForTests()
    resetPluginDomainEventsForTests()
  })

  it('takes commerce’s order events by name, once however often it boots', () => {
    registerFulfillmentNetworksServerDeclarations()
    registerFulfillmentNetworksServerDeclarations()
    for (const event of FULFILLMENT_NETWORKS_SUBSCRIBED_EVENTS) {
      expect(listPluginDomainEventSubscribers(event)).toEqual([FULFILLMENT_NETWORKS_PLUGIN_ID])
    }
  })

  it('publishes each network as an outside fulfiller', () => {
    registerFulfillmentNetworksServerDeclarations()
    expect(listPluginFulfillmentProviders()).toEqual([
      { pluginId: FULFILLMENT_NETWORKS_PLUGIN_ID, id: 'shipbob', label: 'ShipBob' },
      { pluginId: FULFILLMENT_NETWORKS_PLUGIN_ID, id: 'amazon-mcf', label: 'Amazon Multi-Channel Fulfillment' },
      { pluginId: FULFILLMENT_NETWORKS_PLUGIN_ID, id: 'shipmonk', label: 'ShipMonk' },
    ])
  })

  it('declares its console job under its own id', () => {
    registerFulfillmentNetworksConsoleServerDeclarations()
    expect(listPluginConsoleCrons().map((job) => job.id)).toContain(FULFILLMENT_NETWORKS_JOB_ID)
  })
})
