/**
 * @jest-environment node
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
 * `/api/transfer/package` and `/api/transfer/jobs` (AGL-3535) — the wiring
 * over the workspace package engine and the history. What is asserted: the
 * package route offers only the package resources of plugins the workspace
 * runs; `list` and `export` pass a read-only lock while `plan`, `apply` and
 * `undo` do not; each step that decides or writes is audited (apply and
 * undo only when they start); and the history reads each site's package
 * imports only on its first page, with undo open only inside the window.
 */

export {}

let mockOrg: Record<string, unknown> | null = null
const mockIntents: string[] = []
const mockVerifyIdToken = jest.fn()
const mockAudit = jest.fn()
const mockPackages = {
  listTransferPackageItems: jest.fn(),
  exportTransferPackage: jest.fn(),
  planTransferPackageImport: jest.fn(),
  applyTransferPackage: jest.fn(),
  planTransferPackageUndo: jest.fn(),
  applyTransferPackageUndo: jest.fn(),
}
const mockListJobs = jest.fn()
let mockSiteImports: Array<{ hostId: string; id: string; data: Record<string, unknown> }> = []

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body: request.method === 'POST' ? await request.json() : null,
    headers: Object.fromEntries(request.headers),
    query: {},
  }),
}))

jest.mock('@aglyn/aglyn/plugin-manager/plugin-transfer-resources', () => ({
  __esModule: true,
  listTransferResourcesFor: (subject: { org: { enabledPlugins?: string[] } }) =>
    [
      { pluginId: 'outreach', key: 'outreach.sequences', label: 'Sequences', scope: 'org', kinds: ['package'], formats: ['json'] },
      { pluginId: 'crm', key: 'crm.contacts', label: 'Contacts', scope: 'org', kinds: ['records'], formats: ['csv'] },
      { pluginId: 'crm', key: 'crm.email-templates', label: 'Email templates', scope: 'org', kinds: ['package'], formats: ['json'] },
    ].filter((one) => subject.org.enabledPlugins?.includes(one.pluginId)),
  listDeclaredTransferResources: () => [{ pluginId: 'crm', key: 'crm.contacts', label: 'Contacts' }],
  // The real plan question, over the real declarations (AGL-3555).
  transferPlanRefusal: jest.requireActual('@aglyn/aglyn/plugin-manager/plugin-transfer-resources').transferPlanRefusal,
}))

const hostDoc = (hostId: string) => ({
  id: hostId,
  get: (field: string) => (field === 'name' ? `Site ${hostId}` : undefined),
  ref: {
    collection: () => ({
      orderBy: () => ({
        limit: () => ({
          get: async () => ({
            docs: mockSiteImports.filter((one) => one.hostId === hostId).map((one) => ({ id: one.id, data: () => one.data })),
          }),
        }),
      }),
    }),
  },
})

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
        getUsers: async (ids: Array<{ uid: string }>) => ({ users: ids.map(({ uid }) => ({ uid, email: `${uid}@x.test` })) }),
      }),
      firestore: () => ({
        collection: (name: string) =>
          name === 'hosts'
            ? { where: () => ({ get: async () => ({ docs: ['host-a', 'host-b'].map(hostDoc) }) }) }
            : {
                doc: () => ({
                  collection: () => ({ doc: () => ({ get: async () => ({ exists: false, data: () => undefined }) }) }),
                }),
              },
      }),
      storage: () => ({ bucket: () => ({}) }),
    }),
  },
  consumeRateLimit: async () => ({ allowed: true, resetMs: Date.now() + 30_000 }),
  emailUnverifiedResponse: () => Response.json({ error: 'Verify your email' }, { status: 403 }),
  getHostDocAdmin: async () => null,
  getOrgDoc: async () => mockOrg,
  isImpersonationSession: () => false,
  lockdownRefusal: async (options: { intent: string }) => {
    mockIntents.push(options.intent)
    return null
  },
  memberHasOrgPermission: async () => true,
  memberHasPermissionOnHost: async () => true,
  resolveOrgMembership: async () => ({ member: { role: 'editor' } }),
}))

jest.mock('@aglyn/tenant-data-admin/server/admin-audit-write', () => ({
  __esModule: true,
  addAdminAudit: (...args: unknown[]) => mockAudit(...args),
}))

