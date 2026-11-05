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
 * AD CONVERSIONS: THE KEYS (AGL-4047).
 *
 * Connecting a site's ad accounts was the site Admin's, and seeing those
 * connections the site Admin's and Editor's.
 * Each is now a key whose preset is that site role (`presetFromSiteRole`), so
 * every member keeps exactly the access they had, and a custom role, a
 * member's own permissions or a site's toggle can grant or refuse it.
 */

/** The plugin's keys, all of them with the site role as their preset. */
export type AdConversionsSitePermission = 'adConversions.view' | 'adConversions.manage'

/** The site Admin. */
const ADMIN_PRESET: Readonly<Record<HostAccessRole, boolean>> = { admin: true, editor: false, author: false, viewer: false }

/** The site Admin and Editor. */
const EDITOR_PRESET: Readonly<Record<HostAccessRole, boolean>> = { admin: true, editor: true, author: false, viewer: false }

/** Each key's preset: the table a door and a card read, whichever plugins this process loaded. */
export const AD_CONVERSIONS_SITE_PRESETS: Readonly<
  Record<AdConversionsSitePermission, Readonly<Record<HostAccessRole, boolean>>>
> = {
  'adConversions.view': EDITOR_PRESET,
  'adConversions.manage': ADMIN_PRESET,
}

/** The keys as the plugin declares them into the org permission catalog. */
export const AD_CONVERSIONS_SITE_PERMISSIONS: readonly PluginOrgPermissionDeclaration[] = [
  {
    key: 'adConversions.view',
    label: 'See ad conversion connections',
    description: 'See which ad accounts this site sends conversions to. Follows the site role unless a role or member sets it.',
    roleDefaults: { owner: true, admin: true, editor: true, viewer: false },
    hostRoleDefaults: { ...EDITOR_PRESET },
    group: 'ad-conversions',
    groupLabel: 'Ad conversions',
    presetFromSiteRole: true,
  },
  {
    key: 'adConversions.manage',
    label: 'Manage ad conversion connections',
    description: 'Connect and disconnect an ad account, change its settings, pause it and send a test event. Follows the site role unless a role or member sets it.',
    roleDefaults: { owner: true, admin: true, editor: false, viewer: false },
    hostRoleDefaults: { ...ADMIN_PRESET },
    group: 'ad-conversions',
    groupLabel: 'Ad conversions',
    presetFromSiteRole: true,
  },
]
