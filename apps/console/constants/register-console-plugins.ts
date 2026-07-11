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

import { registerBookingsConsole } from '@aglyn/plugins-bookings'
import { registerCommerceConsole } from '@aglyn/plugins-commerce'
import { registerCommunityConsole } from '@aglyn/plugins-community'
import { registerContactsConsole } from '@aglyn/plugins-contacts'
import { registerDataConsole } from '@aglyn/plugins-data'
import { registerEmailConsole } from '@aglyn/plugins-email'
import { registerEventsCalendarConsole } from '@aglyn/plugins-events-calendar'
import { registerInboxConsole } from '@aglyn/plugins-inbox'
import { registerLogicConsole } from '@aglyn/plugins-logic'
import { registerMarketingConsole } from '@aglyn/plugins-marketing'
import { registerRedirectsConsole } from '@aglyn/plugins-redirects'
import { registerWorkflowsConsole } from '@aglyn/plugins-workflows'

/**
 * Console plugin surfaces (AGL-394). Feature plugins declare their console
 * nav items, pages, and dashboard cards through the ConsoleExtension
 * registry; importing this module at `_app` load populates the registry
 * before any nav renders. The shell (host-nav-tabs + the generic
 * `[hostId]/[pluginSlug]` route) reads the registry, so a plugin extends
 * the console — menu items AND pages — without editing core app files.
 *
 * Each entry registers only the console half (nav + lazy page), never the
 * besigner canvas bundle, so this stays out of the general console bundle.
 * The canvas bundles still register per-editor in the besigner/preview
 * pages via `register*Plugin()`.
 */
export function registerConsolePlugins(): void {
  registerEventsCalendarConsole()
  registerEmailConsole()
  registerCommerceConsole()
  registerBookingsConsole()
  registerRedirectsConsole()
  registerDataConsole()
  registerLogicConsole()
  registerWorkflowsConsole()
  registerMarketingConsole()
  registerCommunityConsole()
  registerInboxConsole()
  registerContactsConsole()
}

// Run on import so the registry is ready by first render.
registerConsolePlugins()
