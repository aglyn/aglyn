/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored, and this suite needs `Request`/`Response`.
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
 * `PATCH /api/ai/host-permissions` — a collaborator's AI toggles on one site
 * (AGL-2927, AGL-2984). Assertions are on what the door WROTE and RAISED: the
 * per-site toggle handed to core, the roster copy, the site feed's sentence,
 * and one platform event per key that moved.
 */

export {}

const mockVerifyIdToken = jest.fn()
const mockLogHostActivity = jest.fn(async (..._args: unknown[]) => undefined)
const mockSetHostPermissions = jest.fn(async (..._args: unknown[]) => ({
  before: { 'ai.use': true, 'ai.generate': true } as Record<string, boolean> | null,
  after: { 'ai.use': true, 'ai.generate': false } as Record<string, boolean>,
}))
const mockRunPluginEventHandlers = jest.fn(async (..._args: unknown[]) => ({
  handled: 1,
  failed: [] as string[],
}))
const mockManagesMembers = jest.fn(() => false)
const mockHostData = jest.fn()

/** Every document, keyed by path — the roster is read AND written here. */
let docs = new Map<string, Record<string, unknown>>()

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => mockMakeFirestore(),
    }),
  },
  getOrgForHost: async () => ({ orgId: 'org-1', org: { ownerUid: 'owner-1' } }),
  lockdownRefusal: async () => null,
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  logHostActivity: (...args: unknown[]) => mockLogHostActivity(...args),
  setHostPermissions: (...args: unknown[]) => mockSetHostPermissions(...args),
}))

jest.mock('@aglyn/tenant-data-admin/server/id-token-refusal', () => ({
  __esModule: true,
  invalidIdTokenResponse: () => null,
}))

jest.mock('@aglyn/tenant-runtime/org-permissions', () => ({
  __esModule: true,
  resolveOrgPermissions: async () => ({
    permissions: { manageMembers: mockManagesMembers() },
  }),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginPermissionChanges: jest.requireActual('@aglyn/aglyn/app-utils/org-permissions')
    .pluginPermissionChanges,
  runPluginEventHandlers: (...args: unknown[]) => mockRunPluginEventHandlers(...args),
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: {},
    body: await request.json().catch(() => ({})),
    headers: { authorization: request.headers.get('authorization') ?? undefined },
  }),
}))

function mockMakeFirestore(): any {
  const doc = (path: string): any => ({
    get: async () => ({
      exists: path === 'hosts/host-1' ? true : docs.has(path),
      data: () => (path === 'hosts/host-1' ? mockHostData() : docs.get(path)),
    }),
    update: async (data: Record<string, unknown>) => {
      docs.set(path, { ...docs.get(path), ...data })
    },
    collection: (name: string) => ({
      doc: (id: string) => doc(`${path}/${name}/${id}`),
    }),
  })
  return { collection: (name: string) => ({ doc: (id: string) => doc(`${name}/${id}`) }) }
}

const { PATCH } = require('./ai-host-permissions') as {
  PATCH: (request: Request) => Promise<Response>
}

function call(body: unknown, init: { method?: string; token?: string | null } = {}) {
  return PATCH(
    new Request('https://app.aglyn.com/api/ai/host-permissions', {
      method: init.method ?? 'PATCH',
      headers: init.token === null ? {} : { authorization: `Bearer ${init.token ?? 'tok'}` },
      body: JSON.stringify(body),
    }),
  )
}

/** The single logged entry's arguments, named. */
function entry() {
  const args = mockLogHostActivity.mock.calls[0] as unknown as [
    string,
    { uid: string; email: string | null },
    string,
    Record<string, unknown>,
  ]
  return { hostId: args[0], actor: args[1], action: args[2], target: args[3] }
}

