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

/**
 * A job for a workspace whose AI staff have paused (AGL-3037).
 *
 * Staff pause AI for one workspace on the lockdown carrier, and every jobs
 * door refuses a request for it through `featureLockdownRefusal`. A job queued
 * before the pause has no request in front of it, so the machine asks the same
 * verdict before it claims a step. This file pins what that means against the
 * REAL meter and the real reader the console registers — only the lockdown
 * read itself is a double: a paused workspace's job calls no runner, reserves
 * and meters nothing, and waits where it stopped; a staff caller on an inline
 * door passes, as the ladder lets them; and once staff resume AI, the job runs
 * from the step it was held at.
 */

let mockDocs = new Map<string, Record<string, unknown>>()
let mockAutoId = 0
/** Workspaces whose AI staff have paused. */
const mockPaused = new Set<string>()
const mockFeatureLockdownRefusal = jest.fn(
  async (options: { feature: string; staff?: boolean; orgId?: string | null }): Promise<Response | null> =>
    // The per-feature staff bypass `ai-generate` grants, as the real verdict applies it.
    options.feature === 'ai-generate' && options.orgId && mockPaused.has(options.orgId) && options.staff !== true
      ? Response.json({ error: 'AI is paused for this workspace' }, { status: 423 })
      : null,
)

function applyData(
  existing: Record<string, unknown> | undefined,
  data: Record<string, unknown>,
  merge: boolean,
): Record<string, unknown> {
  const base = merge ? { ...(existing ?? {}) } : {}
  for (const [key, value] of Object.entries(data)) {
    const inc = (value as { __inc?: number } | null)?.__inc
    if (typeof inc === 'number') base[key] = Number(base[key] ?? 0) + inc
    else base[key] = value
  }
  return base
}

/** Documents, transactions and batches: every shape the machine and the meter write. */
function mockMakeFirestore() {
  const snapshotOf = (path: string) => ({
    id: path.split('/').pop() as string,
    ref: { path },
    exists: mockDocs.has(path),
    data: () => mockDocs.get(path),
    get: (field: string) => (mockDocs.get(path) ?? {})[field],
  })
  const makeDoc = (path: string): Record<string, unknown> => ({
    id: path.split('/').pop(),
    path,
    collection: (name: string) => makeCollection(`${path}/${name}`),
    get: async () => snapshotOf(path),
    set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => {
      mockDocs.set(path, applyData(mockDocs.get(path), data, Boolean(options?.merge)))
    },
  })
  const makeCollection = (prefix: string) => ({
    doc: (id?: string) => makeDoc(`${prefix}/${id ?? `auto-${++mockAutoId}`}`),
    add: async (data: Record<string, unknown>) => {
      const path = `${prefix}/auto-${++mockAutoId}`
      mockDocs.set(path, data)
      return { id: path.split('/').pop() }
    },
  })
  const queuedWriter = (queued: Array<() => void>) => (
    ref: { path: string },
    data: Record<string, unknown>,
    options?: { merge?: boolean },
  ) => {
    queued.push(() => {
      mockDocs.set(ref.path, applyData(mockDocs.get(ref.path), data, Boolean(options?.merge)))
    })
  }
  return {
    collection: (name: string) => makeCollection(name),
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const queued: Array<() => void> = []
      const tx = {
        get: async (ref: { path: string }) => snapshotOf(ref.path),
        set: queuedWriter(queued),
      }
      const result = await fn(tx)
      for (const write of queued) write()
      return result
    },
    batch: () => {
      const queued: Array<() => void> = []
      const write = queuedWriter(queued)
      const batch = {
        set: (...args: Parameters<typeof write>) => {
          write(...args)
          return batch
        },
        commit: async () => {
          for (const one of queued) one()
        },
      }
      return batch
    },
  }
}

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    increment: (n: number) => ({ __inc: n }),
    serverTimestamp: () => '__now__',
  },
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  checkEntitlement: jest.requireActual('@aglyn/aglyn/app-utils/plan-entitlements')
    .checkEntitlement,
}))

jest.mock('@aglyn/tenant-data-admin/server/lockdown', () => ({
  __esModule: true,
  featureLockdownRefusal: (options: { feature: string; staff?: boolean; orgId?: string | null }) =>
    mockFeatureLockdownRefusal(options),
}))

jest.mock('../activity/ai-activity', () => ({
  __esModule: true,
  logAiJobCreated: jest.fn(async () => undefined),
  logAiJobOutput: jest.fn(async () => undefined),
  logAiJobCanceled: jest.fn(async () => undefined),
  logAiJobNeedsInput: jest.fn(async () => undefined),
}))

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
// The plugin's own declarations: the add-on the entitlement fold reads.
import '../declarations'
import type { AiJobKind } from '../model/ai-jobs.types'
import type { AiJobStepRunner } from './ai-job-text-step'
import {
  aiJobPauseReaderRegistered,
  claimNextStep,
  createAiJob,
  getAiJob,
  registerAiJobPauseReader,
  registerAiJobStep,
  runAiJobStep,
  sweepAiJobs,
} from './ai-jobs'
import { isAiGenerationPausedFor, registerAiJobsPause } from './ai-jobs-pause'
import { assistUsageDay, assistUsageMonth } from '../usage/assist-usage'

