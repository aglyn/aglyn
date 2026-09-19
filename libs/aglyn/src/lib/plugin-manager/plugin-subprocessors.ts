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
 * A plugin's subprocessors, and the other hosts its code names (AGL-2984,
 * AGL-2978).
 *
 * The published subprocessor list is derived from a host-keyed registry of
 * every third-party host the platform's code reaches. A plugin whose code
 * sends data to a third party declares that recipient here, in the fields
 * the published list carries, and the registry folds the declaration in
 * beside the hosts it declares for itself. The plugin that reaches a vendor
 * is the one place that vendor's row is written, and the registry names no
 * plugin's vendor.
 *
 * The registry keys on every host the code NAMES, not only on recipients, so
 * a plugin declares its other hosts the same way:
 *
 * - `hosts` — a host that is not a published recipient, on the registry's
 *   own two terms: `not-a-subprocessor` (a request really is made, and no
 *   personal data reaches the host, or the customer rather than Aglyn chose
 *   it) or `no-request` (nothing of ours ever requests it). The entry carries
 *   the evidence for the claim, exactly as the registry's own do.
 * - `uses` — a host already declared, by the registry or by another plugin,
 *   that this plugin's code reaches as well. The host keeps its one
 *   declaration and its disposition; the use adds why this plugin reaches it
 *   and what it receives from this plugin, so the entry a reader lands on
 *   names every use of the host.
 *
 * Declarations reach an app as DATA. A plugin names the function that
 * returns them under `subprocessors` in `plugins.config.json`; the manifest
 * generator calls it and writes what it returns into a generated module, so
 * an app reads a plugin's declarations synchronously and without importing
 * the plugin.
 *
 * A host carries one declaration. The fold refuses a host the registry
 * already declares, or that another plugin declared first, and names both
 * claimants: a record keyed by host would otherwise keep whichever
 * declaration was folded last, and publish it. A use is the one way to add
 * to a declared host, and the fold refuses a use of a host nothing declares.
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

/** The dispositions a host that is not a published recipient may carry. */
export const PLUGIN_EGRESS_HOST_DISPOSITIONS = ['not-a-subprocessor', 'no-request'] as const
export type PluginEgressHostDisposition = (typeof PLUGIN_EGRESS_HOST_DISPOSITIONS)[number]

/** A host a plugin's code names that is not a published recipient. */
export interface PluginEgressHostDeclaration {
  /** The host, as a bare hostname: the registry's key. */
  readonly host: string
  readonly disposition: PluginEgressHostDisposition
  /** Why the host is in the plugin's code: the evidence for the disposition. */
  readonly reason: string
  /** What the host receives, and for these dispositions what does NOT go. */
  readonly dataReceived: string
}

/** A host declared elsewhere that a plugin's code reaches as well. */
export interface PluginEgressUseDeclaration {
  /** The declared host, as a bare hostname. */
  readonly host: string
  /** Why this plugin reaches it, written to follow the declaration's own reason. */
  readonly reason: string
  /** What the host receives from this plugin, written to follow the declaration's own. */
  readonly dataReceived: string
}

/**
 * What a plugin's `subprocessors` entry answers: its published recipients,
 * or those with its other hosts and its uses of hosts declared elsewhere.
 */
export type PluginSubprocessorsAnswer =
  | readonly PluginSubprocessorDeclaration[]
  | {
      readonly subprocessors?: readonly PluginSubprocessorDeclaration[]
      readonly hosts?: readonly PluginEgressHostDeclaration[]
      readonly uses?: readonly PluginEgressUseDeclaration[]
    }

/** One plugin's declarations, as the generated manifest lists them. */
export interface PluginSubprocessorManifestEntry {
  readonly pluginId: string
  readonly subprocessors: readonly PluginSubprocessorDeclaration[]
  /** Hosts the plugin's code names that are not published recipients. */
  readonly hosts?: readonly PluginEgressHostDeclaration[]
  /** Hosts declared elsewhere that the plugin's code reaches as well. */
  readonly uses?: readonly PluginEgressUseDeclaration[]
}

