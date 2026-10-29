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

import { holdsSiteKey, siteKeyRefusal } from '@aglyn/aglyn/app-utils/host-permissions'
import { checkEntitlement } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { DOMAINS_MANAGE_REFUSAL } from '../model/domains-permissions'
import { checkPurchaseGatePreclearance } from '@aglyn/aglyn/plugin-manager/purchase-gate-preclearance'
import { lookalikeBrandForHost } from '@aglyn/shared-util-email/outbound-phishing-screen'
import {
  firebaseAdmin,
  getOrgForHost,
  memberHasOrgPermission,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import { isPaymentFraudHeld } from '@aglyn/tenant-data-admin/server/payment-fraud-hold'
import { isEmailVerified, isImpersonationSession } from '@aglyn/tenant-data-admin/server/firebase-admin'
import { isRefusedIdToken } from '@aglyn/tenant-data-admin/server/id-token-refusal'
import { HOLDING_STATUSES, type DomainRegistrationDoc } from '../model/registration'
import { db, listRegistrations } from './db'
import { PURCHASE_REFUSAL_COPY, type PurchaseRefusal } from './purchase-refusals'

/*
 * WHO MAY BUY A DOMAIN, AND WHEN (AGL-3962).
 *
 * The console's dispatcher has already refused an unverified account, a
 * lockdown and a caller over the write limit. What it cannot know is the
 * member and the money:
 *
 *   401  no bearer token, or one the verifier refused
 *   403  unverified address (impersonation exempt), not the site's admin (or,
 *        at the workspace level, not a workspace owner or admin), or a member
 *        without `billing.manage` — a domain is a charge
 *   402  the plan does not include custom domains
 *   400  no site named, or at the workspace level no workspace named
 *
 * Two levels (AGL-4040). A site's Custom Domain page names its site
 * (`hostId`); the workspace's Domains page names the workspace (`orgId`) and
 * no site, and only a workspace owner or admin reaches it, since every name
 * the workspace holds — and every one of its sites — is in play there.
 *
 * And for a purchase, the fraud gates, because a registration cannot be
 * taken back once the registrar completes it and a name bought to phish is a
 * complaint against the platform's own registrar account:
 *
 *   - the workspace has PAID us before, at least {@link PAID_HISTORY_MIN_AGE_MS}
 *     ago — a stolen card that just bought a plan has not cleared a
 *     chargeback window, and the first paying customer was exactly that;
 *   - it is not on a payment-fraud hold;
 *   - the name does not imitate a brand (refused, not merely flagged: a site
 *     can be taken down, a registered name lives on at the registry);
 *   - it is under the purchase caps.
 *
 * Staff pass the cool-down and the caps — a comped client's workspace has no
 * payment history of its own — and never the brand check. An owner a staff
 * member met in person passes the cool-down alone, once, on core's
 * preclearance (AGL-3955; {@link purchaseClearance}).
 */

export const PAID_HISTORY_MIN_AGE_MS = 72 * 60 * 60 * 1000

/** Names a workspace may buy in a rolling 30 days. */
export const PURCHASES_PER_30_DAYS = 3

/** Names a workspace may hold in all. */
export const MAX_HELD_PER_WORKSPACE = 25

export interface DomainsActor {
  uid: string
  email: string
  name: string
  staff: boolean
  orgId: string
  org: Record<string, unknown>
  /** The site the request names; null at the workspace level (AGL-4040). */
  hostId: string | null
  host: Record<string, unknown> | null
}

/**
 * Where a route may be called from: a site's page (`hostId`), the
 * workspace's Domains page (`orgId`), or either — a request naming a site is
 * then gated as the site's.
 */
export type DomainsGateScope = 'site' | 'workspace' | 'either'

const NO_STORE = { 'Cache-Control': 'no-store' }

export function domainsJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE })
}

export function domainsError(
  status: number,
  error: string,
  extra: Record<string, unknown> = {},
): Response {
  return Response.json({ error, ...extra }, { status, headers: NO_STORE })
}

export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  if (request.method === 'GET') return {}
  const body = await request.json().catch(() => null)
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {}
}

const DOCUMENT_ID = /^[A-Za-z0-9_-]{1,128}$/

