/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored.
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
 * AGL-1681: the staff org detail page reads `/api/admin/hosts?orgId=…` for the
 * Sites card, and that projection used to be identity-only — so a support
 * conversation about "my form stopped working" still started with a raw
 * Firestore read of `hosts/{id}/counters/formSubmissionsRefused`. The route
 * now joins that counter per host for the org-narrowed case.
 *
 * The load-bearing assertions:
 *
 * - The month read is `submissionMonthKey()` — the SAME key the submit route
 *   writes. A separately derived key is how a staff view reads zero refusals
 *   on exactly the sites being refused, so the spec pins the real function's
 *   current-month key, not a hardcoded string.
 * - A host with no counter document reports `refused: 0`, not an absent
 *   field — the page must be able to tell "nothing refused" from "not
 *   joined".
 * - The picker case (no `orgId`) does not read counters at all: `forms` is
 *   null and no `getAll` happens, so the global 200-row list stays cheap.
 */

import { submissionMonthKey } from '@aglyn/aglyn/server'

const mockVerifyIdToken = jest.fn()
const mockListGet = jest.fn()
const mockGetAll = jest.fn()

/** A query-snapshot double whose docs carry a `ref` shaped like the real one. */
const hostDoc = (id: string, fields: Record<string, unknown>) => ({
  id,
  get: (key: string) => fields[key],
  ref: {
    collection: (name: string) => ({
      doc: (docId: string) => ({ __counterPath: `hosts/${id}/${name}/${docId}` }),
    }),
  },
})

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    firestore: { FieldPath: { documentId: () => '__name__' } },
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => {
        const chain = {
          where: () => chain,
          orderBy: () => chain,
          startAfter: () => chain,
          limit: () => chain,
          get: () => mockListGet(),
        }
        return {
          collection: () => chain,
          getAll: (...refs: unknown[]) => mockGetAll(...refs),
        }
      },
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json(
      { error: 'Verify your email to continue', reason: 'email-unverified' },
      { status: 403 },
    ),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  // The REAL month key. Stubbing it would let this spec pass while the route
  // derives a different key than the submit route writes — the exact defect
  // AGL-1681 warns about.
  submissionMonthKey: jest.requireActual('@aglyn/aglyn/server')
    .submissionMonthKey,
  pluginRequestFromWeb: async (request: Request) => {
    const url = new URL(request.url)
    return {
      method: request.method,
      query: Object.fromEntries(url.searchParams.entries()),
      headers: {
        authorization: request.headers.get('authorization') ?? undefined,
      },
    }
  },
}))

import { GET } from '../app/api/admin/hosts/route'

const get = (opts: { orgId?: string } = {}) =>
  GET(
    new Request(
      `https://app.aglyn.com/api/admin/hosts${
        opts.orgId ? `?orgId=${opts.orgId}` : ''
      }`,
      { headers: { authorization: 'Bearer tok' } },
    ),
  )

const staffToken = () =>
  mockVerifyIdToken.mockResolvedValueOnce({
    uid: 'staff-1',
    email_verified: true,
    staff: true,
  })

describe('/api/admin/hosts form counters (AGL-1681)', () => {
  beforeEach(() => jest.clearAllMocks())

  it('joins this month’s refusal count and ceiling per host when orgId narrows the list', async () => {
    staffToken()
    mockListGet.mockResolvedValueOnce({
      docs: [
        hostDoc('host-a', { displayName: 'A', subdomain: 'a', orgId: 'org-1' }),
        hostDoc('host-b', { displayName: 'B', subdomain: 'b', orgId: 'org-1' }),
      ],
    })
    const month = submissionMonthKey()
    mockGetAll.mockResolvedValueOnce([
      // host-a tripped the ceiling this month.
      {
        exists: true,
        get: (key: string) =>
          ({ [month]: 12, ceiling: 500, lastRefusedAtMs: 1 })[key],
      },
      // host-b has never tripped it — no counter document at all.
      { exists: false, get: () => undefined },
    ])
    const payload = await (await get({ orgId: 'org-1' })).json()
    expect(payload.hosts).toHaveLength(2)
    expect(payload.hosts[0].forms).toEqual({
      month,
      refused: 12,
      ceiling: 500,
    })
    // A missing counter document is a real zero, not an absent field.
    expect(payload.hosts[1].forms).toEqual({
      month,
      refused: 0,
      ceiling: null,
    })
    // The join read the refusal counter document, per host, in ONE getAll.
    expect(mockGetAll).toHaveBeenCalledTimes(1)
    const refs = mockGetAll.mock.calls[0]
    expect(refs).toEqual(
      expect.arrayContaining([
        { __counterPath: 'hosts/host-a/counters/formSubmissionsRefused' },
        { __counterPath: 'hosts/host-b/counters/formSubmissionsRefused' },
      ]),
    )
  })

  it('reads a STALE counter document as zero for the current month', async () => {
    // The counter document persists from the first trip forever; only the
    // current month key means "refusing now". A route that served `ceiling`
    // or a previous month's count as current would flag a healthy site.
    staffToken()
    mockListGet.mockResolvedValueOnce({
      docs: [hostDoc('host-a', { orgId: 'org-1' })],
    })
    mockGetAll.mockResolvedValueOnce([
      {
        exists: true,
        get: (key: string) =>
          ({ '2020-01': 44, ceiling: 500, lastRefusedAtMs: 1 })[key],
      },
    ])
    const payload = await (await get({ orgId: 'org-1' })).json()
    expect(payload.hosts[0].forms).toEqual({
      month: submissionMonthKey(),
      refused: 0,
      ceiling: 500,
    })
  })

  it('does not read counters for the global picker case (no orgId)', async () => {
    staffToken()
    mockListGet.mockResolvedValueOnce({
      docs: [hostDoc('host-a', { orgId: 'org-1' })],
    })
    const payload = await (await get()).json()
    expect(payload.hosts[0].forms).toBeNull()
    expect(mockGetAll).not.toHaveBeenCalled()
  })
})
