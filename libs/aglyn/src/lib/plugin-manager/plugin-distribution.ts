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
 * Where published third-party plugin versions and their kill switches are
 * stored, declared by the plugin that publishes them (AGL-3080).
 *
 * The realm loader is the platform's: it joins a workspace's install pins
 * with the version each pin names, keeps only a version carrying the
 * platform's trust grant, and drops one a kill switch has stopped. The
 * documents it joins against are the distributing plugin's — a version is
 * written under that plugin's listing when it is published, and its kill
 * switch when staff revoke it. So the loader asks this declaration where they
 * are, and names no plugin's collection itself.
 *
 * ## Compiled, never registered
 *
 * Every reader is a security gate on a server path that loads no plugin code:
 * the published page's plugin join, both apps' remote server-bundle loaders,
 * the console's realm gate. A runtime registry one of them had not filled
 * would answer "nowhere" — and "nowhere" must mean "nothing loads", which is
 * only safe because it is also what an unfilled registry would say. That is
 * the AGL-3025 shape one step from the kill switch, so the plugin declares
 * this as data in `plugins.config.json` and the generator compiles it.
 *
 * ## Absent is closed
 *
 * With no distributing plugin, {@link PLUGIN_DISTRIBUTION} is `null`, and
 * every reader fails CLOSED: no version resolves, and every pin reads as
 * revoked. A pin with no store to check it against cannot be vouched for.
 */
export interface PluginDistribution {
  /** The plugin that declared it. */
  pluginId: string
  /** The top-level collection of listings, keyed by the id an install pins. */
  listings: string
  /** The subcollection of a listing holding one document per version. */
  versions: string
  /** The top-level collection of kill switches, keyed by the listing id. */
  revocations: string
}

export { PLUGIN_DISTRIBUTION } from './first-party-plugins.generated'
