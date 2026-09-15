/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
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
 * The AI job routes (AGL-2904): create, list, watch, cancel.
 *
 * The gate ladder, the read gate, the state machine and the meter are all
 * REAL here — only their leaves are stubbed (the token verifier, the org
 * resolver, the flag, the lockdown verdicts, the rate window) and the
 * provider is faked at the runtime's `runAiRequest` seam. So every rung
 * is forced red once against the real composition, and the green path is
 * checked end to end: a job created, its first step run inline, the copy
 * on the job, the message and the cost on the same monthly rollup a chat
 * turn feeds, and an audit row per output.
 */

export {}

let mockDocs = new Map<string, Record<string, unknown>>()
let mockAutoId = 0
let mockFlagOn = true
let mockRateAllowed = true
let mockLockdown: Response | null = null
let mockFeatureLockdown: Response | null = null
/** What the permission rung answers (AGL-2927); the site it was asked about. */
let mockAiPermitted = true
let mockAiPermissionAsks: unknown[][] = []

const mockVerifyIdToken = jest.fn()
const mockGetOrgForUser = jest.fn()
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
  const millis = (value: unknown) =>
    value instanceof Date ? value.getTime() : Number(value)
  const makeQuery = (
    matches: (path: string) => boolean,
    filters: Filter[] = [],
    order: { field: string; direction: string } | null = null,
    limit = Infinity,
  ) => ({
    where: (field: string, op: string, value: unknown) =>
      makeQuery(matches, [...filters, { field, op, value }], order, limit),
    orderBy: (field: string, direction = 'asc') =>
      makeQuery(matches, filters, { field, direction }, limit),
    limit: (count: number) => makeQuery(matches, filters, order, count),
    get: async () => {
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
        // Ties break by document name in the order's direction, as Firestore
        // appends `__name__` to every order: two jobs created inside one
        // millisecond still list deterministically.
        docs = docs.sort((a, b) => {
          const left = millis((mockDocs.get(a) ?? {})[order.field])
          const right = millis((mockDocs.get(b) ?? {})[order.field])
          return order.direction === 'desc'
            ? right - left || b.localeCompare(a)
            : left - right || a.localeCompare(b)
        })
      }
      return { docs: docs.slice(0, limit).map(snapshotOf) }
    },
  })
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
  const queuedWriter = () => {
    const queued: Array<() => void> = []
    const set = (
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
    }
    return { queued, set }
  }
  return {
    collection: (name: string) => makeCollection(name),
    collectionGroup: (name: string) =>
      makeQuery((path) => {
        const parts = path.split('/')
        return parts.length >= 2 && parts[parts.length - 2] === name
      }),
    runTransaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const { queued, set } = queuedWriter()
      const result = await fn({
        get: async (ref: { path: string }) => snapshotOf(ref.path),
        set,
      })
      for (const write of queued) write()
      return result
    },
    batch: () => {
      const { queued, set } = queuedWriter()
      const batch = {
        set: (...args: Parameters<typeof set>) => {
          set(...args)
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

const mockFirestore = mockMakeFirestore()

const LIB = '../../../../../../libs/tenant/data/admin/src/lib/server'

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: {
    increment: (n: number) => ({ __inc: n }),
    serverTimestamp: () => '__now__',
  },
}))

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: (token: string) => mockVerifyIdToken(token) }),
      firestore: () => mockFirestore,
    }),
  },
  emailUnverifiedResponse: () =>
    Response.json(
      { error: 'Verify your email to continue', reason: 'email-unverified' },
      { status: 403 },
    ),
  isImpersonationSession: (decoded: { impersonatedBy?: unknown }) =>
    typeof decoded.impersonatedBy === 'string',
}))
jest.mock('@aglyn/tenant-data-admin/server/id-token-refusal', () => ({
  __esModule: true,
  isRefusedIdToken: (error: unknown) =>
    (error as { refused?: boolean } | null)?.refused === true,
}))
jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  __esModule: true,
  getOrgForUser: (...args: unknown[]) => mockGetOrgForUser(...args),
  memberHasAiPermission: async (...args: unknown[]) => {
    mockAiPermissionAsks.push(args)
    return mockAiPermitted
  },
  aiPermissionRefusal: (permission: string) =>
    Response.json(
      { error: `Your role does not include ${permission}`, reason: 'permission', permission },
      { status: 403 },
    ),
}))
jest.mock('@aglyn/tenant-data-admin/server/release-flags', () => ({
  __esModule: true,
  isServerReleaseFlagOnForOrg: async () => mockFlagOn,
}))
jest.mock('@aglyn/tenant-data-admin/server/lockdown', () => ({
  __esModule: true,
  lockdownRefusal: async () => mockLockdown,
  featureLockdownRefusal: async () => mockFeatureLockdown,
}))
jest.mock('@aglyn/tenant-data-admin/server/api-http', () => ({
  __esModule: true,
  checkRateLimit: () => ({ allowed: mockRateAllowed, limit: 10, remaining: 9, resetAt: 0 }),
  rateLimitHeaders: () => ({ 'X-RateLimit-Limit': '10' }),
}))
jest.mock('../runtime/ai-runtime', () => ({
  __esModule: true,
  ...jest.requireActual(
    '../runtime/ai-runtime',
  ),
  runAiRequest: (...args: unknown[]) => mockRunAiRequest(...args),
}))
jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  checkEntitlement: jest.requireActual(
    '@aglyn/aglyn/app-utils/plan-entitlements',
  ).checkEntitlement,
}))
/**
 * The activity writers (AGL-2929), captured at the machine's seam: the row
 * shapes are proven in `ai-activity.spec.ts`; what the routes owe is the
 * actor — the caller, with their address, on the door they came through.
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

import { GET as listJobs, POST as createJob, parseCreateAiJobBody } from './ai-jobs-route'
// The plugin's own declarations (AGL-2939): the add-on the entitlement fold
// reads and the levers the lockdown catalog lists, registered as the entry
// would have registered them.
import '../declarations'
import { GET as jobEvents } from './ai-jobs-events-route'
import { POST as cancelJob } from './ai-jobs-cancel'
import { aiJobEventStream } from './ai-jobs-events'
import { POST as resumeJob } from './ai-jobs-resume'
import {
  assistUsageMonth,
} from '../usage/assist-usage'
import {
  AI_JOB_NOT_AVAILABLE_COPY,
  registerAiJobPlanStep,
  registerAiJobStep,
} from '../jobs/ai-jobs'
import { registerAiJobAdmission } from '../jobs/ai-job-admission'

const ORG = 'org-1'
/** A Pro workspace with the AI add-on: `aiGenerative` is on. */
const ENTITLED_ORG = {
  plan: 'pro',
  billingStatus: 'active',
  seatAddons: { aiAddon: true },
}
/** Pro without the add-on: `aiAssist` yes, `aiGenerative` no. */
const PLAIN_PRO_ORG = { plan: 'pro', billingStatus: 'active' }

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
    estCostUsd: 0.006,
    stopReason: 'end_turn',
  })
}

