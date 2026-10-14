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

import { registerPluginAdvertisingConversions } from '@aglyn/aglyn/plugin-manager/plugin-advertising-conversions'
import { subscribePluginDomainEvent } from '@aglyn/aglyn/plugin-manager/plugin-domain-events'
import { registerPluginPersonEraser } from '@aglyn/aglyn/plugin-manager/plugin-person-erasure'
import { AD_CONVERSIONS_PLUGIN_ID } from './constants'

/**
 * The server declarations (AGL-3694), in both apps. Light: every body, and
 * the Admin SDK, loads with the first call that needs it.
 *
 * - The doors' consent: commerce's checkout routes and the form route hand a
 *   visitor's advertising consent to core's contract, which reaches this.
 * - `order.paid`, from commerce through the domain-event outbox: the
 *   Purchase, owed only where the checkout's consent granted.
 * - A person's erasure: the events still owed that carry their hashed
 *   address.
 *
 * None of these holds a token. Delivery is the console job's
 * (`declarations.console-server.ts`).
 */
export function registerAdConversionsServerDeclarations(): void {
  const load = () => Promise.all([import('./server/intake'), import('./server/platform-deps')])
  registerPluginAdvertisingConversions(
    {
      async recordOrderConsent(request) {
        const [{ recordOrderConsent }, { platformIntakeDeps }] = await load()
        await recordOrderConsent(platformIntakeDeps(), request)
      },
      async reportLead(request) {
        const [{ reportLead }, { platformIntakeDeps }] = await load()
        await reportLead(platformIntakeDeps(), request)
      },
    },
    { pluginId: AD_CONVERSIONS_PLUGIN_ID },
  )
  subscribePluginDomainEvent(
    'order.paid',
    async (envelope) => {
      const [{ intakeOrderPaid }, { platformIntakeDeps }] = await load()
      await intakeOrderPaid(platformIntakeDeps(), envelope)
    },
    { pluginId: AD_CONVERSIONS_PLUGIN_ID },
  )
  registerPluginPersonEraser(
    async (request) => {
      const [{ sha256Hex }, { platformAdConversionStore }] = await Promise.all([
        import('./providers/event'),
        import('./server/platform-deps'),
      ])
      const email = String(request.email ?? '').trim().toLowerCase()
      if (!email) return { adConversionEvents: 0 }
      const erased = await platformAdConversionStore().eraseEventsByEmailHash(
        request.orgId,
        sha256Hex(email),
        request.dryRun,
      )
      return { adConversionEvents: erased }
    },
    { pluginId: AD_CONVERSIONS_PLUGIN_ID },
  )
}
