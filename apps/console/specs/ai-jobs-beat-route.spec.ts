/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom, which has no `Response`.
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

import {
  registerPluginApiRoute,
  unregisterPluginApiRoute,
} from '@aglyn/aglyn/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { POST } from '../app/api/admin/ai-jobs-beat/route'

const mockEnsureAll = jest.fn()

// The loader activates every console plugin surface; what is under test is
// the route around it, so it activates nothing and the beat is registered
// by the test the way the AI plugin's console surface registers it.
jest.mock('../utils/server-plugin-loader', () => ({
  __esModule: true,
  serverPluginLoader: { ensureAll: (...args: unknown[]) => mockEnsureAll(...args) },
}))

/**
 * THE AI JOBS BEAT'S CONSOLE ROUTE (AGL-3026).
 *
 * The beat is the AI plugin's, registered on the console surface; this app
 * route exists to give a sweep function time the plugin dispatcher's
 * `maxDuration` cannot. So what is held here is the arithmetic that makes the
 * route worth having, read from the sources rather than restated — an app
 * reaches a plugin only through its generated manifests, so the plugin's
 * constants are read as text — and the little the route does itself.
 */

const REPO_ROOT = join(__dirname, '..', '..', '..')
const read = (path: string) => readFileSync(join(REPO_ROOT, path), 'utf8')

const ROUTE = 'apps/console/app/api/admin/ai-jobs-beat/route.ts'
const MACHINE = 'libs/plugins/ai/src/lib/jobs/ai-jobs.ts'
/** Where a step's time and the budgets it has to fit are planned (AGL-3036). */
const BUDGET = 'libs/plugins/ai/src/lib/jobs/ai-job-budget.ts'
const BEAT = 'libs/plugins/ai/src/lib/jobs/ai-jobs-beat.ts'

function exportedNumber(source: string, name: string): number {
  const match = new RegExp(`export const ${name} = ([\\d_]+)`).exec(source)
  if (!match) throw new Error(`no numeric export ${name}`)
  return Number(match[1].replace(/_/g, ''))
}

/**
 * What the route may spend around the sweep: loading every console plugin
 * surface on a cold start, the lockdown read, the beat's mark, and the last
 * step's record after its provider call. Stated once, here, as the floor the
 * route's `maxDuration` must leave above the budget.
 */
const ROUTE_OWN_WORK_MS = 20_000

/**
 * The longest Vercel's Pro plan runs a function without fluid compute: the
 * ceiling a budget has to fit under however the project is set.
 */
const VERCEL_PRO_CEILING_MS = 300_000

describe('the arithmetic the route exists for (AGL-3026)', () => {
  const route = read(ROUTE)
  const machine = read(MACHINE)
  const budget = read(BUDGET)
  const maxDurationMs = exportedNumber(route, 'maxDuration') * 1_000
  const budgetMs = exportedNumber(budget, 'AI_JOB_SWEEP_BUDGET_MS')
  const leaseMs = exportedNumber(machine, 'AI_JOB_LEASE_MS')
  const inlineMs = exportedNumber(budget, 'AI_JOB_INLINE_BUDGET_MS')
  const dispatcherMs =
    exportedNumber(read('apps/console/app/api/[...pluginApi]/route.ts'), 'maxDuration') * 1_000

  it('holds a sweep and the route’s own work inside its maxDuration, under the plan’s ceiling', () => {
    expect(budgetMs + ROUTE_OWN_WORK_MS).toBeLessThanOrEqual(maxDurationMs)
    expect(maxDurationMs).toBeLessThanOrEqual(VERCEL_PRO_CEILING_MS)
  })

  it('needs its own route: the dispatcher’s ceiling could not hold one sweep', () => {
    expect(budgetMs).toBeGreaterThan(dispatcherMs)
    // …and an inline door's budget stays inside the dispatcher's, which is
    // what lets the doors stay on it.
    expect(inlineMs).toBeLessThan(dispatcherMs)
  })

  it('keeps a lease longer than any holder can run, so overlapping beats never share a step', () => {
    // The beat fires every minute and a sweep may run for most of five: a
    // lease that ran out under a live holder would let the next beat claim
    // the same step and call the provider for it again.
    expect(leaseMs).toBeGreaterThan(maxDurationMs)
    expect(leaseMs).toBeGreaterThan(dispatcherMs)
  })

  it('serves exactly the path the AI plugin registers its beat at, on the console surface', () => {
    const pluginPath = /export const AI_JOBS_BEAT_PATH = '([^']+)'/.exec(read(BEAT))?.[1]
    expect(pluginPath).toBe('admin/ai-jobs-beat')
    expect(/const AI_JOBS_BEAT_PATH = '([^']+)'/.exec(route)?.[1]).toBe(pluginPath)
    // The App Router file sits at that path, so it — not the dispatcher —
    // answers the URL.
    expect(ROUTE).toBe(`apps/console/app/api/${pluginPath}/route.ts`)
    expect(read('libs/plugins/ai/src/lib/server.ts')).toContain(
      'registerPluginApiRoute(AI_JOBS_BEAT_PATH, { web: runAiJobsBeat })',
    )
  })
})

