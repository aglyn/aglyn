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
 * WHERE A PERSON READS A RECORD KIND, FOR A SERVER THAT TELLS THEM ABOUT ONE
 * (AGL-3080).
 *
 * The console's record routes (`plugin-record-routes`) answer where a record
 * is read for a surface rendered in the console: the plugin that shows the
 * kind registers its addresses from its console registrar, and a link asks for
 * the kind. A SERVER has no console registrar. The forms plugin's door tells a
 * site's managers about a new submission, or that submissions are paused, and
 * the notification's link is where they read submissions — a page the Inbox
 * draws, which the door may not spell.
 *
 * So the plugin whose console page shows a kind DECLARES it in
 * `plugins.config.json` (`recordPages`: the kind, and the site console path
 * under one of its own routes), the manifest generator compiles it, and a
 * server asks here for the kind. Compiled rather than registered for the same
 * reason the host collections are: the tenant process that sends the
 * notification never loads the plugin that draws the page.
 *
 * No declaration is an answer: no plugin shows the kind in this build, and a
 * notification goes without a link rather than to a page that is not there.
 */

import { PLUGIN_RECORD_PAGES_DECLARED } from './first-party-plugins.generated'

export interface PluginRecordPageDeclaration {
  /** The record kind, as `plugin-record-routes` and `plugin-record-index` key it. */
  kind: string
  /**
   * The site console path the kind is read on, under one of the declaring
   * plugin's own console routes: `/inbox`.
   */
  path: string
}

/** A declaration with the plugin whose page it is. */
export type ResolvedPluginRecordPage = PluginRecordPageDeclaration & { pluginId: string }

/** Where a kind is read, or `null` when no plugin in this build shows it. */
export function pluginRecordPage(kind: string): ResolvedPluginRecordPage | null {
  const key = kind.trim()
  return PLUGIN_RECORD_PAGES_DECLARED.find((one) => one.kind === key) ?? null
}

/**
 * A notification's link to the page a site's records of `kind` are read on —
 * `/{hostId}{path}`, which the notification layer rewrites onto the site's
 * console address — or `null` when no plugin shows the kind.
 */
export function pluginRecordPageLink(kind: string, hostId: string): string | null {
  const page = pluginRecordPage(kind)
  return page && hostId ? `/${hostId}${page.path}` : null
}
