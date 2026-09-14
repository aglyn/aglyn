/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored and the suite runs on jsdom, where `Request` is not a
 * constructor and every case here fails identically.
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
 * `/api/hosts/resources` with `action: 'duplicate'` (AGL-2936): the door.
 *
 * The copy itself is `duplicateResource`'s, proved in its own suite; this
 * suite is about what the route settles before handing over — the kind
 * vocabulary, the site role, the lockdown — and that a refusal from the
 * module answers with the module's status and sentence.
 */

// A module, not a script — without this the const declarations below collide
// with the other console route specs' identical globals under `tsc`.
export {}

const mockVerifyIdToken = jest.fn()
const mockDuplicateResource = jest.fn()
const mockLockdown = jest.fn(async (..._args: unknown[]) => null)
const mockHostData = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        collection: () => ({
          doc: () => ({
            get: async () => ({
              exists: mockHostData() !== null,
              get: (field: string) => (mockHostData() ?? {})[field],
              data: () => mockHostData(),
            }),
          }),
        }),
      }),
    }),
  },
  getOrgForHost: async () => ({ orgId: 'org-1', org: { plan: 'pro' } }),
  getLockdownVerdict: (...args: unknown[]) => mockLockdown(...args),
  lockdownJsonResponse: () => Response.json({ error: 'Locked' }, { status: 423 }),
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  logHostActivity: async () => undefined,
  duplicateResource: (...args: unknown[]) => mockDuplicateResource(...args),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  ...jest.requireActual('../../../../../../libs/aglyn/src/lib/app-utils/organizations'),
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body: await request.json().catch(() => ({})),
    headers: { authorization: request.headers.get('authorization') ?? undefined },
  }),
}))

const { POST } = require('./route') as {
  POST: (request: Request) => Promise<Response>
}

const post = (body: Record<string, unknown>) =>
  POST(
    new Request('http://console.test/api/hosts/resources', {
      method: 'POST',
      headers: {
        authorization: 'Bearer token',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        hostId: 'host-1',
        resource: 'screen',
        action: 'duplicate',
        sourceId: 'scr-1',
        name: 'Landing B',
        attemptKey: 'attempt-1',
        ...body,
      }),
    }),
  )

beforeEach(() => {
  mockVerifyIdToken.mockReset()
  mockDuplicateResource.mockReset()
  mockLockdown.mockReset().mockResolvedValue(null)
  mockVerifyIdToken.mockResolvedValue({
    uid: 'uid-1',
    email: 'ada@example.test',
    email_verified: true,
  })
  mockHostData.mockReturnValue({ orgId: 'org-1', memberRoles: { 'uid-1': 'author' } })
  mockDuplicateResource.mockResolvedValue({
    ok: true,
    id: 'scr-2',
    versionId: 'ver-2',
    name: 'Landing B',
  })
})

it('hands the verified person, the site and the body to the module, and answers its result', async () => {
  const response = await post({})
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({
    ok: true,
    id: 'scr-2',
    versionId: 'ver-2',
    name: 'Landing B',
  })
  expect(mockDuplicateResource).toHaveBeenCalledWith('screen', {
    orgId: 'org-1',
    hostId: 'host-1',
    sourceId: 'scr-1',
    name: 'Landing B',
    uid: 'uid-1',
    email: 'ada@example.test',
    org: { plan: 'pro' },
    attemptKey: 'attempt-1',
  })
})

it('an author may duplicate — it is authoring — and a viewer may not', async () => {
  mockHostData.mockReturnValue({ orgId: 'org-1', memberRoles: { 'uid-1': 'viewer' } })
  const response = await post({})
  expect(response.status).toBe(403)
  expect(mockDuplicateResource).not.toHaveBeenCalled()
})

it('refuses a kind outside the catalog before reading anything', async () => {
  const response = await post({ resource: 'reusableComponent' })
  expect(response.status).toBe(400)
  expect(await response.json()).toEqual({ error: 'That resource cannot be duplicated' })
  expect(mockVerifyIdToken).not.toHaveBeenCalled()
})

it('carries the catalog kinds the create table spells differently', async () => {
  for (const resource of ['component', 'emailDesign', 'workflow']) {
    mockDuplicateResource.mockClear()
    expect((await post({ resource })).status).toBe(200)
    expect(mockDuplicateResource.mock.calls[0][0]).toBe(resource)
  }
})

it('answers a refusal with the module\'s status and sentence', async () => {
  mockDuplicateResource.mockResolvedValue({
    ok: false,
    status: 403,
    error: 'Your plan includes 5 screens — upgrade in Billing for more',
  })
  const response = await post({})
  expect(response.status).toBe(403)
  expect(await response.json()).toEqual({
    error: 'Your plan includes 5 screens — upgrade in Billing for more',
  })
})

it('a locked site is refused before the copy', async () => {
  mockLockdown.mockResolvedValue({ scope: 'org' })
  expect((await post({})).status).toBe(423)
  expect(mockDuplicateResource).not.toHaveBeenCalled()
})
