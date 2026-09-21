#!/usr/bin/env node
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
 * Generates the per-app plugin loader manifests from plugins.config.json
 * (AGL-417). The emitted files are the ONLY code outside libs/plugins that
 * may reference @aglyn/plugins-* — everything else goes through the core
 * plugin-manager loader at runtime, keyed by org.enabledPlugins.
 *
 * Re-run after editing plugins.config.json:  node tools/scripts/generate-plugin-manifests.mjs
 *
 * ## `--check` (AGL-1728)
 *
 * Rebuilds every manifest in memory and exits non-zero if what is on disk
 * differs, writing nothing. `npm run generate:plugin-manifests:check`.
 *
 * Until AGL-1728 this generator had no check, no npm script, and exactly one
 * caller in the whole repo — the `create-plugin.mjs` scaffolder, which runs it
 * once at plugin-creation time. Edit `plugins.config.json` by hand after that
 * and nothing re-runs it and nothing notices: the outputs carry a do-not-edit
 * header so nobody opens them, and they are ordinary .ts files, so the type
 * gate compiles them clean whether or not they still describe the config.
 * That is the trap. `npm run typecheck` going green is a plausible, wrong
 * answer to "do these match their source" — the compiler cannot see this
 * class of defect at all, and a stale manifest ships looking healthy.
 *
 * What ships is worse than a phantom compile error. These are the ONLY
 * sanctioned @aglyn/plugins-* references outside libs/plugins; the runtime
 * loader activates exactly what they list. A plugin whose config entry gained
 * a `site` surface or an `apiPrefixes` value but whose manifest did not
 * simply never registers it, and the plugin looks broken with nothing
 * pointing back here as the cause.
 *
 * Like `sync-next-tsconfigs.mjs --check`, this must never be `nx affected`-
 * scoped: the invalidating input is a root-level plugins.config.json that is
 * no app's source, and the outputs land in two different apps at once.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const config = JSON.parse(readFileSync(join(ROOT, 'plugins.config.json'), 'utf8'))

const header = (entryPoint) => `/**
 * GENERATED FILE — do not edit. Regenerate with:
 *   node tools/scripts/generate-plugin-manifests.mjs
 *
 * The sole sanctioned @aglyn/plugins-* references outside libs/plugins
 * (AGL-417): dynamic-import loaders the core plugin-manager activates at
 * runtime for the org's enabled plugins. Source of truth: plugins.config.json.
 */
/* eslint-disable @nx/enforce-module-boundaries */

import type { PluginLoadManifest } from '@aglyn/aglyn${entryPoint === 'server' ? '/server' : ''}'

`

/**
 * The module each surface registers from (AGL-3116). A plugin's `modules`
 * names a subpath for a surface whose code must not ride with the rest: the
 * loader reads a loaded module by name, so everything a package entry exports
 * ships with it, and a site surface loaded from the package root carried the
 * console registrar onto every published page that used the plugin.
 */
/**
 * The console half of a plugin's declaration, as the console manifest carries
 * it (AGL-3142).
 *
 * Only the console manifest gets one. The console loads a plugin where a
 * screen draws one of its contributions, so it has to read the declaration
 * before it names any plugin; a published page decides presence from the
 * nodes it places and would carry a block nothing there consults.
 *
 * Always written, `{}` included, so an absent declaration keeps meaning what
 * `plugin-contributions.ts` says it means — a plugin published before the
 * contract, which loads with the shell. A first-party plugin always declares
 * (`checkContributions` refuses one that does not), so its silence about the
 * console is a statement: it draws nothing on every screen.
 */
function consoleContributions(plugin, surfaces) {
  if (!surfaces.includes('console')) return ''
  const declared = plugin.contributes?.console
  const block = declared ? { console: declared } : {}
  return `    contributes: ${JSON.stringify(block)},\n`
}

