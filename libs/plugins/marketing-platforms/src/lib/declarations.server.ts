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
import { MARKETING_PLATFORMS_PLUGIN_ID } from './constants'

/**
 * The commerce events this plugin is owed (AGL-3639), by the names
 * commerce raises them under through core's domain-event outbox. Light: the
 * handler loads the intake only when an event arrives, and the intake holds
 * no credential — it writes the event down for the console job to deliver.
 */
export const MARKETING_PLATFORMS_SUBSCRIBED_EVENTS = [
  'checkout.started',
  'order.paid',
  'order.fulfilled',
  'order.refunded',
  'order.cancelled',
] as const

export function registerMarketingPlatformsServerDeclarations(): void {
  for (const event of MARKETING_PLATFORMS_SUBSCRIBED_EVENTS) {
    subscribePluginDomainEvent(
      event,
      async (envelope) => {
        const [{ intakeMarketingEvent }, { platformIntakeDeps }] = await Promise.all([
          import('./server/intake'),
          import('./server/platform-deps'),
        ])
        await intakeMarketingEvent(platformIntakeDeps(), envelope)
      },
      { pluginId: MARKETING_PLATFORMS_PLUGIN_ID },
    )
  }
}
