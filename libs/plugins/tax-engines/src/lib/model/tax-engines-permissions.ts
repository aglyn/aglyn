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
 * TAX ENGINES: THE KEYS (AGL-4047).
 *
 * Connecting a site's tax engine was the site Admin's; exempt customers,
 * tax codes, address checks and orders' records the site Admin's and
 * Editor's. Seeing the connection and a product's tax code stays with
 * everyone on the site.
 * Each is now a key whose preset is that site role (`presetFromSiteRole`), so
 * every member keeps exactly the access they had, and a custom role, a
 * member's own permissions or a site's toggle can grant or refuse it.
 */

/** The plugin's keys, all of them with the site role as their preset. */
export type TaxEnginesSitePermission = 'taxEngines.manage' | 'taxEngines.exemptions' | 'taxEngines.productCodes' | 'taxEngines.addresses' | 'taxEngines.orders'

/** The site Admin. */
const ADMIN_PRESET: Readonly<Record<HostAccessRole, boolean>> = { admin: true, editor: false, author: false, viewer: false }

/** The site Admin and Editor. */
const EDITOR_PRESET: Readonly<Record<HostAccessRole, boolean>> = { admin: true, editor: true, author: false, viewer: false }

/** Each key's preset: the table a door and a card read, whichever plugins this process loaded. */
export const TAX_ENGINES_SITE_PRESETS: Readonly<
  Record<TaxEnginesSitePermission, Readonly<Record<HostAccessRole, boolean>>>
> = {
  'taxEngines.manage': ADMIN_PRESET,
  'taxEngines.exemptions': EDITOR_PRESET,
  'taxEngines.productCodes': EDITOR_PRESET,
  'taxEngines.addresses': EDITOR_PRESET,
  'taxEngines.orders': EDITOR_PRESET,
}

/** The keys as the plugin declares them into the org permission catalog. */
export const TAX_ENGINES_SITE_PERMISSIONS: readonly PluginOrgPermissionDeclaration[] = [
  {
    key: 'taxEngines.manage',
    label: 'Manage the tax engine connection',
    description: 'Connect, test and disconnect a tax engine, and change its ship-from address, default tax code and recording. Follows the site role unless a role or member sets it.',
    roleDefaults: { owner: true, admin: true, editor: false, viewer: false },
    hostRoleDefaults: { ...ADMIN_PRESET },
    group: 'tax-engines',
    groupLabel: 'Tax engines',
    presetFromSiteRole: true,
  },
  {
    key: 'taxEngines.exemptions',
    label: 'Manage exempt customers',
    description: 'See, save and remove the customers exempt from tax. Follows the site role unless a role or member sets it.',
    roleDefaults: { owner: true, admin: true, editor: true, viewer: false },
    hostRoleDefaults: { ...EDITOR_PRESET },
    group: 'tax-engines',
    groupLabel: 'Tax engines',
    presetFromSiteRole: true,
  },
  {
    key: 'taxEngines.productCodes',
    label: 'Set product tax codes',
    description: 'Set the tax code a product is taxed under. Follows the site role unless a role or member sets it.',
    roleDefaults: { owner: true, admin: true, editor: true, viewer: false },
    hostRoleDefaults: { ...EDITOR_PRESET },
    group: 'tax-engines',
    groupLabel: 'Tax engines',
    presetFromSiteRole: true,
  },
  {
    key: 'taxEngines.addresses',
    label: 'Check addresses with the tax engine',
    description: 'Ask the tax engine how it reads an address. Follows the site role unless a role or member sets it.',
    roleDefaults: { owner: true, admin: true, editor: true, viewer: false },
    hostRoleDefaults: { ...EDITOR_PRESET },
    group: 'tax-engines',
    groupLabel: 'Tax engines',
    presetFromSiteRole: true,
  },
  {
    key: 'taxEngines.orders',
    label: 'See and resend orders to the tax engine',
    description: 'See how an order stands with the tax engine, and send it again. Follows the site role unless a role or member sets it.',
    roleDefaults: { owner: true, admin: true, editor: true, viewer: false },
    hostRoleDefaults: { ...EDITOR_PRESET },
    group: 'tax-engines',
    groupLabel: 'Tax engines',
    presetFromSiteRole: true,
  },
]
