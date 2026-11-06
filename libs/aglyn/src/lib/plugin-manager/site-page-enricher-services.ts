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

import { definePluginServiceContract, registerPluginService } from './plugin-services'
import type { SitePageEnricher } from './site-page-hooks'

/**
 * Enrichers registered from a plugin's BOOT declarations (AGL-4195), which
 * `instrumentation.ts` runs in a compilation of its own: a module-scope list
 * filled there is empty where the page route reads it (AGL-3947). These live
 * in the plugin-service registry, on `globalThis`, so the route sees them. A
 * plugin registering again replaces its own (by `key`), and the owner is
 * named at registration, so the page's "who contributed" narrowing holds.
 *
 * Plugins registering from a surface the route itself loads (`tenantApi`)
 * keep using `registerSitePageEnricher` (`site-page-hooks.ts`), which runs
 * these after its own.
 */
export const SITE_PAGE_ENRICHER_SERVICES = definePluginServiceContract<SitePageEnricher>(
  'core.site-page-enricher',
  { multiple: true },
)

/** Registers a boot-time enricher; see {@link SITE_PAGE_ENRICHER_SERVICES}. */
export function registerSitePageEnricherService(
  fn: SitePageEnricher,
  options?: { pluginId?: string; key?: string },
): void {
  registerPluginService(SITE_PAGE_ENRICHER_SERVICES, fn, options)
}

