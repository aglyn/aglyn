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


import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const mockRecorded: Array<{ id: string; status: string; detail: string; label?: string }> = []
const mockRaised: Array<{ type: string; options: Record<string, any> }> = []
let mockTickets: Array<{ id: string; data: Record<string, unknown> }> = []

jest.mock('@aglyn/tenant-data-admin', () => {
  const actual = jest.requireActual('../../../libs/tenant/data/admin/src/lib/server/operator-health')
  const ts = (ms: number) => ({ toMillis: () => ms, ms })
  return {
    __esModule: true,
    healthStateOfBody: actual.healthStateOfBody,
    HEALTH_SERVICE_LABELS: actual.HEALTH_SERVICE_LABELS,
    recordHealthState: async (id: string, status: string, detail: string, options?: { label?: string }) => {
      mockRecorded.push({ id, status, detail, label: options?.label })
      return null
    },
    raiseOperatorAlert: async (type: string, options: Record<string, unknown>) => {
      mockRaised.push({ type, options })
      return { outcome: 'delivered', type }
    },
    sendOperatorAlertDigest: async () => ({ sent: false, reason: 'not-due', count: 0 }),
    firebaseAdmin: {
      firestore: { Timestamp: { fromMillis: ts } },
      app: () => ({
        firestore: () => ({
          collection: (name: string) => {
            // The workspace the SLA alert names (AGL-3432).
            if (name === 'orgs') {
              return {
                doc: (id: string) => ({
                  get: async () => ({
                    get: (field: string) => (id === 'o1' && field === 'name' ? 'Harbor View' : undefined),
                  }),
                }),
              }
            }
            const filters: Array<[string, string, { ms: number }]> = []
            const query: any = {
              where: (field: string, op: string, value: { ms: number }) => {
                filters.push([field, op, value])
                return query
              },
              orderBy: () => query,
              limit: () => query,
              get: async () => ({
                docs: mockTickets
                  .filter(({ data }) =>
                    filters.every(([field, op, value]) => {
                      const ms = (data[field] as { ms: number } | null)?.ms
                      if (ms === undefined) return false
                      return op === '<' ? ms < value.ms : ms >= value.ms
                    }),
                  )
                  .map(({ id, data }) => ({ id, data: () => data })),
              }),
            }
            return query
          },
        }),
      }),
    },
  }
})
jest.mock('../utils/server/email-health', () => ({
  evaluateEmailHealth: async () => ({ healthy: true }),
}))

import {
  CONSOLE_HEALTH_PATHS,
  runHealthSweep,
  runSupportSlaSweep,
  TENANT_HEALTH_PATHS,
} from '../utils/server/operator-alerts-tick'

/** What the sweep reads of a response: its status and its JSON. */
function answer(status: number, body: unknown) {
  return {
    status,
    json: async () => {
      if (typeof body === 'string') throw new SyntaxError('not JSON')
      return body
    },
  }
}

function routePaths(appDir: string): string[] {
  const root = join(appDir, 'app', 'api', 'health')
  const found: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry)
      if (statSync(path).isDirectory()) walk(path)
      else if (entry === 'route.ts') {
        found.push(`/api/health${relative(root, dir) ? `/${relative(root, dir)}` : ''}`)
      }
    }
  }
  walk(root)
  return found.sort()
}

