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

import { registerPluginApiRoute, registerSiteRedirectResolver } from '@aglyn/aglyn/server'
import { resolveRedirect } from './server/resolve-redirect'

/**
 * Registers the redirects plugin's tenant-side hooks (AGL-418): the rule
 * engine (AGL-155) answers site requests with a redirect before any route
 * resolution — relocated from the tenant app's resolve-redirect util into
 * the plugin behind the core site-page hook.
 */
export function registerRedirectsApi(): void {
  registerSiteRedirectResolver(async ({ host, path }) => {
    const rule = await resolveRedirect(host, path)
    return rule
      ? { destination: rule.destination, statusCode: rule.statusCode }
      : undefined
  })
}

/**
 * The redirects plugin's CONSOLE API: `POST /api/redirects/check`, the
 * Redirects page's save checks for the native apps (`server/redirect-check.ts`).
 * The handler loads with its first call, so neither boot pays for it.
 */
export function registerRedirectsConsoleApi(): void {
  registerPluginApiRoute('redirects/check', async (req, res) =>
    (await import('./server/redirect-check')).redirectCheckHandler(req, res),
  )
}
