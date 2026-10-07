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
 * Loads the plugins the generated mobile manifest names (AGL-3620).
 *
 * Every registrar runs inside its plugin's scope, which refuses a
 * registration the plugin's `plugins.config.json` declaration does not name
 * and one made under another plugin's id. A plugin that fails to load or
 * register is reported and skipped; the others still load, because one
 * broken plugin must not leave someone without the app.
 */

import { registeredBy, runInPluginScope, unregisterMobilePlugin } from './registry'
import { unregisterMobileServices } from './services'
import type {
  MobileContributionKind,
  MobilePluginManifest,
  MobilePluginManifestEntry,
} from './types'

export interface MobilePluginLoadFailure {
  readonly pluginId: string
  readonly error: string
}

export interface MobilePluginLoadResult {
  readonly loaded: readonly string[]
  readonly failed: readonly MobilePluginLoadFailure[]
}

const KINDS: readonly MobileContributionKind[] = [
  'screens',
  'tabs',
  'widgets',
  'quickActions',
  'deepLinks',
]

/**
 * A declared id the registrar never registered. The reverse (registered but
 * undeclared) is refused at registration; this catches the stale
 * declaration, so the config never claims a screen the app does not have.
 */
function undeclaredGaps(entry: MobilePluginManifestEntry): string[] {
  const registered = registeredBy(entry.id)
  const gaps: string[] = []
  for (const kind of KINDS) {
    for (const id of entry.contributes[kind] ?? []) {
      if (!registered[kind].includes(id)) gaps.push(`${kind} "${id}"`)
    }
  }
  return gaps
}

async function loadOne(entry: MobilePluginManifestEntry): Promise<void> {
  const entryModule = await entry.load()
  const register = entryModule[entry.register]
  if (typeof register !== 'function') {
    throw new Error(`its ./mobile entry exports no function named ${entry.register}`)
  }
  runInPluginScope(
    entry.id,
    (kind, id) => (entry.contributes[kind] ?? []).includes(id),
    () => (register as () => void)(),
  )
  const gaps = undeclaredGaps(entry)
  if (gaps.length) {
    throw new Error(`declares but never registers ${gaps.join(', ')}`)
  }
}

export async function loadMobilePlugins(
  manifest: MobilePluginManifest,
): Promise<MobilePluginLoadResult> {
  const loaded: string[] = []
  const failed: MobilePluginLoadFailure[] = []
  // Sequential on purpose: registrars are tiny, and a deterministic order
  // keeps duplicate-id refusals pointing at the same plugin every launch.
  for (const entry of manifest) {
    try {
      await loadOne(entry)
      loaded.push(entry.id)
    } catch (error) {
      unregisterMobilePlugin(entry.id)
      unregisterMobileServices(entry.id)
      failed.push({
        pluginId: entry.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return { loaded, failed }
}
