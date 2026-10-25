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

import { checkEntitlement } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import { logHostActivity, memberHasOrgPermission, resolveOrgMembership } from '@aglyn/tenant-data-admin'
import { logOrgActivity } from '@aglyn/tenant-data-admin/server/organizations'
import {
  invalidDnsRecordFields,
  isAglynManagedRecord,
  toRegistrarRecord,
  wouldReplaceSiteAddress,
  DNS_EDITABLE_TYPES,
  type DnsRecordInput,
  type DnsRecordView,
} from '../model/dns-records'
import {
  HOLDING_STATUSES,
  nextRenewalAtMs,
  registrationView,
  type DomainRegistrationDoc,
  type DomainRegistrationView,
} from '../model/registration'
import { db, listRegistrations, readRegistration, updateRegistration } from './db'
import {
  domainsError,
  domainsGate,
  domainsJson,
  purchaseClearance,
  purchaseRefusal,
  PURCHASE_REFUSAL_COPY,
  type DomainsActor,
} from './gates'
import {
  advanceRenewal,
  cleanContact,
  connectToSite,
  disconnectFromSite,
  invalidContactFields,
  purchaseDomain,
  purchaseTarget,
  registrarShouldAutoRenew,
  RENEW_INSTEAD,
  siteServingDomain,
  startTransferIn,
  transferInQuote,
} from './lifecycle'
import { platformEffects } from './platform-effects'
import type { RegistrantContact } from './registrar'
import { searchDomains } from './search'
import { domainProductId } from './stripe'

/*
 * THE CONSOLE ROUTES (AGL-3962), under `/api/registrar/*`. Each answers in
 * plain-language `error` copy the card shows as it is, plus a `code` the card
 * branches on; nothing a route returns is a vendor's wording.
 *
 * Two levels (AGL-4040): a site's Custom Domain page calls with `hostId`, the
 * workspace's Domains page with `orgId`. Routes that manage a name the
 * workspace already holds answer both; buying, renewing and connecting keep
 * the plan's custom-domain entitlement, and managing what is already held
 * (auto-renew, the transfer code, contacts, DNS) does not need it, so a
 * workspace on a plan without domains can still look after the names it has.
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
  const gate = await domainsGate(request, { billing: false, scope: 'either' })
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

/** An activity row on the site's log, or the workspace's for a name no site uses. */
async function logDomainActivity(
  actor: DomainsActor,
  domain: string,
  action: string,
  hostId: string | null = actor.hostId,
): Promise<void> {
  const who = { uid: actor.uid, email: actor.email || null }
  if (hostId) {
    await logHostActivity(hostId, who, action, { type: 'host', id: hostId, name: domain })
    return
  }
  await logOrgActivity(actor.orgId, who, action, { type: 'org', id: actor.orgId, name: domain })
}

/** The purchase refusal the page shows before any click, or none. */
async function buyRefusal(
  actor: DomainsActor,
  billing: boolean,
): Promise<{ code: string; message: string } | null> {
  const refusal = sellingConfigured() ? await purchaseRefusal(actor, '').catch(() => null) : null
  if (refusal) return { code: refusal, message: PURCHASE_REFUSAL_COPY[refusal] }
  if (!billing) {
    return {
      code: 'billing-permission',
      message: 'Only a workspace member who manages billing can buy a domain.',
    }
  }
  return null
}

function contactDefaultsFor(actor: DomainsActor) {
  return {
    firstName: actor.name.split(' ')[0] ?? '',
    lastName: actor.name.split(' ').slice(1).join(' '),
    email: actor.email,
  }
}

/**
 * The site's bought domains and whether it may buy one now — every reason
 * it may not, BEFORE the click, so the card can say it (AGL-3853) — and
 * where a name bought now goes (AGL-4040).
 */
export async function registrationsRoute(request: Request): Promise<Response> {
  if (request.method !== 'GET') return domainsError(405, 'Method not allowed')
  const gate = await domainsGate(request, { billing: false })
  if (gate instanceof Response) return gate
  const { actor } = gate
  const [forSite, forOrg, billing] = await Promise.all([
    listRegistrations('hostId', actor.hostId ?? ''),
    listRegistrations('orgId', actor.orgId),
    canManageBilling(actor),
  ])
  const configured = sellingConfigured()
  const refusal = await buyRefusal(actor, billing)
  return domainsJson({
    configured,
    billingPermission: billing,
    canBuy: configured && !refusal,
    refusal,
    buyTarget: purchaseTarget(actor, forSite),
    registrations: forSite.map(registrationView),
    // Names this workspace holds that no site shows, which this site may take.
    unassigned: forOrg
      .filter((registration) => registration.status === 'active' && !registration.hostId)
      .map(registrationView),
    contactDefaults: contactDefaultsFor(actor),
  })
}

