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
 * FUNNELS' KEY (AGL-4047).
 *
 * Changing what a site measures, its funnels, was the site Admin's and
 * Editor's: an Author edits content and does not decide what the site
 * measures. That is now "Manage funnels", whose preset is that site role
 * (`presetFromSiteRole`), so every member keeps exactly the access they had,
 * and a custom role, a member's own permissions or a site's toggle can grant
 * or refuse it. Reading a site's funnels stays with everyone on the site.
 */

/** Funnels' keys whose preset is the site role. */
export type FunnelsSitePermission = 'funnels.manage'

/** Who changed a site's funnels before it was a key: the site's Admin and Editor. */
export const FUNNELS_MANAGE_SITE_ROLE_PRESET: Readonly<Record<HostAccessRole, boolean>> = {
  admin: true,
  editor: true,
  author: false,
  viewer: false,
}

/** The key as the plugin declares it into the org permission catalog. */
export const FUNNELS_SITE_PERMISSIONS: readonly PluginOrgPermissionDeclaration[] = [
  {
    key: 'funnels.manage',
    label: 'Manage funnels',
    description:
      'Create, change and remove a site’s funnels, and draft them with AI. Follows the site role unless a role or member sets it.',
    roleDefaults: { owner: true, admin: true, editor: true, viewer: false },
    hostRoleDefaults: { ...FUNNELS_MANAGE_SITE_ROLE_PRESET },
    group: 'funnels',
    groupLabel: 'Funnels',
    presetFromSiteRole: true,
  },
]

/** The refusal a door answers without it: names the permission, never a role. */
export const FUNNELS_MANAGE_REFUSAL = 'Your role does not include "Manage funnels" — ask an organization admin'
