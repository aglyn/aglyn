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

import type { PluginPermission } from '@aglyn/aglyn'

/**
 * The persisted plugin id (AGL-2974): stored in `org.enabledPlugins`, named in
 * `plugins.config.json` and `FIRST_PARTY_PLUGINS`, and the owner of every
 * `outreach/*` API route. Renaming it is a data change.
 */
export const OUTREACH_PLUGIN_ID = 'outreach'

/**
 * The permission that opens Outreach.
 *
 * Dotted like the catalog's keys but declared by this plugin, so the console
 * answers it from the resolved permission map and a custom role or a
 * per-member override stores it by this exact string. The Firestore rules
 * read the same string off the member's stamped `resolvedPermissions`.
 */
export const OUTREACH_USE_PERMISSION = 'outreach.use'

/**
 * Outreach's plugin-declared permissions (AGL-435 registry). Registered by
 * both halves, so the console gate and a route's resolution agree.
 *
 * Owners and admins hold it by default — `owner` resolves onto the admin
 * tier — and editors and viewers do not: a sequence sends mail as a person
 * from their own mailbox, which is a decision for the people who run the
 * workspace to hand out, one member or one custom role at a time.
 */
export const OUTREACH_PERMISSIONS: readonly PluginPermission[] = [
  {
    key: OUTREACH_USE_PERMISSION,
    pluginId: OUTREACH_PLUGIN_ID,
    label: 'Use Outreach',
    description:
      'Open Outreach, and work sequences and connected mailboxes.',
    defaults: { admin: true, editor: false, viewer: false },
  },
]