/**
 * The member half every route climbs. `billing` additionally requires the
 * workspace's `billing.manage` permission, for anything that charges or
 * changes what will be charged. `entitlement` (default on) requires the
 * plan's custom domains; a route that only manages a name the workspace
 * already holds passes it off, so a workspace that moved to a plan without
 * domains can still turn renewals off or move its names away.
 */
export async function domainsGate(
  request: Request,
  options: { billing: boolean; scope?: DomainsGateScope; entitlement?: boolean },
): Promise<{ actor: DomainsActor; body: Record<string, unknown> } | Response> {
  const scope = options.scope ?? 'site'
  const authorization = request.headers.get('authorization') ?? ''
  if (!authorization.startsWith('Bearer ')) return domainsError(401, 'Unauthenticated')
  let decoded
  try {
    decoded = await firebaseAdmin
      .app()
      .auth()
      .verifyIdToken(authorization.slice('Bearer '.length))
  } catch (error) {
    if (!isRefusedIdToken(error)) throw error
    return domainsError(401, 'Unauthenticated')
  }
  if (!isEmailVerified(decoded) && !isImpersonationSession(decoded)) {
    return domainsError(403, 'Verify your email address first')
  }
  const body = await readJsonBody(request)
  const params = new URL(request.url).searchParams
  const hostId = String(body['hostId'] ?? params.get('hostId') ?? '')
  const staff = decoded['staff'] === true
  const atSite = scope === 'site' || (scope === 'either' && hostId !== '')

  let orgId: string
  let org: Record<string, unknown>
  let host: Record<string, unknown> | null = null
  if (atSite) {
    if (!DOCUMENT_ID.test(hostId)) return domainsError(400, 'Missing hostId')
    const hostSnapshot = await db().collection('hosts').doc(hostId).get()
    if (!hostSnapshot.exists) return domainsError(404, 'Unknown site')
    host = (hostSnapshot.data() ?? {}) as Record<string, unknown>
    // "Manage site settings" (`site.manage`, AGL-4047), read as the rules read it.
    if (!staff && !holdsSiteKey(host, decoded.uid, 'site.manage')) {
      return domainsError(403, siteKeyRefusal('site.manage'))
    }
    const resolved = await getOrgForHost(hostId)
    if (!resolved) return domainsError(404, 'Unknown workspace')
    orgId = resolved.orgId
    org = resolved.org as Record<string, unknown>
  } else {
    orgId = String(body['orgId'] ?? params.get('orgId') ?? '')
    if (!DOCUMENT_ID.test(orgId)) return domainsError(400, 'Missing orgId')
    const orgSnapshot = await db().collection('orgs').doc(orgId).get()
    if (!orgSnapshot.exists) return domainsError(404, 'Unknown workspace')
    org = (orgSnapshot.data() ?? {}) as Record<string, unknown>
    if (!staff) {
      // "Manage the workspace's domains" (AGL-4047): its default is the
      // owner and admins this asked for before, then the member's custom
      // role and their own permissions.
      const membership = await resolveOrgMembership(decoded.uid, orgId).catch(() => null)
      if (!membership || !(await memberHasOrgPermission(orgId, membership.member, 'domains.manage' as never))) {
        return domainsError(403, DOMAINS_MANAGE_REFUSAL, { code: 'workspace-admin' })
      }
    }
  }
  if (options.billing && !staff) {
    const membership = await resolveOrgMembership(decoded.uid, orgId)
    const allowed =
      membership &&
      (await memberHasOrgPermission(orgId, membership.member, 'billing.manage' as never))
    if (!allowed) {
      return domainsError(
        403,
        'Only a workspace member who manages billing can buy or renew a domain',
        { code: 'billing-permission' },
      )
    }
  }
  if (options.entitlement !== false && !checkEntitlement(org as never, 'customDomain')) {
    return domainsError(402, 'Custom domains are included from the Starter plan', {
      code: 'plan',
    })
  }
  return {
    actor: {
      uid: decoded.uid,
      email: String(decoded.email ?? ''),
      name: String(decoded['name'] ?? decoded.email ?? ''),
      staff,
      orgId,
      org,
      hostId: atSite ? hostId : null,
      host,
    },
    body,
  }
}

