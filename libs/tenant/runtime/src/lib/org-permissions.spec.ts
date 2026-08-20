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
 * Site collaborators are org members (AGL-1026).
 *
 * Adding someone to one site writes a real `orgs/{orgId}/members/{uid}` doc —
 * that is what projects into `memberRoles` and lets them into the console —
 * scoped with `allHosts: false` and a `hostAccess` map. Everything here is
 * about the resolver reading that scoping instead of stopping at `role`.
 */

const members = new Map<string, Record<string, unknown>>()
/** `orgs/{orgId}/roles/{roleId}` — custom roles (AGL-243), keyed `org:id`. */
const roles = new Map<string, Record<string, unknown>>()
let hostOrg: string | null = 'org-1'

jest.mock('@aglyn/tenant-data-admin', () => ({
  resolveOrgIdForHost: jest.fn(async () => hostOrg),
  resolveOrgMembership: jest.fn(async (uid: string, orgId?: string | null) => {
    if (!orgId) return null
    const member = members.get(`${orgId}:${uid}`)
    return member ? { orgId, member: { $id: uid, ...member } } : null
  }),
  /**
   * Models the REAL function rather than returning a convenient constant
   * (AGL-2350): it delegates to the same granular resolver the production
   * implementation calls, and looks a custom role up the same way — by the
   * member's `roleId`, resolving a dangling id to `null` so it falls back to
   * the role defaults instead of denying.
   *
   * This double did not exist, and its absence was not inert. The module
   * under test calls it inside a `try`, and the resolver FAILS CLOSED on
   * error by design (AGL-506), so a missing mock did not throw a helpful
   * `is not a function` — it silently turned four org-wide members into
   * denied ones. A closed-world mock that omits a function is the same
   * hazard as one that returns the wrong value.
   */
  resolveMemberOrgPermissions: jest.fn(
    async (orgId: string, member: Record<string, unknown> | null) => {
      const roleId = member?.['roleId'] as string | undefined
      const customRole = roleId ? (roles.get(`${orgId}:${roleId}`) ?? null) : null
      return mockResolveGranular(member as never, customRole as never)
    },
  ),
}))

import { resolveOrgPermissions as mockResolveGranular } from '@aglyn/aglyn'

import { resolveOrgPermissions } from './org-permissions'

beforeEach(() => {
  members.clear()
  roles.clear()
  hostOrg = 'org-1'
})

describe('resolveOrgPermissions — org-wide members', () => {
  it('gives an owner everything', async () => {
    members.set('org-1:owner', { role: 'owner', allHosts: true })
    const resolved = await resolveOrgPermissions('owner', { orgId: 'org-1' })
    expect(resolved.orgWide).toBe(true)
    expect(resolved.isOwner).toBe(true)
    expect(resolved.permissions.manageMembers).toBe(true)
  })

  it('treats an admin as org-wide even without the allHosts flag', async () => {
    members.set('org-1:boss', { role: 'admin' })
    const resolved = await resolveOrgPermissions('boss', { orgId: 'org-1' })
    expect(resolved.orgWide).toBe(true)
    expect(resolved.permissions.editBilling).toBe(true)
  })

  it('treats a membership predating allHosts as org-wide, not locked out', async () => {
    // Neither the flag nor a hostAccess map: the legacy shape. Reading the
    // missing flag as `false` would demote a real member to "scoped with
    // access to nothing" and lock them out of their own workspace.
    members.set('org-1:oldtimer', { role: 'editor' })
    const resolved = await resolveOrgPermissions('oldtimer', {
      hostId: 'host-a',
    })
    expect(resolved.orgWide).toBe(true)
    expect(resolved.permissions.editHosts).toBe(true)
  })

  it('keeps an allHosts editor org-wide', async () => {
    members.set('org-1:ed', { role: 'editor', allHosts: true })
    const resolved = await resolveOrgPermissions('ed', { hostId: 'host-a' })
    expect(resolved.orgWide).toBe(true)
    expect(resolved.permissions.editHosts).toBe(true)
  })
})

