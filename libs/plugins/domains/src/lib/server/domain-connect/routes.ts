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

import { registerPluginApiRoute } from '@aglyn/aglyn/server'
import { DOMAINS_API_ROUTES } from '../../constants/bundle-common'
import type { DomainConnectRouteDeps } from './handlers'

/**
 * One-click DNS routes (AGL-3963): discover a domain's DNS provider, start a
 * signed Domain Connect hand-off, finish it once the records resolve, and the
 * page the provider sends the owner back to. Each handler, and the platform
 * wiring behind it, loads on the first request.
 */

let deps: DomainConnectRouteDeps | null = null

async function load() {
  const [handlers, platform] = await Promise.all([import('./handlers'), import('./platform')])
  deps ??= platform.platformDomainConnectRouteDeps()
  return { handlers, deps }
}

export function registerDomainConnectRoutes(): void {
  registerPluginApiRoute(DOMAINS_API_ROUTES.connectDiscover, {
    web: async (request) => {
      const { handlers, deps } = await load()
      return handlers.createDiscoverRoute(deps)(request)
    },
  })
  registerPluginApiRoute(DOMAINS_API_ROUTES.connectStart, {
    web: async (request) => {
      const { handlers, deps } = await load()
      return handlers.createStartRoute(deps)(request)
    },
  })
  registerPluginApiRoute(DOMAINS_API_ROUTES.connectFinish, {
    web: async (request) => {
      const { handlers, deps } = await load()
      return handlers.createFinishRoute(deps)(request)
    },
  })
  // A browser coming back from the DNS provider names no site and carries no
  // token: the release gate asks about the organization its state belongs to.
  registerPluginApiRoute(
    DOMAINS_API_ROUTES.connectReturn,
    {
      web: async (request) => {
        const { handlers, deps } = await load()
        return handlers.createReturnRoute(deps)(request)
      },
    },
    {
      subject: async (request) => {
        const { handlers, deps } = await load()
        return handlers.createReturnSubject(deps)(request)
      },
    },
  )
}
