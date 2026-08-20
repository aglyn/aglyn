/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header
 * it is silently ignored and this runs on jsdom, where the route's
 * Response helpers are unavailable.
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
 * AGL-2010 — a custom domain that becomes healthy later finishes itself.
 *
 * `cnameAttachmentPending` is what `liveCustomDomain` reads to decide whether
 * visitors may be sent to a custom domain. The attach route sets it and, until
 * this sweeper, NOTHING ever cleared it: a customer who pointed their DNS
 * correctly and closed the tab waited forever, because the only exit was a
 * human reopening the setup page and pressing Re-attach.
 *
 * `upsertSubdomainRedirect` is deliberately NOT mocked here — it runs against
 * a fake `fetch`, so the Vercel call it makes is asserted for real. A sweeper
 * that cleared the flag and never registered the redirect would otherwise pass.
 */

const mockProjectDomainStatus = jest.fn()
const mockIsCronAuthorized = jest.fn()

/** `hosts/{id}` documents, mutated by the route exactly as Firestore would. */
const mockDocs = new Map<string, Record<string, unknown>>()
const mockDELETE = '__delete__'

function mockApplyMerge(id: string, patch: Record<string, unknown>) {
  const current = mockDocs.get(id) ?? {}
  for (const [key, value] of Object.entries(patch)) {
    if (value === mockDELETE) delete current[key]
    else current[key] = value
  }
  mockDocs.set(id, current)
}

function mockSnapshotFor(id: string) {
  return {
    id,
    get: (field: string) => mockDocs.get(id)?.[field],
    ref: {
      set: async (patch: Record<string, unknown>) => {
        mockApplyMerge(id, patch)
      },
    },
  }
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  // The REAL `domainStateServes` (AGL-2011). The predicate that decides
  // whether a probed state counts as serving used to be four inline
  // comparisons in this route and four more in the completer cron, kept
  // identical by a comment; it is now one exported function, and stubbing it
  // here would make every state case below a test of the stub.
  //
  // Reached through the defining FILE, not
  // `jest.requireActual('@aglyn/tenant-data-admin')`: the package barrel pulls
  // in `render-cache.ts` -> `next/cache`, which throws under this test
  // environment. That file has no imports of its own.
  ...jest.requireActual(
    '../../../libs/tenant/data/admin/src/lib/server/workspace-domains',
  ),
  firebaseAdmin: {
    firestore: { FieldValue: { delete: () => '__delete__' } },
    app: () => ({
      firestore: () => ({
        collection: () => ({
          where: (field: string) => ({
            limit: () => ({
              get: async () => ({
                docs: [...mockDocs.entries()]
                  .filter(([, data]) => data[field] === true)
                  .map(([id]) => mockSnapshotFor(id)),
              }),
            }),
          }),
        }),
      }),
    }),
  },
  projectDomainStatus: (...args: unknown[]) => mockProjectDomainStatus(...args),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  TENANT_APEX: 'aglyn.app',
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body:
      request.method === 'GET'
        ? undefined
        : await request.json().catch(() => ({})),
    headers: { authorization: request.headers.get('authorization') ?? undefined },
    query: Object.fromEntries(new URL(request.url).searchParams),
  }),
}))

// Only AUTHORIZATION is faked. `jest.requireActual` keeps the rest of the
// module real — notably `isCronDryRun` (AGL-2084), the guard that decides
// whether this route writes at all. A closed-world `{ isCronAuthorized }`
// mock made the route throw `isCronDryRun is not a function` the moment it
// started calling it, which is the harmless version of the failure; the
// harmful one is a stub that answers a security question differently from
// the code shipping to production.
jest.mock('../utils/cron-auth', () => ({
  __esModule: true,
  ...jest.requireActual('../utils/cron-auth'),
  isCronAuthorized: (...args: unknown[]) => mockIsCronAuthorized(...args),
}))

import { GET, POST } from '../app/api/admin/finish-domain-attachments/route'

const ORIGINAL_ENV = process.env
const ORIGINAL_FETCH = global.fetch
let fetchMock: jest.Mock

const post = (body: Record<string, unknown> = {}) =>
  POST(
    new Request('https://app.aglyn.com/api/admin/finish-domain-attachments', {
      method: 'POST',
      headers: { authorization: 'Bearer cron' },
      body: JSON.stringify(body),
    }),
  )

const get = () =>
  GET(
    new Request('https://app.aglyn.com/api/admin/finish-domain-attachments', {
      method: 'GET',
      headers: { authorization: 'Bearer cron' },
    }),
  )

beforeEach(() => {
  jest.clearAllMocks()
  mockDocs.clear()
  process.env = {
    ...ORIGINAL_ENV,
    CRON_SECRET: 'secret',
    VERCEL_TOKEN: 'tok',
    VERCEL_TENANT_PROJECT_ID: 'prj_tenant',
  } as NodeJS.ProcessEnv
  mockIsCronAuthorized.mockReturnValue(true)
  mockProjectDomainStatus.mockResolvedValue({ state: 'serving' })
  fetchMock = jest.fn(async () => ({
    ok: true,
    json: async () => ({}),
  })) as unknown as jest.Mock
  global.fetch = fetchMock as unknown as typeof fetch
})

