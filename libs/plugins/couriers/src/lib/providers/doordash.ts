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

import type { PluginLocalDeliveryPlace } from '@aglyn/aglyn/plugin-manager/plugin-local-deliveries'
import { createHmac } from 'node:crypto'
import type { CourierState } from '../model/couriers'
import { ProviderError, providerRequest, type ProviderHttp } from './http'
import {
  cents,
  httpsUrl,
  text,
  timeMs,
  type CourierDropRequest,
  type CourierKeys,
  type CourierProvider,
  type CourierQuote,
  type CourierRunSnapshot,
  type CourierWebhookEvent,
} from './provider'

/**
 * DoorDash Drive (AGL-3695), with the MERCHANT's own Drive developer account:
 * DoorDash charges each delivery to the card on that account, so Aglyn never
 * touches the fee.
 *
 * - **Calls.** Each request carries a JWT (HS256, header `dd-ver:
 *   DD-JWT-V1`, claims `aud: doordash`, `iss` the developer id, `kid` the
 *   key id, five minutes) signed with the key's signing secret, decoded from
 *   base64url. One host serves both environments: test keys reach DoorDash's
 *   sandbox, where no Dasher is sent.
 * - **Quote, then accept.** `POST /drive/v2/quotes` prices the drop under
 *   OUR `external_delivery_id`; `POST /drive/v2/quotes/{id}/accept` books
 *   that quote. The id is the idempotency key: a second accept of the same id
 *   is refused (409), never a second delivery.
 * - **Follow and cancel.** `GET /drive/v2/deliveries/{id}`;
 *   `PUT /drive/v2/deliveries/{id}/cancel`.
 * - **Webhooks.** DoorDash posts each event with the value the merchant
 *   entered as the webhook's Basic Authorization in their portal (checked by
 *   the route); the body names the run by `external_delivery_id`.
 *
 * Every amount DoorDash sends is in cents.
 */

/** DoorDash Drive's API, whole, so its path is never read as a console page. */
const API = 'https://openapi.doordash.com/drive/v2'
const NAME = 'DoorDash'

const b64url = (value: Buffer | string) => Buffer.from(value).toString('base64url')

/** The JWT DoorDash authenticates a request with: five minutes, signed with the decoded secret. */
export function doordashDriveJwt(keys: CourierKeys, nowMs: number): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT', 'dd-ver': 'DD-JWT-V1' }))
  const iat = Math.floor(nowMs / 1000)
  const payload = b64url(JSON.stringify({ aud: 'doordash', iss: keys.developerId, kid: keys.keyId, iat, exp: iat + 300 }))
  const signature = createHmac('sha256', Buffer.from(keys.signingSecret, 'base64url'))
    .update(`${header}.${payload}`)
    .digest('base64url')
  return `${header}.${payload}.${signature}`
}

/** DoorDash's `delivery_status` in the plugin's words. */
const STATUS: Readonly<Record<string, CourierState>> = {
  created: 'requested',
  confirmed: 'assigned',
  enroute_to_pickup: 'assigned',
  arrived_at_pickup: 'at_pickup',
  picked_up: 'picked_up',
  enroute_to_dropoff: 'picked_up',
  arrived_at_dropoff: 'at_dropoff',
  delivered: 'delivered',
  enroute_to_return: 'returning',
  arrived_at_return: 'returning',
  returned: 'returned',
  cancelled: 'cancelled',
}

/** DoorDash's webhook `event_name` in the plugin's words. */
const EVENT: Readonly<Record<string, CourierState>> = {
  DELIVERY_CREATED: 'requested',
  DASHER_CONFIRMED: 'assigned',
  DASHER_ENROUTE_TO_PICKUP: 'assigned',
  DASHER_CONFIRMED_PICKUP_ARRIVAL: 'at_pickup',
  DASHER_PICKED_UP: 'picked_up',
  DASHER_ENROUTE_TO_DROPOFF: 'picked_up',
  DASHER_CONFIRMED_DROPOFF_ARRIVAL: 'at_dropoff',
  DASHER_DROPPED_OFF: 'delivered',
  DELIVERY_CANCELLED: 'cancelled',
  DELIVERY_RETURN_INITIALIZED: 'returning',
  DASHER_ENROUTE_TO_RETURN: 'returning',
  DASHER_CONFIRMED_RETURN_ARRIVAL: 'returning',
  DELIVERY_RETURNED: 'returned',
}

/** One address on one line, as DoorDash geocodes it. */
export function doordashAddress(place: PluginLocalDeliveryPlace): string {
  const address = place.address
  const region = [address.state, address.postalCode].filter(Boolean).join(' ')
  return [
    [address.line1, address.line2].filter(Boolean).join(' '),
    address.city,
    region,
    address.country,
  ]
    .filter(Boolean)
    .join(', ')
}

/** The cancellation reason DoorDash gives, in words a merchant reads. */
function reasonOf(body: any): string | null {
  const reason = text(body?.cancellation_reason_message, 200) || text(body?.cancellation_reason, 120)
  return reason ? reason.replace(/_/g, ' ') : null
}

