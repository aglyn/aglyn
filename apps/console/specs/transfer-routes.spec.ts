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
 * `/api/transfer/*` (AGL-3524) — the gate every route shares, and the
 * wiring. The gate is pinned in the order it decides: the method, the
 * workspace, the credential, the verified address, the rate limit, the site,
 * the lockdown, the workspace's existence, then the member's access for the
 * route's intent (AGL-3546): `data.manage` to import (on the job's site for
 * a site's records); to export, what the resource declares — any member,
 * a `readPermission`, or `data.manage` by default — and last the
 * workspace's plan, for a resource that declares a `featureFlag` (AGL-3555).
 * Past it a route only hands the body to the engine,
 * so what is asserted is that the engine's refusals come back with their
 * status, code and details, that Apply is audited only when a job starts,
 * and that the result file is CSV with its row count.
 */

export {}

let mockOrg: Record<string, unknown> | null = null
let mockHosts: Record<string, Record<string, unknown>> = {}
let mockJobs: Record<string, Record<string, unknown>> = {}
let mockLockdownResponse: Response | null = null
/** The workspace permissions the caller holds. */
let mockOrgPermissions = new Set<string>(['data.manage'])
/** The intent the lockdown verdict was asked with, and a read-only lock that refuses only writes. */
const mockLockdownIntents: string[] = []
let mockReadOnlyLock = false
let mockHostPermission = true
let mockRateAllowed = true
let mockMember: Record<string, unknown> = { role: 'editor' }
const mockExport = jest.fn()
const mockVerifyIdToken = jest.fn()
const mockAudit = jest.fn()
const mockHostPermissionCall = jest.fn()
const mockEngine = {
  uploadTransferSource: jest.fn(),
  applyTransferJob: jest.fn(),
  readTransferJobStatus: jest.fn(),
  transferResultFile: jest.fn(),
  readTransferResourceInfo: jest.fn(),
}

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The plan tables the CRM's `suite-gate.ts` answers from.
  ...jest.requireActual('@aglyn/aglyn/app-utils/plan-entitlements'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/organizations'),
  ...jest.requireActual('@aglyn/aglyn/app-utils/scope-tokens'),
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body: request.method === 'POST' ? await request.json() : null,
    headers: Object.fromEntries(request.headers),
    query: {},
  }),
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args) }),
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            collection: () => ({
              doc: (jobId: string) => ({
                get: async () => ({ exists: jobId in mockJobs, data: () => mockJobs[jobId] }),
              }),
            }),
          }),
        }),
      }),
      storage: () => ({ bucket: () => ({}) }),
    }),
  },
  consumeRateLimit: async () => ({ allowed: mockRateAllowed, resetMs: Date.now() + 30_000 }),
  emailUnverifiedResponse: () => Response.json({ error: 'Verify your email' }, { status: 403 }),
  getHostDocAdmin: async (hostId: string) => mockHosts[hostId] ?? null,
  getOrgDoc: async () => mockOrg,
  isImpersonationSession: () => false,
  lockdownRefusal: async ({ intent }: { intent: string }) => {
    mockLockdownIntents.push(intent)
    if (mockReadOnlyLock && intent === 'write') return Response.json({ error: 'read-only' }, { status: 423 })
    return mockLockdownResponse
  },
  memberHasOrgPermission: async (_orgId: string, member: unknown, permission: string) =>
    Boolean(member) && mockOrgPermissions.has(permission),
  memberHasPermissionOnHost: async (...args: unknown[]) => {
    mockHostPermissionCall(...args)
    return mockHostPermission
  },
  resolveOrgMembership: async () => ({ member: mockMember }),
}))

jest.mock('@aglyn/tenant-data-admin/server/admin-audit-write', () => ({
  __esModule: true,
  addAdminAudit: (...args: unknown[]) => mockAudit(...args),
}))

