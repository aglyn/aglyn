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
 * A job for a site that switched AI off (AGL-3028).
 *
 * The beat runs queued jobs with no request in front of them, so the plugin
 * API dispatcher's per-site gate never sees them. The machine asks the site
 * itself, after the claim and before the reservation, and this file pins what
 * that means against the REAL meter: the job fails in words a member can act
 * on, no step runner is called, no message stays reserved, nothing lands in
 * the usage rollup — and a site that never touched the switch, or a job with
 * no site at all, runs exactly as before.
 */

let mockDocs = new Map<string, Record<string, unknown>>()
let mockAutoId = 0

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

jest.mock('../activity/ai-activity', () => ({
  __esModule: true,
  logAiJobCreated: jest.fn(async () => undefined),
  logAiJobOutput: jest.fn(async () => undefined),
  logAiJobCanceled: jest.fn(async () => undefined),
  logAiJobNeedsInput: jest.fn(async () => undefined),
}))

// The plugin's own declarations: the add-on the entitlement fold reads.
import '../declarations'
import type { AiJobKind } from '../model/ai-jobs.types'
import { AI_OFF_FOR_SITE_COPY } from '../model/ai-site-switch'
import { aiJobSiteRefusal } from './ai-job-admission'
import type { AiJobStepRunner } from './ai-job-text-step'
import {
  createAiJob,
  getAiJob,
  registerAiJobStep,
  runAiJobStep,
} from './ai-jobs'
import { assistUsageDay, assistUsageMonth } from '../usage/assist-usage'

const NOW = new Date('2026-09-16T10:00:00.000Z')
const ORG = 'org-pro'
const firestore = mockMakeFirestore() as unknown as FirebaseFirestore.Firestore

/** A kind whose runner records that it ran and spends a little. */
const KIND: AiJobKind = 'text'
const runner = jest.fn<ReturnType<AiJobStepRunner>, Parameters<AiJobStepRunner>>(
  async () => ({
    outputs: [],
    usage: { inputTokens: 1_000, outputTokens: 200, cacheReadTokens: 0, cacheWriteTokens: 0 },
    estCostUsd: 0.006,
    model: 'claude-sonnet-5',
    stopReason: 'end_turn',
  }),
)

async function jobFor(hostId: string | null) {
  return createAiJob(
    firestore,
    { orgId: ORG, hostId, kind: KIND, brief: 'A tagline for a roaster.', createdBy: 'uid-1' },
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

beforeAll(() => {
  registerAiJobStep(KIND, runner)
})

beforeEach(() => {
  mockDocs = new Map()
  mockAutoId = 0
  runner.mockClear()
  mockDocs.set(`orgs/${ORG}`, { plan: 'pro', billingStatus: 'active' })
  mockDocs.set('hosts/host-off', { disabledPlugins: ['ai'] })
  // Written before the switch existed: nothing on it names AI.
  mockDocs.set('hosts/host-old', { disabledPlugins: ['commerce'], enabledPlugins: ['accounts'] })
  mockDocs.set('hosts/host-new', {})
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('a queued job for a site that switched AI off (AGL-3028)', () => {
  it('fails with the sentence a member can act on, and its runner never runs', async () => {
    const job = await jobFor('host-off')
    const run = await runAiJobStep(firestore, ORG, job.$id, { owner: 'beat', now: NOW })
    expect(run.outcome).toBe('failed')
    expect(runner).not.toHaveBeenCalled()
    const stored = await getAiJob(firestore, ORG, job.$id)
    expect(stored).toMatchObject({
      status: 'failed',
      error: AI_OFF_FOR_SITE_COPY,
      creditsReserved: 0,
      creditsSpent: 0,
      lease: null,
    })
    expect(stored?.steps[0]).toMatchObject({ status: 'failed', error: AI_OFF_FOR_SITE_COPY })
  })

  it('spends nothing: no message is reserved and nothing reaches the rollup', async () => {
    const job = await jobFor('host-off')
    await runAiJobStep(firestore, ORG, job.$id, { owner: 'beat', now: NOW })
    expect(mockDocs.has(`orgs/${ORG}/assistUsage/${assistUsageMonth(NOW)}`)).toBe(false)
    const signals = [...mockDocs.keys()].filter((path) => path.startsWith(`orgs/${ORG}/assistSignals/`))
    expect(signals).toEqual([])
  })

  it('hands back a reservation the caller already held', async () => {
    const job = await jobFor('host-off')
    await runAiJobStep(firestore, ORG, job.$id, {
      owner: 'route-1',
      now: NOW,
      reservation: heldReservation(),
    })
    expect(
      mockDocs.get(`orgs/${ORG}/assistUsage/${assistUsageMonth(NOW)}`)?.['messages'],
    ).toBe(0)
  })

  it('is never picked up again: a failed job is terminal', async () => {
    const job = await jobFor('host-off')
    await runAiJobStep(firestore, ORG, job.$id, { owner: 'beat', now: NOW })
    const again = await runAiJobStep(firestore, ORG, job.$id, { owner: 'beat-2', now: NOW })
    expect(again.outcome).toBe('not-claimable')
    expect(runner).not.toHaveBeenCalled()
  })
})

describe('a job the switch does not touch', () => {
  it.each(['host-old', 'host-new'])(
    'runs for %s, whose document never switched AI off',
    async (hostId) => {
      const job = await jobFor(hostId)
      const run = await runAiJobStep(firestore, ORG, job.$id, { owner: 'beat', now: NOW })
      expect(run.outcome).toBe('done')
      expect(runner).toHaveBeenCalledTimes(1)
    },
  )

  it('runs a workspace job with no site, whatever any site decided', async () => {
    const job = await jobFor(null)
    const run = await runAiJobStep(firestore, ORG, job.$id, { owner: 'beat', now: NOW })
    expect(run.outcome).toBe('done')
    expect(runner).toHaveBeenCalledTimes(1)
  })

  it('runs for a site that cannot be read, rather than inventing a switch', async () => {
    const job = await jobFor('host-missing')
    const run = await runAiJobStep(firestore, ORG, job.$id, { owner: 'beat', now: NOW })
    expect(run.outcome).toBe('done')
  })
})

describe('aiJobSiteRefusal — the question every job door asks first', () => {
  const org = { plan: 'pro' }

  it('refuses a site that switched AI off with the dispatcher’s status', async () => {
    await expect(aiJobSiteRefusal({ firestore, org, hostId: 'host-off' })).resolves.toEqual({
      status: 404,
      error: AI_OFF_FOR_SITE_COPY,
    })
  })

  it.each([null, 'host-old', 'host-new', 'host-missing'])('admits %s', async (hostId) => {
    await expect(aiJobSiteRefusal({ firestore, org, hostId })).resolves.toBeNull()
  })

  it('reads nothing for a value that cannot be a site id', async () => {
    const reads = jest.spyOn(firestore, 'collection')
    await expect(aiJobSiteRefusal({ firestore, org, hostId: 'hosts/../x' })).resolves.toBeNull()
    expect(reads).not.toHaveBeenCalled()
  })
})