function post(
  body: unknown,
  init: { token?: string | null; path?: string } = {},
): Request {
  const token = init.token === undefined ? 'user-token' : init.token
  return new Request(`https://app.aglyn.com${init.path ?? '/api/ai/jobs'}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  })
}

function get(path: string, init: { token?: string | null } = {}): Request {
  const token = init.token === undefined ? 'user-token' : init.token
  return new Request(`https://app.aglyn.com${path}`, {
    method: 'GET',
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })
}

const params = (jobId: string) => ({ params: Promise.resolve({ jobId }) })

const VALID = { orgId: ORG, kind: 'text', brief: 'A two-line tagline for a coffee roaster.', hostId: 'host-1' }

async function readEvents(response: Response): Promise<Array<Record<string, unknown>>> {
  const text = await response.text()
  return text
    .split('\n\n')
    .filter((frame) => frame.startsWith('data: '))
    .map((frame) => JSON.parse(frame.slice('data: '.length)))
}

beforeEach(() => {
  mockDocs = new Map()
  mockAutoId = 0
  mockFlagOn = true
  mockRateAllowed = true
  mockLockdown = null
  mockFeatureLockdown = null
  mockAiPermitted = true
  mockAiPermissionAsks = []
  mockRunAiRequest.mockReset()
  for (const writer of Object.values(mockAiActivity)) writer.mockClear()
  mockVerifyIdToken.mockReset()
  mockGetOrgForUser.mockReset()
  mockVerifyIdToken.mockResolvedValue({
    uid: 'uid-1',
    email: 'member@example.com',
    email_verified: true,
  })
  mockGetOrgForUser.mockImplementation(async (_uid: string, orgId: string) =>
    orgId === ORG ? { orgId: ORG, org: ENTITLED_ORG } : null,
  )
  mockDocs.set(`orgs/${ORG}`, ENTITLED_ORG)
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

const jobDocs = () =>
  [...mockDocs.entries()].filter(([path]) => path.startsWith(`orgs/${ORG}/aiJobs/`))

describe('POST /api/ai/jobs — the ladder', () => {
  it('401 without a bearer token, and never reads the org', async () => {
    const response = await createJob(post(VALID, { token: null }))
    expect(response.status).toBe(401)
    expect(mockGetOrgForUser).not.toHaveBeenCalled()
  })

  it('401 for a token the verifier refused', async () => {
    mockVerifyIdToken.mockRejectedValue(Object.assign(new Error('expired'), { refused: true }))
    expect((await createJob(post(VALID))).status).toBe(401)
  })

  it('403 for an unverified email', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'uid-1', email_verified: false })
    const response = await createJob(post(VALID))
    expect(response.status).toBe(403)
    expect((await response.json()).reason).toBe('email-unverified')
  })

  it('400 when the body names no org (AGL-1934), before membership is consulted', async () => {
    const response = await createJob(post({ ...VALID, orgId: '' }))
    expect(response.status).toBe(400)
    expect(mockGetOrgForUser).not.toHaveBeenCalled()
  })

  it('403 for a member of some other org', async () => {
    const response = await createJob(post({ ...VALID, orgId: 'org-other' }))
    expect(response.status).toBe(403)
    expect(jobDocs()).toHaveLength(0)
  })

  it('404 while the flag is off, and staff preview through it', async () => {
    mockFlagOn = false
    expect((await createJob(post(VALID))).status).toBe(404)
    mockVerifyIdToken.mockResolvedValue({ uid: 'staff-1', email_verified: true, staff: true })
    armCompletion()
    expect((await createJob(post(VALID))).status).toBe(200)
  })

  it('403 on a plan without aiGenerative — Pro without the add-on', async () => {
    mockGetOrgForUser.mockResolvedValue({ orgId: ORG, org: PLAIN_PRO_ORG })
    const response = await createJob(post(VALID))
    expect(response.status).toBe(403)
    expect((await response.json()).reason).toBe('entitlement')
  })

  it('403 for a member whose role lacks ai.generate, asked about the named site', async () => {
    // The permission is a fact about the caller, so it is refused before the
    // plan or the quota is disclosed: no reservation, no job document.
    mockAiPermitted = false
    const response = await createJob(post(VALID))
    expect(response.status).toBe(403)
    expect((await response.json()).reason).toBe('permission')
    expect(mockAiPermissionAsks).toHaveLength(1)
    expect(mockAiPermissionAsks[0][1]).toBe(VALID.hostId ?? null)
    expect(mockAiPermissionAsks[0][3]).toBe('ai.generate')
    expect(jobDocs()).toHaveLength(0)
  })

  it('423 under a scope lockdown and under the ai-generate switch', async () => {
    mockLockdown = Response.json({ error: 'locked' }, { status: 423 })
    expect((await createJob(post(VALID))).status).toBe(423)
    mockLockdown = null
    mockFeatureLockdown = Response.json({ error: 'locked' }, { status: 423 })
    expect((await createJob(post(VALID))).status).toBe(423)
    expect(jobDocs()).toHaveLength(0)
  })

  it('429 on the per-uid window, with no reservation taken', async () => {
    mockRateAllowed = false
    const response = await createJob(post(VALID))
    expect(response.status).toBe(429)
    expect((await response.json()).reason).toBe('rate')
    expect(mockDocs.has(`orgs/${ORG}/assistUsage/${assistUsageMonth()}`)).toBe(false)
  })

  it('429 at the monthly guard: no job, no provider call', async () => {
    mockDocs.set(`orgs/${ORG}/assistUsage/${assistUsageMonth()}`, { messages: 1000 })
    const response = await createJob(post(VALID))
    expect(response.status).toBe(429)
    expect((await response.json()).reason).toBe('quota')
    expect(jobDocs()).toHaveLength(0)
    expect(mockRunAiRequest).not.toHaveBeenCalled()
  })

  it('400 for a bad body AFTER admission, and the reservation goes back', async () => {
    const response = await createJob(post({ ...VALID, kind: 'poem' }))
    expect(response.status).toBe(400)
    expect((await response.json()).error).toContain('kind must be one of')
    expect(mockDocs.get(`orgs/${ORG}/assistUsage/${assistUsageMonth()}`)?.['messages']).toBe(0)
    expect(jobDocs()).toHaveLength(0)
  })
})