/** How a consumer builds the entries the fold cannot build from `toEntry`. */
export interface FoldPluginEgressOptions<Entry> {
  /** The entry for a host a plugin declares that is not a published recipient. */
  toHostEntry?: (declaration: PluginEgressHostDeclaration) => Entry
  /**
   * The entry with one more use added, as a new value: the entry given is the
   * registry's or another plugin's, and is left as it is.
   */
  withUse?: (entry: Entry, use: PluginEgressUseDeclaration, pluginId: string) => Entry
}

/**
 * The registry with every plugin's declarations folded in: a new record
 * holding `base`, one entry per declared recipient built by `toEntry`, one
 * per declared host built by `options.toHostEntry`, and every use added to
 * its host's entry by `options.withUse`. `base` is left as it is.
 *
 * Throws on a declaration with no host; on a host already declared by `base`
 * or by an earlier plugin in `manifest`, naming both claimants; on a host
 * with a disposition the registry does not know; on a use of a host nothing
 * declares, or of a host its own plugin declares; and on hosts or uses the
 * consumer gave no way to fold. Uses are folded after every declaration, so
 * a use may name a host a later plugin declares.
 */
export function foldPluginSubprocessors<Entry>(
  base: Readonly<Record<string, Entry>>,
  manifest: readonly PluginSubprocessorManifestEntry[],
  toEntry: (declaration: PluginSubprocessorDeclaration) => Entry,
  options: FoldPluginEgressOptions<Entry> = {},
): Record<string, Entry> {
  const registry: Record<string, Entry> = { ...base }
  const declaredBy = new Map<string, string>(
    Object.keys(base).map((host) => [host, 'the base registry']),
  )
  const claim = (host: string, claimant: string) => {
    const earlier = declaredBy.get(host)
    if (earlier) {
      throw new Error(
        `${host} is declared by ${earlier} and by ${claimant}: a host carries one declaration`,
      )
    }
    declaredBy.set(host, claimant)
  }

  for (const { pluginId, subprocessors, hosts = [] } of manifest) {
    const claimant = `plugin '${pluginId}'`
    for (const declaration of subprocessors) {
      const { host } = declaration
      if (!host) {
        throw new Error(
          `${claimant} declares a subprocessor (${declaration.entity}) with no host`,
        )
      }
      claim(host, claimant)
      registry[host] = toEntry(declaration)
    }
    for (const declaration of hosts) {
      const { host } = declaration
      if (!host) {
        throw new Error(`${claimant} declares a ${declaration.disposition} host with no host`)
      }
      if (!PLUGIN_EGRESS_HOST_DISPOSITIONS.includes(declaration.disposition)) {
        throw new Error(
          `${claimant} declares ${host} as '${String(declaration.disposition)}', which is not a disposition a host may carry`,
        )
      }
      if (!options.toHostEntry) {
        throw new Error(`${claimant} declares ${host}, and this registry folds no hosts`)
      }
      claim(host, claimant)
      registry[host] = options.toHostEntry(declaration)
    }
  }

  for (const { pluginId, uses = [] } of manifest) {
    const claimant = `plugin '${pluginId}'`
    for (const use of uses) {
      const { host } = use
      if (!host) throw new Error(`${claimant} declares a use with no host`)
      const owner = declaredBy.get(host)
      if (!owner) {
        throw new Error(
          `${claimant} declares a use of ${host}, which nothing declares: declare the host instead`,
        )
      }
      if (owner === claimant) {
        throw new Error(
          `${claimant} declares both ${host} and a use of it: write the use into the declaration`,
        )
      }
      if (!options.withUse) {
        throw new Error(`${claimant} declares a use of ${host}, and this registry folds no uses`)
      }
      registry[host] = options.withUse(registry[host], use, pluginId)
    }
  }
  return registry
}
