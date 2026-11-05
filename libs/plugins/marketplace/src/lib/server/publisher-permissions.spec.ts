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
 * @jest-environment node
 */

/**
 * The publisher doors' gate (AGL-4047): the member of the publishing
 * workspace, asked the key through the same resolver every workspace door
 * uses. The workspace's members are faked at the module edge, and the
 * verdict is the real catalog's, so a default that drifted from "owner or
 * admin" fails here.
 */

const mockMembers: Record<string, Record<string, unknown>> = {}

jest.mock('@aglyn/tenant-data-admin', () => {
  const { resolveOrgPermissions } = jest.requireActual('@aglyn/aglyn/app-utils/org-permissions')
  return {
    resolveOrgMembership: jest.fn(async (uid: string, orgId: string) => {
      const member = mockMembers[`${orgId}/${uid}`]
      return member ? { orgId, member: { $id: uid, ...member } } : null
    }),
    memberHasOrgPermission: jest.fn(
      async (_orgId: string, member: Record<string, unknown>, permission: string) =>
        resolveOrgPermissions(member, null)[permission] === true,
    ),
  }
})

import { registerMarketplaceDeclarations } from '../declarations'
import { manageListingsRefusal, publisherPermissionVerdict } from './publisher-permissions'

beforeAll(() => registerMarketplaceDeclarations())

beforeEach(() => {
  for (const key of Object.keys(mockMembers)) delete mockMembers[key]
  Object.assign(mockMembers, {
    'acme/owner': { role: 'owner', allHosts: true },
    'acme/admin': { role: 'admin' },
    'acme/editor': { role: 'editor', allHosts: true },
    'acme/viewer': { role: 'viewer', allHosts: true },
    'acme/granted-editor': { role: 'editor', allHosts: true, permissions: { 'marketplace.manageListings': true } },
    'acme/revoked-admin': { role: 'admin', permissions: { 'marketplace.publisherProfile': false } },
  })
})

describe('publisherPermissionVerdict (AGL-4047)', () => {
  it.each([
    ['owner', 'granted'],
    ['admin', 'granted'],
    ['editor', 'refused'],
    ['viewer', 'refused'],
  ])('a workspace %s is %s by default, as the owner-or-admin gate answered', async (uid, verdict) => {
    expect(await publisherPermissionVerdict(uid, 'acme', 'marketplace.publisherProfile')).toBe(verdict)
    expect(await publisherPermissionVerdict(uid, 'acme', 'marketplace.manageListings')).toBe(verdict)
  })

  it('follows a grant to an editor and a refusal of an admin', async () => {
    expect(await publisherPermissionVerdict('granted-editor', 'acme', 'marketplace.manageListings')).toBe('granted')
    expect(await publisherPermissionVerdict('granted-editor', 'acme', 'marketplace.publisherProfile')).toBe('refused')
    expect(await publisherPermissionVerdict('revoked-admin', 'acme', 'marketplace.publisherProfile')).toBe('refused')
    expect(await publisherPermissionVerdict('revoked-admin', 'acme', 'marketplace.manageListings')).toBe('granted')
  })

  it('answers not-a-member for a stranger, a missing org and a missing uid', async () => {
    expect(await publisherPermissionVerdict('owner', 'other-org', 'marketplace.publisherProfile')).toBe('not-a-member')
    expect(await publisherPermissionVerdict('owner', '', 'marketplace.publisherProfile')).toBe('not-a-member')
    expect(await publisherPermissionVerdict(undefined, 'acme', 'marketplace.publisherProfile')).toBe('not-a-member')
  })
})

describe('manageListingsRefusal (AGL-4047)', () => {
  it('lets a holder through and, where the door moderates, staff', async () => {
    expect(await manageListingsRefusal({ uid: 'admin' }, 'acme', { staffMayModerate: true })).toBeNull()
    expect(await manageListingsRefusal({ uid: 'granted-editor' }, 'acme', { staffMayModerate: false })).toBeNull()
    expect(await manageListingsRefusal({ uid: 'stranger', staff: true }, 'acme', { staffMayModerate: true })).toBeNull()
  })

  it('tells a member without the key which permission, and a stranger the listing is not theirs', async () => {
    expect(await manageListingsRefusal({ uid: 'editor' }, 'acme', { staffMayModerate: true })).toEqual({
      status: 403,
      body: {
        error: 'Your role does not include "Manage published listings" — ask an organization admin',
        reason: 'permission',
        permission: 'marketplace.manageListings',
      },
    })
    expect(await manageListingsRefusal({ uid: 'stranger' }, 'acme', { staffMayModerate: true })).toEqual({
      status: 403,
      body: { error: 'Not your listing' },
    })
    // A door that never let staff in still does not.
    expect(await manageListingsRefusal({ uid: 'stranger', staff: true }, 'acme', { staffMayModerate: false })).toEqual({
      status: 403,
      body: { error: 'Not your listing' },
    })
    // A listing with no publishing org is nobody's.
    expect(await manageListingsRefusal({ uid: 'admin' }, undefined, { staffMayModerate: true })).toEqual({
      status: 403,
      body: { error: 'Not your listing' },
    })
  })
})
