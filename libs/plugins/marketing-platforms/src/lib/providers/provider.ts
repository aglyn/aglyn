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

import type { MarketingProviderId, MarketingProviderList } from '../model/connections'
import type { ProviderHttp } from './http'

/**
 * The contract every marketing platform adapter meets (AGL-3639). The sync
 * engine speaks only this; which vendor is on the other end, how it is
 * authenticated and what its payloads look like are each adapter's.
 */

/** A credential, opened. Lives only for the length of a run. */
export interface ProviderCredential {
  kind: 'api-key' | 'oauth'
  /** The merchant's API key, or the OAuth access token. */
  token: string
  /** The account's API root, for a provider that shards accounts by host (Mailchimp's data center). */
  apiBase?: string | null
}

/** One person, as the site holds them, to copy to the provider. */
export interface ProviderContact {
  email: string
  /** `subscribed`: the site may market to them. `unsubscribed`: it may not, and the list must say so. */
  status: 'subscribed' | 'unsubscribed'
  firstName: string | null
  lastName: string | null
  /** E.164 when known. */
  phone: string | null
  tags: string[]
  lifetimeValueCents: number | null
  ordersCount: number | null
}

/** Where contacts go at the provider. */
export interface ProviderTarget {
  /** The list or audience, for a provider with lists. */
  listId: string | null
  /** A tag every synced contact carries; empty for none. */
  tag: string
}

/** A person the provider would not take, and why, for the log. */
export interface ProviderSkip {
  email: string
  reason: string
}

export interface ProviderPushResult {
  pushed: number
  skipped: ProviderSkip[]
}

/** A person whose consent changed AT the provider. */
export interface ProviderConsentChange {
  email: string
  /** `unsubscribed` they left there; `subscribed` they came back there. */
  status: 'subscribed' | 'unsubscribed'
}

export interface ProviderConsentPage {
  changes: ProviderConsentChange[]
  /** The cursor to store once these changes are applied. */
  cursor: string | null
  /** More changes are waiting after `cursor`. */
  more: boolean
}

/** A commerce fact, in the words every adapter maps to its own event names. */
export type MarketingEventName =
  | 'checkout.started'
  | 'order.paid'
  | 'order.fulfilled'
  | 'order.refunded'
  | 'order.cancelled'

export interface MarketingEventItem {
  productId: string | null
  variantId: string | null
  name: string
  sku: string | null
  quantity: number
  /** Integer cents in the event's currency. */
  unitCents: number
}

export interface MarketingEvent {
  /** Stable across retries: the provider's dedupe key. */
  id: string
  name: MarketingEventName
  email: string
  occurredAtMs: number
  /** ISO 4217, upper case. */
  currency: string
  /** Integer cents: the order's total, the checkout's items, or the refund. */
  valueCents: number
  orderId: string | null
  orderNumber: string | null
  /** Where a checkout can be resumed, for an abandoned-cart message. */
  checkoutUrl: string | null
  items: MarketingEventItem[]
  tracking: { carrier: string | null; number: string | null; url: string | null } | null
}

export interface MarketingProvider {
  id: MarketingProviderId
  /** Checks a credential and reads what the page offers: the account's name and its lists. */
  verify(credential: ProviderCredential): Promise<{
    accountName: string | null
    lists: MarketingProviderList[]
    /** The API root to store with the credential, for a provider that has one per account. */
    apiBase: string | null
  }>
  pushContacts(
    credential: ProviderCredential,
    target: ProviderTarget,
    contacts: readonly ProviderContact[],
  ): Promise<ProviderPushResult>
  /**
   * Consent changes made at the provider after `cursor`, oldest first. A
   * provider whose API cannot list them answers `null` and the sync is
   * one-way for that provider (said so on the page and in the docs).
   */
  pullConsent(
    credential: ProviderCredential,
    target: ProviderTarget,
    cursor: string | null,
  ): Promise<ProviderConsentPage | null>
  /** Sends one event. Absent for a provider that takes none. */
  sendEvent?(credential: ProviderCredential, event: MarketingEvent): Promise<void>
}

export type MarketingProviderFactory = (http: ProviderHttp) => MarketingProvider

/** Splits a display name into the first and last name fields every provider has. */
export function splitName(name: string | null | undefined): { firstName: string | null; lastName: string | null } {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return { firstName: null, lastName: null }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') || null }
}

/** Cents as a decimal amount, for a provider that takes money as a number. */
export const toAmount = (cents: number): number => Math.round(cents) / 100

/** Only a phone a provider will accept: E.164. */
export const e164OrNull = (phone: string | null | undefined): string | null =>
  typeof phone === 'string' && /^\+[1-9]\d{7,14}$/.test(phone.trim()) ? phone.trim() : null
