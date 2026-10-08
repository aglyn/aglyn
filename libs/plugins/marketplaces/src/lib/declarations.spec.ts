/**
 * @jest-environment node
 *
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

import { listPluginConsoleCrons, resetPluginConsoleCronsForTests } from '@aglyn/aglyn/plugin-manager/plugin-console-crons'
import { listPluginDomainEventSubscribers, resetPluginDomainEventsForTests } from '@aglyn/aglyn/plugin-manager/plugin-domain-events'
import { MARKETPLACES_JOB_ID, MARKETPLACES_PLUGIN_ID } from './constants'
import { registerMarketplacesConsoleServerDeclarations } from './declarations.console-server'
import { MARKETPLACES_STOCK_EVENTS, registerMarketplacesServerDeclarations } from './declarations.server'
import { marketplacesSubprocessors } from './subprocessors'

describe('the marketplaces plugin’s declarations (AGL-3638)', () => {
  it('subscribes to the order events that move stock or ship an order, once however often it boots', () => {
    resetPluginDomainEventsForTests()
    registerMarketplacesServerDeclarations()
    registerMarketplacesServerDeclarations()
    for (const event of [...MARKETPLACES_STOCK_EVENTS, 'order.fulfilled']) {
      expect(listPluginDomainEventSubscribers(event)).toEqual([MARKETPLACES_PLUGIN_ID])
    }
  })

  it('registers its job on the console’s server', () => {
    resetPluginConsoleCronsForTests()
    registerMarketplacesConsoleServerDeclarations()
    expect(listPluginConsoleCrons().map((cron) => cron.id)).toContain(MARKETPLACES_JOB_ID)
  })

  it('declares every host it names as a customer-chosen destination, and uses Amazon’s where they are declared', () => {
    const answer = marketplacesSubprocessors() as { subprocessors: unknown[]; hosts: any[]; uses: any[] }
    expect(answer.subprocessors).toEqual([])
    for (const host of answer.hosts) {
      expect(['not-a-subprocessor', 'no-request']).toContain(host.disposition)
      if (host.disposition === 'not-a-subprocessor') expect(host.reason).toMatch(/^Customer-chosen destination\./)
    }
    const declared = [...answer.hosts.map((host) => host.host), ...answer.uses.map((use) => use.host)]
    expect(new Set(declared).size).toBe(declared.length)
    expect(declared).toEqual(
      expect.arrayContaining(['api.ebay.com', 'api.etsy.com', 'open-api.tiktokglobalshop.com', 'marketplace.walmartapis.com', 'www.faire.com', 'sellingpartnerapi-na.amazon.com']),
    )
  })
})