function entry(plugin, entryPoint, surfaces) {
  const register = Object.fromEntries(
    Object.entries(plugin.register).filter(([key]) => surfaces.includes(key)),
  )
  if (!Object.keys(register).length) return null
  const root =
    entryPoint === 'server' ? `${plugin.package}/server` : plugin.package
  const moduleOf = (surface) =>
    plugin.modules?.[surface] ? `${plugin.package}/${plugin.modules[surface]}` : root
  const specifiers = Object.keys(register).map(moduleOf)
  // One module for every surface this app loads: that module is `load`.
  // Otherwise `load` is the root and each surface with its own module gets it.
  const shared = specifiers.every((specifier) => specifier === specifiers[0])
  const own = shared
    ? []
    : Object.keys(register).filter((surface) => moduleOf(surface) !== root)
  return (
    `  {\n` +
    `    id: '${plugin.id}',\n` +
    (plugin.alwaysOn ? `    alwaysOn: true,\n` : '') +
    (plugin.apiPrefixes?.length
      ? `    apiPrefixes: ${JSON.stringify(plugin.apiPrefixes)},\n`
      : '') +
    `    register: ${JSON.stringify(register)},\n` +
    consoleContributions(plugin, surfaces) +
    `    load: () => import('${shared ? specifiers[0] : root}'),\n` +
    (own.length
      ? `    loads: {\n` +
        own
          .map((surface) => `      ${surface}: () => import('${moduleOf(surface)}'),\n`)
          .join('') +
        `    },\n`
      : '') +
    `  },`
  )
}

/** The file this manifest should contain, byte for byte. */
function expectedContent(entryPoint, surfaces, constName) {
  const entries = config.plugins
    .map((plugin) => entry(plugin, entryPoint, surfaces))
    .filter(Boolean)
    .join('\n')
  return (
    header(entryPoint) +
    `export const ${constName}: PluginLoadManifest = [\n${entries}\n]\n`
  )
}

/**
 * Plugin-level detail for the failure message.
 *
 * The verdict is whole-file equality — formatting drift is drift too — but
 * "the file differs" is not actionable, and the drift this guards against is
 * a plugin gaining or losing a surface in plugins.config.json without the
 * generator being re-run. Naming which plugin turns the failure into a fix.
 */
function describeDrift(expected, actual) {
  const ids = (text) =>
    (text.match(/^ {4}id: '(.+)',$/gm) ?? []).map((m) => m.slice(9, -2))
  const want = ids(expected)
  const have = ids(actual)
  const missing = want.filter((id) => !have.includes(id))
  const extra = have.filter((id) => !want.includes(id))
  const lines = []
  if (missing.length)
    lines.push(`  not loaded (${missing.length}): ${missing.join(', ')}`)
  if (extra.length)
    lines.push(
      `  loaded but not in the config (${extra.length}): ${extra.join(', ')}`,
    )
  // Same plugin set, different bytes: a surface, apiPrefix or alwaysOn moved.
  if (!lines.length)
    lines.push(
      '  the same plugins are listed; their register surfaces, apiPrefixes,' +
        ' alwaysOn or formatting differ',
    )
  return lines
}

/**
 * The declarations manifests (AGL-2939): each plugin's `declarations` entry
 * (both apps, client and server) and its `serverDeclarations` entry (server
 * only), each a light module that registers what core must know before any
 * surface of the plugin loads — billing and access keys, activity codes,
 * settings schemas, platform-event subscriptions. The loader manifests
 * above are per-org; these run once per process, at boot on the server
 * (`instrumentation.ts`) and with the plugin loader module on the console
 * client, so a core billing route folds a plugin's add-on and the staff
 * lockdown page lists its levers whether or not a request has touched the
 * plugin yet.
 *
 * Loaded with `import()` like the loader manifests, never statically: the
 * project graph reads a static specifier as the app depending on the
 * plugin, which the package map refuses (AGL-2941). The function resolves
 * once the declarations are registered, in catalog order, and the apps
 * hold their first render on it.
 *
 * A `consoleServerDeclarations` entry (`/declarations.console-server`,
 * AGL-2978) is written into the CONSOLE's server manifest alone: what it
 * registers opens something only the console holds — an eraser that
 * revokes a provider grant with the console's key — and the tenant runtime,
 * which serves the public internet, must not so much as bundle it.
 */
const DECLARATION_MODULES = {
  declarations: 'declarations',
  serverDeclarations: 'declarations.server',
  consoleServerDeclarations: 'declarations.console-server',
}

function declarationsContent(surfaces, constName, entryPoint) {
  const calls = []
  for (const plugin of config.plugins) {
    for (const surface of surfaces) {
      const fn = plugin.register?.[surface]
      if (!fn) continue
      const specifier = `${plugin.package}/${DECLARATION_MODULES[surface]}`
      calls.push(`    ;(await import('${specifier}')).${fn}()`)
    }
  }
  return (
    `/**\n * GENERATED FILE — do not edit. Regenerate with:\n` +
    ` *   node tools/scripts/generate-plugin-manifests.mjs\n *\n` +
    ` * The plugins' DECLARATIONS (AGL-2939): the light registrations core\n` +
    ` * reads before any plugin surface loads, imported dynamically like the\n` +
    ` * loader manifests. One of the sanctioned @aglyn/plugins-* references\n` +
    ` * outside libs/plugins (AGL-417).\n` +
    ` * Source of truth: plugins.config.json.\n */\n` +
    `/* eslint-disable @nx/enforce-module-boundaries */\n\n` +
    `let done: Promise<void> | undefined\n\n` +
    `/** Registers every plugin's ${entryPoint} declarations once per process. */\n` +
    `export function ${constName}(): Promise<void> {\n` +
    `  done ??= (async () => {\n` +
    (calls.length ? calls.join('\n') + '\n' : '') +
    `  })()\n` +
    `  return done\n` +
    `}\n`
  )
}

