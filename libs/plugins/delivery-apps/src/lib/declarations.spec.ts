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
import {
  listPluginConsoleCrons,
  resetPluginConsoleCronsForTests,
  runPluginConsoleCrons,
} from '@aglyn/aglyn/plugin-manager/plugin-console-crons'
import { DELIVERY_APPS_ENV, DELIVERY_APPS_JOB_ID } from './constants'
import { registerDeliveryAppsConsoleServerDeclarations } from './declarations.console-server'
import { readStoreSettings } from './model/delivery-apps'
import { offeredServices, readDeliveryAppsConfig } from './server/config'
import { runDeliveryAppsTick } from './server/job'
import { deliveryAppsSubprocessors } from './subprocessors'

describe('the delivery-apps plugin’s declarations (AGL-3644)', () => {
  it('registers its job on the console’s server, which runs nothing on a deployment with no service', async () => {
    resetPluginConsoleCronsForTests()
    registerDeliveryAppsConsoleServerDeclarations()
    expect(listPluginConsoleCrons().map((entry) => entry.id)).toContain(DELIVERY_APPS_JOB_ID)
    const saved = { ...process.env }
    for (const name of Object.values(DELIVERY_APPS_ENV)) delete process.env[name]
    try {
      const reports = await runPluginConsoleCrons({
        nowMs: Date.now(),
        deadlineMs: Date.now() + 1000,
        jobIds: [DELIVERY_APPS_JOB_ID],
        beat: async () => undefined,
      })
      expect(reports).toEqual({ [DELIVERY_APPS_JOB_ID]: { orders: 0, configured: false } })
    } finally {
      process.env = saved
    }
  })

  it('declares every host it names as a customer-chosen destination, none a subprocessor of Aglyn’s', () => {
    const answer = deliveryAppsSubprocessors() as { subprocessors: unknown[]; hosts: any[] }
    expect(answer.subprocessors).toEqual([])
    for (const host of answer.hosts) {
      expect(host.disposition).toBe('not-a-subprocessor')
      expect(host.reason).toMatch(/^Customer-chosen destination\./)
    }
    expect(answer.hosts.map((host) => host.host)).toEqual([
      'openapi.doordash.com',
      'api.uber.com',
      'auth.uber.com',
      'api-third-party-gtm.grubhub.com',
      'api-third-party-gtm-pp.grubhub.com',
    ])
  })
})

describe('the deployment’s services (AGL-3644)', () => {
  it('offers a service only with every variable it names', () => {
    expect(offeredServices(readDeliveryAppsConfig({}))).toEqual([])
    const doordash = {
      DELIVERY_APPS_DOORDASH_DEVELOPER_ID: 'd',
      DELIVERY_APPS_DOORDASH_KEY_ID: 'k',
      DELIVERY_APPS_DOORDASH_SIGNING_SECRET: 's',
    }
    expect(offeredServices(readDeliveryAppsConfig(doordash))).toEqual([])
    expect(offeredServices(readDeliveryAppsConfig({ ...doordash, DELIVERY_APPS_DOORDASH_WEBHOOK_SECRET: 'w' }))).toEqual(['doordash'])
    const all = readDeliveryAppsConfig({
      ...doordash,
      DELIVERY_APPS_DOORDASH_WEBHOOK_SECRET: 'w',
      DELIVERY_APPS_UBER_EATS_CLIENT_ID: 'u',
      DELIVERY_APPS_UBER_EATS_CLIENT_SECRET: 'us',
      DELIVERY_APPS_GRUBHUB_CLIENT_ID: 'g',
      DELIVERY_APPS_GRUBHUB_SECRET_KEY: 'gk',
      DELIVERY_APPS_GRUBHUB_PARTNER_KEY: 'gp',
      DELIVERY_APPS_GRUBHUB_ENVIRONMENT: 'Sandbox',
    })
    expect(offeredServices(all)).toEqual(['doordash', 'uber-eats', 'grubhub'])
    expect(all.grubhub?.sandbox).toBe(true)
    expect(all.doordash?.sandbox).toBe(false)
  })

  it('bounds a store’s settings', () => {
    expect(readStoreSettings({ autoAccept: true, prepMinutes: 30 })).toEqual({ autoAccept: true, prepMinutes: 30 })
    expect(readStoreSettings({ autoAccept: 'yes', prepMinutes: 2 })).toEqual({ autoAccept: false, prepMinutes: 15 })
    expect(readStoreSettings(null, { autoAccept: true, prepMinutes: 40 })).toEqual({ autoAccept: true, prepMinutes: 40 })
  })
})

describe('the job (AGL-3644)', () => {
  it('works through what is due until its deadline, and counts a failure without stopping', async () => {
    let clock = 0
    const runs: string[] = []
    const report = await runDeliveryAppsTick(
      {
        engine: {
          runDue: async (id: string) => {
            runs.push(id)
            clock += 10
            if (id === 'b') throw new Error('boom')
            return id === 'a' ? 'retried' : 'completed'
          },
        } as never,
        store: { dueOrders: async () => ['a', 'b', 'c', 'd'] } as never,
        now: () => clock,
      },
      { deadlineMs: 30 },
    )
    expect(runs).toEqual(['a', 'b', 'c'])
    expect(report).toEqual({ orders: 3, retried: 1, failed: 1, completed: 1 })
  })
})
