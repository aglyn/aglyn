/**
 * @jest-environment node
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
 * Last activity on the staff Users and Organizations lists.
 *
 *  - An account's is the later of its Auth sign-in and session refresh.
 *  - An organization's is `lastActivityAt`, stamped by
 *    `/api/orgs/last-activity` for a MEMBER only (never staff browsing, never
 *    an impersonation session), at most once per interval per organization,
 *    and never creating an organization that does not exist.
 *  - The org shell beats at most once per interval per browser.
 */

const mockVerifyIdToken = jest.fn()
const mockResolveOrgMembership = jest.fn()
const mockImpersonating = jest.fn(() => false)
const mockOrgGet = jest.fn()
const mockOrgUpdate = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: (...args: unknown[]) => mockVerifyIdToken(...args) }),
      firestore: () => ({
        collection: () => ({
          doc: () => ({ get: () => mockOrgGet(), update: (data: unknown) => mockOrgUpdate(data) }),
        }),
      }),
    }),
  },
  isImpersonationSession: () => mockImpersonating(),
  emailUnverifiedResponse: () => Response.json({ error: 'Verify your email' }, { status: 403 }),
  resolveOrgMembership: (...args: unknown[]) => mockResolveOrgMembership(...args),
}))

jest.mock('@aglyn/aglyn/server', () => ({
  __esModule: true,
  pluginRequestFromWeb: async (request: Request) => ({
    method: request.method,
    body: request.method === 'POST' ? await request.json() : undefined,
    headers: { authorization: request.headers.get('authorization') ?? undefined },
  }),
}))

jest.mock('firebase-admin/firestore', () => ({
  __esModule: true,
  FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
}))

import { POST } from '../app/api/orgs/last-activity/route'
import { orgActivityBeatDue } from '../hooks/use-org-last-activity'
import { accountLastActiveAt } from '../utils/list-filters'
import { ORG_LAST_ACTIVITY_INTERVAL_MS } from '../utils/org-list-query'
import {
  orgActivityIsStale,
  stampOrgLastActivity,
  type OrgActivityStore,
} from '../utils/server/org-last-activity'

const MIN = 60_000
const NOW = Date.parse('2026-10-09T20:00:00.000Z')

describe('an account last activity', () => {
  it('is the later of the last sign-in and the last session refresh', () => {
    expect(
      accountLastActiveAt({
        lastSignInTime: 'Thu, 01 Oct 2026 00:00:00 GMT',
        lastRefreshTime: '2026-10-09T19:00:00.000Z',
      }),
    ).toBe('2026-10-09T19:00:00.000Z')
    expect(
      accountLastActiveAt({
        lastSignInTime: 'Fri, 09 Oct 2026 19:30:00 GMT',
        lastRefreshTime: '2026-10-09T19:00:00.000Z',
      }),
    ).toBe('2026-10-09T19:30:00.000Z')
  })

  it('is null for an account that has never signed in', () => {
    expect(accountLastActiveAt({})).toBeNull()
    expect(accountLastActiveAt({ lastSignInTime: null, lastRefreshTime: null })).toBeNull()
  })
})

describe('an organization last activity is stale only past the interval', () => {
  it('writes when missing, unreadable or older than the interval', () => {
    expect(orgActivityIsStale(undefined, NOW)).toBe(true)
    expect(orgActivityIsStale('garbage', NOW)).toBe(true)
    expect(orgActivityIsStale({ seconds: (NOW - ORG_LAST_ACTIVITY_INTERVAL_MS) / 1000 }, NOW)).toBe(
      true,
    )
    expect(orgActivityIsStale({ toMillis: () => NOW - 5 * MIN }, NOW)).toBe(false)
    expect(orgActivityIsStale(new Date(NOW + 5 * MIN), NOW)).toBe(false)
  })
})

