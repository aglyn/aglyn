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

import {
  canManageOrg,
  canWriteHost,
  generateOrgSlug,
  hostRoleFor,
  isOrgWideMember,
  isValidOrgSlug,
  orgRoleAtLeast,
  projectHostMemberRoles,
  projectMemberScopeTokens,
} from './organizations'

describe('organizations (AGL-233)', () => {
  it('validates slugs with the shared policy plus org-only reservations', () => {
    expect(isValidOrgSlug('business-1')).toBe(true)
    expect(isValidOrgSlug('ab')).toBe(false)
    expect(isValidOrgSlug('-lead')).toBe(false)
    expect(isValidOrgSlug('www')).toBe(false) // host blocklist
    expect(isValidOrgSlug('staff')).toBe(false) // org-only reservation
    expect(isValidOrgSlug('workspace')).toBe(false)
  })

  it('generates slugs from org names', () => {
    expect(generateOrgSlug('Business 1, Inc.')).toBe('business-1-inc')
    expect(generateOrgSlug('Staff')).toBe('')
    expect(generateOrgSlug('!!!')).toBe('')
  })

  it('orders roles and gates management', () => {
    expect(orgRoleAtLeast('owner', 'admin')).toBe(true)
    expect(orgRoleAtLeast('editor', 'admin')).toBe(false)
    expect(orgRoleAtLeast(undefined, 'viewer')).toBe(false)
    expect(canManageOrg('admin')).toBe(true)
    expect(canManageOrg('editor')).toBe(false)
  })

  it('resolves per-host roles for the 3-of-15-sites case', () => {
    const editor = {
      $id: 'u1',
      role: 'editor' as const,
      hostAccess: { 'host-a': 'editor' as const, 'host-b': 'viewer' as const },
    }
    expect(hostRoleFor(editor, 'host-a')).toBe('editor')
    expect(hostRoleFor(editor, 'host-b')).toBe('viewer')
    expect(hostRoleFor(editor, 'host-c')).toBeNull()
    expect(canWriteHost(editor, 'host-a')).toBe(true)
    expect(canWriteHost(editor, 'host-b')).toBe(false)

    const orgWideEditor = { $id: 'u2', role: 'editor' as const, allHosts: true }
    expect(hostRoleFor(orgWideEditor, 'anything')).toBe('editor')

    const admin = { $id: 'u3', role: 'admin' as const }
    expect(hostRoleFor(admin, 'anything')).toBe('admin')
    expect(hostRoleFor({ $id: 'u4' }, 'host-a')).toBeNull()
  })

  it('projects memberRoles maps for host docs', () => {
    const members = [
      { $id: 'owner', role: 'owner' as const },
      { $id: 'writer', role: 'editor' as const, hostAccess: { h1: 'editor' as const } },
      { $id: 'watcher', role: 'viewer' as const, allHosts: true },
      { $id: 'outsider', role: 'editor' as const },
    ]
    expect(projectHostMemberRoles(members, 'h1')).toEqual({
      owner: 'admin',
      writer: 'editor',
      watcher: 'viewer',
    })
    expect(projectHostMemberRoles(members, 'h2')).toEqual({
      owner: 'admin',
      watcher: 'viewer',
    })
  })
})

describe('isOrgWideMember (AGL-1038)', () => {
  it('counts owner and admin regardless of scoping fields', () => {
    expect(isOrgWideMember({ role: 'owner' })).toBe(true)
    expect(
      isOrgWideMember({
        role: 'admin',
        allHosts: false,
        hostAccess: { h1: 'editor' },
      }),
    ).toBe(true)
  })

  it('counts an explicit allHosts editor', () => {
    expect(isOrgWideMember({ role: 'editor', allHosts: true })).toBe(true)
  })

  it('does not count a site collaborator', () => {
    expect(
      isOrgWideMember({
        role: 'viewer',
        allHosts: false,
        hostAccess: { h1: 'editor' },
      }),
    ).toBe(false)
  })

  it('keeps a legacy pre-allHosts membership org-wide', () => {
    // Neither flag nor map: predates the field. Reading this as "scoped
    // with access to nothing" would lock real members out of their own
    // workspace.
    expect(isOrgWideMember({ role: 'editor' })).toBe(true)
    expect(isOrgWideMember({ role: 'viewer', hostAccess: {} })).toBe(true)
  })

  it('treats an explicit allHosts:false with no grants as scoped', () => {
    // The flag is present, so this is not the legacy shape — it is a
    // collaborator whose last host was revoked.
    expect(isOrgWideMember({ role: 'viewer', allHosts: false })).toBe(false)
  })

  it('denies a missing member', () => {
    expect(isOrgWideMember(null)).toBe(false)
    expect(isOrgWideMember(undefined)).toBe(false)
  })
})

describe('projectMemberScopeTokens (AGL-1038)', () => {
  it('gives org-wide members the org token alone', () => {
    expect(projectMemberScopeTokens({ role: 'owner' })).toEqual(['org'])
    expect(
      projectMemberScopeTokens({ role: 'editor', allHosts: true }),
    ).toEqual(['org'])
  })

  it('gives a collaborator org plus one token per granted host', () => {
    expect(
      projectMemberScopeTokens({
        role: 'viewer',
        allHosts: false,
        hostAccess: { h1: 'editor', h2: 'viewer' },
      }),
    ).toEqual(['org', 'host:h1', 'host:h2'])
  })

  it('still carries org for a collaborator with no grants left', () => {
    // Org-WIDE resources stay readable by any member; this project does
    // not narrow that, it only adds host-scoped ones.
    expect(
      projectMemberScopeTokens({ role: 'viewer', allHosts: false }),
    ).toEqual(['org'])
  })

  it('does not cap at MAX_SCOPE_HOSTS', () => {
    // The rules' hasAny has no 30-value limit — only the client
    // array-contains-any query does, which is AGL-1044's problem to chunk.
    const hostAccess = Object.fromEntries(
      Array.from({ length: 40 }, (_, i) => [`h${i}`, 'viewer' as const]),
    )
    expect(
      projectMemberScopeTokens({ role: 'viewer', allHosts: false, hostAccess }),
    ).toHaveLength(41)
  })
})
