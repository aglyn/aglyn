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

import type { ReviewPlatform } from '../constants/bundle-common'

/**
 * One site's review platforms as the console sees them (AGL-3699): modes,
 * switches and public identifiers only. A credential goes in through a write
 * and never comes back out; `connected` says one is stored.
 */

/**
 * How Trustpilot hears about an order:
 * - `bcc`: the store's own Trustpilot invitation address is blind-copied on
 *   the buyer's order email — no key, nothing else to set up;
 * - `api`: the Invitations API, with the merchant's own API key and secret;
 * - `off`.
 */
export type TrustpilotMode = 'off' | 'bcc' | 'api'
export const TRUSTPILOT_MODES: readonly TrustpilotMode[] = ['off', 'bcc', 'api']

/**
 * When the invitation goes: once the order first leaves the store (shipped,
 * out for delivery, picked up), or once it is delivered or picked up.
 * Trustpilot's own delay setting still applies on top.
 */
export type InvitationMoment = 'shipped' | 'delivered'
export const INVITATION_MOMENTS: readonly InvitationMoment[] = ['shipped', 'delivered']

export interface ReviewPlatformsSettingsView {
  /**
   * Whether the deployment can keep an API credential. Without it the
   * Trustpilot API mode and Yotpo are not offered; the BCC address always is.
   */
  apiAvailable: boolean
  trustpilot: {
    mode: TrustpilotMode
    sendOn: InvitationMoment
    /** The store's Trustpilot invitation address, `…@invite.trustpilot.com`. */
    bccAddress: string | null
    /** An API key and secret are stored. */
    apiConnected: boolean
    businessUnitId: string | null
    businessUserId: string | null
    /** The invitation's language, e.g. `en-US`. */
    locale: string | null
    /** An invitation template id from the Trustpilot account; empty for its default. */
    templateId: string | null
  }
  yotpo: {
    enabled: boolean
    /** A secret key is stored with the app key. */
    connected: boolean
    /** The Yotpo app key (store id): an identifier, not a secret. */
    appKey: string | null
  }
}

/** A change to one service. Absent fields are left as they are. */
export interface ReviewPlatformsSettingsWrite {
  platform: ReviewPlatform
  /** Trustpilot. */
  mode?: TrustpilotMode
  sendOn?: InvitationMoment
  bccAddress?: string | null
  apiKey?: string
  apiSecret?: string
  businessUnitId?: string | null
  businessUserId?: string | null
  locale?: string | null
  templateId?: string | null
  /** Yotpo. */
  enabled?: boolean
  appKey?: string | null
  secretKey?: string
  /** Drops the stored credential and switches the API path off. */
  disconnect?: boolean
}

export const EMPTY_REVIEW_PLATFORMS_SETTINGS: ReviewPlatformsSettingsView = {
  apiAvailable: false,
  trustpilot: {
    mode: 'off',
    sendOn: 'shipped',
    bccAddress: null,
    apiConnected: false,
    businessUnitId: null,
    businessUserId: null,
    locale: null,
    templateId: null,
  },
  yotpo: { enabled: false, connected: false, appKey: null },
}

/** The domain every Trustpilot invitation address is on. */
/**
 * Trustpilot's invitation mail domain. Held as an origin so the egress sweep
 * (`subprocessor-inventory.spec.ts`, which reads `https://` literals) sees the
 * host the order email is blind-copied to; the egress itself is that email.
 */
export const TRUSTPILOT_INVITE_ORIGIN = 'https://invite.trustpilot.com'
export const TRUSTPILOT_INVITE_DOMAIN = new URL(TRUSTPILOT_INVITE_ORIGIN).hostname

/**
 * A Trustpilot invitation address, lower-cased — `yourshop.com+1a2b3c@invite.trustpilot.com`
 * — or `null` when it is not one. Only Trustpilot's own invitation domain is
 * taken: this address receives a copy of every order email, so a typo or
 * another inbox here would copy buyers' mail to a stranger.
 */
