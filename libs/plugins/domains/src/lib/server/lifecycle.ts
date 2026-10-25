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

import { randomBytes } from 'node:crypto'
import { domainRetailCents, domainTransferCents, formatUsdCents } from '../model/pricing'
import {
  HOLDING_STATUSES,
  RENEWAL_LEAD_DAYS,
  withEvent,
  type DomainRegistrationDoc,
  type DomainRenewalState,
  type DomainSwapState,
} from '../model/registration'
import { isOfferedName } from '../model/search-candidates'
import {
  db,
  listByStatus,
  readRegistration,
  registrationRef,
  stripUndefined,
  updateRegistration,
} from './db'
import type { DomainsActor } from './gates'
import { PURCHASE_REFUSAL_COPY } from './purchase-refusals'
import type { RegistrantContact, RegistrarDriver } from './registrar'
import { offerFor } from './search'
import type { DomainChargeResult } from './stripe'

/*
 * THE LIFE OF A BOUGHT DOMAIN, unattended (AGL-3962).
 *
 * Everything that can happen to a name after someone clicks Buy happens
 * here, and every step is one the sweep can pick up again from what the
 * registration document says — so a process that dies between any two lines
 * leaves a state the next pass finishes, never a customer charged for a name
 * they do not hold, and never a name that lapses because nothing looked.
 *
 * The effects are handed in ({@link LifecycleEffects}) rather than imported:
 * the registrar, Stripe, core's connect and release, the emails and the
 * operator alerts. The state machine is then a thing a spec can drive through
 * every branch without a network, and the routes and the sweep share it.
 *
 * ## Renewals, and the two promises they keep
 *
 * 1. **Never more than the notice said.** A notice goes out about
 *    {@link RENEWAL_NOTICE_DAYS} days ahead naming the price; the charge, about
 *    {@link RENEWAL_CHARGE_DAYS} days ahead, takes the LOWER of that price and
 *    today's. If the registrar's price rose in between, we absorb the rise
 *    for that term.
 * 2. **Never a silent lapse.** A declined charge is retried on a schedule
 *    that ends {@link FINAL_ATTEMPT_DAYS} days before expiry, each attempt
 *    emailed; when retries run out, auto-renew is turned off at the registrar
 *    and the owner is told the date the name expires. The registrar's own
 *    auto-renew stays ON while ours is, as a backstop: if this sweep stopped
 *    entirely, the name still renews, and the next pass charges for it.
 */

export const RENEWAL_NOTICE_DAYS = 45
export const RENEWAL_CHARGE_DAYS = RENEWAL_LEAD_DAYS
export const FINAL_ATTEMPT_DAYS = 3
/** Days between renewal charge attempts after a decline. */
export const RETRY_AFTER_DAYS: readonly number[] = [3, 4, 7, 7]
/** A `charging` hold older than this belongs to a request that died. */
export const STALE_CHARGING_MS = 15 * 60 * 1000
/** A registrar order still pending after this is told to staff. */
export const STUCK_ORDER_MS = 24 * 60 * 60 * 1000
/**
 * A transfer in still pending after this is told to staff (AGL-4040). The
 * losing registrar has five days to act and the registry a few more, so two
 * weeks is a transfer that will not finish on its own.
 */
export const STUCK_TRANSFER_MS = 14 * 24 * 60 * 60 * 1000
/**
 * A move onto a site still not connected after this is undone by the sweep
 * (AGL-4040): the site gets its own domain back rather than sitting on its
 * free address while a retryable attach keeps failing.
 */
export const SWAP_CONNECT_WINDOW_MS = 60 * 60 * 1000
/** Registrant-email reminders: days after registration, then before the deadline. */
export const VERIFY_REMINDER_DAYS = [1, 7] as const
export const VERIFY_LAST_REMINDER_DAYS_BEFORE = 3

const DAY_MS = 24 * 60 * 60 * 1000

export type DomainEmailKind =
  | 'purchased'
  | 'refunded'
  | 'verifyRegistrant'
  | 'renewalNotice'
  | 'renewed'
  | 'renewalFailed'
  | 'expiring'
  | 'expired'
  | 'transferCode'
  | 'transferInCompleted'
  | 'transferInFailed'

export type DomainAlertKind =
  | 'orderStuck'
  | 'refundFailed'
  | 'renewalFailedAtRegistrar'
  | 'orphanRegistration'
  | 'renewalUnpaid'
  | 'disputed'
  | 'transferStuck'
  | 'swapRollbackFailed'

export interface LifecycleEffects {
  driver: RegistrarDriver
  now(): number
  charge(request: {
    orgId: string
    amountCents: number
    description: string
    domain: string
    kind: 'domain-purchase' | 'domain-renewal' | 'domain-transfer'
    attemptKey: string
  }): Promise<DomainChargeResult>
  refund(invoiceId: string, reason: string): Promise<{ ok: boolean; refundedCents: number }>
  /**
   * Core's `connectHostCustomDomain`, with its www twin — or, when `twin` is
   * given (null for none), with that one: putting a site's own domain back
   * after a swap that could not finish restores the twin it had (AGL-4040).
   */
  connect(request: {
    hostId: string
    domain: string
    actor: { uid: string; email: string | null }
    twin?: string | null
  }): Promise<{ ok: 'connected' } | { ok: 'refused'; code: string; retryable: boolean }>
  /**
   * Core's `disconnectHostCustomDomain` for a site still showing `domain`.
   * `actor` names the member who asked, for the site's activity; a sweep's
   * release is the system's.
   */
  disconnect(request: {
    hostId: string
    domain: string
    actor?: { uid: string; email: string | null }
  }): Promise<boolean>
  email(
    kind: DomainEmailKind,
    registration: DomainRegistrationDoc,
    merge: Record<string, string>,
  ): Promise<void>
  alert(kind: DomainAlertKind, registration: DomainRegistrationDoc, detail: string): Promise<void>
  /**
   * Core's `consumePurchaseGatePreclearance` (AGL-3955): spends the staff
   * preclearance that stood in for the payment history. True exactly once
   * per id; false (never a throw) for one spent, expired or unknown.
   */
  consumePreclearance(preclearanceId: string): Promise<boolean>
  /** Waits between polls of a fresh order; a spec passes a no-op. */
  sleep(ms: number): Promise<void>
}

/*==========================================
  Purchase
==========================================*/

export type PurchaseOutcome =
  | { ok: 'active' | 'connecting' | 'registering'; registration: DomainRegistrationDoc }
  | {
      ok: 'refused'
      status: number
      code:
        | 'not-offered'
        | 'unavailable'
        | 'needs-extra-contact'
        | 'price-changed'
        | 'taken'
        | 'declined'
        | 'requires-action'
        | 'registration-failed'
        | 'registrar-unavailable'
        | 'no-product'
        | 'no-payment-history'
      error: string
      /** For `price-changed`: what it costs now. */
      firstYearCents?: number
      renewalCents?: number
    }

const CONTACT_FIELDS = ['firstName', 'lastName', 'email', 'phone', 'address1', 'city', 'state', 'zip', 'country'] as const

/** The contact fields that are missing or malformed, by name. */
export function invalidContactFields(contact: Partial<RegistrantContact>): string[] {
  const bad: string[] = []
  for (const field of CONTACT_FIELDS) {
    if (!String(contact[field] ?? '').trim()) bad.push(field)
  }
  if (contact.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) bad.push('email')
  if (contact.phone && !/^\+[1-9]\d{0,2}\.?\d{6,14}$/.test(normalizePhone(contact.phone))) {
    bad.push('phone')
  }
  if (contact.country && !/^[A-Z]{2}$/.test(contact.country.trim().toUpperCase())) bad.push('country')
  return [...new Set(bad)]
}

/** `+1 (512) 555-0123` → `+1.5125550123`, the form registrars take. */
export function normalizePhone(phone: string): string {
  const trimmed = phone.trim()
  const digits = trimmed.replace(/[^\d]/g, '')
  if (!trimmed.startsWith('+')) return `+1.${digits}`
  const country = /^\+1\D/.test(trimmed) || digits.length === 11 ? 1 : null
  if (country === 1 && digits.startsWith('1')) return `+1.${digits.slice(1)}`
  return `+${digits}`
}

export function cleanContact(contact: RegistrantContact): RegistrantContact {
  const text = (value: string | undefined) => String(value ?? '').trim()
  return {
    firstName: text(contact.firstName),
    lastName: text(contact.lastName),
    email: text(contact.email).toLowerCase(),
    phone: normalizePhone(contact.phone),
    address1: text(contact.address1),
    ...(text(contact.address2) ? { address2: text(contact.address2) } : {}),
    city: text(contact.city),
    state: text(contact.state),
    zip: text(contact.zip),
    country: text(contact.country).toUpperCase(),
    ...(text(contact.companyName) ? { companyName: text(contact.companyName) } : {}),
  }
}

