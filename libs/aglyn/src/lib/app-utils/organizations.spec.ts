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
  canLinkSocialProvider,
  CONSOLE_USER_TYPE_LABELS,
  consoleUserType,
  countManagerSeats,
  isSsoGovernedAccount,
  isOrgWideMember,
  isOrgWideMembership,
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

describe('countManagerSeats (AGL-1113)', () => {
  // The roster that caused the bug: three managers and four site-scoped
  // collaborators in one `orgs/{id}/members` collection. A raw count billed
  // seven manager seats and tripped the gate on plans allowing five.
  const roster = [
    { role: 'owner' as const, allHosts: true, hostAccess: {} },
    { role: 'admin' as const, allHosts: true, hostAccess: {} },
    { role: 'editor' as const, allHosts: true, hostAccess: {} },
    { role: 'editor' as const, allHosts: false, hostAccess: { h1: 'editor' as const } },
    { role: 'editor' as const, allHosts: false, hostAccess: { h2: 'editor' as const } },
    { role: 'viewer' as const, allHosts: false, hostAccess: { h1: 'viewer' as const } },
    { role: 'viewer' as const, allHosts: false, hostAccess: {} },
  ]

  it('counts managers and never site collaborators', () => {
    expect(roster).toHaveLength(7)
    expect(countManagerSeats(roster)).toBe(3)
  })

  it('counts an admin as a manager even when scoped to one site', () => {
    // Matches isOrgWideMember: role wins over the flag, which is exactly why
    // a Firestore `where('allHosts','==',true)` count cannot replace this.
    expect(
      countManagerSeats([
        { role: 'admin', allHosts: false, hostAccess: { h1: 'editor' } },
      ]),
    ).toBe(1)
  })

  it('counts a legacy pre-allHosts membership as a manager', () => {
    expect(countManagerSeats([{ role: 'editor' }])).toBe(1)
  })

  it('classifies each entry the same way it counts it (AGL-1114)', () => {
    // The Type column and the seat count must never disagree — they are the
    // same question asked twice, so they share the predicate.
    const managers = roster.filter((m) => consoleUserType(m) === 'manager')
    expect(managers).toHaveLength(countManagerSeats(roster))
    // Role alone is NOT the answer: the same `editor` role appears on both
    // sides of the split, which is the whole reason this column exists.
    expect(
      consoleUserType({ role: 'editor', allHosts: true, hostAccess: {} }),
    ).toBe('manager')
    expect(
      consoleUserType({
        role: 'editor',
        allHosts: false,
        hostAccess: { h1: 'editor' },
      }),
    ).toBe('collaborator')
    // Labels exist for every kind, including the published-site population
    // that never appears in this collection.
    expect(CONSOLE_USER_TYPE_LABELS.manager).toBe('Team manager')
    expect(CONSOLE_USER_TYPE_LABELS.collaborator).toBe('Site collaborator')
    expect(CONSOLE_USER_TYPE_LABELS.siteMember).toBeTruthy()
  })

  it('is zero for an all-collaborator roster and tolerates gaps', () => {
    expect(
      countManagerSeats([
        { role: 'viewer', allHosts: false, hostAccess: { h1: 'viewer' } },
        null,
        undefined,
      ]),
    ).toBe(0)
    expect(countManagerSeats([])).toBe(0)
  })
})

describe('SSO account governance (AGL-1128)', () => {
  it('treats any account with a tenantId as SSO-governed', () => {
    expect(isSsoGovernedAccount({ tenantId: 'aglyn-org-y5v14' })).toBe(true)
    expect(isSsoGovernedAccount({ tenantId: null })).toBe(false)
    expect(isSsoGovernedAccount({})).toBe(false)
    expect(isSsoGovernedAccount(null)).toBe(false)
  })

  it('refuses social linking for an SSO account and allows it otherwise', () => {
    // The security call: a linked consumer provider is a way in the
    // customer's IdP cannot see or revoke. Not conditional on `enforced` —
    // that flag exists to avoid LOCKING OUT an existing method, not to
    // permit handing out new bypasses in the meantime.
    expect(canLinkSocialProvider({ tenantId: 'aglyn-org-y5v14' })).toBe(false)
    expect(canLinkSocialProvider({ tenantId: null })).toBe(true)
    expect(canLinkSocialProvider(undefined)).toBe(true)
  })
})

describe('isOrgWideMembership (AGL-1032)', () => {
  it('scopes only on an explicit false', () => {
    expect(isOrgWideMembership({ role: 'viewer', orgWide: false })).toBe(false)
    expect(isOrgWideMembership({ role: 'viewer', orgWide: true })).toBe(true)
  })

  it('reads an unmirrored row as org-wide', () => {
    // Rows predating the mirror carry no flag. Hiding the workspace from a
    // real member is worse than showing org chrome to a collaborator whose
    // reads the rules refuse anyway — the boundary is elsewhere.
    expect(isOrgWideMembership({ role: 'editor' })).toBe(true)
    expect(isOrgWideMembership(null)).toBe(true)
    expect(isOrgWideMembership(undefined)).toBe(true)
  })

  it('keeps owner and admin org-wide even against a stale mirror', () => {
    expect(isOrgWideMembership({ role: 'owner', orgWide: false })).toBe(true)
    expect(isOrgWideMembership({ role: 'admin', orgWide: false })).toBe(true)
  })

  it('disagrees with isOrgWideMember by design on a null argument', () => {
    // Different questions: `isOrgWideMember(null)` is "no membership, so no
    // reach" (an access answer); this one is "nothing says to narrow the
    // console" (a navigation answer). OrgGuard resolves membership first.
    expect(isOrgWideMember(null)).toBe(false)
    expect(isOrgWideMembership(null)).toBe(true)
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
