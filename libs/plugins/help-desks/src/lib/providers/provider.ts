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

import type { HelpDeskProviderId, HelpDeskTarget } from '../model/connections'
import type { HelpDeskOrder } from '../model/orders'
import type { ProviderHttp } from './http'

/**
 * The contract every help desk adapter meets (AGL-3824). The sync engine
 * speaks only this; which vendor is on the other end, how it authenticates
 * and what its payloads look like are each adapter's.
 */

/** A merchant's credential, opened. Lives only for the length of a run. */
export interface HelpDeskCredential {
  /** The account's subdomain at a vendor that hosts one per account (Gorgias domain, Re:amaze brand, Gladly organization). */
  account: string | null
  /** The login a Basic credential pairs with the token (Gorgias, Re:amaze, Gladly). */
  login: string | null
  /** The API key or token. */
  token: string
  /** Richpanel's id for the store, which its order API is addressed by. */
  appClientId: string | null
  /** Richpanel: the support address a ticket from the site is addressed to. */
  supportEmail: string | null
}

/** A buyer, as the site holds them. */
export interface HelpDeskCustomer {
  email: string
  name: string | null
  /** E.164 when known. */
  phone: string | null
}

/** A contact form message, as a new ticket. */
export interface HelpDeskTicket {
  /** Stable across retries: the site's id for the submission. */
  id: string
  email: string
  name: string | null
  subject: string
  /** Plain text: the message first, then the form's other answers. */
  body: string
  submittedAtMs: number
}

export interface HelpDeskVerified {
  /** The account's name at the help desk, when it reports one. */
  accountName: string | null
  /** The choices for the provider's menu: its channels, inboxes or custom objects. */
  targets: HelpDeskTarget[]
}

/** The help desk's id for a buyer, as an adapter hands it back to be remembered. */
export interface HelpDeskCustomerRef {
  remoteId: string
}

export interface HelpDeskProvider {
  id: HelpDeskProviderId
  /** Checks a credential and reads what the card offers. */
  verify(credential: HelpDeskCredential): Promise<HelpDeskVerified>
  /**
   * Adds the buyer, or updates the one the help desk holds. `known` is the
   * id this connection remembered for them; an adapter whose help desk
   * answers that it is gone (merged, deleted) finds or adds them again.
   */
  upsertCustomer(
    credential: HelpDeskCredential,
    customer: HelpDeskCustomer,
    known: string | null,
  ): Promise<HelpDeskCustomerRef>
  /**
   * Sends one order, the buyer already upserted. `recent` is the buyer's
   * latest orders with this one folded in, newest first, for a help desk
   * that keeps a buyer's orders as one block of data.
   */
  pushOrder(
    credential: HelpDeskCredential,
    input: {
      customer: HelpDeskCustomer
      remoteId: string
      order: HelpDeskOrder
      recent: readonly HelpDeskOrder[]
      targetId: string | null
      /** The platform's name, for a help desk that labels where data came from. */
      source: string
    },
  ): Promise<void>
  /** Opens one contact form message as a new ticket, conversation or task. */
  createTicket(
    credential: HelpDeskCredential,
    input: {
      ticket: HelpDeskTicket
      remoteId: string
      targetId: string | null
      source: string
      nowMs: number
    },
  ): Promise<void>
}

export type HelpDeskProviderFactory = (http: ProviderHttp) => HelpDeskProvider

/** Only a phone a help desk will accept: E.164. */
export const e164OrNull = (phone: string | null | undefined): string | null =>
  typeof phone === 'string' && /^\+[1-9]\d{7,14}$/.test(phone.trim()) ? phone.trim() : null

/** Splits a display name into the first and last name fields some help desks keep apart. */
export function splitName(name: string | null | undefined): { firstName: string | null; lastName: string | null } {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return { firstName: null, lastName: null }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') || null }
}

/** Cents as a decimal amount, for a help desk that takes money as a number. */
export const toAmount = (cents: number): number => Math.round(cents) / 100

/** Text made safe to sit inside a help desk's HTML, line breaks kept. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br>')
}
