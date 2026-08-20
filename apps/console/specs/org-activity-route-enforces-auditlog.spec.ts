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
 * `org.auditLog` is a PERMISSION now, not a display gate (AGL-2444).
 *
 * It was read in exactly one place — the team page, deciding whether to mount
 * the activity card — while the security rule behind the feed gated on
 * `isOrgWideMember()`, the roster question. So a member whose custom role
 * revoked it saw no card and read `orgs/{orgId}/activity` straight out of any
 * Firestore client. The rule now denies members and this route is the only
 * door; these cases are what make that door a lock.
 *
 * ## The permission check is NOT faked
 *
 * `memberHasOrgPermission` here runs the real `resolveOrgPermissions` over the
 * member document, so the role defaults, the custom role and the per-member
 * override are genuinely exercised. A `jest.fn()` returning a boolean would
 * assert only that the route consults *something* — and "consults something"
 * is exactly what the old team-page check did.
 *
 * ## Every refusal is forced by BRANCH, not by absence
 *
 * Each denial below is a real member of a real org, differing from the
 * allowed case by one field: their role, or one key in their overrides.
 */
import { resolveOrgPermissions } from '@aglyn/aglyn'

const mockVerifyIdToken = jest.fn()
/** The member document `resolveOrgMembership` answers with. */
let member: Record<string, unknown> | null = null
/** Entries in `orgs/org-1/activity`, and the query the route built. */
let activity: Array<Record<string, unknown>> = []
let ordering: Array<[string, string]> = []
let capped: number | null = null

const snapshot = (id: string, data: any) => ({
  id,
  exists: Boolean(data),
  data: () => data,
  get: (key: string) => data?.[key],
})

function activityQuery(): any {
  return {
    orderBy: (field: string, direction: string) => {
      ordering.push([field, direction])
      return activityQuery()
    },
    limit: (count: number) => {
      capped = count
      return activityQuery()
    },
    get: async () => ({
      docs: activity.map((entry, index) =>
        snapshot(String(entry['$id'] ?? index), entry),
      ),
    }),
  }
}

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({
        verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args),
      }),
      firestore: () => ({
        collection: () => ({
          doc: () => ({ collection: () => (global as any).__activityQuery() }),
        }),
      }),
    }),
  },
  emailUnverifiedResponse: () =>
    Response.json({ error: 'Verify your email' }, { status: 403 }),
  isImpersonationSession: () => false,
  resolveOrgMembership: async () =>
    (global as any).__member ? { orgId: 'org-1', member: (global as any).__member } : null,
  // THE REAL RESOLUTION, not a boolean. A custom-role document is the one
  // thing not modelled — the route reads none in these fixtures — so the
  // member's own `permissions` overrides carry the narrowing instead, which
  // is the same merge step and the same failure mode.
  memberHasOrgPermission: async (
    _orgId: string,
    subject: unknown,
    permission: string,
  ) =>
    Boolean(
      (
        jest.requireActual('@aglyn/aglyn/app-utils/org-permissions') as {
          resolveOrgPermissions: typeof resolveOrgPermissions
        }
      ).resolveOrgPermissions(subject as never)[permission as never],
    ),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  ...(jest.requireActual('@aglyn/aglyn/app-utils/org-permissions') as object),
  pluginRequestFromWeb: async (request: Request) => {
    const url = new URL(request.url)
    return {
      method: request.method,
      query: Object.fromEntries(url.searchParams.entries()),
      body: undefined,
      headers: {
        authorization: request.headers.get('authorization') ?? undefined,
      },
    }
  },
}))
;(global as any).__activityQuery = () => activityQuery()

import { GET } from '../app/api/orgs/activity/route'

const get = (orgId = 'org-1') =>
  GET(
    new Request(`https://console.test/api/orgs/activity?orgId=${orgId}`, {
      headers: { authorization: 'Bearer token' },
    }),
  )

