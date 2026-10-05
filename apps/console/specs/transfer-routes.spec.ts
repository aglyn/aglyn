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
 * the lockdown, the workspace's existence, `data.manage` (on the job's site
 * for a site's records). Past it a route only hands the body to the engine,
 * so what is asserted is that the engine's refusals come back with their
 * status, code and details, that Apply is audited only when a job starts,
 * and that the result file is CSV with its row count.
 */

export {}

let mockOrg: Record<string, unknown> | null = null
let mockHosts: Record<string, Record<string, unknown>> = {}
let mockJobs: Record<string, Record<string, unknown>> = {}
let mockLockdownResponse: Response | null = null
let mockOrgPermission = true
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
}

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
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
  lockdownRefusal: async () => mockLockdownResponse,
  memberHasOrgPermission: async () => mockOrgPermission,
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
  return {
    __esModule: true,
    TransferEngineError,
    uploadTransferSource: (...args: unknown[]) => mockEngine.uploadTransferSource(...args),
    applyTransferJob: (...args: unknown[]) => mockEngine.applyTransferJob(...args),
    readTransferJobStatus: (...args: unknown[]) => mockEngine.readTransferJobStatus(...args),
    transferResultFile: (...args: unknown[]) => mockEngine.transferResultFile(...args),
  }
})

jest.mock('@aglyn/tenant-data-admin/server/transfer-export', () => ({
  __esModule: true,
  streamTransferExport: (...args: unknown[]) => mockExport(...args),
}))

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => 'now' },
}))

import { TransferEngineError } from '@aglyn/tenant-data-admin/server/transfer-jobs'
import { hostScopeToken } from '@aglyn/aglyn/app-utils/scope-tokens'
import { POST as apply } from '../app/api/transfer/apply/route'
import { POST as exportRoute } from '../app/api/transfer/export/route'
import { POST as status } from '../app/api/transfer/status/route'
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
  mockOrgPermission = true
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
    mockOrgPermission = false
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

  it('needs data.manage, as the CRM export does', async () => {
    mockOrgPermission = false
    expect((await exportRoute(request('export', BODY))).status).toBe(403)
    expect(mockExport).not.toHaveBeenCalled()
  })
})

