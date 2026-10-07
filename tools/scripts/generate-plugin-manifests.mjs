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
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mobileManifestContent, mobileManifestRows } from './lib/mobile-manifest.mjs'
import {
  IOS_MANIFEST_PLUGINS_DIR,
  nativeManifestOutputs,
  nativeManifestRows,
  swiftPluginLinks,
} from './lib/native-manifest.mjs'

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
    // A `.` marks a marketplace plugin's namespace (AGL-3387). A first-party
    // id carrying one would read as a marketplace element to every check
    // that tells the two apart without loading code.
    for (const id of plugin.contributes?.site?.components ?? []) {
      if (id.includes('.')) {
        problems.push(`${plugin.id}: component id "${id}" has a ".", which only marketplace ids carry`)
      }
    }
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

/**
 * The emails a site sends its own customers (AGL-769/770), each declared by
 * the plugin that sends it (AGL-3080): a plugin names a function under
 * `tenantEmails`, and this loads `${package}/tenant-emails` through jiti,
 * calls it, and compiles the answer into the email lib's catalog as data. The
 * readers include the send path (`loadHostEmail`), which loads no plugin
 * code, so a runtime registry would be one it had not filled.
 *
 * Checked here: every entry names its plugin (the console groups by it, and
 * `enabledPlugins` decides whether it is listed), a key is declared once
 * across all plugins (it is the template document id), `control` is one the
 * console knows, and an `external` entry says where its copy is authored.
 */
const TENANT_EMAILS_FILE = 'libs/shared/util/email/src/lib/tenant-emails.generated.ts'
const TENANT_EMAIL_CONTROLS = ['besigner', 'external', 'fixed']

async function pluginTenantEmails() {
  const jiti = jitiForWorkspace()
  const entries = []
  const keys = new Set()
  for (const plugin of config.plugins.filter((entry) => entry.register?.tenantEmails)) {
    const specifier = `${plugin.package}/tenant-emails`
    const fnName = plugin.register.tenantEmails
    const fn = (await jiti.import(specifier))[fnName]
    if (typeof fn !== 'function') throw new Error(`${specifier} exports no function named ${fnName}`)
    const answer = await fn()
    const where = `${specifier}: ${fnName}()`
    if (!Array.isArray(answer)) throw new Error(`${where} is not a list`)
    requireStringFields(answer, ['key', 'name', 'description', 'pluginId', 'plugin', 'control'], where)
    for (const entry of answer) {
      if (entry.pluginId !== plugin.id) {
        throw new Error(`${where}: "${entry.key}" names plugin "${entry.pluginId}"; a plugin declares only its own emails`)
      }
      if (keys.has(entry.key)) throw new Error(`${where}: "${entry.key}" is declared twice`)
      keys.add(entry.key)
      if (!TENANT_EMAIL_CONTROLS.includes(entry.control)) {
        throw new Error(`${where}: "${entry.key}" has control "${entry.control}"; one of ${TENANT_EMAIL_CONTROLS.join(', ')}`)
      }
      if (entry.control === 'external' && !entry.authoredIn) {
        throw new Error(`${where}: "${entry.key}" is external and names no "authoredIn"`)
      }
      entries.push(entry)
    }
  }
  return entries
}

/**
 * The starter sites a plugin offers (AGL-3080): a plugin whose elements a
 * starter is built around names a function under `starterTemplates`, and
 * this loads `${package}/starter-templates` through jiti, calls it, and
 * compiles the starters into core as data, after the platform's own. Their
 * readers — the template gallery, the seed route, the examples a model is
 * shown — load no plugin code, so a runtime registry would be one they had
 * not filled.
 *
 * Checked here: a starter id is declared once across all plugins (it is part
 * of every seeded template's document id), each starter has pages with keys
 * unique to it, and every element a page places is the declaring plugin's or
 * the basic mui bundle's — a starter that placed another plugin's element
 * would seed a page that renders nothing on a site without that plugin.
 */
const STARTER_TEMPLATES_FILE = 'libs/aglyn/src/lib/app-utils/plugin-starter-templates.generated.ts'

async function pluginStarterTemplates() {
  const jiti = jitiForWorkspace()
  const starters = []
  const ids = new Set()
  for (const plugin of config.plugins.filter((entry) => entry.register?.starterTemplates)) {
    const specifier = `${plugin.package}/starter-templates`
    const fnName = plugin.register.starterTemplates
    const fn = (await jiti.import(specifier))[fnName]
    if (typeof fn !== 'function') throw new Error(`${specifier} exports no function named ${fnName}`)
    const answer = await fn()
    const where = `${specifier}: ${fnName}()`
    requireStringFields(answer, ['id', 'displayName', 'description', 'category'], where)
    for (const starter of answer) {
      if (!/^[a-z][a-z0-9-]*$/.test(starter.id)) {
        throw new Error(`${where}: "${starter.id}" is not a lowercase, hyphenated id`)
      }
      if (ids.has(starter.id)) throw new Error(`${where}: starter "${starter.id}" is declared twice`)
      ids.add(starter.id)
      if (!Array.isArray(starter.screens) || !starter.screens.length) {
        throw new Error(`${where}: starter "${starter.id}" has no pages`)
      }
      requireStringFields(starter.screens, ['key', 'displayName', 'slug'], `${where} "${starter.id}" pages`)
      const keys = new Set()
      for (const screen of starter.screens) {
        if (keys.has(screen.key)) throw new Error(`${where}: "${starter.id}" has two pages keyed "${screen.key}"`)
        keys.add(screen.key)
        for (const node of Object.values(screen.nodes ?? {})) {
          const owner = node?.pluginId
          if (owner !== undefined && owner !== plugin.id && owner !== 'mui') {
            throw new Error(
              `${where}: "${starter.id}/${screen.key}" places "${node.componentId}" from "${owner}"; ` +
                `a starter places only its own plugin's elements and mui's`,
            )
          }
        }
      }
      starters.push(starter)
    }
  }
  return starters
}

function starterTemplatesContent(starters) {
  return (
    `/**\n * GENERATED FILE — do not edit. Regenerate with:\n` +
    ` *   node tools/scripts/generate-plugin-manifests.mjs\n *\n` +
    ` * The starter sites plugins offer (AGL-3080): what each plugin's\n` +
    ` * \`starterTemplates\` entry returned when this file was generated, in\n` +
    ` * config order. \`STARTER_TEMPLATES\` in \`starter-templates.ts\` is the\n` +
    ` * platform's own starters followed by these.\n` +
    ` * Source of truth: plugins.config.json and the entries it names.\n */\n\n` +
    `import type { StarterTemplate } from './starter-template-nodes'\n\n` +
    `export const PLUGIN_STARTER_TEMPLATES: readonly StarterTemplate[] = ` +
    `${JSON.stringify(starters, null, 2)}\n`
  )
}

function tenantEmailsContent(entries) {
  return (
    `/**\n * GENERATED FILE — do not edit. Regenerate with:\n` +
    ` *   node tools/scripts/generate-plugin-manifests.mjs\n *\n` +
    ` * The emails sites send their own customers (AGL-3080): what each plugin's\n` +
    ` * \`tenantEmails\` entry returned when this file was generated, in config\n` +
    ` * order. \`TENANT_EMAILS\` in \`tenant-email-catalog.ts\` is this list.\n` +
    ` * Source of truth: plugins.config.json and the entries it names.\n */\n\n` +
    `import type { TenantEmailEntry } from './tenant-email-catalog'\n\n` +
    `export const PLUGIN_TENANT_EMAILS: readonly TenantEmailEntry[] = ` +
    `${JSON.stringify(entries, null, 2)}\n`
  )
}

/**
 * The video hosts whose own player the Video element frames (AGL-3080), each
 * declared by the plugin that plays them: a plugin names a function under
 * `videoEmbedProviders`, and this loads `${package}/video-embed-providers`
 * through jiti, calls it, and compiles the answer into the catalog file as
 * data. The readers are the published page and the tenant middleware's
 * `frame-src`, neither of which loads plugin code, so a runtime registry
 * would be one they had not filled (core `video-embed-provider.ts`).
 *
 * Checked here, because a declaration widens every published page's
 * `frame-src`:
 *
 *  - ONE HOST, ONE DECLARATION: an id or a domain claimed twice would leave a
 *    link's player to config order.
 *  - A CLOSED PLAYER: an https origin with no path, and a player path with
 *    exactly one `{id}` and no query or fragment, so every frame is on the
 *    declared origin.
 *  - PATTERNS THAT COMPILE, anchored at both ends, each path pattern with a
 *    capture group for the id.
 *  - A QUERY core can build: each parameter is a constant `value`, or an
 *    `option` core knows with an `on` or `off` spelling.
 */
const VIDEO_EMBED_OPTIONS = ['autoPlay', 'doNotTrack', 'muted', 'loop']
const PLAIN_DOMAIN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/

function anchoredPattern(source, what) {
  if (typeof source !== 'string' || !source.startsWith('^') || !source.endsWith('$')) {
    throw new Error(`${what} is a regular expression anchored with ^ and $`)
  }
  try {
    return new RegExp(source)
  } catch (error) {
    throw new Error(`${what} does not compile: ${error.message}`, { cause: error })
  }
}

