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

import { registerOperatorAlerts } from '@aglyn/aglyn/plugin-manager/operator-alerts'
import { registerPluginConsoleCron } from '@aglyn/aglyn/plugin-manager/plugin-console-crons'
import { registerPluginEventHandler } from '@aglyn/aglyn/plugin-manager/plugin-events'
import { BUNDLE_ID } from './constants/bundle-common'
import { DOMAINS_OPERATOR_ALERTS } from './server/alerts'
import { registerDomainConnectDeclarations } from './server/domain-connect/declarations'

/** The lifecycle sweep's job id: its beat document and its health row. */
export const DOMAINS_LIFECYCLE_JOB_ID = 'domains-lifecycle'

/**
 * Domains' console-server registrations (AGL-3962, AGL-3963): the lifecycle
 * sweep, its operator alerts, and the platform events it hears. On the
 * console's server only — the billing webhook and the domain routes that
 * raise these events run there, and the sweep charges cards.
 */
export function registerDomainsConsoleServerDeclarations(): void {
  registerOperatorAlerts(DOMAINS_OPERATOR_ALERTS, { pluginId: BUNDLE_ID })
  registerPluginConsoleCron(
    {
      id: DOMAINS_LIFECYCLE_JOB_ID,
      label: 'Domains',
      drives:
        'Finishes domain orders and connects them to their sites, refunds a purchase the registrar could not complete, reminds owners to confirm their registrant email, sends renewal notices, charges and renews domains before they expire, and lets a site fall back to its free address when its domain expires. If it stops, bought domains are left half-finished and renewals stop — the registrar’s own auto-renew keeps the names alive, unpaid.',
      run: async (context) => {
        const [{ runDomainsSweep }, { platformEffects }] = await Promise.all([
          import('./server/lifecycle'),
          import('./server/platform-effects'),
        ])
        return runDomainsSweep(platformEffects(), context)
      },
    },
    { pluginId: BUNDLE_ID },
  )
  registerPluginEventHandler(
    'billing.dispute.opened',
    async (payload) => (await import('./server/events')).onDisputeOpened(payload),
    { pluginId: BUNDLE_ID },
  )
  registerPluginEventHandler(
    'billing.paymentMethod.changed',
    async (payload) => (await import('./server/events')).onPaymentMethodChanged(payload),
    { pluginId: BUNDLE_ID },
  )
  registerPluginEventHandler(
    'host.domain.released',
    async (payload) => (await import('./server/events')).onHostDomainReleased(payload),
    { pluginId: BUNDLE_ID },
  )
  registerDomainConnectDeclarations()
}
