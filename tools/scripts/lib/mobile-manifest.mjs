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
 * The mobile manifest (AGL-3620): what each plugin adds to the Aglyn mobile
 * apps, from its `mobile` block. A SEPARATE file that only the mobile apps
 * import — the web manifests never read `mobile`, so declaring a
 * mobile surface changes none of them, byte for byte. Each entry loads the
 * plugin's `./mobile` entry and nothing else, which is where its registrar
 * lives and where `check-mobile-isolation` holds every import it makes.
 */
export const MOBILE_CONTRIBUTION_KINDS = ['screens', 'tabs', 'widgets', 'quickActions', 'deepLinks']
const MOBILE_BLOCK_KEYS = ['register', 'contributes', 'ios', 'android']
const MOBILE_ID = /^[a-z][a-z0-9-]*\.[a-zA-Z0-9.-]+$/

export function mobileManifestRows(plugins) {
  const rows = []
  const seen = new Map()
  for (const plugin of plugins) {
    const declared = plugin.mobile
    if (declared === undefined) continue
    const where = `plugins.config.json: "${plugin.id}" mobile`
    const { $comment: _note, ...block } = declared ?? {}
    // `ios` and `android` name the native registrars; ./native-manifest.mjs validates them.
    const unknown = Object.keys(block).filter((key) => !MOBILE_BLOCK_KEYS.includes(key))
    if (unknown.length) throw new Error(`${where}: ${unknown.join(', ')} is not a mobile field`)
    if (typeof block.register !== 'string' || !/^register[A-Za-z0-9]+$/.test(block.register)) {
      throw new Error(`${where}: "register" names the registrar its ./mobile entry exports`)
    }
    const contributes = block.contributes ?? {}
    const kinds = Object.keys(contributes)
    const strange = kinds.filter((kind) => !MOBILE_CONTRIBUTION_KINDS.includes(kind))
    if (strange.length) throw new Error(`${where}.contributes: ${strange.join(', ')} is not a mobile contribution`)
    const out = {}
    for (const kind of MOBILE_CONTRIBUTION_KINDS) {
      const ids = contributes[kind]
      if (ids === undefined) continue
      if (!Array.isArray(ids) || !ids.length) throw new Error(`${where}.contributes.${kind} is a non-empty list`)
      for (const id of ids) {
        if (typeof id !== 'string' || !MOBILE_ID.test(id) || !id.startsWith(`${plugin.id}.`)) {
          throw new Error(`${where}.contributes.${kind}: "${id}" is not "${plugin.id}.<name>"`)
        }
        const key = `${kind}:${id}`
        if (seen.has(key)) throw new Error(`${where}.contributes.${kind}: "${id}" is also declared by "${seen.get(key)}"`)
        seen.set(key, plugin.id)
      }
      out[kind] = [...ids].sort()
    }
    if (!Object.keys(out).length) throw new Error(`${where} declares nothing — drop it`)
    rows.push({ id: plugin.id, package: plugin.package, register: block.register, contributes: out })
  }
  return rows
}

export function mobileManifestContent(rows) {
  const entries = rows
    .map(
      (row) =>
        `  {\n` +
        `    id: '${row.id}',\n` +
        `    register: '${row.register}',\n` +
        `    contributes: ${JSON.stringify(row.contributes)},\n` +
        `    load: () => import('${row.package}/mobile'),\n` +
        `  },`,
    )
    .join('\n')
  return (
    `/**\n` +
    ` * GENERATED FILE — do not edit. Regenerate with:\n` +
    ` *   node tools/scripts/generate-plugin-manifests.mjs\n` +
    ` *\n` +
    ` * The mobile apps' plugin manifest (AGL-3620), from each plugin's \`mobile\`\n` +
    ` * block in plugins.config.json. Only the mobile apps import it; each entry\n` +
    ` * loads the plugin's \`./mobile\` entry and nothing else.\n` +
    ` */\n` +
    `/* eslint-disable @nx/enforce-module-boundaries */\n\n` +
    `import type { MobilePluginManifest } from '@aglyn/mobile-plugin-host'\n\n` +
    `export const MOBILE_PLUGIN_MANIFEST: MobilePluginManifest = [\n${entries}${entries ? '\n' : ''}]\n`
  )
}
