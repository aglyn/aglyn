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
 * The console half of "a plugin loads only where it is used" (AGL-3142): a
 * plugin's code reaches a console screen only where that screen draws one of
 * its declared contributions. Read from a console PRODUCTION BUILD, on the
 * chunk attribution `plugins-load-where-used.mjs` uses for published pages.
 *
 * ## The rule
 *
 * The published half's fourth rule — the module a `register.console` names
 * never reaches a published page — has a twin here, pointing the other way.
 * A workspace shell draws what a plugin declares under `console.shell`: a nav
 * tab, an organization tab, a staff tab, a provider. It draws no zone of a
 * plugin's and serves no route of one, so a plugin whose declaration names
 * only `slots`, `routes` or `orgRoutes` has NOTHING on the shell, and its code
 * in the shell's before-settle load is a screen paying for a surface it cannot
 * render.
 *
 * Stated as the published half's rule 3 states its own: the shell's
 * before-settle load may hold what the shell plugins' console surfaces reach
 * STATICALLY, and nothing else. Written the other way — blaming every module
 * by the plugin directory it sits in — it would blame a shell plugin's own
 * dependency on the plugin that exports it (`forms` reads the MUI bundle id,
 * `email` its HTML sanitizer), which is a cross-package edge
 * `check:lib-boundaries` owns and this guard has no opinion about. And it
 * would miss the console twin of rule 3: a module a shell plugin defers with
 * `import()` and the chunker hands the shell anyway.
 *
 * ## What it reads
 *
 * The organization route's eager chunks, plus the chunks the shell's own
 * plugin imports pull. The shell's imports are not guessed: `ensure` is a
 * runtime call no build can see, so the loads are DERIVED from the same
 * declarations the shell loads by — each `console.shell` plugin's `import()`
 * in the generated console manifest — and the build is then asked what those
 * imports actually fetched. The two can disagree, and where they disagree is
 * the leak: Turbopack puts a module in whichever chunks it likes, so a
 * zone-only plugin sharing a barrel with a shell one rides in on its chunk.
 *
 * A declared import that is not in the build is RED. A shell plugin whose
 * chunks went unread would leave its modules unattributed, and the guard would
 * clear a screen it never looked at.
 */

import { collectBarrelGraph } from './jsx-barrel.mjs'
import { measureWireWeight } from './tenant-wire-weight.mjs'
import { pluginOf, surfaceSpecifier } from './plugins-load-where-used.mjs'

/**
 * The console route every workspace screen is drawn inside: the organization
 * shell, which is where a plugin that draws on every screen loads.
 */
export const CONSOLE_ROUTE = '(app)/[orgSlug]'

/** The generated manifest whose `import()` lines the console loads plugins by. */
export const CONSOLE_MANIFEST = 'apps/console/constants/plugins.client.generated.ts'

/**
 * Whether a plugin's declaration puts it on the workspace shell — the same
 * reading `consoleLoadPoints` gives the app, in the one place a build tool can
 * make it: an absent `contributes` is a plugin published before the contract
 * and loads with the shell, and a first-party plugin always declares.
 */
export function loadsWithShell(plugin) {
  if (!plugin?.register?.console) return false
  if (!plugin.contributes) return true
  return Boolean(plugin.contributes.console?.shell)
}

/**
 * Everything the shell's plugins reach statically from their console
 * registrars: the union of their graphs, and each plugin's own entry beside
 * it for the report.
 *
 * A plugin whose console module cannot be resolved is an `error`, never a
 * silent absence — an unread closure would turn every module of that plugin
 * into an offender, or none, depending on which way the code leaned.
 */
export function shellClosure({ plugins, root, read, resolve }) {
  const modules = new Set()
  const owners = []
  const errors = []
  for (const plugin of plugins ?? []) {
    if (!loadsWithShell(plugin)) continue
    const specifier = surfaceSpecifier(plugin, 'console')
    const entry = resolve(specifier, `${root}/tools/scripts/.resolve.mjs`)
    if (!entry) {
      errors.push({ id: plugin.id, error: `cannot resolve ${specifier}` })
      continue
    }
    const graph = collectBarrelGraph({ entry, read, resolve, staticOnly: true })
    for (const file of graph.modules) {
      modules.add(file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file)
    }
    owners.push({ id: plugin.id, specifier })
  }
  return { modules, owners, errors }
}

