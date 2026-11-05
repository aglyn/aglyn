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
 * PRINT ON DEMAND: THE KEYS (AGL-4047).
 *
 * Connecting a site's print-on-demand service was the site Admin's;
 * bringing its products in and working its orders the site Admin's and
 * Editor's. Seeing the connections, imported products and one order's
 * parts stays with everyone on the site.
 * Each is now a key whose preset is that site role (`presetFromSiteRole`), so
 * every member keeps exactly the access they had, and a custom role, a
 * member's own permissions or a site's toggle can grant or refuse it.
 */

/** The plugin's keys, all of them with the site role as their preset. */
export type PrintOnDemandSitePermission = 'printOnDemand.manage' | 'printOnDemand.products' | 'printOnDemand.orders'

/** The site Admin. */
const ADMIN_PRESET: Readonly<Record<HostAccessRole, boolean>> = { admin: true, editor: false, author: false, viewer: false }

/** The site Admin and Editor. */
const EDITOR_PRESET: Readonly<Record<HostAccessRole, boolean>> = { admin: true, editor: true, author: false, viewer: false }

/** Each key's preset: the table a door and a card read, whichever plugins this process loaded. */
export const PRINT_ON_DEMAND_SITE_PRESETS: Readonly<
  Record<PrintOnDemandSitePermission, Readonly<Record<HostAccessRole, boolean>>>
> = {
  'printOnDemand.manage': ADMIN_PRESET,
  'printOnDemand.products': EDITOR_PRESET,
  'printOnDemand.orders': EDITOR_PRESET,
}

/** The keys as the plugin declares them into the org permission catalog. */
export const PRINT_ON_DEMAND_SITE_PERMISSIONS: readonly PluginOrgPermissionDeclaration[] = [
  {
    key: 'printOnDemand.manage',
    label: 'Manage print-on-demand connections',
    description: 'Connect and disconnect a print-on-demand service, and choose how paid orders are sent to it. Follows the site role unless a role or member sets it.',
    roleDefaults: { owner: true, admin: true, editor: false, viewer: false },
    hostRoleDefaults: { ...ADMIN_PRESET },
    group: 'print-on-demand',
    groupLabel: 'Print on demand',
    presetFromSiteRole: true,
  },
  {
    key: 'printOnDemand.products',
    label: 'Import print-on-demand products',
    description: 'Browse a service’s products, import or re-sync them, and stop filling a product through it. Follows the site role unless a role or member sets it.',
    roleDefaults: { owner: true, admin: true, editor: true, viewer: false },
    hostRoleDefaults: { ...EDITOR_PRESET },
    group: 'print-on-demand',
    groupLabel: 'Print on demand',
    presetFromSiteRole: true,
  },
  {
    key: 'printOnDemand.orders',
    label: 'Work print-on-demand orders',
    description: 'See the service orders, and send, confirm, refresh or cancel one, which a service may charge for. Follows the site role unless a role or member sets it.',
    roleDefaults: { owner: true, admin: true, editor: true, viewer: false },
    hostRoleDefaults: { ...EDITOR_PRESET },
    group: 'print-on-demand',
    groupLabel: 'Print on demand',
    presetFromSiteRole: true,
  },
]
