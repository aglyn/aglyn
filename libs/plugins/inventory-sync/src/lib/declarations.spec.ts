/**
 * @jest-environment node
 */
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

import { listConsoleExtensions } from '@aglyn/aglyn'
import { listPluginConsoleCrons } from '@aglyn/aglyn/plugin-manager/plugin-console-crons'
import {
  listPluginDomainEventSubscribers,
  resetPluginDomainEventsForTests,
} from '@aglyn/aglyn/plugin-manager/plugin-domain-events'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { INVENTORY_SYNC_JOB_ID, INVENTORY_SYNC_PLUGIN_ID } from './constants'
import { registerInventorySyncConsoleServerDeclarations } from './declarations.console-server'
import { INVENTORY_SYNC_SUBSCRIBED_EVENTS, registerInventorySyncServerDeclarations } from './declarations.server'
import { registerInventorySyncConsole } from './plugin'
import { inventorySyncSubprocessors } from './subprocessors'

describe('the plugin’s boot registrations (AGL-3642)', () => {
  beforeEach(() => {
    resetPluginServicesForTests()
    resetPluginDomainEventsForTests()
  })

  it('takes commerce’s order events by name, once however often it boots', () => {
    registerInventorySyncServerDeclarations()
    registerInventorySyncServerDeclarations()
    for (const event of INVENTORY_SYNC_SUBSCRIBED_EVENTS) {
      expect(listPluginDomainEventSubscribers(event)).toEqual([INVENTORY_SYNC_PLUGIN_ID])
    }
  })

  it('declares its console job under its own id', () => {
    registerInventorySyncConsoleServerDeclarations()
    expect(listPluginConsoleCrons().map((job) => job.id)).toContain(INVENTORY_SYNC_JOB_ID)
  })

  it('fills the store settings and order zones, behind the commerce entitlement', () => {
    registerInventorySyncConsole()
    const extension = listConsoleExtensions().find((entry) => entry.pluginId === INVENTORY_SYNC_PLUGIN_ID)
    expect(extension).toMatchObject({ featureFlag: 'commerce' })
    expect(extension?.widgets?.map((widget) => widget.slot)).toEqual(['commerceSettings', 'orderDetail'])
  })

  it('declares each system’s host as the merchant’s own, and no subprocessor of Aglyn’s', () => {
    const answer = inventorySyncSubprocessors() as unknown as { subprocessors: unknown[]; hosts: Array<{ host: string; disposition: string; reason: string }> }
    expect(answer.subprocessors).toEqual([])
    expect(answer.hosts.map((entry) => entry.host)).toEqual([
      'inventory.dearsystems.com',
      'cloudapi.inflowinventory.com',
      'oauth.brightpearlapp.com',
    ])
    for (const entry of answer.hosts) {
      expect(entry.disposition).toBe('not-a-subprocessor')
      expect(entry.reason).toMatch(/^Customer-chosen destination/)
    }
  })
})
