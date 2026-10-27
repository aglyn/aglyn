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
  /**
   * The role editor's group for the key in the one permission catalog
   * (AGL-4047): a core group id, or absent for a group of the plugin's own.
   */
  group?: string
  /** The heading of a group of the plugin's own; absent: the plugin's catalog label. */
  groupLabel?: string
  /**
   * A broader key this one is a finer part of (AGL-4047), such as one action
   * of a register the broader key opens. A refining key is never granted
   * while the key it refines is not, and when no custom role or override
   * sets it, it follows that key — so splitting a key into finer ones leaves
   * every member with exactly the access they had. Its `defaults` should be
   * the broader key's.
   */
  refines?: string
  /**
   * A key this one takes its verdict from where no custom role or override
   * sets it, WITHOUT needing it (AGL-4047). Unlike `refines`, it may be
   * granted while that key is refused — buying hardware for a store whose
   * register the member does not work — so a key that stops refining one and
   * follows it instead leaves every member with exactly the access they had,
   * and can then be granted on its own. Its `defaults` should be the followed
   * key's. Ignored on a key that also `refines`.
   */
  follows?: string
}

/**
 * A key, the key it takes its verdict from, and how
 * (`PluginPermission.refines` / `.follows`): a two-entry pair refines its
 * broader key, one marked `'follows'` only follows it.
 */
export type PermissionRefinement = readonly [key: string, refines: string, kind?: 'follows']

/*
 * One registry per process, keyed on `globalThis` under `Symbol.for`, like
 * `plugin-services.ts`. Next compiles the boot file and the route handlers
 * apart, so each can hold its own copy of this module: with the map at module
 * scope, a plugin's keys registered by one copy were absent from the copy
 * `resolveOrgPermissions` read, an absent key reads as refused, and the
 * register's `managePos` gate answered 403 to the site's own owner.
 */
const REGISTRY_KEY = Symbol.for('@aglyn/aglyn:plugin-permissions')

interface PluginPermissionTables {
  permissions: Map<string, PluginPermission>
  listeners: Set<() => void>
  version: { value: number }
}

const globalScope = globalThis as typeof globalThis & {
  [REGISTRY_KEY]?: PluginPermissionTables
}

const tables: PluginPermissionTables =
  globalScope[REGISTRY_KEY] ??
  (globalScope[REGISTRY_KEY] = {
    permissions: new Map(),
    listeners: new Set(),
    version: { value: 0 },
  })
const pluginPermissions = tables.permissions

/*
 * Whoever resolved a permission map before a plugin registered holds a map
 * without that plugin's keys, and a key that is absent reads as refused
 * (AGL-3228). The console's permission provider resolved its map when the
 * member document arrived; on a cold load of a plugin's deep link the
 * plugin's chunk can register AFTER that, so the owner was refused a surface
 * they hold by default until the next full render. So registration is
 * observable, the way `subscribePluginEntitlements` makes the org catalog's
 * registrations observable, and the provider re-reads on every change.
 */
const listeners = tables.listeners

