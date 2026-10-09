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
 * WHAT A PLUGIN'S SITE FEATURE NEEDS THE PUBLISHED PAGE'S POLICY TO ADMIT
 * (AGL-3698).
 *
 * The tenant enforces `connect-src`, `frame-src`, `img-src`, `media-src` and
 * `font-src` (AGL-1152). A plugin that loads a vendor's widget on a site —
 * the merchant's own live chat is the first — needs that vendor's hosts in
 * those directives, and only on the sites that switched the feature on:
 * pinning them for every site would make every published page's policy
 * describe a vendor most of them never load.
 *
 * So a plugin DECLARES the hosts in `plugins.config.json` (`siteCsp`), keyed
 * by the value of one field of its site settings document
 * (`hosts/{hostId}/pluginSettings/{pluginId}`), and switched by another. The
 * generator compiles the declaration into `first-party-plugins.generated.ts`,
 * and the tenant's lockdown verdict — the route that already hands the
 * middleware every per-site list — reads the settings document of each
 * declared plugin the site runs and adds the chosen variant's hosts. Core
 * names no vendor and no plugin.
 *
 * The hosts ride the owner-list path in `security-origins.js`, so they are
 * held to the same parse as an owner's own entries: a bare hostname or one
 * leading `*.`, made `https://`. A `wss://` connection to an admitted host is
 * covered by its `https://` source (CSP Level 3 scheme matching).
 */

import { PLUGIN_SITE_CSP_DECLARED } from './first-party-plugins.generated'

/** The directives a plugin may widen; the enforced, owner-widenable ones. */
export const PLUGIN_SITE_CSP_DIRECTIVES = [
  'connect',
  'frame',
  'img',
  'media',
  'font',
] as const

export type PluginSiteCspDirective = (typeof PLUGIN_SITE_CSP_DIRECTIVES)[number]

export type PluginSiteCspHosts = Partial<
  Record<PluginSiteCspDirective, readonly string[]>
>

/** One plugin's declaration, as the generator compiles it. */
export interface PluginSiteCspDeclaration {
  pluginId: string
  /** The settings field that must be exactly `true` for anything to be admitted. */
  switchField: string
  /**
   * The settings field whose value names the variant. Absent for a plugin
   * with one set of hosts, which declares a single `default` variant.
   */
  variantField?: string
  /** A settings field that must hold a non-empty string, or nothing loads. */
  requiredField?: string
  /** The hosts each variant needs, by directive. */
  variants: Readonly<Record<string, PluginSiteCspHosts>>
}

/** Every first-party declaration, compiled from `plugins.config.json`. */
export function pluginSiteCspDeclarations(): readonly PluginSiteCspDeclaration[] {
  return PLUGIN_SITE_CSP_DECLARED
}

/**
 * The hosts one plugin's stored settings admit, or none.
 *
 * Fails CLOSED on every malformed input: a switch that is not exactly `true`,
 * an unknown variant, an empty required field. The settings document is
 * written through the plugin's own route, but a reader of a policy input
 * trusts nothing it did not parse.
 */
export function pluginSiteCspHostsFor(
  declaration: PluginSiteCspDeclaration,
  settings: Record<string, unknown> | null | undefined,
): PluginSiteCspHosts {
  if (!settings || settings[declaration.switchField] !== true) return {}
  if (declaration.requiredField) {
    const required = settings[declaration.requiredField]
    if (typeof required !== 'string' || !required.trim()) return {}
  }
  const variant = declaration.variantField
    ? settings[declaration.variantField]
    : 'default'
  if (typeof variant !== 'string') return {}
  if (!Object.prototype.hasOwnProperty.call(declaration.variants, variant)) {
    return {}
  }
  return declaration.variants[variant] ?? {}
}

/**
 * The union of what every declared plugin the site runs admits, by
 * directive, de-duplicated and in declaration order.
 *
 * `settingsByPlugin` holds the stored settings document of each plugin the
 * caller read; a plugin missing from `enabledPluginIds` admits nothing even
 * when its settings are present, because a switched-off plugin loads nothing
 * on the page.
 */
export function pluginSiteCspHosts(
  enabledPluginIds: readonly string[],
  settingsByPlugin: Readonly<Record<string, Record<string, unknown> | null | undefined>>,
  declared: readonly PluginSiteCspDeclaration[] = PLUGIN_SITE_CSP_DECLARED,
): Record<PluginSiteCspDirective, string[]> {
  const out = Object.fromEntries(
    PLUGIN_SITE_CSP_DIRECTIVES.map((directive) => [directive, [] as string[]]),
  ) as Record<PluginSiteCspDirective, string[]>
  const enabled = new Set(enabledPluginIds)
  for (const declaration of declared) {
    if (!enabled.has(declaration.pluginId)) continue
    const hosts = pluginSiteCspHostsFor(
      declaration,
      settingsByPlugin[declaration.pluginId],
    )
    for (const directive of PLUGIN_SITE_CSP_DIRECTIVES) {
      for (const host of hosts[directive] ?? []) {
        if (!out[directive].includes(host)) out[directive].push(host)
      }
    }
  }
  return out
}

/** The declared plugins among a site's enabled set: the settings worth reading. */
export function pluginSiteCspPluginsToRead(
  enabledPluginIds: readonly string[],
  declared: readonly PluginSiteCspDeclaration[] = PLUGIN_SITE_CSP_DECLARED,
): string[] {
  const enabled = new Set(enabledPluginIds)
  return declared
    .map((declaration) => declaration.pluginId)
    .filter((pluginId) => enabled.has(pluginId))
}
