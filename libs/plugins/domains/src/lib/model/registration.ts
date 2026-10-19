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

/*
 * A DOMAIN BOUGHT THROUGH AGLYN, as `domainRegistrations/{domain}` holds it
 * (AGL-3962). The document id IS the name, so two purchases of one name
 * collide on a document rather than on a check.
 *
 * The lifecycle, every step of which the sweep can resume from:
 *
 *   charging ──► registering ──► connecting ──► active ──► expired
 *      │              │                            │
 *      ▼              ▼                            └──► transferred-out
 *   declined       refunded
 *
 * `charging` holds the name while the card is charged; `registering` holds
 * the registrar's order; `connecting` is a registered name not yet attached
 * to its site. A failure after the charge always ends in `refunded`, never in
 * a customer paying for a name they do not hold.
 */

export type DomainRegistrationStatus =
  | 'charging'
  | 'declined'
  | 'registering'
  | 'refunded'
  | 'connecting'
  | 'active'
  | 'expired'
  | 'transferred-out'

/** Statuses that hold the name: a second purchase of it is refused. */
export const HOLDING_STATUSES: readonly DomainRegistrationStatus[] = [
  'charging',
  'registering',
  'connecting',
  'active',
]

/** Where a renewal stands for the CURRENT term (`forExpiresAt`). */
export interface DomainRenewalState {
  /** The expiry this renewal is for; a new term starts a new state. */
  forExpiresAtMs: number
  /** When the renewal notice went out, and the price it named. */
  noticeSentAtMs?: number
  noticedPriceCents?: number
  /** Charging the customer. */
  chargedInvoiceId?: string
  chargedCents?: number
  chargeAttempts?: number
  nextChargeAtMs?: number
  lastChargeError?: string
  /** The registrar order the renewal placed. */
  orderId?: string
  renewedAtMs?: number
  /** Dunning ran out, or the customer turned auto-renew off: let it expire. */
  abandonedAtMs?: number
  abandonedReason?: 'charge-failed' | 'auto-renew-off' | 'disputed'
}

export interface DomainRegistrationEvent {
  atMs: number
  event: string
  detail?: string
}

export interface DomainRegistrationDoc {
  domain: string
  orgId: string
  /** The site the name serves; null once that site is gone or let it go. */
  hostId: string | null
  /** The registrar driver that holds it (`vercel`). */
  registrar: string
  status: DomainRegistrationStatus
  /** Whether WE renew it: charge the customer, then renew at the registrar. */
  autoRenew: boolean
  /** What the customer was charged for the first year, in cents. */
  firstYearCents: number
  /** The renewal price quoted at purchase, in cents. */
  renewalCents: number
  /** The registrar's own prices at purchase, in dollars. Never shown. */
  costUsd: number
  renewalCostUsd: number
  purchaseInvoiceId?: string | null
  /**
   * Every invoice ever charged for the name — the purchase and each renewal —
   * so a dispute on any of them finds the registration by `array-contains`.
   */
  invoiceIds?: string[]
  /** The registrar's order for the first year. */
  orderId?: string | null
  registeredAtMs?: number | null
  expiresAtMs?: number | null
  /** Who the name is registered to, for display; the full contact is not kept. */
  registrant: { name: string; email: string }
  /** ICANN's registrant email check, as last read from the registrar. */
  contactVerification?: {
    verified: boolean
    verifyByMs?: number | null
    email?: string | null
    checkedAtMs: number
    remindersSent?: number
  }
  renewal?: DomainRenewalState | null
  /** Why the registration failed, when it did. A code, never prose. */
  failure?: string | null
  /** A dispute on one of its charges: renewals stop until staff look. */
  disputedAtMs?: number | null
  createdBy: string
  createdAtMs: number
  updatedAtMs: number
  /** The most recent events, newest last, capped. */
  history: DomainRegistrationEvent[]
}

/** How many history rows a registration keeps. */
export const REGISTRATION_HISTORY_CAP = 40

/** Appends an event, keeping the newest {@link REGISTRATION_HISTORY_CAP}. */
export function withEvent(
  history: readonly DomainRegistrationEvent[] | undefined,
  event: DomainRegistrationEvent,
): DomainRegistrationEvent[] {
  return [...(history ?? []), event].slice(-REGISTRATION_HISTORY_CAP)
}

/** What a site's owner sees of a registration — never costs. */
export interface DomainRegistrationView {
  domain: string
  hostId: string | null
  status: DomainRegistrationStatus
  autoRenew: boolean
  renewalCents: number
  expiresAtMs: number | null
  registeredAtMs: number | null
  registrantEmail: string
  /** Set while ICANN's registrant email check is outstanding. */
  verifyByMs: number | null
  verificationEmail: string | null
  /** Set while a renewal charge is failing. */
  renewalFailing: boolean
  failure: string | null
}

export function registrationView(doc: DomainRegistrationDoc): DomainRegistrationView {
  const verification = doc.contactVerification
  return {
    domain: doc.domain,
    hostId: doc.hostId ?? null,
    status: doc.status,
    autoRenew: doc.autoRenew === true,
    renewalCents: doc.renewalCents ?? 0,
    expiresAtMs: doc.expiresAtMs ?? null,
    registeredAtMs: doc.registeredAtMs ?? null,
    registrantEmail: doc.registrant?.email ?? '',
    verifyByMs:
      verification && !verification.verified ? (verification.verifyByMs ?? null) : null,
    verificationEmail:
      verification && !verification.verified ? (verification.email ?? null) : null,
    renewalFailing: Boolean(
      doc.renewal?.lastChargeError && !doc.renewal?.chargedInvoiceId,
    ),
    failure: doc.failure ?? null,
  }
}
