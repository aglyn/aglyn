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

import { PLUGIN_TEMPLATE_SOURCES } from './first-party-plugins.generated'

/**
 * Where a site's template came from, by its stored `source.type` (AGL-666,
 * AGL-3080).
 *
 * The stamp is server-managed, which is what lets a site's library show it as
 * a trust signal. Two values are the platform's own: {@link
 * AUTHORED_TEMPLATE_SOURCE}, a template saved on the site, and {@link
 * STARTER_TEMPLATE_SOURCE}, a first-party starter copied in when it was used
 * or edited. Every other value is stamped by a plugin that INSTALLS templates
 * into a site's library, and that plugin declares it as `templateSource` in
 * `plugins.config.json`: the value its install route writes, the badge the
 * library shows, and the sentence explaining the badge.
 *
 * ## Compiled, never registered
 *
 * The readers ask before any plugin code has loaded, and one of them asks
 * Firestore by value: the template gallery's own shelf holds a site's saved
 * AND installed templates, as a `source.type in [...]` clause. A runtime
 * registry the page had not filled yet would leave every installed template
 * off that shelf with nothing to say it was missing, so the declaration is
 * data the generator compiles.
 *
 * ## A type no plugin declares
 *
 * A template installed by a plugin this build no longer carries keeps its
 * stamp, and the stamp still says a server installed it. It reads as
 * installed ({@link installedTemplateSource} answers `null`, and the
 * library's badge says "Installed") rather than as something the site
 * authored.
 */
export interface PluginTemplateSource {
  /** The plugin that declared it. */
  pluginId: string
  /** The `source.type` the plugin's install route stamps. */
  type: string
  /** The library's badge: the name of where the template came from. */
  label: string
  /** One sentence saying where the template came from, for the badge's hint. */
  description: string
}

/** A template saved on the site itself — and one written before `source`. */
export const AUTHORED_TEMPLATE_SOURCE = 'authored'

/** A first-party starter, copied into the library when it was used or edited. */
export const STARTER_TEMPLATE_SOURCE = 'starter'

export { PLUGIN_TEMPLATE_SOURCES }

/** Every `source.type` a plugin in this build stamps on a template it installs. */
export const INSTALLED_TEMPLATE_SOURCE_TYPES: readonly string[] =
  PLUGIN_TEMPLATE_SOURCES.map((source) => source.type)

/**
 * The declaration behind a template's `source.type`, or `null` for the
 * platform's own two values, a missing stamp, and a stamp no plugin in this
 * build declares.
 */
export function installedTemplateSource(
  type: unknown,
): PluginTemplateSource | null {
  if (typeof type !== 'string') return null
  return PLUGIN_TEMPLATE_SOURCES.find((source) => source.type === type) ?? null
}

/**
 * Whether a template was installed rather than saved here or started from a
 * starter: any stamp but the platform's own two, declared or not.
 */
export function isInstalledTemplateSource(type: unknown): boolean {
  return (
    typeof type === 'string' &&
    type !== '' &&
    type !== AUTHORED_TEMPLATE_SOURCE &&
    type !== STARTER_TEMPLATE_SOURCE
  )
}
