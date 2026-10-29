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

import type { PluginOrgPermissionDeclaration } from '@aglyn/aglyn/plugin-manager/plugin-entitlements'

/*
 * DOMAINS' KEY (AGL-4047).
 *
 * The workspace's own domains (buying, transferring in, unlocking, contacts
 * and DNS, with no site named) were the workspace owner's and admins'. That
 * is now "Manage the workspace's domains", whose default is exactly those
 * roles, so nobody's access moves, and a custom role or a member's own
 * permissions can grant or refuse it. A site's domains stay "Manage site
 * settings" (`site.manage`), and paying for one still asks
 * "Manage billing".
 */

/** Domains' keys. */
export type DomainsPermission = 'domains.manage'

/** The key as the plugin declares it into the org permission catalog. */
export const DOMAINS_PERMISSIONS: readonly PluginOrgPermissionDeclaration[] = [
  {
    key: 'domains.manage',
    label: 'Manage the workspace’s domains',
    description:
      'Buy, transfer in, unlock and renew the workspace’s domains, and change their contacts and DNS. Paying for one also needs "Manage billing".',
    roleDefaults: { owner: true, admin: true, editor: false, viewer: false },
    group: 'domains',
    groupLabel: 'Domains',
  },
]

/** The refusal a door answers without it: names the permission, never a role. */
export const DOMAINS_MANAGE_REFUSAL =
  'Your role does not include "Manage the workspace’s domains" — ask an organization admin'
