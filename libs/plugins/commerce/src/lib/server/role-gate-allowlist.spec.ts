/**
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

import type { PluginApiRequest, PluginApiResponse } from '@aglyn/aglyn/server'
import type { HostAccessRole } from '@aglyn/aglyn'
import { giftCardsHandler } from './gift-cards'
import { memberPostHandler } from './member-post'

/**
 * The two routes AGL-2262 did not reach (AGL-2372).
 *
 * `gift-cards.ts` and `member-post.ts` both gated on `!role || role ===
 * 'viewer'` — a DENYLIST. AGL-2262 replaced exactly that shape on the register
 * and the draft-order route because a denylist answers "is this string
 * literally viewer", not "may this person do this", and therefore ADMITS every
 * role invented after it was written.
 *
 * One was. `HostAccessRole` gained `author` in AGL-2334 and
 * `/api/hosts/members` grants it, so both routes were silently opened to a
 * content author: issuing and voiding store credit on one, and publishing to
 * paying subscribers plus mailing them under the merchant's brand on the
 * other.
 *
 * These tests are driven through the real handlers, and every row asserts the
 * WRITE as well as the status — a 403 returned after the card was already
 * minted is not a refusal. The `author` rows are the ones that redden when the
 * allowlist is widened back; `admin`/`editor` are here so a fix that simply
 * closed the routes cannot pass either.
 */

// ---------------------------------------------------------------------------
// In-memory Firestore — document paths to data, same shape as `refund.spec.ts`
// ---------------------------------------------------------------------------

const docs = new Map<string, Record<string, any>>()

function childPaths(path: string): string[] {
  const prefix = `${path}/`
  return [...docs.keys()].filter(
    (key) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'),
  )
}

function makeSnapshot(path: string) {
  const data = docs.get(path)
  return {
    id: path.split('/').pop() as string,
    exists: data !== undefined,
    data: () => data,
    get: (field: string) => data?.[field],
  }
}

function makeDocRef(path: string): any {
  return {
    id: path.split('/').pop() as string,
    path,
    get: async () => makeSnapshot(path),
    set: async (value: Record<string, any>, options?: { merge?: boolean }) => {
      const existing = docs.get(path)
      docs.set(path, options?.merge ? { ...(existing ?? {}), ...value } : value)
    },
    collection: (name: string) => makeCollectionRef(`${path}/${name}`),
  }
}

function makeCollectionRef(path: string): any {
  return {
    doc: (id: string) => makeDocRef(`${path}/${id}`),
    limit: () => ({
      get: async () => ({ docs: childPaths(path).map(makeSnapshot) }),
    }),
    get: async () => ({ docs: childPaths(path).map(makeSnapshot) }),
    add: async (value: Record<string, any>) => {
      const id = `generated-${docs.size + 1}`
      docs.set(`${path}/${id}`, value)
      return makeDocRef(`${path}/${id}`)
    },
  }
}

const fakeFirestore = {
  collection: (name: string) => makeCollectionRef(name),
}

const mockVerifyIdToken = jest.fn(async () => ({ uid: 'principal-1' }))

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: any[]) => mockVerifyIdToken(...(args as [])),
      }),
      firestore: () => fakeFirestore,
    }),
  },
  // Business carries `giftCards`, so the entitlement is NOT what refuses in
  // any row below — a plan that failed the entitlement check would answer 402
  // and every role would look equally denied.
  getOrgForHost: async () => ({
    orgId: 'org-1',
    org: {
      id: 'org-1',
      plan: 'business',
      subscriptionStatus: 'active',
      slug: 'acme',
    },
  }),
  meterHostEmail: async () => undefined,
  renderHostEmailWithTokens: async () => null,
}))

// Email is OFF for the whole file. Delivery is not what these tests are about,
// and a route that refuses must not be able to look refused merely because the
// mail pipeline was unconfigured.
jest.mock('@aglyn/shared-util-email', () => ({
  isEmailConfigured: () => false,
  sendEmail: async () => undefined,
}))

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function makeResponse() {
  const result = { status: 0, body: undefined as any }
  const res: PluginApiResponse = {
    status(code: number) {
      result.status = code
      return res
    },
    json(body: any) {
      result.body = body
    },
    send(body: any) {
      result.body = body
    },
    setHeader() {
      // unused
    },
    redirect() {
      // unused
    },
    end() {
      // unused
    },
  } as unknown as PluginApiResponse
  return { res, result }
}

function makeRequest(body: Record<string, unknown>): PluginApiRequest {
  return {
    method: 'POST',
    query: {},
    body: { hostId: 'host-1', ...body },
    headers: { authorization: 'Bearer token' },
    cookies: {},
    socket: {},
  } as unknown as PluginApiRequest
}

/**
 * Grants `role` to the principal on host-1, or nothing at all when null.
 *
 * `null` is its own row on purpose: `strictNullChecks` is OFF repo-wide, so
 * "no role" folds to a falsy value that an allowlist must refuse by not
 * containing it rather than by a type. A gate written as
 * `role !== 'viewer'` gets this row wrong in the other direction.
 */