jest.mock('@aglyn/tenant-data-admin/server/id-token-refusal', () => ({
  __esModule: true,
  invalidIdTokenResponse: (error: { code?: string }) =>
    error?.code === 'auth/id-token-expired' ? Response.json({ error: 'Unauthenticated' }, { status: 401 }) : null,
}))

jest.mock('@aglyn/tenant-data-admin/server/transfer-jobs', () => {
  class TransferEngineError extends Error {
    code: string
    status: number
    details?: unknown
    constructor(code: string, status: number, message: string, details?: unknown) {
      super(message)
      this.code = code
      this.status = status
      this.details = details
    }
  }
  class TransferPlanRefusedError extends TransferEngineError {
    refusal: { status: number; body: { error: string } }
    constructor(refusal: { status: number; body: { error: string } }) {
      super('planRequired', refusal.status, refusal.body.error, refusal.body)
      this.refusal = refusal
    }
  }
  return {
    __esModule: true,
    TransferEngineError,
    TransferPlanRefusedError,
    uploadTransferSource: (...args: unknown[]) => mockEngine.uploadTransferSource(...args),
    applyTransferJob: (...args: unknown[]) => mockEngine.applyTransferJob(...args),
    readTransferJobStatus: (...args: unknown[]) => mockEngine.readTransferJobStatus(...args),
    transferResultFile: (...args: unknown[]) => mockEngine.transferResultFile(...args),
    readTransferResourceInfo: (...args: unknown[]) => mockEngine.readTransferResourceInfo(...args),
  }
})

// Every member reads bottles (as every member reads a dataset); ledgers
// declare the permission they read with; kegs declare nothing, so they
// export for Manage data alone. Every other key is a real declaration —
// the CRM's, for Settings → Privacy (AGL-3552) and its plan (AGL-3555).
jest.mock('@aglyn/aglyn/plugin-manager/plugin-transfer-resources', () => {
  const actual = jest.requireActual('@aglyn/aglyn/plugin-manager/plugin-transfer-resources') as Record<
    string,
    (key: string) => unknown
  >
  const fixtures: Record<string, unknown> = {
    bottles: { key: 'bottles', scope: 'org', pluginId: 'cellar', readableByMembers: true },
    ledgers: { key: 'ledgers', scope: 'org', pluginId: 'books', readPermission: 'books.read' },
    kegs: { key: 'kegs', scope: 'org', pluginId: 'cellar' },
  }
  return {
    ...actual,
    __esModule: true,
    declaredTransferResource: (key: string) => fixtures[key] ?? actual['declaredTransferResource']?.(key),
  }
})

jest.mock('@aglyn/tenant-data-admin/server/transfer-export', () => ({
  __esModule: true,
  streamTransferExport: (...args: unknown[]) => mockExport(...args),
  readTransferPrefs: async () => null,
}))

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => 'now' },
}))

import { TransferEngineError, TransferPlanRefusedError } from '@aglyn/tenant-data-admin/server/transfer-jobs'
import { hostScopeToken } from '@aglyn/aglyn/app-utils/scope-tokens'
import { POST as analyze } from '../app/api/transfer/analyze/route'
import { POST as apply } from '../app/api/transfer/apply/route'
import { POST as exportRoute } from '../app/api/transfer/export/route'
import { POST as fields } from '../app/api/transfer/fields/route'
import { POST as plan } from '../app/api/transfer/plan/route'
import { POST as status } from '../app/api/transfer/status/route'
import { POST as undo } from '../app/api/transfer/undo/route'
import { POST as upload } from '../app/api/transfer/upload/route'