const REFUSAL_COPY = {
  'not-offered': 'That name can’t be bought here. Try one of the endings in the results.',
  unavailable: 'That name was just taken. Pick another from the results.',
  'needs-extra-contact':
    'That ending now asks for details we can’t collect here. Pick another ending.',
  'price-changed': 'The price changed a moment ago. Check the new price and buy again.',
  taken: 'That name is already being bought. Pick another.',
  declined:
    'Your card was declined. Update the payment method on the Billing page, then try again.',
  'requires-action':
    'Your bank asked to confirm this payment. Update the payment method on the Billing page to one that can be charged without a confirmation, then try again.',
  'registration-failed':
    'The registrar couldn’t register that name, so nothing was charged or the charge was refunded. Pick another.',
  'registrar-unavailable':
    'The registrar didn’t answer just now. Nothing was charged. Try again in a minute.',
  'no-product': 'Buying domains isn’t set up on this deployment yet.',
  // A preclearance that would not spend leaves the gate it stood in for.
  'no-payment-history': PURCHASE_REFUSAL_COPY['no-payment-history'],
} as const

function refused(
  code: Extract<PurchaseOutcome, { ok: 'refused' }>['code'],
  status: number,
  extra: Partial<Extract<PurchaseOutcome, { ok: 'refused' }>> = {},
): PurchaseOutcome {
  return { ok: 'refused', status, code, error: REFUSAL_COPY[code], ...extra }
}

/**
 * Where a name bought now goes (AGL-4040): to the site that asked, when it
 * has no domain yet; otherwise into the workspace, unassigned, so buying
 * never takes a working address away from a site.
 */
export function purchaseTarget(
  actor: Pick<DomainsActor, 'hostId' | 'host'>,
  forSite: readonly DomainRegistrationDoc[],
): 'site' | 'workspace' {
  if (!actor.hostId) return 'workspace'
  if (String(actor.host?.['cname'] ?? '').trim()) return 'workspace'
  if (forSite.some((registration) => HOLDING_STATUSES.includes(registration.status))) {
    return 'workspace'
  }
  return 'site'
}

/**
 * Buys `domain` for the actor's site or workspace. The caller has run the gate and
 * `purchaseClearance`; this is everything after them, in the order that never
 * leaves money taken for a name not held.
 */
export async function purchaseDomain(
  effects: LifecycleEffects,
  actor: DomainsActor,
  input: {
    domain: string
    expectedFirstYearCents: number
    contact: RegistrantContact
    /**
     * The staff preclearance `purchaseClearance` found standing in for the
     * 72 h payment history (AGL-3955), spent below; absent otherwise.
     */
    preclearanceId?: string | null
    /**
     * Buy the name into the workspace, connected to no site (AGL-4040):
     * from the Domains page, or for a site that already has a domain.
     */
    intoWorkspace?: boolean
  },
): Promise<PurchaseOutcome> {
  const domain = input.domain.trim().toLowerCase()
  if (!isOfferedName(domain)) return refused('not-offered', 400)
  const contact = cleanContact(input.contact)

  // The ending's contact demands, checked on the name itself: an ending that
  // starts asking for more than the standard contact is refused before
  // anyone is charged, not by the registrar after.
  const standard = await effects.driver.standardContact(domain)
  if (standard.ok === 'no') return refused('registrar-unavailable', 503)
  if (!standard.value) return refused('needs-extra-contact', 409)

  // Priced again, now: the search result the person clicked may be minutes
  // old, and `expectedPrice` at the registrar guards only OUR cost.
  const quoted = await effects.driver.search([domain])
  if (quoted.ok === 'no') return refused('registrar-unavailable', 503)
  const quote = quoted.value.find((row) => row.domain === domain)
  const offer = quote ? offerFor(quote) : null
  if (!quote || !offer || !offer.available) return refused('unavailable', 409)
  if (offer.firstYearCents !== input.expectedFirstYearCents) {
    return refused('price-changed', 409, {
      firstYearCents: offer.firstYearCents,
      renewalCents: offer.renewalCents,
    })
  }

  // The hold: the document id IS the name, so a second buyer of it lands on
  // the same document and is refused here, before either is charged.
  const nowMs = effects.now()
  const attemptId = randomBytes(6).toString('hex')
  const ref = registrationRef(domain)
  const held = await db().runTransaction(async (tx) => {
    const existing = await tx.get(ref)
    if (existing.exists) {
      const current = existing.data() as DomainRegistrationDoc
      if (HOLDING_STATUSES.includes(current.status)) return null
    }
    const registration: DomainRegistrationDoc = {
      domain,
      orgId: actor.orgId,
      hostId: input.intoWorkspace ? null : actor.hostId,
      registrar: effects.driver.id,
      origin: 'purchase',
      status: 'charging',
      autoRenew: true,
      firstYearCents: offer.firstYearCents,
      renewalCents: offer.renewalCents,
      costUsd: quote.purchaseUsd,
      renewalCostUsd: quote.renewalUsd,
      purchaseInvoiceId: null,
      invoiceIds: [],
      orderId: null,
      registeredAtMs: null,
      expiresAtMs: null,
      registrant: {
        name: `${contact.firstName} ${contact.lastName}`.trim(),
        email: contact.email,
      },
      renewal: null,
      failure: null,
      disputedAtMs: null,
      createdBy: actor.uid,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      // Another workspace's history is never carried into this one's.
      history: withEvent(
        existing.exists && (existing.data() as DomainRegistrationDoc).orgId === actor.orgId
          ? (existing.data() as DomainRegistrationDoc).history
          : [],
        { atMs: nowMs, event: 'purchase-started', detail: attemptId },
      ),
    }
    tx.set(ref, stripUndefined(registration))
    return registration
  })
  if (!held) return refused('taken', 409)

  // The preclearance, when one stood in for the payment history: spent now,
  // with the name held and nothing charged, so one waiver buys one name and
  // a second purchase racing on the same waiver is refused before its card
  // is touched. A waiver that will not spend is no waiver: the gate refuses
  // as it would have, and the hold is let go as a decline lets it go.
  if (input.preclearanceId) {
    const spent = await effects.consumePreclearance(input.preclearanceId).catch(() => false)
    if (spent !== true) {
      await updateRegistration(
        domain,
        { status: 'declined', failure: 'no-payment-history' },
        { event: 'preclearance-refused' },
      )
      return refused('no-payment-history', 409)
    }
    // Which waiver bought the name, for staff reading its history. The waiver
    // is spent either way, so a failed note never costs the purchase.
    await updateRegistration(domain, {}, { event: 'precleared', detail: input.preclearanceId }).catch(
      () => null,
    )
  }

  // The charge.
  if (offer.firstYearCents > 0) {
    const charged = await effects.charge({
      orgId: actor.orgId,
      amountCents: offer.firstYearCents,
      description: `Domain registration — ${domain}, first year`,
      domain,
      kind: 'domain-purchase',
      attemptKey: `${domain}-${attemptId}`,
    })
    if (!charged.ok) {
      await updateRegistration(
        domain,
        { status: 'declined', failure: charged.code ?? 'declined' },
        { event: 'charge-declined', detail: charged.code ?? undefined },
      )
      if (charged.code === 'no-product') return refused('no-product', 503)
      return refused(charged.code === 'requires-action' ? 'requires-action' : 'declined', 402)
    }
    await updateRegistration(
      domain,
      {
        purchaseInvoiceId: charged.invoiceId,
        invoiceIds: charged.invoiceId ? [charged.invoiceId] : [],
      },
      { event: 'charged', detail: formatUsdCents(charged.paidCents) },
    )
  }

  // The registration itself, at OUR cost as the registrar's price guard. The
  // registrar's auto-renew starts ON as the backstop the module comment
  // describes.
  const bought = await effects.driver.buy({
    domain,
    years: 1,
    expectedPriceUsd: quote.purchaseUsd,
    autoRenew: true,
    contact,
  })
  if (bought.ok === 'no') {
    const registration = (await readRegistration(domain)) ?? held
    // A timeout or a 5xx does not say the order failed — only that its answer
    // did not arrive. Refunding a name the registrar did register would leave
    // the platform holding it unpaid, so the account is asked first.
    if (bought.retryable) {
      const info = await effects.driver.info(domain)
      if (info.ok === 'yes' && info.value.owned) {
        const registered = await markRegistered(effects, registration, info.value)
        return { ok: registered.status === 'active' ? 'active' : 'connecting', registration: registered }
      }
    }
    await refundAndClose(effects, registration, `buy-${bought.code}`)
    return refused(bought.retryable ? 'registrar-unavailable' : 'registration-failed', 409)
  }
  await updateRegistration(
    domain,
    { status: 'registering', orderId: bought.value.orderId },
    { event: 'ordered', detail: bought.value.orderId },
  )

  // Most orders complete in seconds; wait a little so the common case reads
  // "connected" on the same click, and leave the rest to the sweep.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await effects.sleep(2000)
    const registration = await readRegistration(domain)
    if (!registration) break
    const advanced = await advanceRegistering(effects, registration)
    if (advanced.status !== 'registering') {
      return advanced.status === 'refunded'
        ? refused('registration-failed', 409)
        : { ok: advanced.status === 'active' ? 'active' : 'connecting', registration: advanced }
    }
  }
  const latest = (await readRegistration(domain)) ?? held
  return { ok: 'registering', registration: latest }
}

