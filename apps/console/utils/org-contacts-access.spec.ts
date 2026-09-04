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
 * WHAT THE GATE ACTUALLY ADMITS.
 *
 * ⛔ Nothing here stubs the permission module. Every `can` below is the REAL
 * `resolveOrgPermissions` over a REAL member document, because a stubbed
 * resolver answering "no" to everything makes a deny-test pass while proving
 * nothing at all — the collaborator case would go green against a gate that
 * refuses literally everybody, including the owner it is supposed to admit.
 * So the collaborator's map is resolved from the same function, from a
 * membership shaped the way `grantHostAccess` actually writes one, and the
 * owner cases run through the identical harness.
 */

import {
  isOrgWideMembership,
  resolveOrgPermissions,
  type OrgPermission,
} from '@aglyn/aglyn'
import {
  ORG_CONTACTS_PERMISSION,
  orgContactsRefusalNotice,
  resolveOrgContactsAccess,
} from './org-contacts-access'

/** A real permission answer for a real membership. No test double. */
const canFor = (member: Record<string, unknown>) => {
  const granted = resolveOrgPermissions(member as never)
  return (permission: OrgPermission) => granted[permission] === true
}

/**
 * A SITE COLLABORATOR, as `grantHostAccess` writes one: a genuine org member
 * document with an editor role, scoped to named sites.
 */
const COLLABORATOR = {
  role: 'editor',
  allHosts: false,
  orgWide: false,
  hostAccess: { 'host-a': 'admin' },
}
const OWNER = { role: 'owner' }
const EDITOR = { role: 'editor' }
const VIEWER = { role: 'viewer' }

const settled = (member: Record<string, unknown>, orgWide: boolean) => ({
  orgWide,
  reachReady: true,
  can: canFor(member),
  permissionsLoaded: true,
  permissionsErrored: false,
})

describe('the defect this gate exists to avoid is real', () => {
  it('a site collaborator DOES hold data.manage — the role check alone admits them', () => {
    // If this ever stops being true the gate below still holds, but the
    // reason for its shape is gone and the comment should change with it.
    expect(canFor(COLLABORATOR)(ORG_CONTACTS_PERMISSION)).toBe(true)
    expect(isOrgWideMembership(COLLABORATOR as never)).toBe(false)
  })
})

describe('resolveOrgContactsAccess — reach', () => {
  it('REFUSES a site collaborator who holds the permission', () => {
    expect(resolveOrgContactsAccess(settled(COLLABORATOR, false))).toBe(
      'refused',
    )
  })

  it('refuses them without consulting the permission at all', () => {
    const can = jest.fn(() => true)
    expect(
      resolveOrgContactsAccess({
        orgWide: false,
        reachReady: true,
        can,
        permissionsLoaded: true,
        permissionsErrored: false,
      }),
    ).toBe('refused')
    // No permission grant may buy reach, so none is even asked for.
    expect(can).not.toHaveBeenCalled()
  })

  it('refuses a collaborator even with every permission granted', () => {
    expect(
      resolveOrgContactsAccess({
        orgWide: false,
        reachReady: true,
        can: () => true,
        permissionsLoaded: true,
        permissionsErrored: false,
      }),
    ).toBe('refused')
  })

  it('HOLDS while reach is unresolved, because orgWide fails open', () => {
    expect(
      resolveOrgContactsAccess({
        // The value a collaborator carries before their membership lands.
        orgWide: true,
        reachReady: false,
        can: () => true,
        permissionsLoaded: true,
        permissionsErrored: false,
      }),
    ).toBe('pending')
  })
})

describe('resolveOrgContactsAccess — permission', () => {
  /*
   * BREAKING THE GUARD THE OTHER WAY. These are the cases that fail if the
   * gate refuses everybody, which is what makes the refusals above evidence
   * rather than a tautology.
   */
  it('ADMITS an org owner', () => {
    expect(resolveOrgContactsAccess(settled(OWNER, true))).toBe('granted')
  })

  it('ADMITS an org-wide editor — data.manage is an editor default', () => {
    expect(resolveOrgContactsAccess(settled(EDITOR, true))).toBe('granted')
  })

  it('refuses an org-wide VIEWER, who holds no data permission', () => {
    expect(resolveOrgContactsAccess(settled(VIEWER, true))).toBe('refused')
  })

  it('honors a per-member override that revokes the permission', () => {
    const stripped = { role: 'admin', permissions: { 'data.manage': false } }
    expect(canFor(stripped)(ORG_CONTACTS_PERMISSION)).toBe(false)
    expect(resolveOrgContactsAccess(settled(stripped, true))).toBe('refused')
  })

  it('honors a per-member override that grants it to a viewer', () => {
    const promoted = { role: 'viewer', permissions: { 'data.manage': true } }
    expect(resolveOrgContactsAccess(settled(promoted, true))).toBe('granted')
  })

  it('refuses an answer that is not literally `true`', () => {
    /*
     * `strictNullChecks` is off repo-wide, and the real `can` is
     * `(permission) => state.granted[permission]` — a lookup, which answers
     * `undefined` for a key the resolved map does not carry. A gate written
     * `!== false` therefore GRANTS on a missing key, which is the same
     * absent-reads-as-permitted defect `deniedOnReadFailure` exists to close.
     * The comparison has to be positive.
     */
    const absent = {
      ...settled(OWNER, true),
      can: (() => undefined) as unknown as (p: OrgPermission) => boolean,
    }
    expect(resolveOrgContactsAccess(absent)).toBe('refused')
    // CONTROL: the same harness admits a real `true`, so this is about the
    // non-boolean and not about the gate refusing everybody.
    expect(
      resolveOrgContactsAccess({ ...absent, can: () => true }),
    ).toBe('granted')
  })

  it('holds while the member read is still in flight', () => {
    expect(
      resolveOrgContactsAccess({
        ...settled(OWNER, true),
        permissionsLoaded: false,
      }),
    ).toBe('pending')
  })

  it('reports a FAILED member read as unavailable, not as refused or pending', () => {
    const verdict = resolveOrgContactsAccess({
      ...settled(OWNER, true),
      permissionsLoaded: false,
      permissionsErrored: true,
    })
    expect(verdict).toBe('unavailable')
    expect(verdict).not.toBe('pending')
    expect(verdict).not.toBe('refused')
  })

  it('a failed read still cannot rescue a collaborator', () => {
    expect(
      resolveOrgContactsAccess({
        orgWide: false,
        reachReady: true,
        can: () => true,
        permissionsLoaded: false,
        permissionsErrored: true,
      }),
    ).toBe('refused')
  })
})

describe('the refusal copy', () => {
  it('tells a collaborator where their own people are, not to ask for a role', () => {
    const notice = orgContactsRefusalNotice('scoped')
    expect(notice).toContain('sites you')
    expect(notice).not.toContain('permission')
  })

  it('tells a member without the permission who can grant it', () => {
    expect(orgContactsRefusalNotice('permission')).toContain('Team')
  })

  it('gives the two audiences different sentences', () => {
    expect(orgContactsRefusalNotice('scoped')).not.toBe(
      orgContactsRefusalNotice('permission'),
    )
  })
})
