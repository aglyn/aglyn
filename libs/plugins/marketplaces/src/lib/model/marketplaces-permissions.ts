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
 * ONLINE MARKETPLACES: THE KEYS (AGL-4047).
 *
 * Connecting a site's online marketplace seller account was the site
 * Admin's; seeing the connections, and sending an order's shipments again,
 * the site Admin's and Editor's. Seeing where one order came from stays
 * with everyone on the site.
 * Each is now a key whose preset is that site role (`presetFromSiteRole`), so
 * every member keeps exactly the access they had, and a custom role, a
 * member's own permissions or a site's toggle can grant or refuse it.
 */

/** The plugin's keys, all of them with the site role as their preset. */
export type MarketplacesSitePermission = 'marketplaces.view' | 'marketplaces.manage' | 'marketplaces.orders'

/** The site Admin. */
const ADMIN_PRESET: Readonly<Record<HostAccessRole, boolean>> = { admin: true, editor: false, author: false, viewer: false }

/** The site Admin and Editor. */
const EDITOR_PRESET: Readonly<Record<HostAccessRole, boolean>> = { admin: true, editor: true, author: false, viewer: false }

/** Each key's preset: the table a door and a card read, whichever plugins this process loaded. */
export const MARKETPLACES_SITE_PRESETS: Readonly<
  Record<MarketplacesSitePermission, Readonly<Record<HostAccessRole, boolean>>>
> = {
  'marketplaces.view': EDITOR_PRESET,
  'marketplaces.manage': ADMIN_PRESET,
  'marketplaces.orders': EDITOR_PRESET,
}

/** The keys as the plugin declares them into the org permission catalog. */
export const MARKETPLACES_SITE_PERMISSIONS: readonly PluginOrgPermissionDeclaration[] = [
  {
    key: 'marketplaces.view',
    label: 'See online marketplace connections',
    description: 'See which online marketplaces this site sells on, each connection’s activity and the listings to look at. Follows the site role unless a role or member sets it.',
    roleDefaults: { owner: true, admin: true, editor: true, viewer: false },
    hostRoleDefaults: { ...EDITOR_PRESET },
    group: 'marketplaces',
    groupLabel: 'Online marketplaces',
    presetFromSiteRole: true,
  },
  {
    key: 'marketplaces.manage',
    label: 'Manage online marketplace connections',
    description: 'Connect and disconnect a marketplace seller account, change its settings and run its sync. Follows the site role unless a role or member sets it.',
    roleDefaults: { owner: true, admin: true, editor: false, viewer: false },
    hostRoleDefaults: { ...ADMIN_PRESET },
    group: 'marketplaces',
    groupLabel: 'Online marketplaces',
    presetFromSiteRole: true,
  },
  {
    key: 'marketplaces.orders',
    label: 'Resend marketplace shipments',
    description: 'Send an order’s refused or failed shipments to its marketplace again. Follows the site role unless a role or member sets it.',
    roleDefaults: { owner: true, admin: true, editor: true, viewer: false },
    hostRoleDefaults: { ...EDITOR_PRESET },
    group: 'marketplaces',
    groupLabel: 'Online marketplaces',
    presetFromSiteRole: true,
  },
]
