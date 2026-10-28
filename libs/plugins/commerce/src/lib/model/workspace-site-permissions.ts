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
 * REFUNDS, THE REGISTER'S APPROVALS AND ORDER WEBHOOKS (AGL-4047).
 *
 * Refunding an order, approving a refund over the register's limit (and
 * setting other staff members' PINs), and managing order webhooks asked for
 * an admin of the WHOLE workspace who is also the site's admin (`refund.ts`,
 * AGL-2372): a site's Members card can make a contractor the admin of one
 * site, which writes the same `'admin'` into `memberRoles` as an owner's, and
 * none of these were ever theirs. They are now keys whose preset is the site
 * role for members of the whole workspace only (`workspaceMembersOnly`): the
 * site's Admin among them, and nobody added to just that site unless the
 * site grants it. A custom role, a member's own permissions or the site's
 * toggle grants or refuses each one.
 *
 * Their own module, not `plugin-permissions.ts`: the storefront imports that
 * one, and only the declarations and the server doors read these.
 */

/** Commerce's keys whose site-role preset holds for members of the whole workspace only. */
export type CommerceWorkspaceSitePermission = 'commerce.refunds' | 'commerce.posApprovals' | 'commerce.webhooks'

/** The site Admin, read for members of the whole workspace only. */
export const WORKSPACE_ADMIN_SITE_ROLE_PRESET: Readonly<Record<HostAccessRole, boolean>> = {
  admin: true,
  editor: false,
  author: false,
  viewer: false,
}

/** Who holds each before anyone sets it, as its description ends. */
const HOLDS =
  'A member of the whole workspace who is the site’s admin holds it unless a role or member sets it; someone added to just this site holds it only when the site grants it.'

/** The keys as commerce declares them, after `COMMERCE_SITE_PERMISSIONS`. */
export const COMMERCE_WORKSPACE_SITE_PERMISSIONS: readonly PluginOrgPermissionDeclaration[] = [
  {
    key: 'commerce.refunds',
    label: 'Refund orders',
    description: `Refund any order, online or at the register, in full or in part, with no register limit. ${HOLDS}`,
    roleDefaults: { owner: true, admin: true, editor: false, viewer: false },
    hostRoleDefaults: { ...WORKSPACE_ADMIN_SITE_ROLE_PRESET },
    group: 'commerce',
    groupLabel: 'Commerce',
    presetFromSiteRole: true,
    workspaceMembersOnly: true,
  },
  {
    key: 'commerce.posApprovals',
    label: 'Approve refunds over the register’s limit',
    description: `Refund at the register above its refund limit, approve a cashier’s refund over it with a PIN, and set or clear other staff members’ PINs. ${HOLDS}`,
    roleDefaults: { owner: true, admin: true, editor: false, viewer: false },
    hostRoleDefaults: { ...WORKSPACE_ADMIN_SITE_ROLE_PRESET },
    group: 'commerce',
    groupLabel: 'Commerce',
    presetFromSiteRole: true,
    workspaceMembersOnly: true,
  },
  {
    key: 'commerce.webhooks',
    label: 'Manage order webhooks',
    description: `Add, change, test and remove the store’s order webhooks, roll their secrets and resend deliveries. ${HOLDS}`,
    roleDefaults: { owner: true, admin: true, editor: false, viewer: false },
    hostRoleDefaults: { ...WORKSPACE_ADMIN_SITE_ROLE_PRESET },
    group: 'commerce',
    groupLabel: 'Commerce',
    presetFromSiteRole: true,
    workspaceMembersOnly: true,
  },
]

/** The refusal a door answers when one of these keys is not held: names the permission, never a role. */
export function commerceWorkspacePermissionRefusal(key: CommerceWorkspaceSitePermission): string {
  const label = COMMERCE_WORKSPACE_SITE_PERMISSIONS.find((entry) => entry.key === key)?.label ?? key
  return `Your role does not include "${label}" — ask an organization admin`
}
