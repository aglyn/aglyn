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

import { registerSitePageResolver } from '@aglyn/aglyn/server'

/**
 * The data plugin's published-site surface (AGL-3475): record pages, served
 * through the platform's site page resolver seam.
 *
 * Its own module (`modules.tenantApi` in `plugins.config.json`) rather than
 * the package's `/server` entry, which carries the console's datasets
 * handlers: the tenant loads this on every page render, and what it loads
 * here is one registration. The resolver itself, and the Admin SDK reads
 * behind it, load on the first request no published page claims.
 */
export function registerDataTenantApi(): void {
  registerSitePageResolver(async (context) =>
    (await import('./record-pages/record-page-resolver.server')).recordPageResolver(
      context,
    ),
  )
}