afterEach(() => {
  process.env = ORIGINAL_ENV
  global.fetch = ORIGINAL_FETCH
})

describe('AGL-2010 · finish-domain-attachments', () => {
  it('completes a domain that has become healthy: flag cleared, redirect registered', async () => {
    mockDocs.set('h1', {
      cname: 'example.com',
      subdomain: 'mine',
      cnameAttachmentPending: true,
    })

    const response = await post()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      dryRun: false,
      completed: ['example.com'],
    })
    // The flag is what gates visitors. Clearing it IS the fix.
    expect(mockDocs.get('h1')?.['cnameAttachmentPending']).toBeUndefined()
    // And the edge redirect really went out, to the right name and target.
    const redirect = fetchMock.mock.calls.find(([url]) =>
      String(url).includes('mine.aglyn.app'),
    )
    expect(redirect).toBeDefined()
    expect(JSON.parse(redirect[1].body)).toEqual({
      redirect: 'example.com',
      redirectStatusCode: 307,
    })
    expect(mockDocs.get('h1')?.['subdomainRedirectPending']).toBeUndefined()
  })

  it('a domain still awaiting its certificate is left pending — same predicate as attach', async () => {
    // AGL-1996's states, driven one by one. A sweeper with a looser idea of
    // "serving" than the door it completes for would re-open that defect.
    for (const state of [
      'certificate-pending',
      'ownership-pending',
      'dns-misconfigured',
      'not-attached',
    ]) {
      mockDocs.clear()
      fetchMock.mockClear()
      mockDocs.set('h1', {
        cname: 'example.com',
        subdomain: 'mine',
        cnameAttachmentPending: true,
      })
      mockProjectDomainStatus.mockResolvedValue({ state })

      const response = await post()

      await expect(response.json()).resolves.toMatchObject({
        completed: [],
        stillPending: ['example.com'],
      })
      expect(mockDocs.get('h1')?.['cnameAttachmentPending']).toBe(true)
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).includes('mine.aglyn.app'),
        ),
      ).toBe(false)
    }
  })

  it('a GET is a DRY RUN: it reports the same answer and writes nothing', async () => {
    mockDocs.set('h1', {
      cname: 'example.com',
      subdomain: 'mine',
      cnameAttachmentPending: true,
    })

    const response = await get()

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      dryRun: true,
      completed: ['example.com'],
    })
    // Reported as completable, and NOT completed. Somebody's curl must not
    // change the world (the AGL-2084 shape).
    expect(mockDocs.get('h1')?.['cnameAttachmentPending']).toBe(true)
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes('mine.aglyn.app'),
      ),
    ).toBe(false)
  })

  it('registers a redirect that never landed, even though the domain is already live', async () => {
    // The second arm: attach succeeded, the best-effort redirect call failed,
    // and only a hand-run script existed to close it.
    mockDocs.set('h1', {
      cname: 'example.com',
      subdomain: 'mine',
      subdomainRedirectPending: true,
    })

    await post()

    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes('mine.aglyn.app'),
      ),
    ).toBe(true)
    expect(mockDocs.get('h1')?.['subdomainRedirectPending']).toBeUndefined()
  })

  it('a failed redirect registration leaves the flag ON for the next run', async () => {
    mockDocs.set('h1', {
      cname: 'example.com',
      subdomain: 'mine',
      subdomainRedirectPending: true,
    })
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })

    await post()

    // Never cleared on failure — that would lose the only record of the gap.
    expect(mockDocs.get('h1')?.['subdomainRedirectPending']).toBe(true)
  })

  it('a pending host whose domain was detached is left alone, not cleared', async () => {
    // Clearing this would tell liveCustomDomain to send visitors to a domain
    // the host no longer holds.
    mockDocs.set('h1', { subdomain: 'mine', cnameAttachmentPending: true })

    await post()

    expect(mockDocs.get('h1')?.['cnameAttachmentPending']).toBe(true)
    expect(mockProjectDomainStatus).not.toHaveBeenCalled()
  })

  it('refuses an unauthenticated caller before reading anything', async () => {
    mockIsCronAuthorized.mockReturnValue(false)
    mockDocs.set('h1', {
      cname: 'example.com',
      subdomain: 'mine',
      cnameAttachmentPending: true,
    })

    const response = await post()

    expect(response.status).toBe(401)
    expect(mockProjectDomainStatus).not.toHaveBeenCalled()
    expect(mockDocs.get('h1')?.['cnameAttachmentPending']).toBe(true)
  })

  it('degrades to 501 with no Vercel credentials rather than pretending', async () => {
    delete (process.env as Record<string, unknown>)['VERCEL_TOKEN']

    const response = await post()

    expect(response.status).toBe(501)
  })
})
