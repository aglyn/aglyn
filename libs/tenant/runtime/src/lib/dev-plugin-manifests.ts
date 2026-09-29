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

import {
  type PluginContributions,
  readPluginContributions,
} from '@aglyn/aglyn/plugin-manager/plugin-contributions'

/**
 * What the DEV-ONLY realm loop's plugins declare, read from their manifests on
 * disk (AGL-3394).
 *
 * A bundle loaded through `NEXT_PUBLIC_PLUGIN_DEV_BUNDLES` has no install, so
 * nothing carries its manifest to compose. Its function-running elements
 * would then compose with no function definition, and a plugin author could
 * not see a calculator calculate before publishing. `PLUGIN_DEV_MANIFESTS`
 * names each manifest file, comma-separated, and each is read through the
 * same sanitizer a published manifest goes through.
 *
 * Empty in a production build, and without the loop's explicit opt-in
 * (`NEXT_PUBLIC_PLUGIN_DEV=enabled`, AGL-516). Local files only: nothing is
 * fetched.
 */
export async function devPluginManifests(): Promise<
  Array<{ contributes: PluginContributions }>
> {
  if (process.env.NODE_ENV === 'production') return []
  if (process.env.NEXT_PUBLIC_PLUGIN_DEV !== 'enabled') return []
  const paths = (process.env['PLUGIN_DEV_MANIFESTS'] ?? '')
    .split(',')
    .map((path) => path.trim())
    .filter(Boolean)
  if (!paths.length) return []
  const { readFile } = await import('node:fs/promises')
  const manifests: Array<{ contributes: PluginContributions }> = []
  for (const path of paths) {
    try {
      const manifest = JSON.parse(await readFile(path, 'utf8')) as {
        contributes?: unknown
      }
      const contributes = readPluginContributions(manifest?.contributes)
      if (contributes) manifests.push({ contributes })
    } catch (error) {
      console.error(`dev plugin manifest ${path} skipped:`, error)
    }
  }
  return manifests
}
