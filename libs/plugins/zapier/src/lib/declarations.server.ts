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
// The registry from its own module, not the runtime barrel: boot needs the
// registry and nothing else.
import { registerHostEventListener } from '@aglyn/tenant-runtime/host-event-listeners'
import { ZAPIER_PLUGIN_ID, ZAPIER_RELAY_EVENT } from './constants'
import { ZAPIER_DOMAIN_EVENTS, zapierEventForHostEvent } from './model/hook-events'

/**
 * The Zapier plugin's server declarations (AGL-3643), in both apps:
 *
 * - it subscribes to commerce's order events and the bookings plugin's
 *   booking events by name, on core's outbox, and posts each to the site's
 *   hooks that take it;
 * - it hears every host event, and a contact created or a form submitted
 *   on a site with a hook taking it is relayed onto the outbox
 *   (`zapier.relay`), which it then delivers the same way.
 *
 * Every body, and the Admin SDK, loads with the first event that needs it;
 * a host event no hook can take never loads it at all.
 */
export function registerZapierServerDeclarations(): void {
  for (const event of [...ZAPIER_DOMAIN_EVENTS, ZAPIER_RELAY_EVENT]) {
    subscribePluginDomainEvent(
      event,
      async (envelope) => {
        const deps = await import('./server/platform-deps')
        await (event === ZAPIER_RELAY_EVENT ? deps.deliverRelayEnvelope(envelope) : deps.deliverDomainEnvelope(envelope))
      },
      { pluginId: ZAPIER_PLUGIN_ID },
    )
  }
  registerHostEventListener(ZAPIER_PLUGIN_ID, {
    async onEvent(hostId, event, payload, context) {
      if (!zapierEventForHostEvent(event)) return
      const { relayHostEvent } = await import('./server/platform-deps')
      await relayHostEvent(hostId, event, payload, context)
    },
  })
}
