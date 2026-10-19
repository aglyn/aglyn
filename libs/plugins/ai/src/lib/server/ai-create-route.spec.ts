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
 * Create with AI's door in the apps (AGL-3854): it draws the entry exactly
 * where the console's shell does — `ai.generate` on the site, the release
 * flag, the site's AI switch, the plan or the add-on it could buy — and the
 * follow view reads one job of the workspace's through the jobs gate.
 */

// The plugin's declarations: the add-on the purchasable check reads.
import '../declarations'
export {}

let mockPermission: Record<string, boolean> = { 'ai.generate': true, 'billing.manage': true }
let mockFlags: Record<string, boolean> = { release_ai_generative: true, release_addon_store: true }
let mockSiteOff = false
let mockOrg: Record<string, unknown> = {}
let mockMember: Record<string, unknown> | null = { role: 'owner' }
let mockActiveJobs: unknown[] = []
let mockJob: Record<string, unknown> | null = null
let mockCollections: Array<{ id: string; data: Record<string, unknown> }> = []
let mockUsage: Record<string, unknown> = {}
const mockGate = jest.fn()

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  checkEntitlement: jest.requireActual('@aglyn/aglyn/app-utils/plan-entitlements').checkEntitlement,
}))

jest.mock('@aglyn/tenant-data-admin/server/firebase-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: async () => ({ uid: 'user-1', email_verified: true }) }),
      firestore: () => ({
        collection: (name: string) => ({
          doc: (id: string) => ({
            collection: (sub: string) => ({
              limit: () => ({
                get: async () => ({
                  docs: mockCollections.map((row) => ({ id: row.id, data: () => row.data })),
                }),
              }),
              doc: () => ({ get: async () => ({ get: (field: string) => mockUsage[field] }) }),
              path: `${name}/${id}/${sub}`,
            }),
          }),
        }),
      }),
    }),
  },
  emailUnverifiedResponse: () => Response.json({ error: 'Verify your email' }, { status: 403 }),
  isImpersonationSession: () => false,
}))

jest.mock('@aglyn/tenant-data-admin/server/id-token-refusal', () => ({
  __esModule: true,
  invalidIdTokenResponse: () => null,
}))

jest.mock('@aglyn/tenant-data-admin/server/organizations', () => ({
  __esModule: true,
  getOrgForUser: async (_uid: string, orgId: string) =>
    orgId === 'org-1' ? { orgId: 'org-1', org: mockOrg, member: mockMember } : null,
  memberHasPermissionOnHost: async (_org: string, _host: string | null, _member: unknown, permission: string) =>
    mockPermission[permission] === true,
}))

jest.mock('@aglyn/tenant-data-admin/server/release-flags', () => ({
  __esModule: true,
  isServerReleaseFlagOnForOrg: async (flag: string) => mockFlags[flag] === true,
}))

jest.mock('../jobs/ai-job-admission', () => ({
  __esModule: true,
  aiJobSiteRefusal: async () => (mockSiteOff ? { status: 404, error: 'AI is off for this site' } : null),
}))

jest.mock('../jobs/ai-jobs', () => ({
  __esModule: true,
  aiJobSummary: (job: Record<string, unknown>) => ({ ...job, id: job['$id'] }),
  getAiJob: async () => mockJob,
  listAiJobs: async () => mockActiveJobs,
}))

jest.mock('../usage/free-ai-credits-left', () => ({
  __esModule: true,
  readFreeAiCreditsLeft: async () => ({ left: 120, total: 300, resetsOn: '2026-11-01' }),
}))

jest.mock('./ai-jobs-gate', () => ({
  __esModule: true,
  aiJobsGate: (...args: unknown[]) => mockGate(...args),
}))

const { GET, GET_FOLLOW } = require('./ai-create-route') as typeof import('./ai-create-route')

const door = (query: Record<string, string>, token: string | null = 'token') =>
  GET(
    new Request(`https://app.aglyn.com/api/ai/create?${new URLSearchParams({ orgId: 'org-1', hostId: 'host-1', ...query })}`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    }),
  )

const ENTITLED = { plan: 'business', billingStatus: 'active', entitlements: { features: { aiGenerative: true } } }

beforeEach(() => {
  mockPermission = { 'ai.generate': true, 'billing.manage': true }
  mockFlags = { release_ai_generative: true, release_addon_store: true }
  mockSiteOff = false
  mockOrg = ENTITLED
  mockMember = { role: 'owner' }
  mockActiveJobs = []
  mockJob = null
  mockCollections = []
  mockUsage = {}
  mockGate.mockReset()
})

