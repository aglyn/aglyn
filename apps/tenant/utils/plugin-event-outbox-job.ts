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

import { registerPluginJob } from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import { drainPluginEvents } from '@aglyn/tenant-data-admin/server/plugin-event-outbox'

/**
 * The drain behind plugin events (AGL-3611): every beat, the events owed now
 * go to the plugins subscribed to them, with backoff for a subscriber that
 * failed and a dead letter after the last attempt. See
 * `plugin-event-outbox.ts` for the contract.
 *
 * EVERY MINUTE, for the same reason the dropship outbox runs every minute:
 * someone is waiting on these — a merchant's webhook, the accounting entry
 * for a sale. The query is one indexed range over a collection that is empty
 * whenever nothing is owed, so an idle beat bills one read.
 *
 * Here, in the tenant app, beside the other core jobs: the runner loads every
 * plugin's server surface before it runs, and the subscriptions come from
 * the plugins' server declarations.
 */

/** Core's jobs share this namespace; the registry never interprets it. */
const CORE_JOB_NAMESPACE = 'core'

export const DELIVER_PLUGIN_EVENTS_JOB = 'deliver-plugin-events'

registerPluginJob({
  pluginId: CORE_JOB_NAMESPACE,
  name: DELIVER_PLUGIN_EVENTS_JOB,
  intervalMinutes: 1,
  description:
    'Deliver queued plugin events (an order paid, a return refunded) to the ' +
    'plugins subscribed to them, with backoff and a dead letter.',
  // A locked site's events wait untouched until the lock lifts: delivering
  // one would act for the site — post its order to a webhook, book its sale.
  lockdown: { scope: 'per-host' },
  handler: async (gate) => {
    const result = await drainPluginEvents(gate, firebaseAdmin.app().firestore())
    if (result.retried || result.deadLettered) {
      console.warn(
        `plugin events: ${result.delivered} delivered, ${result.retried} to retry, ` +
          `${result.deadLettered} given up (${result.scanned} read)`,
      )
    }
  },
})
