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
  memberCanSee,
  memberScopeTokens,
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

describe('memberScopeTokens (AGL-1045 review: one copy of the fallback)', () => {
  it('prefers the stored projection', () => {
    expect(
      memberScopeTokens({
        role: 'viewer',
        allHosts: false,
        hostAccess: { h1: 'editor' },
        scopeTokens: ['org', 'host:h9'],
      } as never),
    ).toEqual(['org', 'host:h9'])
  })

  it('recomputes when the backfill has not stamped the doc', () => {
    // The case the hand-written copies existed for. Falling through to
    // "no tokens" would lock a real collaborator out of their own site.
    expect(
      memberScopeTokens({
        role: 'viewer',
        allHosts: false,
        hostAccess: { h1: 'editor' },
      }),
    ).toEqual(['org', 'host:h1'])
  })

  it('treats an EMPTY stored array as unstamped, not as "sees nothing"', () => {
    // The `.length` guard is the whole subtlety: `[]` is what a partially
    // written member doc looks like, and reading it literally would deny a
    // member every resource in the org.
    expect(
      memberScopeTokens({
        role: 'viewer',
        allHosts: false,
        hostAccess: { h1: 'editor' },
        scopeTokens: [],
      } as never),
    ).toEqual(['org', 'host:h1'])
  })
})

describe('memberCanSee (AGL-1037/1038)', () => {
  const collaborator = {
    role: 'editor' as const,
    allHosts: false,
    hostAccess: { h1: 'editor' as const },
  }

  it('lets an org-wide member see a resource scoped away from them', () => {
    expect(memberCanSee({ role: 'owner' }, ['host:h9'])).toBe(true)
  })

  it('lets a collaborator see a resource shared with their site', () => {
    expect(memberCanSee(collaborator, ['host:h1'])).toBe(true)
  })

  it('hides another site’s resource from a collaborator', () => {
    expect(memberCanSee(collaborator, ['host:h9'])).toBe(false)
  })

  it('treats an absent or empty scope as org-wide', () => {
    // An unbackfilled resource must not vanish (AGL-1040 ordering hazard).
    expect(memberCanSee(collaborator, undefined)).toBe(true)
    expect(memberCanSee(collaborator, null)).toBe(true)
    expect(memberCanSee(collaborator, ['org'])).toBe(true)
  })

  it('is a SCOPE test, not a membership test', () => {
    // A caller with no membership "can see" an org-wide resource here, and
    // that is deliberate: this answers "is the resource in that reach", not
    // "is this person in the org". Every caller resolves membership first —
    // conflating the two is how AGL-1026 exposed a whole org.
    expect(memberCanSee(null, ['host:h1'])).toBe(false)
    expect(memberCanSee(undefined, ['org'])).toBe(true)
  })
})
