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

function entry(plugin, entryPoint, surfaces) {
  const register = Object.fromEntries(
    Object.entries(plugin.register).filter(([key]) => surfaces.includes(key)),
  )
  if (!Object.keys(register).length) return null
  const specifier =
    entryPoint === 'server' ? `${plugin.package}/server` : plugin.package
  return (
    `  {\n` +
    `    id: '${plugin.id}',\n` +
    (plugin.alwaysOn ? `    alwaysOn: true,\n` : '') +
    (plugin.apiPrefixes?.length
      ? `    apiPrefixes: ${JSON.stringify(plugin.apiPrefixes)},\n`
      : '') +
    `    register: ${JSON.stringify(register)},\n` +
    `    load: () => import('${specifier}'),\n` +
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
 */
function declarationsContent(surfaces, constName, entryPoint) {
  const calls = []
  for (const plugin of config.plugins) {
    for (const surface of surfaces) {
      const fn = plugin.register?.[surface]
      if (!fn) continue
      const specifier =
        surface === 'serverDeclarations'
          ? `${plugin.package}/declarations.server`
          : `${plugin.package}/declarations`
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
    surfaces: ['declarations', 'serverDeclarations'],
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
 */
const SUBPROCESSORS_MANIFEST = 'apps/console/constants/plugins.subprocessors.generated.ts'

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

/** Each plugin with a `subprocessors` entry, and what that entry returns. */
async function pluginSubprocessors() {
  const declaring = config.plugins.filter((plugin) => plugin.register?.subprocessors)
  if (!declaring.length) return []
  const { createJiti } = createRequire(join(ROOT, 'package.json'))('jiti')
  const jiti = createJiti(join(ROOT, 'package.json'), {
    alias: workspaceAliases(),
    interopDefault: true,
    moduleCache: true,
    fsCache: false,
    sourceMaps: false,
  })
  const entries = []
  for (const plugin of declaring) {
    const specifier = `${plugin.package}/subprocessors`
    const fnName = plugin.register.subprocessors
    const fn = (await jiti.import(specifier))[fnName]
    if (typeof fn !== 'function') {
      throw new Error(`${specifier} exports no function named ${fnName}`)
    }
    const subprocessors = await fn()
    for (const declaration of subprocessors) {
      for (const field of SUBPROCESSOR_FIELDS) {
        if (typeof declaration?.[field] !== 'string') {
          throw new Error(
            `${specifier}: ${fnName}() returned a declaration whose ${field} is not a string`,
          )
        }
      }
    }
    entries.push({ pluginId: plugin.id, subprocessors })
  }
  return entries
}

/** The subprocessors manifest, byte for byte. */
function subprocessorsContent(entries) {
  const body = entries
    .map(({ pluginId, subprocessors }) => {
      const rows = subprocessors
        .map(
          (declaration) =>
            `      {\n` +
            SUBPROCESSOR_FIELDS.map(
              (field) => `        ${field}: ${JSON.stringify(declaration[field])},\n`,
            ).join('') +
            `      },`,
        )
        .join('\n')
      return (
        `  {\n` +
        `    pluginId: '${pluginId}',\n` +
        (rows ? `    subprocessors: [\n${rows}\n    ],\n` : `    subprocessors: [],\n`) +
        `  },`
      )
    })
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

const check = process.argv.includes('--check')
const drifted = []

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
