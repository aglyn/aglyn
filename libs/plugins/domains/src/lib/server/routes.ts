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

import { logHostActivity, memberHasOrgPermission, resolveOrgMembership } from '@aglyn/tenant-data-admin'
import { registrationView, type DomainRegistrationDoc } from '../model/registration'
import { db, listRegistrations, readRegistration, updateRegistration } from './db'
import {
  domainsError,
  domainsGate,
  domainsJson,
  purchaseRefusal,
  PURCHASE_REFUSAL_COPY,
  type DomainsActor,
} from './gates'
import {
  advanceConnecting,
  advanceRenewal,
  invalidContactFields,
  purchaseDomain,
  registrarShouldAutoRenew,
} from './lifecycle'
import { platformEffects } from './platform-effects'
import type { RegistrantContact } from './registrar'
import { searchDomains } from './search'
import { domainProductId } from './stripe'

/*
 * THE CONSOLE ROUTES (AGL-3962), under `/api/registrar/*`. Each answers in
 * plain-language `error` copy the card shows as it is, plus a `code` the card
 * branches on; nothing a route returns is a vendor's wording.
 */

/** Whether this deployment sells names at all: a registrar and a product. */
export function sellingConfigured(): boolean {
  return platformEffects().driver.configured() && Boolean(domainProductId())
}

const NOT_CONFIGURED = 'Buying domains isn’t available on this deployment.'

/*==========================================
  Search
==========================================*/

/** Searches per member per window; the registrar's own limit is the reason. */
const SEARCH_LIMIT = 40
const SEARCH_WINDOW_MS = 10 * 60 * 1000
const searches = new Map<string, number[]>()

function overSearchLimit(uid: string, nowMs: number): boolean {
  const recent = (searches.get(uid) ?? []).filter((at) => nowMs - at < SEARCH_WINDOW_MS)
  if (recent.length >= SEARCH_LIMIT) {
    searches.set(uid, recent)
    return true
  }
  recent.push(nowMs)
  searches.set(uid, recent)
  return false
}

export async function searchRoute(request: Request): Promise<Response> {
  if (request.method !== 'GET') return domainsError(405, 'Method not allowed')
  if (!sellingConfigured()) return domainsError(404, NOT_CONFIGURED, { code: 'not-configured' })
  const gate = await domainsGate(request, { billing: false })
  if (gate instanceof Response) return gate
  const query = String(new URL(request.url).searchParams.get('q') ?? '').slice(0, 120)
  if (!query.trim()) return domainsJson({ offers: [] })
  if (overSearchLimit(gate.actor.uid, Date.now())) {
    return domainsError(429, 'That’s a lot of searches. Wait a few minutes and try again.', {
      code: 'rate-limited',
    })
  }
  const found = await searchDomains(platformEffects().driver, query)
  if (!found.ok) {
    return domainsError(503, 'Search isn’t answering right now. Try again in a minute.', {
      code: 'registrar-unavailable',
    })
  }
  return domainsJson({ offers: found.offers })
}

/*==========================================
  What the page shows
==========================================*/

async function canManageBilling(actor: DomainsActor): Promise<boolean> {
  if (actor.staff) return true
  const membership = await resolveOrgMembership(actor.uid, actor.orgId).catch(() => null)
  if (!membership) return false
  return memberHasOrgPermission(actor.orgId, membership.member, 'billing.manage' as never).catch(
    () => false,
  )
}

/**
 * The site's bought domains and whether it may buy one now — every reason
 * it may not, BEFORE the click, so the card can say it (AGL-3853).
 */
export async function registrationsRoute(request: Request): Promise<Response> {
  if (request.method !== 'GET') return domainsError(405, 'Method not allowed')
  const gate = await domainsGate(request, { billing: false })
  if (gate instanceof Response) return gate
  const { actor } = gate
  const [forSite, forOrg, billing] = await Promise.all([
    listRegistrations('hostId', actor.hostId),
    listRegistrations('orgId', actor.orgId),
    canManageBilling(actor),
  ])
  const configured = sellingConfigured()
  const refusal = configured ? await purchaseRefusal(actor, '').catch(() => null) : null
  return domainsJson({
    configured,
    billingPermission: billing,
    canBuy: configured && billing && !refusal,
    refusal: refusal
      ? { code: refusal, message: PURCHASE_REFUSAL_COPY[refusal] }
      : billing
        ? null
        : {
            code: 'billing-permission',
            message: 'Only a workspace member who manages billing can buy a domain.',
          },
    registrations: forSite.map(registrationView),
    // Names this workspace holds that no site shows, which this site may take.
    unassigned: forOrg
      .filter((registration) => registration.status === 'active' && !registration.hostId)
      .map(registrationView),
    contactDefaults: {
      firstName: actor.name.split(' ')[0] ?? '',
      lastName: actor.name.split(' ').slice(1).join(' '),
      email: actor.email,
    },
  })
}

