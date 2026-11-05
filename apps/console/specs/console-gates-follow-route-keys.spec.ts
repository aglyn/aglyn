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

describe('the site’s publish and settings controls ask the keys the rules check (AGL-4047)', () => {
  it('Publish controls ask "Publish site content" for the site in view, as the rules do', () => {
    const hook = read('hooks/use-host-role.ts')
    expect(hook).toContain("resolveSiteRolePresetPermissions(member, hostId as never, customRole)['site.publish']")
    expect(hook).not.toContain('hostRoleCanPublish(')
    expect(read('../../cloud/firebase-firestore.deploy.rules')).toContain("hostSiteRoleKey(hostId, 'site.publish', ['admin', 'editor'])")
  })

  it('the Site Admin surfaces ask "Manage site settings", read as the rules read it', () => {
    const provider = read('components/host-id-provider.tsx')
    expect(provider).toContain("hostStampedSitePermission(host, uid, 'site.manage', CORE_SITE_ROLE_PRESETS['site.manage'])")
    expect(provider).not.toMatch(/memberRoles\?\.\[uid\] === 'admin'/)
    expect(read('../../cloud/firebase-firestore.deploy.rules')).toContain("hostSiteRoleKey(hostId, 'site.manage', ['admin'])")
  })
})

describe('the workspace keys’ controls ask the keys their routes and rules check (AGL-4047)', () => {
  it('the Business profile card asks "Business profile", as the rules do', () => {
    const page = read('app/(app)/[orgSlug]/settings/(sections)/profile/page.tsx')
    expect(page).toContain("can('org.businessProfile')")
    expect(page).not.toMatch(/role === 'owner'|role === 'admin'/)
    expect(read('../../cloud/firebase-firestore.deploy.rules')).toContain(
      "memberKeyOr('org.businessProfile', ['owner', 'admin'])",
    )
  })

  it.each([
    ['app/api/orgs/export-data/route.ts', 'org.export'],
    ['app/api/email/sending-domains/route.ts', 'org.sendingDomains'],
    ['app/api/resources/erase/route.ts', 'org.eraseRecords'],
    ['utils/server/media-scope.ts', 'org.media'],
  ])('%s asks "%s" through memberHasOrgPermission', (route, key) => {
    expect(read(route)).toMatch(new RegExp(`memberHasOrgPermission\\([^)]*'${key.replace('.', '\\.')}'`))
  })
})


/**
 * THE WORKSPACE'S PUBLISHER KEYS: ONE KEY FOR THE CONTROL, THE ROUTE AND THE
 * RULE (AGL-4047).
 *
 * Saving the publisher profile and managing a published listing asked the
 * owner or admin role in three places that never named each other: the
 * routes through `canActAsPublisher`, the rules through a role list of their
 * own, and the console not at all (it offered Save and Edit to every member
 * of the hub and let the route refuse). Each row holds the three to one key:
 * the marketplace page disables its control by it, the doors ask it, and the
 * deployed rules ask it for the client-direct write.
 */
const MARKETPLACE = '../../libs/plugins/marketplace/src/lib'
const PUBLISHER_GATES: Array<{ key: string; constant: string; surfaces: string[]; doors: string[] }> = [
  {
    key: 'marketplace.publisherProfile',
    constant: 'MARKETPLACE_PUBLISHER_PROFILE_PERMISSION',
    surfaces: [`${MARKETPLACE}/components/org-seller-panel.component.tsx`],
    doors: [`${MARKETPLACE}/server/publisher-profile-save.ts`],
  },
  {
    key: 'marketplace.manageListings',
    constant: 'MARKETPLACE_MANAGE_LISTINGS_PERMISSION',
    surfaces: [
      `${MARKETPLACE}/components/org-seller-panel.component.tsx`,
      `${MARKETPLACE}/components/listing-detail-page.component.tsx`,
    ],
    doors: [`${MARKETPLACE}/server/publisher-permissions.ts`],
  },
]

