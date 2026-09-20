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
 * A plugin's code reaches a published page only where the page uses it
 * (AGL-3116). The measurement and the verdict behind
 * `check-plugins-load-where-used.mjs`; the forced reds are in its test file.
 *
 * ## What it reads
 *
 * The published route's BEFORE-SETTLE chunks, the same set
 * `check:tenant-wire-weight` budgets: the eager chunks plus the chunks the
 * dynamic imports declared in `tools/tenant-wire-budget.json` pull. Then each
 * chunk's source map names the original modules inside it, and every module
 * under `libs/plugins/<id>/` is a plugin's code on a published page.
 *
 * Reading the BUILD rather than the source graph is the whole point. Every
 * plugin is loaded through `import()`, so a static walk from the page stops
 * at the loader manifest and sees no plugin at all — it cannot tell a site
 * module from a console one, because neither is statically reachable.
 *
 * ## The rules
 *
 * 1. **A plugin with both surfaces declares a site module.** `modules.site`
 *    in `plugins.config.json`, distinct from the module its console surface
 *    registers from. Read from the declaration alone, so it holds without a
 *    build.
 * 2. **A plugin with no `site` surface contributes nothing.** Its widgets,
 *    routes and panels are console contributions, and a published page that
 *    downloads them pays for a screen it will never show.
 * 3. **A site-surface plugin contributes what that surface reaches, and only
 *    that** — statically. A module the surface reaches only through
 *    `import()` is code the plugin itself defers (the editor-preview slice, a
 *    dialog nobody opened), and before settle is where it must not be.
 * 4. **The console registrar's own module never appears.** Rule 3 reads the
 *    graph of the declared site module, so it cannot by itself refuse a
 *    declaration that names the package root — there every console module is
 *    "in the site graph". This one is absolute: the module a plugin's
 *    `register.console` names is console code by definition, and no page
 *    renders it.
 *
 * The rules are not "which page uses which plugin", which no build can
 * answer. They are the half a build CAN answer, and it is the half that was
 * wrong: the page was paying for surfaces it could never render.
 */

import { collectBarrelGraph } from './jsx-barrel.mjs'
import {
  decodeMappings,
  measureWireWeight,
  projectPath,
  PUBLISHED_ROUTE,
} from './tenant-wire-weight.mjs'

/** `libs/plugins/<id>/…` → `<id>`; anything else → null. */
export function pluginOf(path) {
  const match = /^libs\/plugins\/([^/]+)\//.exec(String(path ?? ''))
  return match ? match[1] : null
}

/**
 * The module a plugin's `site` surface registers from, as the generated
 * loader manifest imports it — `modules.site` when the entry names one, and
 * the package root otherwise.
 */
export function siteEntrySpecifier(plugin) {
  if (!plugin?.register?.site) return null
  return surfaceSpecifier(plugin, 'site')
}

/** The module a surface registers from: `modules[surface]`, else the root. */
export function surfaceSpecifier(plugin, surface) {
  const own = plugin.modules?.[surface]
  return own ? `${plugin.package}/${own}` : plugin.package
}

/**
 * Rule 1, read from `plugins.config.json` alone: a plugin that registers both
 * a site surface and a console one must give the site surface a module of its
 * own. Sharing one module means the loader hands a published page the console
 * registrar and every export beside it.
 */
export function undeclaredSiteModules(plugins) {
  const out = []
  for (const plugin of plugins ?? []) {
    if (!plugin.register?.site || !plugin.register?.console) continue
    const site = surfaceSpecifier(plugin, 'site')
    const console_ = surfaceSpecifier(plugin, 'console')
    if (site === console_) {
      out.push({ id: plugin.id, specifier: site })
    }
  }
  return out
}

/**
 * Each plugin's site closure: the project-relative modules its site surface
 * reaches statically, keyed by the directory under `libs/plugins/`.
 *
 * Keyed by DIRECTORY rather than by plugin id because a built module names a
 * path, and `events-calendar` is the directory while the id may differ.
 */
export function siteClosures({ plugins, root, read, resolve }) {
  const closures = new Map()
  for (const plugin of plugins) {
    const specifier = siteEntrySpecifier(plugin)
    if (!specifier) continue
    const entry = resolve(specifier, `${root}/tools/scripts/.resolve.mjs`)
    if (!entry) {
      closures.set(plugin.id, { error: `cannot resolve ${specifier}` })
      continue
    }
    const graph = collectBarrelGraph({ entry, read, resolve, staticOnly: true })
    const modules = new Set()
    let directory = null
    for (const file of graph.modules) {
      const relative = file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file
      modules.add(relative)
      const owner = pluginOf(relative)
      // The directory the ENTRY sits in owns the closure; a module of another
      // plugin inside it is AGL-3080's concern, not this guard's.
      if (owner && file === entry) directory = owner
    }
    if (directory) closures.set(directory, { modules, specifier })
  }
  return closures
}