describe('GET /api/ai/create', () => {
  it('refuses a kind the apps do not draw, a missing site and a missing credential', async () => {
    expect((await door({ kind: 'email' })).status).toBe(400)
    expect((await door({ kind: 'page', hostId: '' })).status).toBe(400)
    expect((await door({ kind: 'page' }, null)).status).toBe(401)
    expect((await door({ kind: 'page', orgId: 'org-2' })).status).toBe(403)
  })

  it('draws the brief for an entitled member, with the band’s credits left', async () => {
    mockUsage = { estCostUsd: 1 }
    const view = await (await door({ kind: 'layout' })).json()
    expect(view.door).toBe('create')
    expect(view.copy.submit).toBe('Plan the layout')
    expect(view.credits).toEqual({ text: '6,500 of 7,500 AI credits left this month.', exhausted: false })
  })

  it.each([
    ['without ai.generate on the site', () => (mockPermission['ai.generate'] = false)],
    ['while the release flag is off', () => (mockFlags['release_ai_generative'] = false)],
    ['on a site that switched AI off', () => (mockSiteOff = true)],
  ])('draws nothing %s', async (_label, arrange) => {
    arrange()
    const view = await (await door({ kind: 'page' })).json()
    expect(view.door).toBe('hidden')
  })

  it('opens on every paid plan against its own credits: one pool (AGL-3965)', async () => {
    mockOrg = { plan: 'business', billingStatus: 'active' }
    expect((await (await door({ kind: 'form' })).json()).door).toBe('create')
    mockOrg = { plan: 'starter', billingStatus: 'active' }
    expect((await (await door({ kind: 'form' })).json()).door).toBe('create')
  })

  it('is the add-on’s offer where generation is closed on a plan that sells tiers, with the action only for billing managers', async () => {
    // Since AGL-3965 no plan lacks generation; a per-org override closing it
    // is what reaches this door.
    mockOrg = {
      plan: 'business',
      billingStatus: 'active',
      entitlements: { features: { aiGenerative: false } },
    }
    const owner = await (await door({ kind: 'form' })).json()
    expect(owner.door).toBe('upsell')
    expect(owner.upsell.action).toMatch(/^Add /)
    mockPermission['billing.manage'] = false
    const editor = await (await door({ kind: 'form' })).json()
    expect(editor.upsell.action).toBeNull()
    mockFlags['release_addon_store'] = false
    expect((await (await door({ kind: 'form' })).json()).door).toBe('hidden')
  })

  it('says what a Free workspace has left, which spends its taste through the same door', async () => {
    mockOrg = { plan: 'free' }
    const view = await (await door({ kind: 'component' })).json()
    expect(view.door).toBe('create')
    expect(view.credits.text).toBe('You have 120 of your 300 free AI credits left this month, until November 1.')
  })

  it('lists the site’s content collections for a template', async () => {
    mockCollections = [
      { id: 'c2', data: { displayName: 'Team' } },
      { id: 'c1', data: { name: 'Articles' } },
    ]
    const view = await (await door({ kind: 'template' })).json()
    expect(view.collections.options).toEqual([
      { id: 'c1', name: 'Articles' },
      { id: 'c2', name: 'Team' },
    ])
  })

  it('warns a page’s brief while another page is being built on the site', async () => {
    mockActiveJobs = [
      { $id: 'other', hostId: 'host-1', kind: 'page', status: 'running', steps: [{ name: 'page', status: 'running' }] },
    ]
    const view = await (await door({ kind: 'page' })).json()
    expect(view.building).toBe('A page is already being built. Wait for it, or start another anyway.')
  })
})

describe('GET /api/ai/create/:jobId', () => {
  const follow = (jobId = 'job-1') =>
    GET_FOLLOW(new Request(`https://app.aglyn.com/api/ai/create/${jobId}?orgId=org-1`), {
      params: Promise.resolve({ jobId }),
    })

  it('answers what the jobs gate refuses', async () => {
    mockGate.mockResolvedValue(Response.json({ error: 'Not found' }, { status: 404 }))
    expect((await follow()).status).toBe(404)
  })

  it('reads one job of the workspace’s as the follow card does', async () => {
    mockGate.mockResolvedValue({ firestore: {}, orgId: 'org-1', org: { slug: 'acme' }, staff: false })
    mockJob = {
      $id: 'job-1',
      orgId: 'org-1',
      hostId: 'host-1',
      kind: 'layout',
      status: 'done',
      steps: [{ name: 'plan', status: 'done' }],
      outputs: [{ resource: 'layout', id: 'l1', versionId: 'v1', hostId: 'host-1', hostSubdomain: 'roofs', label: 'Site frame' }],
      creditsSpent: 12,
      plan: null,
      review: null,
    }
    const payload = await (await follow()).json()
    expect(payload.job.id).toBe('job-1')
    expect(payload.view.phase).toBe('done')
    expect(payload.view.open).toEqual({
      label: 'Open Site frame',
      detail: '/acme/hosts/roofs/layouts/l1',
      besigner: '/acme/hosts/roofs/layouts/l1/versions/v1/besigner',
    })
  })

  it('answers 404 for a job the workspace does not hold, or an id that is not one', async () => {
    mockGate.mockResolvedValue({ firestore: {}, orgId: 'org-1', org: {}, staff: false })
    expect((await follow()).status).toBe(404)
    expect((await follow('../x')).status).toBe(404)
  })
})