describe('POST /api/ai/jobs — the green path', () => {
  it('creates the job and runs the text step inline: done, metered, audited', async () => {
    armCompletion()
    const response = await createJob(post({ ...VALID, inputs: { tone: 'warm' } }))
    expect(response.status).toBe(200)
    const { job } = await response.json()
    expect(job).toMatchObject({
      orgId: ORG,
      hostId: 'host-1',
      kind: 'text',
      status: 'done',
      creditsSpent: 6,
      creditsReserved: 0,
      running: false,
      outputs: [{ resource: 'text', text: 'Fresh coffee, roasted this morning.' }],
    })
    expect(job.steps[0]).toMatchObject({ name: 'draft', status: 'done', creditsSpent: 6 })
    // The wire form carries no lease.
    expect(job).not.toHaveProperty('lease')

    // ONE message on the rollup: the ladder's reservation, reused by the
    // inline step rather than taken twice.
    expect(mockDocs.get(`orgs/${ORG}/assistUsage/${assistUsageMonth()}`)).toMatchObject({
      messages: 1,
      inputTokens: 1_000,
      estCostUsd: 0.006,
    })
    const audit = [...mockDocs.entries()].filter(([path]) => path.startsWith('adminAudit/'))
    expect(audit).toHaveLength(1)
    expect(audit[0][1]).toMatchObject({ action: 'ai.job.output', actorUid: 'uid-1' })

    // The customer-visible rows (AGL-2929): the job and its output, both
    // attributed to the caller WITH their address — the route knows it, the
    // beat would not.
    const caller = { uid: 'uid-1', email: 'member@example.com' }
    expect(mockAiActivity.logAiJobCreated).toHaveBeenCalledTimes(1)
    expect(mockAiActivity.logAiJobCreated).toHaveBeenCalledWith(ORG, caller, {
      jobId: job.id,
      kind: 'text',
      briefLength: VALID.brief.length,
      hostId: 'host-1',
    })
    expect(mockAiActivity.logAiJobOutput).toHaveBeenCalledTimes(1)
    expect(mockAiActivity.logAiJobOutput).toHaveBeenCalledWith(ORG, caller, {
      jobId: job.id,
      hostId: 'host-1',
      resource: { type: 'content', id: 'draft', name: 'Draft copy', versionId: null },
    })
    expect(mockAiActivity.logAiJobNeedsInput).not.toHaveBeenCalled()

    // The brief rode in the user turn; the tone input beside it.
    const request = mockRunAiRequest.mock.calls[0][0] as { messages: Array<{ content: string }> }
    expect(request.messages[0].content).toContain('coffee roaster')
    expect(request.messages[0].content).toContain('Tone: warm')
  })

  it('answers queued when the inline budget ends first, with the message handed back', async () => {
    mockRunAiRequest.mockRejectedValue(
      Object.assign(new Error('timed out'), { name: 'TimeoutError' }),
    )
    const response = await createJob(post(VALID))
    expect(response.status).toBe(200)
    const { job } = await response.json()
    expect(job.status).toBe('queued')
    expect(job.steps[0]).toMatchObject({ status: 'pending' })
    expect(mockDocs.get(`orgs/${ORG}/assistUsage/${assistUsageMonth()}`)?.['messages']).toBe(0)
  })

  it('fails fast for a kind with no runner, spending nothing', async () => {
    const response = await createJob(post({ ...VALID, kind: 'page' }))
    expect(response.status).toBe(200)
    const { job } = await response.json()
    expect(job).toMatchObject({ status: 'failed', error: AI_JOB_NOT_AVAILABLE_COPY })
    expect(mockRunAiRequest).not.toHaveBeenCalled()
    expect(mockDocs.get(`orgs/${ORG}/assistUsage/${assistUsageMonth()}`)?.['messages']).toBe(0)
  })

  it('asks the kind’s admission before the job exists, and a refusal spends nothing (AGL-2909)', async () => {
    const limit = 'Your plan includes 1 shared layouts — upgrade in Billing for more'
    const admission = jest.fn().mockResolvedValue({ status: 403, error: limit })
    const messages = () => mockDocs.get(`orgs/${ORG}/assistUsage/${assistUsageMonth()}`)?.['messages']
    registerAiJobAdmission('component', admission)
    try {
      const refused = await createJob(post({ ...VALID, kind: 'component', inputs: { tone: 'plain' } }))
      expect(refused.status).toBe(403)
      expect(await refused.json()).toEqual({ error: limit })
      expect(admission).toHaveBeenCalledWith(
        expect.objectContaining({ orgId: ORG, hostId: 'host-1', inputs: { tone: 'plain' } }),
      )
      expect(jobDocs()).toHaveLength(0)
      expect(messages()).toBe(0)

      jest.spyOn(console, 'error').mockImplementation(() => undefined)
      admission.mockRejectedValueOnce(new Error('the host index could not be read'))
      const failed = await createJob(post({ ...VALID, kind: 'component' }))
      expect(failed.status).toBe(500)
      expect(jobDocs()).toHaveLength(0)
      expect(messages()).toBe(0)

      admission.mockResolvedValueOnce(null)
      const admitted = await createJob(post({ ...VALID, kind: 'component' }))
      expect(admitted.status).toBe(200)
      expect(jobDocs()).toHaveLength(1)
    } finally {
      registerAiJobAdmission('component', null)
    }
  })
})

