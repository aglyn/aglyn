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
 * The Contacts plugin's SERVER half (AGL-2595).
 *
 * Contacts CRM v1 had none: every console write was client-direct against
 * the Firestore rules, and the one server path that creates a contact —
 * `upsertHostContact` — belongs to the capture doors, not to this plugin.
 * v2 needs a server for the things a browser must not do alone: an import
 * that dedupes forty thousand rows, a bulk action over a selection, an
 * auto-association of contacts to companies by domain. Each of those lands
 * as a `contacts/<route>` handler registered here.
 *
 * `contacts/ping` is the one route that exists today, and it exists so the
 * wiring is PROVEN rather than assumed: `plugins.config.json` names this
 * module's register function and the `contacts` API prefix, the generated
 * server manifest loads this file, and the console's `/api/[...pluginApi]`
 * dispatcher reaches the handler. A plugin whose first real route also had
 * to be its first wiring test would have two things to debug at once.
 */

import {
  type PluginApiHandler,
  registerPluginApiRoute,
} from '@aglyn/aglyn/server'
import { BUNDLE_ID } from './constants/bundle-common'

/**
 * `GET /api/contacts/ping` → `{ ok: true, plugin: 'contacts' }`.
 *
 * No auth, no host, no data: it answers whether the plugin's server bundle
 * was loaded and its routes registered, which is a fact about the process
 * and not about any org. Anything that reads a document goes behind the
 * same session and role checks the other plugins' console routes use.
 */
export const contactsPingHandler: PluginApiHandler = (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  res.status(200).json({ ok: true, plugin: BUNDLE_ID })
}

/** Console API registration, named in `plugins.config.json` as `consoleApi`. */
export function registerContactsConsoleApi(): void {
  registerPluginApiRoute('contacts/ping', contactsPingHandler)
}