const DECLARATION_MANIFESTS = [
  {
    file: 'apps/console/constants/plugins.declarations.generated.ts',
    surfaces: ['declarations'],
    constName: 'registerPluginDeclarations',
    entryPoint: 'client',
  },
  {
    file: 'apps/console/constants/plugins.declarations.server.generated.ts',
    surfaces: ['declarations', 'serverDeclarations', 'consoleServerDeclarations'],
    constName: 'registerPluginServerDeclarations',
    entryPoint: 'server',
  },
  {
    file: 'apps/tenant/utils/plugins.declarations.server.generated.ts',
    surfaces: ['declarations', 'serverDeclarations'],
    constName: 'registerPluginServerDeclarations',
    entryPoint: 'server',
  },
]

/**
 * The subprocessors manifest (AGL-2984): the third-party recipients each
 * plugin declares, as DATA. A plugin names a function under `subprocessors`;
 * this generator loads `${package}/subprocessors` through jiti with the
 * `@aglyn/*` aliases of tsconfig.base.json, calls the function, and writes
 * what it returns. The subprocessor inventory reads the result synchronously
 * at module scope, where a dynamic import cannot reach, and without a static
 * import of any plugin, which the package map refuses an app. The manifest's
 * one import is core's declaration type.
 *
 * Its source is the plugin's code as well as plugins.config.json: a plugin
 * that changes a declaration leaves this file describing the old one until
 * the generator runs again, and `--check` names the hosts that differ.
 *
 * The entry answers an array of recipients, or an object carrying them with
 * the plugin's other hosts (`hosts`, each `not-a-subprocessor` or
 * `no-request`) and its uses of hosts declared elsewhere (`uses`, AGL-2978).
 * The two lists are written only when a plugin declares them, so a plugin
 * that answers an array keeps the bytes it always had.
 */
const SUBPROCESSORS_MANIFEST = 'apps/console/constants/plugins.subprocessors.generated.ts'

/** The fields of core's `PluginEgressHostDeclaration`, in the order written. */
const HOST_FIELDS = ['host', 'disposition', 'reason', 'dataReceived']

/** The dispositions core's fold accepts for a host that is not a recipient. */
const HOST_DISPOSITIONS = ['not-a-subprocessor', 'no-request']

/** The fields of core's `PluginEgressUseDeclaration`, in the order written. */
const USE_FIELDS = ['host', 'reason', 'dataReceived']

/** The fields of core's `PluginSubprocessorDeclaration`, in the order written. */
const SUBPROCESSOR_FIELDS = [
  'host',
  'entity',
  'region',
  'purpose',
  'publishedOn',
  'reason',
  'dataReceived',
]

