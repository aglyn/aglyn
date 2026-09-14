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
 * The AI jobs beat (AGL-2904): what it registers, and that the
 * `ai-generate` switch holds it. The sweep itself — the wall-clock budget,
 * the stale lease claimed by the next beat, the parked job re-queued once
 * rested — is proven against a fake Firestore in
 * `libs/tenant/data/admin/src/lib/server/ai-jobs.spec.ts`; what this file
 * pins is the wiring between the runner, the switch and that sweep.
 */

// A module, so its top-level mock bindings do not share a global scope with
// the other job specs' (`publish-schedule-job-lockdown.spec.ts` declares the
// same name).
export {}

let mockRegistered: {
  pluginId: string
  name: string
  intervalMinutes: number
  lockdown: { scope: string; reason?: string }
  handler: () => Promise<void>
} | null = null
let mockLocked: Response | null = null
const mockSweep = jest.fn()
const mockFirestore = { kind: 'firestore' }

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  registerPluginJob: (job: typeof mockRegistered) => {
    mockRegistered = job
  },
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  AI_JOB_SWEEP_BUDGET_MS: 45_000,
  firebaseAdmin: { app: () => ({ firestore: () => mockFirestore }) },
  featureLockdownRefusal: async () => mockLocked,
  sweepAiJobs: (...args: unknown[]) => mockSweep(...args),
}))

let AI_JOBS_PLUGIN_ID: string
let runAiJobsBeat: () => Promise<void>

beforeAll(() => {
  // Required after the mocks above are in place rather than imported: the
  // registration is a module-scope side effect, and a hoisted import would
  // run it before the capture variable exists.
  const beat = require('../utils/ai-jobs-beat') as {
    AI_JOBS_PLUGIN_ID: string
    runAiJobsBeat: () => Promise<void>
  }
  AI_JOBS_PLUGIN_ID = beat.AI_JOBS_PLUGIN_ID
  runAiJobsBeat = beat.runAiJobsBeat
})

beforeEach(() => {
  mockLocked = null
  mockSweep.mockReset()
  mockSweep.mockResolvedValue({
    due: 2,
    ran: 1,
    skipped: 1,
    remaining: 0,
    budgetExhausted: false,
  })
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  jest.spyOn(console, 'info').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('the AI jobs beat', () => {
  it('registers every minute, platform-scoped with its reason in the registration', () => {
    expect(mockRegistered).toMatchObject({
      pluginId: AI_JOBS_PLUGIN_ID,
      name: 'ai-jobs',
      intervalMinutes: 1,
      lockdown: { scope: 'platform' },
    })
    expect(mockRegistered?.lockdown.reason).toContain('provider spend')
  })

  it('sweeps under the wall-clock budget with a fresh owner per beat', async () => {
    await mockRegistered?.handler()
    await runAiJobsBeat()
    expect(mockSweep).toHaveBeenCalledTimes(2)
    const [first, second] = mockSweep.mock.calls.map(
      (call) => call[0] as { firestore: unknown; owner: string; budgetMs: number },
    )
    expect(first).toMatchObject({ firestore: mockFirestore, budgetMs: 45_000 })
    expect(first.owner).toMatch(/^beat:/)
    // Two beats overlapping inside the lease window must not share an
    // owner, or the second would read the first's lease as its own.
    expect(second.owner).not.toBe(first.owner)
  })

  it('does nothing while ai-generate is locked, and says so', async () => {
    mockLocked = Response.json({ error: 'locked' }, { status: 423 })
    await runAiJobsBeat()
    expect(mockSweep).not.toHaveBeenCalled()
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('ai-generate is locked'),
    )
  })
})
