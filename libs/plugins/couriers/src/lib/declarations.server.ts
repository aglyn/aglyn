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

import { subscribePluginDomainEvent } from '@aglyn/aglyn/plugin-manager/plugin-domain-events'
import { COURIERS_PLUGIN_ID } from './constants'

/**
 * The plugin's SERVER declarations (AGL-3695), loaded by both apps' servers:
 * commerce's order events, by the names commerce raises them under. The
 * outbox drains in the tenant, so the subscribers only MARK a run to be
 * called off (`server/intake.ts`); the console job holds the keys and calls
 * the courier. Light at boot: every body is imported when it is first called.
 */

export const COURIERS_SUBSCRIBED_EVENTS = ['order.cancelled', 'order.refunded'] as const

async function intake() {
  const [module, { defaultIntakeDeps }] = await Promise.all([import('./server/intake'), import('./server/intake-deps')])
  return { module, deps: defaultIntakeDeps() }
}

export function registerCouriersServerDeclarations(): void {
  const owner = { pluginId: COURIERS_PLUGIN_ID }
  subscribePluginDomainEvent(
    'order.cancelled',
    async (envelope) => {
      const { module, deps } = await intake()
      await module.onOrderCancelled(deps, envelope as never)
    },
    owner,
  )
  subscribePluginDomainEvent(
    'order.refunded',
    async (envelope) => {
      const { module, deps } = await intake()
      await module.onOrderRefunded(deps, envelope as never)
    },
    owner,
  )
}
