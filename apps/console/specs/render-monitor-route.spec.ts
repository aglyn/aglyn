/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored.
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
 * The render monitor's route (AGL-3568): cron-authenticated, a GET only
 * looks, a POST stamps the beat `/api/health/crons` reads and records, and
 * our own edge's bypass headers travel with every page fetch.
 */

const mockRuns: Array<Record<string, any>> = []
const mockBeats: string[] = []
let mockReport: Record<string, any> = { dryRun: false, threshold: 2, sites: [] }

jest.mock('@aglyn/tenant-data-admin/server/render-monitor', () => ({
  runRenderMonitor: async (options: Record<string, unknown>) => {
    mockRuns.push(options)
    return { ...mockReport, dryRun: options['dryRun'] }
  },
}))
jest.mock('../utils/cron-beat', () => ({
  recordCronBeat: async (id: string) => {
    mockBeats.push(id)
  },
}))

import { GET, POST } from '../app/api/admin/render-monitor/route'

const ROUTE_URL = 'https://console.example.test/api/admin/render-monitor'

function request(method: 'GET' | 'POST', secret?: string): Request {
  return new Request(ROUTE_URL, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(secret ? { 'x-cron-secret': secret } : {}),
    },
    ...(method === 'POST' ? { body: '{}' } : {}),
  })
}

const ENV = ['CRON_SECRET', 'AGLYN_PROBE_TOKEN', 'AGLYN_VERCEL_BYPASS', 'VERCEL_AUTOMATION_BYPASS_SECRET'] as const
const saved: Partial<Record<(typeof ENV)[number], string>> = {}

beforeEach(() => {
  for (const key of ENV) saved[key] = process.env[key]
  process.env['CRON_SECRET'] = 'cron-secret'
  process.env['AGLYN_PROBE_TOKEN'] = 'probe-token'
  delete process.env['AGLYN_VERCEL_BYPASS']
  delete process.env['VERCEL_AUTOMATION_BYPASS_SECRET']
  mockRuns.length = 0
  mockBeats.length = 0
  mockReport = { dryRun: false, threshold: 2, sites: [] }
})

afterEach(() => {
  for (const key of ENV) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

describe('/api/admin/render-monitor (AGL-3568)', () => {
  it('refuses a caller without the cron secret, and runs nothing', async () => {
    expect((await POST(request('POST'))).status).toBe(401)
    expect((await POST(request('POST', 'wrong'))).status).toBe(401)
    expect(mockRuns).toEqual([])
    expect(mockBeats).toEqual([])
  })

  it('says it is not scheduled when the install has no cron secret', async () => {
    delete process.env['CRON_SECRET']
    expect((await POST(request('POST', 'anything'))).status).toBe(501)
    expect(mockRuns).toEqual([])
  })

  it('a scheduled POST stamps the beat and records, with our edge headers', async () => {
    const response = await POST(request('POST', 'cron-secret'))
    expect(response.status).toBe(200)
    expect(mockBeats).toEqual(['render-monitor'])
    expect(mockRuns).toHaveLength(1)
    expect(mockRuns[0]).toMatchObject({
      dryRun: false,
      headers: { 'x-aglyn-probe': 'probe-token' },
    })
  })

  it("sends Vercel's own exposed bypass when the install sets none of its own (AGL-3571)", async () => {
    process.env['VERCEL_AUTOMATION_BYPASS_SECRET'] = 'system-bypass'
    await POST(request('POST', 'cron-secret'))
    expect(mockRuns[0]).toMatchObject({
      headers: { 'x-aglyn-probe': 'probe-token', 'x-vercel-protection-bypass': 'system-bypass' },
    })
    process.env['AGLYN_VERCEL_BYPASS'] = 'configured-bypass'
    await POST(request('POST', 'cron-secret'))
    expect(mockRuns[1]).toMatchObject({ headers: { 'x-vercel-protection-bypass': 'configured-bypass' } })
  })

  it('a GET only looks: a dry run, and no beat', async () => {
    const response = await GET(request('GET', 'cron-secret'))
    expect(response.status).toBe(200)
    expect((await response.json()).dryRun).toBe(true)
    expect(mockRuns[0]['dryRun']).toBe(true)
    expect(mockBeats).toEqual([])
  })

  it('answers 207 only when a site could not be recorded, never for a site that is down', async () => {
    mockReport = {
      threshold: 2,
      sites: [{ origin: 'https://demo.example.test', ok: false, status: 'degraded', probes: [] }],
    }
    expect((await POST(request('POST', 'cron-secret'))).status).toBe(200)
    mockReport = {
      threshold: 2,
      sites: [{ origin: 'https://demo.example.test', ok: true, probes: [], error: 'firestore down' }],
    }
    expect((await POST(request('POST', 'cron-secret'))).status).toBe(207)
  })
})
