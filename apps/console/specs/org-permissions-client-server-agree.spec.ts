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
 * The console and the server resolve the same permissions (AGL-2350).
 *
 * `custom-roles.md` states it plainly: *"Permissions are enforced everywhere
 * — across the console's APIs and every surface — so a role reliably limits
 * what a member can see and do."* That was true for billing and member
 * management, which go through `memberHasOrgPermission`, and false for
 * plugin installs and marketplace publishing, which read the legacy flag map
 * off `resolveOrgPermissions` in `libs/tenant/runtime`.
 *
 * That resolver built the map from `resolveRolePermissions(tier)` — the
 * BUILT-IN role's defaults — and never looked at the member's custom role or
 * their per-member overrides, even though both were on the doc it had just
 * read. So the two halves disagreed in **both** directions, and neither
 * direction is benign:
 *
 *  - a permission GRANTED by a custom role rendered its button in the console
 *    and returned 403 on POST;
 *  - a permission REVOKED by an override was hidden in the console and the
 *    POST still SUCCEEDED. A revoked permission that still works is the one
 *    worth having a test for.
 *
 * ## The trap this pins, which is why the obvious fix is not the fix
 *
 * There are two permission vocabularies. The STORED one is dotted
 * (`plugins.install`) — `api/orgs/roles/route.ts` sanitizes against
 * `ORG_PERMISSION_KEYS` before writing, and `AglynOrgMember.permissions` is
 * typed to it. The LEGACY one, which the marketplace gates read, is camelCase
 * (`installPlugins`).
 *
 * `resolveRolePermissions` takes `overrides` and `customRoles` parameters —
 * which look exactly like the missing wiring, and are keyed by the CAMELCASE
 * space. Passing the real stored documents into them matches no key and
 * changes nothing at all. It would read in review as "the feature is now
 * wired up" while remaining a no-op, and nothing would fail. Both parameters
 * are used by nothing but their own module's spec.
 *
 * The last test below pins that no-op deliberately, so the next person to
 * reach for it discovers why it does not work from a failing expectation
 * rather than from production.
 *
 * Merge SEMANTICS (narrowing, granting, override-beats-custom-role) are
 * already pinned by `custom-roles-narrow-and-page.spec.ts`; this file is
 * about the two resolvers agreeing, and stays off that ground.
 */

import {
  resolveOrgPermissions,
  resolveRolePermissions,
  toLegacyPermissions,
  type AglynOrgCustomRole,
  type AglynOrgMember,
} from '@aglyn/aglyn'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO_ROOT = join(__dirname, '../../..')
const read = (p: string) => readFileSync(join(REPO_ROOT, p), 'utf8')

const SERVER_RESOLVER = 'libs/tenant/runtime/src/lib/org-permissions.ts'
const CONSOLE_HOOK = 'apps/console/hooks/use-org-permissions.ts'
const ADMIN_ORGS = 'libs/tenant/data/admin/src/lib/server/organizations.ts'

/** An editor whose override REVOKES plugin installs. */
const REVOKED = {
  role: 'editor',
  permissions: { 'plugins.install': false },
} as Partial<AglynOrgMember>

/** A viewer whose custom role GRANTS marketplace publishing. */
const GRANTED = {
  role: 'viewer',
  roleId: 'publisher',
} as Partial<AglynOrgMember>

const PUBLISHER_ROLE = {
  name: 'Publisher',
  permissions: { 'marketplace.publish': true },
} as unknown as AglynOrgCustomRole

