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

import type { PluginCourierState } from '@aglyn/aglyn/plugin-manager/plugin-local-deliveries'

/**
 * The client-safe model of the couriers plugin (AGL-3695): the providers,
 * the words for where a run stands, and the views the routes answer. No key,
 * hash or sealed value ever appears in one of these.
 */

/**
 * The couriers a store can send. DoorDash Drive only: Uber Direct's terms
 * have a merchant warrant it shares its API keys with no third party, so a
 * merchant cannot connect their own Uber Direct keys to a platform that is
 * not one Uber authorized (see the plugin's docs page).
 */
export type CourierProviderId = 'doordash'

export const COURIER_PROVIDER_IDS: readonly CourierProviderId[] = ['doordash']

export const COURIER_PROVIDERS: Readonly<
  Record<CourierProviderId, { label: string; product: string; portal: string }>
> = {
  doordash: {
    label: 'DoorDash',
    product: 'DoorDash Drive',
    portal: 'https://developer.doordash.com/portal',
  },
}

export function isCourierProviderId(value: unknown): value is CourierProviderId {
  return COURIER_PROVIDER_IDS.includes(value as CourierProviderId)
}

/** Which keys: the courier's live environment, or its test environment, where nobody comes. */
export type CourierKeyMode = 'live' | 'test'

export type CourierState = PluginCourierState

export const COURIER_STATE_LABELS: Readonly<Record<CourierState, string>> = {
  requested: 'Courier requested',
  assigned: 'Courier on the way to the store',
  at_pickup: 'Courier at the store',
  picked_up: 'On its way',
  at_dropoff: 'Courier arriving',
  delivered: 'Delivered',
  cancelled: 'Canceled',
  returning: 'Coming back to the store',
  returned: 'Returned to the store',
}

/** One mode's keys as a member reads them: never the secret. */
export interface CourierKeysView {
  configured: boolean
  developerId: string | null
  keyId: string | null
  lastTestOk: boolean
  lastTestAtMs: number | null
  lastError: string | null
}

export interface CourierConnectionView {
  provider: CourierProviderId
  providerLabel: string
  live: CourierKeysView
  test: CourierKeysView
  /** E.164; the store's phone the courier calls when the location has none. */
  pickupPhone: string | null
  /** What every courier is told at the store: "Ask at the counter". */
  pickupNote: string | null
  /** Where the courier's webhook goes: the merchant pastes it into their portal. */
  webhookUrl: string | null
  /** Whether a webhook token was minted; the token itself is shown once. */
  webhookTokenSet: boolean
  updatedAtMs: number
}

/** A courier's price and estimate for one order. The courier bills it to the merchant's own account. */
export interface CourierQuoteView {
  provider: CourierProviderId
  providerLabel: string
  feeCents: number
  currency: string
  pickupEtaMs: number | null
  dropoffEtaMs: number | null
  expiresAtMs: number
  testMode: boolean
}

/** A courier run on one order. */
export interface CourierRunView {
  provider: CourierProviderId
  providerLabel: string
  deliveryRef: string
  state: CourierState
  stateLabel: string
  /** The booking was sent and its answer was lost: the job confirms it with the courier. */
  pending: boolean
  trackingUrl: string | null
  etaMs: number | null
  pickupEtaMs: number | null
  /** What the courier charges the merchant's own account; `null` until it says. */
  feeCents: number | null
  currency: string
  reason: string | null
  testMode: boolean
  cancelRequested: boolean
  createdAtMs: number
  updatedAtMs: number
}

export interface CourierOrderView {
  orderId: string
  quote: CourierQuoteView | null
  run: CourierRunView | null
  history: CourierRunView[]
}

/** Whether a run is over: nothing more will happen on it. */
export function courierStateIsFinal(state: CourierState): boolean {
  return state === 'delivered' || state === 'cancelled' || state === 'returned'
}

/** Integer cents as dollars and cents, in the run's currency. */
export function formatCourierFee(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100)
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`
  }
}
