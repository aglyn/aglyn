/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom, where `Request` is not a
 * constructor (feedback_jest_environment_pragma_shadowed_by_license).
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
 * AGL-2008 — the POPULATION the breach report is computed over.
 *
 * `member-state-exposure.spec.ts` proves the bucketing: that `unknown`,
 * `ambiguous` and `outsideScope` are outputs rather than omissions, and that
 * the buckets plus those three sum to the population. Every one of those
 * assertions is about a population handed to `memberStateExposure` as an
 * array. None of them can see the array being built SHORT — which is where
 * the people were actually going missing.
 *
 * ## The defect
 *
 * The route read `collection('users')` and called that the population. But
 * adding a member writes `orgs/{orgId}/members/{uid}` and the reverse index
 * `users/{uid}/orgs/{orgId}` (`organizations.ts:1124,1325`) and writes
 * `users/{uid}` ITSELF nowhere: that document is created only by
 * `seedUserProfile`, at sign-in, and even that is best-effort by its own
 * contract.
 *
 * Firestore does not return a phantom parent from a collection query — a
 * document that exists only as the ancestor of subcollection documents is not
 * in `collection('users').get()`. So an invited member who has not signed in
 * yet was not reported as `unknown`. They were absent: outside
 * `totalSubjects`, hence outside the denominator, so **`coverage` read better
 * the more people we could not place.**
 *
 * That is the failure mode this issue exists to prevent, in its most
 * dangerous form — an omission wearing the shape of completeness — and it ran
 * in the direction that UNDER-COUNTS a filing obligation.
 *
 * ## Why a route spec and not a unit test
 *
 * The bug is not in a function. It is in which documents become subjects at
 * all, and only the handler decides that. A double that served the same list
 * to `collection('users')` and to the org rosters would hide the whole thing,
 * so the fixtures below keep them deliberately, asymmetrically apart: `u-eu`
 * has a profile document, `u-invited` has only a membership row.
 */

export {}

const mockVerifyIdToken = jest.fn()

/** `orgs/{orgId}` documents, by id. */
let mockOrgs: Record<string, Record<string, unknown>> = {}
/** Member uids per org id — `orgs/{orgId}/members`. */
let mockOrgMembers: Record<string, string[]> = {}
/**
 * The `users` COLLECTION QUERY result — profile documents only.
 *
 * Deliberately a separate fixture from `mockUserDevices`. A uid may have
 * devices and no profile document (a best-effort seed that failed), and a uid
 * may have a profile document and no devices. Modelling them as one map would
 * make the phantom parent unrepresentable and this suite would prove nothing.
 */
let mockUserProfileIds: string[] = []
/** `users/{uid}/devices` — readable whether or not the parent doc exists. */
let mockUserDevices: Record<string, string[]> = {}
/** `platformRevenue` rows. */
let mockRevenue: Array<Record<string, unknown>> = []
/** Firebase Auth uids, across every pool — the account register. */
let mockAuthUids: string[] = []
/** Set to make the auth sweep throw, so its failure can be asserted. */
let mockAuthSweepThrows = false

const mockSnap = (docs: Array<{ id: string; data: unknown }>) => ({
  size: docs.length,
  empty: docs.length === 0,
  docs: docs.map((doc) => ({
    id: doc.id,
    exists: true,
    data: () => doc.data,
  })),
})

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        collection: (name: string) => {
          if (name === 'platformRevenue') {
            return {
              limit: (count: number) => ({
                get: async () =>
                  mockSnap(
                    mockRevenue
                      .slice(0, count)
                      .map((data, index) => ({ id: `rev-${index}`, data })),
                  ),
              }),
            }
          }
          if (name === 'orgs') {
            return {
              limit: (count: number) => ({
                get: async () => {
                  const ids = Object.keys(mockOrgs).slice(0, count)
                  return {
                    size: ids.length,
                    empty: ids.length === 0,
                    docs: ids.map((id) => ({
                      id,
                      exists: true,
                      data: () => mockOrgs[id],
                      ref: {
                        collection: (sub: string) => ({
                          get: async () =>
                            sub === 'members'
                              ? mockSnap(
                                  (mockOrgMembers[id] ?? []).map((uid) => ({
                                    id: uid,
                                    data: {},
                                  })),
                                )
                              : mockSnap([]),
                        }),
                      },
                    })),
                  }
                },
              }),
            }
          }
          if (name === 'users') {
            return {
              // The COLLECTION QUERY. It returns profile documents and
              // nothing else — which is precisely Firestore's real behaviour
              // and the whole reason the defect existed.
              limit: (count: number) => ({
                get: async () =>
                  mockSnap(
                    mockUserProfileIds
                      .slice(0, count)
                      .map((id) => ({ id, data: {} })),
                  ),
              }),
              // A DIRECT subcollection read, which works on a phantom parent.
              doc: (uid: string) => ({
                collection: (sub: string) => ({
                  get: async () =>
                    sub === 'devices'
                      ? mockSnap(
                          (mockUserDevices[uid] ?? []).map(
                            (location, index) => ({
                              id: `d-${index}`,
                              data: { location },
                            }),
                          ),
                        )
                      : mockSnap([]),
                }),
              }),
            }
          }
          return { limit: () => ({ get: async () => mockSnap([]) }) }
        },
      }),
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  invalidIdTokenResponse: () => null,
  listUsersAcrossPools: async () => {
    if (mockAuthSweepThrows) throw new Error('pool unreachable')
    return {
      users: mockAuthUids.map((uid) => ({ record: { uid }, tenantId: null })),
      nextPageToken: null,
      tenantsIncluded: true,
      tenantTruncated: [],
    }
  },
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    query: {},
    body: undefined,
    headers: {
      authorization: request.headers.get('authorization') ?? undefined,
      origin: 'https://app.aglyn.com',
      host: 'app.aglyn.com',
    },
  }),
}))