async function pluginVideoEmbedProviders() {
  const declaring = config.plugins.filter((plugin) => plugin.register?.videoEmbedProviders)
  if (!declaring.length) return []
  const jiti = jitiForWorkspace()
  const rows = []
  const ids = new Map()
  const domains = new Map()
  for (const plugin of declaring) {
    const specifier = `${plugin.package}/video-embed-providers`
    const fnName = plugin.register.videoEmbedProviders
    const fn = (await jiti.import(specifier))[fnName]
    if (typeof fn !== 'function') {
      throw new Error(`${specifier} exports no function named ${fnName}`)
    }
    const answer = await fn()
    const where = `${specifier}: ${fnName}()`
    if (!Array.isArray(answer) || !answer.length) {
      throw new Error(`${where} declares no host — drop the entry, or declare one`)
    }
    for (const declaration of answer) {
      const { id, label, domains: declaredDomains, mediaIdPaths, mediaIdPattern, playerOrigin, playerPath, playerQuery = [] } =
        declaration ?? {}
      const what = `${where} "${id ?? ''}"`
      if (typeof id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(id)) throw new Error(`${where}: a host needs an "id" of lowercase letters, digits and dashes`)
      const heldId = ids.get(id)
      if (heldId) throw new Error(`${what} is already declared by "${heldId}"`)
      ids.set(id, plugin.id)
      if (typeof label !== 'string' || !label.trim()) throw new Error(`${what} needs a "label"`)
      if (!Array.isArray(declaredDomains) || !declaredDomains.length) throw new Error(`${what} needs "domains"`)
      for (const domain of declaredDomains) {
        if (typeof domain !== 'string' || !PLAIN_DOMAIN.test(domain)) {
          throw new Error(`${what}: "${domain}" is not a plain lowercase domain`)
        }
        const heldDomain = domains.get(domain)
        if (heldDomain) throw new Error(`${what}: domain "${domain}" is already declared by "${heldDomain}"`)
        domains.set(domain, id)
      }
      if (!Array.isArray(mediaIdPaths) || !mediaIdPaths.length) throw new Error(`${what} needs "mediaIdPaths"`)
      for (const source of mediaIdPaths) {
        const pattern = anchoredPattern(source, `${what} mediaIdPaths "${source}"`)
        if (new RegExp(`${pattern.source}|`).exec('').length < 2) {
          throw new Error(`${what} mediaIdPaths "${source}" has no capture group for the media id`)
        }
      }
      anchoredPattern(mediaIdPattern, `${what} mediaIdPattern`)
      let origin
      try {
        origin = new URL(playerOrigin).origin
      } catch {
        origin = undefined
      }
      if (origin !== playerOrigin || !playerOrigin.startsWith('https://')) {
        throw new Error(`${what}: "playerOrigin" is an https origin with no path, e.g. https://player.example.net`)
      }
      if (
        typeof playerPath !== 'string' ||
        !playerPath.startsWith('/') ||
        /[?#]/.test(playerPath) ||
        playerPath.split('{id}').length !== 2
      ) {
        throw new Error(`${what}: "playerPath" begins with "/", names "{id}" once, and carries no query or fragment`)
      }
      if (!Array.isArray(playerQuery)) throw new Error(`${what}: "playerQuery" is a list`)
      for (const entry of playerQuery) {
        const param = `${what} playerQuery "${entry?.param ?? ''}"`
        if (typeof entry?.param !== 'string' || !entry.param) throw new Error(`${what}: a playerQuery entry needs a "param"`)
        if ('value' in entry) {
          if (typeof entry.value !== 'string' || 'option' in entry) throw new Error(`${param}: a constant is one string "value" and no "option"`)
          continue
        }
        if (!VIDEO_EMBED_OPTIONS.includes(entry.option)) {
          throw new Error(`${param}: "option" is one of ${VIDEO_EMBED_OPTIONS.join(', ')}`)
        }
        const spellings = ['on', 'off'].filter((state) => entry[state] !== undefined)
        if (!spellings.length || spellings.some((state) => typeof entry[state] !== 'string')) {
          throw new Error(`${param}: an option spells "on", "off" or both as strings`)
        }
      }
      rows.push({ pluginId: plugin.id, ...declaration })
    }
  }
  return rows.sort((a, b) => a.id.localeCompare(b.id))
}

/**
 * What each plan includes of a plugin's own keys (AGL-3080), declared by the
 * plugin that owns them: a plugin names a function under `planEntitlements`,
 * and this loads `${package}/plan-entitlements` through jiti, calls it, and
 * compiles the answer into the catalog file as data. Core's
 * `PLAN_ENTITLEMENTS` composes it, and the readers include the published
 * pricing tables and the plan comparison, neither of which loads a plugin —
 * so a runtime registry would be one they had not filled
 * (core `plugin-plan-entitlements.ts`).
 *
 * Checked here, because every figure is on a price list:
 *
 *  - ONE KEY, ONE OWNER, across quotas and features alike: two meanings for
 *    one stored value would leave the plan table choosing by config order.
 *  - EVERY PLAN, THE SAME PLANS: each declaration names the same plans as
 *    every other, and the generated rows are typed `Record<OrgPlan, …>`, so
 *    a plan left out or misspelled does not compile.
 *  - A FIGURE THAT MEANS SOMETHING: a quota is a non-negative number, finite
 *    or `Infinity` (`UNLIMITED`); a feature is a boolean. `NaN`, a string or
 *    a negative would each read as a different answer in a different gate.
 */
const PLAIN_KEY = /^[a-z][A-Za-z0-9]*$/

async function pluginPlanEntitlements() {
  const declaring = config.plugins.filter((plugin) => plugin.register?.planEntitlements)
  const quotas = []
  const features = []
  if (!declaring.length) return { quotas, features }
  const jiti = jitiForWorkspace()
  const owners = new Map()
  let plans = null
  const checkPlans = (byPlan, what) => {
    if (!byPlan || typeof byPlan !== 'object' || Array.isArray(byPlan)) {
      throw new Error(`${what} needs "byPlan", one entry per plan`)
    }
    const names = Object.keys(byPlan).sort()
    if (!names.length) throw new Error(`${what}: "byPlan" names no plan`)
    if (plans === null) plans = names
    else if (names.join() !== plans.join()) {
      throw new Error(`${what}: "byPlan" names ${names.join(', ')}, where every other declaration names ${plans.join(', ')}`)
    }
  }
  for (const plugin of declaring) {
    const specifier = `${plugin.package}/plan-entitlements`
    const fnName = plugin.register.planEntitlements
    const fn = (await jiti.import(specifier))[fnName]
    if (typeof fn !== 'function') {
      throw new Error(`${specifier} exports no function named ${fnName}`)
    }
    const answer = (await fn()) ?? {}
    const where = `${specifier}: ${fnName}()`
    const declaredQuotas = answer.quotas ?? []
    const declaredFeatures = answer.features ?? []
    if (!Array.isArray(declaredQuotas) || !Array.isArray(declaredFeatures)) {
      throw new Error(`${where}: "quotas" and "features" are lists`)
    }
    if (!declaredQuotas.length && !declaredFeatures.length) {
      throw new Error(`${where} declares nothing — drop the entry, or declare a key`)
    }
    for (const [kind, list, out] of [
      ['quota', declaredQuotas, quotas],
      ['feature', declaredFeatures, features],
    ]) {
      for (const declaration of list) {
        const { key, label, byPlan, price } = declaration ?? {}
        const what = `${where} ${kind} "${key ?? ''}"`
        if (typeof key !== 'string' || !PLAIN_KEY.test(key)) {
          throw new Error(`${where}: a ${kind} needs a plain camelCase "key"`)
        }
        const held = owners.get(key)
        if (held) throw new Error(`${what} is already declared by "${held}" — one key has one owner`)
        owners.set(key, plugin.id)
        if (typeof label !== 'string' || !label.trim()) throw new Error(`${what} needs a "label"`)
        checkPlans(byPlan, what)
        for (const [plan, value] of Object.entries(byPlan)) {
          const valid =
            kind === 'quota'
              ? typeof value === 'number' && value >= 0 && (Number.isFinite(value) || value === Infinity)
              : typeof value === 'boolean'
          if (!valid) {
            throw new Error(
              `${what}: "${plan}" is ${JSON.stringify(value)}; a ${kind} is ` +
                (kind === 'quota' ? 'a non-negative number, or Infinity for UNLIMITED' : 'true or false'),
            )
          }
        }
        if (price !== undefined && (kind !== 'quota' || typeof price !== 'boolean')) {
          throw new Error(`${what}: "price" is a boolean, and only on a quota`)
        }
        out.push({
          pluginId: plugin.id,
          key,
          label,
          ...(price ? { price: true } : {}),
          byPlan: Object.fromEntries(Object.keys(byPlan).map((plan) => [plan, byPlan[plan]])),
        })
      }
    }
  }
  return { quotas, features }
}

/**
 * The meters a plugin contributes to the platform's cost model, its
 * utilization table and the usage budget's spend (AGL-3080): a plugin names a
 * function under `usageAxes`,
 * and this loads `${package}/usage-axes`, calls it, and compiles the answer
 * into the catalog file as data (core `plugin-usage-axes.ts`). The readers
 * include the discount guardrail and the staff org page, which prices a
 * rollup in the browser, so a registry they had not filled would price the
 * plugin's meter at nothing — the approving direction.
 *
 * Checked here: plain ids and field names, one owner per axis and per band
 * and never one of core's own, an order no other axis or band holds, and a
 * rate KEY rather than a number — the rates stay in core's
 * `ORG_COGS_UNIT_RATES_USD`, and `plugin-usage-axes.spec.ts` holds every
 * declared key to a rate that exists there. A spend line names its month
 * document, the variable holding the month it is first charged for, and — when
 * the stored dollars are not the customer's to see — the unit shown instead.
 * A metered band names a rate KEY of the console's `METERED_UNIT_RATES_USD`
 * (`usage-metering.spec.ts` holds it to one that exists), one field and the
 * host counter it is measured by. A meter names only its id: its code is
 * registered at runtime, and the declaration is what lets the sweep notice
 * when it was not.
 */
const CORE_COST_AXIS_ORDERS = { storage: 10, pageViews: 20, dataStorage: 40, apiRequests: 50, emailSends: 70 }
const CORE_USAGE_BAND_ORDERS = { hosts: 10, storageGb: 20, pageViews: 30, dataStorageMb: 50, apiRequests: 60, emailSends: 80 }
const PLAIN_NAME = /^[A-Za-z][A-Za-z0-9]*$/

function plainNames(list, what, { optional = false } = {}) {
  if (list === undefined && optional) return
  if (!Array.isArray(list) || (!optional && !list.length) || !list.every((name) => typeof name === 'string' && PLAIN_NAME.test(name))) {
    throw new Error(`${what} is a list of plain field names`)
  }
}

async function pluginUsageAxes() {
  const declaring = config.plugins.filter((plugin) => plugin.register?.usageAxes)
  const costAxes = []
  const bands = []
  const spendLines = []
  const meters = []
  if (!declaring.length) return { costAxes, bands, spendLines, meters }
  const jiti = jitiForWorkspace()
  const axisOwners = new Map(Object.keys(CORE_COST_AXIS_ORDERS).map((id) => [id, 'the platform']))
  const bandOwners = new Map(Object.keys(CORE_USAGE_BAND_ORDERS).map((id) => [id, 'the platform']))
  const spendOwners = new Map()
  const axisOrders = new Map(Object.entries(CORE_COST_AXIS_ORDERS).map(([id, order]) => [order, id]))
  const bandOrders = new Map(Object.entries(CORE_USAGE_BAND_ORDERS).map(([id, order]) => [order, id]))
  for (const plugin of declaring) {
    const specifier = `${plugin.package}/usage-axes`
    const fnName = plugin.register.usageAxes
    const fn = (await jiti.import(specifier))[fnName]
    if (typeof fn !== 'function') throw new Error(`${specifier} exports no function named ${fnName}`)
    const answer = (await fn()) ?? {}
    const where = `${specifier}: ${fnName}()`
    const declaredAxes = answer.costAxes ?? []
    const declaredBands = answer.bands ?? []
    const declaredSpend = answer.spendLines ?? []
    const declaredMeters = answer.meters ?? []
    if (!Array.isArray(declaredAxes) || !Array.isArray(declaredBands) || !Array.isArray(declaredSpend) || !Array.isArray(declaredMeters)) {
      throw new Error(`${where}: "costAxes", "bands", "spendLines" and "meters" are lists`)
    }
    if (!declaredAxes.length && !declaredBands.length && !declaredSpend.length && !declaredMeters.length) {
      throw new Error(`${where} declares nothing — drop the entry, or declare a meter`)
    }
    for (const axis of declaredAxes) {
      const { id, order, fields, fallbackFields, recordedFields, staffFields, rate, live } = axis ?? {}
      const what = `${where} cost axis "${id ?? ''}"`
      if (typeof id !== 'string' || !PLAIN_NAME.test(id)) throw new Error(`${where}: a cost axis needs a plain "id"`)
      if (axisOwners.has(id)) throw new Error(`${what} is already priced by ${axisOwners.get(id)}`)
      axisOwners.set(id, `"${plugin.id}"`)
      if (!Number.isInteger(order)) throw new Error(`${what} needs an integer "order"`)
      if (axisOrders.has(order)) throw new Error(`${what}: "order" ${order} is already taken by "${axisOrders.get(order)}"`)
      axisOrders.set(order, id)
      plainNames(fields, `${what} "fields"`)
      plainNames(fallbackFields, `${what} "fallbackFields"`, { optional: true })
      plainNames(recordedFields, `${what} "recordedFields"`, { optional: true })
      plainNames(staffFields, `${what} "staffFields"`, { optional: true })
      // A field the model reads is never also one staff alone is served: the
      // projection would answer it twice, with two meanings of "absent".
      const modelFields = [...fields, ...(fallbackFields ?? []), ...(recordedFields ?? [])]
      const both = (staffFields ?? []).filter((field) => modelFields.includes(field))
      if (both.length) throw new Error(`${what}: "staffFields" repeats a field the cost model reads: ${both.join(', ')}`)
      if (rate !== undefined && (typeof rate !== 'string' || !PLAIN_NAME.test(rate))) {
        throw new Error(`${what}: "rate" names a key of ORG_COGS_UNIT_RATES_USD, never a number`)
      }
      if (live !== undefined) {
        if (typeof live?.collection !== 'string' || !PLAIN_NAME.test(live.collection)) {
          throw new Error(`${what}: "live.collection" is the plain name of an org subcollection`)
        }
        plainNames(live.fields, `${what} "live.fields"`)
      }
      costAxes.push({ pluginId: plugin.id, ...axis })
    }
    for (const band of declaredBands) {
      const { id, label, order, fields, fallbackFields, entitlement, perHost, unitCostUsd, hostCounter, orgCounter, alert, metered, consoleWarning } = band ?? {}
      const what = `${where} band "${id ?? ''}"`
      if (typeof id !== 'string' || !PLAIN_NAME.test(id)) throw new Error(`${where}: a band needs a plain "id"`)
      if (bandOwners.has(id)) throw new Error(`${what} is already measured by ${bandOwners.get(id)}`)
      bandOwners.set(id, `"${plugin.id}"`)
      if (typeof label !== 'string' || !label.trim()) throw new Error(`${what} needs a "label"`)
      if (!Number.isInteger(order)) throw new Error(`${what} needs an integer "order"`)
      if (bandOrders.has(order)) throw new Error(`${what}: "order" ${order} is already taken by "${bandOrders.get(order)}"`)
      bandOrders.set(order, id)
      plainNames(fields, `${what} "fields"`)
      plainNames(fallbackFields, `${what} "fallbackFields"`, { optional: true })
      if (typeof entitlement !== 'string' || !PLAIN_NAME.test(entitlement)) {
        throw new Error(`${what} needs the "entitlement" holding what a plan includes`)
      }
      if (perHost !== undefined && typeof perHost !== 'boolean') throw new Error(`${what}: "perHost" is a boolean`)
      if (unitCostUsd !== undefined && !(typeof unitCostUsd === 'number' && Number.isFinite(unitCostUsd) && unitCostUsd > 0)) {
        throw new Error(`${what}: "unitCostUsd" is a positive number of dollars`)
      }
      if (hostCounter !== undefined && (typeof hostCounter !== 'string' || !PLAIN_NAME.test(hostCounter))) {
        throw new Error(`${what}: "hostCounter" is the plain name of the per-site counter holding the month's figure`)
      }
      if (orgCounter !== undefined && (typeof orgCounter !== 'string' || !PLAIN_NAME.test(orgCounter))) {
        throw new Error(`${what}: "orgCounter" is the plain name of the workspace-wide counter the band is enforced against`)
      }
      if (
        alert !== undefined &&
        (['label', 'noun', 'reached', 'approach'].some((field) => typeof alert?.[field] !== 'string' || !alert[field].trim()) ||
          !['stops', 'bills', 'continues'].includes(alert?.outcome))
      ) {
        throw new Error(`${what}: "alert" is { label, noun, outcome, reached, approach }: the band's name in the title and the sentence, stops/bills/continues, and the words at the band and approaching it`)
      }
      if (alert !== undefined && hostCounter === undefined) {
        throw new Error(`${what}: "alert" needs the "hostCounter" the band is measured by`)
      }
      if (consoleWarning !== undefined) {
        const { standing, member, approach, reached, linksUsage } = consoleWarning ?? {}
        if (typeof standing !== 'string' || !/^\/api\/[a-z0-9/-]+$/.test(standing)) {
          throw new Error(`${what}: "consoleWarning.standing" is the console API path the band's standing is read from`)
        }
        if (typeof member !== 'string' || !PLAIN_NAME.test(member)) {
          throw new Error(`${what}: "consoleWarning.member" is the plain name the route answers the standing under`)
        }
        if ([approach, reached?.stops, reached?.bills].some((sentence) => typeof sentence !== 'string' || !sentence.trim())) {
          throw new Error(`${what}: "consoleWarning" needs its "approach" sentence and the two at the band, "reached.stops" and "reached.bills"`)
        }
        if (linksUsage !== undefined && typeof linksUsage !== 'boolean') {
          throw new Error(`${what}: "consoleWarning.linksUsage" is a boolean`)
        }
      }
      if (metered !== undefined) {
        const { rate, quotedPer, noun, withheldUntil } = metered ?? {}
        if (typeof rate !== 'string' || !PLAIN_NAME.test(rate)) {
          throw new Error(`${what}: "metered.rate" names a key of METERED_UNIT_RATES_USD, never a number`)
        }
        if (!Number.isInteger(quotedPer) || quotedPer < 1) throw new Error(`${what}: "metered.quotedPer" is the whole count a price is quoted per`)
        if (typeof noun !== 'string' || !noun.trim()) throw new Error(`${what}: "metered.noun" is the band in running prose`)
        if (withheldUntil !== undefined && (typeof withheldUntil !== 'string' || !/^release_[a-z0-9_]+$/.test(withheldUntil))) {
          throw new Error(`${what}: "metered.withheldUntil" is the key of the release flag the overage waits behind`)
        }
        // One field and its counter: the invoice sums one figure per site, and
        // the rollup records it, and its billed/withheld pair, by that name.
        if (fields.length !== 1 || fallbackFields !== undefined) {
          throw new Error(`${what}: a metered band records one field, with no fallback`)
        }
        if (hostCounter === undefined) throw new Error(`${what}: "metered" needs the "hostCounter" the band is measured by`)
        if (unitCostUsd !== undefined) throw new Error(`${what}: a metered band counts units, so it has no "unitCostUsd"`)
        // The estimate keys each meter's charge beside the platform's two.
        if (['storage', 'pageViews'].includes(id)) throw new Error(`${what}: "${id}" is a platform meter's name`)
      }
      bands.push({ pluginId: plugin.id, ...band })
    }
    for (const line of declaredSpend) {
      const { id, label, live, billedFromEnv, unit } = line ?? {}
      const what = `${where} spend line "${id ?? ''}"`
      if (typeof id !== 'string' || !PLAIN_NAME.test(id)) throw new Error(`${where}: a spend line needs a plain "id"`)
      if (spendOwners.has(id)) throw new Error(`${what} is already declared by ${spendOwners.get(id)}`)
      spendOwners.set(id, `"${plugin.id}"`)
      if (typeof label !== 'string' || !label.trim()) throw new Error(`${what} needs a "label"`)
      if (typeof live?.collection !== 'string' || !PLAIN_NAME.test(live.collection) || typeof live?.field !== 'string' || !PLAIN_NAME.test(live.field)) {
        throw new Error(`${what}: "live" is { collection, field }, the org subcollection and the dollar field of its month document`)
      }
      if (typeof billedFromEnv !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(billedFromEnv)) {
        throw new Error(`${what}: "billedFromEnv" is the name of the deployment variable holding the first month it is charged for`)
      }
      if (unit !== undefined) {
        if (!(typeof unit?.costUsd === 'number' && Number.isFinite(unit.costUsd) && unit.costUsd > 0) || typeof unit?.label !== 'string' || !unit.label.trim()) {
          throw new Error(`${what}: "unit" is { costUsd, label }, a positive number of dollars and what the customer calls the unit`)
        }
      }
      spendLines.push({ pluginId: plugin.id, ...line })
    }
    for (const meter of declaredMeters) {
      const id = meter?.id
      if (typeof id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(id)) throw new Error(`${where}: a meter needs a plain lowercase "id"`)
      if (meters.some((one) => one.pluginId === plugin.id && one.id === id)) throw new Error(`${where}: meter "${id}" is declared twice`)
      meters.push({ pluginId: plugin.id, id })
    }
  }
  return {
    costAxes: costAxes.sort((a, b) => a.order - b.order),
    bands: bands.sort((a, b) => a.order - b.order),
    spendLines,
    meters,
  }
}

/**
 * One row as TypeScript source. JSON cannot spell `Infinity`, and a quota
 * that reads `null` in the generated file would be a band of zero to every
 * reader, so the one value JSON loses is written as the literal it is.
 */
function literalRow(row) {
  return JSON.stringify(row, (_key, value) => (value === Infinity ? '__INFINITY__' : value), 2).replace(
    /"__INFINITY__"/g,
    'Infinity',
  )
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
 * The console's tab titles for plugin surfaces (AGL-2184, compiled since
 * AGL-3080): each surface's name and the names of the sections on its rail,
 * as the plugins that draw them declare them.
 *
 * The reader is a SERVER layout, and reaching the console registry there
 * drags every nav item's client component into the server compile, so the
 * layout reads this data file instead of the registry. It is read from the
 * plugins' source rather than their runtime registration for the same reason
 * `plugin-page-title.spec.ts` reads it that way: nothing here can load a
 * console registrar.
 *
 *  - A nav item's `label` and `href` (`plugin.ts`) name a surface.
 *  - A nav item's `sections` const names its rail, and the
 *    `*-console-sections.ts` that exports it is plain data, loaded as such.
 *  - A nav item's `recordTitle` (AGL-3596) names the page of one record
 *    beneath a surface that owns its subtree.
 *
 * A surface or a section named two different ways is refused: the tab could
 * follow only one of them.
 */
const TITLES_MANIFEST = 'apps/console/constants/plugins.titles.generated.ts'
const NAV_LABEL = /label:\s*'([^']+)',[\s\S]{0,200}?href:\s*'\/([a-z0-9-]+)'/g
const NAV_SECTIONS = /href:\s*'\/([a-z0-9-]+)',[\s\S]{0,600}?sections:\s*([A-Z_]+)/g
const NAV_RECORD_TITLE = /href:\s*'\/([a-z0-9-]+)',[\s\S]{0,300}?recordTitle:\s*'([^']+)'/g

/** Every file beneath `dir` whose name `keep` accepts. */
function filesBeneath(dir, keep) {
  const found = []
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry)
    if (statSync(abs).isDirectory()) {
      if (entry !== 'node_modules') found.push(...filesBeneath(abs, keep))
    } else if (keep(entry)) found.push(abs)
  }
  return found
}

async function pluginSurfaceTitles() {
  const aliases = workspaceAliases()
  const jiti = jitiForWorkspace()
  const titles = new Map()
  const sections = new Map()
  const records = new Map()
  const claim = (map, key, value, where) => {
    const held = map.get(key)
    if (held !== undefined && held !== value) {
      throw new Error(`${where}: "${key}" is named both "${held}" and "${value}"`)
    }
    map.set(key, value)
  }
  for (const plugin of config.plugins) {
    const entry = aliases[plugin.package]
    if (!entry || !plugin.register?.console) continue
    const root = entry.slice(0, entry.lastIndexOf('/src/') + '/src'.length)
    const lists = new Map()
    for (const file of filesBeneath(root, (name) => name.endsWith('-console-sections.ts'))) {
      for (const [name, value] of Object.entries(await jiti.import(file))) {
        if (Array.isArray(value)) lists.set(name, value)
      }
    }
    for (const file of filesBeneath(root, (name) => name === 'plugin.ts')) {
      const source = readFileSync(file, 'utf8')
      const where = file.slice(ROOT.length + 1)
      for (const [, label, slug] of source.matchAll(NAV_LABEL)) {
        claim(titles, slug, label, where)
      }
      for (const [, slug, recordTitle] of source.matchAll(NAV_RECORD_TITLE)) {
        claim(records, slug, recordTitle, where)
      }
      for (const [, slug, constName] of source.matchAll(NAV_SECTIONS)) {
        const list = lists.get(constName)
        if (!list) throw new Error(`${where}: /${slug} names sections ${constName}, which no *-console-sections.ts beside it exports`)
        if (!sections.has(slug)) sections.set(slug, new Map())
        for (const { id, label } of list) claim(sections.get(slug), id, label, `${where} /${slug}`)
      }
    }
  }
  return { titles, sections, records }
}

