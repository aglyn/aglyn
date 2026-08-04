/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored and this runs on jsdom, which has no Response.
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
 * AGL-1253: the seat count moves off the client's roster list.
 *
 * The quota banner counted seats with an unconstrained
 * `getDocs(collection(firestore,'orgs',orgId,'members'))`. A list is evaluated
 * against the QUERY, so the rule's `memberUid == request.auth.uid` clause can
 * never satisfy it — measured denied on production 2026-08-04 for an account
 * the client had already decided was org-wide.
 *
 * Gating harder could not have fixed it: the CLIENT's `isOrgWideMember` counts
 * a legacy doc with no `allHosts` and no `hostAccess` as org-wide, while the
 * rules read `get('allHosts', false)`. The two disagree, so the guard passes
 * and the query still fails. Hence a server answer.
 *
 * The load-bearing test here is the privacy one: `?counts=1` must return the
 * NUMBER and not the roster. The banner renders for every member, and AGL-1026
 * restricted who may see the org's names and emails.
 */

const mockVerifyIdToken = jest.fn()
const mockListOrgMembers = jest.fn()
const mockResolveOrgMembership = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => ({
  __esModule: true,
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: (...a: unknown[]) => mockVerifyIdToken(...a) }),
      firestore: () => ({
        collection: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) }),
      }),
    }),
  },
  emailUnverifiedResponse: () =>
    Response.json({ error: 'unverified' }, { status: 403 }),
  findUserByEmailAcrossPools: jest.fn(),
  findUserByUidAcrossPools: jest.fn(),
  isImpersonationSession: () => false,
  listOrgMembers: (...a: unknown[]) => mockListOrgMembers(...a),
  logOrgActivity: jest.fn(),
  memberHasOrgPermission: jest.fn(async () => true),
  notifyUsers: jest.fn(),
  removeOrgMember: jest.fn(),
  resolveOrgMembership: (...a: unknown[]) => mockResolveOrgMembership(...a),
  upsertOrgMember: jest.fn(),
}))

jest.mock('@aglyn/shared-util-email', () => ({
  __esModule: true,
  isEmailConfigured: () => false,
  sendEmail: jest.fn(),
}))

jest.mock('../app/api/_lib/render-system-email', () => ({
  __esModule: true,
  renderSystemEmail: jest.fn(),
}))

import { GET } from '../app/api/orgs/members/route'

/** A manager (org-wide) and a site-scoped collaborator. */
const ROSTER = [
  { $id: 'u1', role: 'owner', allHosts: true, email: 'owner@x.test' },
  { $id: 'u2', role: 'admin', allHosts: true, email: 'admin@x.test' },
  // Scoped collaborator — a member doc, but NOT a manager seat (AGL-1113).
  { $id: 'u3', role: 'editor', allHosts: false, hostAccess: { h1: 'editor' }, email: 'collab@x.test' },
]

const get = (qs: string) =>
  GET(
    new Request(`https://app.aglyn.com/api/orgs/members${qs}`, {
      headers: { authorization: 'Bearer tok' },
    }),
  )

describe('GET /api/orgs/members?counts=1 (AGL-1253)', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockVerifyIdToken.mockResolvedValue({ uid: 'u1', email_verified: true })
    mockResolveOrgMembership.mockResolvedValue({ role: 'owner' })
    mockListOrgMembers.mockResolvedValue(ROSTER)
  })

  it('counts MANAGER seats, not every member', async () => {
    const body = await (await get('?orgId=o1&counts=1')).json()
    // 2, not 3 — the scoped collaborator is metered per host, and counting
    // the whole collection is what put a false "out of team seats" banner in
    // front of orgs that had only spent collaborator seats (AGL-1113).
    expect(body.managerSeats).toBe(2)
    expect(body.memberCount).toBe(3)
  })

  it('does NOT return the roster in counts mode', async () => {
    const response = await get('?orgId=o1&counts=1')
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).not.toHaveProperty('members')
    // Belt and braces: no email may appear anywhere in the payload. The
    // banner renders for every member of the org, so shipping the roster to
    // satisfy one integer would undo AGL-1026.
    expect(JSON.stringify(body)).not.toContain('@x.test')
  })

  it('CONTROL — the plain GET still returns the roster', async () => {
    // Without this, "counts mode hides the roster" would also pass against a
    // route that had stopped returning members at all.
    const body = await (await get('?orgId=o1')).json()
    expect(body.members).toHaveLength(3)
    expect(JSON.stringify(body)).toContain('@x.test')
  })

  it('CONTROL — a non-member is refused before any count is computed', async () => {
    mockResolveOrgMembership.mockResolvedValue(null)
    const response = await get('?orgId=o1&counts=1')
    expect(response.status).toBe(403)
    expect(mockListOrgMembers).not.toHaveBeenCalled()
  })

  it('CONTROL — an unverified email is refused', async () => {
    mockVerifyIdToken.mockResolvedValue({ uid: 'u1', email_verified: false })
    expect((await get('?orgId=o1&counts=1')).status).toBe(403)
  })

  it('counts=anything-else is the normal roster response', async () => {
    // The flag is exact — `counts=0` or a stray value must not silently
    // switch modes and starve a caller that wanted members.
    const body = await (await get('?orgId=o1&counts=0')).json()
    expect(body.members).toHaveLength(3)
  })
})
