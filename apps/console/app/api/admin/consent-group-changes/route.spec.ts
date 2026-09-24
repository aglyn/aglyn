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
 * `/api/admin/consent-group-changes` (AGL-3320) — the cron that finishes every
 * consent group change whose editor was closed.
 *
 * Pinned: only the scheduler's secret gets in; only its POST leaves the beat
 * `/api/health/crons` reads; a GET is a dry run; the executor is handed a
 * deadline inside the scheduler's wait; and a change that threw or stalled
 * turns the answer into a 207 the scheduler logs as an error.
 */

export {}

const mockBeats: string[] = []
const mockAdvanceDue = jest.fn()
let mockDeclarationsFail = false

jest.mock('../../../../utils/cron-beat', () => ({
  __esModule: true,
  recordCronBeat: async (jobId: string) => {
    mockBeats.push(jobId)
  },
}))

jest.mock('../../../../constants/plugins.declarations.server.generated', () => ({
  __esModule: true,
  registerPluginServerDeclarations: async () => {
    if (mockDeclarationsFail) throw new Error('a declaration threw')
  },
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  advanceDueConsentGroupChanges: (...args: unknown[]) => mockAdvanceDue(...args),
}))

import { GET, POST } from './route'

const SECRET = 'cron-secret-for-this-spec'
const URL = 'https://app.example.com/api/admin/consent-group-changes'

const call = (
  method: 'GET' | 'POST',
  headers: Record<string, string> = { 'x-cron-secret': SECRET },
  query = '',
) =>
  (method === 'GET' ? GET : POST)(
    new Request(`${URL}${query}`, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      ...(method === 'POST' ? { body: '{}' } : {}),
    }),
  )

beforeEach(() => {
  process.env['CRON_SECRET'] = SECRET
  mockBeats.length = 0
  mockDeclarationsFail = false
  mockAdvanceDue.mockReset()
  mockAdvanceDue.mockResolvedValue([])
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  delete process.env['CRON_SECRET']
  jest.restoreAllMocks()
})

describe('POST /api/admin/consent-group-changes (AGL-3320)', () => {
  it('answers 501 while the secret is unset, and 401 to anything but the secret', async () => {
    delete process.env['CRON_SECRET']
    expect((await call('POST')).status).toBe(501)
    process.env['CRON_SECRET'] = SECRET
    expect((await call('POST', { 'x-cron-secret': 'wrong' })).status).toBe(401)
    expect((await call('POST', {})).status).toBe(401)
    expect(mockBeats).toEqual([])
    expect(mockAdvanceDue).not.toHaveBeenCalled()
  })

  it('stamps its beat on the scheduler’s POST and works the changes with a deadline inside its wait', async () => {
    const before = Date.now()
    const response = await call('POST', { authorization: `Bearer ${SECRET}` })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, dryRun: false, changes: [] })
    expect(mockBeats).toEqual(['consent-group-changes'])
    const [{ deadlineMs, dryRun }] = mockAdvanceDue.mock.calls[0] as [
      { deadlineMs: number; dryRun: boolean },
    ]
    expect(dryRun).toBe(false)
    expect(deadlineMs).toBeGreaterThanOrEqual(before + 200_000)
    // The scheduler stops waiting at 240 s.
    expect(deadlineMs).toBeLessThan(Date.now() + 240_000)
  })

  it('treats a GET as a dry run that leaves no beat, unless told otherwise', async () => {
    expect((await call('GET')).status).toBe(200)
    expect(mockBeats).toEqual([])
    expect(mockAdvanceDue).toHaveBeenLastCalledWith(expect.objectContaining({ dryRun: true }))
    await call('GET', { 'x-cron-secret': SECRET }, '?dryRun=0')
    expect(mockAdvanceDue).toHaveBeenLastCalledWith(expect.objectContaining({ dryRun: false }))
  })

  it('answers 207 when a change threw or is stalled', async () => {
    mockAdvanceDue.mockResolvedValue([
      { orgId: 'org-1', changeId: 'c1', phase: 'carry', outcome: 'advanced', error: 'boom' },
      {
        orgId: 'org-2',
        changeId: 'c2',
        phase: 'carry',
        outcome: 'advanced',
        status: { progress: { stalled: true } },
      },
      { orgId: 'org-3', changeId: 'c3', phase: 'sweep', outcome: 'advanced', status: { progress: { stalled: false } } },
    ])
    const response = await call('POST')
    expect(response.status).toBe(207)
    expect(await response.json()).toMatchObject({ ok: false })
  })

  it('does not work a change when the plugins could not declare their participants', async () => {
    mockDeclarationsFail = true
    expect((await call('POST')).status).toBe(500)
    expect(mockAdvanceDue).not.toHaveBeenCalled()
    // The beat still records that the schedule is alive.
    expect(mockBeats).toEqual(['consent-group-changes'])
  })

  it('answers 405 to any other verb', async () => {
    const response = await POST(new Request(URL, { method: 'PUT', body: '{}' }))
    expect(response.status).toBe(405)
  })
})