import { GET } from '../app/api/admin/member-state-exposure/route'

async function report(): Promise<Record<string, any>> {
  const response = await GET(
    new Request('https://app.aglyn.com/api/admin/member-state-exposure', {
      method: 'GET',
      headers: { authorization: 'Bearer staff-token' },
    }),
  )
  expect(response.status).toBe(200)
  return response.json()
}

beforeEach(() => {
  mockOrgs = {}
  mockOrgMembers = {}
  mockUserProfileIds = []
  mockUserDevices = {}
  mockRevenue = []
  mockAuthUids = []
  mockAuthSweepThrows = false
  mockVerifyIdToken.mockReset()
  mockVerifyIdToken.mockResolvedValue({
    uid: 'staff-1',
    email_verified: true,
    staff: true,
  })
})

describe('the population is every account holder, not every profile document', () => {
  /**
   * The fixture the whole suite turns on.
   *
   * `org-de` declares Germany and has two members. Only ONE of them has a
   * `users/{uid}` document: `u-eu`, who has signed in and left a device
   * behind. `u-invited` was added to the roster and has never signed in, so
   * their `users/{uid}` document does not exist — they are reachable only
   * through the membership row.
   */
  const invitedMemberWithNoProfileDoc = () => {
    mockOrgs = {
      'org-de': { contact: { address: { country: 'DE' } }, ownerUid: 'u-eu' },
    }
    mockOrgMembers = { 'org-de': ['u-eu', 'u-invited'] }
    mockUserProfileIds = ['u-eu']
    mockUserDevices = { 'u-eu': ['Berlin, BE, DE'] }
  }

  it('COUNTS a member who has no users/{uid} document at all', async () => {
    invitedMemberWithNoProfileDoc()
    const result = await report()

    // The assertion that fails on the old code: the invited member was not
    // in `collection('users')`, so the population was 1.
    expect(result.totalSubjects).toBe(2)
  })

  it('files the invited member with their org’s authority', async () => {
    invitedMemberWithNoProfileDoc()
    const result = await report()

    // Both people are placed in Germany — one by their own sign-in, one by
    // the org that invited them. Dropping the second UNDER-COUNTS a real
    // Art. 33 obligation, which is the expensive direction to be wrong in.
    const germany = result.filings.find((f: any) => f.country === 'DE')
    expect(germany.subjects).toBe(2)
    expect(germany.byProvenance.declared).toBe(2)
    expect(result.euFilingCount).toBe(1)
  })

  it('keeps the invariant: filings + unknown + ambiguous + outsideScope = population', async () => {
    invitedMemberWithNoProfileDoc()
    const result = await report()

    const placed = result.filings.reduce(
      (total: number, filing: any) => total + filing.subjects,
      0,
    )
    expect(
      placed + result.unknown + result.ambiguous + result.outsideScope,
    ).toBe(result.totalSubjects)
  })

  it('reports an unplaceable invited member as UNKNOWN rather than omitting them', async () => {
    // The sharpest case, and the one this issue's brief names outright.
    // `org-none` declares no country, never paid, and the invited member has
    // no device. There is genuinely nothing to place them by — so they must
    // appear as `unknown`, which is an ANSWER, and not vanish, which reads as
    // there being nobody there.
    mockOrgs = { 'org-none': { ownerUid: 'u-owner' } }
    mockOrgMembers = { 'org-none': ['u-owner', 'u-ghost'] }
    mockUserProfileIds = ['u-owner']
    mockUserDevices = { 'u-owner': ['Dublin, D, IE'] }

    const result = await report()

    expect(result.totalSubjects).toBe(2)
    expect(result.unknown).toBe(1)
    // And the denominator moves with it. Silently dropping the person we
    // cannot place would have reported PERFECT coverage over a population of
    // one — the most flattering possible way to be wrong.
    expect(result.coverage).toBeCloseTo(0.5)
  })

  it('does not double-count somebody who is both a profile doc and a member', async () => {
    // The control. A union that deduplicated wrongly would inflate every
    // filing, and an inflated count is no more defensible than a short one.
    mockOrgs = {
      'org-fr': { contact: { address: { country: 'FR' } }, ownerUid: 'u-solo' },
    }
    mockOrgMembers = { 'org-fr': ['u-solo'] }
    mockUserProfileIds = ['u-solo']
    mockUserDevices = { 'u-solo': ['Paris, IDF, FR'] }

    const result = await report()

    expect(result.totalSubjects).toBe(1)
    expect(result.filings).toHaveLength(1)
    expect(result.filings[0].subjects).toBe(1)
  })

  it('recovers the sign-in devices of a uid whose profile seed never landed', async () => {
    // `seedUserProfile` is "best-effort by contract" and self-heals only on
    // the NEXT sign-in, while the security alerting writes `users/{uid}/
    // devices` regardless. So a phantom parent can own real device history.
    // Reading devices by REF rather than through a query snapshot is what
    // keeps that person placeable instead of merely counted.
    mockOrgs = { 'org-x': { ownerUid: 'u-seedless' } }
    mockOrgMembers = { 'org-x': ['u-seedless'] }
    mockUserProfileIds = []
    mockUserDevices = { 'u-seedless': ['Madrid, M, ES'] }

    const result = await report()

    expect(result.totalSubjects).toBe(1)
    expect(result.unknown).toBe(0)
    expect(result.filings[0].country).toBe('ES')
    expect(result.filings[0].inferredOnly).toBe(true)
  })
})