jest.mock('@aglyn/tenant-data-admin/server/id-token-refusal', () => ({
  __esModule: true,
  invalidIdTokenResponse: () => null,
}))

jest.mock('@aglyn/tenant-data-admin/server/transfer-jobs', () => ({
  __esModule: true,
  TransferEngineError: class extends Error {},
  listTransferJobs: (...args: unknown[]) => mockListJobs(...args),
}))

jest.mock('@aglyn/tenant-data-admin/server/transfer-packages', () => ({
  __esModule: true,
  listTransferPackageItems: (...args: unknown[]) => mockPackages.listTransferPackageItems(...args),
  exportTransferPackage: (...args: unknown[]) => mockPackages.exportTransferPackage(...args),
  planTransferPackageImport: (...args: unknown[]) => mockPackages.planTransferPackageImport(...args),
  applyTransferPackage: (...args: unknown[]) => mockPackages.applyTransferPackage(...args),
  planTransferPackageUndo: (...args: unknown[]) => mockPackages.planTransferPackageUndo(...args),
  applyTransferPackageUndo: (...args: unknown[]) => mockPackages.applyTransferPackageUndo(...args),
}))

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => 'now' },
}))

import { POST as jobsRoute } from '../app/api/transfer/jobs/route'
import { POST as packageRoute } from '../app/api/transfer/package/route'

