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

/**
 * The AI jobs beat's door (AGL-3026): who may run a sweep, the mark it leaves
 * for `/api/health/crons`, and what it answers. The beat it runs is
 * `jobs/ai-jobs-beat.spec.ts`; the console route that gives it its function
 * time is `apps/console/specs/ai-jobs-beat-route.spec.ts`.
 */

export {}

const mockWriteCronBeat = jest.fn()
const mockRunBeat = jest.fn()
const mockFirestore = { kind: 'firestore' }

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  writeCronBeat: (...args: unknown[]) => mockWriteCronBeat(...args),
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: () => ({ firestore: () => mockFirestore }) },
  // The real comparison: the door's refusals are what is under test.
  safeEqual: jest.requireActual('@aglyn/tenant-data-admin/server/safe-equal').safeEqual,
}))

jest.mock('../jobs/ai-jobs-beat', () => ({
  __esModule: true,
  AI_JOBS_BEAT_CRON_ID: 'ai-jobs-beat',
  runAiJobsBeat: (...args: unknown[]) => mockRunBeat(...args),
}))

import { POST } from './ai-jobs-beat-route'

const SECRET = 'cron-secret-for-the-beat'
const SWEPT = { held: false, due: 1, ran: 1, skipped: 0, remaining: 0, budgetExhausted: false }

function beat(headers: Record<string, string> = {}, method = 'POST'): Request {
  return new Request('https://app.aglyn.com/api/admin/ai-jobs-beat', { method, headers })
}

const originalSecret = process.env.CRON_SECRET

beforeEach(() => {
  process.env.CRON_SECRET = SECRET
  mockWriteCronBeat.mockReset().mockResolvedValue(true)
  mockRunBeat.mockReset().mockResolvedValue(SWEPT)
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
  if (originalSecret === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = originalSecret
})

describe('the AI jobs beat door', () => {
  it('runs one beat for the cron secret, marks it, and answers what the beat did', async () => {
    const response = await POST(beat({ 'x-cron-secret': SECRET }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(SWEPT)
    expect(mockWriteCronBeat).toHaveBeenCalledWith(mockFirestore, 'ai-jobs-beat')
    expect(mockRunBeat).toHaveBeenCalledTimes(1)
  })

  it('takes the secret as a bearer too, as the console’s other scheduled routes do', async () => {
    const response = await POST(beat({ authorization: `Bearer ${SECRET}` }))
    expect(response.status).toBe(200)
    expect(mockRunBeat).toHaveBeenCalledTimes(1)
  })

  it('refuses anything but the secret, before any mark or sweep', async () => {
    for (const headers of [
      {},
      { 'x-cron-secret': 'not-it' },
      { 'x-cron-secret': `${SECRET}x` },
      { authorization: SECRET },
      { authorization: 'Bearer not-it' },
    ]) {
      const response = await POST(beat(headers))
      expect([JSON.stringify(headers), response.status]).toEqual([JSON.stringify(headers), 401])
    }
    expect(mockWriteCronBeat).not.toHaveBeenCalled()
    expect(mockRunBeat).not.toHaveBeenCalled()
  })

  it('answers 501 while the secret is unset, so an unconfigured deployment cannot be made to spend', async () => {
    delete process.env.CRON_SECRET
    const response = await POST(beat({ 'x-cron-secret': '' }))
    expect(response.status).toBe(501)
    expect(mockRunBeat).not.toHaveBeenCalled()
  })

  it('answers 405 to anything but a POST', async () => {
    const response = await POST(beat({ 'x-cron-secret': SECRET }, 'GET'))
    expect(response.status).toBe(405)
    expect(mockRunBeat).not.toHaveBeenCalled()
  })

  it('marks a beat the switch held, and answers it as a 200', async () => {
    mockRunBeat.mockResolvedValue({ held: true })
    const response = await POST(beat({ 'x-cron-secret': SECRET }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ held: true })
    expect(mockWriteCronBeat).toHaveBeenCalledWith(mockFirestore, 'ai-jobs-beat')
  })

  it('answers 500 when the sweep itself throws, with nothing of the error in the body', async () => {
    mockRunBeat.mockRejectedValue(new Error('the collection-group query failed: index missing'))
    const response = await POST(beat({ 'x-cron-secret': SECRET }))
    expect(response.status).toBe(500)
    expect(JSON.stringify(await response.json())).not.toContain('index missing')
    expect(mockWriteCronBeat).toHaveBeenCalled()
  })
})
