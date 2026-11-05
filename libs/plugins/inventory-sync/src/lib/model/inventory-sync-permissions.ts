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
 * INVENTORY SYNC: THE KEYS (AGL-4047).
 *
 * Connecting a site's inventory system was the site Admin's; seeing the
 * connection and its failed orders, and sending one again, the site
 * Admin's and Editor's. Seeing where one order stands stays with everyone
 * on the site.
 * Each is now a key whose preset is that site role (`presetFromSiteRole`), so
 * every member keeps exactly the access they had, and a custom role, a
 * member's own permissions or a site's toggle can grant or refuse it.
 */

/** The plugin's keys, all of them with the site role as their preset. */
export type InventorySyncSitePermission = 'inventorySync.view' | 'inventorySync.manage' | 'inventorySync.orders'

/** The site Admin. */
const ADMIN_PRESET: Readonly<Record<HostAccessRole, boolean>> = { admin: true, editor: false, author: false, viewer: false }

/** The site Admin and Editor. */
const EDITOR_PRESET: Readonly<Record<HostAccessRole, boolean>> = { admin: true, editor: true, author: false, viewer: false }

/** Each key's preset: the table a door and a card read, whichever plugins this process loaded. */
export const INVENTORY_SYNC_SITE_PRESETS: Readonly<
  Record<InventorySyncSitePermission, Readonly<Record<HostAccessRole, boolean>>>
> = {
  'inventorySync.view': EDITOR_PRESET,
  'inventorySync.manage': ADMIN_PRESET,
  'inventorySync.orders': EDITOR_PRESET,
}

/** The keys as the plugin declares them into the org permission catalog. */
export const INVENTORY_SYNC_SITE_PERMISSIONS: readonly PluginOrgPermissionDeclaration[] = [
  {
    key: 'inventorySync.view',
    label: 'See the inventory connection',
    description: 'See which inventory system this site is connected to, its activity and the orders that could not be sent. Follows the site role unless a role or member sets it.',
    roleDefaults: { owner: true, admin: true, editor: true, viewer: false },
    hostRoleDefaults: { ...EDITOR_PRESET },
    group: 'inventory-sync',
    groupLabel: 'Inventory sync',
    presetFromSiteRole: true,
  },
  {
    key: 'inventorySync.manage',
    label: 'Manage the inventory connection',
    description: 'Connect and disconnect an inventory system, change its settings and locations, and run its sync. Follows the site role unless a role or member sets it.',
    roleDefaults: { owner: true, admin: true, editor: false, viewer: false },
    hostRoleDefaults: { ...ADMIN_PRESET },
    group: 'inventory-sync',
    groupLabel: 'Inventory sync',
    presetFromSiteRole: true,
  },
  {
    key: 'inventorySync.orders',
    label: 'Send orders to the inventory system',
    description: 'Send an order that could not be sent to the inventory system again. Follows the site role unless a role or member sets it.',
    roleDefaults: { owner: true, admin: true, editor: true, viewer: false },
    hostRoleDefaults: { ...EDITOR_PRESET },
    group: 'inventory-sync',
    groupLabel: 'Inventory sync',
    presetFromSiteRole: true,
  },
]