const NOW = new Date('2026-09-16T10:00:00.000Z')
const LATER = new Date(NOW.getTime() + 5 * 60_000)
const ORG = 'org-paused'
const OTHER = 'org-running'
const firestore = mockMakeFirestore() as unknown as FirebaseFirestore.Firestore

/** A kind whose runner records that it ran and spends a little. */
const KIND: AiJobKind = 'text'
const runner = jest.fn<ReturnType<AiJobStepRunner>, Parameters<AiJobStepRunner>>(async () => ({
  outputs: [],
  usage: { inputTokens: 1_000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 },
  estCostUsd: 0.006,
  model: 'claude-sonnet-5',
  stopReason: 'end_turn',
}))

async function jobFor(orgId: string) {
  return createAiJob(
    firestore,
    { orgId, hostId: null, kind: KIND, brief: 'A tagline for a roaster.', createdBy: 'uid-1' },
    NOW,
  )
}

/** A reservation the create door's ladder already holds for the first step. */
function heldReservation() {
  const monthKey = assistUsageMonth(NOW)
  mockDocs.set(`orgs/${ORG}/assistUsage/${monthKey}`, { messages: 1 })
  return {
    allowed: true,
    period: 'month' as const,
    used: 1,
    limit: 1000,
    remaining: 999,
    dayKey: assistUsageDay(NOW),
    monthKey,
    refusedBy: null,
    costUsd: 0,
    costLimitUsd: 40,
    budgetUsd: 40,
    free: null,
  }
}

const usageOf = (orgId: string) => mockDocs.get(`orgs/${orgId}/assistUsage/${assistUsageMonth(LATER)}`)

beforeAll(() => {
  registerAiJobStep(KIND, runner)
})