describe('parseCreateAiJobBody', () => {
  it('names each fault', () => {
    expect(parseCreateAiJobBody({ orgId: ORG, kind: 'text', brief: ' ' })).toBe(
      'Write a brief for the job',
    )
    expect(parseCreateAiJobBody({ ...VALID, hostId: 'not a host!' })).toBe(
      'hostId is not a site id',
    )
    expect(parseCreateAiJobBody({ ...VALID, inputs: [] })).toBe('inputs must be an object')
    expect(parseCreateAiJobBody({ ...VALID, inputs: { tone: { deep: 1 } } })).toContain(
      'inputs.tone',
    )
    expect(parseCreateAiJobBody({ ...VALID, brief: 'x'.repeat(4_001) })).toContain(
      'Keep the brief under',
    )
    expect(parseCreateAiJobBody({ ...VALID, hostId: '' })).toMatchObject({ hostId: null })
    // A theme is fields on one site (AGL-2938), so a theme job must name it.
    expect(parseCreateAiJobBody({ ...VALID, kind: 'theme', hostId: null })).toBe(
      'Open a site before changing its theme',
    )
    expect(parseCreateAiJobBody({ ...VALID, kind: 'theme' })).toMatchObject({
      kind: 'theme',
      hostId: 'host-1',
    })
  })
})

