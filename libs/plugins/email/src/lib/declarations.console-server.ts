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

// The registry's own module, not the `@aglyn/aglyn/server` barrel: boot needs
// one registry, not the whole server surface.
import { registerPluginEmailStreams } from '@aglyn/aglyn/plugin-manager/plugin-email-streams'
import { BUNDLE_ID } from './constants/bundle-common'

/**
 * The email plugin's CONSOLE-ONLY server declarations (AGL-3305), named under
 * `consoleServerDeclarations` in `plugins.config.json` and run at the
 * console's boot.
 *
 * It fills `plugin-email-streams`: when an account's answer about product
 * updates turns back to yes in the console, core asks this plugin to reopen
 * that one stream on the marketing site, over this plugin's topic catalog.
 * The only caller is a console route, so the tenant — which serves the public
 * internet — does not register it.
 *
 * Light at boot: the module that does the work is imported the first time a
 * stream is reopened.
 */
export function registerEmailConsoleServerDeclarations(): void {
  // The registry replaces this plugin's earlier entry, so a second call (a
  // hot reload, a spec) is harmless.
  registerPluginEmailStreams(
    {
      rejoin: async (request) => (await import('./server')).rejoinStreamForAccount(request),
    },
    { pluginId: BUNDLE_ID },
  )
}