describe('the publisher keys: one key for the control, the route and the rule (AGL-4047)', () => {
  const model = read(`${MARKETPLACE}/model/marketplace-publisher-permissions.ts`)
  const rules = read('../../cloud/firebase-firestore.deploy.rules')

  it.each(PUBLISHER_GATES)('$key', ({ key, constant, surfaces, doors }) => {
    expect(model).toContain(`export const ${constant}: MarketplacePublisherPermission = '${key}'`)
    for (const surface of surfaces) expect(read(surface)).toContain(`permissions?.[${constant}] !== false`)
    for (const door of doors) expect(read(door)).toContain(constant)
    expect(rules).toContain(`'${key}'`)
  })

  it('the listing doors all go through the gate that asks it, and none asks the role any more', () => {
    for (const door of ['publish-plugin.ts', 'preview-image.ts', 'publisher-profile-save.ts']) {
      const source = read(`${MARKETPLACE}/server/${door}`)
      expect(source).not.toMatch(/canActAsPublisher\(/)
    }
    expect(read(`${MARKETPLACE}/server/publish-plugin.ts`).match(/manageListingsRefusal\(/g)).toHaveLength(3)
    expect(read(`${MARKETPLACE}/server/preview-image.ts`)).toContain('manageListingsRefusal(')
  })

  it('the rules ask the keys through the stamped helper, and Sequences asks "Use Sequences" the same way', () => {
    expect(rules).toMatch(/orgMemberKeyOrOverride\(orgId, 'marketplace\.publisherProfile', \['owner', 'admin'\]\)/)
    expect(rules).toMatch(/orgMemberKeyOrOverride\(resource\.data\.profileId,\s*'marketplace\.manageListings', \['owner', 'admin'\]\)/)
    expect(rules).toContain("memberKeyOrOverride('outreach.use', ['owner', 'admin'])")
  })
})

/**
 * THE READERS THAT ASKED A ROLE AND A KEY ASK THE KEY ALONE (AGL-4047).
 *
 * The CRM's people, a list's people, the AI usage and billing documents and
 * the hardware orders were read in the rules as "the owner/admin(/editor)
 * role AND the key, or the key stamped". The key's default is exactly that
 * role list, so `memberKeyOrOverride(key, thoseRoles)` gives every member the
 * same answer with no role named. Each row holds the rule to the key the
 * console registers the surface with and the route that serves the same data
 * asks, so a route or a page that moves to another key fails here.
 */
const PLUGINS = '../../libs/plugins'
const READER_GATES: Array<{
  reader: string
  rule: string
  console: Array<[string, string]>
  routes: Array<[string, RegExp]>
}> = [
  {
    reader: 'the CRM’s people (`canReadScopedPeople`)',
    rule: "function canReadScopedPeople() {\nreturn canReadScoped() &&\nmemberKeyOrOverride('data.manage', ['owner', 'admin', 'editor']);\n}",
    console: [[`${PLUGINS}/crm/src/lib/plugin.ts`, "permission: 'data.manage'"]],
    routes: [
      [`${PLUGINS}/crm/src/lib/server/record-facts.ts`, /memberHasOrgPermission\(orgId, member, 'data\.manage'\)/],
      [`${PLUGINS}/crm/src/lib/server/org-caller.ts`, /memberHasOrgPermission\(orgId, member, 'data\.manage'\)/],
    ],
  },
  {
    reader: 'a list’s people (`isOrgWideAudienceManager`)',
    rule: "function isOrgWideAudienceManager() {\nreturn isOrgWideMember() &&\nmemberKeyOrOverride('data.manage', ['owner', 'admin', 'editor']);\n}",
    console: [[`${PLUGINS}/email/src/lib/plugin.ts`, "permission: 'data.manage'"]],
    routes: [],
  },
  {
    reader: 'a person’s AI usage months (`aiUsageByUser`)',
    rule: "(memberKeyOrOverride('billing.view', ['owner', 'admin']) ||\nmemberKeyOrOverride('org.auditLog', ['owner', 'admin'])));",
    console: [[`${PLUGINS}/ai/src/lib/plugin.ts`, "permission: 'billing.view'"]],
    routes: [
      [`${PLUGINS}/ai/src/lib/server/ai-usage.ts`, /memberHasOrgPermission\(orgId, member, 'billing\.view'\)/],
      [`${PLUGINS}/ai/src/lib/server/ai-usage.ts`, /memberHasOrgPermission\(orgId, member, 'org\.auditLog'\)/],
    ],
  },
  {
    reader: 'the AI allotments, billing standing and overage charges',
    rule: "(memberKeyOrOverride('billing.view', ['owner', 'admin']) ||\nmemberKeyOrOverride('billing.manage', ['owner', 'admin']))",
    console: [[`${PLUGINS}/ai/src/lib/plugin.ts`, "permission: 'billing.view'"]],
    routes: [
      [`${PLUGINS}/ai/src/lib/server/ai-allotments.ts`, /memberHasOrgPermission\(orgId, member, 'billing\.view'\)/],
      [`${PLUGINS}/ai/src/lib/server/ai-allotments.ts`, /memberHasOrgPermission\(orgId, member, 'billing\.manage'\)/],
      [`${PLUGINS}/ai/src/lib/server/billing-overage.ts`, /memberHasOrgPermission\(orgId, actor\?\.member, 'billing\.manage'\)/],
    ],
  },
  {
    reader: 'the hardware orders (`hardwareOrders`)',
    rule: "(memberKeyOrOverride('managePos', ['owner', 'admin', 'editor']) ||\nmemberStamps('posBuyHardware')));",
    console: [],
    routes: [[`${PLUGINS}/commerce/src/lib/server/pos-auth.ts`, /permissions\?\.\['managePos'\] === true/]],
  },
]

describe('the readers that asked a role and a key ask the key alone (AGL-4047)', () => {
  const rules = read('../../cloud/firebase-firestore.deploy.rules')

  it.each(READER_GATES)('$reader', ({ rule, console: surfaces, routes }) => {
    expect(rules).toContain(rule)
    for (const [surface, gate] of surfaces) expect(read(surface)).toContain(gate)
    for (const [route, gate] of routes) expect(read(route)).toMatch(gate)
  })

  it('the four AI usage and billing reads no longer ask the role', () => {
    expect(rules.match(/memberKeyOrOverride\('billing\.manage', \['owner', 'admin'\]\)/g)).toHaveLength(3)
    for (const match of ['aiUsageByUser/{subjectUid}/months/{month}', 'aiAllotments/{subject}', 'aiBilling/{document}', 'aiOverageCharges/{chargeId}']) {
      const block = rules.slice(rules.indexOf(`match /${match} {`), rules.indexOf('allow write: if false;', rules.indexOf(`match /${match} {`)))
      expect(block.length).toBeGreaterThan(0)
      expect(block).not.toContain('canManageOrg()')
    }
  })

  it('the helper whose absent answer was "allowed" is gone with its last caller', () => {
    expect(rules).not.toMatch(/\bmemberResolves\(/)
  })
})
