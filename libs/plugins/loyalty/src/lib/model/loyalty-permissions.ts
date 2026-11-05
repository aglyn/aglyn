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
 * REWARDS: THE KEYS (AGL-4047).
 *
 * Changing a site's rewards program and connecting a rewards service were
 * the site Admin's, and adjusting a member's balance the site Admin's and
 * Editor's. Reading the program and its members stays with everyone on the
 * site.
 * Each is now a key whose preset is that site role (`presetFromSiteRole`), so
 * every member keeps exactly the access they had, and a custom role, a
 * member's own permissions or a site's toggle can grant or refuse it.
 */

/** The plugin's keys, all of them with the site role as their preset. */
export type LoyaltySitePermission = 'loyalty.program' | 'loyalty.connection' | 'loyalty.adjustBalances'

/** The site Admin. */
const ADMIN_PRESET: Readonly<Record<HostAccessRole, boolean>> = { admin: true, editor: false, author: false, viewer: false }

/** The site Admin and Editor. */
const EDITOR_PRESET: Readonly<Record<HostAccessRole, boolean>> = { admin: true, editor: true, author: false, viewer: false }

/** Each key's preset: the table a door and a card read, whichever plugins this process loaded. */
export const LOYALTY_SITE_PRESETS: Readonly<
  Record<LoyaltySitePermission, Readonly<Record<HostAccessRole, boolean>>>
> = {
  'loyalty.program': ADMIN_PRESET,
  'loyalty.connection': ADMIN_PRESET,
  'loyalty.adjustBalances': EDITOR_PRESET,
}

/** The keys as the plugin declares them into the org permission catalog. */
export const LOYALTY_SITE_PERMISSIONS: readonly PluginOrgPermissionDeclaration[] = [
  {
    key: 'loyalty.program',
    label: 'Change the rewards program',
    description: 'Change how rewards are earned and spent, the referral offer and the rewards emails. Follows the site role unless a role or member sets it.',
    roleDefaults: { owner: true, admin: true, editor: false, viewer: false },
    hostRoleDefaults: { ...ADMIN_PRESET },
    group: 'loyalty',
    groupLabel: 'Rewards',
    presetFromSiteRole: true,
  },
  {
    key: 'loyalty.connection',
    label: 'Connect a rewards service',
    description: 'Connect and disconnect Smile.io or Yotpo Loyalty, and bring its balances in. Follows the site role unless a role or member sets it.',
    roleDefaults: { owner: true, admin: true, editor: false, viewer: false },
    hostRoleDefaults: { ...ADMIN_PRESET },
    group: 'loyalty',
    groupLabel: 'Rewards',
    presetFromSiteRole: true,
  },
  {
    key: 'loyalty.adjustBalances',
    label: 'Adjust rewards balances',
    description: 'Add or take away a member’s points or credit by hand. Follows the site role unless a role or member sets it.',
    roleDefaults: { owner: true, admin: true, editor: true, viewer: false },
    hostRoleDefaults: { ...EDITOR_PRESET },
    group: 'loyalty',
    groupLabel: 'Rewards',
    presetFromSiteRole: true,
  },
]
