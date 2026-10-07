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
 * A plugin's `mobile` block (AGL-3620, AGL-3651): the contributions it adds
 * to the native apps, declared once, and the native registrars that add them
 * (`ios`, `android`; validated in ./native-manifest.mjs). This checks the
 * declared inventory — kinds, `<pluginId>.<name>` ids, no id declared twice —
 * which the native registries refuse to step outside.
 */
export const MOBILE_CONTRIBUTION_KINDS = ['screens', 'tabs', 'widgets', 'quickActions', 'deepLinks']
const MOBILE_BLOCK_KEYS = ['contributes', 'ios', 'android']
const MOBILE_ID = /^[a-z][a-z0-9-]*\.[a-zA-Z0-9.-]+$/

export function mobileManifestRows(plugins) {
  const rows = []
  const seen = new Map()
  for (const plugin of plugins) {
    const declared = plugin.mobile
    if (declared === undefined) continue
    const where = `plugins.config.json: "${plugin.id}" mobile`
    const { $comment: _note, ...block } = declared ?? {}
    const unknown = Object.keys(block).filter((key) => !MOBILE_BLOCK_KEYS.includes(key))
    if (unknown.length) throw new Error(`${where}: ${unknown.join(', ')} is not a mobile field`)
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
    rows.push({ id: plugin.id, contributes: out })
  }
  return rows
}