/*==========================================
  Buying
==========================================*/

export async function purchaseRoute(request: Request): Promise<Response> {
  if (request.method !== 'POST') return domainsError(405, 'Method not allowed')
  if (!sellingConfigured()) return domainsError(404, NOT_CONFIGURED, { code: 'not-configured' })
  const gate = await domainsGate(request, { billing: true })
  if (gate instanceof Response) return gate
  const { actor, body } = gate
  const domain = String(body['domain'] ?? '').trim().toLowerCase()
  if (body['acceptTerms'] !== true) {
    return domainsError(400, 'Agree to the registration terms to buy the domain.', {
      code: 'terms',
    })
  }
  const contact = (body['contact'] ?? {}) as Partial<RegistrantContact>
  const invalid = invalidContactFields(contact)
  if (invalid.length) {
    return domainsError(400, 'Some registrant details are missing or not valid.', {
      code: 'contact',
      fields: invalid,
    })
  }
  const refusal = await purchaseRefusal(actor, domain)
  if (refusal) {
    return domainsError(409, PURCHASE_REFUSAL_COPY[refusal], { code: refusal })
  }
  const effects = platformEffects()
  const outcome = await purchaseDomain(effects, actor, {
    domain,
    expectedFirstYearCents: Math.round(Number(body['expectedFirstYearCents'] ?? -1)),
    contact: contact as RegistrantContact,
  })
  if (outcome.ok === 'refused') {
    return domainsError(outcome.status, outcome.error, {
      code: outcome.code,
      ...(outcome.firstYearCents !== undefined
        ? { firstYearCents: outcome.firstYearCents, renewalCents: outcome.renewalCents }
        : {}),
    })
  }
  await logHostActivity(
    actor.hostId,
    { uid: actor.uid, email: actor.email || null },
    'Bought a domain',
    { type: 'host', id: actor.hostId, name: domain },
  )
  return domainsJson({ status: outcome.ok, registration: registrationView(outcome.registration) })
}

/*==========================================
  Managing a bought name
==========================================*/

/** The registration named in the body, if it is this workspace's. */
async function ownRegistration(
  actor: DomainsActor,
  body: Record<string, unknown>,
): Promise<DomainRegistrationDoc | Response> {
  const domain = String(body['domain'] ?? '').trim().toLowerCase()
  const registration = domain ? await readRegistration(domain) : null
  if (!registration || registration.orgId !== actor.orgId) {
    return domainsError(404, 'That domain isn’t one this workspace bought here.')
  }
  return registration
}

export async function autoRenewRoute(request: Request): Promise<Response> {
  if (request.method !== 'POST') return domainsError(405, 'Method not allowed')
  const gate = await domainsGate(request, { billing: true })
  if (gate instanceof Response) return gate
  const registration = await ownRegistration(gate.actor, gate.body)
  if (registration instanceof Response) return registration
  if (registration.status !== 'active') {
    return domainsError(409, 'Auto-renew can be changed once the domain is registered.')
  }
  const autoRenew = gate.body['autoRenew'] === true
  // Turning it back on restarts the renewal for this term: the decline that
  // gave up on it may be what the owner just fixed.
  const renewal = registration.renewal
    ? {
        ...registration.renewal,
        abandonedAtMs: undefined,
        abandonedReason: undefined,
        nextChargeAtMs: undefined,
      }
    : null
  const next = await updateRegistration(
    registration.domain,
    { autoRenew, ...(autoRenew ? { renewal } : {}) },
    { event: autoRenew ? 'auto-renew-on' : 'auto-renew-off' },
  )
  if (next) {
    await platformEffects()
      .driver.setAutoRenew(registration.domain, registrarShouldAutoRenew(next))
      .catch(() => undefined)
  }
  await logHostActivity(
    gate.actor.hostId,
    { uid: gate.actor.uid, email: gate.actor.email || null },
    autoRenew ? 'Turned on auto-renew for a domain' : 'Turned off auto-renew for a domain',
    { type: 'host', id: gate.actor.hostId, name: registration.domain },
  )
  return domainsJson({ registration: next ? registrationView(next) : null })
}

