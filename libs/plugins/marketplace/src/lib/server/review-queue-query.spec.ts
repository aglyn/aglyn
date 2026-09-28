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
 * The staff review queue answers its Status select and its search with the
 * QUERY (AGL-3321).
 *
 * It read a hundred plugin listings and the page matched both over them, so a
 * plugin past the hundredth was in no section at all — the queue a reviewer
 * trusts to say what is waiting. The double below answers each `where` the
 * route puts on its query the way Firestore would (`answerListQuery`, the
 * contract's own restatement), so what comes back is what the query asked.
 */
import {
  answerListQuery,
} from '@aglyn/tenant-feature-instance/testing/list-query-double'
import { listingQueryFields } from '../model/listing-query'

export {}

type Row = Record<string, unknown> & { $id: string }

let listings: Row[] = []
const versions = new Map<string, Record<string, unknown>>()
const asked: Array<Array<{ path: string; op: string; value: unknown }>> = []

const mockVerifyIdToken = jest.fn()

function mockMakeFirestore() {
  const snapshot = (row: Row) => ({
    id: row.$id,
    data: () => row,
    get: (field: string) => row[field],
    ref: {
      collection: () => ({
        doc: (version: string) => ({
          get: async () => {
            const data = versions.get(`${row.$id}/${version}`)
            return { exists: Boolean(data), get: (field: string) => data?.[field] }
          },
        }),
        orderBy: () => ({ limit: () => ({ get: async () => ({ docs: [] }) }) }),
      }),
    },
  })
  const query = (
    filters: Array<{ path: string; op: string; value: unknown }>,
    order: { path: string; direction: 'asc' | 'desc' } | null,
    cap: number | null,
  ): any => ({
    where: (path: unknown, op: string, value: unknown) =>
      query([...filters, { path: String(path), op, value }], order, cap),
    orderBy: (path: unknown, direction: 'asc' | 'desc' = 'asc') =>
      query(filters, { path: String(path), direction }, cap),
    limit: (next: number) => query(filters, order, next),
    get: async () => {
      asked.push(filters)
      const answered = answerListQuery(listings, {
        filters: filters as never,
        orderBy: order ?? { path: '__name__', direction: 'asc' },
        served: [],
        searched: null,
        refused: [],
        notices: [],
      })
      return { docs: answered.slice(0, cap ?? answered.length).map(snapshot) }
    },
  })
  return {
    collection: () => ({ ...query([], null, null), doc: (id: string) => ({ id }) }),
    getAll: async (...refs: unknown[]) => refs.map(() => ({ exists: false })),
  }
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args) }),
      firestore: () => mockMakeFirestore(),
    }),
  },
  isImpersonationSession: () => false,
  emailUnverifiedResponse: () => Response.json({ error: 'Verify your email' }, { status: 403 }),
  updateExisting: async () => true,
  listOrgMembers: async () => [],
  meterPlatformEmail: async () => undefined,
  notifyOrgAdmins: async () => undefined,
  findUserByUidAcrossPools: async () => null,
}))

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => '__now__', delete: () => '__delete__' },
  // The document id, as the plan spells it, so the double can read it.
  FieldPath: { documentId: () => '__name__' },
  Timestamp: { fromDate: (date: Date) => date },
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  compareArtifactVersions: () => 0,
  checkPluginBundle: () => ({ ok: true, findings: [] }),
  isPluginRevoked: () => false,
  newestInstallableVersion: () => null,
  nextRevocationState: () => null,
  isStoredVerdictCurrent: () => true,
  PLUGIN_HOST_ABI_VERSION: 1,
  PLUGIN_VERIFIER_VERSION: 5,
  pluginArtifactPath: () => 'artifacts/x',
  buildRoute: () => '/',
  Route: {},
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body: {},
    query: Object.fromEntries(new URL(request.url).searchParams),
    headers: Object.fromEntries(request.headers),
  }),
}))

jest.mock('@aglyn/shared-util-email', () => ({
  __esModule: true,
  sendEmail: async () => ({ sent: true }),
}))

const { marketplaceAdminReviews: route } = require('./admin-reviews') as {
  marketplaceAdminReviews: (request: Request) => Promise<Response>
}

const get = async (params = '') => {
  const response = await route(
    new Request(`https://app.aglyn.com/api/marketplace/admin/reviews${params}`, {
      headers: { authorization: 'Bearer staff-token' },
    }),
  )
  expect(response.status).toBe(200)
  return response.json()
}