const request = (route: string, body: Record<string, unknown>) =>
  new Request(`https://app.example.com/api/transfer/${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer token' },
    body: JSON.stringify(body),
  })

const JOB = { id: 'job-1', resource: 'package', kind: 'package', fileName: 'p.json', package: { summary: {}, acknowledged: [] } }
const PLAN = { items: [], references: [], unknownKinds: [], summary: { create: 1 }, blocking: [], acknowledgementsRequired: [] }

beforeEach(() => {
  mockOrg = { $id: 'org-1', name: 'Acme', plan: 'starter', enabledPlugins: ['outreach', 'crm'] }
  mockIntents.length = 0
  mockSiteImports = []
  mockVerifyIdToken.mockReset().mockResolvedValue({ uid: 'uid-1', email: 'a@b.test', email_verified: true })
  mockAudit.mockReset().mockResolvedValue(undefined)
  for (const fn of Object.values(mockPackages)) fn.mockReset()
  mockListJobs.mockReset().mockResolvedValue({ jobs: [], next: null })
})

describe('the package route', () => {
  it('offers only the package resources of plugins the workspace runs, and lists under a read intent', async () => {
    mockOrg = { $id: 'org-1', plan: 'starter', enabledPlugins: ['crm'] }
    mockPackages.listTransferPackageItems.mockResolvedValue([])
    const answer = await packageRoute(request('package', { orgId: 'org-1', action: 'list' }))
    expect(answer.status).toBe(200)
    expect(mockPackages.listTransferPackageItems.mock.calls[0][1]).toMatchObject({ allowed: ['crm.email-templates'] })
    expect(mockIntents).toEqual(['read'])
  })

  it('leaves the CRM’s email templates out of a Free workspace’s packages, both ways (AGL-3555)', async () => {
    mockOrg = { $id: 'org-1', plan: 'free', enabledPlugins: ['outreach', 'crm'] }
    mockPackages.listTransferPackageItems.mockResolvedValue([])
    mockPackages.planTransferPackageImport.mockResolvedValue({ job: JOB, plan: PLAN, resources: {}, created: true })
    await packageRoute(request('package', { orgId: 'org-1', action: 'list' }))
    await packageRoute(request('package', { orgId: 'org-1', action: 'plan', package: { manifest: {} }, fileName: 'p.json' }))
    expect(mockPackages.listTransferPackageItems.mock.calls[0][1]).toMatchObject({ allowed: ['outreach.sequences'] })
    expect(mockPackages.planTransferPackageImport.mock.calls[0][1]).toMatchObject({ allowed: ['outreach.sequences'] })
  })

  it('exports under a read intent and audits counts, never content', async () => {
    mockPackages.exportTransferPackage.mockResolvedValue({
      manifest: { format: 'aglyn-package', version: 2, items: [{ kind: 'outreach.sequences', $id: 's1' }] },
      items: { 'outreach.sequences/s1': { name: 'Secret copy' } },
    })
    const answer = await packageRoute(request('package', { orgId: 'org-1', action: 'export', items: ['outreach.sequences/s1'] }))
    expect(answer.status).toBe(200)
    expect((await answer.json()).fileName).toMatch(/^package-\d{4}-\d{2}-\d{2}\.json$/)
    expect(mockPackages.exportTransferPackage.mock.calls[0][1]).toMatchObject({ source: 'Workspace: Acme', items: ['outreach.sequences/s1'] })
    expect(mockIntents).toEqual(['read'])
    const audit = mockAudit.mock.calls[0][1]
    expect(audit).toMatchObject({ action: 'data.transfer.export', after: { resource: 'package', items: 1 } })
    expect(JSON.stringify(audit)).not.toContain('Secret copy')
  })

  it('plans under a write intent and audits the plan', async () => {
    mockPackages.planTransferPackageImport.mockResolvedValue({ job: JOB, plan: PLAN, resources: {}, created: true })
    const answer = await packageRoute(request('package', { orgId: 'org-1', action: 'plan', package: { manifest: {} }, fileName: 'p.json' }))
    expect(answer.status).toBe(200)
    expect(mockIntents).toEqual(['write'])
    expect(mockPackages.planTransferPackageImport.mock.calls[0][1]).toMatchObject({
      allowed: ['outreach.sequences', 'crm.email-templates'],
      jobId: null,
      fileName: 'p.json',
    })
    expect(mockAudit.mock.calls[0][1]).toMatchObject({ action: 'data.transfer.plan', target: 'orgs/org-1/transferJobs/job-1' })
  })

  it('audits apply and undo only when they start', async () => {
    mockPackages.applyTransferPackage.mockResolvedValue({ job: JOB, done: true, started: true, resumed: false, results: [] })
    await packageRoute(request('package', { orgId: 'org-1', action: 'apply', jobId: 'job-1', acknowledged: ['replace'] }))
    expect(mockPackages.applyTransferPackage.mock.calls[0][1]).toMatchObject({ jobId: 'job-1', acknowledged: ['replace'] })
    mockPackages.applyTransferPackage.mockResolvedValue({ job: JOB, done: true, started: false, resumed: false, results: [] })
    await packageRoute(request('package', { orgId: 'org-1', action: 'apply', jobId: 'job-1' }))
    mockPackages.applyTransferPackageUndo.mockResolvedValue({ job: JOB, undo: { otherwise: 'keep' }, done: true, started: true })
    await packageRoute(request('package', { orgId: 'org-1', action: 'undo', jobId: 'job-1', otherwise: 'keep' }))
    expect(mockAudit.mock.calls.map((call) => call[1].action)).toEqual(['data.transfer.apply', 'data.transfer.undo'])
  })

  it('refuses an action it does not know', async () => {
    const answer = await packageRoute(request('package', { orgId: 'org-1', action: 'shred' }))
    expect(answer.status).toBe(400)
  })
})

describe('the history route', () => {
  it('names each job, says who ran it, and reads site package imports on the first page only', async () => {
    const now = Date.now()
    mockSiteImports = [
      { hostId: 'host-a', id: 'imp-1', data: { status: 'applied', actorEmail: 'z@x.test', startedAtMs: now - 1000, appliedAtMs: now - 1000, counts: { create: 2 }, items: [{}, {}] } },
      { hostId: 'host-b', id: 'imp-2', data: { status: 'applied', startedAtMs: now - 9 * 86_400_000, appliedAtMs: now - 9 * 86_400_000, counts: {}, items: [] } },
    ]
    const first = await (await jobsRoute(request('jobs', { orgId: 'org-1', sitePackages: true }))).json()
    expect(mockIntents).toEqual(['read'])
    const input = mockListJobs.mock.calls[0][1]
    expect(input.labels).toEqual({ package: 'Package', 'crm.contacts': 'Contacts' })
    expect(await input.emailsOf(['u1'])).toEqual(new Map([['u1', 'u1@x.test']]))
    expect(first.sitePackageImports.map((one: { importId: string; undo: { available: boolean } }) => [one.importId, one.undo.available])).toEqual([
      ['imp-1', true],
      ['imp-2', false],
    ])
    const later = await (await jobsRoute(request('jobs', { orgId: 'org-1', sitePackages: true, after: 5 }))).json()
    expect(later.sitePackageImports).toBeUndefined()
  })
})
