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
 * The agency batch door (AGL-2911).
 *
 * The gate ladder is proven rung by rung against the real composition where
 * it is composed (`ai-jobs-route.spec.ts`), so here it is a seam and what is
 * REAL is everything this door adds: the body it admits, the plan band it
 * holds, the per-site permission it asks for, the scaffold's own admission,
 * and the batch id every job it creates carries.
 */

export {}

let mockPermitted = new Map<string, boolean>()
let mockOwners = new Map<string, string>()
let mockGate: unknown = null
const mockCreated: Array<Record<string, unknown>> = []
const mockReleased: unknown[] = []

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
jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  __esModule: true,
  getOrgForUser: async (uid: string, orgId: string) => ({
    orgId,
    org: {},
    member: { uid, role: 'admin' },
  }),
  memberHasPermissionOnHost: async (
    _orgId: string,
    hostId: string | null,
    _member: unknown,
    _permission: string,
  ) => mockPermitted.get(hostId ?? '') ?? true,
  resolveOrgIdForHost: async (hostId: string) => mockOwners.get(hostId) ?? null,
}))
jest.mock('../runtime/ai-gate', () => ({
  __esModule: true,
  aiGateLadder: async () => mockGate,
}))
jest.mock('../usage/assist-usage', () => ({
  __esModule: true,
  ...jest.requireActual('../usage/assist-usage'),
  releaseAssistMessage: async (...args: unknown[]) => {
    mockReleased.push(args)
  },
}))
jest.mock('../jobs/ai-jobs', () => ({
  __esModule: true,
  ...jest.requireActual('../jobs/ai-jobs'),
  createAiJob: async (_firestore: unknown, input: Record<string, unknown>) => {
    mockCreated.push(input)
    return {
      ...input,
      $id: `job-${mockCreated.length}`,
      status: 'queued',
      steps: [],
      outputs: [],
      creditsReserved: 0,
      creditsSpent: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: new Date(),
    }
  },
}))

import type { AiJobStepRunner } from '../jobs/ai-job-text-step'
import { registerAiJobStep } from '../jobs/ai-jobs'
// The scaffold's own admission, which every site in a batch meets.
import { registerAiSiteJob } from '../jobs/ai-job-site-step'
import { AI_SITE_BATCH_MAX, AI_SITE_PAGES } from '../model/ai-site-job'
import {
  AI_SITE_BATCH_PLAN_REFUSAL,
  POST as createBatch,
  newAiSiteBatchId,
  parseAiSiteBatchBody,
} from './ai-jobs-batch'

const noRunner = (async () => {
  throw new Error('a batch runs no step')
}) as AiJobStepRunner

/** An Agency workspace: its plan holds the sites a batch is for. */
const AGENCY_ORG = {
  plan: 'agency',
  billingStatus: 'active',
  seatAddons: { aiAddon: true },
}
/** Pro holds ten sites, which is under the band. */
const PRO_ORG = {
  plan: 'pro',
  billingStatus: 'active',
  seatAddons: { aiAddon: true },
}

function gateFor(org: Record<string, unknown>, staff = false) {
  return {
    uid: 'uid-1',
    decoded: { uid: 'uid-1', email: 'a@example.com' },
    staff,
    orgId: 'org-1',
    org,
    firestore: {} as unknown as FirebaseFirestore.Firestore,
    rate: { allowed: true, limit: 3, remaining: 2, resetAt: 0 },
    reservation: { allowed: true, id: 'res-1' },
  }
}