beforeEach(() => {
  jest.clearAllMocks()
  ordering = []
  capped = null
  activity = [
    { $id: 'c', action: 'Newest', createdAt: { seconds: 300 } },
    { $id: 'b', action: 'Middle', createdAt: { seconds: 200 } },
  ]
  mockVerifyIdToken.mockResolvedValue({
    uid: 'u1',
    email_verified: true,
    staff: false,
  })
  member = { $id: 'u1', role: 'admin' }
  ;(global as any).__member = member
})

describe('the activity feed is gated on org.auditLog (AGL-2444)', () => {
  it('answers an admin, whose role carries the permission by default', () => {
    // The instrument. Every refusal below differs from THIS fixture by one
    // field, so a route that refused everybody would not read as a guard.
    return get().then(async (response) => {
      expect(response.status).toBe(200)
      const payload = await response.json()
      expect(payload.entries.map((entry: any) => entry.$id)).toEqual(['c', 'b'])
    })
  })

  it('REFUSES a viewer, whose role does not', async () => {
    ;(global as any).__member = { $id: 'u1', role: 'viewer' }
    // The role really is the only difference, and it really does resolve off.
    expect(resolveOrgPermissions({ role: 'viewer' } as never)['org.auditLog']).toBe(
      false,
    )
    const response = await get()
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({
      error: 'org.auditLog required',
    })
  })

  it('REFUSES an admin whose per-member override revokes it', async () => {
    // The case the old display gate hid rather than enforced: an owner builds
    // a narrower seat, and before this the member simply read the collection.
    ;(global as any).__member = {
      $id: 'u1',
      role: 'admin',
      permissions: { 'org.auditLog': false },
    }
    const response = await get()
    expect(response.status).toBe(403)
  })

  it('REFUSES someone who is not a member of the org at all', async () => {
    ;(global as any).__member = null
    expect((await get()).status).toBe(403)
  })

  it('lets STAFF through without a membership', async () => {
    // The staff console reads across orgs by design, gated on the claim.
    ;(global as any).__member = null
    mockVerifyIdToken.mockResolvedValue({
      uid: 'staff-1',
      email_verified: true,
      staff: true,
    })
    expect((await get()).status).toBe(200)
  })

  it('refuses an unverified email and an absent token', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'u1', email_verified: false })
    expect((await get()).status).toBe(403)
    const anonymous = await GET(
      new Request('https://console.test/api/orgs/activity?orgId=org-1'),
    )
    expect(anonymous.status).toBe(401)
  })
})

/**
 * The ORDERED, capped window moved here from the client (AGL-2292 → AGL-2444).
 *
 * The original defect was `limit(200)` with no `orderBy`: Firestore returns
 * document-id order, `logOrgActivity` writes auto-ids, so the window was a
 * pseudo-random SAMPLE that the client sort then dutifully ordered. It looked
 * right and was wrong. That property now lives in this route, so its guard
 * has to live here too — deleting the client query without moving the
 * assertion would have retired the test along with the code it watched.
 */
describe('the window is ordered and capped, server-side', () => {
  it('orders by createdAt descending and caps at 200', async () => {
    await get()
    expect(ordering).toContainEqual(['createdAt', 'desc'])
    expect(capped).toBe(200)
  })

  it('flattens createdAt to seconds, and to null when it has none', async () => {
    // A Firestore `Timestamp` through JSON arrives as `{_seconds}`, which the
    // card's tie-break sort reads as `undefined` and sorts to the bottom —
    // silently, on exactly the rows written moments ago.
    activity = [
      { $id: 'a', action: 'One', createdAt: { seconds: 10, nanoseconds: 5 } },
      { $id: 'b', action: 'Pending write' },
    ]
    const payload = await (await get()).json()
    expect(payload.entries[0].createdAt).toEqual({ seconds: 10 })
    expect(payload.entries[1].createdAt).toBeNull()
  })
})