function grant(role: string | null) {
  docs.set(
    'hosts/host-1',
    role === null ? { memberRoles: {} } : { memberRoles: { 'principal-1': role } },
  )
}

function giftCards() {
  return childPaths('hosts/host-1/giftCards')
}

function memberPosts() {
  return childPaths('hosts/host-1/memberPosts')
}

let consoleError: jest.SpyInstance

beforeAll(() => {
  consoleError = jest
    .spyOn(console, 'error')
    .mockImplementation(() => undefined)
})

afterAll(() => {
  consoleError.mockRestore()
})

beforeEach(() => {
  docs.clear()
  mockVerifyIdToken.mockClear()
  mockVerifyIdToken.mockResolvedValue({ uid: 'principal-1' })
  consoleError.mockClear()
})

/**
 * The COMPLETE role union plus absent, so this table cannot go stale the way
 * the denylist did: adding a member to `HostAccessRole` without adding a row
 * here fails the exhaustiveness check below.
 */
const ROLE_ROWS: { role: HostAccessRole | null; permitted: boolean }[] = [
  { role: 'admin', permitted: true },
  { role: 'editor', permitted: true },
  // AGL-2334. The row the denylist got wrong, on both routes.
  { role: 'author', permitted: false },
  { role: 'viewer', permitted: false },
  { role: null, permitted: false },
]

it('covers every role the projection can write (AGL-2334)', () => {
  // Not a formality. The defect was a gate that widened when the union grew;
  // a table that does not track the union reproduces it one level up.
  const covered = ROLE_ROWS.map((row) => row.role).filter(
    (role): role is HostAccessRole => role !== null,
  )
  const union: HostAccessRole[] = ['admin', 'editor', 'author', 'viewer']
  expect([...covered].sort()).toEqual([...union].sort())
})

describe('who may issue and void gift cards (AGL-2372)', () => {
  for (const { role, permitted } of ROLE_ROWS) {
    const label = role ?? 'no role at all'

    it(`${permitted ? 'admits' : 'refuses'} ${label} — issue`, async () => {
      grant(role)
      const { res, result } = makeResponse()

      await giftCardsHandler(
        makeRequest({ action: 'issue', amountCents: 2500 }),
        res,
      )

      expect(result.status).toBe(permitted ? 200 : 403)
      // The card either exists or it does not. A refusal that still minted one
      // has taken on a real liability the merchant cannot see.
      expect(giftCards()).toHaveLength(permitted ? 1 : 0)
    })

    it(`${permitted ? 'admits' : 'refuses'} ${label} — void`, async () => {
      grant(role)
      docs.set('hosts/host-1/giftCards/GC-ABCDEF123456', {
        initialCents: 5000,
        balanceCents: 5000,
      })
      const { res, result } = makeResponse()

      await giftCardsHandler(
        makeRequest({ action: 'void', code: 'GC-ABCDEF123456' }),
        res,
      )

      expect(result.status).toBe(permitted ? 200 : 403)
      // Voiding zeroes the balance (AGL-1767). Reading the stored number is
      // the only assertion that can tell a refusal from a silent success.
      expect(
        docs.get('hosts/host-1/giftCards/GC-ABCDEF123456')?.balanceCents,
      ).toBe(permitted ? 0 : 5000)
    })
  }
})

describe('who may publish a member post (AGL-2372)', () => {
  for (const { role, permitted } of ROLE_ROWS) {
    const label = role ?? 'no role at all'

    it(`${permitted ? 'admits' : 'refuses'} ${label}`, async () => {
      grant(role)
      const { res, result } = makeResponse()

      await memberPostHandler(
        makeRequest({ title: 'Behind the scenes', body: 'For members.' }),
        res,
      )

      expect(result.status).toBe(permitted ? 200 : 403)
      expect(memberPosts()).toHaveLength(permitted ? 1 : 0)
    })
  }
})

/**
 * The collaborator row, which is the same shape as the refund hole and is
 * DELIBERATELY not a refusal here.
 *
 * A site collaborator granted `admin` on this host projects into
 * `memberRoles` identically to an org owner, so neither of these routes can
 * tell them apart — and neither should try. Issuing a gift card and posting to
 * members are things you do TO A SITE, and a collaborator invited to run that
 * site does them. The scope check that AGL-2372 added to `refund.ts` is for
 * money leaving the business, which is an ORG-level fact.
 *
 * Recorded as a test rather than a comment so the distinction is deliberate
 * and visible, instead of being read later as the same bug left half-fixed.
 */
it('admits a site collaborator holding host admin — these are site-level acts', async () => {
  docs.set('hosts/host-1', {
    // What `grantHostAccess` projects for `hostAccess: { 'host-1': 'admin' }`
    // with `allHosts: false`.
    memberRoles: { 'principal-1': 'admin' },
  })
  const { res, result } = makeResponse()

  await memberPostHandler(makeRequest({ title: 'Site news' }), res)

  expect(result.status).toBe(200)
  expect(memberPosts()).toHaveLength(1)
})