/** One of the workspace's names as the Domains page lists it (AGL-4040). */
export type WorkspaceDomainRow = DomainRegistrationView & {
  /** Whether the site it names is serving it now. */
  connected: boolean
}

/** How long a refunded name stays on the Domains page, so its story is told. */
const REFUNDED_SHOWN_MS = 30 * 24 * 60 * 60 * 1000

/**
 * EVERY name the workspace holds, for its Domains page (AGL-4040): connected
 * or not, on its way (registering, moving here) or lapsed, and a refunded
 * one for a month. A name counts as connected only while its site still
 * serves it, read from the site itself rather than from the registration.
 */
export async function workspaceRoute(request: Request): Promise<Response> {
  if (request.method !== 'GET') return domainsError(405, 'Method not allowed')
  const gate = await domainsGate(request, { billing: false, scope: 'workspace', entitlement: false })
  if (gate instanceof Response) return gate
  const { actor } = gate
  const [forOrg, billing] = await Promise.all([
    listRegistrations('orgId', actor.orgId),
    canManageBilling(actor),
  ])
  const nowMs = Date.now()
  const shown = forOrg.filter(
    (registration) =>
      registration.status !== 'declined' &&
      !(registration.status === 'refunded' && nowMs - (registration.updatedAtMs ?? 0) > REFUNDED_SHOWN_MS),
  )
  const hostIds = [...new Set(shown.map((registration) => registration.hostId).filter(Boolean))] as string[]
  const hosts = await Promise.all(
    hostIds.map(async (hostId) => {
      const snapshot = await db().collection('hosts').doc(hostId).get().catch(() => null)
      return [hostId, String(snapshot?.get('cname') ?? '').trim().toLowerCase()] as const
    }),
  )
  const servedBy = new Map(hosts)
  // Every site's current domain, so Connect to a site can name the one it
  // replaces before the owner confirms.
  const sites = await db()
    .collection('hosts')
    .where('orgId', '==', actor.orgId)
    .limit(200)
    .get()
    .catch(() => null)
  const siteDomains: Record<string, string> = {}
  for (const site of sites?.docs ?? []) {
    siteDomains[site.id] = String(site.get('cname') ?? '').trim().toLowerCase()
  }
  const entitled = checkEntitlement(actor.org as never, 'customDomain')
  const configured = sellingConfigured()
  const refusal = entitled ? await buyRefusal(actor, billing) : null
  const rows: WorkspaceDomainRow[] = shown.map((registration) => ({
    ...registrationView(registration),
    connected: Boolean(registration.hostId && servedBy.get(registration.hostId) === registration.domain),
  }))
  return domainsJson({
    configured,
    entitled,
    billingPermission: billing,
    canBuy: configured && entitled && !refusal,
    refusal,
    rows,
    siteDomains,
    contactDefaults: contactDefaultsFor(actor),
  })
}

/*==========================================
  Buying
==========================================*/

export async function purchaseRoute(request: Request): Promise<Response> {
  if (request.method !== 'POST') return domainsError(405, 'Method not allowed')
  if (!sellingConfigured()) return domainsError(404, NOT_CONFIGURED, { code: 'not-configured' })
  const gate = await domainsGate(request, { billing: true, scope: 'either' })
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
  const { refusal, preclearanceId } = await purchaseClearance(actor, domain)
  if (refusal) {
    return domainsError(409, PURCHASE_REFUSAL_COPY[refusal], { code: refusal })
  }
  // A site that already has a domain keeps it: the new name goes into the
  // workspace, unassigned (AGL-4040).
  const forSite = actor.hostId ? await listRegistrations('hostId', actor.hostId) : []
  const intoWorkspace = purchaseTarget(actor, forSite) === 'workspace'
  const effects = platformEffects()
  const outcome = await purchaseDomain(effects, actor, {
    domain,
    expectedFirstYearCents: Math.round(Number(body['expectedFirstYearCents'] ?? -1)),
    contact: contact as RegistrantContact,
    // Set only when a staff preclearance stood in for the payment history;
    // the purchase spends it after the hold, before the charge (AGL-3955).
    preclearanceId,
    intoWorkspace,
  })
  if (outcome.ok === 'refused') {
    return domainsError(outcome.status, outcome.error, {
      code: outcome.code,
      ...(outcome.firstYearCents !== undefined
        ? { firstYearCents: outcome.firstYearCents, renewalCents: outcome.renewalCents }
        : {}),
    })
  }
  await logDomainActivity(actor, domain, 'Bought a domain')
  return domainsJson({
    status: outcome.ok,
    intoWorkspace,
    registration: registrationView(outcome.registration),
  })
}

