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
 * `POST /api/admin/plugin-crons` — every console job the plugins declare, on
 * the fifteen-minute tick (AGL-2981).
 *
 * The seam is REAL: the jobs are declared on `plugin-console-crons` by the
 * plugins' declarations, as at boot, and the route runs what it finds there.
 * Only the beat writer and the plugin loader are recorders.
 */

const mockBeats: string[] = []
let mockDeclareJobs: () => void = () => undefined
const mockEnsureAll = jest.fn(async (..._args: unknown[]) => undefined)

jest.mock('../utils/cron-beat', () => ({
  __esModule: true,
  recordCronBeat: async (jobId: string) => {
    mockBeats.push(jobId)
  },
}))

jest.mock('../constants/plugins.declarations.server.generated', () => ({
  __esModule: true,
  registerPluginServerDeclarations: async () => mockDeclareJobs(),
}))

jest.mock('../utils/server-plugin-loader', () => ({
  __esModule: true,
  serverPluginLoader: { ensureAll: (...args: unknown[]) => mockEnsureAll(...args) },
}))

import {
  PLUGIN_CONSOLE_CRONS_JOB_ID,
  registerPluginConsoleCron,
  resetPluginConsoleCronsForTests,
} from '@aglyn/aglyn/plugin-manager/plugin-console-crons'
import { POST } from '../app/api/admin/plugin-crons/route'

const SECRET = 'cron-secret-for-this-spec'
const ROUTE_URL = 'https://app.example.com/api/admin/plugin-crons'

const post = (body?: unknown, headers: Record<string, string> = { 'x-cron-secret': SECRET }, query = '') =>
  POST(
    new Request(`${ROUTE_URL}${query}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body ?? {}),
    }),
  )

const DRIVES = 'Sends what a sequence scheduled; if it stops, nothing it scheduled is sent.'
const ran: string[] = []

function declare(options: { failing?: boolean } = {}) {
  mockDeclareJobs = () => {
    registerPluginConsoleCron(
      {
        id: 'acme-mail-send',
        label: 'Acme mail sends',
        drives: DRIVES,
        run: async (context) => {
          ran.push('send')
          if (options.failing) throw new Error('provider down')
          return { sent: 2, budgetMs: context.deadlineMs - context.nowMs }
        },
      },
      { pluginId: 'acme-mail' },
    )
    registerPluginConsoleCron(
      {
        id: 'acme-mail-sync',
        label: 'Acme mail sync',
        drives: DRIVES,
        run: async () => {
          ran.push('sync')
          return { read: 5 }
        },
      },
      { pluginId: 'acme-mail' },
    )
  }
}

beforeEach(() => {
  process.env['CRON_SECRET'] = SECRET
  mockBeats.length = 0
  ran.length = 0
  mockEnsureAll.mockClear()
  resetPluginConsoleCronsForTests()
  mockDeclareJobs = () => undefined
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  delete process.env['CRON_SECRET']
  jest.restoreAllMocks()
})

describe('POST /api/admin/plugin-crons (AGL-2981)', () => {
  it('answers 501 while the cron secret is unset, and 401 to anything but the secret', async () => {
    delete process.env['CRON_SECRET']
    expect((await post()).status).toBe(501)
    process.env['CRON_SECRET'] = SECRET
    expect((await post({}, { 'x-cron-secret': 'wrong' })).status).toBe(401)
    expect((await post({}, {})).status).toBe(401)
    expect(mockBeats).toEqual([])
    expect(ran).toEqual([])
  })

  it('accepts the bearer spelling a scheduler may send', async () => {
    declare()
    const response = await post({}, { authorization: `Bearer ${SECRET}` })
    expect(response.status).toBe(200)
  })

  it('stamps its own mark, then runs every declared job, each after its own mark', async () => {
    declare()
    const response = await post()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.jobs['acme-mail-send']).toMatchObject({ sent: 2 })
    expect(body.jobs['acme-mail-sync']).toEqual({ read: 5 })
    // The runner's own mark first — the route was posted — then each job's.
    expect(mockBeats[0]).toBe(PLUGIN_CONSOLE_CRONS_JOB_ID)
    expect(mockBeats[0]).toBe('plugin-console-crons')
    expect(mockBeats.slice(1).sort()).toEqual(['acme-mail-send', 'acme-mail-sync'])
    expect(ran.sort()).toEqual(['send', 'sync'])
    // Each job is handed a deadline inside the scheduler's 240 s wait.
    expect(body.jobs['acme-mail-send'].budgetMs).toBeLessThan(240_000)
    expect(body.jobs['acme-mail-send'].budgetMs).toBeGreaterThan(60_000)
    // The services a job resolves are other plugins' server registrations.
    expect(mockEnsureAll).toHaveBeenCalledWith(['consoleApi'])
  })

  it('answers 207 naming the job that threw, after running the rest', async () => {
    declare({ failing: true })
    const response = await post()
    const body = await response.json()
    expect(response.status).toBe(207)
    expect(body.failed).toEqual(['acme-mail-send'])
    expect(body.jobs).toEqual({ 'acme-mail-send': null, 'acme-mail-sync': { read: 5 } })
    // A job that threw was still scheduled: its mark is there.
    expect(mockBeats).toContain('acme-mail-send')
  })

  it('runs only the job a manual re-run names, by body or by query', async () => {
    declare()
    const byBody = await (await post({ job: 'acme-mail-sync' })).json()
    expect(Object.keys(byBody.jobs)).toEqual(['acme-mail-sync'])
    ran.length = 0
    const byQuery = await (await post({}, undefined, '?job=acme-mail-send')).json()
    expect(Object.keys(byQuery.jobs)).toEqual(['acme-mail-send'])
    expect(ran).toEqual(['send'])
  })

  it('answers 404 for a job no plugin declares', async () => {
    declare()
    const response = await post({ job: 'acme-mail-nothing' })
    expect(response.status).toBe(404)
    expect(ran).toEqual([])
  })

  it('answers 200 with nothing to run when no plugin declares a job', async () => {
    const body = await (await post()).json()
    expect(body).toMatchObject({ ok: true, jobs: {}, failed: [] })
    expect(mockBeats).toEqual(['plugin-console-crons'])
  })

  it('refuses every method but POST', async () => {
    const { POST: handler } = await import('../app/api/admin/plugin-crons/route')
    const response = await handler(new Request(ROUTE_URL, { method: 'GET', headers: { 'x-cron-secret': SECRET } }))
    expect(response.status).toBe(405)
  })
})