export function normalizeTrustpilotBccAddress(value: unknown): string | null {
  const text = String(value ?? '').trim().toLowerCase()
  if (!text || text.length > 254) return null
  const at = text.lastIndexOf('@')
  if (at <= 0) return null
  const local = text.slice(0, at)
  const domain = text.slice(at + 1)
  if (domain !== TRUSTPILOT_INVITE_DOMAIN) return null
  return /^[a-z0-9._+-]{1,128}$/.test(local) ? text : null
}

/** A Trustpilot business unit or business user id: hex-like, as Trustpilot issues them. */
export function normalizeTrustpilotId(value: unknown): string | null {
  const text = String(value ?? '').trim()
  return /^[A-Za-z0-9]{8,64}$/.test(text) ? text : null
}

/** A locale Trustpilot takes: `en-US`, `da-DK`. */
export function normalizeLocale(value: unknown): string | null {
  const text = String(value ?? '').trim()
  const match = /^([a-zA-Z]{2})[-_]([a-zA-Z]{2})$/.exec(text)
  return match ? `${match[1].toLowerCase()}-${match[2].toUpperCase()}` : null
}

/** A Yotpo app key (store id): letters and digits. */
export function normalizeYotpoAppKey(value: unknown): string | null {
  const text = String(value ?? '').trim()
  return /^[A-Za-z0-9]{10,64}$/.test(text) ? text : null
}

/**
 * The buyer-email moments a BCC invitation rides on. `shipped`: the first
 * email about the order leaving the store; `delivered`: the email saying it
 * arrived or was collected. The buyer email moments are commerce's own
 * names (`order-notifications`), restated, since a plugin never imports
 * another.
 */
export const BCC_MOMENTS: Readonly<Record<InvitationMoment, readonly string[]>> = {
  shipped: ['shipped', 'out_for_delivery', 'picked_up', 'delivered'],
  delivered: ['delivered', 'picked_up'],
}

/** Why an order's buyer was not invited. */
export type InvitationSkipReason = 'test_mode' | 'refunded' | 'cancelled' | 'no_email' | 'no_consent'

export const INVITATION_SKIP_LABELS: Record<InvitationSkipReason, string> = {
  test_mode: 'A test-mode order',
  refunded: 'The order was refunded',
  cancelled: 'The order was canceled',
  no_email: 'The order has no email address',
  no_consent: 'The customer has not agreed to marketing email from this store',
}

/** The order fields an invitation reads, as the seller's public API shapes them. */
export interface InvitationOrder {
  id: string
  number?: number | null
  status?: string | null
  livemode?: boolean
  currency?: string
  customerEmail?: string | null
  customerName?: string | null
  lineItems?: unknown
  totals?: { totalCents?: number | null }
  refundedCents?: number
  disputed?: boolean
  fulfillments?: Array<{ id?: string | null; status?: string; at?: string | null }>
  created?: unknown
}

/** Whether the sale was a rehearsal: the recorded fact, else a test checkout's id. */
export function invitationOrderIsTestMode(order: Pick<InvitationOrder, 'id' | 'livemode'>): boolean {
  if (typeof order.livemode === 'boolean') return !order.livemode
  return /^cs_test_/.test(String(order.id ?? ''))
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Why an order's buyer may not be invited, before consent is asked, or
 * `null` when nothing about the order itself stands in the way: a test-mode
 * sale, a refunded or canceled one, or one with no address.
 */
export function invitationOrderRefusal(order: InvitationOrder): InvitationSkipReason | null {
  if (invitationOrderIsTestMode(order)) return 'test_mode'
  const status = String(order.status ?? '')
  if (status === 'cancelled' || status === 'canceled') return 'cancelled'
  const total = Number(order.totals?.totalCents ?? 0) || 0
  const refunded = Number(order.refundedCents ?? 0) || 0
  if (status === 'refunded' || (total > 0 && refunded >= total)) return 'refunded'
  if (!EMAIL.test(String(order.customerEmail ?? '').trim())) return 'no_email'
  return null
}

/** What each service was asked about one order, as the order widget shows it. */
export interface ReviewPlatformsOrderView {
  trustpilot: InvitationView | null
  yotpo: InvitationView | null
}

export interface InvitationView {
  status: 'sending' | 'sent' | 'skipped' | 'failed'
  via: 'bcc' | 'api' | null
  atMs: number
  reason: InvitationSkipReason | null
  error: string | null
}
