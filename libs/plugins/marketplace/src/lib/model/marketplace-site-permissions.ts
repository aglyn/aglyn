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

import type { HostAccessRole } from '@aglyn/aglyn/foundation/definitions/organization.types'
import type { PluginOrgPermissionDeclaration } from '@aglyn/aglyn/plugin-manager/plugin-entitlements'

/*
 * THE MARKETPLACE ON A SITE (AGL-4047).
 *
 * Installing a listing into a site (a template, theme, layout, component,
 * email design or plugin) and publishing a site's own to the marketplace
 * asked two things: the workspace's key (`installPlugins`,
 * `publishToMarketplace`), and the member's role ON THE SITE, Admin or
 * Editor. The second is now a key per act whose preset is that site role
 * (`presetFromSiteRole`), so every member keeps exactly the access they had,
 * and a custom role, a member's own permissions or a site's toggle can grant
 * or refuse it. The workspace's key is still asked beside it.
 */

/** The marketplace's keys whose preset is the site role. */
export type MarketplaceSitePermission = 'marketplace.siteInstall' | 'marketplace.sitePublish'

/** Who installed into or published from a site before these were keys: the site's Admin and Editor. */
export const MARKETPLACE_SITE_ROLE_PRESET: Readonly<Record<HostAccessRole, boolean>> = {
  admin: true,
  editor: true,
  author: false,
  viewer: false,
}

/** The keys as the plugin declares them into the org permission catalog. */
export const MARKETPLACE_SITE_PERMISSIONS: readonly PluginOrgPermissionDeclaration[] = [
  {
    key: 'marketplace.siteInstall',
    label: 'Install marketplace items into a site',
    description:
      'Install templates, themes, layouts, components, email designs and plugins from the marketplace into a site (with "Install from the marketplace"). Follows the site role unless a role or member sets it.',
    roleDefaults: { owner: true, admin: true, editor: true, viewer: false },
    hostRoleDefaults: { ...MARKETPLACE_SITE_ROLE_PRESET },
    group: 'marketplace',
    groupLabel: 'Marketplace',
    presetFromSiteRole: true,
  },
  {
    key: 'marketplace.sitePublish',
    label: 'Publish a site’s items to the marketplace',
    description:
      'Publish a site’s templates, themes, layouts, components and email designs to the marketplace (with "Publish to the marketplace"). Follows the site role unless a role or member sets it.',
    roleDefaults: { owner: true, admin: true, editor: true, viewer: false },
    hostRoleDefaults: { ...MARKETPLACE_SITE_ROLE_PRESET },
    group: 'marketplace',
    groupLabel: 'Marketplace',
    presetFromSiteRole: true,
  },
]

/** The refusal a door answers without one: names the permission, never a role. */
export function marketplaceSitePermissionRefusal(key: MarketplaceSitePermission): string {
  const label = MARKETPLACE_SITE_PERMISSIONS.find((entry) => entry.key === key)?.label ?? key
  return `Your role does not include "${label}" — ask an organization admin`
}