/** The titles manifest, byte for byte. */
function titlesContent({ titles, sections, records }) {
  const key = (name) => (/^[a-z][a-z0-9]*$/i.test(name) ? name : `'${name}'`)
  const quote = (text) => `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
  const sorted = (map) => [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  const titleRows = sorted(titles).map(([slug, label]) => `  ${key(slug)}: ${quote(label)},\n`).join('')
  const recordRows = sorted(records).map(([slug, label]) => `  ${key(slug)}: ${quote(label)},\n`).join('')
  const sectionRows = sorted(sections)
    .map(
      ([slug, list]) =>
        `  ${key(slug)}: {\n` +
        [...list.entries()].map(([id, label]) => `    ${key(id)}: ${quote(label)},\n`).join('') +
        `  },\n`,
    )
    .join('')
  return (
    `/**\n * GENERATED FILE — do not edit. Regenerate with:\n` +
    ` *   node tools/scripts/generate-plugin-manifests.mjs\n *\n` +
    ` * The plugin surfaces' tab titles (AGL-2184): each surface's name, and the\n` +
    ` * sections on its rail, as the plugins' nav items and section lists name\n` +
    ` * them. Data for the console's server layouts, which cannot load the\n` +
    ` * console registry. Source of truth: the plugins in plugins.config.json.\n */\n\n` +
    `/** A surface's display name, by its URL slug. */\n` +
    `export const PLUGIN_SURFACE_TITLES: Readonly<Record<string, string>> = {\n${titleRows}}\n\n` +
    `/** The sections a surface's rail declares, id to display name, by the surface's URL slug. */\n` +
    `export const PLUGIN_SURFACE_SECTIONS: Readonly<\n  Record<string, Readonly<Record<string, string>>>\n> = {\n${sectionRows}}\n\n` +
    `/** The noun for one record's page beneath a surface that owns its subtree, by the surface's URL slug. */\n` +
    `export const PLUGIN_SURFACE_RECORD_TITLES: Readonly<Record<string, string>> = {\n${recordRows}}\n`
  )
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

/**
 * The first-party elements that run a site function, each declared by its own
 * plugin's `contributes.site.functionBindings` (AGL-3393). Compose reads this
 * without loading any plugin, the way it reads a marketplace manifest.
 */
function functionBindingRows() {
  const rows = {}
  for (const plugin of config.plugins) {
    const declared = plugin.contributes?.site?.functionBindings ?? {}
    for (const [componentId, prop] of Object.entries(declared)) {
      if (componentId in rows) {
        throw new Error(`plugins.config.json: "${componentId}" has a function binding in two plugins`)
      }
      rows[componentId] = prop
    }
  }
  return Object.fromEntries(Object.entries(rows).sort(([a], [b]) => a.localeCompare(b)))
}

function catalogRows() {
  const rows = []
  for (const plugin of config.plugins) {
    for (const source of [plugin, ...(plugin.capabilities ?? [])]) {
      if (!source.catalog) continue
      const { order, publishedSiteImpact, editBarLink, releaseFlagDefinition: _flag, $comment: _note, ...fields } = source.catalog
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
 * The release flags plugins declare (AGL-422, compiled since AGL-3080). A
 * catalog row that names a `releaseFlag` defines it beside the name — the
 * label and description the staff Feature Flags page shows, the fallback
 * verdict, the nav tab it hides — and core's `RELEASE_FLAGS` folds the
 * compiled rows in ahead of the platform's own flags, so adding a plugin
 * edits no core file. Compiled rather than registered: the flag gates the
 * plugin LOADER itself, so a registry could only be filled by the code it
 * decides whether to load.
 *
 * Written to a file of its own, beside the one module that reads it: the
 * descriptions are staff copy, and the catalog rides on every published page.
 */
const RELEASE_FLAGS_FILE = 'libs/aglyn/src/lib/app-utils/plugin-release-flags.generated.ts'
const HOST_EVENTS_FILE = 'libs/aglyn/src/lib/app-utils/plugin-host-events.generated.ts'
const RELEASE_FLAG_KEY = /^release_[a-z0-9_]+$/

function releaseFlagRows() {
  const rows = []
  for (const plugin of config.plugins) {
    for (const source of [plugin, ...(plugin.capabilities ?? [])]) {
      const key = source.catalog?.releaseFlag
      const definition = source.catalog?.releaseFlagDefinition
      const where = `plugins.config.json: "${source.id}" catalog`
      if (!key) {
        if (definition) throw new Error(`${where} defines a release flag without naming one in "releaseFlag"`)
        continue
      }
      if (!RELEASE_FLAG_KEY.test(key)) throw new Error(`${where}: "releaseFlag" ${key} is not a release_* key`)
      if (!definition) throw new Error(`${where} names ${key} but no "releaseFlagDefinition" defines it`)
      const { label, description, defaultEnabled, navTabId } = definition
      if (typeof label !== 'string' || !label) throw new Error(`${where} releaseFlagDefinition needs a "label"`)
      if (typeof description !== 'string' || !description) throw new Error(`${where} releaseFlagDefinition needs a "description"`)
      if (typeof defaultEnabled !== 'boolean') throw new Error(`${where} releaseFlagDefinition needs a boolean "defaultEnabled"`)
      if (navTabId !== undefined && (typeof navTabId !== 'string' || !navTabId)) {
        throw new Error(`${where} releaseFlagDefinition: "navTabId" is a nav tab id`)
      }
      rows.push({ order: source.catalog.order, flag: { key, label, description, defaultEnabled, ...(navTabId ? { navTabId } : {}) } })
    }
  }
  rows.sort((a, b) => a.order - b.order)
  const keys = rows.map((row) => row.flag.key)
  if (new Set(keys).size !== keys.length) throw new Error('plugins.config.json: a release flag is named by two catalog rows')
  return rows.map((row) => row.flag)
}

function releaseFlagsContent(flags) {
  const keys = flags.map((flag) => `  | '${flag.key}'`).join('\n')
  return (
    `/**\n * GENERATED FILE — do not edit. Regenerate with:\n` +
    ` *   node tools/scripts/generate-plugin-manifests.mjs\n *\n` +
    ` * The release flags plugins declare (AGL-3080): each catalog row's\n` +
    ` * \`releaseFlagDefinition\` in plugins.config.json, in catalog order. Core's\n` +
    ` * \`release-flags.ts\` folds them into \`RELEASE_FLAGS\`.\n */\n\n` +
    `import type { PluginReleaseFlagDefinition } from './release-flags'\n\n` +
    `/** Every release flag a plugin declares. */\n` +
    `export type PluginReleaseFlagKey =\n${keys || "  never"}\n\n` +
    `export const PLUGIN_RELEASE_FLAGS: readonly PluginReleaseFlagDefinition[] = ` +
    `${JSON.stringify(flags, null, 2)}\n`
  )
}

/**
 * The events a site's server doors raise, that the platform itself does not
 * (`pageView` is core's own, in core `host-events.ts`). Mirrored here so a
 * declaration cannot take one over: the type is what every stored trigger
 * names, and a plugin claiming `pageView` would redirect every automation
 * that starts on a page view.
 */
const CORE_HOST_EVENTS = [{ type: 'pageView', order: 20 }]

/**
 * The host events (AGL-3080): each plugin whose server doors call
 * `emitHostEvent` declares the events they raise under `hostEvents` — the
 * `type` a trigger stores, its `order` in every trigger picker, the `label`
 * a picker and a run row show, the `payloadKeys` it puts in scope, and
 * `recipientActed` when the event is the recipient's own action (AGL-3458). They
 * are compiled into a file of their own beside `host-events.ts`, the one
 * module that reads them, because the event bus, the pickers and the
 * validators read them with no plugin loaded and a catalog reader has no use
 * for them.
 *
 * Checked here: a plain type a trigger can store (a custom event's grammar,
 * so the validator takes it) that no other plugin and not the core declares,
 * a whole-number order no other event holds, a label, plain payload keys,
 * `recipientActed: true` or nothing, and nothing else but a `$comment`.
 */
function hostEventRows() {
  const plain = /^[a-z][A-Za-z0-9]{1,39}$/
  const types = new Map(CORE_HOST_EVENTS.map((event) => [event.type, 'the core']))
  const orders = new Map(CORE_HOST_EVENTS.map((event) => [event.order, `the core's "${event.type}"`]))
  const rows = []
  for (const plugin of config.plugins) {
    const declared = plugin.hostEvents
    if (declared === undefined) continue
    const where = `plugins.config.json: "${plugin.id}" hostEvents`
    if (!Array.isArray(declared) || !declared.length) {
      throw new Error(`${where} is present and declares nothing — drop it, or name the events the plugin raises`)
    }
    for (const event of declared) {
      const { type, order, label, payloadKeys, recipientActed, $comment: _note, ...rest } = event ?? {}
      if (typeof type !== 'string' || !plain.test(type)) {
        throw new Error(`${where}: "type" is the plain name a trigger stores, 2 to 40 letters and digits`)
      }
      const what = `${where} "${type}"`
      if (Object.keys(rest).length) throw new Error(`${what}: unknown key(s) ${Object.keys(rest).join(', ')}`)
      if (types.has(type)) throw new Error(`${what} is already declared by ${types.get(type)}`)
      types.set(type, `"${plugin.id}"`)
      if (!Number.isInteger(order) || order <= 0) throw new Error(`${what}: "order" is a whole number above 0`)
      if (orders.has(order)) throw new Error(`${what}: "order" ${order} is already ${orders.get(order)}'s`)
      orders.set(order, `"${plugin.id}"'s "${type}"`)
      if (typeof label !== 'string' || !label.trim()) throw new Error(`${what}: "label" is how a picker names the event`)
      const row = { pluginId: plugin.id, type, order, label }
      if (payloadKeys !== undefined) {
        if (
          !Array.isArray(payloadKeys) ||
          !payloadKeys.length ||
          payloadKeys.some((key) => typeof key !== 'string' || !key.trim())
        ) {
          throw new Error(`${what}: "payloadKeys" lists what the event puts in scope, or is left out`)
        }
        row.payloadKeys = payloadKeys
      }
      if (recipientActed !== undefined) {
        if (recipientActed !== true) {
          throw new Error(`${what}: "recipientActed" is true for an event that is the recipient's own action, or is left out`)
        }
        row.recipientActed = true
      }
      rows.push(row)
    }
  }
  return rows.sort((a, b) => a.order - b.order)
}

function hostEventsContent(events) {
  const types = events.map((event) => `  | '${event.type}'`).join('\n')
  return (
    `/**\n * GENERATED FILE — do not edit. Regenerate with:\n` +
    ` *   node tools/scripts/generate-plugin-manifests.mjs\n *\n` +
    ` * The host events plugins declare (AGL-3080): each plugin's \`hostEvents\`\n` +
    ` * in plugins.config.json, in \`order\`. Core's \`host-events.ts\` folds them\n` +
    ` * in beside the platform's own.\n */\n\n` +
    `import type { HostEventDeclaration } from './host-events'\n\n` +
    `/** Every host event a plugin declares. */\n` +
    `export type PluginHostEventType =\n${types || '  never'}\n\n` +
    `export const PLUGIN_HOST_EVENTS: readonly HostEventDeclaration[] = ` +
    `${JSON.stringify(events, null, 2)}\n`
  )
}

/**
 * The container kinds each plugin declares (AGL-3080): a document other
 * records are FILED UNDER by naming its id in a membership array on their own
 * document. A campaign is the first; a form, a screen, a lead and a contact
 * are filed under one.
 *
 * Compiled for the reason the catalog is: the readers are record pages in
 * several plugins and the console app, and a form submission that loads no
 * plugin reads which containers the form is filed under. Checked here:
 *
 *  - ONE OWNER per kind, since the kind names the membership field
 *    (`<kind>Ids`) every member holds, and two owners would be two meanings
 *    for one stored field.
 *  - A kind that makes a plain field name, for the same reason.
 *  - An org collection the declaring plugin itself owns (its own
 *    `orgCollections`): a picker reads the containers there, and a kind
 *    stored in another plugin's collection would be read around that plugin.
 *  - A catalog label on the owner, which a picker names as where a container
 *    is created.
 */
const CONTAINERS_FILE = 'libs/aglyn/src/lib/plugin-manager/plugin-containers.generated.ts'
const CONTAINER_KIND = /^[a-z][A-Za-z0-9]*$/
const CONTAINER_FIELDS = ['kind', 'label', 'pluralLabel', 'orgCollection', 'nameField']

function containerKindRows() {
  const rows = []
  const owners = new Map()
  for (const plugin of config.plugins) {
    const declared = plugin.containers
    if (!declared) continue
    const where = `plugins.config.json: "${plugin.id}" containers`
    if (!Array.isArray(declared) || !declared.length) {
      throw new Error(`${where} is present and declares nothing — drop it, or name the kind the plugin keeps`)
    }
    const ownerLabel = plugin.catalog?.label
    if (typeof ownerLabel !== 'string' || !ownerLabel) {
      throw new Error(`${where}: the plugin needs a catalog "label", which a picker names as where a container is created`)
    }
    const own = new Set((plugin.orgCollections ?? []).map((collection) => collection.name))
    for (const declaration of declared) {
      const { kind, label, pluralLabel, orgCollection, nameField } = declaration
      const what = `${where} "${kind ?? ''}"`
      if (typeof kind !== 'string' || !CONTAINER_KIND.test(kind)) {
        throw new Error(`${where}: a container needs a lowerCamelCase "kind" — its members hold it in "<kind>Ids"`)
      }
      const held = owners.get(kind)
      if (held) throw new Error(`${what} is already declared by "${held}" — one kind has one owner`)
      owners.set(kind, plugin.id)
      const unknown = Object.keys(declaration).filter((key) => !CONTAINER_FIELDS.includes(key))
      if (unknown.length) throw new Error(`${what}: unknown field(s) ${unknown.join(', ')}`)
      if (typeof label !== 'string' || !label.trim()) throw new Error(`${what}: "label" is what ONE container is called`)
      if (typeof pluralLabel !== 'string' || !pluralLabel.trim()) throw new Error(`${what}: "pluralLabel" is what several are called`)
      if (!own.has(orgCollection)) {
        throw new Error(`${what}: "orgCollection" is one of "${plugin.id}"'s own orgCollections — a picker reads the containers there`)
      }
      if (typeof nameField !== 'string' || !PLAIN_FIELD.test(nameField)) {
        throw new Error(`${what}: "nameField" is the plain name of the field a container's name is stored in`)
      }
      rows.push({ pluginId: plugin.id, kind, label, pluralLabel, ownerLabel, orgCollection, nameField })
    }
  }
  return rows
}

function containersContent(rows) {
  return (
    `/**\n * GENERATED FILE — do not edit. Regenerate with:\n` +
    ` *   node tools/scripts/generate-plugin-manifests.mjs\n *\n` +
    ` * The container kinds plugins declare (AGL-3080): each plugin's\n` +
    ` * \`containers\` block in plugins.config.json. Core's \`plugin-containers.ts\`\n` +
    ` * reads them; core names no kind.\n */\n\n` +
    `import type { PluginContainerKind } from './plugin-containers'\n\n` +
    `export const PLUGIN_CONTAINER_KINDS_DECLARED: readonly PluginContainerKind[] = ` +
    `${JSON.stringify(rows, null, 2)}\n`
  )
}

/**
 * The subscription topics each plugin declares (AGL-3080): the streams its
 * mail is sent under, which a recipient can leave one at a time.
 *
 * The rows are the built-in floor of every org's topic catalog — present for
 * every org with no write anywhere, and overlaid by whatever the org stores —
 * so they are compiled like the catalog: the readers include the unsubscribe
 * and preference pages, which must name a stream whether or not the plugin
 * that sends under it has loaded. Checked here:
 *
 *  - ONE OWNER per id, and an id the unsubscribe link can carry: it becomes a
 *    Firestore path component and a colon-joined component of the link's
 *    signed subject, so no `/`, no `:`, and never `.`, `..` or `__x__`.
 *  - A name and a sentence of description, which the preference page shows.
 *  - A distinct `order`, which is the preference page's checkbox order.
 *  - At most one `default`: the stream a campaign or a scheduled automated
 *    email belongs to when it names none. Two would make that stream a
 *    question of config order.
 */
const SUBSCRIPTION_TOPICS_FILE = 'libs/aglyn/src/lib/plugin-manager/plugin-subscription-topics.generated.ts'
const SUBSCRIPTION_TOPIC_FIELDS = ['id', 'name', 'description', 'order', 'default']

function subscriptionTopicRows() {
  const rows = []
  const owners = new Map()
  for (const plugin of config.plugins) {
    const declared = plugin.subscriptionTopics
    if (!declared) continue
    const where = `plugins.config.json: "${plugin.id}" subscriptionTopics`
    if (!Array.isArray(declared) || !declared.length) {
      throw new Error(`${where} is present and declares nothing — drop it, or name the stream the plugin sends under`)
    }
    for (const declaration of declared) {
      const { id, name, description, order } = declaration
      const what = `${where} "${id ?? ''}"`
      const unknown = Object.keys(declaration).filter((key) => !SUBSCRIPTION_TOPIC_FIELDS.includes(key))
      if (unknown.length) throw new Error(`${what}: unknown field(s) ${unknown.join(', ')}`)
      if (
        typeof id !== 'string' ||
        !id ||
        id.length > 120 ||
        id.includes('/') ||
        id.includes(':') ||
        id === '.' ||
        id === '..' ||
        /^__.*__$/.test(id)
      ) {
        throw new Error(`${what}: "id" rides in a signed unsubscribe link and is a Firestore path component — no "/", no ":", at most 120 characters`)
      }
      const held = owners.get(id)
      if (held) throw new Error(`${what} is already declared by "${held}" — one stream has one owner`)
      owners.set(id, plugin.id)
      if (typeof name !== 'string' || !name.trim()) throw new Error(`${what}: "name" is what the preference page calls the stream`)
      if (typeof description !== 'string' || !description.trim()) {
        throw new Error(`${what}: "description" is the sentence the preference page shows under the name`)
      }
      if (!Number.isInteger(order)) throw new Error(`${what}: "order" is the stream's place on the preference page`)
      if (declaration.default !== undefined && declaration.default !== true) {
        throw new Error(`${what}: "default" is true or left out`)
      }
      rows.push({ pluginId: plugin.id, id, name, description, order, ...(declaration.default ? { default: true } : {}) })
    }
  }
  rows.sort((a, b) => a.order - b.order)
  const orders = rows.map((row) => row.order)
  if (new Set(orders).size !== orders.length) throw new Error('plugins.config.json: two subscription topics share an "order"')
  if (rows.filter((row) => row.default).length > 1) {
    throw new Error('plugins.config.json: more than one subscription topic is the "default"')
  }
  return rows
}

function subscriptionTopicsContent(rows) {
  return (
    `/**\n * GENERATED FILE — do not edit. Regenerate with:\n` +
    ` *   node tools/scripts/generate-plugin-manifests.mjs\n *\n` +
    ` * The subscription topics plugins declare (AGL-3080): each plugin's\n` +
    ` * \`subscriptionTopics\` block in plugins.config.json, in preference-page\n` +
    ` * order. Core's \`app-utils/subscription-topics.ts\` reads them as the\n` +
    ` * built-in floor of every org's topic catalog; core names no stream.\n */\n\n` +
    `import type { DeclaredSubscriptionTopic } from '../app-utils/subscription-topics'\n\n` +
    `export const PLUGIN_SUBSCRIPTION_TOPICS_DECLARED: readonly DeclaredSubscriptionTopic[] = ` +
    `${JSON.stringify(rows, null, 2)}\n`
  )
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
  const resourceKinds = new Map()
  const packageKinds = new Map()
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
      const row = { pluginId: plugin.id, ...declaration }
      if (declaration.resource !== undefined) {
        row.resource = hostResourceRow(declaration.resource, `${what} resource`, resourceKinds, plugin.id)
      }
      if (declaration.siteExport !== undefined) {
        row.siteExport = siteExportRow(declaration.siteExport, `${what} siteExport`, name, row.resource, packageKinds, plugin.id)
      }
      rows.push(row)
    }
  }
  return rows
}

/**
 * The kinds `/api/hosts/resources` creates from its own table: the platform's
 * documents, which exist with no plugin loaded. A plugin declaring one of
 * these would be a second allow-list for the same create.
 */
const CORE_HOST_RESOURCE_KINDS = ['screen', 'template', 'layout', 'reusableComponent', 'form', 'entry', 'author']

/** Fields the create route stamps on every document; no declaration may let a client send them. */
const SERVER_STAMPED_FIELDS = ['createdAt', 'updatedAt', 'createdBy', 'deletedAt']

const PLAIN_FIELD = /^[A-Za-z][A-Za-z0-9]*$/

/**
 * A plugin's host collection as a KIND the generic create route writes
 * (AGL-3080): the route is the writable-field allowlist for client creates,
 * so everything a reader would otherwise have to trust is checked here.
 *
 *  - ONE OWNER PER KIND, and none of core's own.
 *  - A COUNT. A kind with neither a plan `quotaKey` nor a `platformCap` is
 *    unbounded documents mintable from a browser (AGL-2266).
 *  - NO SERVER FIELD ON THE ALLOW-LIST. `createdAt`, `updatedAt`,
 *    `createdBy` and `deletedAt` are stamped; a stamp, and the field an
 *    external destination's approver lands in, are never client-writable —
 *    provenance the caller supplies is provenance the caller chose.
 *  - AN APPROVAL ONLY THE PUBLISH ROLE GIVES. `externalDestination` stamps
 *    the creator's uid as the approval a serve path trusts, which is only true
 *    when the create required the publishing role.
 *  - A COPY THAT IS A SUBSET. `duplicate.fields` are the create's own fields,
 *    less what a copy must not inherit.
 */
