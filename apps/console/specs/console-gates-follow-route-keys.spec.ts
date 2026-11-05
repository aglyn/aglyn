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

import { execFileSync } from 'node:child_process'
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
 * Saving the publisher profile, managing a published listing and setting up
 * payouts asked the owner or admin role in places that never named each
 * other: the routes through one role helper, the rules through a role list of
 * their own, and the console not at all (it offered Save and Edit to every
 * member of the hub and let the route refuse). Each row holds them to one
 * key: the marketplace page disables its control by it, the doors ask it,
 * and, where a client can write the same thing directly, the deployed rules
 * ask it too. A key with no client-direct write names the rules' freeze that
 * makes its route the only door instead.
 */
const MARKETPLACE = '../../libs/plugins/marketplace/src/lib'
const PUBLISHER_GATES: Array<{
  key: string
  constant: string
  surfaces: string[]
  doors: string[]
  /** `null` when no client writes it: the route is the only door. */
  rule: 'asks-the-key' | null
}> = [
  {
    key: 'marketplace.publisherProfile',
    constant: 'MARKETPLACE_PUBLISHER_PROFILE_PERMISSION',
    surfaces: [
      `${MARKETPLACE}/components/org-seller-panel.component.tsx`,
      `${MARKETPLACE}/components/listing-verification-request.component.tsx`,
    ],
    doors: [`${MARKETPLACE}/server/publisher-profile-save.ts`, `${MARKETPLACE}/server/verification-request.ts`],
    rule: 'asks-the-key',
  },
  {
    key: 'marketplace.manageListings',
    constant: 'MARKETPLACE_MANAGE_LISTINGS_PERMISSION',
    surfaces: [
      `${MARKETPLACE}/components/org-seller-panel.component.tsx`,
      `${MARKETPLACE}/components/listing-detail-page.component.tsx`,
      `${MARKETPLACE}/components/listing-review-status.component.tsx`,
    ],
    doors: [`${MARKETPLACE}/server/publisher-permissions.ts`, `${MARKETPLACE}/server/listing-versions.ts`],
    rule: 'asks-the-key',
  },
  {
    key: 'marketplace.payouts',
    constant: 'MARKETPLACE_PAYOUTS_PERMISSION',
    surfaces: [`${MARKETPLACE}/components/org-seller-panel.component.tsx`],
    doors: [`${MARKETPLACE}/server/connect.ts`],
    rule: null,
  },
]

/** Every non-spec source file of the marketplace plugin, by path. */
const marketplaceSources = (): string[] =>
  execFileSync('git', ['ls-files', '--', 'libs/plugins/marketplace/src/lib'], {
    cwd: join(ROOT, '../..'),
    encoding: 'utf8',
  })
    .split('\n')
    .filter((file) => /\.tsx?$/.test(file) && !/\.spec\.tsx?$/.test(file))

describe('the publisher keys: one key for the control, the route and the rule (AGL-4047)', () => {
  const model = read(`${MARKETPLACE}/model/marketplace-publisher-permissions.ts`)
  const rules = read('../../cloud/firebase-firestore.deploy.rules')

  it.each(PUBLISHER_GATES)('$key', ({ key, constant, surfaces, doors, rule }) => {
    expect(model).toContain(`export const ${constant}: MarketplacePublisherPermission = '${key}'`)
    for (const surface of surfaces) expect(read(surface)).toContain(`permissions?.[${constant}] !== false`)
    for (const door of doors) expect(read(door)).toContain(constant)
    if (rule) expect(rules).toContain(`'${key}'`)
    else expect(rules).not.toContain(`'${key}'`)
  })

  it('payouts have no client door: the rules freeze every payout field on the profile', () => {
    const profileUpdate = /match \/publisherProfiles\/\{orgId\}[\s\S]*?allow update:([\s\S]*?);/.exec(rules)?.[1] ?? ''
    for (const field of ['stripeAccountId', 'stripeChargesEnabled', 'stripeAccountLivemode', 'stripePayoutsEnabled']) {
      expect(profileUpdate).toContain(`'${field}'`)
    }
  })

  it('the publisher doors all go through the gate that asks their key, and none asks the role any more', () => {
    for (const door of [
      'publish-plugin.ts',
      'preview-image.ts',
      'publisher-profile-save.ts',
      'connect.ts',
      'verification-request.ts',
      'listing-versions.ts',
    ]) {
      expect(read(`${MARKETPLACE}/server/${door}`)).not.toMatch(/canActAsPublisher\(/)
    }
    expect(read(`${MARKETPLACE}/server/publish-plugin.ts`).match(/manageListingsRefusal\(/g)).toHaveLength(3)
    expect(read(`${MARKETPLACE}/server/preview-image.ts`)).toContain('manageListingsRefusal(')
    for (const door of ['connect.ts', 'verification-request.ts', 'listing-versions.ts']) {
      expect(read(`${MARKETPLACE}/server/${door}`)).toContain('publisherPermissionVerdict(')
    }
  })

  it('the role helper is gone from the plugin; the ownership questions ask membership, never a key', () => {
    const sources = marketplaceSources()
    // The search searches: the plugin has sources, and the membership fact is found.
    expect(sources.length).toBeGreaterThan(50)
    expect(sources.filter((file) => /\bcanActAsPublisher\b/.test(read(`../../${file}`)))).toEqual([])
    // Free own installs, no buying your own listing, no rating it.
    const MEMBERSHIP = [
      'install.ts',
      'install-plugin.ts',
      'install-theme.ts',
      'install-template.ts',
      'install-layout.ts',
      'install-email-template.ts',
      'install-email-starter.ts',
      'install-dataset-schema.ts',
      'update-artifact.ts',
      'site-starter-source.ts',
      'sale.ts',
      'reviews.ts',
    ]
    for (const file of MEMBERSHIP) {
      expect([file, read(`${MARKETPLACE}/server/${file}`).includes('isPublisherMember(')]).toEqual([file, true])
    }
    // The fact asks the members collection and nothing else: no key, no role.
    const fact = /export async function isPublisherMember\([\s\S]*?\n}\n/.exec(read(`${MARKETPLACE}/server/publisher-profile.ts`))?.[0] ?? ''
    expect(fact).toContain('member.exists')
    expect(fact).not.toMatch(/memberHasOrgPermission|permissions|\.get\('role'\)|'owner'|'admin'/)
  })

  it('the rules ask the keys through the stamped helper, and Sequences asks "Use Sequences" the same way', () => {
    expect(rules).toMatch(/orgMemberKeyOrOverride\(orgId, 'marketplace\.publisherProfile', \['owner', 'admin'\]\)/)
    expect(rules).toMatch(/orgMemberKeyOrOverride\(resource\.data\.profileId,\s*'marketplace\.manageListings', \['owner', 'admin'\]\)/)
    expect(rules).toContain("memberKeyOrOverride('outreach.use', ['owner', 'admin'])")
  })
})
