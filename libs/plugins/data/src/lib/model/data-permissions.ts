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
 * WHO MAY DO WHAT TO A DATASET (AGL-4047). Roles are only presets of these.
 *
 * A dataset placed on exactly one site belongs to that site, and its writes
 * answer to that site's verdict as well as the workspace's (`site-placement` in
 * the platform core is the verdict):
 *
 *   - "Manage this site's data" and "Delete this site's datasets" are the site's
 *     verdict. For a member of the whole workspace each follows its workspace
 *     key ("Manage data", "Delete workspace records"), so a role or a member
 *     deciding those decides these. A site that narrows an editor to Author or
 *     Viewer takes them there, unless the member keeps them ("Keep this
 *     permission") or the site grants them back. A site that raises a viewer to
 *     Admin or Editor gives them. A site collaborator holds them by their site
 *     role, refined by the site's toggle.
 *   - Holding the workspace key still admits, on any site that does not narrow
 *     the member, so a collaborator handed "Manage data" keeps what it gave them.
 *
 * A dataset on every site or on several answers to the workspace key alone: no
 * one site can be asked, and a rule cannot look through a list of them.
 *
 * Three doors ask this, and must keep answering alike: the rule's
 * `canWriteDatasetOn` (`firebase-firestore.rules`), the routes through
 * `dataset-access.server.ts`, and the console through `use-dataset-writes-blocked`.
 */

/** The workspace key on creating and writing datasets, which also covers the CRM and lists. */
export const DATA_MANAGE_PERMISSION = 'data.manage'
/** The workspace key on deleting a whole dataset, which also covers contacts and lists. */
export const DATA_ERASE_PERMISSION = 'org.eraseRecords'
/** The site's verdict on writing a dataset placed on that site alone. */
export const DATA_SITE_MANAGE_PERMISSION = 'data.siteManage'
/** The site's verdict on deleting a dataset placed on that site alone. */
export const DATA_SITE_DELETE_PERMISSION = 'data.siteDelete'
/** Reading a dataset's records. */
export const DATA_VIEW_RECORDS_PERMISSION = 'data.viewRecords'
/** Taking a dataset's records out as a file. */
export const DATA_EXPORT_PERMISSION = 'data.export'

/** Who holds the site's verdict by their access to it: the site's Admin and Editor. */
export const DATA_SITE_ROLE_PRESET: Readonly<Record<HostAccessRole, boolean>> = {
  admin: true,
  editor: true,
  author: false,
  viewer: false,
}

const WORKSPACE_WRITERS = { owner: true, admin: true, editor: true, viewer: false } as const
const EVERY_ROLE = { owner: true, admin: true, editor: true, viewer: true } as const

/** The keys as this plugin declares them into the permission catalog. */
export const DATA_PERMISSIONS: readonly PluginOrgPermissionDeclaration[] = [
  {
    key: DATA_SITE_MANAGE_PERMISSION,
    label: 'Manage this site’s data',
    description:
      'Change the schema and records of a dataset placed on this site alone, and import into it. Follows “Manage data” for a member of the whole workspace.',
    roleDefaults: WORKSPACE_WRITERS,
    hostRoleDefaults: DATA_SITE_ROLE_PRESET,
    group: 'datasets',
    follows: DATA_MANAGE_PERMISSION,
    narrowsPerSite: { editor: true },
    raisesPerSite: true,
  },
  {
    key: DATA_SITE_DELETE_PERMISSION,
    label: 'Delete this site’s datasets',
    description:
      'Delete a dataset placed on this site alone, with its records. Follows “Delete workspace records” for a member of the whole workspace.',
    roleDefaults: WORKSPACE_WRITERS,
    hostRoleDefaults: DATA_SITE_ROLE_PRESET,
    group: 'datasets',
    follows: DATA_ERASE_PERMISSION,
    narrowsPerSite: { editor: true },
    raisesPerSite: true,
  },
  {
    key: DATA_VIEW_RECORDS_PERMISSION,
    label: 'View dataset records',
    description: 'Read the records of the datasets this member can see. Published sites show records either way.',
    roleDefaults: EVERY_ROLE,
    group: 'datasets',
  },
  {
    key: DATA_EXPORT_PERMISSION,
    label: 'Export data',
    description: 'Take the records of the datasets this member can see out as a file. Needs “View dataset records”.',
    roleDefaults: EVERY_ROLE,
    group: 'datasets',
    refines: DATA_VIEW_RECORDS_PERMISSION,
  },
]