describe('GET /api/ai/jobs — the read gate and the list', () => {
  async function seedJobs() {
    armCompletion()
    await createJob(post({ ...VALID, brief: 'first' }))
    mockRunAiRequest.mockRejectedValue(
      Object.assign(new Error('timed out'), { name: 'TimeoutError' }),
    )
    await createJob(post({ ...VALID, brief: 'second' }))
  }

  it('401 / 400 / 403 / 404 / 403 in the ladder order, spending nothing', async () => {
    expect((await listJobs(get(`/api/ai/jobs?orgId=${ORG}`, { token: null }))).status).toBe(401)
    expect((await listJobs(get('/api/ai/jobs'))).status).toBe(400)
    expect((await listJobs(get('/api/ai/jobs?orgId=org-other'))).status).toBe(403)
    mockFlagOn = false
    expect((await listJobs(get(`/api/ai/jobs?orgId=${ORG}`))).status).toBe(404)
    mockFlagOn = true
    mockGetOrgForUser.mockResolvedValue({ orgId: ORG, org: PLAIN_PRO_ORG })
    expect((await listJobs(get(`/api/ai/jobs?orgId=${ORG}`))).status).toBe(403)
    expect(mockDocs.has(`orgs/${ORG}/assistUsage/${assistUsageMonth()}`)).toBe(false)
  })

  it('423 under lockdown', async () => {
    mockLockdown = Response.json({ error: 'locked' }, { status: 423 })
    expect((await listJobs(get(`/api/ai/jobs?orgId=${ORG}`))).status).toBe(423)
  })

  it('lists the org’s jobs newest first, and filters by status', async () => {
    await seedJobs()
    const response = await listJobs(get(`/api/ai/jobs?orgId=${ORG}`))
    expect(response.status).toBe(200)
    const { jobs } = await response.json()
    expect(jobs.map((job: { brief: string }) => job.brief)).toEqual(['second', 'first'])
    const queued = await (await listJobs(get(`/api/ai/jobs?orgId=${ORG}&status=queued`))).json()
    expect(queued.jobs.map((job: { brief: string }) => job.brief)).toEqual(['second'])
  })
})

