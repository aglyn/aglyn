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
 * The AI job state machine (AGL-2904), driven against a fake Firestore that
 * honors transactions, batches and the two queries the module makes. The
 * meter is the REAL `assist-usage` module: a step's reservation moves the
 * real counters and its cost lands in the real monthly rollup, so a test
 * here fails if the machine and the meter disagree about a token. Only the
 * provider is faked, at the runtime's `runAiRequest` seam.
 */

let mockDocs = new Map<string, Record<string, unknown>>()
let mockAutoId = 0
const mockRunAiRequest = jest.fn()

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

function mockMakeFirestore() {
  const snapshotOf = (path: string) => ({
    id: path.split('/').pop() as string,
    ref: { path },
    exists: mockDocs.has(path),
    data: () => mockDocs.get(path),
    get: (field: string) => (mockDocs.get(path) ?? {})[field],
  })
  const makeDoc = (path: string) => ({
    id: path.split('/').pop(),
    path,
    collection: (name: string) => makeCollection(`${path}/${name}`),
    get: async () => snapshotOf(path),
    set: async (data: Record<string, unknown>, options?: { merge?: boolean }) => {
      mockDocs.set(path, applyData(mockDocs.get(path), data, Boolean(options?.merge)))
    },
  })
  type Filter = { field: string; op: string; value: unknown }
  const makeQuery = (
    matches: (path: string) => boolean,
    filters: Filter[] = [],
    order: { field: string; direction: string } | null = null,
    limit = Infinity,
  ) => {
    const query = {
      where: (field: string, op: string, value: unknown) =>
        makeQuery(matches, [...filters, { field, op, value }], order, limit),
      orderBy: (field: string, direction = 'asc') =>
        makeQuery(matches, filters, { field, direction }, limit),
      limit: (count: number) => makeQuery(matches, filters, order, count),
      get: async () => {
        const millis = (value: unknown) =>
          value instanceof Date ? value.getTime() : Number(value)
        let docs = [...mockDocs.keys()].filter(matches).filter((path) => {
          const data = mockDocs.get(path) ?? {}
          return filters.every(({ field, op, value }) => {
            if (op === '==') return data[field] === value
            if (op === 'in') return (value as unknown[]).includes(data[field])
            if (op === '<=') return millis(data[field]) <= millis(value)
            throw new Error(`unsupported operator ${op}`)
          })
        })
        if (order) {
          docs = docs.sort((a, b) => {
            const left = millis((mockDocs.get(a) ?? {})[order.field])
            const right = millis((mockDocs.get(b) ?? {})[order.field])
            return order.direction === 'desc' ? right - left : left - right
          })
        }
        return { docs: docs.slice(0, limit).map(snapshotOf) }
      },
    }
    return query
  }
  const makeCollection = (prefix: string) => ({
    doc: (id?: string) => makeDoc(`${prefix}/${id ?? `auto-${++mockAutoId}`}`),
    add: async (data: Record<string, unknown>) => {
      const path = `${prefix}/auto-${++mockAutoId}`
      mockDocs.set(path, data)
      return { id: path.split('/').pop() }
    },
    ...makeQuery(
      (path) =>
        path.startsWith(`${prefix}/`) &&
        path.slice(prefix.length + 1).split('/').length === 1,
    ),
  })
  return {
    collection: (name: string) => makeCollection(name),
    collectionGroup: (name: string) =>
      makeQuery((path) => {
        const parts = path.split('/')
        return parts.length >= 2 && parts[parts.length - 2] === name
      }),
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const queued: Array<() => void> = []
      const tx = {
        get: async (ref: { path: string }) => snapshotOf(ref.path),
        set: (
          ref: { path: string },
          data: Record<string, unknown>,
          options?: { merge?: boolean },
        ) => {
          queued.push(() => {
            mockDocs.set(
              ref.path,
              applyData(mockDocs.get(ref.path), data, Boolean(options?.merge)),
            )
          })
        },
      }
      const result = await fn(tx)
      for (const write of queued) write()
      return result
    },
    batch: () => {
      const queued: Array<() => void> = []
      const batch = {
        set: (
          ref: { path: string },
          data: Record<string, unknown>,
          options?: { merge?: boolean },
        ) => {
          queued.push(() => {
            mockDocs.set(
              ref.path,
              applyData(mockDocs.get(ref.path), data, Boolean(options?.merge)),
            )
          })
          return batch
        },
        commit: async () => {
          for (const write of queued) write()
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
  checkEntitlement: jest.requireActual(
    '@aglyn/aglyn/app-utils/plan-entitlements',
  ).checkEntitlement,
}))

jest.mock('../runtime/ai-runtime', () => ({
  __esModule: true,
  ...jest.requireActual('../runtime/ai-runtime'),
  runAiRequest: (...args: unknown[]) => mockRunAiRequest(...args),
}))

/**
 * The activity writers (AGL-2929), captured at the machine's seam. The row
 * shape each one stores is proven in `ai-activity.spec.ts` against the real
 * loggers; what this file pins is WHEN the machine calls them and WHO it
 * names — and that the brief and the generated text never reach them.
 */
const mockAiActivity = {
  logAiJobCreated: jest.fn(async (..._args: unknown[]) => undefined),
  logAiJobOutput: jest.fn(async (..._args: unknown[]) => undefined),
  logAiJobCanceled: jest.fn(async (..._args: unknown[]) => undefined),
  logAiJobNeedsInput: jest.fn(async (..._args: unknown[]) => undefined),
}
jest.mock('../activity/ai-activity', () => ({
  __esModule: true,
  logAiJobCreated: (...args: unknown[]) => mockAiActivity.logAiJobCreated(...args),
  logAiJobOutput: (...args: unknown[]) => mockAiActivity.logAiJobOutput(...args),
  logAiJobCanceled: (...args: unknown[]) => mockAiActivity.logAiJobCanceled(...args),
  logAiJobNeedsInput: (...args: unknown[]) =>
    mockAiActivity.logAiJobNeedsInput(...args),
}))

// The plugin's own declarations (AGL-2939): the add-on the entitlement fold
// reads and the levers the lockdown catalog lists, registered as the entry
// would have registered them.
import '../declarations'
import {
  AI_JOB_LEASE_MS,
  AI_JOB_NEEDS_INPUT_RETRY_MS,
  AI_JOB_NOT_AVAILABLE_COPY,
  AI_JOB_PLAN_STEP,
  AI_JOB_REFUSED_COPY,
  AI_JOB_STEP_MAX_ATTEMPTS,
  AI_JOB_STEP_MAX_PASSES,
  AI_JOB_STEP_RESERVE_CREDITS,
  addAiJobStepTokens,
  aiJobRefusalText,
  AI_JOB_SWEEP_MAX_JOBS,
  aiJobNextStepMinimumMs,
  aiJobStepMinimumMs,
  aiJobStepNames,
  aiJobStepRunnerFor,
  aiJobStepSpentNothing,
  recordAiJobApplied,
  aiJobSummary,
  cancelAiJob,
  claimNextStep,
  completeAiJob,
  createAiJob,
  failAiJob,
  getAiJob,
  heartbeatStep,
  listAiJobs,
  registerAiJobPlanStep,
  registerAiJobStep,
  resumeAiJob,
  runAiJobStep,
  sweepAiJobs,
  type AiJobStepRun,
} from './ai-jobs'
import { aiJobPlanCreditEstimate } from '../model/ai-site-job'
import { AI_UPSTREAM_FAILURE_COPY, AiUpstreamError } from '../runtime/ai-runtime'
import { assistFreeTasteRefusalText } from '@aglyn/aglyn/app-utils/assist-credits'
import {
  ASSIST_EXCHANGE_RETENTION_DAYS,
  assistUsageDay,
  assistUsageMonth,
} from '../usage/assist-usage'

const NOW = new Date('2026-09-14T10:00:00.000Z')
const ORG = 'org-pro'
const firestore = mockMakeFirestore() as unknown as FirebaseFirestore.Firestore

const USAGE = {
  inputTokens: 1_000,
  outputTokens: 200,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
}

function armCompletion(text = 'Fresh coffee, roasted this morning.') {
  mockRunAiRequest.mockResolvedValue({
    kind: 'completion',
    text,
    toolUse: [],
    usage: USAGE,
    // 1,000 in at $3/M + 200 out at $15/M — the figure the rollup must carry.
    estCostUsd: 0.006,
    stopReason: 'end_turn',
  })
}

async function newTextJob(overrides: { orgId?: string; kind?: 'text' | 'page' } = {}) {
  return createAiJob(
    firestore,
    {
      orgId: overrides.orgId ?? ORG,
      hostId: 'host-1',
      kind: overrides.kind ?? 'text',
      brief: 'A two-line tagline for a coffee roaster.',
      createdBy: 'uid-1',
    },
    NOW,
  )
}

beforeEach(() => {
  mockDocs = new Map()
  mockAutoId = 0
  mockRunAiRequest.mockReset()
  for (const writer of Object.values(mockAiActivity)) writer.mockClear()
  mockDocs.set(`orgs/${ORG}`, { plan: 'pro', billingStatus: 'active' })
  mockDocs.set('orgs/org-free', { plan: 'free' })
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('createAiJob', () => {
  it('writes a queued job with its step plan, a credit hold and a TTL', async () => {
    const job = await newTextJob()
    const stored = mockDocs.get(`orgs/${ORG}/aiJobs/${job.$id}`)
    expect(stored).toMatchObject({
      orgId: ORG,
      hostId: 'host-1',
      kind: 'text',
      status: 'queued',
      steps: [{ name: 'draft', status: 'pending', creditsSpent: 0, attempts: 0 }],
      outputs: [],
      creditsReserved: AI_JOB_STEP_RESERVE_CREDITS,
      creditsSpent: 0,
      createdBy: 'uid-1',
      lease: null,
    })
    const expiresAt = stored?.['expiresAt'] as Date
    expect(
      (expiresAt.getTime() - NOW.getTime()) / (24 * 60 * 60 * 1000),
    ).toBe(ASSIST_EXCHANGE_RETENTION_DAYS)
  })

  it('refuses an empty brief before writing anything', async () => {
    await expect(
      createAiJob(firestore, { orgId: ORG, kind: 'text', brief: '   ', createdBy: 'u' }),
    ).rejects.toThrow('brief')
    expect([...mockDocs.keys()].some((path) => path.includes('/aiJobs/'))).toBe(false)
  })
})

describe('the lease', () => {
  it('lets one owner claim, refuses a second while the lease is live, and admits it once expired', async () => {
    const job = await newTextJob()
    const first = await claimNextStep(firestore, ORG, job.$id, 'beat-a', NOW)
    expect(first?.stepIndex).toBe(0)
    expect(first?.job.status).toBe('running')
    expect(first?.job.steps[0]).toMatchObject({ status: 'running', attempts: 1 })

    const inside = new Date(NOW.getTime() + AI_JOB_LEASE_MS - 1)
    expect(await claimNextStep(firestore, ORG, job.$id, 'beat-b', inside)).toBeNull()

    // The stale lease is released by being claimed, not by a sweep of its own.
    const after = new Date(NOW.getTime() + AI_JOB_LEASE_MS + 1)
    const second = await claimNextStep(firestore, ORG, job.$id, 'beat-b', after)
    expect(second?.job.lease).toMatchObject({ owner: 'beat-b' })
    expect(second?.job.steps[0].attempts).toBe(2)
  })

  it('lets the holder re-claim and heartbeat, and refuses a heartbeat from anyone else', async () => {
    const job = await newTextJob()
    await claimNextStep(firestore, ORG, job.$id, 'route-1', NOW)
    expect(await claimNextStep(firestore, ORG, job.$id, 'route-1', NOW)).not.toBeNull()
    const later = new Date(NOW.getTime() + 30_000)
    expect(await heartbeatStep(firestore, ORG, job.$id, 'route-1', later)).toBe(true)
    expect(await heartbeatStep(firestore, ORG, job.$id, 'beat-x', later)).toBe(false)
    const stored = await getAiJob(firestore, ORG, job.$id)
    expect((stored?.lease?.until as unknown as Date).getTime()).toBe(
      later.getTime() + AI_JOB_LEASE_MS,
    )
  })

  it('refuses to claim a terminal or parked job', async () => {
    const job = await newTextJob()
    await cancelAiJob(firestore, ORG, job.$id, NOW)
    expect(await claimNextStep(firestore, ORG, job.$id, 'beat-a', NOW)).toBeNull()
  })
})

describe('runAiJobStep — the text step end to end', () => {
  it('reserves, runs, meters and records: the job is done, the output is the copy, the rollup carries the cost', async () => {
    armCompletion()
    const job = await newTextJob()
    const run = await runAiJobStep(firestore, ORG, job.$id, { owner: 'route-1', now: NOW })
    expect(run.outcome).toBe('done')
    const done = (run as { job: { status: string } }).job
    expect(done.status).toBe('done')

    const stored = await getAiJob(firestore, ORG, job.$id)
    expect(stored).toMatchObject({
      status: 'done',
      creditsReserved: 0,
      // $0.006 at $0.001 a credit, rounded up.
      creditsSpent: 6,
      lease: null,
      error: null,
      outputs: [
        {
          resource: 'text',
          id: 'draft',
          hostId: 'host-1',
          label: 'Draft copy',
          text: 'Fresh coffee, roasted this morning.',
        },
      ],
    })
    expect(stored?.steps[0]).toMatchObject({ status: 'done', creditsSpent: 6 })

    // The meter: one message reserved on the entitled monthly guard, the
    // tokens and the cost folded into the same rollup a chat turn feeds.
    const month = mockDocs.get(`orgs/${ORG}/assistUsage/${assistUsageMonth(NOW)}`)
    expect(month).toMatchObject({
      messages: 1,
      inputTokens: 1_000,
      outputTokens: 200,
      estCostUsd: 0.006,
    })
    const signals = [...mockDocs.entries()].filter(([path]) =>
      path.startsWith(`orgs/${ORG}/assistSignals/`),
    )
    expect(signals).toHaveLength(1)
    expect(signals[0][1]).toMatchObject({
      route: 'ai/jobs',
      hostId: 'host-1',
      model: 'claude-sonnet-5',
      tier: 'entitled',
      stopReason: 'end_turn',
    })

    // One audit row per output.
    const audit = [...mockDocs.entries()].filter(([path]) => path.startsWith('adminAudit/'))
    expect(audit).toHaveLength(1)
    expect(audit[0][1]).toMatchObject({
      action: 'ai.job.output',
      actorUid: 'uid-1',
      target: `orgs/${ORG}/aiJobs/${job.$id}`,
      after: { resource: 'text', id: 'draft', label: 'Draft copy', credits: 6 },
    })
  })

  it('sends the brief in the user turn under a cached static system block, on Sonnet with adaptive thinking', async () => {
    armCompletion()
    const job = await newTextJob()
    await runAiJobStep(firestore, ORG, job.$id, { owner: 'route-1', now: NOW })
    const request = mockRunAiRequest.mock.calls[0][0] as Record<string, unknown>
    expect(request).toMatchObject({
      model: 'claude-sonnet-5',
      thinking: 'adaptive',
      stream: false,
    })
    const system = request['system'] as Array<{ text: string; cacheBreakpoint?: true }>
    expect(system[0].cacheBreakpoint).toBe(true)
    expect(system[0].text).not.toContain('coffee')
    expect((request['messages'] as Array<{ content: string }>)[0].content).toContain(
      'A two-line tagline for a coffee roaster.',
    )
  })

  it('uses a reservation the caller already holds instead of taking a second one', async () => {
    armCompletion()
    const job = await newTextJob()
    const monthKey = assistUsageMonth(NOW)
    // The route's ladder reserved: the counter already moved once.
    mockDocs.set(`orgs/${ORG}/assistUsage/${monthKey}`, { messages: 1 })
    await runAiJobStep(firestore, ORG, job.$id, {
      owner: 'route-1',
      now: NOW,
      reservation: {
        allowed: true,
        period: 'month',
        used: 1,
        limit: 1000,
        remaining: 999,
        dayKey: assistUsageDay(NOW),
        monthKey,
        refusedBy: null,
        costUsd: 0,
        costLimitUsd: 40,
        budgetUsd: 40,
        // A paid workspace: attributed to no Free account (AGL-2925).
        free: null,
      },
    })
    expect(mockDocs.get(`orgs/${ORG}/assistUsage/${monthKey}`)?.['messages']).toBe(1)
  })

  it('parks the job as needs_input when the reservation is refused, and never calls the provider', async () => {
    const job = await newTextJob({ orgId: 'org-free' })
    // A Free workspace is entitled to generation (the taste, AGL-2925), so
    // it meters monthly here and its daily message cap is not the rung that
    // refuses. The platform's day of free spend at the ceiling is: it
    // refuses every Free reservation until the UTC day rolls.
    mockDocs.set(`platformAiFreeSpend/${assistUsageDay(NOW)}`, { estCostUsd: 25 })
    const run = await runAiJobStep(firestore, 'org-free', job.$id, { owner: 'beat', now: NOW })
    expect(run.outcome).toBe('needs_input')
    const stored = await getAiJob(firestore, 'org-free', job.$id)
    expect(stored).toMatchObject({
      status: 'needs_input',
      error: assistFreeTasteRefusalText('platform'),
      lease: null,
    })
    // The step is pending again and the refused attempt is not counted.
    expect(stored?.steps[0]).toMatchObject({ status: 'pending', attempts: 0 })
    expect(mockRunAiRequest).not.toHaveBeenCalled()
  })

  it('fails fast, before any reservation, for a kind with no runner yet', async () => {
    const job = await newTextJob({ kind: 'page' })
    const run = await runAiJobStep(firestore, ORG, job.$id, { owner: 'beat', now: NOW })
    expect(run.outcome).toBe('failed')
    const stored = await getAiJob(firestore, ORG, job.$id)
    expect(stored).toMatchObject({
      status: 'failed',
      error: AI_JOB_NOT_AVAILABLE_COPY,
      creditsReserved: 0,
      lease: null,
    })
    expect(stored?.steps[0]).toMatchObject({ status: 'failed', error: AI_JOB_NOT_AVAILABLE_COPY })
    expect(mockDocs.has(`orgs/${ORG}/assistUsage/${assistUsageMonth(NOW)}`)).toBe(false)
    expect(mockRunAiRequest).not.toHaveBeenCalled()
  })

  it('hands a caller-held reservation back when the kind has no runner', async () => {
    const job = await newTextJob({ kind: 'page' })
    const monthKey = assistUsageMonth(NOW)
    mockDocs.set(`orgs/${ORG}/assistUsage/${monthKey}`, { messages: 1 })
    await runAiJobStep(firestore, ORG, job.$id, {
      owner: 'route-1',
      now: NOW,
      reservation: {
        allowed: true,
        period: 'month',
        used: 1,
        limit: 1000,
        remaining: 999,
        dayKey: assistUsageDay(NOW),
        monthKey,
        refusedBy: null,
        costUsd: 0,
        costLimitUsd: 40,
        budgetUsd: 40,
        // A paid workspace: attributed to no Free account (AGL-2925).
        free: null,
      },
    })
    expect((await getAiJob(firestore, ORG, job.$id))?.status).toBe('failed')
    expect(mockDocs.get(`orgs/${ORG}/assistUsage/${monthKey}`)?.['messages']).toBe(0)
  })

  it('hands the message back and re-queues the step on a retryable provider failure', async () => {
    mockRunAiRequest.mockRejectedValue(new AiUpstreamError(529, true, 'req-1'))
    const job = await newTextJob()
    const run = await runAiJobStep(firestore, ORG, job.$id, { owner: 'beat', now: NOW })
    expect(run.outcome).toBe('requeued')
    const stored = await getAiJob(firestore, ORG, job.$id)
    expect(stored).toMatchObject({ status: 'queued', lease: null, creditsSpent: 0 })
    expect(stored?.steps[0]).toMatchObject({ status: 'pending', attempts: 1 })
    // Released against the month it reserved in: the counter is back to 0.
    expect(mockDocs.get(`orgs/${ORG}/assistUsage/${assistUsageMonth(NOW)}`)?.['messages']).toBe(0)
  })

  it('fails, with the fixed sentence, on a provider failure that will not clear by waiting', async () => {
    mockRunAiRequest.mockRejectedValue(new AiUpstreamError(400, false, 'req-2'))
    const job = await newTextJob()
    const run = await runAiJobStep(firestore, ORG, job.$id, { owner: 'beat', now: NOW })
    expect(run.outcome).toBe('failed')
    const stored = await getAiJob(firestore, ORG, job.$id)
    expect(stored?.error).toBe(AI_UPSTREAM_FAILURE_COPY)
    expect(stored?.error).not.toContain('req-2')
  })

  it('treats an aborted budget as retryable', async () => {
    const abort = new Error('aborted')
    abort.name = 'AbortError'
    mockRunAiRequest.mockRejectedValue(abort)
    const job = await newTextJob()
    const run = await runAiJobStep(firestore, ORG, job.$id, { owner: 'beat', now: NOW })
    expect(run.outcome).toBe('requeued')
  })

  it('stops retrying once a step has exhausted its attempts', async () => {
    mockRunAiRequest.mockRejectedValue(new AiUpstreamError(529, true, 'req-3'))
    const job = await newTextJob()
    let last: AiJobStepRun | null = null
    for (let attempt = 0; attempt <= AI_JOB_STEP_MAX_ATTEMPTS; attempt += 1) {
      last = await runAiJobStep(firestore, ORG, job.$id, { owner: 'beat', now: NOW })
    }
    expect(last?.outcome).toBe('failed')
    expect(mockRunAiRequest).toHaveBeenCalledTimes(AI_JOB_STEP_MAX_ATTEMPTS)
  })

  it('meters a model refusal — tokens were spent — and fails the job with the refusal copy', async () => {
    mockRunAiRequest.mockResolvedValue({
      kind: 'refusal',
      text: '',
      usage: USAGE,
      estCostUsd: 0.006,
      stopReason: 'refusal',
    })
    const job = await newTextJob()
    const run = await runAiJobStep(firestore, ORG, job.$id, { owner: 'beat', now: NOW })
    expect(run.outcome).toBe('failed')
    const stored = await getAiJob(firestore, ORG, job.$id)
    expect(stored).toMatchObject({ status: 'failed', error: AI_JOB_REFUSED_COPY, creditsSpent: 6 })
    expect(mockDocs.get(`orgs/${ORG}/assistUsage/${assistUsageMonth(NOW)}`)).toMatchObject({
      estCostUsd: 0.006,
    })
  })

  it('records the cost of a step that finished after the job was canceled, and leaves it canceled', async () => {
    let resolveProvider: (value: unknown) => void = () => undefined
    mockRunAiRequest.mockReturnValue(
      new Promise((resolve) => {
        resolveProvider = resolve
      }),
    )
    const job = await newTextJob()
    const running = runAiJobStep(firestore, ORG, job.$id, { owner: 'route', now: NOW })
    await new Promise((resolve) => setImmediate(resolve))
    await cancelAiJob(firestore, ORG, job.$id, NOW)
    resolveProvider({
      kind: 'completion',
      text: 'Late copy.',
      toolUse: [],
      usage: USAGE,
      estCostUsd: 0.006,
      stopReason: 'end_turn',
    })
    await running
    const stored = await getAiJob(firestore, ORG, job.$id)
    expect(stored).toMatchObject({ status: 'canceled', creditsSpent: 6 })
  })
})

describe('a step’s own failure, and what a runner is handed (AGL-2938)', () => {
  const ZERO = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }

  const newInsightJob = () =>
    createAiJob(
      firestore,
      { orgId: ORG, hostId: 'host-1', kind: 'insight', brief: 'Anything at all.', createdBy: 'uid-1' },
      NOW,
    )

  it('hands the runner the machine’s Firestore and the org it reserved against', async () => {
    const contexts: Array<Record<string, unknown>> = []
    registerAiJobStep('insight', async (context) => {
      contexts.push(context as unknown as Record<string, unknown>)
      return { outputs: [], usage: USAGE, estCostUsd: 0.006, model: 'claude-sonnet-5', stopReason: 'end_turn' }
    })
    const job = await newInsightJob()
    await runAiJobStep(firestore, ORG, job.$id, { owner: 'route-1', now: NOW })
    expect(contexts).toHaveLength(1)
    expect(contexts[0]['firestore']).toBe(firestore)
    expect(contexts[0]['org']).toMatchObject({ plan: 'pro' })
  })

  it('fails before the provider: the message goes back, nothing is metered, and the job carries the step’s sentence', async () => {
    registerAiJobStep('insight', async () => ({
      outputs: [],
      usage: ZERO,
      estCostUsd: 0,
      model: 'claude-sonnet-5',
      stopReason: null,
      failure: 'This site is not in this workspace.',
    }))
    const job = await newInsightJob()
    const run = await runAiJobStep(firestore, ORG, job.$id, { owner: 'route-1', now: NOW })
    expect(run.outcome).toBe('failed')
    const stored = await getAiJob(firestore, ORG, job.$id)
    expect(stored).toMatchObject({
      status: 'failed',
      error: 'This site is not in this workspace.',
      creditsSpent: 0,
    })
    expect(stored?.steps[0]).toMatchObject({ status: 'failed', creditsSpent: 0 })
    const month = mockDocs.get(`orgs/${ORG}/assistUsage/${assistUsageMonth(NOW)}`) ?? {}
    expect(Number(month['messages'] ?? 0)).toBe(0)
    expect(Number(month['estCostUsd'] ?? 0)).toBe(0)
  })

  it('stops for a person before the provider: the message goes back and nothing is metered (AGL-2909)', async () => {
    const limit = 'This site has no room for another shared layout.'
    registerAiJobStep('insight', async () => ({
      outputs: [],
      usage: ZERO,
      estCostUsd: 0,
      model: 'claude-sonnet-5',
      stopReason: null,
      review: { reason: 'limit', message: limit, findings: [] },
    }))
    const job = await newInsightJob()
    const run = await runAiJobStep(firestore, ORG, job.$id, { owner: 'route-1', now: NOW })
    expect(run.outcome).toBe('needs_review')
    const stored = await getAiJob(firestore, ORG, job.$id)
    expect(stored).toMatchObject({ status: 'needs_review', creditsSpent: 0 })
    const month = mockDocs.get(`orgs/${ORG}/assistUsage/${assistUsageMonth(NOW)}`) ?? {}
    expect(Number(month['messages'] ?? 0)).toBe(0)
    expect(Number(month['estCostUsd'] ?? 0)).toBe(0)
  })

  it('records a plan the step reused without spending, and meters no credit for it (AGL-2937)', async () => {
    // A plan reused from an identical brief returns zero usage, which is what
    // makes the machine release the reservation and meter nothing — and it
    // still completes the step, so confirming runs the next one.
    registerAiJobStep('insight', async () => ({
      outputs: [],
      usage: ZERO,
      estCostUsd: 0,
      model: 'claude-sonnet-5',
      stopReason: null,
      plan: {
        reuse: [],
        create: [],
        screens: [],
        status: 'proposed',
        labels: {},
        proposedAt: NOW as never,
        confirmedAt: null,
        confirmedBy: null,
        key: 'a-key',
        reusedFrom: 'job-earlier',
      },
      review: { reason: 'plan', message: 'Review the plan.', findings: [] },
    }))
    const job = await newInsightJob()
    const run = await runAiJobStep(firestore, ORG, job.$id, { owner: 'route-1', now: NOW })
    expect(run.outcome).toBe('needs_review')
    const stored = await getAiJob(firestore, ORG, job.$id)
    expect(stored).toMatchObject({ status: 'needs_review', creditsSpent: 0 })
    expect(stored?.plan).toMatchObject({ reusedFrom: 'job-earlier', key: 'a-key' })
    // A step that ran no model adds no run to the token measure.
    expect(stored?.steps[0]).toMatchObject({ status: 'done', creditsSpent: 0 })
    expect(stored?.steps[0].tokens).toBeUndefined()
    const month = mockDocs.get(`orgs/${ORG}/assistUsage/${assistUsageMonth(NOW)}`) ?? {}
    expect(Number(month['messages'] ?? 0)).toBe(0)
    expect(Number(month['estCostUsd'] ?? 0)).toBe(0)
  })

  it('fails after an unusable answer: metered first, then failed with the step’s sentence and no output', async () => {
    registerAiJobStep('insight', async () => ({
      outputs: [],
      usage: USAGE,
      estCostUsd: 0.006,
      model: 'claude-sonnet-5',
      stopReason: 'end_turn',
      failure: 'Nothing usable came back.',
    }))
    const job = await newInsightJob()
    const run = await runAiJobStep(firestore, ORG, job.$id, { owner: 'route-1', now: NOW })
    expect(run.outcome).toBe('failed')
    const stored = await getAiJob(firestore, ORG, job.$id)
    expect(stored).toMatchObject({ status: 'failed', error: 'Nothing usable came back.', creditsSpent: 6 })
    expect(mockDocs.get(`orgs/${ORG}/assistUsage/${assistUsageMonth(NOW)}`)).toMatchObject({
      messages: 1,
      estCostUsd: 0.006,
    })
    expect(mockAiActivity.logAiJobOutput).not.toHaveBeenCalled()
  })

  it('has a runner for theme jobs, and tells a step that spent nothing from one that did', () => {
    expect(aiJobStepRunnerFor('theme')).not.toBeNull()
    expect(aiJobStepSpentNothing({ usage: ZERO, estCostUsd: 0 })).toBe(true)
    expect(aiJobStepSpentNothing({ usage: { ...ZERO, cacheReadTokens: 1 }, estCostUsd: 0 })).toBe(false)
    expect(aiJobStepSpentNothing({ usage: ZERO, estCostUsd: 0.000001 })).toBe(false)
  })
})

describe('the activity log (AGL-2929)', () => {
  const BRIEF = 'A two-line tagline for a coffee roaster.'

  it('a created job is one row for its creator, naming the kind and the brief length, never the brief', async () => {
    const job = await createAiJob(
      firestore,
      {
        orgId: ORG,
        hostId: 'host-1',
        kind: 'text',
        brief: BRIEF,
        createdBy: 'uid-1',
        createdByEmail: 'ada@example.test',
      },
      NOW,
    )
    expect(mockAiActivity.logAiJobCreated).toHaveBeenCalledTimes(1)
    expect(mockAiActivity.logAiJobCreated).toHaveBeenCalledWith(
      ORG,
      { uid: 'uid-1', email: 'ada@example.test' },
      { jobId: job.$id, kind: 'text', briefLength: BRIEF.length, hostId: 'host-1' },
    )
    expect(JSON.stringify(mockAiActivity.logAiJobCreated.mock.calls)).not.toContain('coffee')
  })

  it('every output is one row: credited to the creator when the beat ran the step, to the person on the request when a route did', async () => {
    armCompletion()
    const byBeat = await newTextJob()
    await runAiJobStep(firestore, ORG, byBeat.$id, { owner: 'beat', now: NOW })
    expect(mockAiActivity.logAiJobOutput).toHaveBeenCalledTimes(1)
    expect(mockAiActivity.logAiJobOutput).toHaveBeenCalledWith(
      ORG,
      // The beat has no caller; the creator, whose brief it is, is named —
      // never nobody.
      { uid: 'uid-1' },
      {
        jobId: byBeat.$id,
        hostId: 'host-1',
        resource: { type: 'content', id: 'draft', name: 'Draft copy', versionId: null },
      },
    )
    // The label names the output; the generated text is the site's content.
    expect(JSON.stringify(mockAiActivity.logAiJobOutput.mock.calls)).not.toContain('Fresh coffee')

    armCompletion()
    const byRoute = await newTextJob()
    await runAiJobStep(firestore, ORG, byRoute.$id, {
      owner: 'route',
      now: NOW,
      actor: { uid: 'uid-1', email: 'ada@example.test' },
    })
    expect(mockAiActivity.logAiJobOutput).toHaveBeenCalledTimes(2)
    expect(mockAiActivity.logAiJobOutput.mock.calls[1][1]).toEqual({
      uid: 'uid-1',
      email: 'ada@example.test',
    })
  })

  it('a refused reservation is a needs_input row with the meter’s reason and no actor', async () => {
    const job = await newTextJob({ orgId: 'org-free' })
    // The platform's day of free spend at its ceiling (AGL-2925): the one
    // rung that refuses a Free workspace's generation until the day rolls.
    mockDocs.set(`platformAiFreeSpend/${assistUsageDay(NOW)}`, { estCostUsd: 25 })
    await runAiJobStep(firestore, 'org-free', job.$id, { owner: 'beat', now: NOW })
    expect(mockAiActivity.logAiJobNeedsInput).toHaveBeenCalledTimes(1)
    expect(mockAiActivity.logAiJobNeedsInput).toHaveBeenCalledWith(
      'org-free',
      { uid: null },
      { jobId: job.$id, kind: 'text', reason: 'platform' },
    )
    expect(mockAiActivity.logAiJobOutput).not.toHaveBeenCalled()

    // Rested an hour, still the same UTC day, so the beat re-queues it and
    // the meter refuses it again for the same reason: parked again, but
    // not a second row — the feed says a job paused, not that it is paused
    // every hour.
    const retried = await sweepAiJobs({
      firestore,
      owner: 'beat',
      now: () => NOW.getTime() + AI_JOB_NEEDS_INPUT_RETRY_MS,
    })
    expect(retried.ran).toBe(1)
    expect((await getAiJob(firestore, 'org-free', job.$id))?.status).toBe('needs_input')
    expect(mockAiActivity.logAiJobNeedsInput).toHaveBeenCalledTimes(1)
  })

  it('a cancel that changed the job is one row for the member who canceled; a second cancel writes nothing', async () => {
    const job = await newTextJob()
    const bo = { uid: 'uid-2', email: 'bo@example.test' }
    await cancelAiJob(firestore, ORG, job.$id, NOW, bo)
    expect(mockAiActivity.logAiJobCanceled).toHaveBeenCalledTimes(1)
    expect(mockAiActivity.logAiJobCanceled).toHaveBeenCalledWith(ORG, bo, {
      jobId: job.$id,
      kind: 'text',
    })
    await cancelAiJob(firestore, ORG, job.$id, NOW, bo)
    expect(mockAiActivity.logAiJobCanceled).toHaveBeenCalledTimes(1)
  })
})

describe('terminal transitions', () => {
  it('cancel is idempotent and a terminal job stays where it is', async () => {
    const job = await newTextJob()
    expect((await cancelAiJob(firestore, ORG, job.$id, NOW)).changed).toBe(true)
    expect((await cancelAiJob(firestore, ORG, job.$id, NOW)).changed).toBe(false)
    expect((await completeAiJob(firestore, ORG, job.$id, NOW)).status).toBe('canceled')
    expect(
      (await failAiJob(firestore, ORG, job.$id, 'no', undefined, NOW)).status,
    ).toBe('canceled')
  })

  it('failAiJob keeps the provider detail out of the document and in the log', async () => {
    const job = await newTextJob()
    await claimNextStep(firestore, ORG, job.$id, 'beat', NOW)
    await failAiJob(
      firestore, ORG, job.$id, AI_UPSTREAM_FAILURE_COPY,
      { stepIndex: 0, error: new Error('anthropic: invalid x-api-key') },
      NOW,
    )
    const stored = await getAiJob(firestore, ORG, job.$id)
    expect(JSON.stringify(stored)).not.toContain('x-api-key')
    expect(stored?.steps[0]).toMatchObject({ status: 'failed', error: AI_UPSTREAM_FAILURE_COPY })
    expect(console.error).toHaveBeenCalledWith(
      'ai job failed',
      expect.objectContaining({ orgId: ORG, jobId: job.$id, error: 'anthropic: invalid x-api-key' }),
    )
  })
})

describe('listAiJobs and the summary', () => {
  it('lists newest first, filters by status, and never leaks the lease itself', async () => {
    const older = await createAiJob(
      firestore,
      { orgId: ORG, kind: 'text', brief: 'one', createdBy: 'u' },
      new Date(NOW.getTime() - 60_000),
    )
    const newer = await newTextJob()
    await cancelAiJob(firestore, ORG, older.$id, NOW)
    const all = await listAiJobs(firestore, ORG)
    expect(all.map((job) => job.$id)).toEqual([newer.$id, older.$id])
    const canceled = await listAiJobs(firestore, ORG, { status: 'canceled' })
    expect(canceled.map((job) => job.$id)).toEqual([older.$id])

    await claimNextStep(firestore, ORG, newer.$id, 'beat', NOW)
    const summary = aiJobSummary((await getAiJob(firestore, ORG, newer.$id)) as never, NOW)
    expect(summary).toMatchObject({
      id: newer.$id,
      status: 'running',
      running: true,
      createdAt: NOW.toISOString(),
    })
    expect(summary).not.toHaveProperty('lease')
    expect(summary.steps[0].startedAt).toBe(NOW.toISOString())
  })
})

describe('aiJobRefusalText', () => {
  const base = { budgetUsd: 40 }
  it('names each ceiling in its own words', () => {
    expect(aiJobRefusalText({}, { ...base, refusedBy: 'messages' })).toContain('AI limit')
    expect(aiJobRefusalText({}, { ...base, refusedBy: 'band' })).toContain('credits')
    expect(aiJobRefusalText({}, { ...base, refusedBy: 'budget', budgetUsd: null })).toContain(
      'spending limit',
    )
    expect(aiJobRefusalText({}, { ...base, refusedBy: 'cap' })).toContain(
      'spending cap',
    )
  })
})

describe('a step’s own failure, a step that continues, and an apply (AGL-2910)', () => {
  const ZERO = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }

  /** One pass of a runner that works through a list. */
  const pass = (n: number, more: boolean) => ({
    outputs: [{ resource: 'text' as const, id: `pass-${n}`, hostId: 'host-1', label: `Pass ${n}`, text: `Pass ${n}` }],
    usage: USAGE,
    estCostUsd: 0.006,
    model: 'claude-sonnet-5',
    stopReason: 'tool_use',
    ...(more ? { continue: true } : {}),
  })

  const newInsightJob = () =>
    createAiJob(
      firestore,
      { orgId: ORG, hostId: 'host-1', kind: 'insight', brief: 'Work through the list.', createdBy: 'uid-1' },
      NOW,
    )

  const later = (seconds: number) => new Date(NOW.getTime() + seconds * 1_000)

  it('hands the runner the machine’s Firestore and the org it reserved against', async () => {
    const contexts: Array<Record<string, unknown>> = []
    registerAiJobStep('insight', async (context) => {
      contexts.push(context as unknown as Record<string, unknown>)
      return pass(1, false)
    })
    const job = await newInsightJob()
    await runAiJobStep(firestore, ORG, job.$id, { owner: 'route-1', now: NOW })
    expect(contexts[0]['firestore']).toBe(firestore)
    expect(contexts[0]['org']).toMatchObject({ plan: 'pro' })
  })

  it('records each pass — its cost, credits and outputs — and hands the same step back until the runner is done', async () => {
    let calls = 0
    registerAiJobStep('insight', async () => {
      calls += 1
      return pass(calls, calls < 3)
    })
    const job = await newInsightJob()

    const first = await runAiJobStep(firestore, ORG, job.$id, { owner: 'route-1', now: NOW })
    expect(first).toMatchObject({ outcome: 'done', job: { status: 'queued' } })
    let stored = await getAiJob(firestore, ORG, job.$id)
    expect(stored?.steps[0]).toMatchObject({ status: 'pending', attempts: 0, passes: 1, creditsSpent: 6, endedAt: null })
    expect(stored).toMatchObject({ creditsSpent: 6, creditsReserved: AI_JOB_STEP_RESERVE_CREDITS, lease: null })
    expect(stored?.outputs.map((output) => output.id)).toEqual(['pass-1'])

    await runAiJobStep(firestore, ORG, job.$id, { owner: 'beat-a', now: later(60) })
    const last = await runAiJobStep(firestore, ORG, job.$id, { owner: 'beat-b', now: later(120) })
    expect(last).toMatchObject({ outcome: 'done', job: { status: 'done' } })
    stored = await getAiJob(firestore, ORG, job.$id)
    expect(stored?.steps[0]).toMatchObject({ status: 'done', passes: 2, creditsSpent: 18 })
    expect(stored).toMatchObject({ status: 'done', creditsSpent: 18, creditsReserved: 0 })
    expect(stored?.outputs.map((output) => output.id)).toEqual(['pass-1', 'pass-2', 'pass-3'])
    // Every pass is one metered exchange, and every output one activity row.
    const month = mockDocs.get(`orgs/${ORG}/assistUsage/${assistUsageMonth(NOW)}`) ?? {}
    expect(month['messages']).toBe(3)
    expect(Number(month['estCostUsd'])).toBeCloseTo(0.018, 6)
    expect(mockAiActivity.logAiJobOutput).toHaveBeenCalledTimes(3)
  })

  it('stops at the pass cap: that pass is the step’s last, and what it produced stands', async () => {
    registerAiJobStep('insight', async () => pass(99, true))
    const job = await newInsightJob()
    const path = `orgs/${ORG}/aiJobs/${job.$id}`
    const doc = mockDocs.get(path) as { steps: Array<Record<string, unknown>> }
    mockDocs.set(path, { ...doc, steps: [{ ...doc.steps[0], passes: AI_JOB_STEP_MAX_PASSES - 1 }] })
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const run = await runAiJobStep(firestore, ORG, job.$id, { owner: 'route-1', now: NOW })
    expect(run).toMatchObject({ outcome: 'done', job: { status: 'done' } })
    expect((await getAiJob(firestore, ORG, job.$id))?.outputs.map((output) => output.id)).toEqual(['pass-99'])
    expect(warn).toHaveBeenCalled()
  })

  it('fails before the provider: the message goes back, nothing is metered, and the job carries the step’s sentence', async () => {
    registerAiJobStep('insight', async () => ({
      outputs: [],
      usage: ZERO,
      estCostUsd: 0,
      model: 'claude-sonnet-5',
      stopReason: null,
      failure: 'This page is no longer on the site.',
    }))
    const job = await newInsightJob()
    const run = await runAiJobStep(firestore, ORG, job.$id, { owner: 'route-1', now: NOW })
    expect(run.outcome).toBe('failed')
    expect(await getAiJob(firestore, ORG, job.$id)).toMatchObject({
      status: 'failed',
      error: 'This page is no longer on the site.',
      creditsSpent: 0,
    })
    const month = mockDocs.get(`orgs/${ORG}/assistUsage/${assistUsageMonth(NOW)}`) ?? {}
    expect(Number(month['messages'] ?? 0)).toBe(0)
    expect(Number(month['estCostUsd'] ?? 0)).toBe(0)
  })

  it('fails after an unusable answer: metered first, then failed with the step’s sentence and no output', async () => {
    registerAiJobStep('insight', async () => ({ ...pass(1, false), outputs: [], failure: 'Nothing usable came back.' }))
    const job = await newInsightJob()
    const run = await runAiJobStep(firestore, ORG, job.$id, { owner: 'route-1', now: NOW })
    expect(run.outcome).toBe('failed')
    expect(await getAiJob(firestore, ORG, job.$id)).toMatchObject({
      status: 'failed',
      error: 'Nothing usable came back.',
      creditsSpent: 6,
    })
    expect(mockDocs.get(`orgs/${ORG}/assistUsage/${assistUsageMonth(NOW)}`)).toMatchObject({ messages: 1 })
    expect(mockAiActivity.logAiJobOutput).not.toHaveBeenCalled()
  })

  it('tells a step that spent nothing from one that did', () => {
    expect(aiJobStepSpentNothing({ usage: ZERO, estCostUsd: 0 })).toBe(true)
    expect(aiJobStepSpentNothing({ usage: { ...ZERO, cacheReadTokens: 1 }, estCostUsd: 0 })).toBe(false)
    expect(aiJobStepSpentNothing({ usage: ZERO, estCostUsd: 0.000001 })).toBe(false)
  })

  it('records an apply without touching the job’s status, steps or spend, and the summary carries it', async () => {
    registerAiJobStep('insight', async () => pass(1, false))
    const job = await newInsightJob()
    await runAiJobStep(firestore, ORG, job.$id, { owner: 'route-1', now: NOW })
    const before = await getAiJob(firestore, ORG, job.$id)
    const after = await recordAiJobApplied(
      firestore,
      ORG,
      job.$id,
      { at: later(300) as never, by: 'uid-2', versions: { s1: 'v2' }, staged: ['s1'] },
      later(300),
    )
    expect(after).toMatchObject({
      status: before?.status,
      steps: before?.steps,
      outputs: before?.outputs,
      creditsSpent: before?.creditsSpent,
    })
    expect(aiJobSummary(after).applied).toEqual({
      at: later(300).toISOString(),
      by: 'uid-2',
      versions: { s1: 'v2' },
      staged: ['s1'],
    })
  })
})

describe('sweepAiJobs — the beat', () => {
  it('stops at the wall clock, always attempts at least one job, and reports what it left', async () => {
    let clock = 0
    const ran: string[] = []
    const result = await sweepAiJobs({
      firestore,
      owner: 'beat',
      now: () => clock,
      budgetMs: 45_000,
      listDue: async () => [
        { orgId: ORG, jobId: 'a' },
        { orgId: ORG, jobId: 'b' },
        { orgId: ORG, jobId: 'c' },
      ],
      runStep: async (_orgId, jobId) => {
        ran.push(jobId)
        // Each step costs 30 s of the 45 s budget.
        clock += 30_000
        return { outcome: 'done', job: {} as never }
      },
    })
    expect(ran).toEqual(['a', 'b'])
    expect(result).toEqual({
      due: 3,
      ran: 2,
      skipped: 0,
      remaining: 1,
      budgetExhausted: true,
    })
  })

  it('attempts the first job even when the clock is already past the budget', async () => {
    const ran: string[] = []
    const result = await sweepAiJobs({
      firestore,
      owner: 'beat',
      now: () => 0,
      budgetMs: 0,
      listDue: async () => [{ orgId: ORG, jobId: 'a' }, { orgId: ORG, jobId: 'b' }],
      runStep: async (_orgId, jobId) => {
        ran.push(jobId)
        return { outcome: 'not-claimable' }
      },
    })
    expect(ran).toEqual(['a'])
    expect(result.skipped).toBe(1)
    expect(result.budgetExhausted).toBe(true)
  })

  it('hands the step the time that is left as its abort signal', async () => {
    let clock = 0
    const signals: Array<AbortSignal | undefined> = []
    await sweepAiJobs({
      firestore,
      owner: 'beat',
      now: () => clock,
      budgetMs: 45_000,
      listDue: async () => [{ orgId: ORG, jobId: 'a' }],
      runStep: async (_orgId, _jobId, options) => {
        signals.push(options.signal)
        clock += 1
        return { outcome: 'done', job: {} as never }
      },
    })
    expect(signals[0]).toBeInstanceOf(AbortSignal)
  })

  it('reads queued and running jobs across every org, and a stale lease is claimed by the next beat', async () => {
    armCompletion()
    const mine = await newTextJob()
    mockDocs.set('orgs/org-two', { plan: 'pro' })
    const theirs = await newTextJob({ orgId: 'org-two' })
    // A step abandoned by a frozen process: running, lease long expired.
    await claimNextStep(firestore, ORG, mine.$id, 'dead-route', new Date(NOW.getTime() - 10 * 60_000))
    const later = new Date(NOW.getTime() + 60_000)
    const result = await sweepAiJobs({
      firestore,
      owner: 'beat-2',
      now: () => later.getTime(),
    })
    expect(result.due).toBe(2)
    expect(result.ran).toBe(2)
    expect((await getAiJob(firestore, ORG, mine.$id))?.status).toBe('done')
    expect((await getAiJob(firestore, 'org-two', theirs.$id))?.status).toBe('done')
  })

  it('skips a job whose lease another beat still holds', async () => {
    armCompletion()
    const job = await newTextJob()
    await claimNextStep(firestore, ORG, job.$id, 'beat-1', NOW)
    const result = await sweepAiJobs({
      firestore,
      owner: 'beat-2',
      now: () => NOW.getTime() + 1_000,
    })
    expect(result).toMatchObject({ due: 1, ran: 0, skipped: 1 })
    expect(mockRunAiRequest).not.toHaveBeenCalled()
  })

  it('re-queues a needs_input job only once it has rested, then lets the reservation decide', async () => {
    const job = await newTextJob({ orgId: 'org-free' })
    // The platform's free-spend ceiling for TODAY (AGL-2925) — a refusal
    // keyed on the UTC day, so a rolled day is a fresh document.
    mockDocs.set(`platformAiFreeSpend/${assistUsageDay(NOW)}`, { estCostUsd: 25 })
    await runAiJobStep(firestore, 'org-free', job.$id, { owner: 'beat', now: NOW })
    expect((await getAiJob(firestore, 'org-free', job.$id))?.status).toBe('needs_input')

    const early = await sweepAiJobs({
      firestore,
      owner: 'beat',
      now: () => NOW.getTime() + AI_JOB_NEEDS_INPUT_RETRY_MS - 1,
    })
    expect(early.due).toBe(0)

    // Rested, and the UTC day has rolled over so the free daily counter is
    // a fresh key: the reservation now succeeds.
    armCompletion()
    const rested = new Date(NOW.getTime() + 24 * 60 * 60_000)
    const result = await sweepAiJobs({
      firestore,
      owner: 'beat',
      now: () => rested.getTime(),
    })
    expect(result.ran).toBe(1)
    expect((await getAiJob(firestore, 'org-free', job.$id))?.status).toBe('done')
  })
})

describe('planned kinds, and a job that waits for a person (AGL-2935)', () => {
  const planRunner = jest.fn()
  const siteRunner = jest.fn()
  const spend = { usage: USAGE, estCostUsd: 0.006, model: 'claude-sonnet-5', stopReason: 'tool_use' }
  const LATER = new Date(NOW.getTime() + 60_000)
  const proposedOutcome = () => ({
    outputs: [],
    ...spend,
    plan: {
      reuse: [],
      create: [],
      screens: [],
      status: 'proposed' as const,
      labels: {},
      proposedAt: NOW,
      confirmedAt: null,
      confirmedBy: null,
    },
    review: { reason: 'plan' as const, message: 'The plan is ready.', findings: [] },
  })
  const doctrineOutcome = () => ({
    outputs: [],
    ...spend,
    review: {
      reason: 'doctrine' as const,
      message: 'This could not be built within the building rules.',
      findings: [{ rule: 2, code: 'plan-screen-without-layout', message: 'A screen names no layout.' }],
    },
  })

  // A planned kind no other test in this file creates, so its runner changes
  // no other kind's path.
  beforeAll(() => registerAiJobStep('site', (context) => siteRunner(context)))
  beforeEach(() => {
    planRunner.mockReset()
    siteRunner.mockReset()
    registerAiJobPlanStep((context) => planRunner(context))
  })
  afterEach(() => registerAiJobPlanStep(null))

  const newSiteJob = () =>
    createAiJob(
      firestore,
      { orgId: ORG, hostId: 'host-1', kind: 'site', brief: 'A three-page site for a roofer.', createdBy: 'uid-1' },
      NOW,
    )

  it('plans first only once something can build the plan, and only for a kind that builds structure', () => {
    expect(aiJobStepNames('site')).toEqual([AI_JOB_PLAN_STEP, 'generate'])
    registerAiJobPlanStep(null)
    expect(aiJobStepNames('site')).toEqual(['generate'])
    registerAiJobPlanStep((context) => planRunner(context))
    // Planned, but nothing builds it yet: it fails fast and free, as before.
    expect(aiJobStepNames('page')).toEqual(['generate'])
    expect(aiJobStepNames('seo')).toEqual(['generate'])
    expect(aiJobStepNames('text')).toEqual(['draft'])
  })

  it('parks a proposed plan for review in the write that records the step, and the beat never picks it up', async () => {
    planRunner.mockResolvedValue(proposedOutcome())
    const job = await newSiteJob()
    expect(job.steps.map((step) => step.name)).toEqual([AI_JOB_PLAN_STEP, 'generate'])
    const run = await runAiJobStep(firestore, ORG, job.$id, { owner: 'route-1', now: NOW })
    expect(run.outcome).toBe('needs_review')
    expect(planRunner).toHaveBeenCalledWith(expect.objectContaining({ stepIndex: 0, firestore }))
    expect(siteRunner).not.toHaveBeenCalled()

    const stored = await getAiJob(firestore, ORG, job.$id)
    expect(stored).toMatchObject({
      status: 'needs_review',
      error: null,
      lease: null,
      creditsSpent: 6,
      // Parked for a person, the job shows nothing held (AGL-3030).
      creditsReserved: 0,
      plan: { status: 'proposed', confirmedAt: null },
      review: { reason: 'plan' },
    })
    // And holds nothing real: the plan step's one message is spent and its
    // cost metered, and no reservation stands open behind the review.
    const month = mockDocs.get(`orgs/${ORG}/assistUsage/${assistUsageMonth(NOW)}`) ?? {}
    expect(month['messages']).toBe(1)
    expect(Number(month['estCostUsd'])).toBeCloseTo(0.006, 6)
    expect(stored?.steps.map((step) => step.status)).toEqual(['done', 'pending'])
    expect(mockAiActivity.logAiJobNeedsInput).toHaveBeenCalledWith(ORG, { uid: null }, {
      jobId: job.$id,
      kind: 'site',
      reason: 'plan',
    })
    expect(aiJobSummary(stored as NonNullable<typeof stored>, NOW)).toMatchObject({
      status: 'needs_review',
      plan: { status: 'proposed', proposedAt: NOW.toISOString(), confirmedAt: null, confirmedBy: null },
      review: { reason: 'plan', message: 'The plan is ready.' },
    })

    // However long it rests, a job waiting for a person is in neither query.
    const week = await sweepAiJobs({
      firestore,
      owner: 'beat',
      now: () => NOW.getTime() + 7 * 24 * 60 * 60_000,
    })
    expect(week.due).toBe(0)
    expect(planRunner).toHaveBeenCalledTimes(1)
  })

  it('confirming runs the generation step on the confirmed plan, once', async () => {
    planRunner.mockResolvedValue(proposedOutcome())
    const job = await newSiteJob()
    await runAiJobStep(firestore, ORG, job.$id, { owner: 'route-1', now: NOW })

    const resumed = await resumeAiJob(firestore, ORG, job.$id, { uid: 'uid-2' }, LATER)
    expect(resumed.changed).toBe(true)
    expect(resumed.job).toMatchObject({
      status: 'queued',
      review: null,
      error: null,
      plan: { status: 'confirmed', confirmedBy: 'uid-2', confirmedAt: LATER },
      // The step the confirmation queues is held again.
      creditsReserved: AI_JOB_STEP_RESERVE_CREDITS,
    })
    expect((await resumeAiJob(firestore, ORG, job.$id, { uid: 'uid-2' }, LATER)).changed).toBe(false)

    siteRunner.mockResolvedValue({
      outputs: [{ resource: 'screen', id: 'scr-new', versionId: 'v-1', hostId: 'host-1', label: 'Home' }],
      ...spend,
    })
    const run = await runAiJobStep(firestore, ORG, job.$id, { owner: 'beat', now: LATER })
    expect(run.outcome).toBe('done')
    expect(siteRunner.mock.calls[0][0].job.plan).toMatchObject({ status: 'confirmed' })
    expect(await getAiJob(firestore, ORG, job.$id)).toMatchObject({
      status: 'done',
      creditsSpent: 12,
      creditsReserved: 0,
    })
  })

  it('holds a confirmed plan at what the whole job is estimated to cost, where that is more than its steps (AGL-3031)', async () => {
    const screen = {
      title: 'Home',
      slug: 'home',
      layout: 'new:Frame',
      template: null,
      duplicateOf: null,
      nav: true,
      seoTitle: 'Home',
      seoDescription: 'The home page',
      sections: [
        { name: 'hero', uses: [], items: 0 },
        { name: 'services', uses: [], items: 0 },
      ],
    }
    const plan = {
      ...proposedOutcome().plan,
      create: [{ kind: 'layout' as const, name: 'Frame', why: 'every page', duplicateOf: null, fields: [] }],
      screens: [screen, { ...screen, slug: 'about' }],
    }
    planRunner.mockResolvedValue({ ...proposedOutcome(), plan })
    const job = await newSiteJob()
    await runAiJobStep(firestore, ORG, job.$id, { owner: 'route-1', now: NOW })
    const resumed = await resumeAiJob(firestore, ORG, job.$id, { uid: 'uid-2' }, LATER)
    // Two screens of two sections and their last passes, and the layout.
    expect(aiJobPlanCreditEstimate('site', plan)).toBe((2 * (2 + 1) + 1) * AI_JOB_STEP_RESERVE_CREDITS)
    expect(resumed.job.creditsReserved).toBe(aiJobPlanCreditEstimate('site', plan))
  })

  it('hands back a step whose answer broke a rule twice, with its spend, and trying again runs it once more', async () => {
    planRunner.mockResolvedValueOnce(doctrineOutcome()).mockResolvedValueOnce(proposedOutcome())
    const job = await newSiteJob()
    expect((await runAiJobStep(firestore, ORG, job.$id, { owner: 'route-1', now: NOW })).outcome).toBe(
      'needs_review',
    )
    const parked = await getAiJob(firestore, ORG, job.$id)
    expect(parked).toMatchObject({
      status: 'needs_review',
      error: 'This could not be built within the building rules.',
      creditsSpent: 6,
      creditsReserved: 0,
      review: { reason: 'doctrine', findings: [{ rule: 2, code: 'plan-screen-without-layout' }] },
    })
    expect(parked?.plan).toBeUndefined()
    expect(parked?.steps[0]).toMatchObject({
      name: AI_JOB_PLAN_STEP,
      status: 'pending',
      creditsSpent: 6,
      attempts: 1,
    })
    expect(mockAiActivity.logAiJobNeedsInput).toHaveBeenCalledWith(ORG, { uid: null }, {
      jobId: job.$id,
      kind: 'site',
      reason: 'doctrine',
    })

    const resumed = await resumeAiJob(firestore, ORG, job.$id, { uid: 'uid-1' }, LATER)
    // Trying again holds both steps the plan's retry queues ahead of.
    expect(resumed.job).toMatchObject({
      status: 'queued',
      error: null,
      review: null,
      creditsReserved: 2 * AI_JOB_STEP_RESERVE_CREDITS,
    })
    expect(resumed.job.steps[0]).toMatchObject({ status: 'pending', attempts: 0 })

    expect((await runAiJobStep(firestore, ORG, job.$id, { owner: 'route-2', now: LATER })).outcome).toBe(
      'needs_review',
    )
    expect(planRunner).toHaveBeenCalledTimes(2)
    expect(await getAiJob(firestore, ORG, job.$id)).toMatchObject({
      creditsSpent: 12,
      plan: { status: 'proposed' },
      review: { reason: 'plan' },
    })
  })

  it('hands back a step stopped at a site allowance with its sentence, and trying again runs it once more (AGL-2909)', async () => {
    const limit = 'Your plan includes 1 shared layouts — upgrade in Billing for more'
    planRunner.mockResolvedValue(proposedOutcome())
    const job = await newSiteJob()
    await runAiJobStep(firestore, ORG, job.$id, { owner: 'route-1', now: NOW })
    await resumeAiJob(firestore, ORG, job.$id, { uid: 'uid-1' }, LATER)

    siteRunner
      .mockResolvedValueOnce({
        outputs: [],
        ...spend,
        review: { reason: 'limit', message: limit, findings: [] },
      })
      .mockResolvedValueOnce({
        outputs: [{ resource: 'layout', id: 'lay-new', versionId: 'v-1', hostId: 'host-1', label: 'Main layout' }],
        ...spend,
      })
    expect((await runAiJobStep(firestore, ORG, job.$id, { owner: 'beat', now: LATER })).outcome).toBe(
      'needs_review',
    )
    const parked = await getAiJob(firestore, ORG, job.$id)
    expect(parked).toMatchObject({
      status: 'needs_review',
      error: limit,
      creditsSpent: 12,
      review: { reason: 'limit', message: limit, findings: [] },
      plan: { status: 'confirmed', confirmedBy: 'uid-1' },
    })
    expect(parked?.steps.map((step) => step.status)).toEqual(['done', 'pending'])
    expect(mockAiActivity.logAiJobNeedsInput).toHaveBeenCalledWith(ORG, { uid: null }, {
      jobId: job.$id,
      kind: 'site',
      reason: 'limit',
    })

    const resumed = await resumeAiJob(firestore, ORG, job.$id, { uid: 'uid-2' }, LATER)
    expect(resumed.job).toMatchObject({
      status: 'queued',
      error: null,
      review: null,
      // Trying again is not confirming again: the plan keeps who confirmed it.
      plan: { status: 'confirmed', confirmedBy: 'uid-1' },
    })
    expect((await runAiJobStep(firestore, ORG, job.$id, { owner: 'beat', now: LATER })).outcome).toBe('done')
    expect(siteRunner).toHaveBeenCalledTimes(2)
    expect(await getAiJob(firestore, ORG, job.$id)).toMatchObject({
      status: 'done',
      creditsSpent: 18,
      outputs: [expect.objectContaining({ resource: 'layout', id: 'lay-new' })],
    })
  })

  it('changes nothing for a job that is not waiting for a person', async () => {
    const job = await newTextJob()
    expect((await resumeAiJob(firestore, ORG, job.$id, { uid: 'uid-1' }, NOW)).changed).toBe(false)
    expect((await getAiJob(firestore, ORG, job.$id))?.status).toBe('queued')
  })
})

describe('a step’s tokens (AGL-2937)', () => {
  it('records the four counts, the model, the effort and the runner’s time on the step it ran', async () => {
    armCompletion()
    const job = await newTextJob()
    await runAiJobStep(firestore, ORG, job.$id, { owner: 'route-1', now: NOW })
    const tokens = (await getAiJob(firestore, ORG, job.$id))?.steps[0].tokens
    expect(tokens).toMatchObject({
      input: 1_000,
      cachedRead: 0,
      cacheWrite: 0,
      output: 200,
      model: mockRunAiRequest.mock.calls[0][0].model,
      // The text step names no thinking effort.
      effort: null,
      runs: 1,
    })
    expect(tokens?.latencyMs).toEqual(expect.any(Number))
    expect(tokens?.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('records nothing for a run that never reached the provider', async () => {
    mockRunAiRequest.mockRejectedValue(new AiUpstreamError(529, true, 'req-1'))
    const job = await newTextJob()
    const run = await runAiJobStep(firestore, ORG, job.$id, { owner: 'route-1', now: NOW })
    expect(run.outcome).toBe('requeued')
    expect((await getAiJob(firestore, ORG, job.$id))?.steps[0].tokens).toBeUndefined()
  })

  it('sums a second run into the first, and keeps the last run’s model and effort', () => {
    const first = addAiJobStepTokens(undefined, {
      usage: { inputTokens: 900, outputTokens: 400, cacheReadTokens: 3_000, cacheWriteTokens: 3_400 },
      model: 'model-a',
      effort: 'high',
      latencyMs: 4_200,
    })
    expect(
      addAiJobStepTokens(first, {
        usage: { inputTokens: 1_000, outputTokens: 350, cacheReadTokens: 6_400, cacheWriteTokens: 0 },
        model: 'model-b',
        effort: null,
        latencyMs: 3_800,
      }),
    ).toEqual({
      input: 1_900,
      cachedRead: 9_400,
      cacheWrite: 3_400,
      output: 750,
      model: 'model-b',
      effort: null,
      latencyMs: 8_000,
      runs: 2,
    })
  })
})

describe('a step that says how long it needs (AGL-2907)', () => {
  const timedRunner = jest.fn()
  // A kind no other test in this file creates, so its minimum changes no other path.
  beforeAll(() => registerAiJobStep('insight', (context) => timedRunner(context), { minimumMs: 20_000 }))
  afterAll(() => registerAiJobStep('insight', (context) => timedRunner(context)))

  const newTimedJob = () =>
    createAiJob(
      firestore,
      { orgId: ORG, hostId: 'host-1', kind: 'insight', brief: 'What changed on the site this month.', createdBy: 'uid-1' },
      NOW,
    )
  const jobOf = async (jobId: string) => (await getAiJob(firestore, ORG, jobId)) as never

  it('records the least time a kind’s own step needs, not for the plan step, and clears it on re-registration', async () => {
    expect(aiJobStepMinimumMs('insight', 'generate')).toBe(20_000)
    expect(aiJobStepMinimumMs('insight', AI_JOB_PLAN_STEP)).toBe(0)
    expect(aiJobStepMinimumMs('text', 'draft')).toBe(0)
    expect(aiJobNextStepMinimumMs(await newTimedJob())).toBe(20_000)
    expect(aiJobNextStepMinimumMs(await newTextJob())).toBe(0)
    registerAiJobStep('insight', (context) => timedRunner(context))
    expect(aiJobStepMinimumMs('insight', 'generate')).toBe(0)
    registerAiJobStep('insight', (context) => timedRunner(context), { minimumMs: 20_000 })
  })

  it('keeps the plan step’s least time by the step, for every kind that plans, and clears it with the runner (AGL-3026)', () => {
    const planRunner = jest.fn()
    const planned = (kind: string, next: string) =>
      ({
        kind,
        steps: [
          { name: AI_JOB_PLAN_STEP, status: next === AI_JOB_PLAN_STEP ? 'pending' : 'done' },
          { name: 'generate', status: 'pending' },
        ],
      }) as never
    try {
      registerAiJobPlanStep((context) => planRunner(context), { minimumMs: 30_000 })
      // One step every planned kind shares, so one minimum, whatever the kind.
      expect(aiJobStepMinimumMs('page', AI_JOB_PLAN_STEP)).toBe(30_000)
      expect(aiJobStepMinimumMs('form', AI_JOB_PLAN_STEP)).toBe(30_000)
      expect(aiJobNextStepMinimumMs(planned('form', AI_JOB_PLAN_STEP))).toBe(30_000)
      // A kind's own step keeps its own, and the plan's reaches no other step.
      expect(aiJobStepMinimumMs('insight', 'generate')).toBe(20_000)
      expect(aiJobNextStepMinimumMs(planned('form', 'generate'))).toBe(0)
      expect(aiJobStepMinimumMs('text', 'draft')).toBe(0)
      // Registering again without one clears it, and so does unregistering.
      registerAiJobPlanStep((context) => planRunner(context))
      expect(aiJobStepMinimumMs('page', AI_JOB_PLAN_STEP)).toBe(0)
      registerAiJobPlanStep((context) => planRunner(context), { minimumMs: 30_000 })
      registerAiJobPlanStep(null, { minimumMs: 30_000 })
      expect(aiJobStepMinimumMs('page', AI_JOB_PLAN_STEP)).toBe(0)
    } finally {
      registerAiJobPlanStep(null)
    }
  })

  it('leaves a step with less time left than it needs untouched, so it keeps its place for the next beat', async () => {
    const untimed = await newTextJob()
    const timed = await newTimedJob()
    let clock = NOW.getTime()
    const ran: string[] = []
    const result = await sweepAiJobs({
      firestore,
      owner: 'beat',
      now: () => clock,
      budgetMs: 45_000,
      listDue: async () => [
        { orgId: ORG, jobId: untimed.$id },
        { orgId: ORG, jobId: timed.$id },
      ],
      runStep: async (_orgId, jobId) => {
        ran.push(jobId)
        clock += 30_000
        return { outcome: 'done', job: await jobOf(jobId) }
      },
    })
    // 15 s are left when the timed step's turn comes, and it needs 20 s.
    expect(ran).toEqual([untimed.$id])
    expect(result).toEqual({ due: 2, ran: 1, skipped: 0, remaining: 1, budgetExhausted: false })
    expect(await getAiJob(firestore, ORG, timed.$id)).toMatchObject({ status: 'queued', updatedAt: NOW })
  })

  it('runs a timed step again once every due job has had its turn, while the time it needs is left', async () => {
    const timed = await newTimedJob()
    const untimed = await newTextJob()
    let clock = NOW.getTime()
    let passes = 0
    const ran: string[] = []
    const result = await sweepAiJobs({
      firestore,
      owner: 'beat',
      now: () => clock,
      budgetMs: 45_000,
      listDue: async () => [
        { orgId: ORG, jobId: timed.$id },
        { orgId: ORG, jobId: untimed.$id },
      ],
      runStep: async (_orgId, jobId) => {
        ran.push(jobId)
        clock += 5_000
        const job = (await jobOf(jobId)) as unknown as Record<string, unknown>
        if (jobId === timed.$id && ++passes >= 3) {
          return { outcome: 'done', job: { ...job, status: 'done' } as never }
        }
        return { outcome: 'done', job: job as never }
      },
    })
    // Its first pass, the other job's turn, then its passes until it is done.
    // A step that says nothing about its time is never run again here.
    expect(ran).toEqual([timed.$id, untimed.$id, timed.$id, timed.$id])
    expect(result).toEqual({ due: 2, ran: 4, skipped: 0, remaining: 0, budgetExhausted: false })
  })

  it('stops running it again when less time is left than it needs, and after the sweep’s candidate count', async () => {
    const timed = await newTimedJob()
    let clock = NOW.getTime()
    let runs = 0
    const spaced = await sweepAiJobs({
      firestore,
      owner: 'beat',
      now: () => clock,
      budgetMs: 45_000,
      listDue: async () => [{ orgId: ORG, jobId: timed.$id }],
      runStep: async (_orgId, jobId) => {
        runs += 1
        clock += 15_000
        return { outcome: 'done', job: await jobOf(jobId) }
      },
    })
    // 15 s, then 30 s: 15 s left is less than the 20 s it needs.
    expect(runs).toBe(2)
    expect(spaced).toMatchObject({ ran: 2, remaining: 0 })

    runs = 0
    const frozen = await sweepAiJobs({
      firestore,
      owner: 'beat',
      now: () => NOW.getTime(),
      budgetMs: 45_000,
      listDue: async () => [{ orgId: ORG, jobId: timed.$id }],
      runStep: async (_orgId, jobId) => {
        runs += 1
        return { outcome: 'done', job: await jobOf(jobId) }
      },
    })
    // A clock that never moves is still bounded.
    expect(runs).toBe(1 + AI_JOB_SWEEP_MAX_JOBS)
    expect(frozen.ran).toBe(1 + AI_JOB_SWEEP_MAX_JOBS)
  })
})
