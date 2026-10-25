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

import { filterPluginsByReleaseFlags, resolveEnabledPlugins } from '../plugin-manager/enabled-plugins'
import { ORG_PERMISSIONS, type OrgPermissionDefinition } from './org-permissions'

/**
 * What a permission editor offers, as logic (AGL-4047): which catalog keys a
 * workspace is shown, filed under which group, narrowed by a search, and the
 * three states a custom role or a per-member override stores for each.
 * Every editor (the custom role dialog, a member's Permissions section, the
 * roster's quick view) reads these, so they cannot offer different keys.
 */

/** Whose keys are offered: the workspace's plugins, after their release flags. */
export interface OfferedPermissionsSubject {
  /** The workspace document; its `enabledPlugins` decides which plugins' keys show. */
  org?: { enabledPlugins?: string[] } | null
  /** A release flag's verdict for the workspace; absent: no plugin is held back by a flag. */
  isFlagOn?: (flagKey: string) => boolean
  /** Staff preview: every enabled plugin's keys, flags or not. */
  staffBypass?: boolean
}

/**
 * The catalog keys a workspace is offered: every core key, and a plugin's
 * keys while the plugin is on for the workspace and released to it. A key a
 * stored role or override already carries for a plugin that is now off is
 * not offered and not dropped: the editors write back the stored map.
 */
export function offeredOrgPermissions(
  subject: OfferedPermissionsSubject = {},
  definitions: readonly OrgPermissionDefinition[] = ORG_PERMISSIONS,
): OrgPermissionDefinition[] {
  const enabled = resolveEnabledPlugins(subject.org ?? null)
  const on = new Set(
    subject.isFlagOn
      ? filterPluginsByReleaseFlags(enabled, subject.isFlagOn, { staffBypass: subject.staffBypass })
      : enabled,
  )
  return definitions.filter((definition) => !definition.pluginId || on.has(definition.pluginId))
}