describe('GET /api/ai/jobs/[jobId]/events', () => {
  it('404 for a job the named org does not hold', async () => {
    const response = await jobEvents(
      get(`/api/ai/jobs/nope/events?orgId=${ORG}`),
      params('nope'),
    )
    expect(response.status).toBe(404)
  })

  it('opens as an event stream whose first frame is the job’s state', async () => {
    armCompletion()
    const { job } = await (await createJob(post(VALID))).json()
    const response = await jobEvents(
      get(`/api/ai/jobs/${job.id}/events?orgId=${ORG}`),
      params(job.id),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    // A terminal job closes after its one frame, so the whole body reads.
    const events = await readEvents(response)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'state', job: { id: job.id, status: 'done' } })
  })

  it('climbs the read gate before the job is looked up', async () => {
    mockFlagOn = false
    const response = await jobEvents(
      get(`/api/ai/jobs/any/events?orgId=${ORG}`),
      params('any'),
    )
    expect(response.status).toBe(404)
    expect((await response.json()).error).toBe('Not found')
  })
})

describe('aiJobEventStream — the poll', () => {
  const summary = (patch: Record<string, unknown>) => ({
    id: 'job-1',
    orgId: ORG,
    hostId: null,
    kind: 'text' as const,
    status: 'running' as const,
    brief: 'b',
    steps: [],
    outputs: [],
    creditsReserved: 50,
    creditsSpent: 0,
    createdBy: 'u',
    createdAt: '2026-09-14T10:00:00.000Z',
    updatedAt: '2026-09-14T10:00:00.000Z',
    error: null,
    running: true,
    plan: null,
    review: null,
    ...patch,
  })

  it('emits state on change only, and closes at a terminal status', async () => {
    const reads = [
      summary({}),
      summary({ updatedAt: '2026-09-14T10:00:02.000Z' }),
      summary({ status: 'done', running: false, updatedAt: '2026-09-14T10:00:04.000Z' }),
    ]
    let clock = 0
    const stream = aiJobEventStream(summary({}), {
      read: async () => reads.shift() ?? null,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms
      },
    })
    const events = await readEvents(new Response(stream))
    expect(events.map((event) => event['type'])).toEqual(['state', 'state', 'state'])
    expect((events[2] as { job: { status: string } }).job.status).toBe('done')
  })

  it('asks the client to reconnect at the deadline, and says gone when the job vanished', async () => {
    let clock = 0
    const atDeadline = aiJobEventStream(summary({}), {
      read: async () => summary({}),
      now: () => clock,
      sleep: async (ms) => {
        clock += ms
      },
      intervalMs: 2_000,
      deadlineMs: 6_000,
    })
    const events = await readEvents(new Response(atDeadline))
    expect(events.map((event) => event['type'])).toEqual(['state', 'reconnect'])

    const vanished = aiJobEventStream(summary({}), {
      read: async () => null,
      sleep: async () => undefined,
    })
    expect((await readEvents(new Response(vanished))).map((event) => event['type'])).toEqual([
      'state',
      'gone',
    ])
  })

  it('stops polling once the client hangs up', async () => {
    const controller = new AbortController()
    const read = jest.fn(async () => summary({}))
    const stream = aiJobEventStream(summary({}), {
      read,
      signal: controller.signal,
      sleep: async () => {
        controller.abort()
      },
    })
    const events = await readEvents(new Response(stream))
    expect(events.map((event) => event['type'])).toEqual(['state'])
    expect(read).not.toHaveBeenCalled()
  })
})