describe('stampOrgLastActivity', () => {
  const store = (exists: boolean, stored: unknown) => {
    const update = jest.fn(async () => undefined)
    const db: OrgActivityStore = {
      collection: () => ({
        doc: () => ({
          get: async () => ({ exists, get: () => stored }),
          update,
        }),
      }),
    }
    return { db, update }
  }

  it('stamps the server clock when stale', async () => {
    const { db, update } = store(true, { toMillis: () => NOW - 60 * MIN })
    await expect(stampOrgLastActivity(db, 'org-1', NOW)).resolves.toBe('stamped')
    expect(update).toHaveBeenCalledWith({ lastActivityAt: 'SERVER_TIMESTAMP' })
  })

  it('writes nothing inside the interval — the per-org bound on writes', async () => {
    const { db, update } = store(true, { toMillis: () => NOW - 3 * MIN })
    await expect(stampOrgLastActivity(db, 'org-1', NOW)).resolves.toBe('fresh')
    expect(update).not.toHaveBeenCalled()
  })

  it('never creates an organization that does not exist', async () => {
    const { db, update } = store(false, undefined)
    await expect(stampOrgLastActivity(db, 'org-1', NOW)).resolves.toBe('missing')
    expect(update).not.toHaveBeenCalled()
  })
})

describe('POST /api/orgs/last-activity', () => {
  const call = (body: unknown, token: string | null = 'token') =>
    POST(
      new Request('https://app.aglyn.com/api/orgs/last-activity', {
        method: 'POST',
        headers: token ? { authorization: `Bearer ${token}` } : {},
        body: JSON.stringify(body),
      }),
    )

  beforeEach(() => {
    jest.clearAllMocks()
    mockImpersonating.mockReturnValue(false)
    mockVerifyIdToken.mockResolvedValue({ uid: 'u1', email_verified: true })
    mockResolveOrgMembership.mockResolvedValue({ orgId: 'org-1', member: { $id: 'u1' } })
    mockOrgGet.mockResolvedValue({ exists: true, get: () => undefined })
    mockOrgUpdate.mockResolvedValue(undefined)
  })

  it('stamps the organization for a member', async () => {
    const response = await call({ orgId: 'org-1' })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ stamped: true })
    expect(mockResolveOrgMembership).toHaveBeenCalledWith('u1', 'org-1')
    expect(mockOrgUpdate).toHaveBeenCalledWith({ lastActivityAt: 'SERVER_TIMESTAMP' })
  })

  it('writes nothing for someone who is not a member — staff included', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 's1', email_verified: true, staff: true })
    mockResolveOrgMembership.mockResolvedValue(null)
    const response = await call({ orgId: 'org-1' })
    expect(await response.json()).toMatchObject({ stamped: false })
    expect(mockOrgUpdate).not.toHaveBeenCalled()
  })

  it('writes nothing for an impersonation session: that is staff, not the customer', async () => {
    mockImpersonating.mockReturnValue(true)
    const response = await call({ orgId: 'org-1' })
    expect(await response.json()).toMatchObject({ stamped: false })
    expect(mockResolveOrgMembership).not.toHaveBeenCalled()
    expect(mockOrgUpdate).not.toHaveBeenCalled()
  })

  it('refuses without a token or an org', async () => {
    expect((await call({ orgId: 'org-1' }, null)).status).toBe(401)
    expect((await call({})).status).toBe(400)
    expect((await call({ orgId: 'org-1/members/x' })).status).toBe(400)
    expect(mockOrgUpdate).not.toHaveBeenCalled()
  })
})

describe('the org shell beat', () => {
  it('is due at most once per interval', () => {
    expect(orgActivityBeatDue(0, NOW)).toBe(true)
    expect(orgActivityBeatDue(NOW - 5 * MIN, NOW)).toBe(false)
    expect(orgActivityBeatDue(NOW - ORG_LAST_ACTIVITY_INTERVAL_MS, NOW)).toBe(true)
  })
})