function hostResourceRow(resource, what, kinds, pluginId) {
  if (!resource || typeof resource !== 'object' || Array.isArray(resource)) throw new Error(`${what} is an object`)
  const { $comment: _note, ...fields } = resource
  const { kind, label, activityNoun, activityType, quotaKey, entitlement, platformCap, softDeletes, requiresPublishRole } = fields
  if (typeof kind !== 'string' || !/^[a-z][A-Za-z0-9]*$/.test(kind)) throw new Error(`${what} needs a "kind" in camelCase`)
  if (CORE_HOST_RESOURCE_KINDS.includes(kind)) throw new Error(`${what}: "${kind}" is a kind the platform creates itself`)
  const held = kinds.get(kind)
  if (held) throw new Error(`${what}: kind "${kind}" is already declared by "${held}" — one kind has one allow-list`)
  kinds.set(kind, pluginId)
  for (const [key, value] of [['label', label], ['activityNoun', activityNoun]]) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${what} needs a "${key}"`)
  }
  for (const [key, value] of [['activityType', activityType], ['quotaKey', quotaKey], ['entitlement', entitlement], ['platformCap', platformCap]]) {
    if (value !== undefined && (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*$/.test(value))) {
      throw new Error(`${what}: "${key}" is a plain key, or is left out`)
    }
  }
  if (!quotaKey && !platformCap) {
    throw new Error(`${what} needs a "quotaKey" or a "platformCap" — a create nothing counts is unbounded documents from a browser`)
  }
  for (const [key, value] of [['softDeletes', softDeletes], ['requiresPublishRole', requiresPublishRole]]) {
    if (value !== undefined && typeof value !== 'boolean') throw new Error(`${what}: "${key}" is true or false`)
  }
  const writable = plainFieldList(fields.fields, `${what} fields`)
  for (const field of writable) {
    if (SERVER_STAMPED_FIELDS.includes(field)) throw new Error(`${what}: "${field}" is stamped by the server and never sent by a client`)
  }
  const stamped = stampRecord(fields.stamps, `${what} stamps`, writable)
  if (fields.externalDestination !== undefined) {
    const { field, approvedByField } = fields.externalDestination ?? {}
    if (!writable.includes(field)) throw new Error(`${what}: "externalDestination.field" is one of its own fields`)
    if (typeof approvedByField !== 'string' || !PLAIN_FIELD.test(approvedByField)) {
      throw new Error(`${what}: "externalDestination.approvedByField" is a plain field name`)
    }
    if (writable.includes(approvedByField) || SERVER_STAMPED_FIELDS.includes(approvedByField) || approvedByField in stamped) {
      throw new Error(`${what}: "${approvedByField}" is the approver the server stamps, so no client and no other stamp writes it`)
    }
    if (requiresPublishRole !== true) {
      throw new Error(`${what}: "externalDestination" stamps an approval, and only a create that required the publishing role is one`)
    }
  }
  if (fields.livePathField !== undefined && !writable.includes(fields.livePathField)) {
    throw new Error(`${what}: "livePathField" is one of its own fields`)
  }
  if (fields.duplicate !== undefined) {
    const { nameField } = fields.duplicate ?? {}
    if (!writable.includes(nameField)) throw new Error(`${what}: "duplicate.nameField" is one of its own fields`)
    const copied = plainFieldList(fields.duplicate.fields, `${what} duplicate.fields`)
    for (const field of copied) {
      if (!writable.includes(field)) throw new Error(`${what}: duplicate field "${field}" is not one a create may write`)
      if (field === nameField) throw new Error(`${what}: the copy's name is made unique, not copied — drop "${field}" from duplicate.fields`)
    }
    stampRecord(fields.duplicate.stamps, `${what} duplicate.stamps`, copied)
    const { $comment: _why, ...duplicate } = fields.duplicate
    fields.duplicate = duplicate
  }
  return fields
}

function plainFieldList(list, what) {
  if (!Array.isArray(list) || !list.length) throw new Error(`${what} names at least one field`)
  for (const field of list) {
    if (typeof field !== 'string' || !PLAIN_FIELD.test(field)) throw new Error(`${what}: "${field}" is not a plain field name`)
  }
  if (new Set(list).size !== list.length) throw new Error(`${what} names a field twice`)
  return list
}

/** Constant values written on every create: never a client field, never another stamp's. */
function stampRecord(stamps, what, writable) {
  if (stamps === undefined) return {}
  if (!stamps || typeof stamps !== 'object' || Array.isArray(stamps)) throw new Error(`${what} is an object`)
  for (const [field, value] of Object.entries(stamps)) {
    if (!PLAIN_FIELD.test(field)) throw new Error(`${what}: "${field}" is not a plain field name`)
    if (writable.includes(field)) throw new Error(`${what}: "${field}" is also client-writable — a stamp is the server's word`)
    if (field === 'deletedAt' ? value !== null : SERVER_STAMPED_FIELDS.includes(field)) {
      throw new Error(`${what}: "${field}" is stamped by the server (deletedAt only as null, born live)`)
    }
    if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) {
      throw new Error(`${what}: "${field}" is a string, number, boolean or null`)
    }
  }
  return stamps
}

/**
 * The keys the whole-site export already writes: the bundle's envelope and the
 * platform's own documents. A plugin collection carried under one of these
 * names would overwrite it on the way out and be restored through the wrong
 * allow-list on the way in.
 */
const CORE_SITE_EXPORT_KEYS = [
  'format', 'version', 'exportedAt', 'sourceHostId', 'host',
  'screens', 'layouts', 'versions', 'components', 'authors', 'collections', 'entries',
  'media', 'mediaFolders', 'hostMedia', 'hostMediaFolders', 'emailTemplates', 'emailTemplateVersions', 'themes',
]

/** The most documents one bundle may carry of one collection. */
const SITE_EXPORT_MAX_LIMIT = 1000

/**
 * The item kinds the platform's own site package carries (AGL-3533, core
 * `data-transfer/site-package.ts`). A plugin's package kind is its own word
 * for its items, so it may not take one of these.
 */
const CORE_SITE_PACKAGE_KINDS = [
  'settings', 'theme', 'page', 'email', 'emailTemplate', 'layout', 'component', 'author', 'collection',
  'media', 'mediaFolder', 'siteMedia', 'siteMediaFolder', 'savedTheme',
]

/** The binding-token prefixes core's grammar holds (`{{var:id}}`, `{{fn:id(…)}}`). */
const SITE_PACKAGE_BINDING_TOKENS = ['var', 'fn']

const PACKAGE_KIND = /^[a-z][A-Za-z0-9]*$/

/**
 * What a site package calls one of a declaration's items (AGL-3533): its
 * `kind`, the plural `label` the import screen groups them under, the field
 * holding its name or slug (what an incoming item is matched by when its id is
 * new), the fields holding ids of other site items, and the binding token
 * that names one of its items inside a design. Every kind has one owner.
 */
function sitePackageRow(
  pkg,
  what,
  fields,
  kinds,
  owner,
  allowed = ['kind', 'label', 'nameField', 'slugField', 'references', 'bindingToken', 'placements'],
) {
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) {
    throw new Error(`${what} needs a "package": the kind a site package lists its items as`)
  }
  const { $comment: _note, ...row } = pkg
  const unknown = Object.keys(row).filter((key) => !allowed.includes(key))
  if (unknown.length) throw new Error(`${what}: ${unknown.join(', ')} is not a package field`)
  const { kind, label, nameField, slugField, references, bindingToken, placements } = row
  if (typeof kind !== 'string' || !PACKAGE_KIND.test(kind)) throw new Error(`${what}: "kind" is one word in camelCase`)
  if (CORE_SITE_PACKAGE_KINDS.includes(kind)) throw new Error(`${what}: "${kind}" is a kind the platform's own package carries`)
  const held = kinds.get(kind)
  if (held) throw new Error(`${what}: kind "${kind}" is already declared by ${held} — one kind has one owner`)
  kinds.set(kind, owner)
  if (typeof label !== 'string' || !label.trim()) throw new Error(`${what} needs a "label", plural, for the import screen`)
  for (const [key, value] of [['nameField', nameField], ['slugField', slugField]]) {
    if (value === undefined) continue
    if (typeof value !== 'string' || !PLAIN_FIELD.test(value)) throw new Error(`${what}: "${key}" is a plain field name`)
    if (fields && !fields.includes(value)) throw new Error(`${what}: "${key}" "${value}" is not one of the fields a restore writes`)
  }
  if (!nameField && !slugField) throw new Error(`${what} needs a "nameField" or a "slugField": an item with a new id is matched by one`)
  const refs = []
  for (const ref of references ?? []) {
    const { field, kind: target } = ref ?? {}
    if (typeof field !== 'string' || !PLAIN_FIELD.test(field)) throw new Error(`${what}: a reference's "field" is a plain field name`)
    if (fields && !fields.includes(field)) throw new Error(`${what}: reference "${field}" is not one of the fields a restore writes`)
    if (typeof target !== 'string' || !PACKAGE_KIND.test(target)) throw new Error(`${what}: reference "${field}" names the "kind" it points at`)
    refs.push({ field, kind: target })
  }
  if (references !== undefined && !Array.isArray(references)) throw new Error(`${what}: "references" is a list`)
  if (bindingToken !== undefined && !SITE_PACKAGE_BINDING_TOKENS.includes(bindingToken)) {
    throw new Error(`${what}: "bindingToken" is one of ${SITE_PACKAGE_BINDING_TOKENS.join(', ')}`)
  }
  if (placements !== undefined && !Array.isArray(placements)) throw new Error(`${what}: "placements" is a list`)
  const placed = []
  for (const placement of placements ?? []) {
    const { componentId, prop } = placement ?? {}
    if (typeof prop !== 'string' || !PLAIN_FIELD.test(prop)) throw new Error(`${what}: a placement's "prop" is a plain prop name`)
    if (componentId !== undefined && (typeof componentId !== 'string' || !componentId.trim())) {
      throw new Error(`${what}: a placement's "componentId" is an element id, or is left out to mean any node`)
    }
    placed.push({ ...(componentId ? { componentId } : {}), prop })
  }
  return {
    kind,
    label,
    ...(nameField ? { nameField } : {}),
    ...(slugField ? { slugField } : {}),
    ...(refs.length ? { references: refs } : {}),
    ...(bindingToken ? { bindingToken } : {}),
    ...(placed.length ? { placements: placed } : {}),
  }
}

/**
 * What a restore of a collection with no `resource` is met against
 * (AGL-3533): a plan `quotaKey`, a flat `platformCap` by the name of core's
 * constant, or `uncapped` with the reason a count would add nothing — a
 * collection the browser already creates without one, where a restore can
 * mint no more than an editor can.
 */
function siteExportCountRow(count, what) {
  if (!count || typeof count !== 'object' || Array.isArray(count)) throw new Error(`${what} is an object`)
  const { $comment: _note, ...row } = count
  const keys = Object.keys(row)
  if (keys.length !== 1 || !['quotaKey', 'platformCap', 'uncapped'].includes(keys[0])) {
    throw new Error(`${what} is one of { "quotaKey" }, { "platformCap" } or { "uncapped": "<why>" }`)
  }
  const [key] = keys
  const value = row[key]
  if (key === 'uncapped') {
    if (typeof value !== 'string' || value.trim().length < 20) throw new Error(`${what}: "uncapped" says why no count applies`)
  } else if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`${what}: "${key}" is a plain key`)
  }
  return { [key]: value }
}

/**
 * A plugin's host collection in the whole-site export (AGL-3080): the export
 * reads up to `limit` of its live documents into the bundle under the
 * collection's own name, and a restore writes each one back through `fields`
 * with `merge: false` — so the list is every key a live document carries, not
 * what a create sends, and a key left off is ERASED from every restored
 * document.
 *
 *  - A COUNT. A restore creates documents with the Admin SDK, past the rules,
 *    so the collection must have a `resource` whose plan `quotaKey` or
 *    `platformCap` the restore is met against (AGL-1403, AGL-2266).
 *  - NOTHING THE RESTORE STAMPS OR SCOPES. `createdAt`, `updatedAt`,
 *    `createdBy` and `deletedAt` are stamped (a bundle carrying a tombstone
 *    would restore a document invisible), `visibleTo` is assigned fresh, and
 *    an external destination's approver is provenance a file cannot supply.
 *  - NO KEY THE PLATFORM'S OWN BUNDLE USES.
 */
function siteExportRow(siteExport, what, collection, resource, packageKinds, pluginId) {
  if (!siteExport || typeof siteExport !== 'object' || Array.isArray(siteExport)) throw new Error(`${what} is an object`)
  const { $comment: _note, ...fields } = siteExport
  const unknown = Object.keys(fields).filter((key) => !['limit', 'fields', 'package', 'count'].includes(key))
  if (unknown.length) throw new Error(`${what}: ${unknown.join(', ')} is not a site export field`)
  if (CORE_SITE_EXPORT_KEYS.includes(collection)) {
    throw new Error(`${what}: "${collection}" is a key the platform's own bundle writes`)
  }
  if (resource && fields.count !== undefined) {
    throw new Error(`${what}: "count" is for a collection with no "resource" — the resource already names the count`)
  }
  if (!resource && fields.count === undefined) {
    throw new Error(`${what} needs the collection's "resource", or a "count": a restore creates documents here, and the count is what they are met against`)
  }
  const { limit } = fields
  if (!Number.isInteger(limit) || limit < 1 || limit > SITE_EXPORT_MAX_LIMIT) {
    throw new Error(`${what}: "limit" is a whole number from 1 to ${SITE_EXPORT_MAX_LIMIT}`)
  }
  const restored = plainFieldList(fields.fields, `${what} fields`)
  const never = [
    ...SERVER_STAMPED_FIELDS,
    'visibleTo',
    ...(resource?.externalDestination ? [resource.externalDestination.approvedByField] : []),
  ]
  for (const field of restored) {
    if (never.includes(field)) throw new Error(`${what}: "${field}" is stamped or scoped by the restore, never read from a bundle`)
  }
  return {
    limit,
    fields: restored,
    package: sitePackageRow(fields.package, `${what} package`, restored, packageKinds, `"${pluginId}" host collection "${collection}"`),
    ...(fields.count !== undefined ? { count: siteExportCountRow(fields.count, `${what} count`) } : {}),
  }
}

/**
 * The sections of the whole-site backup plugins answer for themselves
 * (AGL-3080): data a host collection's `siteExport` cannot describe —
 * organization-owned, carrying a subcollection, checked against its own model
 * on the way back in. Compiled, and read with the registered answers: a
 * section declared and never registered fails the export rather than leaving
 * the bundle short with nothing to say so.
 *
 * Checked here: a plain key no other section, host collection or platform
 * key already uses in the bundle; a limit from 1 to the bundle ceiling; and a
 * `serverDeclarations` entry to register the answers from.
 */
function siteBundleSectionRows() {
  const rows = []
  const carried = hostCollectionRows().filter((row) => row.siteExport)
  const taken = new Map(carried.map((row) => [row.name, `"${row.pluginId}" host collection`]))
  const packageKinds = new Map(
    carried.map((row) => [row.siteExport.package.kind, `"${row.pluginId}" host collection "${row.name}"`]),
  )
  for (const plugin of config.plugins) {
    const declared = plugin.siteBundleSections
    if (declared === undefined) continue
    const where = `plugins.config.json: "${plugin.id}" siteBundleSections`
    if (!Array.isArray(declared) || !declared.length) {
      throw new Error(`${where} is present and declares nothing — drop it, or name the section`)
    }
    if (!plugin.register?.serverDeclarations) {
      throw new Error(
        `${where}: a section's answers are registered from a "serverDeclarations" entry, and this plugin names none — ` +
          'a declared section nothing registers fails every export',
      )
    }
    for (const entry of declared) {
      const { $comment: _note, ...section } = entry ?? {}
      const { key, limit } = section
      const what = `${where} "${key ?? ''}"`
      const unknown = Object.keys(section).filter((field) => !['key', 'limit', 'package'].includes(field))
      if (unknown.length) throw new Error(`${what}: ${unknown.join(', ')} is not a section field`)
      if (typeof key !== 'string' || !PLAIN_FIELD.test(key)) throw new Error(`${where}: a section's "key" is a plain bundle key`)
      if (CORE_SITE_EXPORT_KEYS.includes(key)) throw new Error(`${what} is a key the platform's own bundle writes`)
      const held = taken.get(key)
      if (held) throw new Error(`${what} is already carried by the ${held} — one key has one owner`)
      taken.set(key, `"${plugin.id}" section`)
      if (!Number.isInteger(limit) || limit < 1 || limit > SITE_EXPORT_MAX_LIMIT) {
        throw new Error(`${what}: "limit" is a whole number from 1 to ${SITE_EXPORT_MAX_LIMIT}`)
      }
      // A section's items are the plugin's own shape, so it answers for their
      // references itself (registered `package` hooks) rather than naming
      // reference fields here.
      const pkg = sitePackageRow(section.package, `${what} package`, null, packageKinds, `"${plugin.id}" section "${key}"`, [
        'kind',
        'label',
        'nameField',
        'slugField',
        'placements',
      ])
      rows.push({ pluginId: plugin.id, key, limit, package: pkg })
    }
  }
  return rows
}

/**
 * What each plugin can import and export (AGL-3523): its transfer resources,
 * each a `TransferResourceDescriptor` from core `data-transfer/resource.ts`.
 * Compiled, and read with the registered halves (core
 * `plugin-transfer-resources.ts`): a resource declared and never registered
 * fails the job that asks for it rather than reading as nothing to move.
 *
 * Checked here, in the shape core's `transferResourceProblems` checks again
 * at registration: a resource key no other plugin uses, a label, a scope, at
 * least one known kind and format, positive whole limits, and `instances:
 * true` for a resource moved one instance at a time (one dataset's records), and
 * who may export it (AGL-3546): `readableByMembers: true`, or a `readPermission`
 * that is a permission key, never both; the plan feature that moves it
 * (AGL-3555), `featureFlag`, with the intents `featureFlagExempt` keeps open
 * on every plan; and the only roles that may import it, where its records
 * are (AGL-3554), `importRoles`, on a resource that imports. And the two
 * places the halves are registered from: a `serverDeclarations` or
 * `consoleServerDeclarations` entry for the server half, and a console
 * registrar that loads at the `transferResources` slot for the client half.
 */
const TRANSFER_RESOURCE_KEY = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/
const TRANSFER_SCOPES = ['org', 'host']
const TRANSFER_KINDS = ['records', 'package']
const TRANSFER_FORMATS = ['csv', 'json', 'ndjson']
const TRANSFER_RESOURCE_FIELDS = ['key', 'label', 'singularLabel', 'scope', 'kinds', 'formats', 'limits', 'description', 'instances', 'readableByMembers', 'readPermission', 'exportOnly', 'featureFlag', 'featureFlagExempt', 'importRoles']
const TRANSFER_INTENTS = ['import', 'export']
const TRANSFER_IMPORT_ROLES = ['admin', 'editor', 'author', 'viewer']
const FEATURE_FLAG_KEY = /^[a-z][A-Za-z0-9]*$/
const PERMISSION_KEY = /^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)*$/
const TRANSFER_RESOURCES_LOAD_POINT = 'transferResources'

