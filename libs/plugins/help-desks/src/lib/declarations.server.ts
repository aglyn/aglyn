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

import { registerPluginPersonEraser } from '@aglyn/aglyn/plugin-manager/plugin-person-erasure'
import { subscribePluginDomainEvent } from '@aglyn/aglyn/plugin-manager/plugin-domain-events'
// The registry from its own module, not the runtime barrel: boot needs the
// registry and nothing else.
import { registerHostEventListener } from '@aglyn/tenant-runtime/host-event-listeners'
import { HELP_DESKS_PLUGIN_ID } from './constants'

/**
 * The server declarations (AGL-3824), in both apps. Light: every body, and
 * the Admin SDK, loads with the first event that needs it, and a host event
 * other than a form submission returns before loading anything.
 *
 * - Commerce's order events, by name on core's domain-event outbox: each
 *   order is owed to the site's connections that take orders.
 * - A form submission, heard through the runtime's host event listeners:
 *   owed to the site's connections that send contact form messages.
 * - A person's erasure: what the connections keep about the address.
 *
 * None of these holds a credential. Delivery is the console job's
 * (`declarations.console-server.ts`).
 */

/** Mirrors `HELP_DESKS_ORDER_EVENTS` in `server/intake.ts`, kept here so boot loads no server module. */
export const HELP_DESKS_SUBSCRIBED_EVENTS = [
  'order.paid',
  'order.fulfilled',
  'order.delivered',
  'order.refunded',
  'order.cancelled',
] as const

const load = () => Promise.all([import('./server/intake'), import('./server/platform-deps')])

export function registerHelpDesksServerDeclarations(): void {
  for (const event of HELP_DESKS_SUBSCRIBED_EVENTS) {
    subscribePluginDomainEvent(
      event,
      async (envelope) => {
        const [{ intakeOrderEvent }, { platformIntakeDeps }] = await load()
        await intakeOrderEvent(platformIntakeDeps(), envelope)
      },
      { pluginId: HELP_DESKS_PLUGIN_ID },
    )
  }
  registerHostEventListener(HELP_DESKS_PLUGIN_ID, {
    async onEvent(hostId, event, payload, context) {
      if (event !== 'formSubmission') return
      const [{ intakeFormSubmission }, { platformIntakeDeps }] = await load()
      await intakeFormSubmission(platformIntakeDeps(), hostId, payload, {
        actor: context?.actor ?? null,
        recordId: context?.recordId ?? null,
      })
    },
  })
  registerPluginPersonEraser(
    async (request) => {
      const email = String(request.email ?? '').trim().toLowerCase()
      if (!email) return { helpDeskCustomers: 0, helpDeskOutbox: 0 }
      const { platformConnectionStore } = await import('./server/platform-deps')
      const erased = await platformConnectionStore().erasePerson(request.orgId, email, request.dryRun)
      return { helpDeskCustomers: erased.customers, helpDeskOutbox: erased.outbox }
    },
    { pluginId: HELP_DESKS_PLUGIN_ID },
  )
}
