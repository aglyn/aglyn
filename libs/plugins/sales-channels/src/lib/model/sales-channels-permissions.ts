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
 * SALES CHANNELS: THE KEYS (AGL-4047).
 *
 * Replacing a feed's address and connecting Google or Meta were the site
 * Admin's; switching a feed, the store defaults and pushing the catalog
 * were the site Admin's and Editor's. Reading a site's channels stays with
 * everyone on the site.
 * Each is now a key whose preset is that site role (`presetFromSiteRole`), so
 * every member keeps exactly the access they had, and a custom role, a
 * member's own permissions or a site's toggle can grant or refuse it.
 */

/** The plugin's keys, all of them with the site role as their preset. */
export type SalesChannelsSitePermission = 'salesChannels.feeds' | 'salesChannels.settings' | 'salesChannels.replaceAddress' | 'salesChannels.connect' | 'salesChannels.sync'

/** The site Admin. */
const ADMIN_PRESET: Readonly<Record<HostAccessRole, boolean>> = { admin: true, editor: false, author: false, viewer: false }

/** The site Admin and Editor. */
const EDITOR_PRESET: Readonly<Record<HostAccessRole, boolean>> = { admin: true, editor: true, author: false, viewer: false }

/** Each key's preset: the table a door and a card read, whichever plugins this process loaded. */
export const SALES_CHANNELS_SITE_PRESETS: Readonly<
  Record<SalesChannelsSitePermission, Readonly<Record<HostAccessRole, boolean>>>
> = {
  'salesChannels.feeds': EDITOR_PRESET,
  'salesChannels.settings': EDITOR_PRESET,
  'salesChannels.replaceAddress': ADMIN_PRESET,
  'salesChannels.connect': ADMIN_PRESET,
  'salesChannels.sync': EDITOR_PRESET,
}

/** The keys as the plugin declares them into the org permission catalog. */
export const SALES_CHANNELS_SITE_PERMISSIONS: readonly PluginOrgPermissionDeclaration[] = [
  {
    key: 'salesChannels.feeds',
    label: 'Turn product feeds on and off',
    description: 'Turn each shopping channel’s product feed on or off. Follows the site role unless a role or member sets it.',
    roleDefaults: { owner: true, admin: true, editor: true, viewer: false },
    hostRoleDefaults: { ...EDITOR_PRESET },
    group: 'sales-channels',
    groupLabel: 'Sales channels',
    presetFromSiteRole: true,
  },
  {
    key: 'salesChannels.settings',
    label: 'Change sales channel defaults',
    description: 'Change the store defaults the product feeds use. Follows the site role unless a role or member sets it.',
    roleDefaults: { owner: true, admin: true, editor: true, viewer: false },
    hostRoleDefaults: { ...EDITOR_PRESET },
    group: 'sales-channels',
    groupLabel: 'Sales channels',
    presetFromSiteRole: true,
  },
  {
    key: 'salesChannels.replaceAddress',
    label: 'Replace a feed address',
    description: 'Replace a product feed’s address, which stops the old one working, and turn off an earlier Google address. Follows the site role unless a role or member sets it.',
    roleDefaults: { owner: true, admin: true, editor: false, viewer: false },
    hostRoleDefaults: { ...ADMIN_PRESET },
    group: 'sales-channels',
    groupLabel: 'Sales channels',
    presetFromSiteRole: true,
  },
  {
    key: 'salesChannels.connect',
    label: 'Connect Google and Meta',
    description: 'Connect and disconnect a Google Merchant Center or Meta catalog, and choose the account the catalog goes to. Follows the site role unless a role or member sets it.',
    roleDefaults: { owner: true, admin: true, editor: false, viewer: false },
    hostRoleDefaults: { ...ADMIN_PRESET },
    group: 'sales-channels',
    groupLabel: 'Sales channels',
    presetFromSiteRole: true,
  },
  {
    key: 'salesChannels.sync',
    label: 'Push the catalog to a channel',
    description: 'Send the catalog to a connected Google Merchant Center or Meta catalog now. Follows the site role unless a role or member sets it.',
    roleDefaults: { owner: true, admin: true, editor: true, viewer: false },
    hostRoleDefaults: { ...EDITOR_PRESET },
    group: 'sales-channels',
    groupLabel: 'Sales channels',
    presetFromSiteRole: true,
  },
]