/**
 * Rule 4's subjects: the module each plugin's console surface registers from,
 * project-relative, keyed by path. Console code by declaration, so its
 * presence before settle is a red whatever else reaches it.
 */
export function consoleEntries({ plugins, root, resolve }) {
  const entries = new Map()
  for (const plugin of plugins ?? []) {
    if (!plugin.register?.console) continue
    const specifier = surfaceSpecifier(plugin, 'console')
    const file = resolve(specifier, `${root}/tools/scripts/.resolve.mjs`)
    if (!file) continue
    const relative = file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file
    entries.set(relative, { id: plugin.id, specifier })
  }
  return entries
}

/**
 * Every original module inside `chunks`, read from each chunk's own source
 * map. A chunk with no map contributes nothing and is reported, because a
 * chunk this cannot read is a chunk this cannot clear.
 */
export function modulesInChunks({ chunks, io }) {
  const modules = new Map()
  const unmapped = []
  for (const chunk of chunks) {
    if (!io.exists(chunk)) continue
    const code = io.readText(chunk)
    const marker = code.match(/\/\/# sourceMappingURL=(\S+)/)
    const mapPath = marker ? `${chunk.replace(/[^/]+$/, '')}${marker[1]}` : null
    if (!mapPath || !io.exists(mapPath)) {
      unmapped.push(chunk)
      continue
    }
    const map = io.readJson(mapPath)
    // `decodeMappings` is not needed to LIST the sources, but a map whose
    // mappings do not decode is a map that names files it cannot place, and
    // this guard blames a file.
    decodeMappings(map.mappings)
    for (const source of map.sources ?? []) {
      const path = projectPath(source)
      if (!modules.has(path)) modules.set(path, chunk)
    }
  }
  return { modules, unmapped }
}

/**
 * The verdict: every plugin module found before settle, and whether its
 * plugin's site surface accounts for it.
 */
export function evaluatePluginPresence({ modules, closures, consoleModules }) {
  const offenders = []
  const present = new Map()
  for (const [path, chunk] of modules) {
    const owner = pluginOf(path)
    if (!owner) continue
    if (!present.has(owner)) present.set(owner, [])
    present.get(owner).push(path)
    const asConsole = consoleModules?.get(path)
    if (asConsole) {
      offenders.push({
        path,
        chunk,
        why: `the module ${asConsole.id}'s console surface registers from`,
      })
      continue
    }
    const closure = closures.get(owner)
    if (!closure) {
      offenders.push({ path, chunk, why: 'the plugin has no site surface' })
      continue
    }
    if (closure.error) {
      offenders.push({ path, chunk, why: closure.error })
      continue
    }
    if (!closure.modules.has(path)) {
      offenders.push({
        path,
        chunk,
        why: `not in the static graph of ${closure.specifier}`,
      })
    }
  }
  offenders.sort((a, b) => a.path.localeCompare(b.path))
  return { ok: offenders.length === 0, offenders, present }
}

/**
 * The before-settle chunks of the published route: every group's own chunks,
 * so a page that uses everything the budget declares is the subject. A group
 * counts only the chunks no earlier group loads, so the union is each chunk
 * exactly once.
 */
export function beforeSettleChunks({ groups, io, route = PUBLISHED_ROUTE }) {
  const measured = measureWireWeight({ route, groups, io })
  const chunks = []
  const missing = []
  for (const group of measured.groups ?? measured) {
    for (const chunk of group.chunks) chunks.push(chunk)
    for (const one of group.missing ?? []) missing.push({ group: group.name, ...one })
  }
  return { chunks, missing }
}

export const WHY_LOAD_WHERE_USED =
  'A plugin loads only where something uses it (AGL-3116). Installing one ' +
  'loads nothing: a published page fetches a plugin when the page places ' +
  'one of its elements or the site runs one of its features. So a published ' +
  "page's before-settle load may hold a plugin's SITE surface and nothing " +
  'else of it — never a console registrar, a console route or a panel, and ' +
  'nothing from a plugin whose only contributions are console ones.'