/** A plugin listing as the publish route stores it, query fields included. */
const plugin = (id: string, fields: Record<string, unknown>): Row => {
  const listing = {
    type: 'plugin',
    artifactType: 'plugin',
    profileId: 'org-1',
    latestVersion: '1.0.0',
    deletedAt: null,
    reviewStatus: 'submitted',
    latestVersionReviewState: 'pending',
    ...fields,
  }
  return { $id: id, ...listing, ...listingQueryFields(listing) }
}

beforeEach(() => {
  mockVerifyIdToken.mockResolvedValue({ uid: 'staff-1', staff: true, email_verified: true })
  asked.length = 0
  versions.clear()
  // A hundred and fifty plugins waiting on review, the one a reviewer is
  // looking for sorting a hundred and fortieth by id.
  listings = Array.from({ length: 150 }, (_, index) =>
    plugin(`p${String(index).padStart(3, '0')}`, {
      displayName: index === 140 ? 'Zebra Hours' : `Widget ${index}`,
    }),
  )
})

describe('the review queue serves its search and status by the query (AGL-3321)', () => {
  it('reads a page of each section and says when there is more', async () => {
    const body = await get()
    expect(body.queue).toHaveLength(100)
    expect(body.more.queue).toBe(true)
    expect(body.queue.map((row: any) => row.displayName)).not.toContain('Zebra Hours')
  })

  it('finds by name a plugin past the first hundred', async () => {
    const body = await get('?q=zeb')
    expect(body.queue.map((row: any) => row.listingId)).toEqual(['p140'])
    expect(body.more.queue).toBe(false)
    // On the query, beside the section's scope — not matched afterwards.
    expect(asked[0]).toContainEqual({ path: 'nameTokens', op: 'array-contains', value: 'zeb' })
  })

  it('keeps a revoked or approved version out of Awaiting review', async () => {
    listings = [
      plugin('a', { displayName: 'Approved', latestVersionReviewState: 'approved', reviewStatus: 'listed' }),
      plugin('b', { displayName: 'Revoked', latestVersionReviewState: 'revoked', reviewStatus: 'listed' }),
      plugin('c', { displayName: 'Rejected', latestVersionReviewState: 'rejected' }),
      plugin('d', { displayName: 'Waiting' }),
    ]
    const body = await get()
    expect(body.queue.map((row: any) => row.listingId)).toEqual(['c', 'd'])
    expect(body.listed.map((row: any) => row.listingId)).toEqual(['a', 'b'])
  })

  it('narrows every section by Status, and Taken down by its flag', async () => {
    listings = [
      plugin('a', { displayName: 'Listed One', reviewStatus: 'listed', latestVersionReviewState: 'approved' }),
      plugin('b', { displayName: 'Verified One', reviewStatus: 'verified', latestVersionReviewState: 'approved' }),
      plugin('c', {
        displayName: 'Down One',
        reviewStatus: 'listed',
        latestVersionReviewState: 'approved',
        hiddenAt: { seconds: 1 },
      }),
      plugin('d', { displayName: 'Submitted One' }),
    ]
    const verified = await get('?status=verified')
    expect(verified.listed.map((row: any) => row.listingId)).toEqual(['b'])
    expect(verified.queue).toEqual([])
    const submitted = await get('?status=submitted')
    expect(submitted.queue.map((row: any) => row.listingId)).toEqual(['d'])
    // A status the Listed section cannot hold leaves it empty without a read.
    expect(submitted.listed).toEqual([])
    const down = await get('?status=hidden')
    expect(down.listed.map((row: any) => row.listingId)).toEqual(['c'])
  })

  it('never lists a deleted plugin or a non-plugin listing', async () => {
    listings = [
      plugin('a', { displayName: 'Gone', deletedAt: { seconds: 1 } }),
      { $id: 'b', artifactType: 'component', displayName: 'Component', deletedAt: null, latestVersionReviewState: 'pending' },
      plugin('c', { displayName: 'Waiting' }),
    ]
    const body = await get()
    expect(body.queue.map((row: any) => row.listingId)).toEqual(['c'])
  })

  it('pages each section further when asked', async () => {
    const body = await get('?limit=200')
    expect(body.queue).toHaveLength(150)
    expect(body.more.queue).toBe(false)
  })
})
