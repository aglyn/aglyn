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
import { domainRetailCents, formatUsdCents } from '../model/pricing'
import {
  HOLDING_STATUSES,
  withEvent,
  type DomainRegistrationDoc,
  type DomainRenewalState,
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
export const RENEWAL_CHARGE_DAYS = 30
export const FINAL_ATTEMPT_DAYS = 3
/** Days between renewal charge attempts after a decline. */
export const RETRY_AFTER_DAYS: readonly number[] = [3, 4, 7, 7]
/** A `charging` hold older than this belongs to a request that died. */
export const STALE_CHARGING_MS = 15 * 60 * 1000
/** A registrar order still pending after this is told to staff. */
export const STUCK_ORDER_MS = 24 * 60 * 60 * 1000
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

export type DomainAlertKind =
  | 'orderStuck'
  | 'refundFailed'
  | 'renewalFailedAtRegistrar'
  | 'orphanRegistration'
  | 'renewalUnpaid'
  | 'disputed'

export interface LifecycleEffects {
  driver: RegistrarDriver
  now(): number
  charge(request: {
    orgId: string
    amountCents: number
    description: string
    domain: string
    kind: 'domain-purchase' | 'domain-renewal'
    attemptKey: string
  }): Promise<DomainChargeResult>
  refund(invoiceId: string, reason: string): Promise<{ ok: boolean; refundedCents: number }>
  /** Core's `connectHostCustomDomain`, with its www twin. */
  connect(request: {
    hostId: string
    domain: string
    actor: { uid: string; email: string | null }
  }): Promise<{ ok: 'connected' } | { ok: 'refused'; code: string; retryable: boolean }>
  /** Core's `disconnectHostCustomDomain` for a site still showing `domain`. */
  disconnect(request: { hostId: string; domain: string }): Promise<boolean>
  email(
    kind: DomainEmailKind,
    registration: DomainRegistrationDoc,
    merge: Record<string, string>,
  ): Promise<void>
  alert(kind: DomainAlertKind, registration: DomainRegistrationDoc, detail: string): Promise<void>
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

function cleanContact(contact: RegistrantContact): RegistrantContact {
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
} as const

function refused(
  code: Extract<PurchaseOutcome, { ok: 'refused' }>['code'],
  status: number,
  extra: Partial<Extract<PurchaseOutcome, { ok: 'refused' }>> = {},
): PurchaseOutcome {
  return { ok: 'refused', status, code, error: REFUSAL_COPY[code], ...extra }
}

/**
 * Buys `domain` for the actor's site. The caller has run the gate and
 * `purchaseRefusal`; this is everything after them, in the order that never
 * leaves money taken for a name not held.
 */
export async function purchaseDomain(
  effects: LifecycleEffects,
  actor: DomainsActor,
  input: {
    domain: string
    expectedFirstYearCents: number
    contact: RegistrantContact
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
      hostId: actor.hostId,
      registrar: effects.driver.id,
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
      history: withEvent(
        existing.exists ? (existing.data() as DomainRegistrationDoc).history : [],
        { atMs: nowMs, event: 'purchase-started', detail: attemptId },
      ),
    }
    tx.set(ref, stripUndefined(registration))
    return registration
  })
  if (!held) return refused('taken', 409)

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
  await effects.email('refunded', closed, {
    'domain.refund': charged
      ? `We refunded ${formatUsdCents(charged)} to the card it was charged to. A refund usually reaches the card within 5 to 10 business days.`
      : 'You were not charged for it.',
    'domain.failure': failureSentence(reason),
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
        { status: 'active', failure: null },
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
    const renewed = await effects.driver.renew({
      domain: registration.domain,
      years: 1,
      expectedPriceUsd: price.value,
    })
    if (renewed.ok === 'no') {
      if (renewed.retryable) return registration
      await failPaidRenewal(effects, registration, renewal, `renew-${renewed.code}`)
      return (await readRegistration(registration.domain)) ?? registration
    }
    await save({ orderId: renewed.value.orderId }, 'renewal-ordered', renewed.value.orderId)
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
    const next = await updateRegistration(
      registration.domain,
      {
        status: 'active',
        expiresAtMs: newExpiry,
        renewalCents: renewal.chargedCents ?? registration.renewalCents,
        renewal: { forExpiresAtMs: newExpiry, renewedAtMs: nowMs },
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
      await refundAndClose(effects, registration, 'interrupted')
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
  for (const registration of await listByStatus('connecting', SWEEP_BATCH)) {
    if (!timeLeft()) return report
    report.connecting += 1
    await advanceConnecting(effects, registration)
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
