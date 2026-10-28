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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * A CONSOLE GATE ASKS THE KEY ITS ROUTE CHECKS (AGL-4047).
 *
 * These surfaces drew their controls from `canManageOrg(role)` (owner or
 * admin) while the routes behind them check a catalog key through
 * `memberHasOrgPermission`. The two agreed only until somebody used custom
 * roles: an editor granted `members.manage` was told by the roster they could
 * not manage people the server would have let them manage, and an admin a
 * role took `org.settings` from was shown a settings form that answered 403.
 *
 * Each row names a surface, the key it now asks, and the route whose check it
 * mirrors; the route half is asserted too, so a route that moves to another
 * key fails here rather than drifting from its console again.
 */

const ROOT = join(__dirname, '..')
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8')

const GATES: Array<{ surface: string; key: string; route: string }> = [
  { surface: 'components/org-members-card.component.tsx', key: 'members.manage', route: 'app/api/orgs/members/route.ts' },
  { surface: 'app/(app)/[orgSlug]/team/[uid]/page.tsx', key: 'members.manage', route: 'app/api/orgs/members/route.ts' },
  { surface: 'components/org-roles-card.component.tsx', key: 'members.manage', route: 'app/api/orgs/roles/route.ts' },
  { surface: 'components/settings/org-general-card.component.tsx', key: 'org.settings', route: 'app/api/orgs/settings/route.ts' },
  { surface: 'components/org-branding-card.component.tsx', key: 'org.settings', route: 'app/api/orgs/settings/route.ts' },
  { surface: 'components/org-sso-card.component.tsx', key: 'org.settings', route: 'app/api/orgs/sso/route.ts' },
  { surface: 'components/media/org-default-sharing-card.component.tsx', key: 'org.settings', route: 'app/api/orgs/settings/route.ts' },
  { surface: 'hooks/use-plugin-switchboard.ts', key: 'org.settings', route: 'app/api/orgs/settings/route.ts' },
  { surface: 'app/(app)/[orgSlug]/settings/(sections)/layout.tsx', key: 'org.settings', route: 'app/api/orgs/settings/route.ts' },
  // The three sections that stayed on the owner or admin role until their
  // routes moved to keys of their own.
  { surface: 'app/(app)/[orgSlug]/settings/(sections)/layout.tsx', key: 'org.apiKeys', route: 'app/api/orgs/api-keys/route.ts' },
  { surface: 'components/org-api-keys-card.component.tsx', key: 'org.apiKeys', route: 'app/api/orgs/api-keys/route.ts' },
  { surface: 'app/(app)/[orgSlug]/settings/(sections)/layout.tsx', key: 'org.holds', route: 'app/api/orgs/risk-notices/route.ts' },
  { surface: 'app/(app)/[orgSlug]/settings/(sections)/layout.tsx', key: 'org.privacy', route: '../../libs/plugins/crm/src/lib/server/erase-person.ts' },
]

describe('console gates ask the key their route checks (AGL-4047)', () => {
  it.each(GATES)('$surface asks "$key", as $route does', ({ surface, key, route }) => {
    const source = read(surface)
    expect(source).toContain(`can('${key}')`)
    // Held while the permissions load, never granted by the loading map.
    expect(source).toMatch(/loaded/)
    expect(read(route)).toMatch(new RegExp(`memberHasOrgPermission\\([^)]*'${key.replace('.', '\\.')}'`))
  })

  it('the member and role surfaces no longer gate on the role at all', () => {
    for (const surface of [
      'components/org-members-card.component.tsx',
      'app/(app)/[orgSlug]/team/[uid]/page.tsx',
      'components/org-roles-card.component.tsx',
      'components/settings/org-general-card.component.tsx',
      'components/org-branding-card.component.tsx',
      'components/org-sso-card.component.tsx',
      'components/media/org-default-sharing-card.component.tsx',
      'hooks/use-plugin-switchboard.ts',
      'app/(app)/[orgSlug]/settings/(sections)/layout.tsx',
      'components/org-api-keys-card.component.tsx',
    ]) {
      expect(read(surface)).not.toContain('canManageOrg(')
    }
  })

  it('the holds surfaces and the CRM’s erase item ask the same keys as their routes', () => {
    // A held page offers "Request a review" on the route's own answer, which
    // now asks `org.holds`, as the review route does.
    expect(read('app/api/hosts/page-holds/route.ts')).toMatch(/memberHasOrgPermission\([^)]*'org\.holds'/)
    // The record page's "Erase this person" asks `org.privacy`, org-wide.
    const erase = read('../../libs/plugins/crm/src/lib/components/use-can-erase-people.ts')
    expect(erase).toContain("granted['org.privacy']")
    expect(erase).toContain('isOrgWideMember(member)')
    expect(read('../../libs/plugins/crm/src/lib/components/erase-person-action.tsx')).not.toContain(
      'useCanManageCrmSettings',
    )
  })
})

/**
 * A SITE KEY'S CONTROL ASKS THE KEY ITS ROUTE OR RULE CHECKS (AGL-4047).
 *
 * The reservation keys replaced a gate on the site role, and their preset is
 * that role: the shell decides them for the site in view
 * (`applySiteRolePresets`), the Reservations card's controls read them off
 * the map the shell hands the plugin page, the walk-in and guests routes ask
 * "Book walk-ins and change guests", and the rules' stays block asks "Manage
 * reservations". A row per key, both halves asserted.
 */
const SITE_GATES: Array<{ key: string; surface: string; enforcer: string }> = [
  {
    key: 'commerce.walkIns',
    surface: '../../libs/plugins/commerce/src/lib/components/commerce-console-page.tsx',
    enforcer: '../../libs/plugins/commerce/src/lib/server/reservation-walk-in.ts',
  },
  {
    key: 'commerce.reservations',
    surface: '../../libs/plugins/commerce/src/lib/components/commerce-console-page.tsx',
    enforcer: '../../cloud/firebase-firestore.deploy.rules',
  },
]

describe('a site key’s control asks the key its route or rule checks (AGL-4047)', () => {
  it.each(SITE_GATES)('$key: the console reads it where $enforcer checks it', ({ key, surface, enforcer }) => {
    expect(read(surface)).toContain(`permissions?.['${key}']`)
    expect(read(enforcer)).toContain(`'${key}'`)
  })

  it('the guests change asks the walk-in’s key, and the card disables its controls by both', () => {
    expect(read('../../libs/plugins/commerce/src/lib/server/reservation-guests.ts')).toContain(
      '{ permission: WALK_IN_PERMISSION }',
    )
    const card = read('../../libs/plugins/commerce/src/lib/components/console/reservations-card.component.tsx')
    expect(card).toContain('disabled={!canManage')
    expect(card).toContain('disabled={!canWalkIn')
  })

  it('the shell decides the site keys for the site in view, from the member’s access there', () => {
    const shell = read('app/(app)/[orgSlug]/hosts/[host]/[...pluginSlug]/page.tsx')
    expect(shell).toContain('applySiteRolePresets(')
    expect(shell).toContain('isSiteRolePresetPermission(permission)')
  })
})
