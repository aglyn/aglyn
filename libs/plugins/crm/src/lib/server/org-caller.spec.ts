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

/**
 * `data.manage` IS THE PERMISSION CATALOG'S TO ANSWER (AGL-2843).
 *
 * The organization-level CRM routes admit a caller who is org-wide and holds
 * `data.manage`, and a lead's conversion and a contact merge ask the same
 * key. It belongs to the granular catalog; the map `resolveOrgPermissions`
 * returns carries the legacy six keys and the keys plugins register, never
 * it. So this spec does not double the runtime resolver the way the route
 * specs do — it runs the REAL one over a data layer that serves member
 * documents and resolves the catalog as the production functions do — and
 * asks the gate about the members a workspace actually has.
 */

const members = new Map<string, Record<string, unknown>>()
const verifyIdToken = jest.fn()

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: {
    app: () => ({
      auth: () => ({ verifyIdToken: (token: string) => verifyIdToken(token) }),
    }),
  },
  getOrgDoc: async (orgId: string) =>
    orgId === 'org-1' ? { $id: 'org-1', plan: 'starter' } : null,
  resolveOrgIdForHost: async () => 'org-1',
  resolveOrgMembership: async (uid: string, orgId?: string | null) => {
    const member = orgId ? members.get(`${orgId}:${uid}`) : undefined
    return member ? { orgId, member: { $id: uid, ...member } } : null
  },
  // The catalog, resolved by the same function the production code delegates
  // to, with no custom role in play.
  resolveMemberOrgPermissions: async (_orgId: string, member: Record<string, unknown> | null) =>
    mockResolveCatalog(member as never, null),
  memberHasOrgPermission: async (
    _orgId: string,
    member: Record<string, unknown> | null,
    permission: string,
  ) => Boolean(member) && (mockResolveCatalog(member as never, null) as Record<string, boolean>)[permission] === true,
}))

import { resolveOrgPermissions as mockResolveCatalog } from '@aglyn/aglyn'
import { authorizeOrgCaller, holdsDataManage } from './org-caller'

const request = () =>
  ({
    method: 'POST',
    query: {},
    body: {},
    headers: { authorization: 'Bearer good' },
    cookies: {},
    socket: {},
  }) as never

const gate = () => authorizeOrgCaller(request(), 'org-1', { needs: 'data.manage', refusal: 'Refused' })

beforeEach(() => {
  members.clear()
  verifyIdToken.mockReset()
  verifyIdToken.mockImplementation(async () => ({ uid: 'caller' }))
})

describe('the organization gate asks the catalog for data.manage (AGL-2843)', () => {
  it('admits an owner who is not staff', async () => {
    members.set('org-1:caller', { role: 'owner', status: 'active' })
    expect(await gate()).toMatchObject({ ok: true, uid: 'caller', orgId: 'org-1', staff: false })
  })

  it('admits an org-wide editor', async () => {
    members.set('org-1:caller', { role: 'editor', allHosts: true })
    expect((await gate()).ok).toBe(true)
  })

  it('refuses an org-wide viewer, whose role does not hold the key', async () => {
    members.set('org-1:caller', { role: 'viewer', allHosts: true })
    expect(await gate()).toEqual({ ok: false, status: 403, error: 'Refused' })
  })

  it('refuses a site collaborator, whose role holds the key but not the organization', async () => {
    members.set('org-1:caller', {
      role: 'editor',
      allHosts: false,
      hostAccess: { 'host-1': 'editor' },
    })
    expect(await gate()).toEqual({ ok: false, status: 403, error: 'Refused' })
  })

  it('refuses a caller not on the roster, and admits staff as every CRM route does', async () => {
    expect((await gate()).ok).toBe(false)
    verifyIdToken.mockImplementation(async () => ({ uid: 'support', staff: true }))
    expect(await gate()).toMatchObject({ ok: true, staff: true })
  })
})

describe('holdsDataManage (AGL-2843)', () => {
  it('answers from the catalog for the member on the roster', async () => {
    members.set('org-1:owner', { role: 'owner' })
    members.set('org-1:viewer', { role: 'viewer', allHosts: true })
    expect(await holdsDataManage('org-1', 'owner')).toBe(true)
    expect(await holdsDataManage('org-1', 'viewer')).toBe(false)
  })

  it('answers false with no organization, and for a stranger', async () => {
    members.set('org-1:owner', { role: 'owner' })
    expect(await holdsDataManage(null, 'owner')).toBe(false)
    expect(await holdsDataManage('org-1', 'nobody')).toBe(false)
  })
})
