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
 *      │   │          │                 ▲          │
 *      │   │          ▼                 │          └──► transferred-out
 *      │   └──► transferring-in ────────┘
 *      ▼              │
 *   declined       refunded
 *
 * `charging` holds the name while the card is charged; `registering` holds
 * the registrar's order; `transferring-in` is a name moving here from another
 * registrar (AGL-4040), which can take days; `connecting` is a registered
 * name not yet attached to its site. A failure after the charge always ends
 * in `refunded`, never in a customer paying for a name they do not hold.
 *
 * A name with `hostId: null` belongs to the workspace and serves no site:
 * one bought from the workspace's Domains page, or while the site already
 * had a domain, or transferred in (AGL-4040).
 */

export type DomainRegistrationStatus =
  | 'charging'
  | 'declined'
  | 'registering'
  | 'transferring-in'
  | 'refunded'
  | 'connecting'
  | 'active'
  | 'expired'
  | 'transferred-out'

/** Statuses that hold the name: a second purchase of it is refused. */
export const HOLDING_STATUSES: readonly DomainRegistrationStatus[] = [
  'charging',
  'registering',
  'transferring-in',
  'connecting',
  'active',
]

/** ICANN's registrant contact, as every registrar takes it. */
export interface RegistrantContact {
  firstName: string
  lastName: string
  email: string
  /** E.164, `+1.5125550123` or `+15125550123`. */
  phone: string
  address1: string
  address2?: string
  city: string
  state: string
  zip: string
  /** ISO 3166-1 alpha-2. */
  country: string
  companyName?: string
}

/** How a name came to the workspace. Absent on names bought before AGL-4040. */
export type DomainRegistrationOrigin = 'purchase' | 'transfer-in'

/** What a swap onto a site released, kept until the connect finishes (AGL-4040). */
export interface DomainSwapState {
  /** The site the name is being connected to. */
  hostId: string
  /** The domain that site served before, and its www twin. */
  replaced: string | null
  replacedTwin: string | null
  /** Whether `replaced` is this workspace's registration, tied to that site. */
  replacedOurs: boolean
  /** The site the name served before the move, and its twin there. */
  fromHostId: string | null
  fromServed: boolean
  fromTwin: string | null
  startedAtMs: number
  actor: { uid: string; email: string | null }
}

/** A transfer in from another registrar, while it runs (AGL-4040). */
export interface DomainTransferInState {
  orderId: string
  startedAtMs: number
  /** The registrar's own transfer status as last read, a code. */
  lastStatus?: string | null
  checkedAtMs?: number | null
}

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
  /**
   * The contact change (its `contactChange.updatedAtMs`) the renewal order
   * carried to the registrar (AGL-4040), so a change saved after the order
   * waits for the next one rather than being marked applied.
   */
  contactSentForMs?: number
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
  /** Who the name is registered to, for display. */
  registrant: { name: string; email: string }
  origin?: DomainRegistrationOrigin
  transfer?: DomainTransferInState | null
  /**
   * The full registrant contact the owner entered on the Domains page
   * (AGL-4040). Kept only once an owner edits it, read only by the server
   * (the collection is closed to clients), and sent to the registrar with
   * the next renewal, since the registrar takes no contact change on its own.
   */
  registrantContact?: RegistrantContact | null
  /** Set while {@link registrantContact} waits for the next renewal. */
  contactChange?: { updatedAtMs: number; updatedBy: string } | null
  /** When the registrar last refused a renewal that carried the edited contact. */
  contactRejectedAtMs?: number | null
  /**
   * A move onto a site that is still connecting (AGL-4040): what the swap
   * released, so the sweep can put it back if the connect never finishes.
   */
  pendingSwap?: DomainSwapState | null
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
  registrantName: string
  /** ICANN's registrant email check as last read; null before the first read. */
  contactVerified: boolean | null
  /** When an edited contact was saved, while it waits for the next renewal. */
  contactPendingSinceMs: number | null
  /** When the registrar refused the edited contact, until it is edited again. */
  contactRejectedAtMs: number | null
  origin: DomainRegistrationOrigin
  /** The registrar's transfer status while a transfer in runs. */
  transferStatus: string | null
  transferStartedAtMs: number | null
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
    registrantName: doc.registrant?.name ?? '',
    contactVerified: verification ? verification.verified === true : null,
    contactPendingSinceMs: doc.contactChange?.updatedAtMs ?? null,
    contactRejectedAtMs: doc.contactRejectedAtMs ?? null,
    origin: doc.origin ?? 'purchase',
    transferStatus: doc.status === 'transferring-in' ? (doc.transfer?.lastStatus ?? null) : null,
    transferStartedAtMs: doc.transfer?.startedAtMs ?? null,
  }
}

/**
 * About when the registrar is asked to renew a name: once the renewal is
 * charged, about 30 days before it expires (`RENEWAL_CHARGE_DAYS` in the
 * lifecycle). An edited contact reaches the registrar then. Null when the
 * name will not renew on its own.
 */
export const RENEWAL_LEAD_DAYS = 30

export function nextRenewalAtMs(
  view: Pick<DomainRegistrationView, 'autoRenew' | 'expiresAtMs' | 'status'>,
  nowMs = Date.now(),
): number | null {
  if (view.status !== 'active' || !view.autoRenew || !view.expiresAtMs) return null
  return Math.max(nowMs, view.expiresAtMs - RENEWAL_LEAD_DAYS * 24 * 60 * 60 * 1000)
}
