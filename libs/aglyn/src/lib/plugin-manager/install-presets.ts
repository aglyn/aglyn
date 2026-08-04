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

import type { PluginCapabilities } from '../app-utils/plugin-manifest'
import type { PresetSchema } from '../types/nodes'

/**
 * Install→preset mapping seam (AGL-419): the besigner drawer shows a
 * preset per installed marketplace plugin, but the preset shape (component
 * id, drawer category, icon) belongs to the mui plugin — so the mapper is
 * REGISTERED by plugins-mui and the console consumes it through core,
 * never importing the plugin.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PluginInstallPresetMapper = (install: any) => PresetSchema | null

let mapper: PluginInstallPresetMapper | undefined

export function registerPluginInstallPresetMapper(
  fn: PluginInstallPresetMapper,
): void {
  mapper = fn
}

/**
 * Many presets per install (AGL-1031): the generic Plugin element, plus one
 * per element the pinned version DECLARES.
 *
 * A separate seam rather than a widened return type on the singular one — the
 * singular mapper is the AGL-419 contract and several call sites still want
 * exactly one preset. Registering the plural is what turns declared elements
 * into palette entries; without it a plugin's elements simply do not appear,
 * which is the correct behaviour for a host that predates the declaration.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PluginInstallPresetsMapper = (install: any) => PresetSchema[]

let presetsMapper: PluginInstallPresetsMapper | undefined

export function registerPluginInstallPresetsMapper(
  fn: PluginInstallPresetsMapper,
): void {
  presetsMapper = fn
}

/**
 * Every drawer preset an install contributes. Falls back to the singular
 * mapper so a surface that registered only that keeps working unchanged.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function pluginInstallToPresets(install: any): PresetSchema[] {
  if (presetsMapper) return presetsMapper(install)
  const single = pluginInstallToPreset(install)
  return single ? [single] : []
}

/** Maps an install doc to a drawer preset; null until a mapper registers. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function pluginInstallToPreset(install: any): PresetSchema | null {
  return mapper ? mapper(install) : null
}

/**
 * What the EDITOR knows about installed plugins (AGL-1029).
 *
 * The Plugin element used to read "not installed on this site" off the absence
 * of `version`/`sha256` — fields the tenant compose pass injects and the canvas
 * never has. So it asserted an install fact it had never checked, and said it
 * about every plugin, installed or not.
 *
 * The surface that DOES know is the console, which already reads the installs
 * to build drawer presets. It publishes them here, through the same seam the
 * mapper uses, so the element can name the plugin and only claim "not
 * installed" when it has a list to be absent from.
 *
 * Empty is meaningfully different from "not installed": on the tenant nothing
 * populates this, so the element must fall back to a neutral statement rather
 * than reading emptiness as absence.
 */
export interface KnownPluginInstall {
  listingId: string
  displayName?: string
  /** 'org' when the pin covers every site in the workspace. */
  scope?: 'org' | 'host'
  /**
   * The pinned manifest's capabilities (AGL-1049).
   *
   * Carried so the attributes panel can render a plugin's declared settings as
   * real fields instead of a JSON textarea. The install document already holds
   * the whole manifest — only the part the editor needs is published here, so
   * the canvas cannot come to depend on anything the bridge does not honour.
   */
  capabilities?: PluginCapabilities
}

let knownInstalls: Map<string, KnownPluginInstall> | undefined
/**
 * Bumped on every publish so consumers can depend on "the set changed"
 * (AGL-1030). The install set arrives from a live Firestore subscription and
 * can land AFTER the element panel has built its fields — installing a plugin
 * in another tab, or simply a slow first read — and without a change signal
 * the picker would sit on "No plugins installed for this site" until remount.
 */
let knownInstallsVersion = 0
const knownInstallListeners = new Set<() => void>()

/** Called by the console when the install set changes; undefined to forget. */
export function setKnownPluginInstalls(
  installs: readonly KnownPluginInstall[] | undefined,
): void {
  knownInstalls = installs
    ? new Map(installs.map((install) => [install.listingId, install]))
    : undefined
  knownInstallsVersion += 1
  for (const listener of knownInstallListeners) listener()
}

/** `useSyncExternalStore` pair for the element panel's plugin picker. */
export function subscribeKnownPluginInstalls(listener: () => void): () => void {
  knownInstallListeners.add(listener)
  return () => {
    knownInstallListeners.delete(listener)
  }
}

export function getKnownPluginInstallsVersion(): number {
  return knownInstallsVersion
}

/** True once a surface has published its install set — see the note above. */
export function hasKnownPluginInstalls(): boolean {
  return knownInstalls !== undefined
}

export function getKnownPluginInstall(
  listingId: string | undefined,
): KnownPluginInstall | undefined {
  return listingId ? knownInstalls?.get(listingId) : undefined
}

/**
 * The installed set, for the element panel's plugin picker (AGL-1030).
 *
 * Sorted by name so the options do not reshuffle when an install document
 * happens to come back in a different order.
 */
export function getKnownPluginInstalls(): readonly KnownPluginInstall[] {
  return [...(knownInstalls?.values() ?? [])].sort((a, b) =>
    (a.displayName ?? a.listingId).localeCompare(b.displayName ?? b.listingId),
  )
}
