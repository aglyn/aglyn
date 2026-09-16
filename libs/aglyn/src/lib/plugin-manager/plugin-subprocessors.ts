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
 * A plugin's subprocessors (AGL-2984).
 *
 * The published subprocessor list is derived from a host-keyed registry of
 * every third-party host the platform's code reaches. A plugin whose code
 * sends data to a third party declares that recipient here, in the fields
 * the published list carries, and the registry folds the declaration in
 * beside the hosts it declares for itself. The plugin that reaches a vendor
 * is the one place that vendor's row is written, and the registry names no
 * plugin's vendor.
 *
 * Declarations reach an app as DATA. A plugin names the function that
 * returns them under `subprocessors` in `plugins.config.json`; the manifest
 * generator calls it and writes what it returns into a generated module, so
 * an app reads a plugin's recipients synchronously and without importing the
 * plugin.
 *
 * A host carries one declaration. The fold refuses a host the registry
 * already declares, or that another plugin declared first, and names both
 * claimants: a record keyed by host would otherwise keep whichever
 * declaration was folded last, and publish it.
 */

/** One third-party recipient of a plugin's data, as the published list carries it. */
export interface PluginSubprocessorDeclaration {
  /** The host the plugin's code reaches, as a bare hostname: the registry's key. */
  readonly host: string
  /** The legal entity that receives the data. */
  readonly entity: string
  /** Where it processes, as the published table states it. */
  readonly region: string
  /** The published purpose cell. */
  readonly purpose: string
  /** The published list's change-log date for the entity, `YYYY-MM-DD`. */
  readonly publishedOn: string
  /** Why the plugin reaches the host, in the words the next reader needs. */
  readonly reason: string
  /** What the recipient receives, written from the code. */
  readonly dataReceived: string
}

/** One plugin's declarations, as the generated manifest lists them. */
export interface PluginSubprocessorManifestEntry {
  readonly pluginId: string
  readonly subprocessors: readonly PluginSubprocessorDeclaration[]
}

/**
 * The registry with every plugin's declarations folded in: a new record
 * holding `base` and one entry per declared host, built by `toEntry`. `base`
 * is left as it is. Throws on a declaration with no host, and on a host
 * already declared by `base` or by an earlier plugin in `manifest`, naming
 * both claimants.
 */
export function foldPluginSubprocessors<Entry>(
  base: Readonly<Record<string, Entry>>,
  manifest: readonly PluginSubprocessorManifestEntry[],
  toEntry: (declaration: PluginSubprocessorDeclaration) => Entry,
): Record<string, Entry> {
  const registry: Record<string, Entry> = { ...base }
  const declaredBy = new Map<string, string>(
    Object.keys(base).map((host) => [host, 'the base registry']),
  )
  for (const { pluginId, subprocessors } of manifest) {
    const claimant = `plugin '${pluginId}'`
    for (const declaration of subprocessors) {
      const { host } = declaration
      if (!host) {
        throw new Error(
          `${claimant} declares a subprocessor (${declaration.entity}) with no host`,
        )
      }
      const earlier = declaredBy.get(host)
      if (earlier) {
        throw new Error(
          `${host} is declared by ${earlier} and by ${claimant}: a host carries one declaration`,
        )
      }
      declaredBy.set(host, claimant)
      registry[host] = toEntry(declaration)
    }
  }
  return registry
}