/** Refunds whatever was charged for the purchase and marks it refunded. */
async function refundAndClose(
  effects: LifecycleEffects,
  registration: DomainRegistrationDoc,
  reason: string,
  tell: { kind: DomainEmailKind; failure: string } = {
    kind: 'refunded',
    failure: failureSentence(reason),
  },
): Promise<DomainRegistrationDoc> {
  let refundedCents = 0
  if (registration.purchaseInvoiceId) {
    const refund = await effects.refund(registration.purchaseInvoiceId, reason)
    if (!refund.ok) {
      // The money is still taken: staff are told now, and the registration
      // stays where the next pass retries the refund rather than claiming one.
      await effects.alert('refundFailed', registration, reason)
      const kept = await updateRegistration(
        registration.domain,
        { failure: `refund-failed:${reason}` },
        { event: 'refund-failed', detail: reason },
      )
      return kept ?? registration
    }
    refundedCents = refund.refundedCents
  }
  const closed =
    (await updateRegistration(
      registration.domain,
      { status: 'refunded', failure: reason },
      { event: 'refunded', detail: formatUsdCents(refundedCents) },
    )) ?? registration
  const charged = refundedCents || (registration.purchaseInvoiceId ? registration.firstYearCents : 0)
  await effects.email(tell.kind, closed, {
    'domain.refund': charged
      ? `We refunded ${formatUsdCents(charged)} to the card it was charged to. A refund usually reaches the card within 5 to 10 business days.`
      : 'You were not charged for it.',
    'domain.failure': tell.failure,
  })
  return closed
}

/** A registrar's refusal code, as the sentence the refund email opens with. */
export function failureSentence(reason: string): string {
  if (/unavailable|not_available|taken|already/i.test(reason)) {
    return 'Someone else registered it a moment before your order reached the registrar.'
  }
  if (/price/i.test(reason)) {
    return 'The registrar changed its price for it before the order went through.'
  }
  if (/contact|invalid/i.test(reason)) {
    return 'The registrar did not accept the contact details on the order.'
  }
  return 'The registrar could not complete the registration.'
}

/*==========================================
  Finishing an order, and connecting
==========================================*/

/** Reads the order and moves a `registering` name on. */
export async function advanceRegistering(
  effects: LifecycleEffects,
  registration: DomainRegistrationDoc,
): Promise<DomainRegistrationDoc> {
  if (registration.status !== 'registering' || !registration.orderId) return registration
  const order = await effects.driver.order(registration.orderId)
  if (order.ok === 'no') return registration
  if (order.value.status === 'failed') {
    return refundAndClose(effects, registration, `order-${order.value.failure ?? 'failed'}`)
  }
  if (order.value.status === 'pending') {
    if (effects.now() - registration.updatedAtMs > STUCK_ORDER_MS) {
      await effects.alert('orderStuck', registration, registration.orderId)
    }
    return registration
  }
  const info = await effects.driver.info(registration.domain)
  return markRegistered(effects, registration, info.ok === 'yes' ? info.value : null)
}

/** Records the registration, tells the owner, and connects the site. */
async function markRegistered(
  effects: LifecycleEffects,
  registration: DomainRegistrationDoc,
  info: { registeredAtMs: number | null; expiresAtMs: number | null } | null,
): Promise<DomainRegistrationDoc> {
  const nowMs = effects.now()
  const registered =
    (await updateRegistration(
      registration.domain,
      {
        status: 'connecting',
        registeredAtMs: info?.registeredAtMs ?? nowMs,
        expiresAtMs: info?.expiresAtMs ?? nowMs + 365 * DAY_MS,
        renewal: null,
      },
      { event: 'registered' },
    )) ?? registration
  await effects.email('purchased', registered, purchasedMerge(registered))
  return advanceConnecting(effects, registered)
}

export function purchasedMerge(registration: DomainRegistrationDoc): Record<string, string> {
  return {
    // Bought for a site, or into the workspace with no site yet (AGL-4040).
    'domain.whereLine': registration.hostId
      ? 'It is being connected to {site}. It usually serves within a few minutes, with its security certificate set up for you. There are no DNS records to add.'
      : 'It is in your workspace’s domains and not connected to a site yet. Connect it to any of your sites from the Domains page whenever you are ready.',
    'domain.firstYear': formatUsdCents(registration.firstYearCents),
    'domain.renewalPrice': formatUsdCents(registration.renewalCents),
    'domain.renewsOn': formatDate(registration.expiresAtMs),
    'domain.registrant': registration.registrant?.name ?? '',
    'domain.registrantEmail': registration.registrant?.email ?? '',
  }
}

/** Connects a registered name to its site, retrying what can be retried. */
export async function advanceConnecting(
  effects: LifecycleEffects,
  registration: DomainRegistrationDoc,
): Promise<DomainRegistrationDoc> {
  if (registration.status !== 'connecting') return registration
  if (!registration.hostId) {
    return (
      (await updateRegistration(
        registration.domain,
        { status: 'active' },
        { event: 'registered-without-site' },
      )) ?? registration
    )
  }
  const connected = await effects.connect({
    hostId: registration.hostId,
    domain: registration.domain,
    actor: { uid: registration.createdBy, email: registration.registrant?.email ?? null },
  })
  if (connected.ok === 'connected') {
    return (
      (await updateRegistration(
        registration.domain,
        { status: 'active', failure: null, pendingSwap: null },
        { event: 'connected' },
      )) ?? registration
    )
  }
  if (connected.retryable) {
    await updateRegistration(
      registration.domain,
      { failure: `connect-${connected.code}` },
      { event: 'connect-retry', detail: connected.code },
    )
    return registration
  }
  // The site took another domain, or is gone: the name stays the owner's,
  // shown on the page with a way to connect it.
  return (
    (await updateRegistration(
      registration.domain,
      {
        status: 'active',
        failure: `connect-${connected.code}`,
        ...(connected.code === 'unknown-site' ? { hostId: null } : {}),
      },
      { event: 'connect-refused', detail: connected.code },
    )) ?? registration
  )
}

/*==========================================
  An active name: verification, renewal, expiry
==========================================*/

