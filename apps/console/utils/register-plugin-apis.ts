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

import { registerBookingsConsoleApi } from '@aglyn/plugins-bookings/server'
import { registerCommerceConsoleApi } from '@aglyn/plugins-commerce/server'
import { registerMarketingConsoleApi } from '@aglyn/plugins-marketing/server'

/**
 * Plugin API routes for the console (authoring) app (AGL-396). The console
 * counterpart to the tenant registration module: each feature plugin
 * exposes its console-side handlers through a `register*ConsoleApi()`
 * function on its `/server` entry point, imported ONLY here so firebase-admin
 * never reaches the browser bundle. The catch-all `pages/api/[...pluginApi]`
 * route resolves requests against this registry, preserving each migrated
 * route's original `/api/...` URL.
 */
export function registerConsolePluginApis(): void {
  registerBookingsConsoleApi()
  registerCommerceConsoleApi()
  registerMarketingConsoleApi()
}

// Run on import so the registry is ready before the dispatcher resolves.
registerConsolePluginApis()