describe('resolveOrgPermissions — site collaborators (AGL-1026)', () => {
  it('resolves a scoped member from their HOST role, not their org role', async () => {
    // An org admin may set the org role to editor while scoping access to one
    // site. Reading `role` and stopping there made them an editor of every
    // site in the org.
    members.set('org-1:contractor', {
      role: 'editor',
      allHosts: false,
      hostAccess: { 'host-a': 'editor' },
    })
    const onTheirSite = await resolveOrgPermissions('contractor', {
      hostId: 'host-a',
    })
    expect(onTheirSite.orgWide).toBe(false)
    expect(onTheirSite.hostRole).toBe('editor')
    expect(onTheirSite.permissions.editHosts).toBe(true)
    // ...and never manage the org itself.
    expect(onTheirSite.permissions.manageMembers).toBe(false)
    expect(onTheirSite.permissions.editBilling).toBe(false)
    expect(onTheirSite.isOwner).toBe(false)
  })

  it('denies a scoped member on a site they were not given', async () => {
    members.set('org-1:contractor', {
      role: 'editor',
      allHosts: false,
      hostAccess: { 'host-a': 'editor' },
    })
    const elsewhere = await resolveOrgPermissions('contractor', {
      hostId: 'host-b',
    })
    expect(elsewhere.hostRole).toBeNull()
    expect(elsewhere.permissions.editHosts).toBe(false)
    expect(elsewhere.permissions.installPlugins).toBe(false)
  })

  it('gives a scoped member the floor when no host is in context', async () => {
    // Nothing to scope to means the caller is asking an org-wide question,
    // and a site collaborator has no standing to answer it.
    members.set('org-1:contractor', {
      role: 'editor',
      allHosts: false,
      hostAccess: { 'host-a': 'admin' },
    })
    const resolved = await resolveOrgPermissions('contractor', {
      orgId: 'org-1',
    })
    expect(resolved.orgWide).toBe(false)
    expect(resolved.permissions.editHosts).toBe(false)
    expect(resolved.permissions.manageMembers).toBe(false)
  })

  it('lets a site admin manage their own site without managing the org', async () => {
    members.set('org-1:sitelead', {
      role: 'viewer',
      allHosts: false,
      hostAccess: { 'host-a': 'admin' },
    })
    const resolved = await resolveOrgPermissions('sitelead', {
      hostId: 'host-a',
    })
    expect(resolved.hostRole).toBe('admin')
    expect(resolved.permissions.editHosts).toBe(true)
    expect(resolved.permissions.installPlugins).toBe(true)
    // `isOwner` drives account-level control and stays false: admin of one
    // site is not admin of the workspace.
    expect(resolved.isOwner).toBe(false)
    expect(resolved.permissions.editBilling).toBe(false)
  })
})

describe('resolveOrgPermissions — non-members and failures', () => {
  it('denies a signed-in user who is not on the roster', async () => {
    const resolved = await resolveOrgPermissions('stranger', { orgId: 'org-1' })
    expect(resolved.role).toBeNull()
    expect(resolved.orgWide).toBe(false)
    expect(resolved.permissions.editHosts).toBe(false)
  })

  it('still treats a fresh account with no org as its future owner', async () => {
    hostOrg = null
    const resolved = await resolveOrgPermissions('newcomer')
    expect(resolved.orgId).toBeNull()
    expect(resolved.isOwner).toBe(true)
    expect(resolved.orgWide).toBe(true)
    expect(resolved.permissions.manageMembers).toBe(true)
  })
})

/**
 * The custom role and the per-member override reach the flag map the
 * marketplace gates read (AGL-2350).
 *
 * This resolver used to build `permissions` from the built-in role tier
 * alone, so both refinements were dropped server-side while the console
 * applied them — the console showed a button that 403'd, and hid one whose
 * POST still succeeded.
 */
describe('resolveOrgPermissions — custom roles and overrides', () => {
  it('honours an override that REVOKES a permission the role grants', async () => {
    members.set('org-1:ed', {
      role: 'editor',
      allHosts: true,
      permissions: { 'plugins.install': false },
    })
    const resolved = await resolveOrgPermissions('ed', { orgId: 'org-1' })
    expect(resolved.orgWide).toBe(true)
    expect(resolved.permissions.installPlugins).toBe(false)
  })

  it('the same editor WITHOUT the override still has it', async () => {
    // The premise, so the test above cannot pass because editors simply lack
    // the permission.
    members.set('org-1:ed', { role: 'editor', allHosts: true })
    const resolved = await resolveOrgPermissions('ed', { orgId: 'org-1' })
    expect(resolved.permissions.installPlugins).toBe(true)
  })

  it('honours a custom role that GRANTS what the base role lacks', async () => {
    roles.set('org-1:publisher', {
      name: 'Publisher',
      permissions: { 'marketplace.publish': true },
    })
    members.set('org-1:view', {
      role: 'viewer',
      allHosts: true,
      roleId: 'publisher',
    })
    const resolved = await resolveOrgPermissions('view', { orgId: 'org-1' })
    expect(resolved.permissions.publishToMarketplace).toBe(true)
  })

  it('a dangling roleId falls back to the role defaults, it does not deny', async () => {
    members.set('org-1:view', {
      role: 'admin',
      allHosts: true,
      roleId: 'deleted-role',
    })
    const resolved = await resolveOrgPermissions('view', { orgId: 'org-1' })
    expect(resolved.orgWide).toBe(true)
    expect(resolved.permissions.manageMembers).toBe(true)
  })
})
