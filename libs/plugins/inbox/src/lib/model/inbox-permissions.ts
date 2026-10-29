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
 * THE INBOX'S KEYS (AGL-4047).
 *
 * Replying to a form submission, and adding its person to the organization's
 * lists, asked for the site's Admin or Editor. Those are now keys whose
 * preset is that site role (`presetFromSiteRole`), so every member keeps
 * exactly the access they had, and a custom role, a member's own permissions
 * or a site's toggle can grant or refuse either one. Adding to a list still
 * asks the organization-wide writer beside it.
 */

/** Inbox's keys whose preset is the site role. */
export type InboxSitePermission = 'inbox.reply' | 'inbox.assign'

/** Who did each before it was a key: the site's Admin and Editor. */
export const INBOX_SITE_ROLE_PRESET: Readonly<Record<HostAccessRole, boolean>> = {
  admin: true,
  editor: true,
  author: false,
  viewer: false,
}

/** The keys as the plugin declares them into the org permission catalog. */
export const INBOX_SITE_PERMISSIONS: readonly PluginOrgPermissionDeclaration[] = [
  {
    key: 'inbox.reply',
    label: 'Reply from the inbox',
    description:
      'Reply by email to a form submission in the site’s inbox. Follows the site role unless a role or member sets it.',
    roleDefaults: { owner: true, admin: true, editor: true, viewer: false },
    hostRoleDefaults: { ...INBOX_SITE_ROLE_PRESET },
    group: 'inbox',
    groupLabel: 'Inbox',
    presetFromSiteRole: true,
  },
  {
    key: 'inbox.assign',
    label: 'Add people to lists from the inbox',
    description:
      'Add the person behind a form submission to the organization’s marketing lists (members of the whole workspace who may write its lists only). Follows the site role unless a role or member sets it.',
    roleDefaults: { owner: true, admin: true, editor: true, viewer: false },
    hostRoleDefaults: { ...INBOX_SITE_ROLE_PRESET },
    group: 'inbox',
    groupLabel: 'Inbox',
    presetFromSiteRole: true,
  },
]

/** The refusal a door answers without one: names the permission, never a role. */
export function inboxSitePermissionRefusal(key: InboxSitePermission): string {
  const label = INBOX_SITE_PERMISSIONS.find((entry) => entry.key === key)?.label ?? key
  return `Your role does not include "${label}" — ask an organization admin`
}