describe('POST /api/ai/jobs/[jobId]/cancel', () => {
  it('cancels a queued job once, audits it, and is idempotent after', async () => {
    mockRunAiRequest.mockRejectedValue(
      Object.assign(new Error('timed out'), { name: 'TimeoutError' }),
    )
    const { job } = await (await createJob(post(VALID))).json()
    expect(job.status).toBe('queued')

    const first = await cancelJob(
      post({ orgId: ORG }, { path: `/api/ai/jobs/${job.id}/cancel` }),
      params(job.id),
    )
    expect(first.status).toBe(200)
    expect(await first.json()).toMatchObject({ changed: true, job: { status: 'canceled' } })
    const audit = [...mockDocs.entries()].filter(([path]) => path.startsWith('adminAudit/'))
    expect(audit).toHaveLength(1)
    expect(audit[0][1]).toMatchObject({
      action: 'ai.job.cancel',
      actorUid: 'uid-1',
      actorEmail: 'member@example.com',
      target: `orgs/${ORG}/aiJobs/${job.id}`,
      after: { wasStatus: 'queued', kind: 'text' },
    })
    // The org feed's row (AGL-2929), for the member who canceled.
    expect(mockAiActivity.logAiJobCanceled).toHaveBeenCalledTimes(1)
    expect(mockAiActivity.logAiJobCanceled).toHaveBeenCalledWith(
      ORG,
      { uid: 'uid-1', email: 'member@example.com' },
      { jobId: job.id, kind: 'text' },
    )

    const second = await cancelJob(
      post({ orgId: ORG }, { path: `/api/ai/jobs/${job.id}/cancel` }),
      params(job.id),
    )
    expect(await second.json()).toMatchObject({ changed: false, job: { status: 'canceled' } })
    expect(
      [...mockDocs.keys()].filter((path) => path.startsWith('adminAudit/')),
    ).toHaveLength(1)
    // A cancel that changed nothing is not a second act.
    expect(mockAiActivity.logAiJobCanceled).toHaveBeenCalledTimes(1)
  })

  it('404 for a job id under another org, even for a member of both', async () => {
    mockGetOrgForUser.mockImplementation(async (_uid: string, orgId: string) => ({
      orgId,
      org: ENTITLED_ORG,
    }))
    mockRunAiRequest.mockRejectedValue(
      Object.assign(new Error('timed out'), { name: 'TimeoutError' }),
    )
    const { job } = await (await createJob(post(VALID))).json()
    const response = await cancelJob(
      post({ orgId: 'org-2' }, { path: `/api/ai/jobs/${job.id}/cancel` }),
      params(job.id),
    )
    expect(response.status).toBe(404)
    expect(mockDocs.get(`orgs/${ORG}/aiJobs/${job.id}`)?.['status']).toBe('queued')
  })
})

