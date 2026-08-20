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

/**
 * Plugin-declared permissions (AGL-435, Strapi RBAC-actions parity): a
 * plugin contributes NAMED permission keys with per-role-tier defaults.
 * `resolveRolePermissions` spreads them into every resolved set (custom
 * roles override key-by-key exactly like built-in keys), so
 * `ConsolePluginPageProps.permissions` and API-side resolution carry them
 * with zero app changes. Register at module scope from both the client
 * barrel and the /server entry (the AGL-428 pattern).
 */

export interface PluginPermission {
  /** Stable key ('managePos') — persisted in custom role docs. */
  key: string
  pluginId: string
  label: string
  description?: string
  /** Verdict per built-in role tier when a role doesn't name the key. */
  defaults: { admin: boolean; editor: boolean; viewer: boolean }
}

const pluginPermissions = new Map<string, PluginPermission>()

/** Idempotent per key — re-registration replaces the entry. */
export function registerPluginPermissions(
  permissions: readonly PluginPermission[],
): void {
  for (const permission of permissions) {
    pluginPermissions.set(permission.key, permission)
  }
}

export function listPluginPermissions(): PluginPermission[] {
  return [...pluginPermissions.values()]
}

/**
 * The registered keys alone (AGL-2474). `resolveRolePermissions` needs the
 * grantable key SPACE, not the tier verdicts: it used to iterate
 * `ORG_ROLE_PERMISSION_KEYS` — the legacy six — when applying overrides and
 * custom roles, so a plugin-declared key materialised into the resolved map
 * and could then only ever hold its tier default. Read live rather than
 * snapshotted: registration happens at plugin module scope, which can run
 * after any module-level constant here has already been evaluated.
 */
export function listPluginPermissionKeys(): string[] {
  return [...pluginPermissions.keys()]
}

/** Tier defaults for every registered plugin permission. */
export function pluginPermissionDefaults(
  tier: 'admin' | 'editor' | 'viewer',
): Record<string, boolean> {
  const defaults: Record<string, boolean> = {}
  for (const permission of pluginPermissions.values()) {
    defaults[permission.key] = permission.defaults[tier]
  }
  return defaults
}