export function formatDate(ms: number | null | undefined): string {
  if (!ms) return ''
  return new Date(ms).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** ICANN's registrant check: read it, and remind on the schedule. */
export async function advanceVerification(
  effects: LifecycleEffects,
  registration: DomainRegistrationDoc,
): Promise<DomainRegistrationDoc> {
  if (registration.contactVerification?.verified) return registration
  const nowMs = effects.now()
  const read = await effects.driver.contactVerification(registration.domain)
  if (read.ok === 'no') return registration
  const reminders = registration.contactVerification?.remindersSent ?? 0
  const base = {
    verified: read.value.verified,
    verifyByMs: read.value.verifyByMs,
    email: read.value.email,
    checkedAtMs: nowMs,
    remindersSent: reminders,
  }
  if (read.value.verified) {
    return (
      (await updateRegistration(
        registration.domain,
        { contactVerification: base },
        { event: 'registrant-verified' },
      )) ?? registration
    )
  }
  const registeredMs = registration.registeredAtMs ?? registration.createdAtMs
  const dueAt = [
    ...VERIFY_REMINDER_DAYS.map((days) => registeredMs + days * DAY_MS),
    ...(read.value.verifyByMs
      ? [read.value.verifyByMs - VERIFY_LAST_REMINDER_DAYS_BEFORE * DAY_MS]
      : []),
  ]
  const due = reminders < dueAt.length && nowMs >= (dueAt[reminders] ?? Infinity)
  const next =
    (await updateRegistration(registration.domain, {
      contactVerification: { ...base, remindersSent: due ? reminders + 1 : reminders },
    })) ?? registration
  if (due) {
    await effects.email('verifyRegistrant', next, {
      'domain.registrantEmail': read.value.email ?? registration.registrant?.email ?? '',
      'domain.verifyBy': formatDate(read.value.verifyByMs),
    })
  }
  return next
}

function renewalFor(registration: DomainRegistrationDoc): DomainRenewalState {
  const expiresAtMs = registration.expiresAtMs ?? 0
  return registration.renewal && registration.renewal.forExpiresAtMs === expiresAtMs
    ? registration.renewal
    : { forExpiresAtMs: expiresAtMs }
}

/** The registrar's auto-renew should be on exactly while ours will pay for it. */
export function registrarShouldAutoRenew(registration: DomainRegistrationDoc): boolean {
  const renewal = renewalFor(registration)
  return registration.autoRenew && !registration.disputedAtMs && !renewal.abandonedAtMs
}

/**
 * One pass over an active name's renewal. `force` charges now whatever the
 * calendar says — the owner's Renew now.
 */
export async function advanceRenewal(
  effects: LifecycleEffects,
  registration: DomainRegistrationDoc,
  options: { force?: boolean } = {},
): Promise<DomainRegistrationDoc> {
  if (registration.status !== 'active' && !(options.force && registration.status === 'expired')) {
    return registration
  }
  const nowMs = effects.now()
  const expiresAtMs = registration.expiresAtMs ?? 0
  if (!expiresAtMs) return registration
  const daysLeft = (expiresAtMs - nowMs) / DAY_MS
  let renewal = renewalFor(registration)
  const save = async (patch: Partial<DomainRenewalState>, event?: string, detail?: string) => {
    renewal = { ...renewal, ...patch }
    const next = await updateRegistration(
      registration.domain,
      { renewal },
      event ? { event, ...(detail ? { detail } : {}) } : undefined,
    )
    if (next) registration = next
  }

  if (registration.disputedAtMs && !options.force) return registration

  if (!registration.autoRenew && !options.force) {
    if (daysLeft <= RENEWAL_CHARGE_DAYS && !renewal.abandonedAtMs) {
      await save({ abandonedAtMs: nowMs, abandonedReason: 'auto-renew-off' }, 'renewal-skipped')
      await effects.email('expiring', registration, {
        'domain.expiresOn': formatDate(expiresAtMs),
        'domain.expiryReason': 'Auto-renew is turned off for it.',
      })
    }
    return registration
  }

  // The notice, with the price it promises.
  if (!renewal.noticeSentAtMs && (daysLeft <= RENEWAL_NOTICE_DAYS || options.force)) {
    const price = await effects.driver.renewalPrice(registration.domain)
    const noticed =
      price.ok === 'yes' ? domainRetailCents(price.value) : registration.renewalCents
    await save({ noticeSentAtMs: nowMs, noticedPriceCents: noticed }, 'renewal-noticed', formatUsdCents(noticed))
    if (!options.force) {
      await effects.email('renewalNotice', registration, {
        'domain.renewalPrice': formatUsdCents(noticed),
        'domain.renewsOn': formatDate(expiresAtMs),
        'domain.chargeOn': formatDate(expiresAtMs - RENEWAL_CHARGE_DAYS * DAY_MS),
      })
      return registration
    }
  }

  // The charge.
  const chargeDue =
    options.force ||
    (daysLeft <= RENEWAL_CHARGE_DAYS && nowMs >= (renewal.nextChargeAtMs ?? 0))
  if (!renewal.chargedInvoiceId && !renewal.abandonedAtMs && chargeDue) {
    const price = await effects.driver.renewalPrice(registration.domain)
    if (price.ok === 'no') return registration
    const today = domainRetailCents(price.value)
    const amountCents = Math.min(today, renewal.noticedPriceCents ?? today)
    const attempts = (renewal.chargeAttempts ?? 0) + 1
    const charged = await effects.charge({
      orgId: registration.orgId,
      amountCents,
      description: `Domain renewal — ${registration.domain}, one year`,
      domain: registration.domain,
      kind: 'domain-renewal',
      attemptKey: `${registration.domain}-${expiresAtMs}-${attempts}`,
    })
    if (!charged.ok) {
      const wait = RETRY_AFTER_DAYS[attempts - 1]
      const nextChargeAtMs = wait === undefined ? null : nowMs + wait * DAY_MS
      const outOfTime =
        nextChargeAtMs === null || nextChargeAtMs > expiresAtMs - FINAL_ATTEMPT_DAYS * DAY_MS
      if (outOfTime && !options.force) {
        await save(
          {
            chargeAttempts: attempts,
            lastChargeError: charged.code ?? 'declined',
            abandonedAtMs: nowMs,
            abandonedReason: 'charge-failed',
          },
          'renewal-abandoned',
          charged.code ?? undefined,
        )
        await effects.driver.setAutoRenew(registration.domain, false)
        await effects.email('expiring', registration, {
          'domain.expiresOn': formatDate(expiresAtMs),
          'domain.expiryReason': 'Its renewal could not be charged to the card on file.',
        })
        return registration
      }
      await save(
        {
          chargeAttempts: attempts,
          lastChargeError: charged.code ?? 'declined',
          nextChargeAtMs: nextChargeAtMs ?? nowMs + DAY_MS,
        },
        'renewal-declined',
        charged.code ?? undefined,
      )
      await effects.email('renewalFailed', registration, {
        'domain.renewalPrice': formatUsdCents(amountCents),
        'domain.nextAttempt': formatDate(nextChargeAtMs ?? nowMs + DAY_MS),
        'domain.expiresOn': formatDate(expiresAtMs),
      })
      return registration
    }
    await save(
      { chargeAttempts: attempts, chargedInvoiceId: charged.invoiceId ?? 'paid', chargedCents: charged.paidCents, lastChargeError: undefined },
      'renewal-charged',
      formatUsdCents(charged.paidCents),
    )
    if (charged.invoiceId) {
      await updateRegistration(registration.domain, {
        invoiceIds: [...(registration.invoiceIds ?? []), charged.invoiceId],
      })
    }
  }

  // The renewal at the registrar, once paid for.
  if (renewal.chargedInvoiceId && !renewal.orderId) {
    const price = await effects.driver.renewalPrice(registration.domain)
    if (price.ok === 'no') return registration
    // An edited registrant contact rides the renewal: the registrar takes a
    // contact change on no other call (AGL-4040).
    const contactChange = registration.registrantContact ? registration.contactChange : null
    const renewed = await effects.driver.renew({
      domain: registration.domain,
      years: 1,
      expectedPriceUsd: price.value,
      ...(contactChange && registration.registrantContact
        ? { contact: registration.registrantContact }
        : {}),
    })
    let order = renewed
    let contactSent = Boolean(contactChange)
    if (order.ok === 'no' && !order.retryable && contactChange) {
      // A contact edit is never why a name lapses. Whatever the refusal
      // said, the renewal is tried once more WITHOUT the contact: if that
      // one goes through, the contact was the problem, and the owner is
      // shown it was not accepted. If it fails too, the contact was not the
      // reason, and the edit stays waiting for the next renewal.
      const plain = await effects.driver.renew({
        domain: registration.domain,
        years: 1,
        expectedPriceUsd: price.value,
      })
      if (plain.ok === 'yes') {
        const next = await updateRegistration(
          registration.domain,
          { contactChange: null, contactRejectedAtMs: nowMs },
          { event: 'contact-refused', detail: order.code },
        )
        if (next) registration = next
        order = plain
        contactSent = false
      } else if (plain.retryable) {
        return registration
      }
    }
    if (order.ok === 'no') {
      if (order.retryable) return registration
      await failPaidRenewal(effects, registration, renewal, `renew-${order.code}`)
      return (await readRegistration(registration.domain)) ?? registration
    }
    await save(
      {
        orderId: order.value.orderId,
        ...(contactSent && contactChange ? { contactSentForMs: contactChange.updatedAtMs } : {}),
      },
      'renewal-ordered',
      order.value.orderId,
    )
  }

  if (renewal.orderId && !renewal.renewedAtMs) {
    const order = await effects.driver.order(renewal.orderId)
    if (order.ok === 'no' || order.value.status === 'pending') return registration
    if (order.value.status === 'failed') {
      await failPaidRenewal(effects, registration, renewal, `order-${order.value.failure ?? 'failed'}`)
      return (await readRegistration(registration.domain)) ?? registration
    }
    const info = await effects.driver.info(registration.domain)
    const newExpiry =
      info.ok === 'yes' && info.value.expiresAtMs && info.value.expiresAtMs > expiresAtMs
        ? info.value.expiresAtMs
        : expiresAtMs + 365 * DAY_MS
    const wasExpired = registration.status === 'expired'
    // The contact this order carried is now the registrar's; a change saved
    // after the order went out waits for the next renewal.
    const applied =
      renewal.contactSentForMs !== undefined &&
      registration.contactChange?.updatedAtMs === renewal.contactSentForMs &&
      registration.registrantContact
        ? registration.registrantContact
        : null
    const next = await updateRegistration(
      registration.domain,
      {
        status: 'active',
        expiresAtMs: newExpiry,
        renewalCents: renewal.chargedCents ?? registration.renewalCents,
        renewal: { forExpiresAtMs: newExpiry, renewedAtMs: nowMs },
        ...(applied
          ? {
              contactChange: null,
              contactRejectedAtMs: null,
              registrant: {
                name: `${applied.firstName} ${applied.lastName}`.trim(),
                email: applied.email,
              },
            }
          : {}),
      },
      { event: 'renewed', detail: formatDate(newExpiry) },
    )
    if (next) registration = next
    await effects.email('renewed', registration, {
      'domain.amount': formatUsdCents(renewal.chargedCents ?? 0),
      'domain.expiresOn': formatDate(newExpiry),
    })
    // A name renewed back from expiry goes back on its site.
    if (wasExpired && registration.hostId) {
      registration =
        (await updateRegistration(registration.domain, { status: 'connecting' })) ?? registration
      registration = await advanceConnecting(effects, registration)
    }
  }
  return registration
}

/** A renewal paid for that the registrar would not make: refund, and tell staff. */
async function failPaidRenewal(
  effects: LifecycleEffects,
  registration: DomainRegistrationDoc,
  renewal: DomainRenewalState,
  reason: string,
): Promise<void> {
  await effects.alert('renewalFailedAtRegistrar', registration, reason)
  const invoiceId = renewal.chargedInvoiceId
  const refund = invoiceId && invoiceId !== 'paid' ? await effects.refund(invoiceId, reason) : { ok: true, refundedCents: 0 }
  if (!refund.ok) await effects.alert('refundFailed', registration, reason)
  await updateRegistration(
    registration.domain,
    {
      renewal: {
        forExpiresAtMs: renewal.forExpiresAtMs,
        noticeSentAtMs: renewal.noticeSentAtMs,
        noticedPriceCents: renewal.noticedPriceCents,
        chargeAttempts: renewal.chargeAttempts,
        // Tried again on the next pass with a fresh charge: the refund
        // returned this one, and the name is still worth keeping.
        nextChargeAtMs: effects.now() + DAY_MS,
      },
    },
    { event: 'renewal-refunded', detail: reason },
  )
}

/**
 * The registrar's view, reconciled: a name renewed by the registrar's own
 * backstop is charged for, a name that moved away is recorded, a name past
 * its expiry is expired and its site given back its free address, and the
 * registrar's auto-renew is kept where ours says it should be.
 */
export async function reconcileWithRegistrar(
  effects: LifecycleEffects,
  registration: DomainRegistrationDoc,
): Promise<DomainRegistrationDoc> {
  if (registration.status !== 'active') return registration
  const info = await effects.driver.info(registration.domain)
  if (info.ok === 'no') return registration
  const nowMs = effects.now()
  if (!info.value.owned) {
    // A name we registered that is no longer in our account went to another
    // registrar. Its site keeps the name connected: DNS is now the owner's.
    return (
      (await updateRegistration(
        registration.domain,
        { status: 'transferred-out' },
        { event: 'transferred-out' },
      )) ?? registration
    )
  }
  const recorded = registration.expiresAtMs ?? 0
  if (info.value.expiresAtMs && info.value.expiresAtMs > recorded + DAY_MS) {
    const renewal = renewalFor(registration)
    const next = await updateRegistration(
      registration.domain,
      {
        expiresAtMs: info.value.expiresAtMs,
        renewal: { forExpiresAtMs: info.value.expiresAtMs },
      },
      { event: 'renewed-by-registrar', detail: formatDate(info.value.expiresAtMs) },
    )
    if (next) registration = next
    if (!renewal.chargedInvoiceId) {
      // The backstop renewed a term we never charged for: charge it now, at
      // what the owner was told, and tell staff if the card refuses.
      const amountCents = renewal.noticedPriceCents ?? registration.renewalCents
      const charged = await effects.charge({
        orgId: registration.orgId,
        amountCents,
        description: `Domain renewal — ${registration.domain}, one year`,
        domain: registration.domain,
        kind: 'domain-renewal',
        attemptKey: `${registration.domain}-${recorded}-backstop`,
      })
      if (!charged.ok) await effects.alert('renewalUnpaid', registration, charged.code ?? 'declined')
    }
    return registration
  }
  if (recorded && nowMs > recorded + DAY_MS) {
    const expired =
      (await updateRegistration(registration.domain, { status: 'expired' }, { event: 'expired' })) ??
      registration
    if (registration.hostId) {
      await effects.disconnect({ hostId: registration.hostId, domain: registration.domain })
    }
    await effects.email('expired', expired, {})
    return expired
  }
  const shouldRenew = registrarShouldAutoRenew(registration)
  if (info.value.autoRenew !== null && info.value.autoRenew !== shouldRenew) {
    await effects.driver.setAutoRenew(registration.domain, shouldRenew)
  }
  return registration
}

/*==========================================
  The sweep
==========================================*/

export interface SweepReport {
  [key: string]: number | boolean | string | null
  configured: boolean
  charging: number
  registering: number
  transferringIn: number
  connecting: number
  active: number
  orphansFound: number
}

/** Registrations walked per status per tick: bounded time and API calls. */
export const SWEEP_BATCH = 100

/** The day's reconcile runs in the tick that lands in this UTC window. */
export const ORPHAN_RECONCILE_HOUR_UTC = 3

/**
 * Names bought before this were bought by hand, never through the plugin,
 * and the orphan reconcile leaves them alone.
 */
export const DOMAINS_LAUNCHED_AT_MS = Date.parse('2026-10-19T00:00:00Z')

export async function runDomainsSweep(
  effects: LifecycleEffects,
  context: { nowMs: number; deadlineMs: number },
): Promise<SweepReport> {
  const report: SweepReport = {
    configured: effects.driver.configured(),
    charging: 0,
    registering: 0,
    transferringIn: 0,
    connecting: 0,
    active: 0,
    orphansFound: 0,
  }
  if (!report.configured) return report
  const timeLeft = () => Date.now() < context.deadlineMs

  for (const registration of await listByStatus('charging', SWEEP_BATCH)) {
    if (!timeLeft()) return report
    if (context.nowMs - registration.updatedAtMs < STALE_CHARGING_MS) continue
    report.charging += 1
    // A purchase whose request died between the charge and the order. The
    // registrant contact was never kept, so it cannot be completed — only
    // given back.
    if (registration.purchaseInvoiceId) {
      await refundAndClose(
        effects,
        registration,
        'interrupted',
        registration.origin === 'transfer-in'
          ? { kind: 'transferInFailed', failure: transferFailureSentence('interrupted') }
          : undefined,
      )
    } else {
      await updateRegistration(
        registration.domain,
        { status: 'declined', failure: 'interrupted' },
        { event: 'abandoned' },
      )
    }
  }
  for (const registration of await listByStatus('registering', SWEEP_BATCH)) {
    if (!timeLeft()) return report
    report.registering += 1
    await advanceRegistering(effects, registration)
  }
  for (const registration of await listByStatus('transferring-in', SWEEP_BATCH)) {
    if (!timeLeft()) return report
    report.transferringIn += 1
    await advanceTransferIn(effects, registration)
  }
  for (const registration of await listByStatus('connecting', SWEEP_BATCH)) {
    if (!timeLeft()) return report
    report.connecting += 1
    const advanced = await advanceConnecting(effects, registration)
    const swap = advanced.pendingSwap
    if (
      advanced.status === 'connecting' &&
      swap &&
      context.nowMs - swap.startedAtMs > SWAP_CONNECT_WINDOW_MS
    ) {
      await rollBackSwap(effects, (await readRegistration(advanced.domain)) ?? advanced, swap, 'timed-out')
    }
  }
  for (const registration of await listByStatus('active', SWEEP_BATCH)) {
    if (!timeLeft()) return report
    report.active += 1
    let current = await advanceVerification(effects, registration)
    current = await reconcileWithRegistrar(effects, current)
    await advanceRenewal(effects, current)
  }
  if (new Date(context.nowMs).getUTCHours() === ORPHAN_RECONCILE_HOUR_UTC &&
      new Date(context.nowMs).getUTCMinutes() < 15) {
    report.orphansFound = await reconcileOrphans(effects)
  }
  return report
}

/**
 * Names in our registrar account that no registration accounts for — a
 * workspace erased while it held one, or bookkeeping that drifted. Their
 * auto-renew is turned off, so the platform never pays to keep a name nobody
 * is paying for, and staff are told.
 */
export async function reconcileOrphans(effects: LifecycleEffects): Promise<number> {
  const owned = await effects.driver.listOwned()
  if (owned.ok === 'no') return 0
  let found = 0
  for (const name of owned.value) {
    if (!name.boughtAtMs || name.boughtAtMs < DOMAINS_LAUNCHED_AT_MS) continue
    const registration = await readRegistration(name.domain)
    if (registration && HOLDING_STATUSES.includes(registration.status)) continue
    if (registration?.status === 'expired' || registration?.status === 'transferred-out') continue
    found += 1
    if (name.autoRenew !== false) await effects.driver.setAutoRenew(name.domain, false)
    await effects.alert(
      'orphanRegistration',
      registration ?? ({ domain: name.domain, orgId: '', hostId: null } as unknown as DomainRegistrationDoc),
      name.domain,
    )
  }
  return found
}

/*==========================================
  Transfer in (AGL-4040)
==========================================*/

export type TransferInOutcome =
  | { ok: 'transferring'; registration: DomainRegistrationDoc }
  | {
      ok: 'refused'
      status: number
      code:
        | 'not-offered'
        | 'needs-extra-contact'
        | 'price-changed'
        | 'taken'
        | 'declined'
        | 'requires-action'
        | 'no-product'
        | 'no-payment-history'
        | 'registrar-unavailable'
        | 'already-here'
        | 'renew-instead'
        | 'dnssec'
        | 'not-transferable'
        | 'transfer-refused'
      error: string
      /** For `price-changed`: what it costs now. */
      priceCents?: number
    }

/** A workspace's own expired name is renewed back, never transferred in. */
export const RENEW_INSTEAD =
  'That domain is already yours here and has expired. Open it on the Domains page and press Renew now to keep it.'

const TRANSFER_COPY: Record<Extract<TransferInOutcome, { ok: 'refused' }>['code'], string> = {
  'not-offered': 'That name can’t be moved here. Only the endings we sell can be transferred in.',
  'needs-extra-contact':
    'That ending asks for details we can’t collect here, so it can’t be moved here.',
  'price-changed': 'The price changed a moment ago. Check the new price and try again.',
  taken: 'That domain is already in your workspace or on its way here.',
  declined: REFUSAL_COPY.declined,
  'requires-action': REFUSAL_COPY['requires-action'],
  'no-product': REFUSAL_COPY['no-product'],
  'no-payment-history': REFUSAL_COPY['no-payment-history'],
  'registrar-unavailable':
    'The registrar didn’t answer just now. Nothing was charged. Try again in a minute.',
  'already-here':
    'That domain is already in an account at our registrar, so it can’t be transferred in. Contact support with the domain name.',
  'renew-instead': RENEW_INSTEAD,
  dnssec:
    'DNSSEC is turned on for that domain. Turn it off at your current registrar, wait a day, then try again.',
  'not-transferable':
    'The registrar can’t take that domain right now. Domains registered or moved in the last 60 days can’t move yet.',
  'transfer-refused':
    'The registrar didn’t accept the transfer. Check that the domain is unlocked at your current registrar and that the transfer code is the latest one, then try again.',
}

function transferRefused(
  code: Extract<TransferInOutcome, { ok: 'refused' }>['code'],
  status: number,
  extra: { priceCents?: number; refund?: 'refunded' | 'pending' } = {},
): TransferInOutcome {
  const { refund, ...rest } = extra
  // A refusal after the charge says what became of the money, and only what
  // is true: a refund Stripe would not make yet is still on its way.
  const suffix =
    refund === 'refunded'
      ? ' The charge was refunded.'
      : refund === 'pending'
        ? ' The charge is being refunded, and we’ll email you when it’s done.'
        : ''
  return { ok: 'refused', status, code, error: `${TRANSFER_COPY[code]}${suffix}`, ...rest }
}

/** The registrar's refusal of a transfer, as the outcome the page names. */
function transferRefusalCode(code: string): Extract<TransferInOutcome, { ok: 'refused' }>['code'] {
  if (code === 'domain_already_owned') return 'already-here'
  if (code === 'dnssec_enabled') return 'dnssec'
  if (code === 'expected_price_mismatch') return 'price-changed'
  if (code === 'domain_not_available' || code === 'tld_not_supported' || code === 'domain_too_short') {
    return 'not-transferable'
  }
  return 'transfer-refused'
}

/** Why a transfer did not finish, as the sentence its email opens with. */
export function transferFailureSentence(state: string): string {
  if (state === 'rejected') {
    return 'Your current registrar declined to release it. That usually means the domain was still locked there, or the transfer was turned down from its approval email.'
  }
  if (state === 'canceled' || state === 'canceled_pending_refund') {
    return 'The transfer was canceled before it finished, so the domain stayed at your current registrar.'
  }
  if (state === 'interrupted') {
    return 'The transfer could not be started, so the domain stayed at your current registrar.'
  }
  if (state === 'unconfirmed') {
    return 'The registrar never confirmed the transfer, and the domain did not arrive, so it stayed at your current registrar.'
  }
  return 'The registrar could not complete the transfer, so the domain stayed at your current registrar.'
}

/**
 * The price to move `domain` here, in cents: the renewal formula on the
 * registrar's transfer price (AGL-4040). Never throws.
 */
export async function transferInQuote(
  driver: RegistrarDriver,
  domain: string,
): Promise<
  | { ok: 'yes'; priceCents: number; renewalCents: number; costUsd: number; renewalCostUsd: number }
  | { ok: 'no'; code: 'not-offered' | 'needs-extra-contact' | 'registrar-unavailable' | 'already-here' }
> {
  const name = domain.trim().toLowerCase()
  if (!isOfferedName(name)) return { ok: 'no', code: 'not-offered' }
  // A name already in our registrar account is no transfer: it is held
  // here, by this workspace or another one.
  const held = await driver.info(name)
  if (held.ok === 'no') return { ok: 'no', code: 'registrar-unavailable' }
  if (held.value.owned) return { ok: 'no', code: 'already-here' }
  const standard = await driver.standardContact(name)
  if (standard.ok === 'no') return { ok: 'no', code: 'registrar-unavailable' }
  if (!standard.value) return { ok: 'no', code: 'needs-extra-contact' }
  const [transfer, renewal] = await Promise.all([
    driver.transferPrice(name),
    driver.renewalPrice(name),
  ])
  if (transfer.ok === 'no') {
    return { ok: 'no', code: transfer.retryable ? 'registrar-unavailable' : 'not-offered' }
  }
  const renewalCostUsd = renewal.ok === 'yes' ? renewal.value : transfer.value
  return {
    ok: 'yes',
    priceCents: domainTransferCents(transfer.value),
    renewalCents: domainRetailCents(renewalCostUsd),
    costUsd: transfer.value,
    renewalCostUsd,
  }
}

/**
 * Moves `domain` here from another registrar, into the workspace (AGL-4040).
 * The caller has run the gate and `purchaseClearance`. The same order as a
 * purchase: hold the name, charge, then ask the registrar, refunding when it
 * refuses. The auth code is passed through and never stored.
 */
export async function startTransferIn(
  effects: LifecycleEffects,
  actor: DomainsActor,
  input: {
    domain: string
    authCode: string
    contact: RegistrantContact
    expectedPriceCents: number
    preclearanceId?: string | null
  },
): Promise<TransferInOutcome> {
  const domain = input.domain.trim().toLowerCase()
  const contact = cleanContact(input.contact)
  const quote = await transferInQuote(effects.driver, domain)
  if (quote.ok === 'no') {
    return transferRefused(quote.code, quote.code === 'registrar-unavailable' ? 503 : 409)
  }
  if (quote.priceCents !== input.expectedPriceCents) {
    return transferRefused('price-changed', 409, { priceCents: quote.priceCents })
  }

  const nowMs = effects.now()
  const attemptId = randomBytes(6).toString('hex')
  const ref = registrationRef(domain)
  const held = await db().runTransaction(async (tx) => {
    const existing = await tx.get(ref)
    const current = existing.exists ? (existing.data() as DomainRegistrationDoc) : null
    // An expired name is still its workspace's to renew back, and may be
    // another workspace's: a transfer never takes its document over.
    if (current && current.status === 'expired') {
      return current.orgId === actor.orgId ? ('renew-instead' as const) : ('already-here' as const)
    }
    if (current && HOLDING_STATUSES.includes(current.status)) {
      return current.orgId === actor.orgId ? ('taken' as const) : ('already-here' as const)
    }
    const registration: DomainRegistrationDoc = {
      domain,
      orgId: actor.orgId,
      hostId: null,
      registrar: effects.driver.id,
      origin: 'transfer-in',
      status: 'charging',
      autoRenew: true,
      firstYearCents: quote.priceCents,
      renewalCents: quote.renewalCents,
      costUsd: quote.costUsd,
      renewalCostUsd: quote.renewalCostUsd,
      purchaseInvoiceId: null,
      invoiceIds: [],
      orderId: null,
      registeredAtMs: null,
      expiresAtMs: null,
      registrant: {
        name: `${contact.firstName} ${contact.lastName}`.trim(),
        email: contact.email,
      },
      transfer: null,
      renewal: null,
      failure: null,
      disputedAtMs: null,
      createdBy: actor.uid,
      createdAtMs: nowMs,
      updatedAtMs: nowMs,
      // Another workspace's history is never carried into this one's.
      history: withEvent(current && current.orgId === actor.orgId ? current.history : [], {
        atMs: nowMs,
        event: 'transfer-started',
        detail: attemptId,
      }),
    }
    tx.set(ref, stripUndefined(registration))
    return registration
  })
  if (held === 'taken' || held === 'already-here' || held === 'renew-instead') {
    return transferRefused(held, 409)
  }

  if (input.preclearanceId) {
    const spent = await effects.consumePreclearance(input.preclearanceId).catch(() => false)
    if (spent !== true) {
      await updateRegistration(
        domain,
        { status: 'declined', failure: 'no-payment-history' },
        { event: 'preclearance-refused' },
      )
      return transferRefused('no-payment-history', 409)
    }
    await updateRegistration(domain, {}, { event: 'precleared', detail: input.preclearanceId }).catch(
      () => null,
    )
  }

  if (quote.priceCents > 0) {
    const charged = await effects.charge({
      orgId: actor.orgId,
      amountCents: quote.priceCents,
      description: `Domain transfer — ${domain}, one year added`,
      domain,
      kind: 'domain-transfer',
      attemptKey: `${domain}-transfer-${attemptId}`,
    })
    if (!charged.ok) {
      await updateRegistration(
        domain,
        { status: 'declined', failure: charged.code ?? 'declined' },
        { event: 'charge-declined', detail: charged.code ?? undefined },
      )
      if (charged.code === 'no-product') return transferRefused('no-product', 503)
      return transferRefused(charged.code === 'requires-action' ? 'requires-action' : 'declined', 402)
    }
    await updateRegistration(
      domain,
      {
        purchaseInvoiceId: charged.invoiceId,
        invoiceIds: charged.invoiceId ? [charged.invoiceId] : [],
      },
      { event: 'charged', detail: formatUsdCents(charged.paidCents) },
    )
  }

  const started = await effects.driver.transferIn({
    domain,
    authCode: input.authCode.trim(),
    years: 1,
    expectedPriceUsd: quote.costUsd,
    autoRenew: true,
    contact,
  })
  if (started.ok === 'no') {
    const registration = (await readRegistration(domain)) ?? held
    // A lost answer is not a refusal: the registrar may have the transfer.
    // Unless its status says plainly that it failed, the name is followed as
    // a transfer and the sweep decides — finishing it, or refunding it once
    // the registrar says so or the deadline passes.
    if (started.retryable) {
      const status = await effects.driver.transferStatus(domain)
      if (status.ok === 'no' || status.value.status !== 'failed') {
        const state = status.ok === 'yes' ? status.value.state : null
        const moving =
          (await updateRegistration(
            domain,
            {
              status: 'transferring-in',
              transfer: { orderId: 'unknown', startedAtMs: nowMs, lastStatus: state, checkedAtMs: nowMs },
            },
            { event: 'transfer-requested', detail: state ?? `unconfirmed-${started.code}` },
          )) ?? registration
        return { ok: 'transferring', registration: moving }
      }
    }
    // Reached on a retryable answer only when the registrar's status says
    // the transfer failed, so the outcome is a refusal, never "unavailable".
    const code = transferRefusalCode(started.code)
    const closed = await refundAndClose(effects, registration, `transfer-${started.code}`, {
      kind: 'transferInFailed',
      failure: TRANSFER_COPY[code],
    })
    const refund = closed.status === 'refunded' ? 'refunded' : 'pending'
    // The registrar's own price moved: the dialog is told the new one.
    if (code === 'price-changed') {
      const again = await transferInQuote(effects.driver, domain)
      return transferRefused(code, 409, {
        refund,
        ...(again.ok === 'yes' ? { priceCents: again.priceCents } : {}),
      })
    }
    return transferRefused(code, 409, { refund })
  }
  const moving =
    (await updateRegistration(
      domain,
      {
        status: 'transferring-in',
        orderId: started.value.orderId,
        transfer: {
          orderId: started.value.orderId,
          startedAtMs: nowMs,
          lastStatus: 'created',
          checkedAtMs: nowMs,
        },
      },
      { event: 'transfer-requested', detail: started.value.orderId },
    )) ?? held
  return { ok: 'transferring', registration: moving }
}

/**
 * One pass over a transfer in: read where it stands, record a change, and
 * finish it — the name becomes the workspace's with its new expiry, or the
 * charge is refunded — telling the owners either way.
 */
export async function advanceTransferIn(
  effects: LifecycleEffects,
  registration: DomainRegistrationDoc,
): Promise<DomainRegistrationDoc> {
  if (registration.status !== 'transferring-in') return registration
  const nowMs = effects.now()
  const transfer = registration.transfer ?? {
    orderId: registration.orderId ?? 'unknown',
    startedAtMs: registration.createdAtMs,
  }
  const read = await effects.driver.transferStatus(registration.domain)
  // The registrar will not say how the transfer stands (it knows of no
  // transfer, say): whether the name is now in our account answers it, and
  // past the deadline a transfer nobody can find is refunded.
  if (read.ok === 'no' && !read.retryable) {
    const held = await effects.driver.info(registration.domain)
    if (held.ok === 'yes' && held.value.owned) {
      return finishTransferIn(effects, registration, transfer, 'completed', held.value.expiresAtMs)
    }
    if (nowMs - transfer.startedAtMs > STUCK_TRANSFER_MS) {
      return refundAndClose(effects, registration, `transfer-unconfirmed-${read.code}`, {
        kind: 'transferInFailed',
        failure: transferFailureSentence('unconfirmed'),
      })
    }
    return registration
  }
  if (read.ok === 'no' || read.value.status === 'pending') {
    if (read.ok === 'yes' && read.value.state !== transfer.lastStatus) {
      const next = await updateRegistration(
        registration.domain,
        { transfer: { ...transfer, lastStatus: read.value.state, checkedAtMs: nowMs } },
        { event: 'transfer-status', detail: read.value.state },
      )
      if (next) registration = next
    }
    if (nowMs - transfer.startedAtMs > STUCK_TRANSFER_MS) {
      await effects.alert(
        'transferStuck',
        registration,
        read.ok === 'yes' ? read.value.state : read.code,
      )
    }
    return registration
  }
  if (read.value.status === 'failed') {
    return refundAndClose(effects, registration, `transfer-${read.value.state}`, {
      kind: 'transferInFailed',
      failure: transferFailureSentence(read.value.state),
    })
  }
  const info = await effects.driver.info(registration.domain)
  return finishTransferIn(
    effects,
    registration,
    transfer,
    read.value.state,
    info.ok === 'yes' ? info.value.expiresAtMs : null,
  )
}

/**
 * The site of this workspace that already serves `domain` — connected by
 * hand while the name was registered elsewhere — or null. THROWS when the
 * read fails: a caller deciding whether records are protected must fail
 * closed, not read an outage as "no site".
 */
export async function siteServingDomain(orgId: string, domain: string): Promise<string | null> {
  const found = await db().collection('hosts').where('cname', '==', domain).limit(5).get()
  const site = found.docs.find((doc) => String(doc.get('orgId') ?? '') === orgId)
  return site?.id ?? null
}

/** Records an arrived transfer: active, its new expiry, and the site it already serves. */
async function finishTransferIn(
  effects: LifecycleEffects,
  registration: DomainRegistrationDoc,
  transfer: NonNullable<DomainRegistrationDoc['transfer']>,
  state: string,
  registrarExpiresAtMs: number | null,
): Promise<DomainRegistrationDoc> {
  const nowMs = effects.now()
  const expiresAtMs = registrarExpiresAtMs || nowMs + 365 * DAY_MS
  // A domain is often already connected to one of the workspace's sites by
  // hand before it moves here; it is tied to that site, which keeps serving.
  // A failed read only loses the tie, which connecting it later restores.
  const hostId = await siteServingDomain(registration.orgId, registration.domain).catch(() => null)
  const arrived =
    (await updateRegistration(
      registration.domain,
      {
        status: 'active',
        registeredAtMs: nowMs,
        expiresAtMs,
        failure: null,
        renewal: null,
        ...(hostId ? { hostId } : {}),
        transfer: { ...transfer, lastStatus: state, checkedAtMs: nowMs },
      },
      { event: 'transferred-in', detail: formatDate(expiresAtMs) },
    )) ?? registration
  await effects.email('transferInCompleted', arrived, {
    'domain.expiresOn': formatDate(expiresAtMs),
    'domain.renewalPrice': formatUsdCents(arrived.renewalCents),
    'domain.amount': formatUsdCents(arrived.firstYearCents),
  })
  return arrived
}

/*==========================================
  Connecting a workspace's name to a site (AGL-4040)
==========================================*/

export type ConnectToSiteOutcome =
  | { ok: 'connected' | 'connecting'; registration: DomainRegistrationDoc; replaced: string | null }
  | {
      ok: 'refused'
      status: number
      code: 'not-active' | 'unknown-site' | 'release-failed' | 'connect-failed'
      error: string
      /** False when the swap was undone only in part; `error` says what is left. */
      restored: boolean
    }

const TWIN_FIELD = 'cnameTwin'

/**
 * Connects `registration` to `hostId`, swapping out whatever domain that
 * site shows now. The page confirms the swap, naming the domain replaced,
 * before calling this.
 *
 * The order keeps the target site serving for as long as anything can still
 * fail: the name is released from the OTHER site it serves first, then the
 * target's current domain, then the name is connected. A step that fails
 * undoes the ones before it ({@link rollBackSwap}) — the replaced domain is
 * reconnected to the target with its twin, and the name to the site it came
 * from — and the answer says "nothing changed" only when that undo worked.
 * A connect the deployment can still retry is left to the sweep, which
 * undoes the swap if it has not finished within {@link SWAP_CONNECT_WINDOW_MS}.
 */
export async function connectToSite(
  effects: LifecycleEffects,
  registration: DomainRegistrationDoc,
  hostId: string,
  actor: { uid: string; email: string | null },
): Promise<ConnectToSiteOutcome> {
  const domain = registration.domain
  if (registration.status !== 'active') {
    return { ok: 'refused', status: 409, code: 'not-active', error: 'That domain can’t be connected right now.', restored: true }
  }
  const host = await db().collection('hosts').doc(hostId).get()
  if (!host.exists || String(host.get('orgId') ?? '') !== registration.orgId) {
    return { ok: 'refused', status: 404, code: 'unknown-site', error: 'That site isn’t in this workspace.', restored: true }
  }
  const current = String(host.get('cname') ?? '').trim().toLowerCase()
  const replaced = current && current !== domain ? current : null
  const previous = replaced ? await readRegistration(replaced) : null
  const swap: DomainSwapState = {
    hostId,
    replaced,
    replacedTwin: String(host.get(TWIN_FIELD) ?? '').trim().toLowerCase() || null,
    replacedOurs: Boolean(previous && previous.orgId === registration.orgId && previous.hostId === hostId),
    fromHostId: registration.hostId && registration.hostId !== hostId ? registration.hostId : null,
    fromServed: false,
    fromTwin: null,
    startedAtMs: effects.now(),
    actor,
  }

  // 1. The other site this name serves now, released first: if that fails,
  //    the target site has not been touched.
  if (swap.fromHostId) {
    const from = await db().collection('hosts').doc(swap.fromHostId).get()
    swap.fromServed = from.exists && String(from.get('cname') ?? '').trim().toLowerCase() === domain
    swap.fromTwin = String(from.get(TWIN_FIELD) ?? '').trim().toLowerCase() || null
    const released = await effects.disconnect({ hostId: swap.fromHostId, domain, actor })
    if (!released) {
      return {
        ok: 'refused',
        status: 502,
        code: 'release-failed',
        error: `${domain} couldn’t be released from the site it serves now, so nothing changed. Try again in a minute.`,
        restored: true,
      }
    }
  }

  // 2. The target's current domain.
  if (replaced) {
    const released = await effects.disconnect({ hostId, domain: replaced, actor })
    if (!released) {
      const undo = await rollBackSwap(effects, registration, { ...swap, replaced: null }, 'release-failed')
      return {
        ok: 'refused',
        status: 502,
        code: 'release-failed',
        error: undo.restored
          ? `${replaced} couldn’t be released from the site just now, so nothing changed. Try again in a minute.`
          : `${replaced} couldn’t be released from the site, and ${domain} couldn’t be put back on the site it served. Connect ${domain} again from the Domains page.`,
        restored: undo.restored,
      }
    }
    if (swap.replacedOurs) {
      await updateRegistration(replaced, { hostId: null }, { event: 'replaced-on-site', detail: domain })
    }
  }

  // 3. The name itself, with what the swap released kept on the record.
  const moving =
    (await updateRegistration(
      domain,
      { hostId, status: 'connecting', failure: null, pendingSwap: swap },
      { event: 'connect-to-site', detail: hostId },
    )) ?? registration
  const connected = await advanceConnecting(effects, moving)
  const refusedForGood = connected.status === 'active' && Boolean(connected.failure?.startsWith('connect-'))
  if (!refusedForGood) {
    return {
      ok: connected.status === 'active' && !connected.failure ? 'connected' : 'connecting',
      registration: connected,
      replaced,
    }
  }
  const undo = await rollBackSwap(effects, connected, swap, 'connect-refused')
  return {
    ok: 'refused',
    status: 409,
    code: 'connect-failed',
    error: undo.restored
      ? `${domain} couldn’t be connected to that site, so nothing changed.`
      : undo.replacedBack
        ? `${domain} couldn’t be connected to that site, and couldn’t be put back on the site it served. Connect it again from the Domains page.`
        : `${domain} couldn’t be connected to that site, and ${replaced} couldn’t be put back on it, so the site is on its free address. Connect a domain to it again from the Domains page.`,
    restored: undo.restored,
  }
}

/**
 * Undoes a swap that will not finish: the target site's own domain goes back
 * on it (with its twin, and its registration's site restored), and the name
 * goes back to the site it served, or into the workspace. Each step is on
 * the name's history; a step that fails is raised to staff and left on the
 * page as what is left to fix (`failure: swap-undo-failed:<what>`).
 */
export async function rollBackSwap(
  effects: LifecycleEffects,
  registration: DomainRegistrationDoc,
  swap: DomainSwapState,
  reason: 'release-failed' | 'connect-refused' | 'timed-out',
): Promise<{ restored: boolean; replacedBack: boolean }> {
  const domain = registration.domain
  const { actor } = swap
  // The name first comes off the target, which a retryable attach may have
  // half-claimed; a release that fails leaves it to the next step's check.
  if (reason === 'timed-out') {
    await effects.disconnect({ hostId: swap.hostId, domain, actor }).catch(() => false)
  }
  let replacedBack = true
  if (swap.replaced) {
    const back = await effects
      .connect({ hostId: swap.hostId, domain: swap.replaced, actor, twin: swap.replacedTwin })
      .catch(() => ({ ok: 'refused' as const, code: 'threw', retryable: false }))
    replacedBack = back.ok === 'connected'
    if (replacedBack && swap.replacedOurs) {
      await updateRegistration(swap.replaced, { hostId: swap.hostId }, { event: 'restored-on-site', detail: domain })
    }
  }
  let fromBack = true
  let hostId: string | null = swap.fromHostId
  if (swap.fromHostId && swap.fromServed) {
    const back = await effects
      .connect({ hostId: swap.fromHostId, domain, actor, twin: swap.fromTwin })
      .catch(() => ({ ok: 'refused' as const, code: 'threw', retryable: false }))
    fromBack = back.ok === 'connected'
    if (!fromBack) hostId = null
  }
  const restored = replacedBack && fromBack
  const left = !replacedBack ? `swap-undo-failed:${swap.replaced}` : !fromBack ? `swap-undo-failed:${domain}` : null
  await updateRegistration(
    domain,
    {
      status: 'active',
      hostId,
      pendingSwap: null,
      failure: left ?? (reason === 'timed-out' ? 'swap-timed-out' : null),
    },
    { event: restored ? 'swap-undone' : 'swap-undo-failed', detail: `${reason}:${swap.hostId}` },
  )
  if (!restored) {
    await effects.alert('swapRollbackFailed', registration, `${reason}: ${left}`)
  }
  return { restored, replacedBack }
}

/** Takes a name off its site; it stays the workspace's, unassigned. */
export async function disconnectFromSite(
  effects: LifecycleEffects,
  registration: DomainRegistrationDoc,
  actor: { uid: string; email: string | null },
): Promise<DomainRegistrationDoc | null> {
  if (registration.hostId) {
    const released = await effects.disconnect({ hostId: registration.hostId, domain: registration.domain, actor })
    if (!released) return null
  }
  return (
    (await updateRegistration(
      registration.domain,
      { hostId: null, failure: null },
      { event: 'disconnected', detail: registration.hostId ?? undefined },
    )) ?? registration
  )
}
