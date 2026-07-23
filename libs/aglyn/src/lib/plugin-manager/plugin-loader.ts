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
 * Dynamic plugin activation (AGL-417). Apps never import @aglyn/plugins-*;
 * they hand this loader a GENERATED manifest of `() => import(...)` thunks
 * (see tools/scripts/generate-plugin-manifests.mjs) and activate plugins at
 * runtime from `org.enabledPlugins` (AGL-416). Loading and registration are
 * cached per entry+surface, and `ensure` returns a stable promise per
 * (ids, surfaces) so React `use()` can suspend on it during SSR — the canvas
 * never renders before its components are registered (the blank-canvas
 * invariant, AGL-52).
 */

export interface PluginLoadEntry {
  /** Stable plugin id — matches FIRST_PARTY_PLUGINS / org.enabledPlugins. */
  id: string
  /** Loaded regardless of the org switchboard (base components). */
  alwaysOn?: boolean
  /** `/api/<prefix>/...` paths this plugin's handlers own (server gate). */
  apiPrefixes?: string[]
  /** surface → exported register-fn name on the loaded module. */
  register: Partial<Record<string, string>>
  load: () => Promise<Record<string, unknown>>
}

export type PluginLoadManifest = readonly PluginLoadEntry[]

export interface PluginLoader {
  /**
   * Loads + registers the given plugins' surfaces (once each). `ids` may
   * include unknown ids (marketplace realm plugins — ignored here); manifest
   * entries marked alwaysOn activate regardless of `ids`.
   */
  ensure(ids: readonly string[], surfaces: readonly string[]): Promise<void>
  /** Every manifest plugin, for `ensureAll` semantics (server dispatchers). */
  ensureAll(surfaces: readonly string[]): Promise<void>
  /** The plugin owning an api path ('bookings/slots' → 'bookings'). */
  pluginIdForApiPath(path: string): string | undefined
}

import { setRegisteringPluginId } from '../app-utils/api-plugins'
import { plugins } from '../aglyn'

export function createPluginLoader(manifest: PluginLoadManifest): PluginLoader {
  const loads = new Map<string, Promise<Record<string, unknown>>>()
  const registered = new Set<string>()
  const bootstrapped = new Set<string>()
  const ensures = new Map<string, Promise<void>>()
  const prefixToId = new Map<string, string>()
  for (const entry of manifest) {
    for (const prefix of entry.apiPrefixes ?? []) prefixToId.set(prefix, entry.id)
  }

  const loadOnce = (entry: PluginLoadEntry) => {
    let promise = loads.get(entry.id)
    if (!promise) {
      promise = entry.load()
      loads.set(entry.id, promise)
    }
    return promise
  }

  const activate = async (
    entry: PluginLoadEntry,
    surfaces: readonly string[],
  ) => {
    const wanted = surfaces.filter((surface) => entry.register[surface])
    if (!wanted.length) return
    // Dev-mode load metrics (AGL-436): slow plugins show up in the
    // console instead of hiding inside the gate's total.
    const startedAt = Date.now()
    const mod = await loadOnce(entry)
    const loadMs = Date.now() - startedAt
    for (const surface of wanted) {
      const key = `${entry.id}:${surface}`
      if (registered.has(key)) continue
      registered.add(key)
      const fnName = entry.register[surface] as string
      const fn = mod[fnName]
      if (typeof fn !== 'function') {
        // A manifest/plugin drift bug — surface loudly, don't crash the app.
        console.error(`plugin ${entry.id}: missing register fn ${fnName}`)
        continue
      }
      // Mark ownership while the register fn runs so registerPluginApiRoute
      // records exact path→plugin attribution for the per-org gate.
      setRegisteringPluginId(entry.id)
      try {
        ;(fn as () => void)()
      } finally {
        setRegisteringPluginId(undefined)
      }
    }
    if (process.env.NODE_ENV !== 'production') {
      console.debug(
        `[plugin-loader] ${entry.id} [${wanted.join(',')}] ` +
          `load ${loadMs}ms, total ${Date.now() - startedAt}ms`,
      )
    }
  }

  /**
   * Bootstrap phase (AGL-429, Strapi register→bootstrap parity): after
   * EVERY plugin in an ensure batch has registered a surface, each loaded
   * module's optional `bootstrap<Surface>()` export runs (manifest order,
   * once per plugin+surface) — the sanctioned place for cross-plugin
   * wiring, because by then the other plugins' registrations are in the
   * registries. Plugins loaded by a LATER ensure bootstrap in that batch;
   * wiring must therefore tolerate registrations that arrive afterwards
   * (prefer lazy list*() reads over captured snapshots).
   */
  const bootstrap = async (
    targets: readonly PluginLoadEntry[],
    surfaces: readonly string[],
  ): Promise<void> => {
    for (const entry of targets) {
      const wanted = surfaces.filter((surface) => entry.register[surface])
      if (!wanted.length) continue
      const mod = await loadOnce(entry)
      for (const surface of wanted) {
        const key = `${entry.id}:${surface}`
        if (bootstrapped.has(key)) continue
        bootstrapped.add(key)
        const fnName = `bootstrap${surface[0].toUpperCase()}${surface.slice(1)}`
        const fn = mod[fnName]
        if (typeof fn !== 'function') continue
        setRegisteringPluginId(entry.id)
        try {
          ;(fn as () => void)()
        } catch (error) {
          // A broken bootstrap must not take the surface down.
          console.error(`plugin ${entry.id}: ${fnName} failed`, error)
        } finally {
          setRegisteringPluginId(undefined)
        }
      }
    }
  }

  /**
   * After a batch settles, any target still WAITING is stuck: a dependency it
   * declared was never activated, so its register fn never ran and its
   * besigner category is empty (AGL-759). Before the reverse-dependency fix
   * this was silent — say so now, naming the bundle and what it waited on, so
   * the failure is a console line rather than a mysteriously empty drawer.
   */
  const warnStuck = (targets: readonly PluginLoadEntry[]): void => {
    const targetIds = new Set(targets.map((entry) => entry.id))
    for (const { id, waitingOn } of plugins.getStuckDependencies()) {
      if (!targetIds.has(id)) continue
      console.warn(
        `[plugin-loader] ${id} is stuck WAITING on ` +
          `${waitingOn.join(', ') || 'an unregistered dependency'} — its ` +
          'components never registered, so its besigner category will be ' +
          'empty. Check that the dependency is in the manifest and activated ' +
          '(AGL-759).',
      )
    }
  }

  const ensure = (
    ids: readonly string[],
    surfaces: readonly string[],
  ): Promise<void> => {
    const key = `${[...ids].sort().join(',')}|${[...surfaces].sort().join(',')}`
    let promise = ensures.get(key)
    if (!promise) {
      const targets = manifest.filter(
        (entry) => entry.alwaysOn || ids.includes(entry.id),
      )
      const run = async (): Promise<void> => {
        await Promise.all(targets.map((entry) => activate(entry, surfaces)))
        await bootstrap(targets, surfaces)
        warnStuck(targets)
      }
      promise = run()
      ensures.set(key, promise)
    }
    return promise
  }

  return {
    ensure,
    ensureAll: (surfaces) =>
      ensure(
        manifest.map((entry) => entry.id),
        surfaces,
      ),
    pluginIdForApiPath: (path) => {
      const prefix = path.replace(/^\/+/, '').split('/')[0] ?? ''
      return prefixToId.get(prefix)
    },
  }
}
