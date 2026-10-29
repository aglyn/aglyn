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
 * MARKETING'S KEY (AGL-4047).
 *
 * Composing, sending and managing email campaigns, and reading who a send
 * reached, was the site Admin's and Editor's on a site, and an owner's,
 * admin's or editor's of the whole workspace from the organization hub. That
 * is now "Run email campaigns", whose preset is the site role on a site
 * (`presetFromSiteRole`) and the workspace role with no site named
 * (`roleDefaults`), so every member keeps exactly the access they had, and a
 * custom role, a member's own permissions or a site's toggle can grant or
 * refuse it.
 */

/** Marketing's keys whose preset is the site role. */
export type MarketingSitePermission = 'marketing.campaigns'

/** Who ran a site's campaigns before it was a key: the site's Admin and Editor. */
export const MARKETING_CAMPAIGNS_SITE_ROLE_PRESET: Readonly<Record<HostAccessRole, boolean>> = {
  admin: true,
  editor: true,
  author: false,
  viewer: false,
}

/** The key as the plugin declares it into the org permission catalog. */
export const MARKETING_SITE_PERMISSIONS: readonly PluginOrgPermissionDeclaration[] = [
  {
    key: 'marketing.campaigns',
    label: 'Run email campaigns',
    description:
      'Draft, send, duplicate and manage email campaigns, and see who a send reached. Follows the site role on a site, and the workspace role in the organization hub, unless a role or member sets it.',
    roleDefaults: { owner: true, admin: true, editor: true, viewer: false },
    hostRoleDefaults: { ...MARKETING_CAMPAIGNS_SITE_ROLE_PRESET },
    group: 'marketing',
    groupLabel: 'Marketing',
    presetFromSiteRole: true,
  },
]

/** The refusal a door answers without it: names the permission, never a role. */
export const MARKETING_CAMPAIGNS_REFUSAL = 'Your role does not include "Run email campaigns" — ask an organization admin'
