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
 * runtime from `org.enabledPlugins` (AGL-416). Loading is cached per
 * entry+surface and registration per entry+surface+use, and `ensure` returns
 * a stable promise per (ids, surfaces, use) so React `use()` can suspend on
 * it during SSR — the canvas never renders before its components are
 * registered (the blank-canvas invariant, AGL-52).
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
  /**
   * The module a surface loads from, when it is not `load`'s (AGL-3116).
   *
   * A package entry imported with `import()` is a namespace the loader reads
   * by name, so the bundler keeps every export it has: a site surface loaded
   * from the package root carried the console registrar, its nav objects and
   * its lazy pages onto every published page that used the plugin. A surface
   * with a module of its own carries only what that module exports.
   */
  loads?: Partial<Record<string, () => Promise<Record<string, unknown>>>>
  /**
   * What this plugin declares it contributes, and where (AGL-3142).
   *
   * The loader never reads it: `ensure` is told which plugins to activate and
   * activates them. It rides on the entry because the manifest is the one list
   * of plugins an app holds, and an app that loads by presence has to answer
   * "which of these belongs on this screen" before it names any ids — from
   * data, not by running a plugin, which is the cost being avoided.
   *
   * Written into a manifest whose app reads it and left off the others: the
   * published page decides presence from the nodes it places, so the tenant
   * manifest would carry a declaration nothing there consults.
   */
  contributes?: PluginContributions
}

export type PluginLoadManifest = readonly PluginLoadEntry[]

export interface PluginLoader {
  /**
   * Loads + registers the given plugins' surfaces. `ids` may include unknown
   * ids (marketplace realm plugins — ignored here); manifest entries marked
   * alwaysOn activate regardless of `ids`.
   *
   * `use` is what the surface actually uses (AGL-3141), carried unchanged to
   * every register function: the page computes it, the loader carries it, a
   * plugin reads it or ignores it. Omitting it asks for everything, which is
   * what a surface that cannot narrow must do.
   *
   * A surface registers once per plugin per use context. A second page that
   * places a component the first did not still reaches the plugin, so the
   * element it added has a component to render (AGL-52); one whose use is
   * already covered costs nothing.
   */
  ensure(
    ids: readonly string[],
    surfaces: readonly string[],
    use?: PluginUse,
  ): Promise<void>
  /** Every manifest plugin, for `ensureAll` semantics (server dispatchers). */
  ensureAll(surfaces: readonly string[]): Promise<void>
  /** The plugin owning an api path ('bookings/slots' → 'bookings'). */
  pluginIdForApiPath(path: string): string | undefined
}

/**
 * A register function as the loader calls it: handed the surface's use
 * context, and awaited, because a plugin that imports what the surface uses
 * returns a promise.
 */
type PluginRegisterFn = (use?: PluginUse) => void | Promise<void>

/** What one plugin+surface has already registered for. */
interface RegisteredFor {
  /** It registered with no use context, so it registered all of itself. */
  all: boolean
  /** The component ids it has been handed so far. */
  componentIds: Set<string>
}

// From the leaf module, not the API route registry that re-exports it: this
// loader is on every published page, and the registry is server-only.
import { setRegisteringPluginId } from '../app-utils/registering-plugin'
import type { PluginContributions, PluginUse } from './plugin-contributions'
import { plugins } from '../aglyn'

/** Whether an earlier registration already covers this use context. */
function covers(done: RegisteredFor | undefined, use?: PluginUse): boolean {
  if (!done) return false
  if (done.all) return true
  // An unbounded ask is never covered by a narrow one: the plugin was handed
  // a list, so it registered a list.
  if (!use?.componentIds) return false
  return use.componentIds.every((id) => done.componentIds.has(id))
}

/**
 * A use context as a cache key.
 *
 * Absent is its own key, and a different one from an empty list: a surface
 * that cannot say what it uses asks for everything, where one that places no
 * component asks for nothing.
 */
function keyForUse(use?: PluginUse): string {
  return use?.componentIds ? `c:${[...use.componentIds].sort().join(',')}` : '*'
}

