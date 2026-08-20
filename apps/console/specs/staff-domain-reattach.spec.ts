/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and this runs on jsdom, where `Request` is not a
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
 * AGL-2011 — staff can re-attach a customer's custom domain.
 *
 * Until this action the only way for staff to unstick a domain was to
 * impersonate the customer and press their Re-attach button, which is a
 * disproportionate amount of access for one idempotent call and records the
 * customer as having acted on themselves.
 *
 * The cases that matter are the NARROWING, not the happy path. The action is
 * deliberately not a staff copy of `/api/domains/attach`: it takes no domain
 * from the caller and re-attaches `host.cname`, so the capability granted is
 * "finish what this site already claims" rather than "give this site a
 * domain". A test suite that only proved a 200 would not notice that
 * distinction disappearing.
 *
 * `domainStateServes` is deliberately REAL here — it is the predicate that
 * decides whether `cnameAttachmentPending` is cleared, and a faked one would
 * turn every state case below into a test of the fake.
 */

const mockProjectDomainStatus = jest.fn()
const mockVerifyIdToken = jest.fn()

/** `hosts/{id}` documents, mutated as Firestore would mutate them. */
const mockDocs = new Map<string, Record<string, unknown>>()
const mockAudit: Record<string, unknown>[] = []
const mockDELETE = '__delete__'

/**
 * `set(..., { merge: true })` semantics, including `FieldValue.delete()`.
 * A double that treated delete as a value would report a CLEARED flag as
 * `cnameAttachmentPending: '__delete__'` — truthy — and the route's most
 * important write would pass every assertion while doing the opposite.
 */
function mockApplyMerge(id: string, patch: Record<string, unknown>) {
  const current = { ...(mockDocs.get(id) ?? {}) }
  for (const [key, value] of Object.entries(patch)) {
    if (value === mockDELETE) delete current[key]
    else current[key] = value
  }
  mockDocs.set(id, current)
}

function mockDocRef(id: string) {
  return {
    id,
    get: async () => ({
      exists: mockDocs.has(id),
      id,
      get: (field: string) => mockDocs.get(id)?.[field],
      data: () => mockDocs.get(id),
      ref: mockDocRef(id),
    }),
    set: async (patch: Record<string, unknown>) => mockApplyMerge(id, patch),
  }
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  // `domainStateServes` is the REAL one — it is the predicate under test, and
  // a stub would turn the state table below into a test of the stub.
  //
  // Reached through the defining FILE rather than
  // `jest.requireActual('@aglyn/tenant-data-admin')`, which is the honest
  // spread and was tried first: the package barrel re-exports
  // `render-cache.ts`, which imports `next/cache`, which throws
  // "Class extends value undefined" under the node test environment. The file
  // has no imports of its own, so requiring it directly is the same code with
  // none of the barrel. Every other name below is stubbed because the route
  // either never reaches it in these cases or it needs a Firebase app.
  ...jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/workspace-domains',
  ),
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Email not verified' }, { status: 403 }),
  isImpersonationSession: () => false,
  updateExisting: async () => true,
  firebaseAdmin: {
    firestore: { FieldValue: { delete: () => '__delete__' } },
    app: () => ({
      auth: () => ({ verifyIdToken: (...a: unknown[]) => mockVerifyIdToken(...a) }),
      firestore: () => ({
        collection: (name: string) => ({
          doc: (id: string) => mockDocRef(id),
          add: async (row: Record<string, unknown>) => {
            if (name === 'adminAudit') mockAudit.push(row)
          },
          where: () => ({ limit: () => ({ get: async () => ({ empty: true, docs: [] }) }) }),
        }),
      }),
    }),
  },
  // Overrides the real one from the spread above: this is the network edge.
  projectDomainStatus: (...a: unknown[]) => mockProjectDomainStatus(...a),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  ...jest.requireActual('@aglyn/aglyn/server'),
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body: await request.json().catch(() => ({})),
    headers: { authorization: request.headers.get('authorization') ?? undefined },
    query: Object.fromEntries(new URL(request.url).searchParams),
  }),
}))

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => '__ts__', delete: () => '__delete__' },
}))

import { POST } from '../app/api/admin/host/route'

const ORIGINAL_ENV = process.env
const ORIGINAL_FETCH = global.fetch
let fetchMock: jest.Mock

const post = (body: Record<string, unknown>) =>
  POST(
    new Request('https://app.aglyn.com/api/admin/host', {
      method: 'POST',
      headers: { authorization: 'Bearer staff' },
      body: JSON.stringify(body),
    }),
  )

const reattach = (extra: Record<string, unknown> = {}) =>
  post({ hostId: 'h1', action: 'reattach-domain', ...extra })

beforeEach(() => {
  jest.clearAllMocks()
  mockDocs.clear()
  mockAudit.length = 0
  mockDocs.set('h1', {
    cname: 'shop.example.com',
    cnameAttachmentPending: true,
    subdomain: 'shop',
  })
  process.env = {
    ...ORIGINAL_ENV,
    VERCEL_TOKEN: 'tok',
    VERCEL_TENANT_PROJECT_ID: 'prj_tenant',
  } as NodeJS.ProcessEnv
  mockVerifyIdToken.mockResolvedValue({
    uid: 'staff-1',
    email_verified: true,
    staff: true,
    staffRole: 'super',
  })
  mockProjectDomainStatus.mockResolvedValue({
    state: 'serving',
    domain: 'shop.example.com',
    verification: [],
    conflicts: [],
  })
  // Any real network call is a bug in the test, not a fallback. Nothing here
  // may reach an external host.
  fetchMock = jest.fn(async (url: unknown) => {
    const target = String(url)
    if (!target.startsWith('https://api.vercel.com/')) {
      throw new Error(`unexpected outbound request: ${target}`)
    }
    return { ok: true, status: 200, json: async () => ({}) }
  }) as unknown as jest.Mock
  global.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  process.env = ORIGINAL_ENV
  global.fetch = ORIGINAL_FETCH
})

