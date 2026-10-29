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
 * EMAIL'S KEYS (AGL-4047).
 *
 * A site's suppression list, and adding people to the organization's
 * marketing lists from a site, asked for the site's Admin or Editor. Those
 * are now keys whose preset is that site role (`presetFromSiteRole`), so
 * every member keeps exactly the access they had, and a custom role, a
 * member's own permissions or a site's toggle can grant or refuse either
 * one. The lists still ask the organization-wide writer beside it.
 */

/** Email's keys whose preset is the site role. */
export type EmailSitePermission = 'email.suppressions' | 'email.lists'

/** Who did each before it was a key: the site's Admin and Editor. */
export const EMAIL_SITE_ROLE_PRESET: Readonly<Record<HostAccessRole, boolean>> = {
  admin: true,
  editor: true,
  author: false,
  viewer: false,
}

/** The keys as the plugin declares them into the org permission catalog. */
export const EMAIL_SITE_PERMISSIONS: readonly PluginOrgPermissionDeclaration[] = [
  {
    key: 'email.suppressions',
    label: 'Manage the site’s suppressions',
    description:
      'Add addresses to the site’s suppression list and check addresses against it. Follows the site role unless a role or member sets it.',
    roleDefaults: { owner: true, admin: true, editor: true, viewer: false },
    hostRoleDefaults: { ...EMAIL_SITE_ROLE_PRESET },
    group: 'email',
    groupLabel: 'Email',
    presetFromSiteRole: true,
  },
  {
    key: 'email.lists',
    label: 'Add people to marketing lists from a site',
    description:
      'Add and remove people on the organization’s marketing lists from a site (only for a member of the whole workspace who may write its lists, as the lists are the organization’s). Follows the site role unless a role or member sets it.',
    roleDefaults: { owner: true, admin: true, editor: true, viewer: false },
    hostRoleDefaults: { ...EMAIL_SITE_ROLE_PRESET },
    group: 'email',
    groupLabel: 'Email',
    presetFromSiteRole: true,
  },
]

/** The refusal a door answers without one: names the permission, never a role. */
export function emailSitePermissionRefusal(key: EmailSitePermission): string {
  const label = EMAIL_SITE_PERMISSIONS.find((entry) => entry.key === key)?.label ?? key
  return `Your role does not include "${label}" — ask an organization admin`
}
