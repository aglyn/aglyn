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

import type { PluginPermission } from '@aglyn/aglyn/plugin-manager/plugin-permissions'

/*
 * THE CRM'S SETTINGS FOR THE WHOLE WORKSPACE (AGL-4047).
 *
 * Every card under CRM → Settings that changes what the CRM does for every
 * site (default sharing for new records, creating companies from email
 * domains, default owners, assignment rules, the round-robin pool, the
 * sharing rules), rotating the capture address, and sharing a record with
 * other sites asked whether the member's workspace role was owner or admin:
 * the cards through `canManageOrg(role)`, the routes through
 * `authorizeOrgCaller(…, 'manage-org')` and `canRotate`, and the rules on the
 * workspace document's `crm` map through `canManageOrg()`. Each now asks this
 * key, whose default is exactly those roles (the owner on the admin tier), so
 * nobody's access moved, and a custom role or a member's own permissions can
 * grant or refuse it.
 *
 * Declared through `registerPluginPermissions`, as Sequences and the
 * marketplace's publisher keys are: a key of that registry joins the one
 * catalog, so the role editor offers it and the resolver, the console and the
 * native contracts answer it alike.
 *
 * Type-only imports: the native contracts generator assembles this into
 * `ORG_ROLE_GRANTS`.
 */

/** The CRM's workspace keys. */
export type CrmPermission = 'crm.settings'

/** "Change CRM settings". */
export const CRM_SETTINGS_PERMISSION: CrmPermission = 'crm.settings'

/** The keys as the plugin declares them; owners and admins hold it by default. */
export const CRM_PERMISSIONS: readonly PluginPermission[] = [
  {
    key: 'crm.settings',
    pluginId: 'crm',
    label: 'Change CRM settings',
    description:
      'Change the CRM’s settings for every site: default sharing for new records, companies from email domains, default owners, assignment rules and the round-robin pool, sharing rules, and rotating the email capture address; and share records with other sites.',
    defaults: { admin: true, editor: false, viewer: false },
    groupLabel: 'CRM',
  },
]

/** The refusal a door or a control answers without it: names the permission, never a role. */
export function crmSettingsPermissionRefusal(): string {
  const label = CRM_PERMISSIONS.find((entry) => entry.key === CRM_SETTINGS_PERMISSION)?.label ?? CRM_SETTINGS_PERMISSION
  return `Your role does not include "${label}" — ask an organization admin`
}