/*==========================================
  Transfer in (AGL-4040)
==========================================*/

const ALREADY_HERE =
  'That domain is already in an account at our registrar, so it can’t be transferred in. Contact support with the domain name.'

/** What moving a name here costs, shown before the owner confirms. */
export async function transferInQuoteRoute(request: Request): Promise<Response> {
  if (request.method !== 'GET') return domainsError(405, 'Method not allowed')
  if (!sellingConfigured()) return domainsError(404, NOT_CONFIGURED, { code: 'not-configured' })
  const gate = await domainsGate(request, { billing: false, scope: 'workspace' })
  if (gate instanceof Response) return gate
  const domain = String(new URL(request.url).searchParams.get('domain') ?? '').trim().toLowerCase()
  const existing = domain ? await readRegistration(domain) : null
  if (existing && existing.orgId === gate.actor.orgId && existing.status === 'active') {
    return domainsError(409, 'That domain is already in your workspace.', { code: 'already-yours' })
  }
  // A name held or lapsed here — by any workspace — is no transfer: an
  // expired one is still its workspace's to renew back.
  if (existing && existing.status === 'expired' && existing.orgId === gate.actor.orgId) {
    return domainsError(409, RENEW_INSTEAD, { code: 'renew-instead' })
  }
  if (existing && (HOLDING_STATUSES.includes(existing.status) || existing.status === 'expired')) {
    return domainsError(409, ALREADY_HERE, { code: 'already-here' })
  }
  const quote = await transferInQuote(platformEffects().driver, domain)
  if (quote.ok === 'no') {
    const copy = {
      'already-here': ALREADY_HERE,
      'not-offered': 'That name can’t be moved here. Only the endings we sell can be transferred in.',
      'needs-extra-contact': 'That ending asks for details we can’t collect here, so it can’t be moved here.',
      'registrar-unavailable': 'The registrar didn’t answer just now. Try again in a minute.',
    }[quote.code]
    return domainsError(quote.code === 'registrar-unavailable' ? 503 : 409, copy, { code: quote.code })
  }
  return domainsJson({ domain, priceCents: quote.priceCents, renewalCents: quote.renewalCents })
}