export async function renewNowRoute(request: Request): Promise<Response> {
  if (request.method !== 'POST') return domainsError(405, 'Method not allowed')
  if (!sellingConfigured()) return domainsError(404, NOT_CONFIGURED, { code: 'not-configured' })
  const gate = await domainsGate(request, { billing: true })
  if (gate instanceof Response) return gate
  const registration = await ownRegistration(gate.actor, gate.body)
  if (registration instanceof Response) return registration
  if (registration.status !== 'active' && registration.status !== 'expired') {
    return domainsError(409, 'That domain can’t be renewed right now.')
  }
  const effects = platformEffects()
  const before = registration.expiresAtMs ?? 0
  const after = await advanceRenewal(effects, registration, { force: true })
  // A fresh order usually completes in seconds; read it once more so the
  // common case answers "renewed" on the same click.
  await effects.sleep(3000)
  const settled = await advanceRenewal(effects, (await readRegistration(after.domain)) ?? after, {
    force: true,
  })
  const renewed = (settled.expiresAtMs ?? 0) > before
  if (renewed) {
    await logHostActivity(
      gate.actor.hostId,
      { uid: gate.actor.uid, email: gate.actor.email || null },
      'Renewed a domain',
      { type: 'host', id: gate.actor.hostId, name: registration.domain },
    )
  }
  const failing = settled.renewal?.lastChargeError && !settled.renewal?.chargedInvoiceId
  return domainsJson(
    {
      renewed,
      pending: !renewed && !failing,
      ...(failing
        ? {
            error:
              'Your card was declined. Update the payment method on the Billing page, then try again.',
          }
        : {}),
      registration: registrationView(settled),
    },
    failing ? 402 : 200,
  )
}

/**
 * The code another registrar asks for. Shown to the member who asked and
 * announced to every owner, since moving a name away moves the site's
 * address away with it.
 */
export async function transferOutRoute(request: Request): Promise<Response> {
  if (request.method !== 'POST') return domainsError(405, 'Method not allowed')
  const gate = await domainsGate(request, { billing: true })
  if (gate instanceof Response) return gate
  const registration = await ownRegistration(gate.actor, gate.body)
  if (registration instanceof Response) return registration
  if (registration.status !== 'active') {
    return domainsError(409, 'A domain can be moved once it is registered.')
  }
  const sixtyDays = 60 * 24 * 60 * 60 * 1000
  const lockedUntil = (registration.registeredAtMs ?? 0) + sixtyDays
  if (Date.now() < lockedUntil) {
    return domainsError(
      409,
      `Domain registries lock a new domain for 60 days. ${registration.domain} can be moved from ${new Date(lockedUntil).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}.`,
      { code: 'locked' },
    )
  }
  const effects = platformEffects()
  const code = await effects.driver.authCode(registration.domain)
  if (code.ok === 'no') {
    return domainsError(503, 'The registrar didn’t answer just now. Try again in a minute.')
  }
  await updateRegistration(registration.domain, {}, { event: 'transfer-code-shown', detail: gate.actor.uid })
  await logHostActivity(
    gate.actor.hostId,
    { uid: gate.actor.uid, email: gate.actor.email || null },
    'Requested the transfer code for a domain',
    { type: 'host', id: gate.actor.hostId, name: registration.domain },
  )
  await effects.email('transferCode', registration, {
    'domain.requestedBy': gate.actor.email || gate.actor.name || 'a member',
  })
  return domainsJson({ authCode: code.value })
}

/** Connects a name this workspace bought to the site named in the request. */
export async function reconnectRoute(request: Request): Promise<Response> {
  if (request.method !== 'POST') return domainsError(405, 'Method not allowed')
  const gate = await domainsGate(request, { billing: false })
  if (gate instanceof Response) return gate
  const registration = await ownRegistration(gate.actor, gate.body)
  if (registration instanceof Response) return registration
  if (registration.status !== 'active') {
    return domainsError(409, 'That domain can’t be connected right now.')
  }
  // A name another site still serves stays there: moving it is a
  // disconnect on that site first, by someone who can see it.
  if (registration.hostId && registration.hostId !== gate.actor.hostId) {
    const other = await db().collection('hosts').doc(registration.hostId).get()
    if (other.exists && String(other.get('cname') ?? '').toLowerCase() === registration.domain) {
      return domainsError(
        409,
        `${registration.domain} is connected to another site. Disconnect it there first.`,
        { code: 'connected-elsewhere' },
      )
    }
  }
  if (String(gate.actor.host['cname'] ?? '').trim()) {
    return domainsError(
      409,
      'This site already has a domain connected. Disconnect it first.',
      { code: 'site-has-domain' },
    )
  }
  const moving =
    (await updateRegistration(
      registration.domain,
      { hostId: gate.actor.hostId, status: 'connecting', failure: null },
      { event: 'reconnect', detail: gate.actor.hostId },
    )) ?? registration
  const connected = await advanceConnecting(platformEffects(), moving)
  return domainsJson({ registration: registrationView(connected) }, connected.status === 'active' && !connected.failure ? 200 : 202)
}
