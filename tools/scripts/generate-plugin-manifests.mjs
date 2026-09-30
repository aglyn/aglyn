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
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
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
 *
 * A surface or a section named two different ways is refused: the tab could
 * follow only one of them.
 */
const TITLES_MANIFEST = 'apps/console/constants/plugins.titles.generated.ts'
const NAV_LABEL = /label:\s*'([^']+)',[\s\S]{0,200}?href:\s*'\/([a-z0-9-]+)'/g
const NAV_SECTIONS = /href:\s*'\/([a-z0-9-]+)',[\s\S]{0,600}?sections:\s*([A-Z_]+)/g

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
      for (const [, slug, constName] of source.matchAll(NAV_SECTIONS)) {
        const list = lists.get(constName)
        if (!list) throw new Error(`${where}: /${slug} names sections ${constName}, which no *-console-sections.ts beside it exports`)
        if (!sections.has(slug)) sections.set(slug, new Map())
        for (const { id, label } of list) claim(sections.get(slug), id, label, `${where} /${slug}`)
      }
    }
  }
  return { titles, sections }
}

/** The titles manifest, byte for byte. */
function titlesContent({ titles, sections }) {
  const key = (name) => (/^[a-z][a-z0-9]*$/i.test(name) ? name : `'${name}'`)
  const quote = (text) => `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
  const sorted = (map) => [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  const titleRows = sorted(titles).map(([slug, label]) => `  ${key(slug)}: ${quote(label)},\n`).join('')
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
    `export const PLUGIN_SURFACE_SECTIONS: Readonly<\n  Record<string, Readonly<Record<string, string>>>\n> = {\n${sectionRows}}\n`
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
 * The interaction steps (AGL-3080): each plugin whose step the interaction
 * builder offers declares it under `interactionSteps` — the `type` it is
 * stored under, how the builder names it, and, for a step that PICKS one of
 * the plugin's records, the site collection the records are listed from and
 * the step fields that hold the pick. Core compiles them into the catalog,
 * because the builder and every validator read them with no plugin loaded,
 * and a step whose pick nothing checked would save naming nothing.
 *
 * Checked here: a plain type no other plugin declares, a label, only the
 * known keys, and a pick listed from a collection the SAME plugin declares
 * under `hostCollections` — a plugin offers its own records, never another's —
 * with plain, distinct field names, a limit from 1 to 200, and the words the
 * builder shows.
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
      const { type, label, picks, ...rest } = step ?? {}
      if (typeof type !== 'string' || !plain.test(type)) {
        throw new Error(`${where}: "type" is the plain name a step is stored under`)
      }
      const what = `${where} "${type}"`
      if (Object.keys(rest).length) throw new Error(`${what}: unknown key(s) ${Object.keys(rest).join(', ')}`)
      if (claimed.has(type)) throw new Error(`${what} is already declared by "${claimed.get(type)}"`)
      claimed.set(type, plugin.id)
      if (!words(label)) throw new Error(`${what}: "label" is how the builder names the step`)
      const row = { pluginId: plugin.id, type, label }
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

function catalogContent(videoEmbedRows, planEntitlements) {
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

import type { FirstPartyPlugin, PluginEditBarLink, PublishedSiteImpact } from './enabled-plugins'\nimport type { ResolvedPluginHostCollection, ResolvedPluginOrgCollection } from './plugin-host-collections'\nimport type { ResolvedPluginSitemapSection } from './plugin-sitemap-sections'\nimport type { ResolvedPluginOrgCapacity } from './plugin-org-capacity'\nimport type { ResolvedPluginPlanFeature, ResolvedPluginPlanQuota } from './plugin-plan-entitlements'\nimport type { FunctionBindings } from './plugin-contributions'\nimport type { PluginDistribution } from './plugin-distribution'\nimport type { RepeatSourceDeclaration } from './repeat-rows'\nimport type { PluginTemplateSource } from './plugin-template-sources'\nimport type { FormRecordTargetDeclaration } from './submission-record-target'\nimport type { ResolvedBesignerDocument } from './besigner-documents'\nimport type { PluginOrgKeyedCollection } from './plugin-org-erasure'\nimport type { ResolvedVideoEmbedProvider } from './video-embed-provider'\nimport type { AnalyticsProviderDeclaration } from '../app-utils/analytics-provider'\nimport type { InteractionStepDeclaration } from '../app-utils/site-interactions'\nimport type { NotificationCategoryDeclaration, NotificationDigestDeclaration } from '../app-utils/notifications'

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
    content: catalogContent(await pluginVideoEmbedProviders(), await pluginPlanEntitlements()),
  },
  { file: RELEASE_FLAGS_FILE, content: releaseFlagsContent(releaseFlagRows()) },
  { file: TENANT_EMAILS_FILE, content: tenantEmailsContent(await pluginTenantEmails()) },
  ...ANALYTICS_MANIFESTS.map((file) => ({ file, content: analyticsManifestContent() })),
  { file: TITLES_MANIFEST, content: titlesContent(await pluginSurfaceTitles()) },
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