describe('AGL-2011 · staff re-attach', () => {
  it('re-attaches the domain the site already holds and clears the flag', async () => {
    const response = await reattach()
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      domain: 'shop.example.com',
      state: 'serving',
      serving: true,
      attachmentPending: false,
    })
    // The clear is a DELETE, not a false — `liveCustomDomain` reads the field's
    // presence, and the double models that difference.
    expect(mockDocs.get('h1')).not.toHaveProperty('cnameAttachmentPending')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.vercel.com/v10/projects/prj_tenant/domains',
      expect.objectContaining({ method: 'POST' }),
    )
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({
      name: 'shop.example.com',
    })
  })

  it('IGNORES a caller-supplied domain — it can only finish an existing claim', async () => {
    // The security property. If this action ever started honouring
    // `body.domain` it would become "attach any name to any site" wearing a
    // support-tool label, and the 200 above would still be green.
    const response = await reattach({ domain: 'attacker-controlled.example' })
    expect(response.status).toBe(200)
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({
      name: 'shop.example.com',
    })
    expect(mockDocs.get('h1')?.['cname']).toBe('shop.example.com')
  })

  it('refuses a claim-less staff token before it touches the platform', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 'legacy',
      email_verified: true,
      staff: true,
    })
    const response = await reattach()
    expect(response.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(mockAudit).toEqual([])
  })

  it('refuses a support-role staff member', async () => {
    mockVerifyIdToken.mockResolvedValue({
      uid: 's',
      email_verified: true,
      staff: true,
      staffRole: 'support',
    })
    expect((await reattach()).status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a non-staff caller', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'c', email_verified: true })
    expect((await reattach()).status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses an unknown action rather than falling through to set-subdomain', async () => {
    const response = await post({ hostId: 'h1', action: 'delete-everything' })
    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('400s a site with no custom domain', async () => {
    mockDocs.set('h1', { subdomain: 'shop' })
    expect((await reattach()).status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('404s a site that does not exist', async () => {
    expect((await post({ hostId: 'nope', action: 'reattach-domain' })).status).toBe(404)
  })

  it('501s when there is no platform to attach to, without writing', async () => {
    process.env = { ...ORIGINAL_ENV } as NodeJS.ProcessEnv
    const response = await reattach()
    expect(response.status).toBe(501)
    expect(fetchMock).not.toHaveBeenCalled()
    // The flag is left exactly as it was: a self-hosted deployment has no
    // verdict to record, and writing one would be an assertion nobody made.
    expect(mockDocs.get('h1')?.['cnameAttachmentPending']).toBe(true)
  })

  describe('the probed state decides the flag, not the 200 from the attach', () => {
    // The AGL-1996 shape: a successful POST whose domain still serves nothing.
    it.each([
      ['ownership-pending', false],
      ['dns-misconfigured', false],
      ['not-attached', false],
      ['certificate-pending', false],
      ['serving', true],
      ['unknown', true],
      ['skipped', true],
    ])('%s → serving %s', async (state, serving) => {
      mockProjectDomainStatus.mockResolvedValue({
        state,
        domain: 'shop.example.com',
        verification: [],
        conflicts: [],
      })
      const response = await reattach()
      await expect(response.json()).resolves.toMatchObject({ state, serving })
      expect(mockDocs.get('h1')?.['cnameAttachmentPending']).toBe(
        serving ? undefined : true,
      )
    })
  })

  it('treats domain_already_in_use as success — a re-attach is normally that', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: { code: 'domain_already_in_use' } }),
    })
    const response = await reattach()
    expect(response.status).toBe(200)
    // And still asks the platform whose project it is on, rather than reading
    // the tolerated code as a green light.
    expect(mockProjectDomainStatus).toHaveBeenCalled()
  })

  it('502s and marks pending when the platform rejects the attach outright', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: { code: 'internal', message: 'boom' } }),
    })
    mockDocs.set('h1', { cname: 'shop.example.com' })
    const response = await reattach()
    expect(response.status).toBe(502)
    expect(mockDocs.get('h1')?.['cnameAttachmentPending']).toBe(true)
  })

  it('audits the probed state, not "somebody pressed a button"', async () => {
    mockProjectDomainStatus.mockResolvedValue({
      state: 'ownership-pending',
      domain: 'shop.example.com',
      verification: [],
      conflicts: [],
    })
    await reattach()
    expect(mockAudit).toHaveLength(1)
    expect(mockAudit[0]).toMatchObject({
      actorUid: 'staff-1',
      action: 'host.reattach-domain',
      target: 'hosts/h1',
      before: { cnameAttachmentPending: true },
      after: { cnameAttachmentPending: true, state: 'ownership-pending' },
    })
  })
})
