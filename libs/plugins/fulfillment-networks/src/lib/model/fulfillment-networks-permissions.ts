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
 * FULFILLMENT NETWORKS: THE KEYS (AGL-4047).
 *
 * Connecting a site's fulfillment network was the site Admin's; seeing the
 * connections, and sending or cancelling an order, the site Admin's and
 * Editor's. Seeing where one order stands stays with everyone on the site.
 * Each is now a key whose preset is that site role (`presetFromSiteRole`), so
 * every member keeps exactly the access they had, and a custom role, a
 * member's own permissions or a site's toggle can grant or refuse it.
 */

/** The plugin's keys, all of them with the site role as their preset. */
export type FulfillmentNetworksSitePermission = 'fulfillmentNetworks.view' | 'fulfillmentNetworks.manage' | 'fulfillmentNetworks.orders'

/** The site Admin. */
const ADMIN_PRESET: Readonly<Record<HostAccessRole, boolean>> = { admin: true, editor: false, author: false, viewer: false }

/** The site Admin and Editor. */
const EDITOR_PRESET: Readonly<Record<HostAccessRole, boolean>> = { admin: true, editor: true, author: false, viewer: false }

/** Each key's preset: the table a door and a card read, whichever plugins this process loaded. */
export const FULFILLMENT_NETWORKS_SITE_PRESETS: Readonly<
  Record<FulfillmentNetworksSitePermission, Readonly<Record<HostAccessRole, boolean>>>
> = {
  'fulfillmentNetworks.view': EDITOR_PRESET,
  'fulfillmentNetworks.manage': ADMIN_PRESET,
  'fulfillmentNetworks.orders': EDITOR_PRESET,
}

/** The keys as the plugin declares them into the org permission catalog. */
export const FULFILLMENT_NETWORKS_SITE_PERMISSIONS: readonly PluginOrgPermissionDeclaration[] = [
  {
    key: 'fulfillmentNetworks.view',
    label: 'See fulfillment network connections',
    description: 'See which fulfillment networks this site is connected to, and each connection’s activity. Follows the site role unless a role or member sets it.',
    roleDefaults: { owner: true, admin: true, editor: true, viewer: false },
    hostRoleDefaults: { ...EDITOR_PRESET },
    group: 'fulfillment-networks',
    groupLabel: 'Fulfillment networks',
    presetFromSiteRole: true,
  },
  {
    key: 'fulfillmentNetworks.manage',
    label: 'Manage fulfillment network connections',
    description: 'Connect and disconnect a network, change its settings and webhook secret, and run its sync. Follows the site role unless a role or member sets it.',
    roleDefaults: { owner: true, admin: true, editor: false, viewer: false },
    hostRoleDefaults: { ...ADMIN_PRESET },
    group: 'fulfillment-networks',
    groupLabel: 'Fulfillment networks',
    presetFromSiteRole: true,
  },
  {
    key: 'fulfillmentNetworks.orders',
    label: 'Send orders to a fulfillment network',
    description: 'Send an order’s lines to a network, or ask the network to cancel them. Follows the site role unless a role or member sets it.',
    roleDefaults: { owner: true, admin: true, editor: true, viewer: false },
    hostRoleDefaults: { ...EDITOR_PRESET },
    group: 'fulfillment-networks',
    groupLabel: 'Fulfillment networks',
    presetFromSiteRole: true,
  },
]