const request = (route: string, body: Record<string, unknown>, headers: Record<string, string> = { authorization: 'Bearer token' }) =>
  new Request(`https://app.example.com/api/transfer/${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })

const JOB = { id: 'job-1', resource: 'bottles', status: 'applying', cursor: { chunk: 0 } }
const PROGRESS = { status: 'applying', chunk: 1, chunkCount: 3, rowsDone: 200, rowCount: 450, results: {} }

beforeEach(() => {
  mockOrg = { $id: 'org-1' }
  mockHosts = { 'host-a': { orgId: 'org-1' }, 'host-z': { orgId: 'org-2' } }
  mockJobs = { 'job-1': {}, 'job-site': { hostId: 'host-a' } }
  mockLockdownResponse = null
  mockOrgPermissions = new Set(['data.manage'])
  mockLockdownIntents.length = 0
  mockReadOnlyLock = false
  mockHostPermission = true
  mockRateAllowed = true
  mockMember = { role: 'editor' }
  mockExport.mockReset().mockImplementation(async () => ({
    stream: new Blob(['Name\r\nAda\r\n']).stream(),
    rows: 1,
    fileName: 'bottles-2026-10-05.csv',
    contentType: 'text/csv',
    fieldIds: ['name'],
    label: 'Bottles',
  }))
  mockVerifyIdToken.mockReset().mockResolvedValue({ uid: 'uid-1', email: 'a@b.test', email_verified: true })
  mockAudit.mockReset().mockResolvedValue(undefined)
  mockHostPermissionCall.mockReset()
  for (const fn of Object.values(mockEngine)) fn.mockReset()
  mockEngine.applyTransferJob.mockResolvedValue({ job: JOB, progress: PROGRESS, done: false, started: true })
})

describe('the transfer gate', () => {
  it('refuses a missing workspace, a missing credential and a refused one', async () => {
    expect((await apply(request('apply', { jobId: 'job-1' }))).status).toBe(400)
    const missing = await apply(request('apply', { orgId: 'org-1', jobId: 'job-1' }, {}))
    expect(missing.status).toBe(401)
    expect(await missing.json()).toEqual({ error: 'Unauthenticated', code: 'unauthenticated' })
    mockVerifyIdToken.mockRejectedValue(Object.assign(new Error('expired'), { code: 'auth/id-token-expired' }))
    expect((await apply(request('apply', { orgId: 'org-1', jobId: 'job-1' }))).status).toBe(401)
    expect(mockEngine.applyTransferJob).not.toHaveBeenCalled()
  })

  it('refuses an unverified address, a spent rate limit, a lockdown and a missing workspace', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'uid-1', email_verified: false })
    expect((await apply(request('apply', { orgId: 'org-1', jobId: 'job-1' }))).status).toBe(403)
    mockVerifyIdToken.mockResolvedValue({ uid: 'uid-1', email_verified: true })

    mockRateAllowed = false
    const limited = await apply(request('apply', { orgId: 'org-1', jobId: 'job-1' }))
    expect(limited.status).toBe(429)
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0)
    mockRateAllowed = true

    mockLockdownResponse = Response.json({ error: 'locked' }, { status: 423 })
    expect((await apply(request('apply', { orgId: 'org-1', jobId: 'job-1' }))).status).toBe(423)
    mockLockdownResponse = null

    mockOrg = null
    expect((await apply(request('apply', { orgId: 'org-1', jobId: 'job-1' }))).status).toBe(404)
    expect(mockEngine.applyTransferJob).not.toHaveBeenCalled()
  })

  it('needs data.manage on the workspace, or on the job’s site for a site’s records', async () => {
    mockOrgPermissions.clear()
    const refused = await apply(request('apply', { orgId: 'org-1', jobId: 'job-1' }))
    expect(refused.status).toBe(403)
    expect((await refused.json()).code).toBe('forbidden')

    // A site's job is decided on the site, where a collaborator may hold it.
    const admitted = await apply(request('apply', { orgId: 'org-1', jobId: 'job-site' }))
    expect(admitted.status).toBe(200)
    expect(mockHostPermissionCall).toHaveBeenCalledWith('org-1', 'host-a', { role: 'editor' }, 'data.manage')

    // An upload naming another workspace's site is refused before anything runs.
    const foreign = await upload(request('upload', { orgId: 'org-1', resource: 'bottles', hostId: 'host-z', fileName: 'x.csv', content: 'a\n1' }))
    expect(foreign.status).toBe(404)
    expect(mockEngine.uploadTransferSource).not.toHaveBeenCalled()
  })
})

describe('the routes', () => {
  it('hands Apply a budget and a driver, and audits only the call that starts the job', async () => {
    const before = Date.now()
    const answer = await apply(request('apply', { orgId: 'org-1', jobId: 'job-1', acknowledged: ['overwriteNonBlank'] }))
    expect(answer.status).toBe(200)
    expect(await answer.json()).toEqual({ ok: true, job: JOB, progress: PROGRESS, done: false })
    const input = mockEngine.applyTransferJob.mock.calls[0][1]
    expect(input).toMatchObject({ orgId: 'org-1', jobId: 'job-1', actorUid: 'uid-1', acknowledged: ['overwriteNonBlank'] })
    expect(input.deadlineMs).toBeGreaterThanOrEqual(before + 45_000)
    expect(input.driver).toMatch(/^request:/)
    expect(mockAudit).toHaveBeenCalledTimes(1)
    expect(mockAudit.mock.calls[0][1]).toMatchObject({
      actorUid: 'uid-1',
      action: 'data.transfer.apply',
      target: 'orgs/org-1/transferJobs/job-1',
    })

    mockEngine.applyTransferJob.mockResolvedValue({ job: JOB, progress: PROGRESS, done: true, started: false })
    await apply(request('apply', { orgId: 'org-1', jobId: 'job-1' }))
    expect(mockAudit).toHaveBeenCalledTimes(1)
  })

  it('answers the engine’s refusal with its status, code and details', async () => {
    mockEngine.applyTransferJob.mockRejectedValue(
      new TransferEngineError('acknowledgementsMissing', 422, 'Acknowledge every warning before applying.', {
        missing: ['clearValue'],
      }),
    )
    const refused = await apply(request('apply', { orgId: 'org-1', jobId: 'job-1' }))
    expect(refused.status).toBe(422)
    expect(await refused.json()).toEqual({
      error: 'Acknowledge every warning before applying.',
      code: 'acknowledgementsMissing',
      details: { missing: ['clearValue'] },
    })
    expect(mockAudit).not.toHaveBeenCalled()

    mockEngine.applyTransferJob.mockRejectedValue(new Error('firestore went away'))
    const failed = await apply(request('apply', { orgId: 'org-1', jobId: 'job-1' }))
    expect(failed.status).toBe(500)
    expect(await failed.json()).toEqual({ error: 'The import step failed. Try again.', code: 'failed' })
  })

  it('answers the result file as CSV with its row count', async () => {
    mockEngine.transferResultFile.mockResolvedValue({ csv: 'Name,Outcome\r\nAda,created\r\n', rows: 1, fileName: 'people-results.csv' })
    const file = await status(request('status', { orgId: 'org-1', jobId: 'job-1', download: 'results' }))
    expect(file.status).toBe(200)
    expect(file.headers.get('Content-Type')).toBe('text/csv; charset=utf-8')
    expect(file.headers.get('Content-Disposition')).toBe('attachment; filename="people-results.csv"')
    expect(file.headers.get('X-Aglyn-Export-Rows')).toBe('1')
    expect(await file.text()).toBe('Name,Outcome\r\nAda,created\r\n')
  })
})

describe('the export (AGL-3525)', () => {
  const BODY = { orgId: 'org-1', resource: 'bottles', fieldIds: ['name'], scope: { kind: 'all' }, format: 'csv', bom: false }

  beforeEach(() => {
    mockMember = { role: 'admin' }
  })

  it('streams the file with its row count, and audits what left without its content', async () => {
    const response = await exportRoute(request('export', BODY))
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('text/csv; charset=utf-8')
    expect(response.headers.get('X-Aglyn-Export-Rows')).toBe('1')
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="bottles-2026-10-05.csv"')
    expect(await response.text()).toBe('Name\r\nAda\r\n')
    expect(mockExport.mock.calls[0]?.[1]).toMatchObject({ orgId: 'org-1', actorUid: 'uid-1', resource: 'bottles', hostId: null })
    expect(mockExport.mock.calls[0]?.[1]).not.toHaveProperty('scopeTokens')
    expect(mockAudit.mock.calls[0]?.[1]).toMatchObject({
      action: 'data.transfer.export',
      target: 'orgs/org-1/transfer/bottles',
      after: { resource: 'bottles', fields: 1, scope: 'all', format: 'csv', rows: 1 },
    })
  })

  it('sends no count it could not take, and answers an engine refusal with its code', async () => {
    mockExport.mockImplementationOnce(async () => ({
      stream: new Blob(['[]']).stream(), rows: null, fileName: 'b.json', contentType: 'application/json', fieldIds: ['id'], label: 'B',
    }))
    const uncounted = await exportRoute(request('export', { ...BODY, format: 'json' }))
    expect(uncounted.headers.get('X-Aglyn-Export-Rows')).toBeNull()
    mockExport.mockRejectedValueOnce(new TransferEngineError('tooLarge', 413, 'Select fewer.'))
    const refused = await exportRoute(request('export', { ...BODY, scope: { kind: 'selection', ids: ['a'] } }))
    expect(refused.status).toBe(413)
    expect(await refused.json()).toEqual({ error: 'Select fewer.', code: 'tooLarge' })
  })

  it('reads a scoped collaborator through their own tokens, and only on a site they reach', async () => {
    mockMember = { role: 'editor', allHosts: false, hostAccess: { 'host-a': 'editor' }, scopeTokens: [hostScopeToken('host-a')] }
    await exportRoute(request('export', BODY))
    expect(mockExport.mock.calls[0]?.[1]).toMatchObject({ scopeTokens: [hostScopeToken('host-a')] })

    mockHosts['host-b'] = { orgId: 'org-1' }
    const elsewhere = await exportRoute(request('export', { ...BODY, hostId: 'host-b' }))
    expect(elsewhere.status).toBe(404)
    expect(mockExport).toHaveBeenCalledTimes(1)
  })

})

describe('who may export, and who may import (AGL-3546)', () => {
  const EXPORT = { orgId: 'org-1', resource: 'bottles', fieldIds: ['name'], scope: { kind: 'all' }, format: 'csv' }
  const FIELDS = { orgId: 'org-1', resource: 'bottles' }
  const INFO = { resource: { key: 'bottles', label: 'Bottles' }, catalog: { fields: [], groups: [] } }

  beforeEach(() => {
    mockEngine.readTransferResourceInfo.mockResolvedValue(INFO)
  })

  it('lets a member with Manage data export and import', async () => {
    expect((await exportRoute(request('export', EXPORT))).status).toBe(200)
    expect((await fields(request('fields', FIELDS))).status).toBe(200)
    expect((await apply(request('apply', { orgId: 'org-1', jobId: 'job-1' }))).status).toBe(200)
  })

  it('lets a read-only member export and open the export dialog, and refuses them every import step', async () => {
    mockMember = { role: 'viewer' }
    mockOrgPermissions.clear()
    const exported = await exportRoute(request('export', EXPORT))
    expect(exported.status).toBe(200)
    // An org-wide reader is read whole; their scope is the workspace.
    expect(mockExport.mock.calls[0]?.[1]).not.toHaveProperty('scopeTokens')
    const opened = await fields(request('fields', FIELDS))
    expect(opened.status).toBe(200)
    expect(await opened.json()).toMatchObject({ ok: true, resource: { key: 'bottles' } })

    const applied = await apply(request('apply', { orgId: 'org-1', jobId: 'job-1' }))
    expect(applied.status).toBe(403)
    expect(await applied.json()).toEqual({ error: 'Importing needs the “Manage data” permission', code: 'forbidden' })
    expect((await status(request('status', { orgId: 'org-1', jobId: 'job-1' }))).status).toBe(403)
    const uploaded = await upload(request('upload', { orgId: 'org-1', resource: 'bottles', fileName: 'x.csv', content: 'a\n1' }))
    expect(uploaded.status).toBe(403)
    expect(mockEngine.uploadTransferSource).not.toHaveBeenCalled()
    expect(mockEngine.applyTransferJob).not.toHaveBeenCalled()
  })

  it('reads a scoped collaborator through their tokens, refuses a site they do not reach, and refuses their import', async () => {
    mockMember = { role: 'editor', allHosts: false, hostAccess: { 'host-a': 'viewer' }, scopeTokens: [hostScopeToken('host-a')] }
    mockOrgPermissions.clear()
    mockHostPermission = false
    expect((await exportRoute(request('export', EXPORT))).status).toBe(200)
    expect(mockExport.mock.calls[0]?.[1]).toMatchObject({ scopeTokens: [hostScopeToken('host-a')] })
    expect((await exportRoute(request('export', { ...EXPORT, hostId: 'host-a' }))).status).toBe(200)
    expect((await fields(request('fields', { ...FIELDS, hostId: 'host-a' }))).status).toBe(200)

    mockHosts['host-b'] = { orgId: 'org-1' }
    expect((await exportRoute(request('export', { ...EXPORT, hostId: 'host-b' }))).status).toBe(404)
    expect((await fields(request('fields', { ...FIELDS, hostId: 'host-b' }))).status).toBe(404)
    expect(mockExport).toHaveBeenCalledTimes(2)

    expect((await apply(request('apply', { orgId: 'org-1', jobId: 'job-site' }))).status).toBe(403)
    expect(mockEngine.applyTransferJob).not.toHaveBeenCalled()
  })

  it('still exports under a read-only lock, which refuses the import', async () => {
    mockReadOnlyLock = true
    expect((await exportRoute(request('export', EXPORT))).status).toBe(200)
    expect((await fields(request('fields', FIELDS))).status).toBe(200)
    expect((await apply(request('apply', { orgId: 'org-1', jobId: 'job-1' }))).status).toBe(423)
    expect(mockLockdownIntents).toEqual(['read', 'read', 'write'])
  })

  it('asks for the permission a resource declares it reads with, which Manage data also grants', async () => {
    const LEDGERS = { ...EXPORT, resource: 'ledgers' }
    mockMember = { role: 'viewer' }
    mockOrgPermissions.clear()
    const refused = await exportRoute(request('export', LEDGERS))
    expect(refused.status).toBe(403)
    expect((await refused.json()).code).toBe('forbidden')
    expect((await fields(request('fields', { ...FIELDS, resource: 'ledgers' }))).status).toBe(403)
    // An instance key is decided by its resource's declaration.
    expect((await exportRoute(request('export', { ...LEDGERS, resource: 'ledgers:2026' }))).status).toBe(403)
    expect(mockExport).not.toHaveBeenCalled()

    mockOrgPermissions = new Set(['books.read'])
    expect((await exportRoute(request('export', LEDGERS))).status).toBe(200)
    mockOrgPermissions = new Set(['data.manage'])
    expect((await exportRoute(request('export', LEDGERS))).status).toBe(200)
  })

  it('keeps Manage data the key for a resource that says nothing about who reads it', async () => {
    const KEGS = { ...EXPORT, resource: 'kegs' }
    mockMember = { role: 'viewer' }
    mockOrgPermissions.clear()
    const refused = await exportRoute(request('export', KEGS))
    expect(refused.status).toBe(403)
    expect(await refused.json()).toEqual({ error: 'Exporting needs the “Manage data” permission', code: 'forbidden' })
    expect((await fields(request('fields', { ...FIELDS, resource: 'kegs' }))).status).toBe(403)
    expect(mockExport).not.toHaveBeenCalled()
    mockOrgPermissions = new Set(['data.manage'])
    expect((await exportRoute(request('export', KEGS))).status).toBe(200)
  })

  it('refuses a caller who is not a member of the workspace', async () => {
    mockMember = null as never
    expect((await exportRoute(request('export', EXPORT))).status).toBe(403)
    expect((await fields(request('fields', FIELDS))).status).toBe(403)
    expect(mockExport).not.toHaveBeenCalled()
  })
})

/*
 * SETTINGS → PRIVACY'S PEOPLE FILES (AGL-3552). Exporting every contact and
 * every lead is a workspace's obligation on every plan, and the retired
 * `/api/crm/export` handed them to a member holding "Manage data" whatever
 * the plan: the transfer route must admit the same members, on Free, and
 * refuse the same ones.
 */
describe('the people files, on every plan (AGL-3552)', () => {
  const people = (resource: string) => ({ orgId: 'org-1', resource, fieldIds: ['email'], scope: { kind: 'all' }, format: 'csv' })

  beforeEach(() => {
    mockOrg = { $id: 'org-1', plan: 'free' }
    mockEngine.readTransferResourceInfo.mockResolvedValue({
      resource: { key: 'crm.contacts', label: 'Contacts' },
      catalog: { fields: [], groups: [] },
    })
  })

  it('hands a Free workspace’s manager every contact and every lead, read whole', async () => {
    for (const resource of ['crm.contacts', 'crm.leads']) {
      expect((await exportRoute(request('export', people(resource)))).status).toBe(200)
      expect((await fields(request('fields', { orgId: 'org-1', resource }))).status).toBe(200)
    }
    expect(mockExport).toHaveBeenCalledTimes(2)
    for (const [, input] of mockExport.mock.calls) {
      expect(input).toMatchObject({ orgId: 'org-1', hostId: null, scope: { kind: 'all' } })
      expect(input).not.toHaveProperty('scopeTokens')
    }
  })

  it('refuses a member without Manage data, as the retired route did', async () => {
    mockMember = { role: 'viewer' }
    mockOrgPermissions.clear()
    for (const resource of ['crm.contacts', 'crm.leads']) {
      const refused = await exportRoute(request('export', people(resource)))
      expect(refused.status).toBe(403)
      expect(await refused.json()).toEqual({ error: 'Exporting needs the “Manage data” permission', code: 'forbidden' })
    }
    expect(mockExport).not.toHaveBeenCalled()
  })
})


/*
 * THE CRM IS PAID-ONLY (AGL-3555, the 2026-09-11 decision): every CRM
 * resource refuses on a workspace without the CRM, on every transfer route
 * that names it — fields, export, upload, and the job's analyze, plan,
 * apply, status and undo — with the CRM routes' own answer (`suite-gate.ts`:
 * 403, `reason: 'plan_required'`, `code: 'crm'`), staff included. Only the
 * contacts and leads EXPORTS stay on every plan. Starter moves all of it.
 * The resources are the CRM's real declarations and registrations.
 */
describe('the CRM’s plan (AGL-3555)', () => {
  const CRM = ['crm.contacts', 'crm.companies', 'crm.leads', 'crm.deals', 'crm.tasks', 'crm.activities', 'crm.pipelines', 'crm.fields']
  const PEOPLE = new Set(['crm.contacts', 'crm.leads'])
  const IMPORTED = CRM.filter((key) => !['crm.activities', 'crm.pipelines', 'crm.fields'].includes(key))
  const exportBody = (resource: string) => ({ orgId: 'org-1', resource, fieldIds: ['id'], scope: { kind: 'all' }, format: 'csv' })
  const planRequired = async (response: Response) => {
    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body).toEqual({ error: expect.stringMatching(/ is part of the CRM, which is not included in your current plan\./), reason: 'plan_required', code: 'crm' })
    return body as { error: string }
  }

  beforeAll(() => {
    ;(
      jest.requireActual('../../../libs/plugins/crm/src/lib/transfer/register') as {
        registerCrmTransferResources(pluginId: string): void
      }
    ).registerCrmTransferResources('crm')
  })

  beforeEach(() => {
    mockOrg = { $id: 'org-1', plan: 'free' }
    mockMember = { role: 'admin' }
    mockEngine.readTransferResourceInfo.mockResolvedValue({ resource: { key: 'crm.contacts', label: 'Contacts' } })
    mockEngine.uploadTransferSource.mockResolvedValue({ job: JOB, preview: {} })
  })

  it.each(CRM)('refuses exporting %s on Free unless it is a people file', async (resource) => {
    const exported = await exportRoute(request('export', exportBody(resource)))
    const opened = await fields(request('fields', { orgId: 'org-1', resource }))
    if (PEOPLE.has(resource)) {
      expect(exported.status).toBe(200)
      expect(opened.status).toBe(200)
      return
    }
    const body = await planRequired(exported)
    expect(body.error).toMatch(/^Exporting /)
    await planRequired(opened)
  })

  it.each(IMPORTED)('refuses importing %s on Free, the people files too, at every step', async (resource) => {
    const uploaded = await upload(request('upload', { orgId: 'org-1', resource, hostId: 'host-a', fileName: 'x.csv', content: 'a\n1' }))
    expect((await planRequired(uploaded)).error).toMatch(/^Importing /)
    mockJobs['job-crm'] = { resource, hostId: 'host-a' }
    for (const route of [analyze, plan, apply, status, undo]) {
      await planRequired(await route(request('step', { orgId: 'org-1', jobId: 'job-crm' })))
    }
    expect(mockEngine.uploadTransferSource).not.toHaveBeenCalled()
    expect(mockEngine.applyTransferJob).not.toHaveBeenCalled()
    expect(mockEngine.readTransferJobStatus).not.toHaveBeenCalled()
  })

  it('refuses staff too: the plan is the workspace’s', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'uid-staff', email: 's@aglyn.test', email_verified: true, staff: true })
    await planRequired(await exportRoute(request('export', exportBody('crm.deals'))))
    expect((await exportRoute(request('export', exportBody('crm.contacts')))).status).toBe(200)
  })

  it('asks after the member, so a caller without access learns nothing of the plan', async () => {
    mockOrgPermissions.clear()
    mockHostPermission = false
    const refused = await upload(request('upload', { orgId: 'org-1', resource: 'crm.deals', hostId: 'host-a', fileName: 'x.csv', content: 'a\n1' }))
    expect(refused.status).toBe(403)
    expect((await refused.json()).code).toBe('forbidden')
  })

  it('answers a refusal the engine raises for the plan as that same body', async () => {
    mockOrg = { $id: 'org-1', plan: 'starter' }
    const body = { error: 'Importing companies is part of the CRM.', reason: 'plan_required', code: 'crm' }
    mockEngine.applyTransferJob.mockRejectedValue(new TransferPlanRefusedError({ status: 403, body } as never))
    const refused = await apply(request('apply', { orgId: 'org-1', jobId: 'job-1' }))
    expect(refused.status).toBe(403)
    expect(await refused.json()).toEqual(body)
  })

  it.each(CRM)('moves %s both ways on Starter', async (resource) => {
    mockOrg = { $id: 'org-1', plan: 'starter' }
    expect((await exportRoute(request('export', exportBody(resource)))).status).toBe(200)
    expect((await fields(request('fields', { orgId: 'org-1', resource }))).status).toBe(200)
    if (!IMPORTED.includes(resource)) return
    expect((await upload(request('upload', { orgId: 'org-1', resource, hostId: 'host-a', fileName: 'x.csv', content: 'a\n1' }))).status).toBe(200)
    mockJobs['job-crm'] = { resource, hostId: 'host-a' }
    expect((await apply(request('apply', { orgId: 'org-1', jobId: 'job-crm' }))).status).toBe(200)
  })
})