describe('POST /api/ai/jobs/[jobId]/resume (AGL-2935)', () => {
  const planRunner = jest.fn()
  const siteRunner = jest.fn()
  const spend = { usage: USAGE, estCostUsd: 0.006, model: 'claude-sonnet-5', stopReason: 'tool_use' }

  // A planned kind no other test here creates, so its runner changes no
  // other kind's path.
  beforeAll(() => registerAiJobStep('site', (context) => siteRunner(context)))
  beforeEach(() => {
    planRunner.mockReset().mockImplementation(async ({ now }: { now: Date }) => ({
      outputs: [],
      ...spend,
      plan: {
        reuse: [],
        create: [],
        screens: [],
        status: 'proposed',
        labels: {},
        proposedAt: now,
        confirmedAt: null,
        confirmedBy: null,
      },
      review: { reason: 'plan', message: 'The plan is ready.', findings: [] },
    }))
    siteRunner.mockReset().mockResolvedValue({
      outputs: [{ resource: 'screen', id: 'scr-1', versionId: 'v-1', hostId: 'host-1', label: 'Home' }],
      ...spend,
    })
    registerAiJobPlanStep((context) => planRunner(context))
  })
  afterEach(() => registerAiJobPlanStep(null))

  const resume = (jobId: string, body: Record<string, unknown> = { orgId: ORG, hostId: 'host-1' }) =>
    resumeJob(post(body, { path: `/api/ai/jobs/${jobId}/resume` }), params(jobId))
  const messages = () =>
    mockDocs.get(`orgs/${ORG}/assistUsage/${assistUsageMonth()}`)?.['messages']
  const auditRows = () =>
    [...mockDocs.entries()]
      .filter(([path]) => path.startsWith('adminAudit/'))
      .map(([, row]) => row)

  async function proposed(): Promise<{ id: string }> {
    const { job } = await (await createJob(post({ ...VALID, kind: 'site' }))).json()
    expect(job).toMatchObject({
      status: 'needs_review',
      plan: { status: 'proposed' },
      review: { reason: 'plan' },
    })
    return job
  }

  it('confirms the plan and runs the next step inline on its own reservation, audited', async () => {
    const job = await proposed()
    expect(messages()).toBe(1)
    const response = await resume(job.id)
    expect(response.status).toBe(200)
    expect((await response.json()).job).toMatchObject({
      status: 'done',
      plan: { status: 'confirmed', confirmedBy: 'uid-1' },
      review: null,
      outputs: [{ resource: 'screen', id: 'scr-1' }],
    })
    expect(siteRunner).toHaveBeenCalledTimes(1)
    expect(messages()).toBe(2)
    expect(auditRows().map((row) => row['action'])).toEqual(['ai.job.resume', 'ai.job.output'])
    expect(auditRows()[0]).toMatchObject({
      actorUid: 'uid-1',
      actorEmail: 'member@example.com',
      target: `orgs/${ORG}/aiJobs/${job.id}`,
      after: { status: 'queued', reason: 'plan', kind: 'site' },
    })
  })

  it('refuses another site, an unknown job and a job no longer waiting, handing the message back each time', async () => {
    const job = await proposed()
    expect((await resume(job.id, { orgId: ORG, hostId: 'host-2' })).status).toBe(400)
    expect((await resume('job-missing')).status).toBe(404)
    expect(messages()).toBe(1)
    expect((await resume(job.id)).status).toBe(200)
    expect(messages()).toBe(2)
    const again = await resume(job.id)
    expect(again.status).toBe(409)
    expect(await again.json()).toMatchObject({
      error: 'This job is not waiting for review',
      job: { status: 'done' },
    })
    expect(messages()).toBe(2)
    expect(siteRunner).toHaveBeenCalledTimes(1)
  })

  it('asks for ai.generate on the job’s site, and spends nothing and moves nothing when refused', async () => {
    const job = await proposed()
    mockAiPermitted = false
    mockAiPermissionAsks = []
    const response = await resume(job.id)
    expect(response.status).toBe(403)
    expect(mockAiPermissionAsks[0][1]).toBe('host-1')
    expect(mockAiPermissionAsks[0][3]).toBe('ai.generate')
    expect(mockDocs.get(`orgs/${ORG}/aiJobs/${job.id}`)?.['status']).toBe('needs_review')
    expect(messages()).toBe(1)
    expect(siteRunner).not.toHaveBeenCalled()
  })

  it('asks the kind’s admission again before a waiting job runs, and a refusal leaves it waiting (AGL-2909)', async () => {
    const job = await proposed()
    const limit = 'Your plan includes 1 shared layouts — upgrade in Billing for more'
    const admission = jest.fn().mockResolvedValue({ status: 403, error: limit })
    registerAiJobAdmission('site', admission)
    try {
      const refused = await resume(job.id)
      expect(refused.status).toBe(403)
      expect(await refused.json()).toMatchObject({
        error: limit,
        job: { status: 'needs_review', review: { reason: 'plan' } },
      })
      expect(admission).toHaveBeenCalledWith(expect.objectContaining({ orgId: ORG, hostId: 'host-1' }))
      expect(mockDocs.get(`orgs/${ORG}/aiJobs/${job.id}`)?.['status']).toBe('needs_review')
      expect(messages()).toBe(1)
      expect(siteRunner).not.toHaveBeenCalled()
      expect(auditRows()).toEqual([])

      admission.mockResolvedValue(null)
      expect((await resume(job.id)).status).toBe(200)
      expect(siteRunner).toHaveBeenCalledTimes(1)
    } finally {
      registerAiJobAdmission('site', null)
    }
  })
})