/** A delivery or webhook body as a snapshot. */
export function readDoordashRun(body: any, stateOverride?: CourierState | null): CourierRunSnapshot {
  const status = text(body?.delivery_status, 40).toLowerCase()
  return {
    deliveryRef: text(body?.external_delivery_id, 120),
    state: stateOverride !== undefined ? stateOverride : (STATUS[status] ?? null),
    trackingUrl: httpsUrl(body?.tracking_url),
    etaMs: timeMs(body?.dropoff_time_actual) ?? timeMs(body?.dropoff_time_estimated),
    pickupEtaMs: timeMs(body?.pickup_time_actual) ?? timeMs(body?.pickup_time_estimated),
    feeCents: cents(body?.fee),
    currency: text(body?.currency, 3).toLowerCase() || null,
    reason: reasonOf(body),
  }
}

function dropBody(drop: CourierDropRequest): Record<string, unknown> {
  return {
    external_delivery_id: drop.deliveryRef,
    pickup_address: doordashAddress(drop.pickup),
    pickup_business_name: drop.pickup.name.slice(0, 80),
    ...(drop.pickup.phone ? { pickup_phone_number: drop.pickup.phone } : {}),
    ...(drop.pickup.instructions ? { pickup_instructions: drop.pickup.instructions.slice(0, 280) } : {}),
    pickup_reference_tag: `Order ${drop.displayRef}`.slice(0, 50),
    dropoff_address: doordashAddress(drop.dropoff),
    dropoff_contact_given_name: drop.dropoff.name.slice(0, 80),
    ...(drop.dropoff.phone ? { dropoff_phone_number: drop.dropoff.phone } : {}),
    ...(drop.dropoff.instructions ? { dropoff_instructions: drop.dropoff.instructions.slice(0, 280) } : {}),
    order_value: Math.max(0, Math.round(drop.valueCents)),
    currency: drop.currency.toUpperCase(),
  }
}

/** The run DoorDash webhooks name, read; `null` for a body that names none. */
export function readDoordashWebhook(body: unknown): CourierWebhookEvent | null {
  const record = (body ?? null) as Record<string, any> | null
  if (!record || typeof record !== 'object') return null
  const deliveryRef = text(record['external_delivery_id'], 120)
  if (!deliveryRef) return null
  const eventName = text(record['event_name'], 80)
  const byEvent = EVENT[eventName.toUpperCase()]
  const run = readDoordashRun(record, byEvent ?? undefined)
  return {
    ...run,
    eventKey: [eventName || text(record['delivery_status'], 40) || 'event', text(record['created_at'], 40), deliveryRef].join('|'),
  }
}

export function createDoordashDriveProvider(input: { http: ProviderHttp; now?: () => number }): CourierProvider {
  const { http } = input
  const now = input.now ?? Date.now
  const headers = (keys: CourierKeys) => ({
    Authorization: `Bearer ${doordashDriveJwt(keys, now())}`,
    'Content-Type': 'application/json',
  })
  const path = (deliveryRef: string) => encodeURIComponent(deliveryRef)

  return {
    id: 'doordash',

    async test(keys) {
      // Drive has no "who am I". A lookup of a run that cannot exist answers
      // 404 to good keys and 401 to bad ones; anything but `auth` is a pass.
      try {
        await providerRequest(http, {
          provider: NAME,
          method: 'GET',
          url: `${API}/deliveries/aglyn-key-check`,
          headers: headers(keys),
          retry: false,
        })
      } catch (error) {
        if (error instanceof ProviderError && error.kind === 'not-found') return
        throw error
      }
    },

    async quote(keys, drop): Promise<CourierQuote> {
      const body = await providerRequest(http, {
        provider: NAME,
        method: 'POST',
        url: `${API}/quotes`,
        headers: headers(keys),
        body: dropBody(drop),
        retry: false,
      })
      const fee = cents(body?.fee)
      if (fee === null) throw new ProviderError('invalid', `${NAME} answered no price`)
      return {
        deliveryRef: text(body?.external_delivery_id, 120) || drop.deliveryRef,
        feeCents: fee,
        currency: text(body?.currency, 3).toLowerCase() || drop.currency,
        pickupEtaMs: timeMs(body?.pickup_time_estimated),
        dropoffEtaMs: timeMs(body?.dropoff_time_estimated),
        expiresAtMs: timeMs(body?.expires_at),
      }
    },

    async accept(keys, deliveryRef) {
      const body = await providerRequest(http, {
        provider: NAME,
        method: 'POST',
        url: `${API}/quotes/${path(deliveryRef)}/accept`,
        headers: headers(keys),
        body: {},
        retry: false,
      })
      return readDoordashRun({ external_delivery_id: deliveryRef, delivery_status: 'created', ...body })
    },

    async get(keys, deliveryRef) {
      const body = await providerRequest(http, {
        provider: NAME,
        method: 'GET',
        url: `${API}/deliveries/${path(deliveryRef)}`,
        headers: headers(keys),
      })
      return readDoordashRun({ external_delivery_id: deliveryRef, ...body })
    },

    async cancel(keys, deliveryRef) {
      const body = await providerRequest(http, {
        provider: NAME,
        method: 'PUT',
        url: `${API}/deliveries/${path(deliveryRef)}/cancel`,
        headers: headers(keys),
        body: {},
      })
      return readDoordashRun({ external_delivery_id: deliveryRef, delivery_status: 'cancelled', ...body })
    },

    parseWebhook: readDoordashWebhook,
  }
}