beforeEach(() => {
  mockDocs = new Map()
  mockAutoId = 0
  runner.mockClear()
  mockFeatureLockdownRefusal.mockClear()
  mockPaused.clear()
  mockPaused.add(ORG)
  mockDocs.set(`orgs/${ORG}`, { plan: 'pro', billingStatus: 'active' })
  mockDocs.set(`orgs/${OTHER}`, { plan: 'pro', billingStatus: 'active' })
  // As the console surface registers it.
  registerAiJobsPause()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('a queued job for a workspace whose AI staff have paused (AGL-3037)', () => {
  it('is held where it stopped: its runner never runs, nothing is claimed, and it only moves to the back of the queue', async () => {
    const job = await jobFor(ORG)
    const run = await runAiJobStep(firestore, ORG, job.$id, { owner: 'beat', now: LATER })
    expect(run.outcome).toBe('paused')
    expect(runner).not.toHaveBeenCalled()
    const stored = await getAiJob(firestore, ORG, job.$id)
    expect(stored).toMatchObject({
      status: 'queued',
      error: null,
      lease: null,
      creditsSpent: 0,
      updatedAt: LATER,
    })
    // The step keeps its place: not started, no attempt counted.
    expect(stored?.steps[0]).toMatchObject({ status: 'pending', attempts: 0, startedAt: null })
  })

  it('spends nothing: no message is reserved and nothing reaches the rollup', async () => {
    const job = await jobFor(ORG)
    await runAiJobStep(firestore, ORG, job.$id, { owner: 'beat', now: LATER })
    expect(usageOf(ORG)).toBeUndefined()
    expect([...mockDocs.keys()].filter((path) => path.includes('/assistSignals/'))).toEqual([])
  })

  it('hands back a reservation an inline door already held', async () => {
    const job = await jobFor(ORG)
    const run = await runAiJobStep(firestore, ORG, job.$id, {
      owner: 'route-1',
      now: NOW,
      reservation: heldReservation(),
    })
    expect(run.outcome).toBe('paused')
    expect(mockDocs.get(`orgs/${ORG}/assistUsage/${assistUsageMonth(NOW)}`)?.['messages']).toBe(0)
  })

  it('asks the verdict every jobs door climbs, for the job’s workspace, and lets an inline door’s staff caller through as the ladder does', async () => {
    const job = await jobFor(ORG)
    await runAiJobStep(firestore, ORG, job.$id, { owner: 'beat', now: LATER })
    expect(mockFeatureLockdownRefusal).toHaveBeenCalledWith({ feature: 'ai-generate', staff: false, orgId: ORG })
    const staffRun = await runAiJobStep(firestore, ORG, job.$id, { owner: 'route-staff', now: LATER, staff: true })
    expect(mockFeatureLockdownRefusal).toHaveBeenLastCalledWith({ feature: 'ai-generate', staff: true, orgId: ORG })
    expect(staffRun.outcome).toBe('done')
    expect(runner).toHaveBeenCalledTimes(1)
  })

  it('is skipped by the beat while another workspace’s job runs, and runs from where it stopped once staff resume AI', async () => {
    const held = await jobFor(ORG)
    const other = await jobFor(OTHER)
    const listDue = async () => [
      { orgId: ORG, jobId: held.$id },
      { orgId: OTHER, jobId: other.$id },
    ]
    const paused = await sweepAiJobs({ firestore, owner: 'beat-1', now: () => LATER.getTime(), listDue })
    expect(paused).toEqual({ due: 2, ran: 1, skipped: 0, paused: 1, remaining: 0, budgetExhausted: false })
    expect(runner).toHaveBeenCalledTimes(1)
    expect(runner.mock.calls[0][0].job.orgId).toBe(OTHER)
    expect(await getAiJob(firestore, ORG, held.$id)).toMatchObject({ status: 'queued', lease: null })
    expect(usageOf(ORG)).toBeUndefined()

    // Staff resume AI for the workspace.
    mockPaused.delete(ORG)
    runner.mockClear()
    const resumed = await sweepAiJobs({
      firestore,
      owner: 'beat-2',
      now: () => LATER.getTime() + 60_000,
      listDue: async () => [{ orgId: ORG, jobId: held.$id }],
    })
    expect(resumed).toMatchObject({ due: 1, ran: 1, paused: 0 })
    expect(runner).toHaveBeenCalledTimes(1)
    const done = await getAiJob(firestore, ORG, held.$id)
    expect(done).toMatchObject({ status: 'done' })
    expect(done?.steps[0]).toMatchObject({ status: 'done', attempts: 1 })
    expect(usageOf(ORG)?.['messages']).toBe(1)
  })

  it('leaves alone a job no claim would take: another owner’s live lease, or a finished job', async () => {
    const leased = await jobFor(ORG)
    mockPaused.delete(ORG)
    await claimNextStep(firestore, ORG, leased.$id, 'beat-1', NOW)
    mockPaused.add(ORG)
    const before = mockDocs.get(`orgs/${ORG}/aiJobs/${leased.$id}`)
    const run = await runAiJobStep(firestore, ORG, leased.$id, { owner: 'beat-2', now: new Date(NOW.getTime() + 1_000) })
    expect(run.outcome).toBe('not-claimable')
    expect(mockDocs.get(`orgs/${ORG}/aiJobs/${leased.$id}`)).toEqual(before)
    expect(runner).not.toHaveBeenCalled()
  })

  it('runs every job when no reader is registered, and when the reader cannot answer, as the lockdown reads fail open', async () => {
    const job = await jobFor(ORG)
    registerAiJobPauseReader(null)
    expect(aiJobPauseReaderRegistered()).toBe(false)
    expect((await runAiJobStep(firestore, ORG, job.$id, { owner: 'beat', now: LATER })).outcome).toBe('done')

    const second = await jobFor(ORG)
    registerAiJobPauseReader(async () => {
      throw new Error('lockdown read failed')
    })
    expect((await runAiJobStep(firestore, ORG, second.$id, { owner: 'beat', now: LATER })).outcome).toBe('done')
    expect(console.error).toHaveBeenCalledWith('ai job pause read failed', expect.objectContaining({ orgId: ORG }))
  })
})

describe('isAiGenerationPausedFor — the reader the console registers', () => {
  it('is the jobs doors’ own verdict: `ai-generate`, for the workspace, with the staff flag', async () => {
    await expect(isAiGenerationPausedFor({ orgId: ORG, staff: false })).resolves.toBe(true)
    await expect(isAiGenerationPausedFor({ orgId: ORG, staff: true })).resolves.toBe(false)
    await expect(isAiGenerationPausedFor({ orgId: OTHER, staff: false })).resolves.toBe(false)
    expect(mockFeatureLockdownRefusal.mock.calls.map(([options]) => options)).toEqual([
      { feature: 'ai-generate', staff: false, orgId: ORG },
      { feature: 'ai-generate', staff: true, orgId: ORG },
      { feature: 'ai-generate', staff: false, orgId: OTHER },
    ])
  })

  it('is what registering the pause gives the machine', () => {
    registerAiJobPauseReader(null)
    registerAiJobsPause()
    expect(aiJobPauseReaderRegistered()).toBe(true)
  })

  it('is described in the developer notes as holding, not failing, a paused workspace’s jobs', () => {
    const notes = readFileSync(join(__dirname, '..', '..', '..', '..', '..', '..', 'docs', 'AI_JOBS.md'), 'utf8').replace(/\s+/g, ' ')
    expect(notes).toContain('A workspace whose AI staff have paused runs none of its jobs (AGL-3037).')
    expect(notes).toContain("featureLockdownRefusal({ feature: 'ai-generate', staff, orgId })")
    expect(notes).toContain('Held, not failed.')
  })
})
