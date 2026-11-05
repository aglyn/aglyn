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
import { registerPluginPermissions } from '@aglyn/aglyn/plugin-manager/plugin-permissions'
import { registerPluginEntitlements } from '@aglyn/aglyn/plugin-manager/plugin-entitlements'
import { CRM_MOVE_STAGES_REFUSAL, CRM_PERMISSIONS, CRM_SITE_PERMISSIONS } from '../model/crm-permissions'
import { authorizeOrgCaller, authorizeOrgStageMover, holdsDataManage } from './org-caller'

// The CRM's keys, as the declarations register them in every process.
registerPluginPermissions(CRM_PERMISSIONS)
registerPluginEntitlements({ pluginId: 'crm', orgPermissions: CRM_SITE_PERMISSIONS })

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

/**
 * "CHANGE CRM SETTINGS" (`crm.settings`, AGL-4047): record sharing, the
 * sharing rules and the capture address's rotation asked for an owner or
 * admin of the whole workspace. They ask the key, whose default is exactly
 * those roles, so a custom role or an override decides it for anyone org-wide,
 * and staff acting alone still do not pass.
 */
describe('a stage move at the organization level (AGL-4047)', () => {
  const mover = () => authorizeOrgStageMover(request(), 'org-1', 'Refused')

  it.each([
    ['an owner', { role: 'owner' }, true],
    ['an org-wide editor', { role: 'editor', allHosts: true }, true],
    ['an org-wide viewer', { role: 'viewer', allHosts: true }, false],
    ['a viewer granted "Manage data", which the key follows', { role: 'viewer', allHosts: true, permissions: { 'data.manage': true } }, true],
    ['an editor refused "Manage data"', { role: 'editor', allHosts: true, permissions: { 'data.manage': false } }, false],
    [
      'a site collaborator granted both: the reach refuses',
      { role: 'editor', allHosts: false, hostAccess: { 'host-1': 'admin' }, permissions: { 'data.manage': true, 'crm.moveStages': true } },
      false,
    ],
  ])('%s: %s', async (_name, member, admitted) => {
    members.set('org-1:caller', member)
    expect((await mover()).ok).toBe(admitted)
  })

  it('a refusal of the key itself stops an admin who holds "Manage data", in its own words', async () => {
    members.set('org-1:caller', { role: 'admin', allHosts: true, permissions: { 'crm.moveStages': false } })
    expect(await mover()).toEqual({ ok: false, status: 403, error: CRM_MOVE_STAGES_REFUSAL })
  })

  it('a grant of the key does not stand in for "Manage data"', async () => {
    members.set('org-1:caller', { role: 'viewer', allHosts: true, permissions: { 'crm.moveStages': true } })
    expect(await mover()).toEqual({ ok: false, status: 403, error: 'Refused' })
  })

  it('admits staff, as the "Manage data" door always has', async () => {
    verifyIdToken.mockImplementation(async () => ({ uid: 'support', staff: true }))
    expect((await mover()).ok).toBe(true)
  })
})

describe('the organization gate asks "Change CRM settings" (AGL-4047)', () => {
  const settings = () =>
    authorizeOrgCaller(request(), 'org-1', { needs: 'crm.settings', refusal: 'Refused' })

  it.each([
    ['an owner', { role: 'owner' }, true],
    ['an admin', { role: 'admin', allHosts: true }, true],
    ['an editor', { role: 'editor', allHosts: true }, false],
    ['a viewer', { role: 'viewer', allHosts: true }, false],
    ['an editor whose own override grants it', { role: 'editor', allHosts: true, permissions: { 'crm.settings': true } }, true],
    ['an admin whose own override refuses it', { role: 'admin', allHosts: true, permissions: { 'crm.settings': false } }, false],
    [
      'a site collaborator granted it: the reach refuses',
      { role: 'editor', allHosts: false, hostAccess: { 'host-1': 'admin' }, permissions: { 'crm.settings': true } },
      false,
    ],
  ])('%s: %s', async (_name, member, admitted) => {
    members.set('org-1:caller', member)
    expect((await settings()).ok).toBe(admitted)
  })

  it('refuses staff acting alone, as it always has', async () => {
    verifyIdToken.mockImplementation(async () => ({ uid: 'support', staff: true }))
    expect(await settings()).toEqual({ ok: false, status: 403, error: 'Refused' })
  })
})

/**
 * A VERIFICATION THAT THROWS (AGL-2852). A refused credential is the
 * caller's 401. A failure to check one is ours and keeps a 5xx — including a
 * Google certificate outage, which firebase-admin reports with the code of a
 * forged token — so an outage pages rather than telling every caller their
 * sign-in is bad.
 */
describe('a verification that throws (AGL-2852)', () => {
  const authError = (code: string, message = 'x') => Object.assign(new Error(message), { code })

  it('answers 401 for a refused credential', async () => {
    verifyIdToken.mockRejectedValue(authError('auth/id-token-expired'))
    expect(await gate()).toEqual({ ok: false, status: 401, error: 'Unauthenticated' })
    verifyIdToken.mockRejectedValue(
      authError('auth/argument-error', 'Firebase ID token has invalid signature.'),
    )
    expect(await gate()).toMatchObject({ ok: false, status: 401 })
  })

  it('answers 500 for a certificate outage and for a throw with no auth code', async () => {
    const logged = jest.spyOn(console, 'error').mockImplementation(() => undefined)
    verifyIdToken.mockRejectedValue(
      authError('auth/argument-error', 'Error fetching public keys for Google certs: ETIMEDOUT'),
    )
    expect(await gate()).toMatchObject({ ok: false, status: 500 })
    verifyIdToken.mockRejectedValue(new Error('ECONNRESET'))
    expect(await gate()).toMatchObject({ ok: false, status: 500 })
    expect(logged).toHaveBeenCalled()
    logged.mockRestore()
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
