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
 * Which plugin's register fn is currently running.
 *
 * A LEAF module on purpose — it imports nothing, so anything may import it
 * without risking a cycle. This lived in `api-plugins`, which is reachable
 * only through the `/server` entry; when `site-page-hooks` (in the shared
 * plugin-manager barrel, client and server both) reached for it, the cycle
 * that created left the binding missing at runtime and the server threw
 * `ReferenceError: getRegisteringPluginId is not defined` (AGL-1289).
 *
 * The marker is set by the plugin loader around each register-fn call, so any
 * registry can record who registered what: `registerPluginApiRoute` uses it
 * for path→plugin ownership, `registerSitePageEnricher` for attributing a
 * page contribution back to the plugin that produced it.
 */
let registeringPluginId: string | undefined

export function setRegisteringPluginId(pluginId: string | undefined): void {
  registeringPluginId = pluginId
}

/** The plugin whose register fn is running, or undefined outside registration. */
export function getRegisteringPluginId(): string | undefined {
  return registeringPluginId
}
