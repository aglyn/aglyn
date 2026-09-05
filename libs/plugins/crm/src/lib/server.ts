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
 * `crm/ping` is the route that exists so the wiring is PROVEN rather than
 * assumed; the task routes (AGL-2599) and `crm/contacts-import` (AGL-2602)
 * are the first that do work. `plugins.config.json` names this
 * module's register function and the `contacts` API prefix, the generated
 * server manifest loads this file, and the console's `/api/[...pluginApi]`
 * dispatcher reaches the handler. A plugin whose first real route also had
 * to be its first wiring test would have two things to debug at once.
 *
 * The task routes (AGL-2599) are the first real ones; they live in
 * `server/task-routes.ts` and are registered here.
 */

import {
  type PluginApiHandler,
  registerPluginApiRoute,
} from '@aglyn/aglyn/server'
import { BUNDLE_ID } from './constants/bundle-common'
import { CRM_TASK_ROUTES } from './model/task-routes'
import { crmTaskCompleteHandler, crmTaskSaveHandler } from './server/task-routes'
import { crmContactsImportHandler } from './server/contacts-import'

/**
 * `GET /api/contacts/ping` → `{ ok: true, plugin: 'contacts' }`.
 *
 * No auth, no host, no data: it answers whether the plugin's server bundle
 * was loaded and its routes registered, which is a fact about the process
 * and not about any org. Anything that reads a document goes behind the
 * same session and role checks the other plugins' console routes use.
 */
export const crmPingHandler: PluginApiHandler = (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  res.status(200).json({ ok: true, plugin: BUNDLE_ID })
}

/** Console API registration, named in `plugins.config.json` as `consoleApi`. */
export function registerCrmConsoleApi(): void {
  registerPluginApiRoute('crm/ping', crmPingHandler)
  // Tasks (AGL-2599): the two writes with a side effect outside the document
  // — an assignee's notification, and the `taskCompleted` host event.
  registerPluginApiRoute(CRM_TASK_ROUTES.save, crmTaskSaveHandler)
  registerPluginApiRoute(CRM_TASK_ROUTES.complete, crmTaskCompleteHandler)
  // The first real route (AGL-2602): one chunk of a contact file, judged and
  // written through the same door every capture uses.
  registerPluginApiRoute('crm/contacts-import', crmContactsImportHandler)
}
