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

import { registerBookingsApi } from '@aglyn/plugins-bookings/server'
import { registerCommerceApi } from '@aglyn/plugins-commerce/server'
import { registerEmailApi } from '@aglyn/plugins-email/server'
import { registerEventsCalendarApi } from '@aglyn/plugins-events-calendar/server'
import { registerMarketingApi } from '@aglyn/plugins-marketing/server'
import { registerWorkflowsApi } from '@aglyn/plugins-workflows/server'

/**
 * Plugin API routes for the tenant (site-facing) app (AGL-396). Each plugin
 * exposes its handlers through a `/server` entry point that pulls in
 * firebase-admin; importing them ONLY here (from the API dispatcher, never
 * client code) keeps server deps out of the browser bundle. The catch-all
 * `pages/api/[...pluginApi]` route resolves requests against this registry,
 * so a migrated feature keeps its original `/api/...` URL.
 */
export function registerTenantPluginApis(): void {
  registerEventsCalendarApi()
  registerEmailApi()
  registerMarketingApi()
  registerWorkflowsApi()
  registerBookingsApi()
  registerCommerceApi()
}

// Run on import so the registry is ready before the dispatcher resolves.
registerTenantPluginApis()
