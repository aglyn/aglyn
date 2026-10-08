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
 * Loyalty's SERVER half (AGL-3640), `@aglyn/plugins-loyalty/server`: the
 * console routes behind the `loyalty` prefix. Every write to a `loyalty*`
 * collection is made from here or from the server declarations; the
 * Firestore rules refuse all of them to clients.
 */

import { registerPluginApiRoute } from '@aglyn/aglyn/server'
import { LOYALTY_API_ROUTES } from './constants/api-routes'

type Routes = typeof import('./server/routes')

const lazy =
  (pick: (routes: Routes) => (request: Request) => Promise<Response>) =>
  async (request: Request) =>
    pick(await import('./server/routes'))(request)

/** Console API registration, named in `plugins.config.json` as `consoleApi`. */
export function registerLoyaltyConsoleApi(): void {
  const routes: Array<[string, Parameters<typeof lazy>[0]]> = [
    [LOYALTY_API_ROUTES.program, (routes) => routes.programRoute],
    [LOYALTY_API_ROUTES.members, (routes) => routes.membersRoute],
    [LOYALTY_API_ROUTES.member, (routes) => routes.memberRoute],
    [LOYALTY_API_ROUTES.order, (routes) => routes.orderRoute],
  ]
  for (const [path, pick] of routes) {
    const handler = lazy(pick)
    registerPluginApiRoute(path, { web: (request) => handler(request) })
  }
}