/** tsconfig.base.json's `@aglyn/*` aliases, in the prefix form jiti resolves. */
function workspaceAliases() {
  const { paths } = JSON.parse(
    readFileSync(join(ROOT, 'tsconfig.base.json'), 'utf8'),
  ).compilerOptions
  const alias = {}
  for (const [key, [target]] of Object.entries(paths)) {
    const path = target.replace(/^\.\//, '')
    if (key.endsWith('/*')) {
      alias[key.slice(0, -1)] = join(ROOT, path.replace(/\/?\*$/, '')) + '/'
    } else {
      alias[key] = join(ROOT, path)
    }
  }
  return alias
}

/**
 * Every declaration in `list` carries each of `fields` as a string, or the
 * generator stops naming the entry, the list and the field.
 */
function requireStringFields(list, fields, where) {
  if (!Array.isArray(list)) throw new Error(`${where} is not a list`)
  for (const declaration of list) {
    for (const field of fields) {
      if (typeof declaration?.[field] !== 'string') {
        throw new Error(`${where} has a declaration whose ${field} is not a string`)
      }
    }
  }
  return list
}

/** One jiti instance with the workspace aliases, for reading TypeScript sources. */
let workspaceJiti
function jitiForWorkspace() {
  if (!workspaceJiti) {
    const { createJiti } = createRequire(join(ROOT, 'package.json'))('jiti')
    workspaceJiti = createJiti(join(ROOT, 'package.json'), {
      alias: workspaceAliases(),
      interopDefault: true,
      moduleCache: true,
      fsCache: false,
      sourceMaps: false,
    })
  }
  return workspaceJiti
}

/**
 * Every plugin declares what it contributes, and where (AGL-3116).
 *
 * Required of a first-party plugin: the loaders place a plugin by its
 * declaration alone, and the default a marketplace plugin gets for declaring
 * nothing exists for versions published before the contract, not for code in
 * this repository. Validated by core's own sanitizer, so the catalog and a
 * marketplace manifest cannot disagree about what a valid declaration is.
 */
async function checkContributions() {
  const { sanitizePluginContributions } = await jitiForWorkspace().import(
    '@aglyn/aglyn/plugin-manager/plugin-contributions',
  )
  const problems = []
  for (const plugin of config.plugins) {
    if (!('contributes' in plugin)) {
      problems.push(`${plugin.id}: declares no "contributes"`)
      continue
    }
    const verdict = sanitizePluginContributions(plugin.contributes)
    if (!verdict.ok) problems.push(`${plugin.id}: ${verdict.error}`)
  }
  if (problems.length) {
    throw new Error(
      `plugins.config.json has plugins whose contributions the loaders cannot read:\n  ${problems.join('\n  ')}`,
    )
  }
}

/** Each plugin with a `subprocessors` entry, and what that entry returns. */
async function pluginSubprocessors() {
  const declaring = config.plugins.filter((plugin) => plugin.register?.subprocessors)
  if (!declaring.length) return []
  const jiti = jitiForWorkspace()
  const entries = []
  for (const plugin of declaring) {
    const specifier = `${plugin.package}/subprocessors`
    const fnName = plugin.register.subprocessors
    const fn = (await jiti.import(specifier))[fnName]
    if (typeof fn !== 'function') {
      throw new Error(`${specifier} exports no function named ${fnName}`)
    }
    const answer = await fn()
    const where = `${specifier}: ${fnName}()`
    const {
      subprocessors = [],
      hosts = [],
      uses = [],
    } = Array.isArray(answer) ? { subprocessors: answer } : (answer ?? {})
    requireStringFields(subprocessors, SUBPROCESSOR_FIELDS, `${where} subprocessors`)
    requireStringFields(hosts, HOST_FIELDS, `${where} hosts`)
    requireStringFields(uses, USE_FIELDS, `${where} uses`)
    for (const declaration of hosts) {
      if (!HOST_DISPOSITIONS.includes(declaration.disposition)) {
        throw new Error(
          `${where} declares ${declaration.host} as '${declaration.disposition}'; a host is ${HOST_DISPOSITIONS.join(' or ')}`,
        )
      }
    }
    entries.push({ pluginId: plugin.id, subprocessors, hosts, uses })
  }
  return entries
}

/** One list of declarations as the manifest writes it, or '' for an empty optional one. */
function declarationList(name, list, fields, { always = false } = {}) {
  if (!list.length) return always ? `    ${name}: [],\n` : ''
  const rows = list
    .map(
      (declaration) =>
        `      {\n` +
        fields.map((field) => `        ${field}: ${JSON.stringify(declaration[field])},\n`).join('') +
        `      },`,
    )
    .join('\n')
  return `    ${name}: [\n${rows}\n    ],\n`
}

/** The subprocessors manifest, byte for byte. */
function subprocessorsContent(entries) {
  const body = entries
    .map(
      ({ pluginId, subprocessors, hosts, uses }) =>
        `  {\n` +
        `    pluginId: '${pluginId}',\n` +
        declarationList('subprocessors', subprocessors, SUBPROCESSOR_FIELDS, { always: true }) +
        declarationList('hosts', hosts, HOST_FIELDS) +
        declarationList('uses', uses, USE_FIELDS) +
        `  },`,
    )
    .join('\n')
  return (
    `/**\n * GENERATED FILE — do not edit. Regenerate with:\n` +
    ` *   node tools/scripts/generate-plugin-manifests.mjs\n *\n` +
    ` * The plugins' SUBPROCESSORS (AGL-2984): what each plugin's\n` +
    ` * \`subprocessors\` entry returned when this file was generated, written\n` +
    ` * down as data. The subprocessor inventory folds it in through core's\n` +
    ` * \`foldPluginSubprocessors\`, naming every plugin's recipients without\n` +
    ` * importing a plugin.\n` +
    ` * Source of truth: plugins.config.json and the entries it names.\n */\n\n` +
    `import type { PluginSubprocessorManifestEntry } from '@aglyn/aglyn/plugin-manager/plugin-subprocessors'\n\n` +
    `export const PLUGIN_SUBPROCESSORS: readonly PluginSubprocessorManifestEntry[] = [\n` +
    (body ? `${body}\n` : '') +
    `]\n`
  )
}

/** Which declared hosts moved, for the `--check` failure message. */
function describeSubprocessorDrift(expected, actual) {
  const hosts = (text) =>
    [...text.matchAll(/^ {8}host: "(.+)",$/gm)].map((match) => match[1])
  const want = hosts(expected)
  const have = hosts(actual)
  const missing = want.filter((host) => !have.includes(host))
  const extra = have.filter((host) => !want.includes(host))
  const lines = []
  if (missing.length)
    lines.push(`  declared by a plugin but not written (${missing.length}): ${missing.join(', ')}`)
  if (extra.length)
    lines.push(`  written but declared by no plugin (${extra.length}): ${extra.join(', ')}`)
  // Same hosts, different bytes: a declaration's wording changed.
  if (!lines.length)
    lines.push(
      "  the same hosts are declared; a declaration's wording, its plugin or the formatting differs",
    )
  return lines
}

/**
 * `staff` (AGL-2939) is the console surface the STAFF area loads. The org
 * routes load each workspace's enabled plugins, and a staff page names no
 * workspace, so a plugin with widgets on the staff zones names the
 * registrar that carries them here — usually its `console` one — and the
 * staff area loads exactly those plugins.
 */
const MANIFESTS = [
  {
    file: 'apps/console/constants/plugins.client.generated.ts',
    entryPoint: 'client',
    surfaces: ['console', 'site', 'staff'],
    constName: 'CONSOLE_PLUGIN_MANIFEST',
  },
  {
    file: 'apps/console/constants/plugins.server.generated.ts',
    entryPoint: 'server',
    surfaces: ['consoleApi'],
    constName: 'CONSOLE_PLUGIN_SERVER_MANIFEST',
  },
  {
    file: 'apps/tenant/utils/plugins.client.generated.ts',
    entryPoint: 'client',
    surfaces: ['site'],
    constName: 'TENANT_PLUGIN_MANIFEST',
  },
  {
    file: 'apps/tenant/utils/plugins.server.generated.ts',
    entryPoint: 'server',
    surfaces: ['tenantApi'],
    constName: 'TENANT_PLUGIN_SERVER_MANIFEST',
  },
]

/**
 * The switchboard catalog, compiled into the core (AGL-3080).
 *
 * Every plugin declares its own row — `catalog` on its entry, and on each of
 * its `capabilities` — and the core reads the compiled list, so adding a
 * plugin edits no core file. It is compiled rather than registered at runtime
 * on purpose: the resolvers that read it are synchronous and run in every
 * bundle of both apps, the middleware and the functions included, and a
 * registry one of those bundles had not filled would resolve every plugin as
 * OFF on a published site without an error anywhere (the shape of AGL-3025).
 */
const CATALOG_FILE = 'libs/aglyn/src/lib/plugin-manager/first-party-plugins.generated.ts'
const SITE_IMPACTS = ['elements', 'routes', 'console-only']

function catalogRows() {
  const rows = []
  for (const plugin of config.plugins) {
    for (const source of [plugin, ...(plugin.capabilities ?? [])]) {
      if (!source.catalog) continue
      const { order, publishedSiteImpact, editBarLink, $comment: _note, ...fields } = source.catalog
      const where = `plugins.config.json: "${source.id}" catalog`
      if (!Number.isInteger(order)) throw new Error(`${where} needs an integer "order"`)
      if (typeof fields.label !== 'string' || !fields.label) throw new Error(`${where} needs a "label"`)
      /*
       * The edit bar's quick link (AGL-3080). DATA rather than a runtime
       * registration, like every other row here: the tenant server draws this
       * bar and never loads a plugin's console code, so a registry it had not
       * filled would silently drop the link instead of failing — the AGL-3025
       * shape. The `path` is validated because it is joined onto a console
       * URL: a leading slash and no query is the whole contract, and a path
       * that drifts from what the plugin's console route serves is a dead
       * link nothing compiles against.
       */
      if (editBarLink) {
        const link = `${where} editBarLink`
        if (!Number.isInteger(editBarLink.order)) throw new Error(`${link} needs an integer "order"`)
        if (typeof editBarLink.label !== 'string' || !editBarLink.label) throw new Error(`${link} needs a "label"`)
        if (typeof editBarLink.path !== 'string' || !editBarLink.path.startsWith('/')) {
          throw new Error(`${link} needs a "path" beginning with "/" — it is joined onto the site's console address`)
        }
        if (/[?#]/.test(editBarLink.path)) throw new Error(`${link}: "path" carries no query or fragment`)
      }
      if (!SITE_IMPACTS.includes(publishedSiteImpact)) {
        throw new Error(`${where} needs "publishedSiteImpact": one of ${SITE_IMPACTS.join(', ')}`)
      }
      // A bundle that registers site components changes what a visitor sees.
      if (source === plugin && Boolean(plugin.register?.site) !== (publishedSiteImpact === 'elements')) {
        throw new Error(`${where}: "publishedSiteImpact" is "elements" exactly when the entry has register.site`)
      }
      rows.push({ order, impact: publishedSiteImpact, editBarLink, plugin: { id: source.id, ...fields } })
    }
  }
  rows.sort((a, b) => a.order - b.order)
  const ids = rows.map((row) => row.plugin.id)
  const orders = rows.map((row) => row.order)
  if (new Set(ids).size !== ids.length) throw new Error('plugins.config.json: a catalog id is declared twice')
  if (new Set(orders).size !== orders.length) throw new Error('plugins.config.json: two catalog rows share an "order"')
  for (const row of rows) {
    for (const required of row.plugin.requires ?? []) {
      if (!ids.includes(required)) throw new Error(`plugins.config.json: "${row.plugin.id}" requires "${required}", which has no catalog row`)
    }
  }
  return rows
}

/**
 * The host subcollections each plugin declares it owns (AGL-3080).
 *
 * DATA rather than a runtime registration, for the reason every other row in
 * this file is: the readers are the media-usage scan, which answers "what
 * uses this asset" in the moment before an author deletes it, and the
 * reference rows that answer shows. Both are synchronous, and the scan runs
 * in a console request that loads no plugin. A registry that request had not
 * filled would report every plugin-owned document as holding nothing — which
 * is the ONE way this scan can be wrong that the author acts on, and it would
 * be silent. `registerPluginHostCollections` stays for a plugin the compiler
 * never sees; the compiled rows are the floor beneath it.
 *
 * Three things are checked here rather than left to a reader:
 *
 *  - ONE OWNER. Two plugins naming one collection would be two schemas in one
 *    place, and the scan, the deep link and the counters would each pick a
 *    winner by config order.
 *  - A REASON TO SKIP. `mediaScan: "none"` has to say what scanning would
 *    cost or get wrong. "It probably has no images in it" is the guess the
 *    scan's inverted default exists to avoid making.
 *  - A ROUTE THE OWNER ACTUALLY SERVES. `routeSlug` has to be one of the
 *    plugin's own `contributes.console.routes`. Core's hand-kept map had
 *    three that were not: `actions` pointed at the logic hub while the
 *    workflows plugin holds it, `workflows` and `webhooks` pointed at a
 *    `/workflows` hub that was renamed `/automation`, and `resources`
 *    pointed at bookings while commerce writes it. Each sent an author
 *    hunting for the document holding the asset they were about to delete.
 */
function hostCollectionRows() {
  const rows = []
  const owners = new Map()
  for (const plugin of config.plugins) {
    const declared = plugin.hostCollections
    if (!declared) continue
    const where = `plugins.config.json: "${plugin.id}" hostCollections`
    if (!Array.isArray(declared) || !declared.length) {
      throw new Error(`${where} is present and declares nothing — drop it, or name what the plugin owns`)
    }
    const routes = (plugin.contributes?.console?.routes ?? []).map((route) => route.replace(/^\//, ''))
    for (const declaration of declared) {
      const { name, label, mediaScan, mediaScanReason, routeSlug, artifact } = declaration
      const what = `${where} "${name ?? ''}"`
      if (typeof name !== 'string' || !name.trim()) throw new Error(`${where}: a collection needs a "name"`)
      const held = owners.get(name)
      if (held) throw new Error(`${what} is already declared by "${held}" — one collection has one owner`)
      owners.set(name, plugin.id)
      if (mediaScan !== undefined && !['generic', 'own', 'none'].includes(mediaScan)) {
        throw new Error(`${what}: "mediaScan" is one of generic, own, none`)
      }
      if (mediaScan === 'none' && !String(mediaScanReason ?? '').trim()) {
        throw new Error(`${what}: "mediaScan": "none" needs a "mediaScanReason" naming what scanning would cost, or what it would get wrong`)
      }
      if (mediaScan !== 'none' && mediaScanReason) {
        throw new Error(`${what}: "mediaScanReason" reads as a reason NOT to scan, and this collection is scanned`)
      }
      if (routeSlug !== undefined && !routes.includes(routeSlug)) {
        throw new Error(
          `${what}: "routeSlug": "${routeSlug}" is not one of "${plugin.id}"'s own console routes ` +
            `(${routes.length ? routes.join(', ') : 'it declares none'}) — a reference row would deep-link where the document is not`,
        )
      }
      if (artifact !== undefined && typeof artifact !== 'boolean') {
        throw new Error(`${what}: "artifact" is true or false`)
      }
      if (label !== undefined && (typeof label !== 'string' || !label.trim())) {
        throw new Error(`${what}: "label" is what ONE of its documents is called, or is left out`)
      }
      rows.push({ pluginId: plugin.id, ...declaration })
    }
  }
  return rows
}

/**
 * The org capacities each plugin backs (AGL-3080).
 *
 * Compiled for the reason the whole file is, and here the reason is money: the
 * readers are the downgrade REFUSAL and the warning the customer reads before
 * choosing, and a capacity missing from one of them lets a plan change strand
 * the thing it names with nothing red.
 *
 * Checked here: one declaration per kind, one per add-on kind, an order that
 * does not collide with core's own two, and the nouns actually written. Core
 * owns whether a reduction is refused; a declaration only says what is
 * counted, against which entitlement, and what to call it.
 */
const CORE_ORG_CAPACITY_ORDERS = { sites: 10, seats: 20 }

function orgCapacityRows() {
  const rows = []
  const kinds = new Map()
  const addons = new Map()
  const orders = new Map(Object.entries(CORE_ORG_CAPACITY_ORDERS))
  for (const plugin of config.plugins) {
    const declared = plugin.orgCapacities
    if (!declared) continue
    const where = `plugins.config.json: "${plugin.id}" orgCapacities`
    if (!Array.isArray(declared) || !declared.length) {
      throw new Error(`${where} is present and declares nothing — drop it, or name the capacity the plugin backs`)
    }
    for (const declaration of declared) {
      const { kind, order, collection, addonKind, includedEntitlement, nouns } = declaration
      const what = `${where} "${kind ?? ''}"`
      for (const [field, value] of [
        ['kind', kind],
        ['collection', collection],
        ['addonKind', addonKind],
        ['includedEntitlement', includedEntitlement],
      ]) {
        if (typeof value !== 'string' || !value.trim()) throw new Error(`${what} needs a "${field}"`)
      }
      if (!Number.isInteger(order)) throw new Error(`${what} needs an integer "order"`)
      const heldKind = kinds.get(kind)
      if (heldKind) throw new Error(`${what} is already declared by "${heldKind}" — one capacity has one owner`)
      if (kind in CORE_ORG_CAPACITY_ORDERS) {
        throw new Error(`${what} is a capacity the platform owns — a site and a team seat exist with no plugin loaded`)
      }
      kinds.set(kind, plugin.id)
      const heldAddon = addons.get(addonKind)
      if (heldAddon) {
        throw new Error(`${what}: add-on kind "${addonKind}" is already backed by "${heldAddon}" — two capacities on one purchase would each measure the other's quantity`)
      }
      addons.set(addonKind, plugin.id)
      const heldOrder = orders.get(String(order))
      if (heldOrder) {
        // Two capacities sharing an order list in whichever sequence the
        // config happens to hold them, and the warning and the refusal would
        // then disagree about which one to read first.
        throw new Error(`${what}: "order" ${order} is already taken by "${heldOrder}"`)
      }
      orders.set(String(order), plugin.id)
      for (const field of ['one', 'many', 'addon']) {
        if (typeof nouns?.[field] !== 'string' || !nouns[field].trim()) {
          throw new Error(`${what} needs "nouns.${field}" — a refusal that had no word for it would read as a bug`)
        }
      }
      rows.push({ pluginId: plugin.id, ...declaration })
    }
  }
  return rows.sort((a, b) => a.order - b.order)
}

function catalogContent() {
  const rows = catalogRows()
  const indent = (json) => json.split('\n').join('\n  ')
  const editBarRows = rows
    .filter((row) => row.editBarLink)
    .map((row) => ({ pluginId: row.plugin.id, ...row.editBarLink }))
    .sort((a, b) => a.order - b.order)
  const linkOrders = editBarRows.map((row) => row.order)
  if (new Set(linkOrders).size !== linkOrders.length) {
    // Two links sharing an order draw in whichever sequence the config
    // happens to list them, which is not a decision anyone made.
    throw new Error('plugins.config.json: two editBarLink rows share an "order"')
  }
  return (
    `/**
 * GENERATED FILE — do not edit. Regenerate with:
 *   node tools/scripts/generate-plugin-manifests.mjs
 *
 * The switchboard catalog (AGL-3080): one row per plugin and capability, each
 * declared by its own \`catalog\` block in plugins.config.json. The core holds
 * the types and the resolvers in \`enabled-plugins.ts\`; it holds no row.
 */

import type { FirstPartyPlugin, PluginEditBarLink, PublishedSiteImpact } from './enabled-plugins'\nimport type { ResolvedPluginHostCollection } from './plugin-host-collections'\nimport type { ResolvedPluginOrgCapacity } from './plugin-org-capacity'

export const FIRST_PARTY_PLUGINS: readonly FirstPartyPlugin[] = [
${rows.map((row) => `  ${indent(JSON.stringify(row.plugin, null, 2))},`).join('\n')}
]

export const PUBLISHED_SITE_IMPACT: Readonly<Record<string, PublishedSiteImpact>> = {
${rows.map((row) => `  ${JSON.stringify(row.plugin.id)}: ${JSON.stringify(row.impact)},`).join('\n')}
}

/**
 * The admin edit bar's quick links, in the order they are drawn — each
 * declared by the plugin whose console page it opens (AGL-3080).
 */
export const PLUGIN_EDIT_BAR_LINKS: readonly PluginEditBarLink[] = [
${editBarRows.map((row) => `  ${indent(JSON.stringify(row, null, 2))},`).join('\n')}
]

/**
 * Every host subcollection a first-party plugin owns, declared by that plugin
 * (AGL-3080). Core's readers ask this list; core names no collection.
 */
export const PLUGIN_HOST_COLLECTIONS_DECLARED: readonly ResolvedPluginHostCollection[] = [
${hostCollectionRows().map((row) => `  ${indent(JSON.stringify(row, null, 2))},`).join('\n')}
]

/**
 * Every org capacity a first-party plugin backs, declared by that plugin
 * (AGL-3080). Core owns the money; this says what is counted and what it is
 * called.
 */
export const PLUGIN_ORG_CAPACITIES_DECLARED: readonly ResolvedPluginOrgCapacity[] = [
${orgCapacityRows().map((row) => `  ${indent(JSON.stringify(row, null, 2))},`).join('\n')}
]
`
  )
}

const check = process.argv.includes('--check')
const drifted = []

await checkContributions()

const ALL = [
  ...MANIFESTS.map((manifest) => ({
    ...manifest,
    content: expectedContent(manifest.entryPoint, manifest.surfaces, manifest.constName),
  })),
  ...DECLARATION_MANIFESTS.map((manifest) => ({
    ...manifest,
    content: declarationsContent(manifest.surfaces, manifest.constName, manifest.entryPoint),
  })),
  { file: CATALOG_FILE, content: catalogContent() },
  {
    file: SUBPROCESSORS_MANIFEST,
    content: subprocessorsContent(await pluginSubprocessors()),
    describe: describeSubprocessorDrift,
  },
]

for (const { file, content, describe = describeDrift } of ALL) {

  if (!check) {
    writeFileSync(join(ROOT, file), content)
    console.log(`wrote ${file}`)
    continue
  }

  let actual = null
  try {
    actual = readFileSync(join(ROOT, file), 'utf8')
  } catch {
    // Absent counts as drift, not a crash: the fix is the same command.
  }
  if (actual === content) {
    console.log(`ok ${file}`)
    continue
  }
  drifted.push(
    actual === null
      ? `${file}\n  the file does not exist`
      : `${file}\n${describe(content, actual).join('\n')}`,
  )
}

if (check && drifted.length) {
  console.error(
    `\n${drifted.length} plugin manifest(s) no longer match plugins.config.json and the entries it names:\n\n` +
      drifted.join('\n\n') +
      '\n\nThese files are generated. Do not hand-edit them — run:\n' +
      '  node tools/scripts/generate-plugin-manifests.mjs\n' +
      'and commit the result.\n',
  )
  process.exit(1)
}

if (check) console.log(`\n${ALL.length} plugin manifests in sync`)
