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
import { timingSafeEqual } from 'node:crypto'
import type { CourierProviderId, CourierState } from '../model/couriers'

/**
 * What a courier adapter does (AGL-3695), in the plugin's words. Each call is
 * made with ONE merchant's own keys, opened for that call; an adapter keeps
 * nothing between calls.
 */

/** A merchant's keys for one environment of their courier account. */
export interface CourierKeys {
  developerId: string
  keyId: string
  signingSecret: string
}

/** One drop, as a courier is asked to price or take it. */
export interface CourierDropRequest {
  /** Our reference for the run, unique per attempt: the courier's idempotency key. */
  deliveryRef: string
  /** What a person at the store calls the order: `#1042`. */
  displayRef: string
  pickup: PluginLocalDeliveryPlace
  dropoff: PluginLocalDeliveryPlace
  valueCents: number
  /** ISO-4217, lower case. */
  currency: string
  itemCount: number
}

/** A courier's price for a drop. */
export interface CourierQuote {
  deliveryRef: string
  feeCents: number
  currency: string
  pickupEtaMs: number | null
  dropoffEtaMs: number | null
  /** When the courier stops honouring it; `null` when it does not say. */
  expiresAtMs: number | null
}

/** Where a run stands, as the courier reports it. */
export interface CourierRunSnapshot {
  deliveryRef: string
  /** `null` when the courier's word is one this plugin does not move on (a quote, a batch). */
  state: CourierState | null
  trackingUrl: string | null
  etaMs: number | null
  pickupEtaMs: number | null
  feeCents: number | null
  currency: string | null
  reason: string | null
}

/** One webhook delivery, read. */
export interface CourierWebhookEvent extends CourierRunSnapshot {
  /** Stable per event, so a redelivery is recognized. */
  eventKey: string
}

export interface CourierProvider {
  id: CourierProviderId
  /** Resolves when the courier accepts the keys; throws `ProviderError('auth')` when it refuses them. */
  test(keys: CourierKeys): Promise<void>
  quote(keys: CourierKeys, drop: CourierDropRequest): Promise<CourierQuote>
  /** Books the quoted run. One attempt: never retried in the call. */
  accept(keys: CourierKeys, deliveryRef: string): Promise<CourierRunSnapshot>
  get(keys: CourierKeys, deliveryRef: string): Promise<CourierRunSnapshot>
  cancel(keys: CourierKeys, deliveryRef: string): Promise<CourierRunSnapshot>
  /** A webhook body in the plugin's words; `null` when it names no run. */
  parseWebhook(body: unknown): CourierWebhookEvent | null
}

export const text = (value: unknown, max = 200): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value).trim().slice(0, max) : ''

/** An ISO date or epoch value as epoch ms, or `null`. */
export function timeMs(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Date.parse(String(value))
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

/** A whole number of cents, or `null`. */
export function cents(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : null
}

/** An https URL, or `null`. */
export function httpsUrl(value: unknown): string | null {
  const raw = text(value, 500)
  return /^https:\/\/[^\s"'<>]+$/.test(raw) ? raw : null
}

/** Constant-time string equality. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right)
}
