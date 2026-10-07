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

import type { RouteActor } from '../route-gate'
import { configuredProviders } from './config'
import { getConnection, publicConnection } from './connection-store'

/**
 * What the state answer says about the channels' API connections (AGL-3637,
 * phase 2): nothing at all on a deployment that configured no provider, so
 * the card draws no connect button; otherwise each configured provider and
 * the site's connection to it, never its token.
 */
export async function connectState(actor: RouteActor): Promise<Record<string, unknown>> {
  const providers = configuredProviders()
  if (!providers.length) return {}
  const connections = await Promise.all(
    providers.map(async (provider) => ({
      provider,
      connection: publicConnection(await getConnection(actor.hostId, provider)),
    })),
  )
  return { connect: { providers: connections } }
}
