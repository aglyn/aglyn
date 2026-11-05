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
 * SHIPPING: THE KEYS (AGL-4047).
 *
 * A site's shipping settings, label charges and carrier accounts were the
 * site Admin's, and rates and labels the site Admin's and Editor's. Label
 * charges, carrier accounts and the merchant's own shipping accounts also
 * ask "Manage billing" to change, as they did.
 * Each is now a key whose preset is that site role (`presetFromSiteRole`), so
 * every member keeps exactly the access they had, and a custom role, a
 * member's own permissions or a site's toggle can grant or refuse it.
 */

/** The plugin's keys, all of them with the site role as their preset. */
export type ShippingSitePermission = 'shipping.viewSettings' | 'shipping.settings' | 'shipping.labelCharges' | 'shipping.carrierAccounts' | 'shipping.ownAccounts' | 'shipping.labels' | 'shipping.buyLabels' | 'shipping.voidLabels'

/** The site Admin. */
const ADMIN_PRESET: Readonly<Record<HostAccessRole, boolean>> = { admin: true, editor: false, author: false, viewer: false }

/** The site Admin and Editor. */
const EDITOR_PRESET: Readonly<Record<HostAccessRole, boolean>> = { admin: true, editor: true, author: false, viewer: false }

/** Each key's preset: the table a door and a card read, whichever plugins this process loaded. */
export const SHIPPING_SITE_PRESETS: Readonly<
  Record<ShippingSitePermission, Readonly<Record<HostAccessRole, boolean>>>
> = {
  'shipping.viewSettings': EDITOR_PRESET,
  'shipping.settings': ADMIN_PRESET,
  'shipping.labelCharges': ADMIN_PRESET,
  'shipping.carrierAccounts': ADMIN_PRESET,
  'shipping.ownAccounts': ADMIN_PRESET,
  'shipping.labels': EDITOR_PRESET,
  'shipping.buyLabels': EDITOR_PRESET,
  'shipping.voidLabels': EDITOR_PRESET,
}

/** The keys as the plugin declares them into the org permission catalog. */
export const SHIPPING_SITE_PERMISSIONS: readonly PluginOrgPermissionDeclaration[] = [
  {
    key: 'shipping.viewSettings',
    label: 'See shipping settings',
    description: 'See where parcels ship from, the boxes and the label settings. Follows the site role unless a role or member sets it.',
    roleDefaults: { owner: true, admin: true, editor: true, viewer: false },
    hostRoleDefaults: { ...EDITOR_PRESET },
    group: 'shipping',
    groupLabel: 'Shipping',
    presetFromSiteRole: true,
  },
  {
    key: 'shipping.settings',
    label: 'Change shipping settings',
    description: 'Change where parcels ship from, the boxes, the label settings and the services offered at checkout. Follows the site role unless a role or member sets it.',
    roleDefaults: { owner: true, admin: true, editor: false, viewer: false },
    hostRoleDefaults: { ...ADMIN_PRESET },
    group: 'shipping',
    groupLabel: 'Shipping',
    presetFromSiteRole: true,
  },
  {
    key: 'shipping.labelCharges',
    label: 'Manage label charges',
    description: 'See how labels are paid for, and agree to the charges. Agreeing also takes "Manage billing". Follows the site role unless a role or member sets it.',
    roleDefaults: { owner: true, admin: true, editor: false, viewer: false },
    hostRoleDefaults: { ...ADMIN_PRESET },
    group: 'shipping',
    groupLabel: 'Shipping',
    presetFromSiteRole: true,
  },
  {
    key: 'shipping.carrierAccounts',
    label: 'Manage carrier accounts',
    description: 'See the carrier accounts, connect one and switch them on and off. Changing them also takes "Manage billing". Follows the site role unless a role or member sets it.',
    roleDefaults: { owner: true, admin: true, editor: false, viewer: false },
    hostRoleDefaults: { ...ADMIN_PRESET },
    group: 'shipping',
    groupLabel: 'Shipping',
    presetFromSiteRole: true,
  },
  {
    key: 'shipping.ownAccounts',
    label: 'Manage your own shipping accounts',
    description: 'See and connect your own Easyship, Sendcloud or ShipperHQ account. Changing them also takes "Manage billing". Follows the site role unless a role or member sets it.',
    roleDefaults: { owner: true, admin: true, editor: false, viewer: false },
    hostRoleDefaults: { ...ADMIN_PRESET },
    group: 'shipping',
    groupLabel: 'Shipping',
    presetFromSiteRole: true,
  },
  {
    key: 'shipping.labels',
    label: 'Check rates and see labels',
    description: 'Check an address, compare rates and see the labels bought for an order. Follows the site role unless a role or member sets it.',
    roleDefaults: { owner: true, admin: true, editor: true, viewer: false },
    hostRoleDefaults: { ...EDITOR_PRESET },
    group: 'shipping',
    groupLabel: 'Shipping',
    presetFromSiteRole: true,
  },
  {
    key: 'shipping.buyLabels',
    label: 'Buy shipping labels',
    description: 'Buy a label for an order, or for a batch of orders, which charges the workspace. Follows the site role unless a role or member sets it.',
    roleDefaults: { owner: true, admin: true, editor: true, viewer: false },
    hostRoleDefaults: { ...EDITOR_PRESET },
    group: 'shipping',
    groupLabel: 'Shipping',
    presetFromSiteRole: true,
  },
  {
    key: 'shipping.voidLabels',
    label: 'Void shipping labels',
    description: 'Void a label that has not been used. Follows the site role unless a role or member sets it.',
    roleDefaults: { owner: true, admin: true, editor: true, viewer: false },
    hostRoleDefaults: { ...EDITOR_PRESET },
    group: 'shipping',
    groupLabel: 'Shipping',
    presetFromSiteRole: true,
  },
]
