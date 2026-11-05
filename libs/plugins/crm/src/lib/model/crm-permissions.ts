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

/** The CRM's workspace keys, declared by tier. */
export type CrmPermission = 'crm.settings' | 'crm.colleagueTemplates'

/** "Change CRM settings". */
export const CRM_SETTINGS_PERMISSION: CrmPermission = 'crm.settings'

/**
 * "Change colleagues' email templates": the one rule branch that lets a member
 * change or delete a personal template someone else keeps. It asked only whether
 * the member spans the workspace, on top of the "Manage data" every template
 * write asks, so every role holds this by default and those two questions still
 * decide who reaches it: nobody's access moved, and a custom role or a member's
 * own permissions can now refuse it. No route or console control asks it. A
 * colleague's personal template is listed to nobody but its owner.
 */
export const CRM_COLLEAGUE_TEMPLATES_PERMISSION: CrmPermission = 'crm.colleagueTemplates'

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
  {
    key: 'crm.colleagueTemplates',
    pluginId: 'crm',
    label: 'Change colleagues’ email templates',
    description:
      'Change or delete an email template or snippet a colleague keeps for themselves, or re-file any template. Asks “Manage data” over the whole workspace as well; a site collaborator never holds it.',
    defaults: { admin: true, editor: true, viewer: true },
    groupLabel: 'CRM',
  },
]

/** The refusal a door or a control answers without it: names the permission, never a role. */
export function crmSettingsPermissionRefusal(): string {
  const label = CRM_PERMISSIONS.find((entry) => entry.key === CRM_SETTINGS_PERMISSION)?.label ?? CRM_SETTINGS_PERMISSION
  return `Your role does not include "${label}" — ask an organization admin`
}

/*
 * MOVING A CONTACT OR A DEAL BETWEEN STAGES (AGL-4047).
 *
 * Both stage routes asked for the Admin or Editor role on the site they were
 * called for, and at the organization hub for "Manage data" over the whole
 * workspace. That is now this key, read two ways so every member keeps exactly
 * the access they had:
 *
 *   - ON A SITE its preset is the member's role there (`presetFromSiteRole`):
 *     the site's Admin and Editor, for a collaborator and a member of the whole
 *     workspace alike. A site that narrows an editor to Author refuses them
 *     and one that makes a viewer its Editor admits them, as the role check
 *     did. That preset already follows every site's access, so the key offers
 *     no separate narrowing control and declares no `narrowsPerSite`.
 *   - WITH NO SITE NAMED, at the organization hub, it follows "Manage data"
 *     until a custom role or a member's own permissions set it, because that
 *     key is what the hub's door asked. A custom role that decided "Manage
 *     data" keeps deciding it there, and this key can then refuse the hub's
 *     stage moves on its own.
 *
 * Moving a deal still asks "Manage data" as well, at both levels, as it did
 * before this key: a deal is read through that key anyway.
 */

/** The key both stage routes ask. */
export const CRM_MOVE_STAGES_PERMISSION = 'crm.moveStages'

/** Who moved a site's contacts and deals before it was a key: the site's Admin and Editor. */
export const CRM_MOVE_STAGES_SITE_ROLE_PRESET: Readonly<Record<HostAccessRole, boolean>> = {
  admin: true,
  editor: true,
  author: false,
  viewer: false,
}

/** The CRM's site key, as the plugin declares it into the org permission catalog. */
export const CRM_SITE_PERMISSIONS: readonly PluginOrgPermissionDeclaration[] = [
  {
    key: 'crm.moveStages',
    label: 'Move contacts and deals between stages',
    description:
      'Change a contact’s lifecycle stage and move a deal through its pipeline, including winning, losing and reopening it. Follows the site role on a site, and “Manage data” in the organization hub, unless a role or member sets it.',
    roleDefaults: { owner: true, admin: true, editor: true, viewer: false },
    hostRoleDefaults: { ...CRM_MOVE_STAGES_SITE_ROLE_PRESET },
    follows: 'data.manage',
    group: 'crm',
    groupLabel: 'CRM',
    presetFromSiteRole: true,
  },
]

/** The refusal a stage door or control answers without it: names the permission, never a role. */
export const CRM_MOVE_STAGES_REFUSAL =
  'Your role does not include "Move contacts and deals between stages" — ask an organization admin'
