/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored, and this suite needs `Request`/`Response`.
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

/**
 * `/api/admin/provision-sending-domains` — what the operator is told
 * (AGL-3432).
 *
 * Pinned: a full allowance raises its own alert, with the numbers, and never
 * the job-failure alert, because the sweep ran and no mail is lost; a sweep
 * that threw is the job failure, worded as one sentence.
 */

export {}

const mockAlerts: Array<{ type: string; options: Record<string, any> }> = []
let mockSummary: Record<string, unknown> = { atCapacity: false }
let mockProvisionFails = false

jest.mock('../../../../utils/cron-beat', () => ({
  __esModule: true,
  recordCronBeat: async () => undefined,
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  listPendingSendingDomains: async () => [],
}))

jest.mock('../../../../utils/server/provision-sending-domain', () => ({
  __esModule: true,
  provisionPendingSendingDomains: async () => {
    if (mockProvisionFails) throw Object.assign(new Error('vendor said no'), { name: 'ProviderError' })
    return mockSummary
  },
  readSendingDomainCapacity: async () => ({ held: 50, capacity: 50, remaining: 0, low: true }),
}))

jest.mock('../../../../utils/server/raise-operator-alert', () => ({
  __esModule: true,
  raiseConsoleOperatorAlert: async (type: string, options: Record<string, any> = {}) => {
    mockAlerts.push({ type, options })
    return null
  },
}))

import { POST } from './route'

const SECRET = 'cron-secret-for-this-spec'

const post = () =>
  POST(
    new Request('https://app.example.com/api/admin/provision-sending-domains', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-cron-secret': SECRET },
      body: '{}',
    }),
  )

beforeEach(() => {
  process.env['CRON_SECRET'] = SECRET
  mockAlerts.length = 0
  mockSummary = { atCapacity: false }
  mockProvisionFails = false
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  delete process.env['CRON_SECRET']
  jest.restoreAllMocks()
})

describe('the operator hears what the provisioning sweep found (AGL-3432)', () => {
  it('a full allowance is its own alert with the numbers, not a failed job', async () => {
    mockSummary = { atCapacity: true }
    expect((await post()).status).toBe(200)
    expect(mockAlerts).toEqual([
      {
        type: 'deliverability.sendingDomainCapacityFull',
        options: { dedupeKey: 'provision-sending-domains:capacity', context: { held: 50, capacity: 50 } },
      },
    ])
  })

  it('a sweep with room raises nothing', async () => {
    expect((await post()).status).toBe(200)
    expect(mockAlerts).toEqual([])
  })

  it('a sweep that threw is the job failure, named so the alert reads as one sentence', async () => {
    mockProvisionFails = true
    expect((await post()).status).toBe(500)
    expect(mockAlerts).toEqual([
      {
        type: 'ops.pluginJobFailed',
        options: {
          dedupeKey: 'provision-sending-domains:sweep',
          context: { job: 'The sending-domain provisioning sweep', error: 'it threw (ProviderError)' },
        },
      },
    ])
  })
})