function request(body: unknown): Request {
  return new Request('https://console.example.com/api/ai/jobs/batch', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

const SITES = [
  { hostId: 'host-a', businessName: 'Wag & Co', city: 'Austin', brand: 'teal' },
  { hostId: 'host-b', businessName: 'Paws', city: 'Dallas', brand: 'coral' },
]

const BODY = {
  orgId: 'org-1',
  brief: 'A site for a dog groomer',
  businessType: 'dog groomer',
  pages: AI_SITE_PAGES.min,
  sites: SITES,
}

beforeAll(registerAiSiteJob)

beforeEach(() => {
  mockPermitted = new Map()
  mockOwners = new Map([
    ['host-a', 'org-1'],
    ['host-b', 'org-1'],
  ])
  mockCreated.length = 0
  mockReleased.length = 0
  mockGate = gateFor(AGENCY_ORG)
  registerAiJobStep('page', noRunner)
})

describe('the body a batch takes', () => {
  it('reads the brief, the business, the page count and each site’s variables', () => {
    expect(parseAiSiteBatchBody(BODY)).toEqual({
      orgId: 'org-1',
      brief: 'A site for a dog groomer',
      businessType: 'dog groomer',
      pages: AI_SITE_PAGES.min,
      welcomeEmail: true,
      sites: SITES,
      model: null,
    })
  })

  it('refuses no workspace, no brief, no business, a bad page count and no site', () => {
    expect(parseAiSiteBatchBody({})).toMatch(/Open a workspace/)
    expect(parseAiSiteBatchBody({ orgId: 'org-1' })).toMatch(/brief/)
    expect(parseAiSiteBatchBody({ ...BODY, businessType: '' })).toMatch(
      /what kind of business/,
    )
    expect(parseAiSiteBatchBody({ ...BODY, pages: 99 })).toMatch(
      /pages must be/,
    )
    expect(parseAiSiteBatchBody({ ...BODY, sites: [] })).toMatch(
      /Pick the sites/,
    )
  })

  it('refuses more sites than one batch takes, and the same site twice', () => {
    const many = Array.from({ length: AI_SITE_BATCH_MAX + 1 }, (_, index) => ({
      hostId: `host-${index}`,
    }))
    expect(parseAiSiteBatchBody({ ...BODY, sites: many })).toMatch(
      new RegExp(`up to ${AI_SITE_BATCH_MAX} sites`),
    )
    expect(
      parseAiSiteBatchBody({
        ...BODY,
        sites: [{ hostId: 'host-a' }, { hostId: 'host-a' }],
      }),
    ).toMatch(/listed twice/)
  })

  it('refuses a site id that is not one, and an overlong variable', () => {
    expect(
      parseAiSiteBatchBody({ ...BODY, sites: [{ hostId: 'a/b' }] }),
    ).toMatch(/hostId/)
    expect(
      parseAiSiteBatchBody({
        ...BODY,
        sites: [{ hostId: 'host-a', city: 'x'.repeat(200) }],
      }),
    ).toMatch(/under/)
  })

  it('reads Auto as no model at all', () => {
    const parsed = parseAiSiteBatchBody({ ...BODY, model: 'auto' })
    expect(typeof parsed === 'string' ? parsed : parsed.model).toBeNull()
  })

  it('mints a batch id a job input accepts', () => {
    const id = newAiSiteBatchId()
    expect(id).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
    expect(newAiSiteBatchId()).not.toBe(id)
  })
})

describe('what the door answers', () => {
  it('creates one queued scaffold per site, all under one batch id', async () => {
    const response = await createBatch(request(BODY))
    expect(response.status).toBe(202)
    const answer = (await response.json()) as Record<string, unknown>
    expect(answer['refused']).toEqual([])
    expect((answer['jobs'] as unknown[]).length).toBe(2)
    expect(mockCreated.map((input) => input['hostId'])).toEqual([
      'host-a',
      'host-b',
    ])
    const batches = new Set(
      mockCreated.map(
        (input) => (input['inputs'] as Record<string, unknown>)['batchId'],
      ),
    )
    expect(batches.size).toBe(1)
    expect([...batches][0]).toBe(answer['batchId'])
    expect(mockCreated.every((input) => input['kind'] === 'site')).toBe(true)
  })

  it('gives each site its own variables and the one brief', async () => {
    await createBatch(request(BODY))
    expect(mockCreated[0]['inputs']).toMatchObject({
      businessType: 'dog groomer',
      pages: AI_SITE_PAGES.min,
      businessName: 'Wag & Co',
      city: 'Austin',
      brand: 'teal',
    })
    expect(mockCreated[1]['inputs']).toMatchObject({
      businessName: 'Paws',
      city: 'Dallas',
    })
    expect(mockCreated.every((input) => input['brief'] === BODY.brief)).toBe(
      true,
    )
  })

  it('runs no step, so the message the ladder reserved goes back', async () => {
    await createBatch(request(BODY))
    expect(mockReleased).toHaveLength(1)
  })

  it('hands the ladder’s refusal on as it stands', async () => {
    mockGate = Response.json({ error: 'Not found' }, { status: 404 })
    const response = await createBatch(request(BODY))
    expect(response.status).toBe(404)
    expect(mockCreated).toEqual([])
  })

  it('refuses a plan that does not hold enough sites for a batch', async () => {
    mockGate = gateFor(PRO_ORG)
    const response = await createBatch(request(BODY))
    expect(response.status).toBe(403)
    expect((await response.json())['error']).toBe(AI_SITE_BATCH_PLAN_REFUSAL)
    expect(mockCreated).toEqual([])
  })

  it('lets staff through the plan band', async () => {
    mockGate = gateFor(PRO_ORG, true)
    expect((await createBatch(request(BODY))).status).toBe(202)
  })

  it('reports a site the caller may not generate on, and starts the rest', async () => {
    mockPermitted.set('host-b', false)
    const response = await createBatch(request(BODY))
    expect(response.status).toBe(202)
    const answer = (await response.json()) as Record<string, unknown>
    expect(answer['refused']).toEqual([
      { hostId: 'host-b', error: 'You cannot generate on that site' },
    ])
    expect(mockCreated.map((input) => input['hostId'])).toEqual(['host-a'])
  })

  it('reports a site of another workspace, as the scaffold’s own admission reads it', async () => {
    mockOwners.set('host-b', 'org-2')
    const answer = (await (await createBatch(request(BODY))).json()) as Record<
      string,
      unknown
    >
    expect(answer['refused']).toEqual([
      { hostId: 'host-b', error: 'Unknown site' },
    ])
    expect(mockCreated).toHaveLength(1)
  })

  it('refuses the whole batch when no site could start', async () => {
    mockPermitted.set('host-a', false)
    mockPermitted.set('host-b', false)
    const response = await createBatch(request(BODY))
    expect(response.status).toBe(403)
    expect(mockCreated).toEqual([])
  })

  it('refuses a body the parser rejects, after the ladder has admitted the caller', async () => {
    const response = await createBatch(request({ orgId: 'org-1' }))
    expect(response.status).toBe(400)
    expect(mockReleased).toHaveLength(1)
    expect(mockCreated).toEqual([])
  })
})
