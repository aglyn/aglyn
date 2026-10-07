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
 * The accounting plugin's SERVER declarations (AGL-3614), named under
 * `serverDeclarations` in `plugins.config.json` and loaded by both apps'
 * servers: the subscriptions to commerce's order events.
 *
 * The plugin event outbox (AGL-3611) is drained by a TENANT job, so the
 * subscribers must be registered where the tenant loads them — here. Each
 * one only QUEUES (`server/sync-intake.ts`): it writes sync items and reads
 * the connection's mapping, and never opens a grant or calls a ledger. The
 * console's tick posts what was queued. The intake is imported when an event
 * first arrives, so boot pays for three registrations.
 *
 * Each subscriber restates the event by name and reads commerce's public
 * order view; the plugin never imports commerce. A throw is retried by the
 * outbox with backoff, which is right for a queueing write that failed.
 */

import { subscribePluginDomainEvent } from '@aglyn/aglyn/plugin-manager/plugin-domain-events'
import { ACCOUNTING_PLUGIN_ID } from './constants/bundle-common'

/** The commerce events the sync takes, by name. */
export const ACCOUNTING_SUBSCRIBED_EVENTS = ['order.paid', 'order.refunded', 'order.cancelled'] as const

async function intake() {
  const [module, { defaultAccountingIntakeDeps }] = await Promise.all([
    import('./server/sync-intake'),
    import('./server/intake-deps'),
  ])
  return { module, deps: defaultAccountingIntakeDeps() }
}

export function registerAccountingServerDeclarations(): void {
  subscribePluginDomainEvent(
    'order.paid',
    async (envelope) => {
      const { module, deps } = await intake()
      await module.onOrderPaid(deps, envelope as never)
    },
    { pluginId: ACCOUNTING_PLUGIN_ID },
  )
  subscribePluginDomainEvent(
    'order.refunded',
    async (envelope) => {
      const { module, deps } = await intake()
      await module.onOrderRefunded(deps, envelope as never)
    },
    { pluginId: ACCOUNTING_PLUGIN_ID },
  )
  subscribePluginDomainEvent(
    'order.cancelled',
    async (envelope) => {
      const { module, deps } = await intake()
      await module.onOrderCancelled(deps, envelope as never)
    },
    { pluginId: ACCOUNTING_PLUGIN_ID },
  )
}