/**
 * What a plugin declares in the console, as the sentence a failure prints.
 *
 * Keyed by the DIRECTORY under `libs/plugins/`, because a built module names a
 * path and `events-calendar` is the directory while the id may differ.
 */
export function declaredConsolePoints({ plugins, root, resolve }) {
  const byDirectory = new Map()
  for (const plugin of plugins ?? []) {
    const file = resolve(plugin.package, `${root}/tools/scripts/.resolve.mjs`)
    const relative = file?.startsWith(`${root}/`) ? file.slice(root.length + 1) : file
    const directory = relative ? pluginOf(relative) : null
    if (!directory) continue
    byDirectory.set(directory, { id: plugin.id, points: describePoints(plugin) })
  }
  return byDirectory
}

/** What a plugin's declaration names in the console, as a sentence fragment. */
function describePoints(plugin) {
  if (!plugin.register?.console) return 'no console surface'
  const declared = plugin.contributes?.console ?? {}
  if (declared.shell) return 'the shell'
  const parts = []
  if (declared.slots?.length) parts.push(`${declared.slots.length} zone(s)`)
  if (declared.routes?.length) parts.push(`${declared.routes.length} site route(s)`)
  if (declared.orgRoutes?.length) {
    parts.push(`${declared.orgRoutes.length} org route(s)`)
  }
  return parts.length ? `only ${parts.join(' and ')}` : 'nothing in the console'
}

/**
 * The shell's before-settle group, as `measureWireWeight` takes it: the
 * organization route's eager chunks plus one declared load per plugin the
 * shell loads.
 */
export function consoleShellGroup(plugins) {
  return {
    name: 'the workspace shell',
    loads: (plugins ?? []).filter(loadsWithShell).map((plugin) => ({
      from: CONSOLE_MANIFEST,
      import: surfaceSpecifier(plugin, 'console'),
      why: `${plugin.id} declares console.shell`,
    })),
  }
}

/**
 * What the workspace shell loads before it settles, measured on a console
 * production build.
 *
 * @returns {{ chunks: string[], bytes: number, raw: number,
 *   missing: Array<{ from: string, import: string }> }}
 */
export function consoleShellLoad({ plugins, io, route = CONSOLE_ROUTE }) {
  const measured = measureWireWeight({
    route,
    groups: [consoleShellGroup(plugins)],
    io,
  })
  const [group] = measured.groups
  return {
    chunks: group.chunks,
    bytes: group.bytes,
    raw: group.raw,
    missing: group.missing,
  }
}

/**
 * The verdict: every plugin module the shell loads, and whether a shell
 * plugin's console surface accounts for it.
 */
export function evaluateConsolePresence({ modules, closure, points }) {
  const offenders = []
  const present = new Map()
  for (const one of closure.errors) {
    offenders.push({ path: one.id, chunk: '(declaration)', why: one.error })
  }
  for (const [path, chunk] of modules) {
    const owner = pluginOf(path)
    if (!owner) continue
    if (!present.has(owner)) present.set(owner, [])
    present.get(owner).push(path)
    if (closure.modules.has(path)) continue
    const declared = points?.get(owner)
    offenders.push({
      path,
      chunk,
      why: declared
        ? `${declared.id} declares ${declared.points}, and no shell plugin's ` +
          'console surface reaches this module'
        : "no shell plugin's console surface reaches this module",
    })
  }
  offenders.sort((a, b) => a.path.localeCompare(b.path))
  return { ok: offenders.length === 0, offenders, present }
}

export const WHY_CONSOLE_LOAD_WHERE_USED =
  'A plugin loads only where something uses it (AGL-3116), in the console as ' +
  'on a published page. The workspace shell draws what a plugin declares ' +
  'under `console.shell` — a nav tab, an organization tab, a staff tab, a ' +
  'provider — and nothing else of it: a zone loads its plugins where the zone ' +
  'is rendered, and a plugin route loads its plugin where the route is ' +
  'served. So the shell may hold the code of a plugin that declares ' +
  '`console.shell` and no other plugin code at all.'