function transferResourceRows() {
  const rows = []
  const owners = new Map()
  for (const plugin of config.plugins) {
    const declared = plugin.transferResources
    if (declared === undefined) continue
    const where = `plugins.config.json: "${plugin.id}" transferResources`
    if (!Array.isArray(declared) || !declared.length) {
      throw new Error(`${where} is present and declares nothing — drop it, or name the resource`)
    }
    if (!plugin.register?.serverDeclarations && !plugin.register?.consoleServerDeclarations) {
      throw new Error(
        `${where}: a resource's server half is registered from a "serverDeclarations" (or "consoleServerDeclarations") entry, ` +
          'and this plugin names neither — a declared resource nothing registers fails every job',
      )
    }
    if (!plugin.register?.console || !(plugin.contributes?.console?.slots ?? []).includes(TRANSFER_RESOURCES_LOAD_POINT)) {
      throw new Error(
        `${where}: a resource's client half is registered from the plugin's console registrar, ` +
          `which loads where the wizard is drawn only when "${TRANSFER_RESOURCES_LOAD_POINT}" is among its contributes.console.slots`,
      )
    }
    for (const entry of declared) {
      const { $comment: _note, ...resource } = entry ?? {}
      const { key, label, singularLabel, scope, kinds, formats, limits, description, instances, readableByMembers, readPermission, exportOnly, featureFlag, featureFlagExempt, importRoles } = resource
      const what = `${where} "${key ?? ''}"`
      const unknown = Object.keys(resource).filter((field) => !TRANSFER_RESOURCE_FIELDS.includes(field))
      if (unknown.length) throw new Error(`${what}: ${unknown.join(', ')} is not a resource field`)
      if (typeof key !== 'string' || key.length > 64 || !TRANSFER_RESOURCE_KEY.test(key)) {
        throw new Error(`${where}: a resource's "key" is lowercase words joined by - or . (at most 64 characters)`)
      }
      const held = owners.get(key)
      if (held) throw new Error(`${what} is already declared by "${held}" — one key has one owner`)
      owners.set(key, plugin.id)
      if (typeof label !== 'string' || !label.trim()) throw new Error(`${what}: "label" is required`)
      for (const [name, value] of [['singularLabel', singularLabel], ['description', description]]) {
        if (value !== undefined && (typeof value !== 'string' || !value.trim())) {
          throw new Error(`${what}: "${name}" is a sentence when present`)
        }
      }
      if (!TRANSFER_SCOPES.includes(scope)) throw new Error(`${what}: "scope" is ${TRANSFER_SCOPES.join(' or ')}`)
      if (instances !== undefined && instances !== true) {
        throw new Error(`${what}: "instances" is true when the resource is moved one instance at a time, and absent otherwise`)
      }
      if (readableByMembers !== undefined && readableByMembers !== true) {
        throw new Error(`${what}: "readableByMembers" is true when every member may export the records, and absent otherwise`)
      }
      if (readPermission !== undefined && (typeof readPermission !== 'string' || !PERMISSION_KEY.test(readPermission))) {
        throw new Error(`${what}: "readPermission" is a permission key ("crm.view") when present`)
      }
      if (readableByMembers && readPermission !== undefined) {
        throw new Error(`${what}: "readableByMembers" and "readPermission" each say who exports — declare one`)
      }
      if (exportOnly !== undefined && exportOnly !== true) {
        throw new Error(`${what}: "exportOnly" is true when the resource is exported and never imported, and absent otherwise`)
      }
      if (featureFlag !== undefined && (typeof featureFlag !== 'string' || !FEATURE_FLAG_KEY.test(featureFlag))) {
        throw new Error(`${what}: "featureFlag" is the plan feature that moves the records ("crm") when present`)
      }
      if (importRoles !== undefined) {
        if (exportOnly === true) throw new Error(`${what}: "importRoles" names who may import a resource that is never imported`)
        if (
          !Array.isArray(importRoles) ||
          !importRoles.length ||
          new Set(importRoles).size !== importRoles.length ||
          importRoles.some((one) => !TRANSFER_IMPORT_ROLES.includes(one))
        ) {
          throw new Error(`${what}: "importRoles" lists one or more of ${TRANSFER_IMPORT_ROLES.join(', ')}, each once`)
        }
      }
      if (featureFlagExempt !== undefined) {
        if (featureFlag === undefined) throw new Error(`${what}: "featureFlagExempt" exempts intents from a "featureFlag" it does not name`)
        if (
          !Array.isArray(featureFlagExempt) ||
          !featureFlagExempt.length ||
          new Set(featureFlagExempt).size !== featureFlagExempt.length ||
          featureFlagExempt.some((one) => !TRANSFER_INTENTS.includes(one))
        ) {
          throw new Error(`${what}: "featureFlagExempt" lists one or more of ${TRANSFER_INTENTS.join(', ')}, each once`)
        }
      }
      for (const [name, list, known] of [['kinds', kinds, TRANSFER_KINDS], ['formats', formats, TRANSFER_FORMATS]]) {
        if (!Array.isArray(list) || !list.length || new Set(list).size !== list.length || list.some((one) => !known.includes(one))) {
          throw new Error(`${what}: "${name}" lists one or more of ${known.join(', ')}, each once`)
        }
      }
      if (limits !== undefined) {
        const { maxRows, maxBytes, ...extra } = limits ?? {}
        if (Object.keys(extra).length) throw new Error(`${what}: limits.${Object.keys(extra).join(', limits.')} is not a limit`)
        if (!Number.isInteger(maxRows) || maxRows < 1) throw new Error(`${what}: "limits.maxRows" is a positive whole number`)
        if (maxBytes !== undefined && (!Number.isInteger(maxBytes) || maxBytes < 1)) {
          throw new Error(`${what}: "limits.maxBytes" is a positive whole number when present`)
        }
      }
      rows.push({ pluginId: plugin.id, ...resource })
    }
  }
  return rows
}

/**
 * The child sitemaps each plugin's documents fill (AGL-3080).
 *
 * Compiled because the reader is the tenant's `/sitemap.xml`: a section a
 * process had not registered would drop the plugin's pages from a live
 * site's index, and a crawler reads that as pages that no longer exist.
 *
 * Checked here: one owner per section and none of the platform's own
 * (`pages`, `authors`, or a `content-` collection's), plain field names, a
 * two-segment settings document, and a path with exactly one `{slug}`.
 */
const CORE_SITEMAP_SECTIONS = ['pages', 'authors']

function sitemapSectionRows() {
  const rows = []
  const owners = new Map()
  for (const plugin of config.plugins) {
    const declared = plugin.sitemapSections
    if (!declared) continue
    const where = `plugins.config.json: "${plugin.id}" sitemapSections`
    if (!Array.isArray(declared) || !declared.length) {
      throw new Error(`${where} is present and declares nothing — drop it, or name the section`)
    }
    for (const entry of declared) {
      const { $comment: _note, ...declaration } = entry
      const { section, collection, where: filter, enabledBy, path, slugField, skipWhen, lastmod } = declaration
      const what = `${where} "${section ?? ''}"`
      if (typeof section !== 'string' || !/^[a-z][a-z0-9-]*$/.test(section)) throw new Error(`${where}: a section is a lowercase path segment`)
      if (CORE_SITEMAP_SECTIONS.includes(section) || section.startsWith('content-')) {
        throw new Error(`${what} is a section the platform builds itself`)
      }
      const held = owners.get(section)
      if (held) throw new Error(`${what} is already declared by "${held}" — one section has one owner`)
      owners.set(section, plugin.id)
      if (typeof collection !== 'string' || !PLAIN_FIELD.test(collection)) throw new Error(`${what} needs a "collection"`)
      if (filter !== undefined) {
        if (!PLAIN_FIELD.test(filter?.field ?? '')) throw new Error(`${what}: "where.field" is a plain field name`)
        if (!['string', 'number', 'boolean'].includes(typeof filter.equals)) throw new Error(`${what}: "where.equals" is a string, number or boolean`)
      }
      if (enabledBy !== undefined) {
        if (!/^[A-Za-z][A-Za-z0-9]*\/[A-Za-z0-9_-]+$/.test(enabledBy?.doc ?? '')) {
          throw new Error(`${what}: "enabledBy.doc" is a collection/doc path under the host`)
        }
        if (!PLAIN_FIELD.test(enabledBy.field ?? '')) throw new Error(`${what}: "enabledBy.field" is a plain field name`)
      }
      if (typeof path !== 'string' || !path.startsWith('/') || path.split('{slug}').length !== 2) {
        throw new Error(`${what}: "path" is a site path with exactly one {slug}`)
      }
      for (const [key, value] of [['slugField', slugField], ['skipWhen', skipWhen]]) {
        if (value !== undefined && !PLAIN_FIELD.test(value)) throw new Error(`${what}: "${key}" is a plain field name`)
      }
      if (lastmod !== undefined) plainFieldList(lastmod, `${what} lastmod`)
      rows.push({ pluginId: plugin.id, ...declaration })
    }
  }
  return rows
}

/**
 * The child-sitemap families each plugin's READER lists (AGL-3475), for pages
 * no single site collection describes — record pages, served at a base each
 * site picks from rows the organization keeps.
 *
 * Checked here: one owner per family, a lowercase segment that is none of the
 * platform's sections, no `content-` and no plugin's declared collection
 * section, no family that is a prefix of another (a child name has to say
 * which family it is), and a `serverDeclarations` registrar to register the
 * reader from.
 */
function sitemapReaderRows() {
  const rows = []
  const owners = new Map()
  const collectionSections = new Set(sitemapSectionRows().map((row) => row.section))
  for (const plugin of config.plugins) {
    const declared = plugin.sitemapReaders
    if (!declared) continue
    const where = `plugins.config.json: "${plugin.id}" sitemapReaders`
    if (!Array.isArray(declared) || !declared.length) {
      throw new Error(`${where} is present and declares nothing — drop it, or name the section`)
    }
    if (!plugin.register?.serverDeclarations) {
      throw new Error(`${where}: a reader registers from serverDeclarations, which "${plugin.id}" does not declare`)
    }
    for (const entry of declared) {
      const { $comment: _note, ...declaration } = entry
      const { section, ...rest } = declaration
      if (Object.keys(rest).length) throw new Error(`${where}: a reader declares only its "section"`)
      if (typeof section !== 'string' || !/^[a-z][a-z0-9]*$/.test(section)) {
        throw new Error(`${where}: a section is a lowercase word, no hyphens — its children are "{section}-{key}"`)
      }
      const what = `${where} "${section}"`
      if (CORE_SITEMAP_SECTIONS.includes(section) || section === 'content') {
        throw new Error(`${what} is a section the platform builds itself`)
      }
      if ([...collectionSections].some((name) => name === section || name.startsWith(`${section}-`))) {
        throw new Error(`${what} collides with a declared sitemap section`)
      }
      const held = owners.get(section)
      if (held) throw new Error(`${what} is already declared by "${held}" — one section has one owner`)
      owners.set(section, plugin.id)
      rows.push({ pluginId: plugin.id, section })
    }
  }
  return rows
}

/**
 * The ORG collections each plugin owns, for the media-usage scan (AGL-3273).
 *
 * The same checks as the host rows, minus the ones that only mean something
 * for a host: one owner per name, a reason to skip, a route the owner serves,
 * and — the one field the host rows do not have — `siteField`, the document
 * field naming the site a row belongs to, which has to be a plain field name.
 * `own` is refused: no dedicated pass reads an org collection.
 */