describe('the console and the server resolve one permission model', () => {
  it('there is exactly ONE copy of the dotted → legacy mapping', () => {
    // It lived privately in the console hook, which is precisely how the
    // server came to have no translation at all.
    expect(typeof toLegacyPermissions).toBe('function')
    expect(read(CONSOLE_HOOK)).not.toContain('function toLegacyPermissions')
    expect(read(CONSOLE_HOOK)).toContain('toLegacyPermissions')
  })

  it('the server resolver is WIRED to the stored model, not just to the tier', () => {
    // Grepping for the call is the point: this is a control that is either
    // reached or not, and a green suite elsewhere never proved it was.
    const source = read(SERVER_RESOLVER)
    expect(source).toContain('resolveMemberOrgPermissions(')
    expect(source).toContain('toLegacyPermissions(')
  })

  it('overlays rather than substitutes, so plugin-declared keys survive', () => {
    // `resolveRolePermissions` also mixes in plugin-declared keys (AGL-435)
    // that the granular catalog knows nothing about. The legacy projection
    // must be spread ON TOP of it, never in place of it.
    const source = read(SERVER_RESOLVER)
    const base = source.indexOf('...resolveRolePermissions(ORG_ROLE_PERMISSION_BASE[role])')
    const overlay = source.indexOf('...toLegacyPermissions(granular, role)')
    expect(base).toBeGreaterThan(-1)
    expect(overlay).toBeGreaterThan(base)
  })

  it('single-permission and full-set answers come from one place', () => {
    // `memberHasOrgPermission` must delegate, or the two can disagree about
    // the same member on the same request.
    const source = read(ADMIN_ORGS)
    expect(source).toContain('export async function resolveMemberOrgPermissions')
    expect(source).toContain(
      '(await resolveMemberOrgPermissions(orgId, member))[permission]',
    )
  })

  it('no org-management route gates on the RAW role any more', () => {
    // Three routes asked `canManageOrg(role)`, which cannot see a custom role
    // or an override and so defeated the narrowing `run-an-agency-workspace.md`
    // sells. Behaviour-identical for the built-in roles, which is exactly why
    // a behavioural test of an ordinary admin could not have caught them —
    // this is the mechanical half, and the override case in
    // `app/api/orgs/settings/route.spec.ts` is the behavioural one.
    //
    // `apps/console/app/api/orgs/invites/route.ts` joined the list in
    // AGL-2464. It was the sibling those three fixes did not reach: the
    // guard above only fails when a permission key has NO server consumer,
    // and `members.manage` had several — so a fourth route resolving the
    // WRONG thing was invisible to it. Naming the route here is what makes
    // "the right resolver" checkable rather than assumed.
    const ROUTES = [
      'apps/console/app/api/hosts/create/route.ts',
      'apps/console/app/api/orgs/invites/route.ts',
      'apps/console/app/api/orgs/settings/route.ts',
      'apps/console/app/api/orgs/sso/route.ts',
    ]
    const offenders = ROUTES.filter((route) => {
      const code = read(route)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      return code.includes('canManageOrg(') || !code.includes('memberHasOrgPermission(')
    })
    expect(offenders).toEqual([])

    // The filter can FAIL — a file that gates on the tier is reported. Without
    // this, a typo'd path list or a comment-stripper that ate the whole file
    // would make the assertion above vacuous.
    expect(
      ['apps/console/components/org-members-card.component.tsx'].filter(
        (route) => {
          const code = read(route)
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '')
          return (
            code.includes('canManageOrg(') ||
            !code.includes('memberHasOrgPermission(')
          )
        },
      ),
    ).toHaveLength(1)
  })

  it('a REVOKED permission is revoked in the legacy map the gates read', () => {
    const granted = resolveOrgPermissions(REVOKED, null)
    expect(granted['plugins.install']).toBe(false)
    // This is the flag `install.ts` and its five siblings actually branch on.
    expect(toLegacyPermissions(granted, 'editor').installPlugins).toBe(false)
    // Premise: the base role would otherwise allow it, so the test is not
    // passing for the trivial reason.
    expect(
      toLegacyPermissions(resolveOrgPermissions({ role: 'editor' }, null), 'editor')
        .installPlugins,
    ).toBe(true)
  })

  it('a permission GRANTED by a custom role reaches the same map', () => {
    const granted = resolveOrgPermissions(GRANTED, PUBLISHER_ROLE)
    expect(toLegacyPermissions(granted, 'viewer').publishToMarketplace).toBe(true)
    expect(
      toLegacyPermissions(resolveOrgPermissions({ role: 'viewer' }, null), 'viewer')
        .publishToMarketplace,
    ).toBe(false)
  })

  it('THE TRAP — stored dotted keys do nothing in the camelCase parameters', () => {
    // If you are here because you were about to pass the member doc into
    // `resolveRolePermissions`: this is why that is not the fix. The stored
    // override is `plugins.install`; the parameter is keyed `installPlugins`;
    // nothing matches, nothing changes, and no test would have failed.
    const asStored = { 'plugins.install': false } as Record<string, boolean>
    const viaLegacyParam = resolveRolePermissions('editor', asStored)
    expect(viaLegacyParam.installPlugins).toBe(true) // unchanged — the no-op

    // Translated through the granular model, the same stored document works.
    expect(
      toLegacyPermissions(resolveOrgPermissions(REVOKED, null), 'editor')
        .installPlugins,
    ).toBe(false)
  })
})
