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
 * `/api/domains/detach` — releasing a custom domain has to give the site its
 * OTHER address back.
 *
 * Two registrations come off a disconnect, and the second one is the half with
 * no obvious symptom. `{subdomain}.aglyn.app` carries a redirect to the custom
 * domain (AGL-1273), and a redirect on a name whose target has just been
 * released is a site with no working address at all: the subdomain no longer
 * serves, and the domain it forwards to is gone. Dropping the customer's own
 * name while leaving that redirect standing is therefore a worse outcome than
 * not detaching at all, and nothing about it is visible from the wizard.
 *
 * Driven through the provider seam rather than a `fetch` double, because the
 * seam is where the vendor now lives: what this route owes is the right
 * OPERATIONS in the right order, and which HTTP calls those become is the
 * driver's business and its own suite's.
 */

// A module, not a script — without this the const declarations below collide
// with the other console route specs' identical globals under `tsc`.
export {}

const mockVerifyIdToken = jest.fn()
const mockAttachProjectDomain = jest.fn()
const mockDetachProjectDomain = jest.fn()
const mockHostSet = jest.fn(async () => undefined)
/** Lazy so the hoisted mock factory never touches a const in its TDZ. */
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
              exists: true,
              get: (field: string) => mockHostData()[field],
              data: () => mockHostData(),
              ref: { set: mockHostSet },
            }),
          }),
        }),
      }),
    }),
    firestore: { FieldValue: { delete: () => 'FIELD_DELETE' } },
  },
  getOrgForHost: async () => ({ orgId: 'org-1', org: {} }),
  lockdownRefusal: async () => null,
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  attachProjectDomain: (...args: unknown[]) => mockAttachProjectDomain(...args),
  detachProjectDomain: (...args: unknown[]) => mockDetachProjectDomain(...args),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  TENANT_APEX: 'aglyn.app',
  screenRoutePathToUrl: (path: string) => path,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body: await request.json().catch(() => ({})),
    headers: { authorization: request.headers.get('authorization') ?? undefined },
  }),
}))

const { POST } = require('./route') as {
  POST: (request: Request) => Promise<Response>
}

const post = () =>
  POST(
    new Request('https://app.aglyn.com/api/domains/detach', {
      method: 'POST',
      headers: { authorization: 'Bearer tok' },
      body: JSON.stringify({ hostId: 'host-1' }),
    }),
  )

/** What the provider answers for a name it removed. */
const detached = (domain: string) => ({ outcome: 'detached', domain })

beforeEach(() => {
  jest.clearAllMocks()
  mockVerifyIdToken.mockResolvedValue({ uid: 'u-1', email_verified: true })
  mockHostData.mockReturnValue({
    memberRoles: { 'u-1': 'admin' },
    cname: 'shop.example.com',
    subdomain: 'shop',
  })
  mockAttachProjectDomain.mockImplementation(async (domain: string) => ({
    outcome: 'attached',
    domain,
  }))
  mockDetachProjectDomain.mockImplementation(async (domain: string) =>
    detached(domain),
  )
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => jest.restoreAllMocks())

describe('the platform subdomain serves again once the domain is gone (AGL-1273)', () => {
  it('drops the redirecting entry and puts a plain one back', async () => {
    const response = await post()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ detached: true })
    // The customer's own name goes first, against the TENANT deployment — the
    // console scope would release a name from the wrong project entirely.
    expect(mockDetachProjectDomain).toHaveBeenNthCalledWith(
      1,
      'shop.example.com',
      'tenant',
    )
    // Then the platform subdomain, whose redirect is a property of its
    // registration and so can only be dropped with it.
    expect(mockDetachProjectDomain).toHaveBeenNthCalledWith(
      2,
      'shop.aglyn.app',
      'tenant',
    )
    // And it is registered again with NO redirect, which is what makes it
    // serve. A version that stopped here would leave the site with neither
    // address.
    expect(mockAttachProjectDomain).toHaveBeenCalledWith(
      'shop.aglyn.app',
      {},
      'tenant',
    )
  })

  it('does not invent an entry for a subdomain that never had one', async () => {
    // `not-found` means the name is served by a wildcard and carries no
    // redirect of its own. Registering one there would create an entry this
    // route never removed, on a name it was only asked to stop redirecting.
    mockDetachProjectDomain.mockImplementation(async (domain: string) =>
      domain === 'shop.aglyn.app'
        ? { outcome: 'not-found', domain }
        : detached(domain),
    )

    expect((await post()).status).toBe(200)

    expect(mockAttachProjectDomain).not.toHaveBeenCalled()
  })

  it('releases nothing and reports the orphan when the provider refuses', async () => {
    mockDetachProjectDomain.mockResolvedValue({
      outcome: 'failed',
      domain: 'shop.example.com',
      detail: '500',
    })

    const response = await post()

    expect(response.status).toBe(502)
    // `cname` is kept, so a retry has something to act on, and the flag makes
    // the name we still hold visible rather than silent.
    expect(mockHostSet).toHaveBeenCalledWith(
      { cnameDetachmentPending: true },
      { merge: true },
    )
    // The subdomain is untouched: its redirect still points at a domain we
    // failed to release, which is the consistent state of the two.
    expect(mockAttachProjectDomain).not.toHaveBeenCalled()
  })

  it('completes on a deployment that registers no names at all', async () => {
    // `skipped` is not a failure. A self-host that leaves names to its own
    // proxy must still be able to disconnect a domain.
    mockDetachProjectDomain.mockImplementation(async (domain: string) => ({
      outcome: 'skipped',
      domain,
    }))

    const response = await post()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ detached: true })
    expect(mockAttachProjectDomain).not.toHaveBeenCalled()
  })

  it('touches no registration for a site with no custom domain', async () => {
    mockHostData.mockReturnValue({
      memberRoles: { 'u-1': 'admin' },
      subdomain: 'shop',
    })

    const response = await post()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ alreadyClear: true })
    expect(mockDetachProjectDomain).not.toHaveBeenCalled()
    expect(mockAttachProjectDomain).not.toHaveBeenCalled()
  })

  it('refuses a non-admin before releasing anything', async () => {
    mockHostData.mockReturnValue({
      memberRoles: { 'u-1': 'editor' },
      cname: 'shop.example.com',
      subdomain: 'shop',
    })

    expect((await post()).status).toBe(403)
    expect(mockDetachProjectDomain).not.toHaveBeenCalled()
  })
})
