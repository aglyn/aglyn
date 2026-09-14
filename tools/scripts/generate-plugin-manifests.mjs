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
 * Rebuilds all four files in memory and exits non-zero if what is on disk
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

const MANIFESTS = [
  {
    file: 'apps/console/constants/plugins.client.generated.ts',
    entryPoint: 'client',
    surfaces: ['console', 'site'],
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
]

for (const { file, content } of ALL) {

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
      : `${file}\n${describeDrift(content, actual).join('\n')}`,
  )
}

if (check && drifted.length) {
  console.error(
    `\n${drifted.length} plugin manifest(s) no longer match plugins.config.json:\n\n` +
      drifted.join('\n\n') +
      '\n\nThese files are generated. Do not hand-edit them — run:\n' +
      '  node tools/scripts/generate-plugin-manifests.mjs\n' +
      'and commit the result.\n',
  )
  process.exit(1)
}

if (check) console.log(`\n${ALL.length} plugin manifests in sync`)
