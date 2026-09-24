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
 * `POST /api/orgs/consent-groups` (AGL-3320) — the gate, and the wiring.
 *
 * The gate is `/api/orgs/settings`' exactly, plus `data.manage` for every
 * action, and each refusal is pinned in the order the route decides it: the
 * method, the body, the credential, the verified address, `org.settings`,
 * the lockdown, the workspace, `data.manage`. Past the gate the route only
 * hands over — so what is asserted is that each action reaches the executor
 * function it names, and nothing else, and that the executor's refusals come
 * back with their own status and body untouched.
 */

// A module, not a script — without this the const declarations below collide
// with the other console route specs' identical globals under `tsc`.
export {}

let mockOrg: Record<string, unknown> | null = null
let mockLockdownResponse: Response | null = null
let mockPermissions: Record<string, boolean> = {}
let mockDeclarationsFail = false
const mockVerifyIdToken = jest.fn()
const mockPreview = jest.fn()
const mockStart = jest.fn()
const mockAdvance = jest.fn()
const mockCancel = jest.fn()
const mockStatus = jest.fn()

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body: request.method === 'POST' ? await request.json() : null,
    headers: Object.fromEntries(request.headers),
  }),
}))

jest.mock('../../../../constants/plugins.declarations.server.generated', () => ({
  __esModule: true,
  registerPluginServerDeclarations: async () => {
    if (mockDeclarationsFail) throw new Error('a declaration threw')
  },
}))

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args) }),
    }),
  },
  emailUnverifiedResponse: () => Response.json({ error: 'Verify your email' }, { status: 403 }),
  isImpersonationSession: () => false,
  resolveOrgMembership: async () => ({ member: { role: 'admin' } }),
  memberHasOrgPermission: async (_orgId: string, _member: unknown, permission: string) =>
    mockPermissions[permission] === true,
  getOrgDoc: async () => mockOrg,
  lockdownRefusal: async () => mockLockdownResponse,
  previewConsentGroupChange: (...args: unknown[]) => mockPreview(...args),
  startConsentGroupChange: (...args: unknown[]) => mockStart(...args),
  advanceConsentGroupChange: (...args: unknown[]) => mockAdvance(...args),
  cancelConsentGroupChange: (...args: unknown[]) => mockCancel(...args),
  readConsentGroupChangeStatus: (...args: unknown[]) => mockStatus(...args),
}))

jest.mock('../../_lib/invalid-id-token-response', () => ({
  __esModule: true,
  invalidIdTokenResponse: (error: { code?: string }) =>
    error?.code === 'auth/id-token-expired'
      ? Response.json({ error: 'Unauthenticated' }, { status: 401 })
      : null,
}))

import { POST } from './route'

const URL = 'https://app.example.com/api/orgs/consent-groups'
const GROUPS = { g1: { name: 'Northwind', hostIds: ['a', 'b'] } }
const STATUS = {
  changeId: 'change-1',
  phase: 'carry',
  done: false,
  progress: { status: 'running', step: 'carry' },
}

const post = (body: Record<string, unknown>, headers: Record<string, string> = { authorization: 'Bearer token' }) =>
  POST(
    new Request(URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }),
  )

beforeEach(() => {
  mockOrg = { $id: 'org-1', consentGroups: GROUPS }
  mockLockdownResponse = null
  mockPermissions = { 'org.settings': true, 'data.manage': true }
  mockDeclarationsFail = false
  for (const mock of [mockVerifyIdToken, mockPreview, mockStart, mockAdvance, mockCancel, mockStatus]) {
    mock.mockReset()
  }
  mockVerifyIdToken.mockResolvedValue({ uid: 'uid-admin', email: 'admin@example.com', email_verified: true })
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('the gate', () => {
  it('answers 405 to anything but a POST', async () => {
    const response = await POST(new Request(URL, { method: 'GET' }))
    expect(response.status).toBe(405)
  })

  it('answers 400 without an org, and 401 without a credential or with a refused one', async () => {
    expect((await post({ action: 'preview' })).status).toBe(400)
    expect((await post({ orgId: 'org-1', action: 'preview' }, {})).status).toBe(401)
    mockVerifyIdToken.mockRejectedValue(Object.assign(new Error('expired'), { code: 'auth/id-token-expired' }))
    expect((await post({ orgId: 'org-1', action: 'preview' })).status).toBe(401)
  })

  it('answers 403 to an unverified address, to a member without org.settings, and without data.manage', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'uid-admin', email_verified: false })
    expect((await post({ orgId: 'org-1', action: 'preview' })).status).toBe(403)

    mockVerifyIdToken.mockResolvedValue({ uid: 'uid-admin', email_verified: true })
    mockPermissions = { 'org.settings': false, 'data.manage': true }
    const settings = await post({ orgId: 'org-1', action: 'preview' })
    expect(settings.status).toBe(403)
    expect(await settings.json()).toEqual({ error: 'Org settings require the admin role' })

    mockPermissions = { 'org.settings': true, 'data.manage': false }
    const data = await post({ orgId: 'org-1', action: 'status', changeId: 'change-1' })
    expect(data.status).toBe(403)
    expect(await data.json()).toEqual({ error: 'data.manage required' })
    expect(mockPreview).not.toHaveBeenCalled()
    expect(mockStatus).not.toHaveBeenCalled()
  })

  it('lets staff past both permissions', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'uid-staff', email_verified: true, staff: true })
    mockPermissions = {}
    mockStatus.mockResolvedValue(STATUS)
    expect((await post({ orgId: 'org-1', action: 'status', changeId: 'change-1' })).status).toBe(200)
  })

  it('answers the lockdown verdict with its own 423, before the workspace check', async () => {
    mockLockdownResponse = Response.json({ error: 'locked' }, { status: 423 })
    mockOrg = null
    expect((await post({ orgId: 'org-1', action: 'apply', expected: null, groups: [] })).status).toBe(423)
    expect(mockStart).not.toHaveBeenCalled()
  })

  it('answers 404 for a workspace that does not exist', async () => {
    mockOrg = null
    expect((await post({ orgId: 'org-1', action: 'preview' })).status).toBe(404)
  })

  it('refuses an unknown action, and a change action with no change', async () => {
    expect((await post({ orgId: 'org-1', action: 'rename' })).status).toBe(400)
    expect((await post({ orgId: 'org-1', action: 'continue' })).status).toBe(400)
  })
})