describe('what the route does itself (AGL-3026)', () => {
  const SECRET = 'cron-secret-for-the-route'
  const originalSecret = process.env.CRON_SECRET
  const handler = jest.fn<Promise<Response>, [Request]>(async () =>
    Response.json({ held: false, ran: 1 }),
  )

  const beat = (headers: Record<string, string> = {}, method = 'POST') =>
    new Request('https://app.aglyn.com/api/admin/ai-jobs-beat', {
      method,
      headers,
      body: method === 'POST' ? '{}' : undefined,
    })

  beforeEach(() => {
    process.env.CRON_SECRET = SECRET
    mockEnsureAll.mockReset().mockResolvedValue(undefined)
    handler.mockClear()
    registerPluginApiRoute('admin/ai-jobs-beat', { web: handler })
  })

  afterEach(() => {
    unregisterPluginApiRoute('admin/ai-jobs-beat')
    if (originalSecret === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = originalSecret
  })

  it('hands a request carrying the secret to the plugin’s beat, body untouched, and answers what it answered', async () => {
    const response = await POST(beat({ 'x-cron-secret': SECRET }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ held: false, ran: 1 })
    expect(mockEnsureAll).toHaveBeenCalledWith(['consoleApi'])
    expect(handler).toHaveBeenCalledTimes(1)
    const [request] = handler.mock.calls[0]
    expect(request.bodyUsed).toBe(false)
  })

  it('refuses a request without the secret before it loads a plugin surface', async () => {
    for (const headers of [{}, { 'x-cron-secret': 'not-it' }, { authorization: 'Bearer not-it' }]) {
      const response = await POST(beat(headers))
      expect([JSON.stringify(headers), response.status]).toEqual([JSON.stringify(headers), 401])
    }
    expect(mockEnsureAll).not.toHaveBeenCalled()
    expect(handler).not.toHaveBeenCalled()
  })

  it('answers 501 while the secret is unset, and 405 to anything but a POST', async () => {
    delete process.env.CRON_SECRET
    expect((await POST(beat({ 'x-cron-secret': 'anything' }))).status).toBe(501)
    process.env.CRON_SECRET = SECRET
    expect((await POST(beat({ 'x-cron-secret': SECRET }, 'GET'))).status).toBe(405)
    expect(mockEnsureAll).not.toHaveBeenCalled()
  })

  it('answers 404 when no plugin registered the beat, rather than running anything else', async () => {
    unregisterPluginApiRoute('admin/ai-jobs-beat')
    const response = await POST(beat({ 'x-cron-secret': SECRET }))
    expect(response.status).toBe(404)
    expect(handler).not.toHaveBeenCalled()
  })
})
