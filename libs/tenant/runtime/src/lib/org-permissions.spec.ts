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
let hostOrg: string | null = 'org-1'

jest.mock('@aglyn/tenant-data-admin', () => ({
  resolveOrgIdForHost: jest.fn(async () => hostOrg),
  resolveOrgMembership: jest.fn(async (uid: string, orgId?: string | null) => {
    if (!orgId) return null
    const member = members.get(`${orgId}:${uid}`)
    return member ? { orgId, member: { $id: uid, ...member } } : null
  }),
}))

import { resolveOrgPermissions } from './org-permissions'

beforeEach(() => {
  members.clear()
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