describe('the actions', () => {
  it('previews with the org it read, and starts nothing', async () => {
    mockPreview.mockResolvedValue({ ok: true, preview: { lines: [] } })
    const response = await post({ orgId: 'org-1', action: 'preview', expected: GROUPS, groups: [] })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, preview: { lines: [] } })
    expect(mockPreview).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-1', org: mockOrg, expected: GROUPS, groups: [] }),
    )
    for (const mock of [mockStart, mockAdvance, mockCancel]) expect(mock).not.toHaveBeenCalled()
  })

  it('applies: starts the change as the caller, then works it inside the request budget', async () => {
    mockStart.mockResolvedValue({ ok: true, changeId: 'change-1' })
    mockAdvance.mockResolvedValue({ ok: true, status: STATUS })
    const before = Date.now()
    const response = await post({ orgId: 'org-1', action: 'apply', expected: GROUPS, groups: [] })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, ...STATUS })
    expect(mockStart).toHaveBeenCalledWith({
      orgId: 'org-1',
      actor: { uid: 'uid-admin', email: 'admin@example.com' },
      expected: GROUPS,
      groups: [],
    })
    const [{ deadlineMs }] = mockAdvance.mock.calls[0] as [{ deadlineMs: number }]
    expect(deadlineMs).toBeGreaterThanOrEqual(before + 50_000)
    expect(deadlineMs).toBeLessThanOrEqual(Date.now() + 50_000)
  })

  it('passes both 409s through with their bodies: a stale rendering and a change in flight', async () => {
    mockStart.mockResolvedValueOnce({
      ok: false,
      status: 409,
      body: { error: 'Someone else changed consent groups while you were editing', current: GROUPS },
    })
    const stale = await post({ orgId: 'org-1', action: 'apply', expected: null, groups: [] })
    expect(stale.status).toBe(409)
    expect(await stale.json()).toEqual({
      error: 'Someone else changed consent groups while you were editing',
      current: GROUPS,
    })

    mockStart.mockResolvedValueOnce({
      ok: false,
      status: 409,
      body: { error: 'A consent group change is still finishing', changeId: 'change-0', phase: 'rehome' },
    })
    const busy = await post({ orgId: 'org-1', action: 'apply', expected: GROUPS, groups: [] })
    expect(busy.status).toBe(409)
    expect(await busy.json()).toMatchObject({ changeId: 'change-0', phase: 'rehome' })
    expect(mockAdvance).not.toHaveBeenCalled()
  })

  it('passes a refused declaration through as 400 with its errors', async () => {
    mockPreview.mockResolvedValue({
      ok: false,
      status: 400,
      body: { error: 'Those consent groups cannot be saved', errors: [{ code: 'no-change' }] },
    })
    const response = await post({ orgId: 'org-1', action: 'preview', expected: GROUPS, groups: [] })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({
      error: 'Those consent groups cannot be saved',
      errors: [{ code: 'no-change' }],
    })
  })

  it('continues, cancels and reads a change by its id', async () => {
    mockAdvance.mockResolvedValue({ ok: true, status: STATUS })
    mockCancel.mockResolvedValue({
      ok: false,
      status: 409,
      body: { error: 'This change has already taken effect', changeId: 'change-1', phase: 'rehome' },
    })
    mockStatus.mockResolvedValueOnce(STATUS).mockResolvedValueOnce(null)

    expect(await (await post({ orgId: 'org-1', action: 'continue', changeId: 'change-1' })).json()).toEqual({
      ok: true,
      ...STATUS,
    })
    expect(mockAdvance).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-1', changeId: 'change-1' }))

    const cancel = await post({ orgId: 'org-1', action: 'cancel', changeId: 'change-1' })
    expect(cancel.status).toBe(409)
    expect(mockCancel).toHaveBeenCalledWith({
      orgId: 'org-1',
      changeId: 'change-1',
      actor: { uid: 'uid-admin', email: 'admin@example.com' },
    })

    expect((await post({ orgId: 'org-1', action: 'status', changeId: 'change-1' })).status).toBe(200)
    expect((await post({ orgId: 'org-1', action: 'status', changeId: 'change-9' })).status).toBe(404)
  })

  it('will not start or work a change when the plugins could not declare their participants', async () => {
    mockDeclarationsFail = true
    expect((await post({ orgId: 'org-1', action: 'apply', expected: GROUPS, groups: [] })).status).toBe(503)
    expect((await post({ orgId: 'org-1', action: 'continue', changeId: 'change-1' })).status).toBe(503)
    expect(mockStart).not.toHaveBeenCalled()
    expect(mockAdvance).not.toHaveBeenCalled()
    // Reading goes on without them.
    mockStatus.mockResolvedValue(STATUS)
    expect((await post({ orgId: 'org-1', action: 'status', changeId: 'change-1' })).status).toBe(200)
  })

  it('answers 500 when the executor throws', async () => {
    mockStatus.mockRejectedValue(new Error('firestore down'))
    const response = await post({ orgId: 'org-1', action: 'status', changeId: 'change-1' })
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'Consent group operation failed' })
  })
})