const ENV = ['NEXT_PUBLIC_CONSOLE_URL', 'OPERATOR_HEALTH_TENANT_ORIGIN'] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  mockRecorded.length = 0
  mockRaised.length = 0
  mockTickets = []
  for (const key of ENV) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
})
afterEach(() => {
  for (const key of ENV) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

describe('the operator alerts tick (AGL-3377)', () => {
  it('asks every console health endpoint there is', () => {
    // `/api/health/signups` is the old path of signup-volume, re-exported.
    const routes = routePaths(join(__dirname, '..')).filter((path) => path !== '/api/health/signups')
    expect([...CONSOLE_HEALTH_PATHS].sort()).toEqual(routes)
  })

  it('asks every tenant health endpoint there is', () => {
    const routes = routePaths(join(__dirname, '..', '..', 'tenant'))
    expect([...TENANT_HEALTH_PATHS].sort()).toEqual(routes)
  })

  it('records each answer by its service, and ignores what is not a health answer', async () => {
    process.env['NEXT_PUBLIC_CONSOLE_URL'] = 'https://console.example.com/'
    const fetcher = jest.fn(async (url: string) => {
      if (url.endsWith('/api/health/crons')) {
        return answer(503, {
          status: 'degraded',
          service: 'console-crons',
          checks: { 'report-usage': { ok: false, code: 'job-silent' } },
        })
      }
      if (url.endsWith('/api/health/journeys')) return answer(429, '<html>challenge</html>')
      const service = url.endsWith('/api/health') ? 'console' : 'console-other'
      return answer(200, { status: 'ok', service, checks: {} })
    })
    const { rows, tenant } = await runHealthSweep({ fetcher: fetcher as unknown as typeof fetch })
    expect(tenant).toBe('unconfigured')
    expect(fetcher).toHaveBeenCalledTimes(CONSOLE_HEALTH_PATHS.length)
    expect(fetcher.mock.calls[0][0]).toBe('https://console.example.com/api/health')
    expect(mockRecorded).toContainEqual({
      id: 'console-crons',
      status: 'degraded',
      detail: 'Failing: report-usage (job-silent).',
      label: 'Scheduled jobs',
    })
    expect(rows.find((row) => row.path === '/api/health/journeys')?.status).toBe('unreachable')
    expect(mockRecorded.some((entry) => entry.id === 'console-journeys')).toBe(false)
  })

  it('asks the tenant runtime only when an origin is configured', async () => {
    process.env['OPERATOR_HEALTH_TENANT_ORIGIN'] = 'https://demo.example.com'
    const fetcher = jest.fn(async () => answer(200, { status: 'ok', service: 'tenant', checks: {} }))
    const { tenant } = await runHealthSweep({ requestOrigin: 'https://console.example.com', fetcher: fetcher as unknown as typeof fetch })
    expect(tenant).toBe('probed')
    expect(fetcher).toHaveBeenCalledTimes(CONSOLE_HEALTH_PATHS.length + TENANT_HEALTH_PATHS.length)
  })

  it('raises an SLA breach for an open ticket past its response time with no reply, once per ticket', async () => {
    const now = Date.UTC(2026, 8, 28, 12)
    const at = (hoursAgo: number) => ({ toMillis: () => now - hoursAgo * 3_600_000, ms: now - hoursAgo * 3_600_000 })
    mockTickets = [
      { id: 't1', data: { status: 'open', subject: 'Checkout broken', supportTier: 'priority', orgId: 'o1', responseDueAt: at(3), firstRespondedAt: null } },
      { id: 't2', data: { status: 'open', subject: 'Answered', responseDueAt: at(3), firstRespondedAt: at(4) } },
      { id: 't3', data: { status: 'closed', subject: 'Closed', responseDueAt: at(3), firstRespondedAt: null } },
      { id: 't4', data: { status: 'open', subject: 'Not due yet', responseDueAt: at(-1), firstRespondedAt: null } },
    ]
    expect(await runSupportSlaSweep({ now })).toEqual({ breached: 1, raised: 1 })
    expect(mockRaised).toEqual([
      {
        type: 'support.slaBreached',
        options: {
          dedupeKey: 't1',
          context: {
            ticketId: 't1',
            subject: 'Checkout broken',
            tier: 'priority',
            orgId: 'o1',
            orgName: 'Harbor View',
            overdue: '3 h',
          },
          // The ticket's workspace travels with the console notification.
          orgId: 'o1',
        },
      },
    ])
  })

  it('a dry run counts breaches and raises nothing', async () => {
    const now = Date.UTC(2026, 8, 28, 12)
    mockTickets = [{ id: 't1', data: { status: 'open', responseDueAt: { toMillis: () => now - 1, ms: now - 1 }, firstRespondedAt: null } }]
    expect(await runSupportSlaSweep({ now, dryRun: true })).toEqual({ breached: 1, raised: 0 })
    expect(mockRaised).toHaveLength(0)
  })
})