function orgCollectionRows() {
  const rows = []
  const owners = new Map()
  for (const plugin of config.plugins) {
    const declared = plugin.orgCollections
    if (!declared) continue
    const where = `plugins.config.json: "${plugin.id}" orgCollections`
    if (!Array.isArray(declared) || !declared.length) {
      throw new Error(`${where} is present and declares nothing — drop it, or name what the plugin owns`)
    }
    const routes = (plugin.contributes?.console?.routes ?? []).map((route) => route.replace(/^\//, ''))
    for (const declaration of declared) {
      const { name, label, mediaScan, mediaScanReason, routeSlug, siteField, holdsTransferWhile } = declaration
      const what = `${where} "${name ?? ''}"`
      if (typeof name !== 'string' || !name.trim()) throw new Error(`${where}: a collection needs a "name"`)
      const held = owners.get(name)
      if (held) throw new Error(`${what} is already declared by "${held}" — one collection has one owner`)
      owners.set(name, plugin.id)
      if (mediaScan !== undefined && !['generic', 'none'].includes(mediaScan)) {
        throw new Error(`${what}: "mediaScan" is generic or none — no dedicated pass reads an org collection`)
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
      if (siteField !== undefined && (typeof siteField !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(siteField))) {
        throw new Error(`${what}: "siteField" is the plain name of the field naming a document's site`)
      }
      if (holdsTransferWhile !== undefined) {
        const { field, values } = holdsTransferWhile ?? {}
        if (!siteField) throw new Error(`${what}: "holdsTransferWhile" needs a "siteField" — it holds the site the documents name`)
        if (typeof field !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(field)) {
          throw new Error(`${what}: "holdsTransferWhile.field" is the plain name of the field holding the document's state`)
        }
        if (!Array.isArray(values) || !values.length || values.length > 10 || values.some((value) => typeof value !== 'string' || !value)) {
          throw new Error(`${what}: "holdsTransferWhile.values" names one to ten in-flight states`)
        }
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
      const { kind, order, collection, addonKind, includedEntitlement, purchaseCeilingEntitlement, nouns } = declaration
      const what = `${where} "${kind ?? ''}"`
      for (const [field, value] of [
        ['kind', kind],
        ['collection', collection],
        ['addonKind', addonKind],
        ['includedEntitlement', includedEntitlement],
        // Required, not optional. A capacity with no ceiling field would be
        // measured by the console meter as "included plus everything bought",
        // above the limit a create is actually refused at — a meter that says
        // there is room where the next create is refused.
        ['purchaseCeilingEntitlement', purchaseCeilingEntitlement],
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

/**
 * The kinds of entity a besigner picker lists, each declared by the plugin
 * that keeps it (AGL-3080).
 *
 * Compiled because the besigner decides whether an attribute IS a picker from
 * these on the panel's first render, and a kind that had not registered yet
 * would draw a bound element as an unbound field. Checked here: one owner per
 * kind and per attribute type, a scope core knows how to read, the words a
 * picker says, and a field-attribute only with the record kind its fields come
 * from.
 */
const ENTITY_PICKER_KEYS = new Set([
  'kind', 'attribute', 'scope', 'collection', 'nameField', 'where', 'searchable',
  'fieldsAttribute', 'fieldsFrom', 'singular', 'plural', 'page',
])

function entityPickerRows() {
  const rows = []
  const kinds = new Map()
  const attributes = new Map()
  for (const plugin of config.plugins) {
    const declared = plugin.entityPickers
    if (declared === undefined) continue
    const where = `plugins.config.json: "${plugin.id}" entityPickers`
    if (!Array.isArray(declared) || !declared.length) {
      throw new Error(`${where} is present and declares nothing — drop it, or name the kinds the plugin supplies`)
    }
    for (const declaration of declared) {
      const what = `${where} "${declaration?.kind ?? ''}"`
      const unknown = Object.keys(declaration ?? {}).filter((key) => !ENTITY_PICKER_KEYS.has(key))
      if (unknown.length) throw new Error(`${what}: unknown key(s) ${unknown.join(', ')}`)
      const { kind, attribute, scope, collection, nameField, where: clauses, searchable, fieldsAttribute, fieldsFrom } = declaration
      for (const [field, value] of [
        ['kind', kind],
        ['attribute', attribute],
        ['collection', collection],
        ['nameField', nameField],
        ['singular', declaration.singular],
        ['plural', declaration.plural],
        ['page', declaration.page],
      ]) {
        if (typeof value !== 'string' || !value.trim()) throw new Error(`${what} needs a "${field}"`)
      }
      if (scope !== 'host' && scope !== 'orgData') {
        throw new Error(`${what}: "scope" is "host" (the site's own) or "orgData" (the organization's data, shared per site)`)
      }
      if (searchable !== undefined && typeof searchable !== 'boolean') throw new Error(`${what}: "searchable" is a boolean`)
      if (
        clauses !== undefined &&
        (!Array.isArray(clauses) ||
          clauses.some(
            (clause) =>
              typeof clause?.field !== 'string' ||
              !clause.field.trim() ||
              !['string', 'number', 'boolean'].includes(typeof clause.equals) ||
              Object.keys(clause).length !== 2,
          ))
      ) {
        throw new Error(`${what}: "where" is a list of { field, equals } equality clauses`)
      }
      if ((fieldsAttribute === undefined) !== (fieldsFrom === undefined)) {
        throw new Error(`${what}: "fieldsAttribute" and "fieldsFrom" come together — the attribute that offers an entity's fields, and the record kind they are read from`)
      }
      const heldKind = kinds.get(kind)
      if (heldKind) throw new Error(`${what} is already declared by "${heldKind}" — one kind has one owner`)
      kinds.set(kind, plugin.id)
      for (const type of [attribute, fieldsAttribute].filter(Boolean)) {
        const held = attributes.get(type)
        if (held) throw new Error(`${what}: attribute type "${type}" already lists "${held}"`)
        attributes.set(type, kind)
      }
      rows.push({ pluginId: plugin.id, ...declaration })
    }
  }
  return rows
}

/**
 * What a site's template library calls a template a plugin INSTALLED
 * (AGL-3080): the `source.type` the plugin's install route stamps, and the
 * badge and sentence the library shows for it. `authored` and `starter` are
 * the platform's own values and cannot be declared; a type belongs to one
 * plugin, because a library that found two owners for one stamp could not say
 * where the template came from.
 */
function templateSourceRows() {
  const rows = []
  const taken = new Map([
    ['authored', 'the platform'],
    ['starter', 'the platform'],
  ])
  for (const plugin of config.plugins) {
    const declared = plugin.templateSource
    if (declared === undefined) continue
    const where = `plugins.config.json: "${plugin.id}" templateSource`
    if (!declared || typeof declared !== 'object' || Array.isArray(declared)) {
      throw new Error(`${where} is an object: { "type", "label", "description" }`)
    }
    const { type, label, description, $comment: _note, ...rest } = declared
    const unknown = Object.keys(rest)
    if (unknown.length) throw new Error(`${where}: unknown key(s) ${unknown.join(', ')}`)
    if (typeof type !== 'string' || !/^[a-z][A-Za-z0-9]*$/.test(type)) {
      throw new Error(`${where}: "type" is the plain word the install route stamps as source.type`)
    }
    if (taken.has(type)) {
      throw new Error(`${where}: "${type}" is already a template source of ${taken.get(type)}`)
    }
    taken.set(type, `"${plugin.id}"`)
    if (typeof label !== 'string' || !label.trim() || label.length > 40) {
      throw new Error(`${where}: "label" is the badge's text, 1 to 40 characters`)
    }
    if (typeof description !== 'string' || !description.trim()) {
      throw new Error(`${where}: "description" says in a sentence where the template came from`)
    }
    rows.push({ pluginId: plugin.id, type, label, description })
  }
  return rows
}

/**
 * Where published plugin versions and their kill switches live (AGL-3080),
 * declared by the one plugin that distributes them. The realm loader reads
 * this and names no collection of its own; with none declared it resolves
 * nothing, which is the only safe answer for a store nobody named.
 *
 * Checked here: one declarer at most, and three plain collection names.
 */
function pluginDistributionRow() {
  const declared = config.plugins.filter((plugin) => plugin.pluginDistribution)
  if (declared.length > 1) {
    throw new Error(
      `plugins.config.json: "${declared.map((plugin) => plugin.id).join('", "')}" each declare a pluginDistribution — ` +
        'the realm loader joins against ONE store, and two would leave it choosing whose kill switch to honor',
    )
  }
  const plugin = declared[0]
  if (!plugin) return null
  const where = `plugins.config.json: "${plugin.id}" pluginDistribution`
  const row = { pluginId: plugin.id }
  for (const field of ['listings', 'versions', 'revocations']) {
    const value = plugin.pluginDistribution[field]
    if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(value)) {
      throw new Error(`${where}: "${field}" is the plain name of a collection`)
    }
    row[field] = value
  }
  return row
}

/**
 * The plugin that answers a published page's repeats (AGL-3080): whose rows an
 * element repeats over, read by the server composition through
 * `plugin-manager/repeat-rows.ts`. Declared here as well as registered at boot,
 * so a boot that failed to register the reader is refused rather than read as
 * "no rows"; with none declared, a repeat renders its element once.
 *
 * Checked here: one declarer at most — the expansion reads one key per node,
 * so two sources would each answer for the other's keys — a plain `id`, and
 * the `serverDeclarations` entry the reader is registered from.
 */
function repeatSourceRow() {
  const declared = config.plugins.filter((plugin) => plugin.repeatSource)
  if (declared.length > 1) {
    throw new Error(
      `plugins.config.json: "${declared.map((plugin) => plugin.id).join('", "')}" each declare a repeatSource — ` +
        'a repeat names one key, and two sources would each answer for the other\'s rows',
    )
  }
  const plugin = declared[0]
  if (!plugin) return null
  const where = `plugins.config.json: "${plugin.id}" repeatSource`
  const { id } = plugin.repeatSource
  if (typeof id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(id)) {
    throw new Error(`${where}: "id" is the source's plain lowercase id`)
  }
  if (!plugin.register?.serverDeclarations) {
    throw new Error(
      `${where}: the reader is registered from a "serverDeclarations" entry, and this plugin names none — ` +
        'a declared source nothing registers refuses every page that repeats',
    )
  }
  return { pluginId: plugin.id, id }
}

/**
 * The site documents a plugin authors in the besigner (AGL-3080), served by
 * the console's one editor route for plugin documents
 * (`plugin-manager/besigner-documents.ts`).
 *
 * Checked here, because a mistake in any of these is an editor link that
 * 404s or a publish that goes nowhere: a unique `kind` and `segment`, a
 * segment the console does not already route for its own documents, a
 * `collection` the same plugin declares in `hostCollections` (so the media
 * scan, the reference rows and the counters already know it), a noun, and a
 * `publish` route under `/api/` with the body field that names the document.
 */
const CONSOLE_EDITOR_SEGMENTS = new Set(['components', 'emails', 'layouts', 'screens', 'templates', 'theme'])

function besignerDocumentRows() {
  const rows = []
  const kinds = new Map()
  const segments = new Map()
  const plainId = /^[a-z][a-z0-9-]*$/
  for (const plugin of config.plugins) {
    for (const [index, declared] of (plugin.besignerDocuments ?? []).entries()) {
      const where = `plugins.config.json: "${plugin.id}" besignerDocuments[${index}]`
      const { kind, segment, collection, noun, publish } = declared ?? {}
      for (const [field, value] of Object.entries({ kind, segment, collection })) {
        if (typeof value !== 'string' || !plainId.test(value)) {
          throw new Error(`${where}: "${field}" is a plain lowercase id`)
        }
      }
      if (typeof noun !== 'string' || !noun.trim() || noun !== noun.toLowerCase()) {
        throw new Error(`${where}: "noun" is what one is called, lower case`)
      }
      if (kinds.has(kind)) {
        throw new Error(`${where}: kind "${kind}" is already declared by "${kinds.get(kind)}"`)
      }
      if (segments.has(segment)) {
        throw new Error(`${where}: segment "${segment}" is already declared by "${segments.get(segment)}"`)
      }
      if (CONSOLE_EDITOR_SEGMENTS.has(segment)) {
        throw new Error(`${where}: segment "${segment}" is one the console routes for its own documents`)
      }
      if (!(plugin.hostCollections ?? []).some((one) => one?.name === collection)) {
        throw new Error(
          `${where}: collection "${collection}" is not in this plugin's "hostCollections" — ` +
            'a document the besigner edits is one the media scan and the counters must know',
        )
      }
      if (
        typeof publish?.path !== 'string' ||
        !/^\/api\/[a-z0-9/-]+$/.test(publish.path) ||
        typeof publish?.idField !== 'string' ||
        !/^[a-z][A-Za-z0-9]*$/.test(publish.idField)
      ) {
        throw new Error(`${where}: "publish" is { "path": "/api/…", "idField": "<bodyField>" }`)
      }
      kinds.set(kind, plugin.id)
      segments.set(segment, plugin.id)
      rows.push({ pluginId: plugin.id, kind, segment, collection, noun, publish: { path: publish.path, idField: publish.idField } })
    }
  }
  return rows
}

/**
 * The plugin whose records a form's submission may also be filed as
 * (AGL-3080), through `plugin-manager/submission-record-target.ts`. Declared
 * as well as registered for the reason `repeatSourceRow` gives: a boot that
 * did not register it must be refused, not read as "forms write nowhere".
 *
 * Checked here: one declarer at most — a form node carries one destination —
 * a plain `id`, and the `serverDeclarations` entry it registers from.
 */
function formRecordTargetRow() {
  const declared = config.plugins.filter((plugin) => plugin.formRecordTarget)
  if (declared.length > 1) {
    throw new Error(
      `plugins.config.json: "${declared.map((plugin) => plugin.id).join('", "')}" each declare a formRecordTarget — ` +
        'a submission is filed in one place, and two targets would each read the other\'s binding',
    )
  }
  const plugin = declared[0]
  if (!plugin) return null
  const where = `plugins.config.json: "${plugin.id}" formRecordTarget`
  const { id } = plugin.formRecordTarget
  if (typeof id !== 'string' || !/^[a-z][a-z0-9-]*$/.test(id)) {
    throw new Error(`${where}: "id" is the target's plain lowercase id`)
  }
  if (!plugin.register?.serverDeclarations) {
    throw new Error(
      `${where}: the target is registered from a "serverDeclarations" entry, and this plugin names none — ` +
        'a declared target nothing registers refuses every page that carries a form',
    )
  }
  return { pluginId: plugin.id, id }
}

/**
 * The installable artifact types a plugin keeps the copies of (AGL-3080),
 * through `plugin-manager/plugin-artifact-types.ts`: the installer asks the
 * type's owner to publish, install and update a copy, and never reaches into
 * the owner's storage. Declared as well as registered for the reason
 * `repeatSourceRow` gives: a boot that did not register an owner must be
 * refused, not read as "nobody keeps this type".
 *
 * Checked here: a plain camelCase `type` (it is stored on listings and
 * provenance stamps), one owner per type, no other key, and a declarations
 * entry on the console's server for the owner to register from.
 */
function artifactTypeRows() {
  const rows = []
  const owners = new Map()
  for (const plugin of config.plugins) {
    const declared = plugin.artifactTypes
    if (declared === undefined) continue
    const where = `plugins.config.json: "${plugin.id}" artifactTypes`
    if (!Array.isArray(declared) || !declared.length) {
      throw new Error(`${where} is present and declares nothing — drop it, or name the types this plugin keeps`)
    }
    if (!plugin.register?.consoleServerDeclarations && !plugin.register?.serverDeclarations) {
      throw new Error(
        `${where}: an owner is registered from a "consoleServerDeclarations" (or "serverDeclarations") entry, ` +
          'and this plugin names neither — a declared type nothing registers refuses every install of it',
      )
    }
    for (const [index, row] of declared.entries()) {
      const at = `${where}[${index}]`
      const { $comment: _comment, type, ...rest } = row ?? {}
      if (Object.keys(rest).length) throw new Error(`${at}: unknown key(s) ${Object.keys(rest).join(', ')}`)
      if (typeof type !== 'string' || !/^[a-z][A-Za-z0-9]*$/.test(type)) {
        throw new Error(`${at}: "type" is the artifact type's plain camelCase id`)
      }
      if (owners.has(type)) {
        throw new Error(`${at}: type "${type}" is already declared by "${owners.get(type)}"`)
      }
      owners.set(type, plugin.id)
      rows.push({ pluginId: plugin.id, type })
    }
  }
  return rows
}

/**
 * A plugin's top-level collections whose documents name an organization in a
 * field (AGL-3080), which a workspace erasure sweeps by that field in every
 * process. One owner per collection; plain names only.
 */
function orgKeyedCollectionRows() {
  const rows = []
  const owners = new Map()
  for (const plugin of config.plugins) {
    const declared = plugin.orgKeyedCollections
    if (!declared) continue
    const where = `plugins.config.json: "${plugin.id}" orgKeyedCollections`
    if (!Array.isArray(declared) || !declared.length) {
      throw new Error(`${where} is present and declares nothing — drop it, or name what the erasure must sweep`)
    }
    for (const { name, orgField } of declared) {
      const what = `${where} "${name ?? ''}"`
      if (typeof name !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(name)) {
        throw new Error(`${where}: a collection needs a plain "name"`)
      }
      if (typeof orgField !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(orgField)) {
        throw new Error(`${what}: "orgField" is the plain name of the field naming a document's organization`)
      }
      const held = owners.get(name)
      if (held) throw new Error(`${what} is already declared by "${held}" — one collection has one owner`)
      owners.set(name, plugin.id)
      rows.push({ pluginId: plugin.id, name, orgField })
    }
  }
  return rows
}

/**
 * The analytics providers (AGL-3080): each plugin that adapts a vendor's
 * measurement tag declares it under `analyticsProvider` — the module its
 * adapter lives in, and which of a site's analytics settings configure a tag
 * it mounts. Core compiles the settings into the catalog, because the consent
 * gate asks "does this site run a tag?" synchronously during render, where a
 * registry nothing had filled yet would answer "no" and leave a tag with no
 * banner in front of it. The module is written into each app's
 * `plugins.analytics.generated.ts` as an `import()`, fetched only by a
 * document that uses it.
 *
 * Checked here: a plain module path, at least one setting, plain setting
 * names, and no setting claimed by two providers — two adapters mounting a tag
 * for one id would load the vendor twice.
 */
function analyticsProviderRows() {
  const claimed = new Map()
  const rows = []
  for (const plugin of config.plugins) {
    const declared = plugin.analyticsProvider
    if (!declared) continue
    const where = `plugins.config.json: "${plugin.id}" analyticsProvider`
    if (typeof declared.module !== 'string' || !/^[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)*$/.test(declared.module)) {
      throw new Error(`${where}: "module" is a subpath of the plugin's package`)
    }
    if (!Array.isArray(declared.settings) || !declared.settings.length) {
      throw new Error(`${where}: "settings" names at least one analytics setting`)
    }
    for (const field of declared.settings) {
      if (typeof field !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(field)) {
        throw new Error(`${where}: "${field}" is not the plain name of an analytics setting`)
      }
      if (claimed.has(field)) {
        throw new Error(`${where}: "${field}" is already mounted by "${claimed.get(field)}"`)
      }
      claimed.set(field, plugin.id)
    }
    rows.push({ plugin, module: declared.module, settings: [...declared.settings] })
  }
  return rows
}

/**
 * The notification categories the core owns (`CoreNotificationCategory` in
 * core `notifications.ts`). A declaration may not reuse one: the id keys
 * every stored preference, so a plugin that claimed `billing` would take over
 * a switch people set about their invoices.
 */
const CORE_NOTIFICATION_CATEGORIES = ['billing', 'team', 'content', 'support', 'system', 'staff']

/**
 * Notification categories a plugin declares for the notifications it sends
 * (AGL-3080), compiled into core because the fan-out resolves a recipient's
 * channels in server processes that load no plugin.
 *
 * Checked here: an id that is a plain type prefix, owned by one plugin and
 * not by the core, a label and a description a reader can act on, and a
 * default for each channel.
 */
function notificationCategoryRows() {
  const owners = new Map(CORE_NOTIFICATION_CATEGORIES.map((id) => [id, 'the core']))
  const rows = []
  for (const plugin of config.plugins) {
    const declared = plugin.notificationCategories
    if (declared === undefined) continue
    const where = `plugins.config.json: "${plugin.id}" notificationCategories`
    if (!Array.isArray(declared) || !declared.length) {
      throw new Error(`${where} is present and declares nothing — drop it, or name the category`)
    }
    for (const declaration of declared) {
      const { id, label, description, defaults } = declaration ?? {}
      const what = `${where} "${id ?? ''}"`
      if (typeof id !== 'string' || !/^[a-z][a-zA-Z]*$/.test(id)) {
        throw new Error(`${what}: "id" is the plain prefix before the dot in the plugin's notification types`)
      }
      if (owners.has(id)) {
        throw new Error(`${what} is already a category of ${owners.get(id)} — a stored preference would change meaning`)
      }
      owners.set(id, `"${plugin.id}"`)
      for (const [field, value] of [['label', label], ['description', description]]) {
        if (typeof value !== 'string' || !value.trim()) throw new Error(`${what} needs a "${field}"`)
      }
      for (const channel of ['console', 'email']) {
        if (typeof defaults?.[channel] !== 'boolean') {
          throw new Error(`${what} needs "defaults.${channel}" — what the channel does before anybody says`)
        }
      }
      rows.push({
        pluginId: plugin.id,
        id,
        label,
        description,
        defaults: { console: defaults.console, email: defaults.email },
      })
    }
  }
  return rows
}

/**
 * A plugin's public door, as its owner and staff are told about a flood
 * (AGL-3080): the two site counters its ceiling refusals and its honeypot
 * catches are kept in, and the words the notices are built from. Compiled so
 * the Inbox and the staff pages read every door without loading the plugin
 * that keeps it.
 *
 * Checked here: a plain door no other plugin declares, two plain counters no
 * other door keeps, every word, and each noun in both its counts.
 */
const VISITOR_DOOR_WORDS = ['pausedTitle', 'cause', 'pausedChip', 'caughtBy']
const VISITOR_DOOR_NOUNS = ['noun', 'staffNoun', 'caught', 'caughtChip']

function visitorDoorRows() {
  const doors = new Map()
  const counters = new Map()
  const rows = []
  for (const plugin of config.plugins) {
    const declared = plugin.visitorDoors
    if (declared === undefined) continue
    const where = `plugins.config.json: "${plugin.id}" visitorDoors`
    if (!Array.isArray(declared) || !declared.length) {
      throw new Error(`${where} is present and declares nothing — drop it, or name the door`)
    }
    for (const declaration of declared) {
      const { door, refusedCounter, caughtCounter, words } = declaration ?? {}
      const what = `${where} "${door ?? ''}"`
      const unknown = Object.keys(declaration ?? {}).filter(
        (key) => !['door', 'refusedCounter', 'caughtCounter', 'words'].includes(key),
      )
      if (unknown.length) throw new Error(`${what}: unknown key(s) ${unknown.join(', ')}`)
      if (typeof door !== 'string' || !PLAIN_NAME.test(door)) throw new Error(`${what}: "door" is a plain name`)
      if (doors.has(door)) throw new Error(`${what} is already kept by "${doors.get(door)}"`)
      doors.set(door, plugin.id)
      for (const [field, counter] of [['refusedCounter', refusedCounter], ['caughtCounter', caughtCounter]]) {
        if (typeof counter !== 'string' || !PLAIN_NAME.test(counter)) {
          throw new Error(`${what}: "${field}" is the plain id of a site counter`)
        }
        if (counters.has(counter)) throw new Error(`${what}: counter "${counter}" is already ${counters.get(counter)}'s`)
        counters.set(counter, door)
      }
      if (!words || typeof words !== 'object') throw new Error(`${what} needs its "words"`)
      const unknownWords = Object.keys(words).filter(
        (key) => !VISITOR_DOOR_WORDS.includes(key) && !VISITOR_DOOR_NOUNS.includes(key),
      )
      if (unknownWords.length) throw new Error(`${what}: unknown word(s) ${unknownWords.join(', ')}`)
      for (const key of VISITOR_DOOR_WORDS) {
        if (typeof words[key] !== 'string' || !words[key].trim()) throw new Error(`${what}: "words.${key}" is a sentence`)
      }
      for (const key of VISITOR_DOOR_NOUNS) {
        const noun = words[key]
        if ([noun?.one, noun?.other].some((form) => typeof form !== 'string' || !form.trim())) {
          throw new Error(`${what}: "words.${key}" is { one, other }`)
        }
      }
      rows.push({ pluginId: plugin.id, door, refusedCounter, caughtCounter, words })
    }
  }
  return rows
}

/**
 * Where a person reads a record kind, declared by the plugin whose console
 * page shows it (AGL-3080), compiled so a server that tells a person about a
 * record — a notification's link — can ask for the kind without loading the
 * plugin that draws the page.
 *
 * Checked here: a plain kind no other plugin shows, and a path under one of
 * the declaring plugin's OWN site console routes, so a plugin can only point
 * at a page it draws. The optional `record` — where one record opens, and the
 * query key its id rides under (AGL-3461) — is held to the same routes.
 */
function recordPageRows() {
  const owners = new Map()
  const rows = []
  for (const plugin of config.plugins) {
    const declared = plugin.recordPages
    if (declared === undefined) continue
    const where = `plugins.config.json: "${plugin.id}" recordPages`
    if (!Array.isArray(declared) || !declared.length) {
      throw new Error(`${where} is present and declares nothing — drop it, or name the kinds its pages show`)
    }
    const routes = plugin.contributes?.console?.routes ?? []
    for (const declaration of declared) {
      const { kind, path, record } = declaration ?? {}
      const what = `${where} "${kind ?? ''}"`
      const unknown = Object.keys(declaration ?? {}).filter(
        (key) => key !== 'kind' && key !== 'path' && key !== 'record',
      )
      if (unknown.length) throw new Error(`${what}: unknown key(s) ${unknown.join(', ')}`)
      if (typeof kind !== 'string' || !PLAIN_NAME.test(kind)) {
        throw new Error(`${what}: "kind" is the plain record kind the page shows`)
      }
      if (owners.has(kind)) throw new Error(`${what} is already shown by "${owners.get(kind)}"`)
      owners.set(kind, plugin.id)
      if (
        typeof path !== 'string' ||
        !/^\/[a-z0-9/-]+$/.test(path) ||
        !routes.some((route) => path === route || path.startsWith(`${route}/`))
      ) {
        throw new Error(`${what}: "path" "${path ?? ''}" is not under one of "${plugin.id}"'s own console routes (${routes.join(', ') || 'none'})`)
      }
      if (record !== undefined) {
        const extra = Object.keys(record ?? {}).filter((key) => key !== 'path' && key !== 'param')
        if (extra.length) throw new Error(`${what}: "record" has unknown key(s) ${extra.join(', ')}`)
        if (
          typeof record?.path !== 'string' ||
          !/^\/[a-z0-9/-]+$/.test(record.path) ||
          !routes.some((route) => record.path === route || record.path.startsWith(`${route}/`))
        ) {
          throw new Error(`${what}: "record.path" "${record?.path ?? ''}" is not under one of "${plugin.id}"'s own console routes`)
        }
        if (typeof record.param !== 'string' || !/^[a-z][a-zA-Z0-9]*$/.test(record.param)) {
          throw new Error(`${what}: "record.param" is the plain query key the page opens one record by`)
        }
      }
      rows.push({
        pluginId: plugin.id,
        kind,
        path,
        ...(record ? { record: { path: record.path, param: record.param } } : {}),
      })
    }
  }
  return rows
}

/**
 * Digests a plugin sends on its own schedule (AGL-3080), compiled into core
 * so the settings page draws each switch without loading the plugin.
 *
 * Checked here: a plain key no other digest stores its switch under, and a
 * label and a description.
 */
function notificationDigestRows() {
  const owners = new Map()
  const rows = []
  for (const plugin of config.plugins) {
    const declared = plugin.notificationDigests
    if (declared === undefined) continue
    const where = `plugins.config.json: "${plugin.id}" notificationDigests`
    if (!Array.isArray(declared) || !declared.length) {
      throw new Error(`${where} is present and declares nothing — drop it, or name the digest`)
    }
    for (const declaration of declared) {
      const { key, label, description } = declaration ?? {}
      const what = `${where} "${key ?? ''}"`
      if (typeof key !== 'string' || !/^[a-z][a-zA-Z0-9]*$/.test(key)) {
        throw new Error(`${what}: "key" is the plain name its switch is stored under`)
      }
      if (owners.has(key)) {
        throw new Error(`${what} is already the switch of "${owners.get(key)}"'s digest`)
      }
      owners.set(key, plugin.id)
      for (const [field, value] of [['label', label], ['description', description]]) {
        if (typeof value !== 'string' || !value.trim()) throw new Error(`${what} needs a "${field}"`)
      }
      rows.push({ pluginId: plugin.id, key, label, description })
    }
  }
  return rows
}

/**
 * The interaction steps (AGL-3080): each plugin that adds a step to
 * interactions declares it under `interactionSteps` — the `type` it is stored
 * under, how editors, run histories and drafters name it, and, for a step
 * that PICKS one of the plugin's records, the site collection the records are
 * listed from and the step fields that hold the pick. A step only an
 * automation holds is `offered: false`, so the besigner's interaction builder
 * leaves it out; a step that suspends the run `holds` it for a band of whole
 * minutes; and `typedFields` are the fields a person types words into, where a
 * drafted step may leave a placeholder. Core compiles them into the catalog,
 * because the builder, every validator, a visitor's page and a drafter read
 * them with no plugin loaded, and a step whose pick nothing checked would save
 * naming nothing.
 *
 * Checked here: a plain type no other plugin declares, a label, only the
 * known keys, and a pick listed from a collection the SAME plugin declares
 * under `hostCollections` — a plugin offers its own records, never another's —
 * with plain, distinct field names, a limit from 1 to 200, and the words the
 * builder shows; `offered` only as `false`; a hold band of whole minutes, at
 * least one, its floor under its ceiling, and a plain timeout field; typed
 * fields named once each, with the words a sentence calls them.
 */
function interactionStepRows() {
  const claimed = new Map()
  const rows = []
  const plain = /^[a-z][A-Za-z0-9]*$/
  const words = (value) => typeof value === 'string' && value.trim().length > 0
  for (const plugin of config.plugins) {
    const declared = plugin.interactionSteps
    if (declared === undefined) continue
    const where = `plugins.config.json: "${plugin.id}" interactionSteps`
    if (!Array.isArray(declared) || !declared.length) {
      throw new Error(`${where} is present and declares nothing — drop it, or name the steps the plugin offers`)
    }
    const owned = new Set((plugin.hostCollections ?? []).map((collection) => collection.name))
    for (const step of declared) {
      const { type, label, picks, offered, holds, typedFields, ...rest } = step ?? {}
      if (typeof type !== 'string' || !plain.test(type)) {
        throw new Error(`${where}: "type" is the plain name a step is stored under`)
      }
      const what = `${where} "${type}"`
      if (Object.keys(rest).length) throw new Error(`${what}: unknown key(s) ${Object.keys(rest).join(', ')}`)
      if (claimed.has(type)) throw new Error(`${what} is already declared by "${claimed.get(type)}"`)
      claimed.set(type, plugin.id)
      if (!words(label)) throw new Error(`${what}: "label" is how the builder names the step`)
      const row = { pluginId: plugin.id, type, label }
      if (offered !== undefined) {
        if (offered !== false) throw new Error(`${what}: "offered" is only ever false — a declared step is offered unless it says not`)
        row.offered = false
      }
      if (holds !== undefined) {
        const { minMinutes, maxMinutes, timeoutField, ...extra } = holds ?? {}
        if (Object.keys(extra).length) throw new Error(`${what}: unknown "holds" key(s) ${Object.keys(extra).join(', ')}`)
        if (!Number.isInteger(minMinutes) || !Number.isInteger(maxMinutes) || minMinutes < 1 || maxMinutes < minMinutes) {
          throw new Error(`${what}: "holds" is a band of whole minutes, from at least 1, its floor no higher than its ceiling`)
        }
        if (timeoutField !== undefined && (typeof timeoutField !== 'string' || !/^_?[a-z][A-Za-z0-9]*$/.test(timeoutField))) {
          throw new Error(`${what}: "holds.timeoutField" is the plain name of the field a timed-out hold leaves in scope`)
        }
        row.holds = { minMinutes, maxMinutes, ...(timeoutField !== undefined ? { timeoutField } : {}) }
      }
      if (typedFields !== undefined) {
        if (!Array.isArray(typedFields) || !typedFields.length) {
          throw new Error(`${what}: "typedFields" is present and names nothing — drop it, or name the fields a person types words into`)
        }
        const keys = new Set()
        row.typedFields = typedFields.map((field) => {
          const { key, names, ...extra } = field ?? {}
          if (Object.keys(extra).length) throw new Error(`${what}: unknown "typedFields" key(s) ${Object.keys(extra).join(', ')}`)
          if (typeof key !== 'string' || !plain.test(key) || keys.has(key)) {
            throw new Error(`${what}: each of "typedFields" names one of the step's fields, once`)
          }
          if (!words(names)) throw new Error(`${what}: typed field "${key}" needs "names", what a sentence calls it`)
          keys.add(key)
          return { key, names }
        })
      }
      if (picks !== undefined) {
        const { collection, limit, idField, nameField, label: pickLabel, missing, ...extra } = picks ?? {}
        if (Object.keys(extra).length) throw new Error(`${what}: unknown "picks" key(s) ${Object.keys(extra).join(', ')}`)
        if (!owned.has(collection)) {
          throw new Error(
            `${what}: "picks.collection" "${collection}" is not one of "${plugin.id}"'s own hostCollections ` +
              `(${owned.size ? [...owned].join(', ') : 'it declares none'}) — a step picks its own plugin's records`,
          )
        }
        if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
          throw new Error(`${what}: "picks.limit" is a whole number from 1 to 200`)
        }
        if (typeof idField !== 'string' || !plain.test(idField) || typeof nameField !== 'string' || !plain.test(nameField)) {
          throw new Error(`${what}: "picks.idField" and "picks.nameField" are the plain names of the step's fields`)
        }
        if (idField === nameField) throw new Error(`${what}: the id and the name are two fields`)
        if (!words(pickLabel) || !words(missing)) {
          throw new Error(`${what}: "picks.label" names the picker and "picks.missing" tells a step with no pick what to do`)
        }
        row.picks = { collection, limit, idField, nameField, label: pickLabel, missing }
      }
      rows.push(row)
    }
  }
  return rows
}

/**
 * The server steps another plugin runs (AGL-3080): a plugin whose records an
 * automation step writes declares the step under `serverSteps`, and registers
 * its executor from its server declarations (`registerServerStepExecutor`).
 * The declaration is compiled into core so the engine can tell a step whose
 * executor did not register — a broken boot, refused as the step's failure —
 * from a step no plugin runs.
 *
 * Checked here: an array of `{ type }` rows, only the known keys, a plain
 * type, and one owner per type — no other plugin declares it as a server step
 * or offers it as an interaction step.
 */
function serverStepRows() {
  const offered = new Map()
  for (const plugin of config.plugins) {
    for (const step of plugin.interactionSteps ?? []) offered.set(step?.type, plugin.id)
  }
  const claimed = new Map()
  const rows = []
  const plain = /^[a-z][A-Za-z0-9]*$/
  for (const plugin of config.plugins) {
    const declared = plugin.serverSteps
    if (declared === undefined) continue
    const where = `plugins.config.json: "${plugin.id}" serverSteps`
    if (!Array.isArray(declared) || !declared.length) {
      throw new Error(`${where} is present and declares nothing — drop it, or name the steps the plugin runs`)
    }
    for (const step of declared) {
      const { type, ...rest } = step ?? {}
      if (typeof type !== 'string' || !plain.test(type)) {
        throw new Error(`${where}: "type" is the plain name a step is stored under`)
      }
      const what = `${where} "${type}"`
      if (Object.keys(rest).length) throw new Error(`${what}: unknown key(s) ${Object.keys(rest).join(', ')}`)
      if (claimed.has(type)) throw new Error(`${what} is already declared by "${claimed.get(type)}"`)
      if (offered.has(type) && offered.get(type) !== plugin.id) {
        throw new Error(`${what} is an interaction step "${offered.get(type)}" declares — one plugin owns a step`)
      }
      claimed.set(type, plugin.id)
      rows.push({ pluginId: plugin.id, type })
    }
  }
  return rows
}

/**
 * The interaction recipes (AGL-3080): a plugin that offers ready-to-edit
 * interactions declares their ids under `interactionRecipes`, and registers
 * the recipes themselves — which build their interaction in code — from its
 * declarations. The ids are compiled into core because a stored interaction
 * names the recipe it began as, and a validator must know that name in a
 * process where the author's declarations never ran.
 *
 * Checked here: an array of `{ id }` rows, only the known keys, a plain id,
 * and one owner per id.
 */
function interactionRecipeRows() {
  const claimed = new Map()
  const rows = []
  const plain = /^[a-z][A-Za-z0-9]*$/
  for (const plugin of config.plugins) {
    const declared = plugin.interactionRecipes
    if (declared === undefined) continue
    const where = `plugins.config.json: "${plugin.id}" interactionRecipes`
    if (!Array.isArray(declared) || !declared.length) {
      throw new Error(`${where} is present and declares nothing — drop it, or name the recipes the plugin offers`)
    }
    for (const recipe of declared) {
      const { id, ...rest } = recipe ?? {}
      if (typeof id !== 'string' || !plain.test(id)) {
        throw new Error(`${where}: "id" is the plain name a stored interaction's \`recipe\` stamp holds`)
      }
      const what = `${where} "${id}"`
      if (Object.keys(rest).length) throw new Error(`${what}: unknown key(s) ${Object.keys(rest).join(', ')}`)
      if (claimed.has(id)) throw new Error(`${what} is already declared by "${claimed.get(id)}"`)
      claimed.set(id, plugin.id)
      rows.push({ pluginId: plugin.id, id })
    }
  }
  return rows
}

/** The plugins whose org eraser an erasure may not run without (AGL-3080). */
function requiredOrgEraserIds() {
  return config.plugins
    .filter((plugin) => {
      if (plugin.requiredOrgEraser === undefined) return false
      if (plugin.requiredOrgEraser !== true) {
        throw new Error(`plugins.config.json: "${plugin.id}" requiredOrgEraser is true, or is left out`)
      }
      return true
    })
    .map((plugin) => plugin.id)
}

/**
 * The plugins whose person eraser a person erasure may not run without
 * (AGL-3080): each keeps a share of a person the erasure promises to remove —
 * the record system's people, a shop's buyers, a calendar's bookers, an
 * audience's members.
 */
function requiredPersonEraserIds() {
  return config.plugins
    .filter((plugin) => {
      if (plugin.requiredPersonEraser === undefined) return false
      if (plugin.requiredPersonEraser !== true) {
        throw new Error(`plugins.config.json: "${plugin.id}" requiredPersonEraser is true, or is left out`)
      }
      if (!plugin.register?.serverDeclarations && !plugin.register?.consoleServerDeclarations) {
        throw new Error(
          `plugins.config.json: "${plugin.id}" requiredPersonEraser needs a serverDeclarations or ` +
            'consoleServerDeclarations entry to register the eraser from',
        )
      }
      return true
    })
    .map((plugin) => plugin.id)
}

const ANALYTICS_MANIFESTS = [
  'apps/console/constants/plugins.analytics.generated.ts',
  'apps/tenant/utils/plugins.analytics.generated.ts',
]

function analyticsManifestContent() {
  const rows = analyticsProviderRows()
  return (
    `/**\n * GENERATED FILE — do not edit. Regenerate with:\n` +
    ` *   node tools/scripts/generate-plugin-manifests.mjs\n *\n` +
    ` * The plugins' ANALYTICS PROVIDERS (AGL-3080): the adapter each declares\n` +
    ` * under \`analyticsProvider\`, loaded with \`import()\` by a document that\n` +
    ` * uses it and registered with core's \`analytics-provider.ts\`. One of the\n` +
    ` * sanctioned @aglyn/plugins-* references outside libs/plugins (AGL-417).\n` +
    ` * Source of truth: plugins.config.json.\n */\n` +
    `/* eslint-disable @nx/enforce-module-boundaries */\n\n` +
    `import type { AnalyticsProviderLoader } from '@aglyn/aglyn/app-utils/analytics-provider'\n\n` +
    `export const ANALYTICS_PROVIDER_LOADERS: readonly AnalyticsProviderLoader[] = [\n` +
    rows
      .map(
        (row) =>
          `  {\n` +
          `    pluginId: '${row.plugin.id}',\n` +
          `    load: () => import('${row.plugin.package}/${row.module}'),\n` +
          `  },\n`,
      )
      .join('') +
    `]\n`
  )
}

/**
 * The plugins whose sales belong on the operator's sales tax return
 * (AGL-3080): each sells through the platform's own account and registers a
 * tax return source. The return refuses a declared source that registered
 * nothing, which a runtime registry alone could not tell from nothing sold.
 */
function taxReturnSourceIds() {
  return config.plugins
    .filter((plugin) => {
      if (plugin.taxReturnSource === undefined) return false
      if (plugin.taxReturnSource !== true) {
        throw new Error(`plugins.config.json: "${plugin.id}" taxReturnSource is true, or is left out`)
      }
      return true
    })
    .map((plugin) => plugin.id)
}

/**
 * The plugins whose earnings belong on the operator's revenue report
 * (AGL-3080): each earns a take through the platform's own account and
 * registers a revenue source. The report refuses a declared source that
 * registered nothing rather than read it as nothing earned.
 */
function revenueSourceIds() {
  return config.plugins
    .filter((plugin) => {
      if (plugin.revenueSource === undefined) return false
      if (plugin.revenueSource !== true) {
        throw new Error(`plugins.config.json: "${plugin.id}" revenueSource is true, or is left out`)
      }
      return true
    })
    .map((plugin) => plugin.id)
}

function catalogContent(videoEmbedRows, planEntitlements, usageAxes) {
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

import type { FirstPartyPlugin, PluginEditBarLink, PublishedSiteImpact } from './enabled-plugins'\nimport type { ResolvedPluginHostCollection, ResolvedPluginOrgCollection } from './plugin-host-collections'\nimport type { ResolvedPluginSitemapSection } from './plugin-sitemap-sections'\nimport type { ResolvedPluginSitemapReaderDeclaration } from './plugin-sitemap-readers'\nimport type { ResolvedPluginSiteBundleSectionDeclaration } from './plugin-site-bundle'\nimport type { ResolvedTransferResourceDeclaration } from './plugin-transfer-resources'\nimport type { ResolvedPluginOrgCapacity } from './plugin-org-capacity'\nimport type { ResolvedPluginEntityPicker } from './plugin-entity-pickers'\nimport type { ResolvedPluginRecordPage } from './plugin-record-pages'\nimport type { ResolvedVisitorDoor } from './plugin-visitor-doors'\nimport type { ResolvedPluginCostAxis, ResolvedPluginSpendLine, ResolvedPluginUsageBand, ResolvedPluginUsageMeter } from './plugin-usage-axes'\nimport type { ResolvedPluginPlanFeature, ResolvedPluginPlanQuota } from './plugin-plan-entitlements'\nimport type { FunctionBindings } from './plugin-contributions'\nimport type { PluginDistribution } from './plugin-distribution'\nimport type { RepeatSourceDeclaration } from './repeat-rows'\nimport type { PluginTemplateSource } from './plugin-template-sources'\nimport type { FormRecordTargetDeclaration } from './submission-record-target'\nimport type { ArtifactTypeDeclaration } from './plugin-artifact-types'\nimport type { ResolvedBesignerDocument } from './besigner-documents'\nimport type { PluginOrgKeyedCollection } from './plugin-org-erasure'\nimport type { ResolvedVideoEmbedProvider } from './video-embed-provider'\nimport type { AnalyticsProviderDeclaration } from '../app-utils/analytics-provider'\nimport type { InteractionStepDeclaration } from '../app-utils/site-interactions'\nimport type { ServerStepDeclaration } from './plugin-server-steps'\nimport type { InteractionRecipeDeclaration } from './interaction-recipes'\nimport type { NotificationCategoryDeclaration, NotificationDigestDeclaration } from '../app-utils/notifications'

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
 * Every child sitemap a first-party plugin's documents fill, declared by that
 * plugin (AGL-3080), in the order the index lists them.
 */
export const PLUGIN_SITEMAP_SECTIONS_DECLARED: readonly ResolvedPluginSitemapSection[] = [
${sitemapSectionRows().map((row) => `  ${indent(JSON.stringify(row, null, 2))},`).join('\n')}
]

/**
 * Every child-sitemap family a first-party plugin's reader lists, declared by
 * that plugin (AGL-3475), in the order the index lists them.
 */
export const PLUGIN_SITEMAP_READERS_DECLARED: readonly ResolvedPluginSitemapReaderDeclaration[] = ${JSON.stringify(sitemapReaderRows(), null, 2)}

/**
 * Every section of the whole-site backup a first-party plugin answers for,
 * declared by that plugin (AGL-3080), in the order the bundle carries them.
 */
export const PLUGIN_SITE_BUNDLE_SECTIONS_DECLARED: readonly ResolvedPluginSiteBundleSectionDeclaration[] = ${JSON.stringify(siteBundleSectionRows(), null, 2)}

/**
 * Every resource a first-party plugin can import or export, declared by that
 * plugin (AGL-3523), in the order the transfer hub lists them.
 */
export const PLUGIN_TRANSFER_RESOURCES_DECLARED: readonly ResolvedTransferResourceDeclaration[] = ${JSON.stringify(transferResourceRows(), null, 2)}

/**
 * Every org collection a first-party plugin owns whose documents the media
 * scan reads, declared by that plugin (AGL-3273).
 */
export const PLUGIN_ORG_COLLECTIONS_DECLARED: readonly ResolvedPluginOrgCollection[] = [
${orgCollectionRows().map((row) => `  ${indent(JSON.stringify(row, null, 2))},`).join('\n')}
]

/**
 * Every org capacity a first-party plugin backs, declared by that plugin
 * (AGL-3080). Core owns the money; this says what is counted and what it is
 * called.
 */
export const PLUGIN_ORG_CAPACITIES_DECLARED: readonly ResolvedPluginOrgCapacity[] = [
${orgCapacityRows().map((row) => `  ${indent(JSON.stringify(row, null, 2))},`).join('\n')}
]

/**
 * Every kind of entity a besigner picker lists, declared by the plugin that
 * keeps it (AGL-3080). Core reads, browses and resolves; this says where and
 * in what words.
 */
export const PLUGIN_ENTITY_PICKERS_DECLARED: readonly ResolvedPluginEntityPicker[] = [
${entityPickerRows().map((row) => `  ${indent(JSON.stringify(row, null, 2))},`).join('\n')}
]

/**
 * Every public door a first-party plugin keeps a ceiling and a honeypot on,
 * with its counters and words, declared by that plugin (AGL-3080).
 */
export const PLUGIN_VISITOR_DOORS_DECLARED: readonly ResolvedVisitorDoor[] = [
${visitorDoorRows().map((row) => `  ${indent(JSON.stringify(row, null, 2))},`).join('\n')}
]

/**
 * Where a person reads each record kind a first-party plugin's console page
 * shows, declared by that plugin (AGL-3080), for a server's notification link.
 */
export const PLUGIN_RECORD_PAGES_DECLARED: readonly ResolvedPluginRecordPage[] = [
${recordPageRows().map((row) => `  ${indent(JSON.stringify(row, null, 2))},`).join('\n')}
]

/**
 * What each plan includes of every quota a first-party plugin owns, declared
 * by that plugin (AGL-3080). \`PLAN_ENTITLEMENTS\` composes these; core names
 * no key.
 */
export const PLUGIN_PLAN_QUOTAS_DECLARED: readonly ResolvedPluginPlanQuota[] = [
${planEntitlements.quotas.map((row) => `  ${indent(literalRow(row))},`).join('\n')}
]

/**
 * What each plan includes of every feature a first-party plugin owns,
 * declared by that plugin (AGL-3080).
 */
export const PLUGIN_PLAN_FEATURES_DECLARED: readonly ResolvedPluginPlanFeature[] = [
${planEntitlements.features.map((row) => `  ${indent(literalRow(row))},`).join('\n')}
]

/**
 * Every meter a first-party plugin contributes to the platform's cost model,
 * in breakdown order, declared by that plugin (AGL-3080). Core keeps the rates.
 */
export const PLUGIN_COST_AXES_DECLARED: readonly ResolvedPluginCostAxis[] = [
${usageAxes.costAxes.map((row) => `  ${indent(JSON.stringify(row, null, 2))},`).join('\n')}
]

/**
 * Every band a first-party plugin contributes to the utilization table, in
 * column order, declared by that plugin (AGL-3080).
 */
export const PLUGIN_USAGE_BANDS_DECLARED: readonly ResolvedPluginUsageBand[] = [
${usageAxes.bands.map((row) => `  ${indent(JSON.stringify(row, null, 2))},`).join('\n')}
]

/**
 * Every line of a workspace's monthly spend a first-party plugin contributes
 * to its usage budget, in catalog order, declared by that plugin (AGL-3080).
 */
export const PLUGIN_SPEND_LINES_DECLARED: readonly ResolvedPluginSpendLine[] = [
${usageAxes.spendLines.map((row) => `  ${indent(JSON.stringify(row, null, 2))},`).join('\n')}
]

/**
 * Every meter a first-party plugin measures in the monthly usage sweep, in
 * catalog order, declared by that plugin (AGL-3080). The sweep refuses to bill
 * a month while one of these is unregistered.
 */
export const PLUGIN_USAGE_METERS_DECLARED: readonly ResolvedPluginUsageMeter[] = [
${usageAxes.meters.map((row) => `  ${JSON.stringify(row)},`).join('\n')}
]

/**
 * Every top-level plugin collection a workspace erasure sweeps by the field
 * naming the organization, declared by the plugin that owns it (AGL-3080).
 */
export const PLUGIN_ORG_KEYED_COLLECTIONS: readonly PluginOrgKeyedCollection[] = [
${orgKeyedCollectionRows().map((row) => `  ${indent(JSON.stringify(row, null, 2))},`).join('\n')}
]

/**
 * The plugins whose org eraser a workspace erasure may not run without
 * (AGL-3080): each holds a record the erasure promises to destroy.
 */
export const PLUGIN_REQUIRED_ORG_ERASERS: readonly string[] = ${JSON.stringify(requiredOrgEraserIds())}

/**
 * The plugins whose person eraser a person erasure may not run without
 * (AGL-3080): each keeps a share of the person the erasure promises to remove.
 */
export const PLUGIN_REQUIRED_PERSON_ERASERS: readonly string[] = ${JSON.stringify(requiredPersonEraserIds())}

/**
 * The plugins whose sales the operator's sales tax return may not be filed
 * without (AGL-3080): each registers a tax return source, and one that did
 * not is refused rather than read as nothing sold.
 */
export const PLUGIN_TAX_RETURN_SOURCES: readonly string[] = ${JSON.stringify(taxReturnSourceIds())}

/**
 * The plugins whose earnings the operator's revenue report may not be read
 * without (AGL-3080): each registers a revenue source, and one that did not
 * is refused rather than read as nothing earned.
 */
export const PLUGIN_REVENUE_SOURCES: readonly string[] = ${JSON.stringify(revenueSourceIds())}

/**
 * Where published plugin versions and their kill switches are stored, declared
 * by the plugin that distributes them (AGL-3080). \`null\` when none does, and
 * the realm loader then resolves nothing.
 */
export const PLUGIN_DISTRIBUTION: PluginDistribution | null = ${JSON.stringify(pluginDistributionRow(), null, 2)}

/**
 * The plugin that answers a published page's repeats, declared by that plugin
 * (AGL-3080). \`null\` when none does, and a repeat then renders its element
 * once, as written.
 */
export const PLUGIN_REPEAT_SOURCE_DECLARED: RepeatSourceDeclaration | null = ${JSON.stringify(repeatSourceRow(), null, 2)}

/**
 * The site documents a plugin authors in the besigner, declared by that
 * plugin (AGL-3080). Empty when none does, and the console's plugin-document
 * editor routes answer 404.
 */
export const PLUGIN_BESIGNER_DOCUMENTS_DECLARED: readonly ResolvedBesignerDocument[] = [
${besignerDocumentRows().map((row) => `  ${JSON.stringify(row, null, 2).split('\n').join('\n  ')},`).join('\n')}
]

/**
 * The plugin whose records a form's submission may also be filed as, declared
 * by that plugin (AGL-3080). \`null\` when none does, and no form writes one.
 */
export const PLUGIN_FORM_RECORD_TARGET_DECLARED: FormRecordTargetDeclaration | null = ${JSON.stringify(formRecordTargetRow(), null, 2)}

/**
 * The installable artifact types a first-party plugin keeps the copies of,
 * declared by that plugin (AGL-3080). Empty when none does, and an installer
 * then refuses every listing of a type nobody keeps.
 */
export const PLUGIN_ARTIFACT_TYPES_DECLARED: readonly ArtifactTypeDeclaration[] = [
${artifactTypeRows().map((row) => `  ${JSON.stringify(row)},`).join('\n')}
]

/**
 * What a site's template library calls a template a plugin installed, by the
 * \`source.type\` that plugin stamps, declared by that plugin (AGL-3080).
 * Core names no installer.
 */
export const PLUGIN_TEMPLATE_SOURCES: readonly PluginTemplateSource[] = [
${templateSourceRows().map((row) => `  ${indent(JSON.stringify(row, null, 2))},`).join('\n')}
]

/**
 * The analytics settings each provider mounts a tag for, declared by the
 * plugin that adapts the vendor (AGL-3080). Empty when none does, and then no
 * setting configures a tag.
 */
export const ANALYTICS_PROVIDERS_DECLARED: readonly AnalyticsProviderDeclaration[] = [
${analyticsProviderRows().map((row) => `  ${indent(JSON.stringify({ pluginId: row.plugin.id, settings: row.settings }, null, 2))},`).join('\n')}
]

/**
 * Every interaction step a first-party plugin offers in the interaction
 * builder, declared by that plugin (AGL-3080). Core names no plugin step.
 */
export const PLUGIN_INTERACTION_STEPS_DECLARED: readonly InteractionStepDeclaration[] = [
${interactionStepRows().map((row) => `  ${indent(JSON.stringify(row, null, 2))},`).join('\n')}
]

/**
 * Every server step a first-party plugin runs for the automation engine,
 * declared by that plugin (AGL-3080). Core names no plugin step.
 */
export const PLUGIN_SERVER_STEPS_DECLARED: readonly ServerStepDeclaration[] = [
${serverStepRows().map((row) => `  ${indent(JSON.stringify(row, null, 2))},`).join('\n')}
]

/**
 * Every ready-to-edit interaction a first-party plugin offers, by the id a
 * stored interaction's stamp names it with, declared by that plugin
 * (AGL-3080). Core names no recipe.
 */
export const PLUGIN_INTERACTION_RECIPES_DECLARED: readonly InteractionRecipeDeclaration[] = [
${interactionRecipeRows().map((row) => `  ${indent(JSON.stringify(row, null, 2))},`).join('\n')}
]

/**
 * Every first-party element that runs a site function, and the prop naming
 * it, declared by that element's plugin (AGL-3393). Core names no element.
 */
export const FIRST_PARTY_FUNCTION_BINDINGS: FunctionBindings = {${Object.entries(functionBindingRows()).map(([id, prop]) => `\n  ${JSON.stringify(id)}: ${JSON.stringify(prop)},`).join('')}${Object.keys(functionBindingRows()).length ? '\n' : ''}}

/**
 * Every video host whose own player the Video element frames, declared by
 * the plugin that plays it (AGL-3080). Core names no host.
 */
export const FIRST_PARTY_VIDEO_EMBED_PROVIDERS: readonly ResolvedVideoEmbedProvider[] = [
${videoEmbedRows.map((row) => `  ${indent(JSON.stringify(row, null, 2))},`).join('\n')}
]

/**
 * The notification categories first-party plugins add to the settings page
 * and to every recipient's preferences, declared by each plugin (AGL-3080).
 */
export const PLUGIN_NOTIFICATION_CATEGORIES_DECLARED: readonly NotificationCategoryDeclaration[] = [
${notificationCategoryRows().map((row) => `  ${indent(JSON.stringify(row, null, 2))},`).join('\n')}
]

/**
 * The digests first-party plugins send on their own schedule, each with the
 * key its switch is stored under, declared by the plugin that sends it
 * (AGL-3080).
 */
export const PLUGIN_NOTIFICATION_DIGESTS_DECLARED: readonly NotificationDigestDeclaration[] = [
${notificationDigestRows().map((row) => `  ${indent(JSON.stringify(row, null, 2))},`).join('\n')}
]
`
  )
}

/**
 * The console addresses a plugin used to answer at, and where they answer
 * now (AGL-3080): each plugin's `consoleRedirects`, compiled into a JSON file
 * `apps/console/next.config.js` spreads into its `redirects()`. The shell
 * keeps the platform's own old addresses; a plugin's are the plugin's to keep
 * answering, so a renamed plugin section never edits core.
 *
 * JSON, because the reader is the console's CommonJS build config, which
 * runs before anything can compile TypeScript. Checked here:
 *
 *  - a site path on both sides, and not the same one;
 *  - `permanent` said outright — a 308 is cached by browsers for good, and
 *    that is a choice to make on purpose;
 *  - one plugin per source: two rules for one address would be answered by
 *    whichever Next reads first;
 *  - a destination inside the plugin's OWN console routes, so a plugin can
 *    only move its own pages, never another's or the platform's.
 */
const REDIRECTS_MANIFEST = 'apps/console/constants/plugins.redirects.generated.json'
const SITE_PATH = /^\/(?!\/)[^\s]*$/

function consoleRedirectRows() {
  const rows = []
  const sources = new Map()
  for (const plugin of config.plugins) {
    const declared = plugin.consoleRedirects
    if (declared === undefined) continue
    const where = `plugins.config.json: "${plugin.id}" consoleRedirects`
    if (!Array.isArray(declared) || !declared.length) {
      throw new Error(`${where} is present and declares nothing — drop it, or name the old address`)
    }
    const own = [...(plugin.contributes?.console?.routes ?? []), ...(plugin.contributes?.console?.orgRoutes ?? [])]
    for (const entry of declared) {
      const { $comment: _note, ...rule } = entry ?? {}
      const { source, destination, permanent } = rule
      const what = `${where} "${source ?? ''}"`
      const unknown = Object.keys(rule).filter((key) => !['source', 'destination', 'permanent'].includes(key))
      if (unknown.length) throw new Error(`${what}: ${unknown.join(', ')} is not a redirect field`)
      if (typeof source !== 'string' || !SITE_PATH.test(source)) throw new Error(`${what}: "source" is a console path`)
      if (typeof destination !== 'string' || !SITE_PATH.test(destination)) throw new Error(`${what}: "destination" is a console path`)
      if (source === destination) throw new Error(`${what} redirects an address to itself`)
      if (typeof permanent !== 'boolean') throw new Error(`${what}: "permanent" is said outright, true or false`)
      const held = sources.get(source)
      if (held) throw new Error(`${what} is already redirected by "${held}" — one address has one rule`)
      sources.set(source, plugin.id)
      const lands = own.some((route) => destination.endsWith(route) || destination.includes(`${route}/`))
      if (!lands) {
        throw new Error(
          `${what}: "${destination}" is not under one of "${plugin.id}"'s own console routes ` +
            `(${own.length ? own.join(', ') : 'it declares none'}) — a plugin moves only its own pages`,
        )
      }
      rows.push({ pluginId: plugin.id, source, destination, permanent })
    }
  }
  return rows
}

/**
 * The mobile manifest (AGL-3620): what each plugin adds to the Aglyn mobile
 * apps, from its `mobile` block. A SEPARATE file only the mobile apps import;
 * the web manifests above never read `mobile`. Built and validated in
 * ./lib/mobile-manifest.mjs, which has its own tests.
 */
const MOBILE_MANIFEST = 'apps/mobile/src/plugins.mobile.generated.ts'

/**
 * The native plugin manifest (docs/mobile/native-architecture.md §3): the
 * Swift package and Kotlin module the native app shells load plugins through.
 * Built and validated in ./lib/native-manifest.mjs, which has its own tests;
 * a plugin may name its registrar only once its native package exists.
 */
const NATIVE_ROWS = nativeManifestRows(config.plugins, { exists: (path) => existsSync(join(ROOT, path)) })

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
  {
    file: CATALOG_FILE,
    content: catalogContent(
      await pluginVideoEmbedProviders(),
      await pluginPlanEntitlements(),
      await pluginUsageAxes(),
    ),
  },
  { file: RELEASE_FLAGS_FILE, content: releaseFlagsContent(releaseFlagRows()) },
  { file: HOST_EVENTS_FILE, content: hostEventsContent(hostEventRows()) },
  { file: TENANT_EMAILS_FILE, content: tenantEmailsContent(await pluginTenantEmails()) },
  {
    file: STARTER_TEMPLATES_FILE,
    content: starterTemplatesContent(await pluginStarterTemplates()),
  },
  { file: CONTAINERS_FILE, content: containersContent(containerKindRows()) },
  ...ANALYTICS_MANIFESTS.map((file) => ({ file, content: analyticsManifestContent() })),
  { file: SUBSCRIPTION_TOPICS_FILE, content: subscriptionTopicsContent(subscriptionTopicRows()) },
  { file: TITLES_MANIFEST, content: titlesContent(await pluginSurfaceTitles()) },
  {
    file: SUBPROCESSORS_MANIFEST,
    content: subprocessorsContent(await pluginSubprocessors()),
    describe: describeSubprocessorDrift,
  },
  { file: REDIRECTS_MANIFEST, content: `${JSON.stringify(consoleRedirectRows(), null, 2)}\n` },
  { file: MOBILE_MANIFEST, content: mobileManifestContent(mobileManifestRows(config.plugins)) },
  ...nativeManifestOutputs(NATIVE_ROWS),
]

for (const { file, content, describe = describeDrift } of ALL) {

  if (!check) {
    mkdirSync(dirname(join(ROOT, file)), { recursive: true })
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

/**
 * The Swift manifest package reaches each plugin package through a symlink
 * (see `swiftPluginLinks`). Every entry of the links directory is generated:
 * a link that is missing, points elsewhere or names no native plugin drifts.
 */
const NATIVE_LINKS = swiftPluginLinks(NATIVE_ROWS)
const linksDir = join(ROOT, IOS_MANIFEST_PLUGINS_DIR)
const readLink = (path) => {
  try {
    return lstatSync(path).isSymbolicLink() ? readlinkSync(path) : '(not a symlink)'
  } catch {
    return null
  }
}
const strayLinks = existsSync(linksDir)
  ? readdirSync(linksDir)
      .map((name) => `${IOS_MANIFEST_PLUGINS_DIR}/${name}`)
      .filter((file) => !NATIVE_LINKS.some((link) => link.file === file))
  : []
for (const file of strayLinks) {
  if (check) drifted.push(`${file}\n  names no plugin whose mobile block declares ios`)
  else {
    rmSync(join(ROOT, file), { force: true })
    console.log(`removed ${file}`)
  }
}
for (const { file, target } of NATIVE_LINKS) {
  const actual = readLink(join(ROOT, file))
  if (actual === target) {
    console.log(`ok ${file}`)
    continue
  }
  if (check) {
    drifted.push(`${file}\n  ${actual === null ? 'the symlink does not exist' : `points to ${actual}`}; expected -> ${target}`)
    continue
  }
  mkdirSync(linksDir, { recursive: true })
  rmSync(join(ROOT, file), { force: true })
  symlinkSync(target, join(ROOT, file))
  console.log(`linked ${file} -> ${target}`)
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

if (check) console.log(`\n${ALL.length + NATIVE_LINKS.length} plugin manifests in sync`)