/** Calls `listener` after every registration; answers the unsubscribe. */
export function subscribePluginPermissions(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * A number that changes whenever the registry does — the snapshot for a
 * `useSyncExternalStore` over `subscribePluginPermissions`.
 */
export function pluginPermissionsVersion(): number {
  return tables.version.value
}

function notifyListeners(): void {
  tables.version.value += 1
  for (const listener of [...listeners]) listener()
}

/**
 * Idempotent per key FOR ITS OWNER — the declaring plugin may re-register
 * (hot reload, a second surface, a repeated init) and its entry is replaced.
 *
 * A key already declared by a DIFFERENT plugin is refused (AGL-2484). This
 * map keyed on `permission.key` alone, so a later registration could redeclare
 * someone else's key with its own tier defaults — and these defaults are not
 * cosmetic: `managePos` is enforced server-side in
 * `libs/plugins/commerce/src/lib/server/pos-order.ts`, so moving
 * `defaults.viewer` to `true` hands a viewer the register. Reaching this
 * needs `PLUGIN_REMOTE_SERVER=enabled` (off by default), realm trust and a
 * signature; the registry closing its own door is the cheap part of that
 * stack.
 *
 * Per KEY, not per batch: a bundle that collides on one key still gets the
 * keys that are genuinely its own.
 */
export function registerPluginPermissions(
  permissions: readonly PluginPermission[],
): void {
  for (const permission of permissions) {
    const incumbent = pluginPermissions.get(permission.key)
    if (incumbent !== undefined && incumbent.pluginId !== permission.pluginId) {
      console.error(
        `[plugins] refused permission key "${permission.key}" to ` +
          `"${permission.pluginId}": already declared by ` +
          `"${incumbent.pluginId}"`,
      )
      continue
    }
    pluginPermissions.set(permission.key, permission)
  }
  notifyListeners()
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

/** The refinements the per-tier registry holds (AGL-4047), as declared. */
export function pluginPermissionRefinements(): PermissionRefinement[] {
  const refinements: PermissionRefinement[] = []
  for (const permission of pluginPermissions.values()) {
    const refinement = permissionRefinementOf(permission)
    if (refinement) refinements.push(refinement)
  }
  return refinements
}

/**
 * One declaration's refinement, or null: the key it refines, else the key it
 * follows, never itself. Shared by both declaration APIs' catalogs.
 */
export function permissionRefinementOf(declaration: {
  key: string
  refines?: string
  follows?: string
}): PermissionRefinement | null {
  if (declaration.refines && declaration.refines !== declaration.key) {
    return [declaration.key, declaration.refines]
  }
  if (declaration.follows && declaration.follows !== declaration.key) {
    return [declaration.key, declaration.follows, 'follows']
  }
  return null
}

/**
 * The refinements in the order they must be applied: a key whose broader key
 * is itself a refinement after that one, so a chain settles in one pass. A
 * refinement that loops back on itself is dropped rather than resolved.
 */
function orderRefinements(
  refinements: readonly PermissionRefinement[],
): PermissionRefinement[] {
  const broader = new Map<string, string>(refinements.map(([key, parent]) => [key, parent]))
  const depth = (key: string): number => {
    const seen = new Set<string>()
    let steps = 0
    let current = key
    while (broader.has(current)) {
      if (seen.has(current)) return -1
      seen.add(current)
      current = broader.get(current) as string
      steps += 1
    }
    return steps
  }
  return refinements
    .map((refinement) => ({ refinement, steps: depth(refinement[0]) }))
    .filter((entry) => entry.steps > 0)
    .sort((a, b) => a.steps - b.steps)
    .map((entry) => entry.refinement)
}

/**
 * A resolved permission map with every refining key held to the key it
 * refines (AGL-4047). A refining key is granted only while its broader key
 * is.
 *
 * With `layers` — the stored decisions the map was resolved from, in the
 * order they apply (a custom role's map, then a member's overrides) — a
 * refining key that no layer sets FOLLOWS its broader key: granted exactly
 * when that key is, whatever its own role default says. Without them, the
 * map's own verdict for the key stands, narrowed by the broader key; that is
 * the pass for a map whose refining keys were already resolved with every
 * layer, and then had stored values laid back over them.
 *
 * A key that only FOLLOWS (`'follows'`) takes the followed key's verdict
 * where no layer sets it, and a layer's own value where one does, granted or
 * not, whatever the followed key says. Without layers it is left as the map
 * has it.
 */
export function refinePermissionMap<T extends Record<string, boolean>>(
  map: T,
  refinements: readonly PermissionRefinement[],
  layers?: ReadonlyArray<Readonly<Partial<Record<string, unknown>>> | null | undefined>,
): T {
  if (!refinements.length) return map
  const refined: Record<string, boolean> = { ...map }
  for (const [key, parent, kind] of orderRefinements(refinements)) {
    const held = refined[parent] === true
    if (layers) {
      let stored: boolean | undefined
      for (const layer of layers) {
        const value = layer?.[key]
        if (typeof value === 'boolean') stored = value
      }
      if (kind === 'follows') refined[key] = stored === undefined ? held : stored
      else refined[key] = held && (stored === undefined ? true : stored)
    } else if (kind !== 'follows') {
      refined[key] = held && refined[key] === true
    }
  }
  return refined as T
}