// The refusals and their copy live in a pure module the purchase sequence
// shares; re-exported so every caller keeps importing them from here.
export { PURCHASE_REFUSAL_COPY, type PurchaseRefusal }

/**
 * What {@link purchaseClearance} decides: a refusal, or a go-ahead. A
 * go-ahead carries `preclearanceId` when a staff preclearance stood in for
 * the payment history, which the purchase then spends.
 */
export type PurchaseClearance =
  | { refusal: PurchaseRefusal; preclearanceId: null }
  | { refusal: null; preclearanceId: string | null }

/**
 * Whether this actor's workspace may buy `domain` now — or move it here,
 * since a transfer in is a charge the same gates guard (AGL-4040). Never throws: a read
 * that fails refuses, because a purchase is the one place a wrong "yes"
 * costs money that cannot be recovered.
 *
 * The 72 h payment history alone may be stood in for, by core's
 * `core.purchase-gate-preclearance` (AGL-3955): a staff member who met the
 * owner minted a single-use bundle link for this workspace. It is asked
 * last, only once every other check has passed, so a lookalike name, a
 * fraud hold or a cap still refuses with one in hand. Asking does not spend
 * it: its id comes back with the go-ahead, and the purchase spends it after
 * the hold and before the charge.
 */
export async function purchaseClearance(
  actor: DomainsActor,
  domain: string,
  nowMs = Date.now(),
): Promise<PurchaseClearance> {
  const refuse = (refusal: PurchaseRefusal): PurchaseClearance => ({
    refusal,
    preclearanceId: null,
  })
  const clear: PurchaseClearance = { refusal: null, preclearanceId: null }
  if (lookalikeBrandForHost(domain)) return refuse('lookalike')
  if (actor.staff) return clear
  const forOrg = await listRegistrations('orgId', actor.orgId)
  if (await isPaymentFraudHeld(db(), actor.orgId).catch(() => true)) return refuse('fraud-hold')
  if (forOrg.filter(holds).length >= MAX_HELD_PER_WORKSPACE) return refuse('too-many-held')
  const recent = forOrg.filter(
    (registration) =>
      nowMs - (registration.createdAtMs ?? 0) < 30 * 24 * 60 * 60 * 1000 &&
      registration.status !== 'declined',
  )
  if (recent.length >= PURCHASES_PER_30_DAYS) return refuse('too-many-recently')
  if (!(await hasClearedPayment(actor.orgId, nowMs))) {
    // Core's check fails closed (null on any error); the catch is for a
    // seam that ever stops promising that.
    const waiver = await checkPurchaseGatePreclearance({
      orgId: actor.orgId,
      gate: 'domain-payment-history',
    }).catch(() => null)
    if (!waiver?.preclearanceId) return refuse('no-payment-history')
    return { refusal: null, preclearanceId: waiver.preclearanceId }
  }
  return clear
}

/** {@link purchaseClearance}'s refusal alone: what the card is told before the click. */
export async function purchaseRefusal(
  actor: DomainsActor,
  domain: string,
  nowMs = Date.now(),
): Promise<PurchaseRefusal | null> {
  return (await purchaseClearance(actor, domain, nowMs)).refusal
}

function holds(registration: DomainRegistrationDoc): boolean {
  return HOLDING_STATUSES.includes(registration.status)
}

/**
 * A paid platform invoice recorded at least {@link PAID_HISTORY_MIN_AGE_MS}
 * ago, never charged back. `platformRevenue` holds one row per paid invoice
 * (AGL-1811).
 */
async function hasClearedPayment(orgId: string, nowMs: number): Promise<boolean> {
  try {
    const rows = await db()
      .collection('platformRevenue')
      .where('orgId', '==', orgId)
      .limit(25)
      .get()
    return rows.docs.some((row) => {
      if (!(Number(row.get('grossCents')) > 0)) return false
      if (Number(row.get('chargedBackCents') ?? 0) > 0) return false
      const recordedAt = row.get('recordedAt') as { toMillis?: () => number } | undefined
      const recordedMs = recordedAt?.toMillis?.() ?? 0
      return recordedMs > 0 && nowMs - recordedMs >= PAID_HISTORY_MIN_AGE_MS
    })
  } catch {
    return false
  }
}
