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
 * Waivers' SERVER half (AGL-4042), `@aglyn/plugins-waivers/server`: the
 * routes behind the `waivers` prefix. Every write to a waivers collection is
 * made from here; the Firestore rules refuse all of them to clients.
 */

import { registerPluginApiRoute } from '@aglyn/aglyn/server'
import { WAIVERS_API_ROUTES } from './constants/bundle-common'

type Handler = (request: Request) => Promise<Response>
type Modules = {
  templates: typeof import('./server/template-routes')
  signatures: typeof import('./server/signature-routes')
  public: typeof import('./server/public-routes')
}

const lazy =
  <K extends keyof Modules>(module: K, pick: (loaded: Modules[K]) => Handler) =>
  async (request: Request): Promise<Response> => {
    const loaded = (
      module === 'templates'
        ? await import('./server/template-routes')
        : module === 'signatures'
          ? await import('./server/signature-routes')
          : await import('./server/public-routes')
    ) as Modules[K]
    return pick(loaded)(request)
  }

/** The signer's two doors, served by both apps: the share link's page and the site's element. */
function registerPublicRoutes(): void {
  registerPluginApiRoute(WAIVERS_API_ROUTES.publicWaiver, {
    web: lazy('public', (routes) => routes.publicWaiverRoute),
  })
  registerPluginApiRoute(WAIVERS_API_ROUTES.publicSign, {
    web: lazy('public', (routes) => routes.publicSignRoute),
  })
}

/** Tenant API registration, named in `plugins.config.json` as `tenantApi`. */
export function registerWaiversApi(): void {
  registerPublicRoutes()
}

/** Console API registration, named in `plugins.config.json` as `consoleApi`. */
export function registerWaiversConsoleApi(): void {
  registerPublicRoutes()
  const routes: Array<[string, Handler]> = [
    [WAIVERS_API_ROUTES.templates, lazy('templates', (routes) => routes.templatesRoute)],
    [WAIVERS_API_ROUTES.template, lazy('templates', (routes) => routes.templateRoute)],
    [WAIVERS_API_ROUTES.signatures, lazy('signatures', (routes) => routes.signaturesRoute)],
    [WAIVERS_API_ROUTES.signature, lazy('signatures', (routes) => routes.signatureRoute)],
    [WAIVERS_API_ROUTES.signaturePdf, lazy('signatures', (routes) => routes.signaturePdfRoute)],
    [WAIVERS_API_ROUTES.signatureFile, lazy('signatures', (routes) => routes.signatureFileRoute)],
    [WAIVERS_API_ROUTES.signAtWindow, lazy('signatures', (routes) => routes.signAtWindowRoute)],
    [WAIVERS_API_ROUTES.paper, lazy('signatures', (routes) => routes.paperRoute)],
    [WAIVERS_API_ROUTES.status, lazy('signatures', (routes) => routes.statusRoute)],
  ]
  for (const [path, handler] of routes) registerPluginApiRoute(path, { web: (request) => handler(request) })
}
