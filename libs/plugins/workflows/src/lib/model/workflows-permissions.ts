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
 * WORKFLOWS' KEYS (AGL-4047).
 *
 * The organization's automations were written by an owner, admin or editor
 * of the whole workspace, and paused on one site by that site's Admin or
 * Editor (or by one of the workspace's managers). Those are now keys:
 * "Manage org automations", whose default is the workspace role, and "Pause
 * org automations on a site", whose preset is the site role
 * (`presetFromSiteRole`). Every member keeps exactly the access they had,
 * and a custom role, a member's own permissions or a site's toggle can grant
 * or refuse either one.
 */

/** Workflows' keys. */
export type WorkflowsPermission = 'workflows.orgAutomations' | 'workflows.sitePause'

/** Who paused an org automation on a site before it was a key: the site's Admin and Editor. */
export const WORKFLOWS_SITE_PAUSE_PRESET: Readonly<Record<HostAccessRole, boolean>> = {
  admin: true,
  editor: true,
  author: false,
  viewer: false,
}

/** The keys as the plugin declares them into the org permission catalog. */
export const WORKFLOWS_PERMISSIONS: readonly PluginOrgPermissionDeclaration[] = [
  {
    key: 'workflows.orgAutomations',
    label: 'Manage org automations',
    description:
      'Create, change, switch on and off, remove and import the organization’s automations. Members of the whole workspace only.',
    roleDefaults: { owner: true, admin: true, editor: true, viewer: false },
    group: 'workflows',
    groupLabel: 'Workflows',
  },
  {
    key: 'workflows.sitePause',
    label: 'Pause org automations on a site',
    description:
      'Pause or resume one of the organization’s automations on a site. Follows the site role unless a role or member sets it; "Manage org automations" also allows it.',
    roleDefaults: { owner: true, admin: true, editor: true, viewer: false },
    hostRoleDefaults: { ...WORKFLOWS_SITE_PAUSE_PRESET },
    group: 'workflows',
    groupLabel: 'Workflows',
    presetFromSiteRole: true,
  },
]

/** The refusal a door answers without one: names the permission, never a role. */
export function workflowsPermissionRefusal(key: WorkflowsPermission): string {
  const label = WORKFLOWS_PERMISSIONS.find((entry) => entry.key === key)?.label ?? key
  return `Your role does not include "${label}" — ask an organization admin`
}