export function createPluginLoader(manifest: PluginLoadManifest): PluginLoader {
  const loads = new Map<string, Promise<Record<string, unknown>>>()
  const registered = new Map<string, RegisteredFor>()
  const bootstrapped = new Set<string>()
  const ensures = new Map<string, Promise<void>>()
  const prefixToId = new Map<string, string>()
  for (const entry of manifest) {
    for (const prefix of entry.apiPrefixes ?? []) prefixToId.set(prefix, entry.id)
  }

  /** The module `surface` registers from, loaded once per module. */
  const loadOnce = (entry: PluginLoadEntry, surface: string) => {
    const own = entry.loads?.[surface]
    const key = own ? `${entry.id}:${surface}` : entry.id
    let promise = loads.get(key)
    if (!promise) {
      promise = own ? own() : entry.load()
      loads.set(key, promise)
    }
    return promise
  }

  /**
   * Fetches what `surfaces` register from, and hands back the registration
   * itself as a step to run later.
   *
   * The two are separated because registration is now AWAITED (AGL-3141): a
   * plugin that imports the components the surface uses returns a promise,
   * and a register fn that yields would otherwise overlap another plugin's —
   * leaving `setRegisteringPluginId` naming the wrong owner for whatever the
   * first one registers after it resumes. Loading still runs for every plugin
   * at once, which is where the time is; only the registrations are ordered.
   */
  const prepare = async (
    entry: PluginLoadEntry,
    surfaces: readonly string[],
  ): Promise<(use?: PluginUse) => Promise<void>> => {
    const wanted = surfaces.filter((surface) => entry.register[surface])
    if (!wanted.length) return async () => undefined
    // Dev-mode load metrics (AGL-436): slow plugins show up in the
    // console instead of hiding inside the gate's total.
    const startedAt = Date.now()
    const modules = await Promise.all(
      wanted.map((surface) => loadOnce(entry, surface)),
    )
    const loadMs = Date.now() - startedAt
    return async (use?: PluginUse) => {
      for (const [index, surface] of wanted.entries()) {
        const mod = modules[index]
        const key = `${entry.id}:${surface}`
        const done = registered.get(key)
        if (covers(done, use)) continue
        registered.set(key, {
          all: done?.all || !use?.componentIds,
          componentIds: new Set([
            ...(done?.componentIds ?? []),
            ...(use?.componentIds ?? []),
          ]),
        })
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
          await (fn as PluginRegisterFn)(use)
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
      for (const surface of wanted) {
        const mod = await loadOnce(entry, surface)
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
    use?: PluginUse,
  ): Promise<void> => {
    // The use context is part of the key, not just of the bookkeeping: a
    // second page that places components the first did not must get its own
    // run, or it would be handed the first page's settled promise and render
    // its extra elements against nothing (AGL-52).
    const key =
      `${[...ids].sort().join(',')}|${[...surfaces].sort().join(',')}` +
      `|${keyForUse(use)}`
    let promise = ensures.get(key)
    if (!promise) {
      const targets = manifest.filter(
        (entry) => entry.alwaysOn || ids.includes(entry.id),
      )
      const run = async (): Promise<void> => {
        const steps = await Promise.all(
          targets.map((entry) => prepare(entry, surfaces)),
        )
        for (const step of steps) await step(use)
        await bootstrap(targets, surfaces)
        warnStuck(targets)
      }
      promise = run()
      // Stamp React's thenable contract (`status`/`value`/`reason`) onto the
      // cached promise once it settles (AGL-1541). `use()` can only unwrap a
      // thenable SYNCHRONOUSLY when it carries a status; a bare native
      // promise — even a resolved one — suspends every first `use()` per
      // render. On the server that suspension pushed the ENTIRE page out of
      // the streamed shell into a late Suspense segment whose reveal and
      // hydration retry both ride on `requestAnimationFrame`, which never
      // fires in hidden/occluded/prerendered tabs — pages that never
      // hydrate, analytics that never fire. With the stamp, any render after
      // the first settle (every warm request; every client render after the
      // chunks load) unwraps inline and never enters that path.
      const tracked = promise as Promise<void> & {
        status?: 'fulfilled' | 'rejected'
        value?: void
        reason?: unknown
      }
      tracked.then(
        () => {
          tracked.status = 'fulfilled'
          tracked.value = undefined
        },
        (reason) => {
          tracked.status = 'rejected'
          tracked.reason = reason
        },
      )
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