beforeEach(() => {
  jest.clearAllMocks()
  docs = new Map()
  mockVerifyIdToken.mockResolvedValue({
    uid: 'u-1',
    email: 'admin@example.test',
    email_verified: true,
  })
  mockHostData.mockReturnValue({
    memberRoles: { 'u-1': 'admin' },
    orgId: 'org-1',
    displayName: 'Acme',
  })
  mockManagesMembers.mockReturnValue(false)
  mockSetHostPermissions.mockResolvedValue({
    before: { 'ai.use': true, 'ai.generate': true },
    after: { 'ai.use': true, 'ai.generate': false },
  })
  docs.set('hosts/host-1/members/uid-9', {
    email: 'nine@example.test',
    role: 'author',
    uid: 'uid-9',
  })
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('a collaborator’s AI toggles on one site', () => {
  it('records an AI-access change, naming the state it became (AGL-2927)', async () => {
    const response = await call({
      hostId: 'host-1',
      memberId: 'uid-9',
      aiPermissions: { 'ai.generate': false },
    })
    expect(response.status).toBe(200)
    // The MEMBER document is what the doors read; the roster row is the
    // card's copy of the same verdict.
    expect(mockSetHostPermissions).toHaveBeenCalledWith({
      orgId: 'org-1',
      uid: 'uid-9',
      hostId: 'host-1',
      permissions: { 'ai.generate': false },
    })
    expect(docs.get('hosts/host-1/members/uid-9')?.['aiPermissions']).toEqual({
      'ai.use': true,
      'ai.generate': false,
    })
    expect(mockLogHostActivity).toHaveBeenCalledTimes(1)
    expect(entry().action).toBe('Changed member AI access to assist on, generate off')
    expect(entry().actor).toEqual({ uid: 'u-1', email: 'admin@example.test' })
    expect(entry().target).toEqual({
      type: 'member',
      id: 'uid-9',
      name: 'nine@example.test',
    })
    // The org feed's coded row (AGL-2929), raised for the plugin handler that
    // writes it: one event per key that moved — the toggle flipped generate
    // only — on the site, naming the collaborator.
    expect(mockRunPluginEventHandlers).toHaveBeenCalledTimes(1)
    expect(mockRunPluginEventHandlers).toHaveBeenCalledWith('org.permissions.changed', {
      orgId: 'org-1',
      actor: { uid: 'u-1', email: 'admin@example.test' },
      subject: { type: 'host', id: 'host-1', name: 'Acme · nine@example.test' },
      permission: 'ai.generate',
      granted: false,
    })
  })

  it('writes no permission row when the toggle was already at that value (AGL-2929)', async () => {
    mockSetHostPermissions.mockResolvedValueOnce({
      before: { 'ai.use': true, 'ai.generate': false },
      after: { 'ai.use': true, 'ai.generate': false },
    })
    const response = await call({
      hostId: 'host-1',
      memberId: 'uid-9',
      aiPermissions: { 'ai.generate': false },
    })
    expect(response.status).toBe(200)
    expect(mockRunPluginEventHandlers).not.toHaveBeenCalled()
  })

  it('refuses a malformed AI map, and an invited row that has no document to carry one', async () => {
    for (const aiPermissions of [{ 'ai.fly': true }, { 'ai.use': 'yes' }, {}, 'on']) {
      expect(
        (await call({ hostId: 'host-1', memberId: 'uid-9', aiPermissions })).status,
      ).toBe(400)
    }
    docs.set('hosts/host-1/members/pending', {
      email: 'later@example.test',
      role: 'editor',
      status: 'invited',
    })
    expect(
      (
        await call({
          hostId: 'host-1',
          memberId: 'pending',
          aiPermissions: { 'ai.use': false },
        })
      ).status,
    ).toBe(409)
    expect(mockSetHostPermissions).not.toHaveBeenCalled()
    expect(mockLogHostActivity).not.toHaveBeenCalled()
  })
})

describe('the collaborators card’s own door', () => {
  it('admits a site admin, and an org member who manages people', async () => {
    mockHostData.mockReturnValue({ memberRoles: { 'u-1': 'editor' }, displayName: 'Acme' })
    const body = { hostId: 'host-1', memberId: 'uid-9', aiPermissions: { 'ai.use': false } }
    expect((await call(body)).status).toBe(403)
    expect(mockSetHostPermissions).not.toHaveBeenCalled()
    mockManagesMembers.mockReturnValue(true)
    expect((await call(body)).status).toBe(200)
  })

  it('refuses without a credential, and any method but PATCH', async () => {
    expect((await call({ hostId: 'host-1' }, { token: null })).status).toBe(401)
    expect((await call({ hostId: 'host-1' }, { method: 'POST' })).status).toBe(405)
    expect((await call({ memberId: 'uid-9', aiPermissions: { 'ai.use': false } })).status).toBe(
      400,
    )
    expect(mockSetHostPermissions).not.toHaveBeenCalled()
  })
})
