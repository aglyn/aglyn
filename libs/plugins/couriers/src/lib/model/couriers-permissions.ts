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
 * LOCAL DELIVERY COURIERS: THE KEYS (AGL-4047).
 *
 * Connecting a site's own courier account was the site Admin's; seeing the
 * connection and an order's delivery, and quoting and dispatching one, the
 * site Admin's and Editor's.
 * Each is now a key whose preset is that site role (`presetFromSiteRole`), so
 * every member keeps exactly the access they had, and a custom role, a
 * member's own permissions or a site's toggle can grant or refuse it.
 */

/** The plugin's keys, all of them with the site role as their preset. */
export type CouriersSitePermission = 'couriers.view' | 'couriers.manage' | 'couriers.dispatch'

/** The site Admin. */
const ADMIN_PRESET: Readonly<Record<HostAccessRole, boolean>> = { admin: true, editor: false, author: false, viewer: false }

/** The site Admin and Editor. */
const EDITOR_PRESET: Readonly<Record<HostAccessRole, boolean>> = { admin: true, editor: true, author: false, viewer: false }

/** Each key's preset: the table a door and a card read, whichever plugins this process loaded. */
export const COURIERS_SITE_PRESETS: Readonly<
  Record<CouriersSitePermission, Readonly<Record<HostAccessRole, boolean>>>
> = {
  'couriers.view': EDITOR_PRESET,
  'couriers.manage': ADMIN_PRESET,
  'couriers.dispatch': EDITOR_PRESET,
}

/** The keys as the plugin declares them into the org permission catalog. */
export const COURIERS_SITE_PERMISSIONS: readonly PluginOrgPermissionDeclaration[] = [
  {
    key: 'couriers.view',
    label: 'See the courier connection',
    description: 'See which courier this site is connected to, and an order’s delivery. Follows the site role unless a role or member sets it.',
    roleDefaults: { owner: true, admin: true, editor: true, viewer: false },
    hostRoleDefaults: { ...EDITOR_PRESET },
    group: 'couriers',
    groupLabel: 'Local delivery couriers',
    presetFromSiteRole: true,
  },
  {
    key: 'couriers.manage',
    label: 'Manage the courier connection',
    description: 'Connect and disconnect a courier, test it, change its settings and its webhook token. Follows the site role unless a role or member sets it.',
    roleDefaults: { owner: true, admin: true, editor: false, viewer: false },
    hostRoleDefaults: { ...ADMIN_PRESET },
    group: 'couriers',
    groupLabel: 'Local delivery couriers',
    presetFromSiteRole: true,
  },
  {
    key: 'couriers.dispatch',
    label: 'Dispatch couriers',
    description: 'Get a quote, send a courier for an order, cancel one and refresh where it is. A courier’s charge is the store’s. Follows the site role unless a role or member sets it.',
    roleDefaults: { owner: true, admin: true, editor: true, viewer: false },
    hostRoleDefaults: { ...EDITOR_PRESET },
    group: 'couriers',
    groupLabel: 'Local delivery couriers',
    presetFromSiteRole: true,
  },
]
