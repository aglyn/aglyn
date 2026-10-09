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

import {
  subscribePluginDomainEvent,
  type PluginDomainEventEnvelope,
} from '@aglyn/aglyn/plugin-manager/plugin-domain-events'
import { registerPluginOrderEmailCopies } from '@aglyn/aglyn/plugin-manager/plugin-order-email-copies'
import { REVIEW_PLATFORMS_PLUGIN_ID } from './constants/bundle-common'
import type { OrderEventPayload, OrderFulfilledPayload } from './server/invitations'

/**
 * Review platforms' SERVER declarations (AGL-3699), loaded by both apps'
 * servers before any handler, cron or webhook runs:
 *
 * - the Trustpilot invitation address the seller's buyer emails are copied
 *   to, through core's order-email copies;
 * - the seller's order events, by name — `order.fulfilled` and
 *   `order.delivered` — one subscriber per service, so a service that is
 *   down is retried alone.
 *
 * Each answers as though absent for a site that connected nothing. Every
 * handler reaches its server module through a dynamic import, so nothing
 * here loads the data layer in an app's boot.
 */

type Handler<P> = (envelope: PluginDomainEventEnvelope<P>) => Promise<void>

const invitations = <P>(pick: (module: typeof import('./server/invitations')) => Handler<P>): Handler<P> =>
  async (envelope) => pick(await import('./server/invitations'))(envelope)

export function registerReviewPlatformsServerDeclarations(): void {
  const owner = { pluginId: REVIEW_PLATFORMS_PLUGIN_ID }
  registerPluginOrderEmailCopies(async (request) => {
    const { trustpilotEmailCopy } = await import('./server/invitations')
    return trustpilotEmailCopy(request)
  }, owner)
  subscribePluginDomainEvent<OrderEventPayload>('order.fulfilled', invitations((m) => m.inviteThroughTrustpilotApi), {
    ...owner,
    name: 'trustpilot-fulfilled',
  })
  subscribePluginDomainEvent<OrderEventPayload>('order.delivered', invitations((m) => m.inviteThroughTrustpilotApi), {
    ...owner,
    name: 'trustpilot-delivered',
  })
  subscribePluginDomainEvent<OrderFulfilledPayload>('order.fulfilled', invitations((m) => m.sendOrderToYotpo), {
    ...owner,
    name: 'yotpo-fulfilled',
  })
}

registerReviewPlatformsServerDeclarations()
