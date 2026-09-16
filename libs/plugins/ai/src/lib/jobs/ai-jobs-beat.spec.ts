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
 * The AI jobs beat (AGL-2904, AGL-3026): that the `ai-generate` switch holds
 * it, and that each beat sweeps under the machine's budget with an owner of
 * its own. The sweep itself — the wall-clock budget, the stale lease claimed
 * by the next beat, the parked job re-queued once rested — is proven against
 * a fake Firestore in `ai-jobs.spec.ts` beside it; the route that calls this
 * is `server/ai-jobs-beat-route.spec.ts`.
 */

// A module, so its top-level mock bindings do not share a global scope with
// the other job specs' (`publish-schedule-job-lockdown.spec.ts` declares the
// same name).
export {}

let mockLocked: Response | null = null
const mockSweep = jest.fn()
const mockFirestore = { kind: 'firestore' }

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: { app: () => ({ firestore: () => mockFirestore }) },
  featureLockdownRefusal: async () => mockLocked,
}))

jest.mock('./ai-jobs', () => ({
  __esModule: true,
  AI_JOB_SWEEP_BUDGET_MS: 280_000,
  sweepAiJobs: (...args: unknown[]) => mockSweep(...args),
}))

import { AI_JOBS_BEAT_CRON_ID, AI_JOBS_BEAT_PATH, runAiJobsBeat } from './ai-jobs-beat'

const SWEPT = { due: 2, ran: 1, skipped: 1, paused: 1, remaining: 0, budgetExhausted: false }

beforeEach(() => {
  mockLocked = null
  mockSweep.mockReset()
  mockSweep.mockResolvedValue(SWEPT)
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  jest.spyOn(console, 'info').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('the AI jobs beat', () => {
  it('is served at the console’s admin path and judged by its own inventory row', () => {
    expect(AI_JOBS_BEAT_PATH).toBe('admin/ai-jobs-beat')
    expect(AI_JOBS_BEAT_CRON_ID).toBe('ai-jobs-beat')
  })

  it('sweeps under the machine’s budget with a fresh owner per beat, and reports the sweep', async () => {
    expect(await runAiJobsBeat()).toEqual({ held: false, ...SWEPT })
    await runAiJobsBeat()
    expect(mockSweep).toHaveBeenCalledTimes(2)
    const [first, second] = mockSweep.mock.calls.map(
      (call) => call[0] as { firestore: unknown; owner: string; budgetMs: number },
    )
    expect(first).toMatchObject({ firestore: mockFirestore, budgetMs: 280_000 })
    expect(first.owner).toMatch(/^beat:/)
    // Two beats overlapping inside the lease window must not share an
    // owner, or the second would read the first's lease as its own.
    expect(second.owner).not.toBe(first.owner)
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining('1 step(s) run'))
    // A workspace's AI pause holds its jobs, and the beat says how many (AGL-3037).
    expect(console.info).toHaveBeenCalledWith(expect.stringContaining("1 held by a workspace's AI pause"))
  })

  it('says nothing on a beat with nothing due', async () => {
    mockSweep.mockResolvedValue({ ...SWEPT, due: 0, ran: 0, skipped: 0 })
    await runAiJobsBeat()
    expect(console.info).not.toHaveBeenCalled()
  })

  it('does nothing while ai-generate is locked, and says so', async () => {
    mockLocked = Response.json({ error: 'locked' }, { status: 423 })
    expect(await runAiJobsBeat()).toEqual({ held: true })
    expect(mockSweep).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('ai-generate is locked'),
    )
  })
})