export async function transferInRoute(request: Request): Promise<Response> {
  if (request.method !== 'POST') return domainsError(405, 'Method not allowed')
  if (!sellingConfigured()) return domainsError(404, NOT_CONFIGURED, { code: 'not-configured' })
  const gate = await domainsGate(request, { billing: true, scope: 'workspace' })
  if (gate instanceof Response) return gate
  const { actor, body } = gate
  const domain = String(body['domain'] ?? '').trim().toLowerCase()
  const authCode = String(body['authCode'] ?? '').trim()
  if (body['acceptTerms'] !== true) {
    return domainsError(400, 'Agree to the registration terms to move the domain here.', {
      code: 'terms',
    })
  }
  if (!authCode || authCode.length > 256) {
    return domainsError(400, 'Enter the transfer code from your current registrar.', {
      code: 'auth-code',
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
  const { refusal, preclearanceId } = await purchaseClearance(actor, domain)
  if (refusal) return domainsError(409, PURCHASE_REFUSAL_COPY[refusal], { code: refusal })
  const outcome = await startTransferIn(platformEffects(), actor, {
    domain,
    authCode,
    contact: contact as RegistrantContact,
    expectedPriceCents: Math.round(Number(body['expectedPriceCents'] ?? -1)),
    preclearanceId,
  })
  if (outcome.ok === 'refused') {
    return domainsError(outcome.status, outcome.error, {
      code: outcome.code,
      ...(outcome.priceCents !== undefined ? { priceCents: outcome.priceCents } : {}),
    })
  }
  await logDomainActivity(actor, domain, 'Started moving a domain here', null)
  return domainsJson({ registration: registrationView(outcome.registration) })
}

/*==========================================
  Managing a held name
==========================================*/

/** The registration named in the body, if it is this workspace's. */
async function ownRegistration(
  actor: DomainsActor,
  body: Record<string, unknown>,
): Promise<DomainRegistrationDoc | Response> {
  const domain = String(body['domain'] ?? '').trim().toLowerCase()
  const registration = domain ? await readRegistration(domain) : null
  if (!registration || registration.orgId !== actor.orgId) {
    return domainsError(404, 'That domain isn’t one this workspace holds here.')
  }
  return registration
}

/** The request's `domain`, from the body or, on a GET, the query. */
function namedDomain(request: Request, body: Record<string, unknown>): Record<string, unknown> {
  return { domain: body['domain'] ?? new URL(request.url).searchParams.get('domain') ?? '' }
}

export async function autoRenewRoute(request: Request): Promise<Response> {
  if (request.method !== 'POST') return domainsError(405, 'Method not allowed')
  const gate = await domainsGate(request, { billing: true, scope: 'either', entitlement: false })
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
  await logDomainActivity(
    gate.actor,
    registration.domain,
    autoRenew ? 'Turned on auto-renew for a domain' : 'Turned off auto-renew for a domain',
    gate.actor.hostId ?? registration.hostId,
  )
  return domainsJson({ registration: next ? registrationView(next) : null })
}

export async function renewNowRoute(request: Request): Promise<Response> {
  if (request.method !== 'POST') return domainsError(405, 'Method not allowed')
  if (!sellingConfigured()) return domainsError(404, NOT_CONFIGURED, { code: 'not-configured' })
  const gate = await domainsGate(request, { billing: true, scope: 'either' })
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
    await logDomainActivity(
      gate.actor,
      registration.domain,
      'Renewed a domain',
      gate.actor.hostId ?? registration.hostId,
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

/** `Dec 18, 2026`, in UTC as the registry dates its lock. */
function lockDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/**
 * The code another registrar asks for. Shown to the member who asked and
 * announced to every owner, since moving a name away moves the site's
 * address away with it.
 *
 * Whether the name may move yet is the REGISTRY's answer, read from the
 * registrar's refusal and its date (AGL-4040), never estimated here.
 */
export async function transferOutRoute(request: Request): Promise<Response> {
  if (request.method !== 'POST') return domainsError(405, 'Method not allowed')
  const gate = await domainsGate(request, { billing: true, scope: 'either', entitlement: false })
  if (gate instanceof Response) return gate
  const registration = await ownRegistration(gate.actor, gate.body)
  if (registration instanceof Response) return registration
  if (registration.status !== 'active') {
    return domainsError(409, 'A domain can be moved once it is registered.')
  }
  const effects = platformEffects()
  const code = await effects.driver.authCode(registration.domain)
  if (code.ok === 'no') {
    if (code.code === 'domain_cannot_be_transfered_out_until') {
      const untilMs = code.untilMs ?? null
      return domainsError(
        409,
        untilMs
          ? `The domain registry locks a domain for a while after it is registered or moved. ${registration.domain} can be moved from ${lockDate(untilMs)}.`
          : `The domain registry locks a domain for a while after it is registered or moved, and ${registration.domain} can’t be moved yet. Try again later.`,
        { code: 'locked', untilMs },
      )
    }
    return domainsError(503, 'The registrar didn’t answer just now. Try again in a minute.')
  }
  await updateRegistration(registration.domain, {}, { event: 'transfer-code-shown', detail: gate.actor.uid })
  await logDomainActivity(
    gate.actor,
    registration.domain,
    'Requested the transfer code for a domain',
    gate.actor.hostId ?? registration.hostId,
  )
  await effects.email('transferCode', registration, {
    'domain.requestedBy': gate.actor.email || gate.actor.name || 'a member',
  })
  return domainsJson({ authCode: code.value })
}

/**
 * "Use for this site" on a site's Custom Domain page: connects a name this
 * workspace holds to the site named in the request, replacing the domain the
 * site shows now (AGL-4040) — the card confirms that first, naming it.
 */
export async function reconnectRoute(request: Request): Promise<Response> {
  if (request.method !== 'POST') return domainsError(405, 'Method not allowed')
  const gate = await domainsGate(request, { billing: false })
  if (gate instanceof Response) return gate
  const registration = await ownRegistration(gate.actor, gate.body)
  if (registration instanceof Response) return registration
  const hostId = gate.actor.hostId as string
  // A name another site still serves stays there: moving it is a
  // disconnect on that site first, by someone who can see it — or a move
  // from the workspace's Domains page.
  if (registration.hostId && registration.hostId !== hostId) {
    const other = await db().collection('hosts').doc(registration.hostId).get()
    if (other.exists && String(other.get('cname') ?? '').toLowerCase() === registration.domain) {
      return domainsError(
        409,
        `${registration.domain} is connected to another site. Disconnect it there, or move it from the Domains page.`,
        { code: 'connected-elsewhere' },
      )
    }
  }
  return connectAnswer(gate.actor, registration, hostId)
}

/** The Domains page's Connect to a site: any of the workspace's sites. */
export async function connectRoute(request: Request): Promise<Response> {
  if (request.method !== 'POST') return domainsError(405, 'Method not allowed')
  const gate = await domainsGate(request, { billing: false, scope: 'workspace' })
  if (gate instanceof Response) return gate
  const registration = await ownRegistration(gate.actor, gate.body)
  if (registration instanceof Response) return registration
  const siteId = String(gate.body['siteId'] ?? '')
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(siteId)) return domainsError(400, 'Pick a site to connect it to.')
  return connectAnswer(gate.actor, registration, siteId)
}

async function connectAnswer(
  actor: DomainsActor,
  registration: DomainRegistrationDoc,
  hostId: string,
): Promise<Response> {
  const outcome = await connectToSite(platformEffects(), registration, hostId, {
    uid: actor.uid,
    email: actor.email || null,
  })
  if (outcome.ok === 'refused') {
    return domainsError(outcome.status, outcome.error, { code: outcome.code, restored: outcome.restored })
  }
  await logDomainActivity(actor, registration.domain, 'Connected a domain to the site', hostId)
  return domainsJson(
    { registration: registrationView(outcome.registration), replaced: outcome.replaced },
    outcome.ok === 'connected' ? 200 : 202,
  )
}

/** Takes a name off its site; it stays in the workspace, unassigned. */
export async function disconnectRoute(request: Request): Promise<Response> {
  if (request.method !== 'POST') return domainsError(405, 'Method not allowed')
  const gate = await domainsGate(request, { billing: false, scope: 'either', entitlement: false })
  if (gate instanceof Response) return gate
  const registration = await ownRegistration(gate.actor, gate.body)
  if (registration instanceof Response) return registration
  if (gate.actor.hostId && registration.hostId !== gate.actor.hostId) {
    return domainsError(409, 'That domain isn’t connected to this site.')
  }
  const hostId = registration.hostId
  const next = await disconnectFromSite(platformEffects(), registration, {
    uid: gate.actor.uid,
    email: gate.actor.email || null,
  })
  if (!next) {
    return domainsError(502, 'The domain couldn’t be released from the site just now. Try again in a minute.', {
      code: 'release-failed',
    })
  }
  await logDomainActivity(gate.actor, registration.domain, 'Disconnected a domain from the site', hostId)
  return domainsJson({ registration: registrationView(next) })
}

/*==========================================
  The registrant contact (AGL-4040)
==========================================*/

/**
 * GET: the contact the owner may edit, prefilled with the one stored (or,
 * before any edit, the name and email the domain is registered to), with
 * when a change reaches the registrar. POST: stores a new one for the next
 * renewal — the registrar takes a contact change on no other call, so the
 * page never claims it changed there now.
 */
export async function contactRoute(request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'POST') {
    return domainsError(405, 'Method not allowed')
  }
  const gate = await domainsGate(request, { billing: false, scope: 'workspace', entitlement: false })
  if (gate instanceof Response) return gate
  const registration = await ownRegistration(gate.actor, namedDomain(request, gate.body))
  if (registration instanceof Response) return registration
  if (request.method === 'POST') {
    if (registration.status !== 'active') {
      return domainsError(409, 'The contact can be changed once the domain is registered here.')
    }
    const contact = (gate.body['contact'] ?? {}) as Partial<RegistrantContact>
    const invalid = invalidContactFields(contact)
    if (invalid.length) {
      return domainsError(400, 'Some registrant details are missing or not valid.', {
        code: 'contact',
        fields: invalid,
      })
    }
    const next = await updateRegistration(
      registration.domain,
      {
        registrantContact: cleanContact(contact as RegistrantContact),
        contactChange: { updatedAtMs: Date.now(), updatedBy: gate.actor.uid },
        contactRejectedAtMs: null,
      },
      { event: 'contact-edited', detail: gate.actor.uid },
    )
    await logDomainActivity(
      gate.actor,
      registration.domain,
      'Changed the registrant contact for a domain',
      null,
    )
    return contactAnswer(next ?? registration)
  }
  return contactAnswer(registration)
}

function contactAnswer(registration: DomainRegistrationDoc): Response {
  const view = registrationView(registration)
  const [firstName = '', ...rest] = (registration.registrant?.name ?? '').split(' ')
  return domainsJson({
    contact: registration.registrantContact ?? {
      firstName,
      lastName: rest.join(' '),
      email: registration.registrant?.email ?? '',
    },
    stored: Boolean(registration.registrantContact),
    pendingSinceMs: view.contactPendingSinceMs,
    rejectedAtMs: view.contactRejectedAtMs,
    takesEffectAtMs: nextRenewalAtMs(view),
    autoRenew: view.autoRenew,
    expiresAtMs: view.expiresAtMs,
    verification: registration.contactVerification
      ? {
          verified: registration.contactVerification.verified === true,
          verifyByMs: registration.contactVerification.verifyByMs ?? null,
          email: registration.contactVerification.email ?? null,
        }
      : null,
  })
}

/*==========================================
  DNS records (AGL-4040)
==========================================*/

/**
 * Whether one of the workspace's sites serves the name now — the one the
 * registration names, or any whose `cname` is the name (a domain connected
 * by hand before it moved here). Either way its address records are kept.
 */
async function siteServes(registration: DomainRegistrationDoc): Promise<boolean> {
  // Throws on a failed read, and the DNS routes answer that as retryable:
  // records whose protection cannot be decided are never shown editable.
  if (registration.hostId) {
    const host = await db().collection('hosts').doc(registration.hostId).get()
    if (String(host.get('cname') ?? '').trim().toLowerCase() === registration.domain) return true
  }
  return Boolean(await siteServingDomain(registration.orgId, registration.domain))
}

/** {@link siteServes}, or a retryable refusal when it cannot be read. */
async function siteServesOrRefuse(registration: DomainRegistrationDoc): Promise<boolean | Response> {
  try {
    return await siteServes(registration)
  } catch {
    return domainsError(503, DNS_UNAVAILABLE, { code: 'site-unreadable' })
  }
}

const DNS_UNAVAILABLE = 'The registrar’s DNS didn’t answer just now. Try again in a minute.'

/**
 * GET: whose nameservers the name uses, and — when they are ours — its
 * records, each marked managed or editable. A name elsewhere has no editor:
 * its records live with whoever runs its nameservers.
 */
export async function dnsRoute(request: Request): Promise<Response> {
  if (request.method === 'POST') return dnsWriteRoute(request)
  if (request.method !== 'GET') return domainsError(405, 'Method not allowed')
  const gate = await domainsGate(request, { billing: false, scope: 'workspace', entitlement: false })
  if (gate instanceof Response) return gate
  const registration = await ownRegistration(gate.actor, namedDomain(request, gate.body))
  if (registration instanceof Response) return registration
  if (registration.status !== 'active') {
    return domainsError(409, 'DNS records can be edited once the domain is registered here.', {
      code: 'not-active',
    })
  }
  const driver = platformEffects().driver
  const nameservers = await driver.nameservers(registration.domain)
  if (nameservers.ok === 'no') return domainsError(503, DNS_UNAVAILABLE, { code: 'registrar-unavailable' })
  const siteConnected = await siteServesOrRefuse(registration)
  if (siteConnected instanceof Response) return siteConnected
  if (!nameservers.value.ours) {
    return domainsJson({ ours: false, nameservers: nameservers.value.nameservers, siteConnected, records: [] })
  }
  const listed = await driver.listDnsRecords(registration.domain)
  if (listed.ok === 'no') return domainsError(503, DNS_UNAVAILABLE, { code: 'registrar-unavailable' })
  const records: DnsRecordView[] = listed.value.map((record) => ({
    id: record.id,
    type: record.type,
    name: record.name,
    value: record.value,
    ttl: record.ttl,
    priority: record.priority,
    managed: isAglynManagedRecord(record, siteConnected),
    editable: (DNS_EDITABLE_TYPES as readonly string[]).includes(record.type),
  }))
  return domainsJson({ ours: true, nameservers: nameservers.value.nameservers, siteConnected, records })
}

const MANAGED_REFUSAL = `That record keeps your site reachable at this domain, with its security certificate, so ${PLATFORM_BRAND_NAME} keeps it. Disconnect the domain from its site first to change it.`

/** POST: creates, changes or deletes one record. */
async function dnsWriteRoute(request: Request): Promise<Response> {
  const gate = await domainsGate(request, { billing: false, scope: 'workspace', entitlement: false })
  if (gate instanceof Response) return gate
  const registration = await ownRegistration(gate.actor, gate.body)
  if (registration instanceof Response) return registration
  if (registration.status !== 'active') {
    return domainsError(409, 'DNS records can be edited once the domain is registered here.', {
      code: 'not-active',
    })
  }
  const action = String(gate.body['action'] ?? '')
  if (action !== 'create' && action !== 'update' && action !== 'delete') {
    return domainsError(400, 'Unknown change.')
  }
  const driver = platformEffects().driver
  const nameservers = await driver.nameservers(registration.domain)
  if (nameservers.ok === 'no') return domainsError(503, DNS_UNAVAILABLE, { code: 'registrar-unavailable' })
  if (!nameservers.value.ours) {
    return domainsError(409, 'This domain uses another provider’s nameservers, so its records are edited there.', {
      code: 'not-our-nameservers',
    })
  }
  const siteConnected = await siteServesOrRefuse(registration)
  if (siteConnected instanceof Response) return siteConnected

  let existing = null as null | { id: string; type: string; name: string; creator: string | null }
  if (action !== 'create') {
    const recordId = String(gate.body['recordId'] ?? '')
    const listed = await driver.listDnsRecords(registration.domain)
    if (listed.ok === 'no') return domainsError(503, DNS_UNAVAILABLE, { code: 'registrar-unavailable' })
    existing = listed.value.find((record) => record.id === recordId) ?? null
    if (!existing) return domainsError(404, 'That record is gone. Refresh the list.', { code: 'unknown-record' })
    if (isAglynManagedRecord(existing, siteConnected)) {
      return domainsError(409, MANAGED_REFUSAL, { code: 'managed' })
    }
    if (!(DNS_EDITABLE_TYPES as readonly string[]).includes(existing.type)) {
      return domainsError(409, 'That kind of record can’t be changed here.', { code: 'not-editable' })
    }
  }
  if (action === 'delete' && existing) {
    const deleted = await driver.deleteDnsRecord(registration.domain, existing.id)
    if (deleted.ok === 'no') return domainsError(deleted.retryable ? 503 : 409, DNS_UNAVAILABLE, { code: deleted.code })
    await updateRegistration(registration.domain, {}, { event: 'dns-record-deleted', detail: existing.type })
    await logDomainActivity(gate.actor, registration.domain, 'Deleted a DNS record', null)
    return domainsJson({ ok: true })
  }

  const input = (gate.body['record'] ?? {}) as Partial<DnsRecordInput>
  const invalid = invalidDnsRecordFields(input, registration.domain)
  if (invalid.length) {
    return domainsError(400, 'Some of the record’s fields are missing or not valid.', {
      code: 'record',
      fields: invalid,
    })
  }
  const record = toRegistrarRecord(input as DnsRecordInput, registration.domain)
  if (wouldReplaceSiteAddress(record, siteConnected)) {
    return domainsError(409, MANAGED_REFUSAL, { code: 'managed' })
  }
  const written =
    action === 'create'
      ? await driver.createDnsRecord(registration.domain, record)
      : await driver.updateDnsRecord((existing as { id: string }).id, record)
  if (written.ok === 'no') {
    return domainsError(
      written.retryable ? 503 : 409,
      written.retryable
        ? DNS_UNAVAILABLE
        : 'The registrar didn’t accept that record. Check that it doesn’t clash with another record of the same name.',
      { code: written.code },
    )
  }
  await updateRegistration(
    registration.domain,
    {},
    { event: action === 'create' ? 'dns-record-added' : 'dns-record-changed', detail: record.type },
  )
  await logDomainActivity(
    gate.actor,
    registration.domain,
    action === 'create' ? 'Added a DNS record' : 'Changed a DNS record',
    null,
  )
  return domainsJson({ ok: true })
}