describe('the account register — Firebase Auth, not the profile collection', () => {
  it('counts an account that has no profile doc and belongs to no org', async () => {
    // The residual the org union alone cannot reach. Signing up and never
    // verifying leaves a real Firebase Auth account whose email we hold: the
    // session route refuses at `emailUnverifiedResponse()` BEFORE
    // `seedUserProfile` ever runs, so no profile document is possible, and
    // joining no org means no roster row either. A data subject in every
    // sense, and invisible to both Firestore registers.
    mockAuthUids = ['u-unverified']

    const result = await report()

    expect(result.totalSubjects).toBe(1)
    expect(result.unknown).toBe(1)
    expect(result.coverage).toBe(0)
  })

  it('still counts a lingering member whose auth record was erased', async () => {
    // The opposite direction, and why the auth register does not simply
    // REPLACE the org rosters. Erasure deletes the auth record and can leave
    // `orgs/{orgId}/members/{uid}` behind — `resolve-people.ts:28` names the
    // state outright — and that roster row still carries the person's email.
    mockAuthUids = []
    mockOrgs = {
      'org-ie': { contact: { address: { country: 'IE' } }, ownerUid: 'u-live' },
    }
    mockOrgMembers = { 'org-ie': ['u-live', 'u-lingering'] }
    mockUserProfileIds = []

    const result = await report()

    expect(result.totalSubjects).toBe(2)
    expect(result.filings[0].country).toBe('IE')
    expect(result.filings[0].subjects).toBe(2)
  })

  it('unions the three registers without double-counting the overlap', async () => {
    // The same human in all three. A union that deduplicated wrongly would
    // inflate a filing, and an over-count is no more defensible than a short
    // one — both are a number the report cannot stand behind.
    mockAuthUids = ['u-all']
    mockOrgs = {
      'org-nl': { contact: { address: { country: 'NL' } }, ownerUid: 'u-all' },
    }
    mockOrgMembers = { 'org-nl': ['u-all'] }
    mockUserProfileIds = ['u-all']
    mockUserDevices = { 'u-all': ['Amsterdam, NH, NL'] }

    const result = await report()

    expect(result.totalSubjects).toBe(1)
    expect(result.filings).toHaveLength(1)
    expect(result.filings[0].subjects).toBe(1)
  })

  it('says so when the account register could not be swept', async () => {
    // A swallowed sweep renders as a smaller population that still looks
    // complete — the same shape as a swallowed query rendering as a measured
    // zero. The report must degrade LOUDLY: the buckets it did produce are a
    // lower bound, and nothing in the payload may suggest otherwise.
    mockAuthSweepThrows = true
    mockOrgs = {
      'org-fi': { contact: { address: { country: 'FI' } }, ownerUid: 'u-fi' },
    }
    mockOrgMembers = { 'org-fi': ['u-fi'] }

    const result = await report()

    expect(result.authSweepFailed).toBe(true)
    expect(result.truncated).toBe(true)
    // It still reports what it COULD place — a failed sweep is not a reason
    // to answer nothing during an incident.
    expect(result.totalSubjects).toBe(1)
  })

  it('does not flag a clean sweep as truncated', async () => {
    // The control that keeps the flag meaningful. A `truncated` that is
    // always true is exactly as useless as one that is always false.
    mockAuthUids = ['u-a']

    const result = await report()

    expect(result.authSweepFailed).toBe(false)
    expect(result.truncated).toBe(false)
  })
})
