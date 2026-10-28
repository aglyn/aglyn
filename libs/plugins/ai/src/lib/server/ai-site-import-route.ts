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

/**
 * The "Bring my site" doors (AGL-3974, parent AGL-3973).
 *
 *   GET  /api/ai/site-import/ownership?orgId=      the org's claims
 *   POST /api/ai/site-import/ownership             { orgId, action, domain, … }
 *        action `claim`                             start a claim (idempotent)
 *        action `check`, method `dns` | `meta`      look for the record or tag now
 *        action `send-code`, email                  email a code to an address at the domain
 *        action `confirm-code`, code                check the code
 *   POST /api/ai/site-import/crawl                 { orgId, domain, maxPages? }
 *        the site's inventory, for a domain the org has a CURRENT proof for
 *
 * The rungs, in order, each disclosing nothing a lower one would:
 *
 *   401  no bearer token, or a refused one
 *   403  email unverified (an impersonation session is exempt)
 *   400  the request did not name the org (AGL-1934)
 *   403  not a member of that org
 *   404  `release_ai_site_import` is off; a verified staff claim previews
 *   403  `reason: 'role'`: the caller is not the org's owner or an admin
 *   403  `reason: 'plan'`: the org is on the Free plan; import is for every
 *        paid plan
 *   423  lockdown
 *
 * Nothing here spends model credits: the crawl reads and returns, and the
 * import job (another lane) decides what becomes a page.
 */

import type { DecodedIdToken } from 'firebase-admin/auth'
import { resolveEffectivePlan, resolveOrgEntitlements } from '@aglyn/aglyn/app-utils/plan-entitlements'
import type { AglynOrganization, AglynOrgMember } from '@aglyn/aglyn/foundation/definitions/organization.types'
import { addAdminAudit } from '@aglyn/tenant-data-admin/server/admin-audit-write'
import {
  checkDomainOwnership,
  confirmDomainOwnershipCode,
  DOMAIN_OWNERSHIP_META_NAME,
  isDomainOwnershipProven,
  issueDomainOwnershipClaim,
  listDomainOwnershipClaims,
  normalizeOwnershipDomain,
  sendDomainOwnershipCode,
  type DomainOwnershipDeps,
} from '@aglyn/tenant-data-admin/server/domain-ownership'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin/server/firebase-admin'
import { invalidIdTokenResponse } from '@aglyn/tenant-data-admin/server/id-token-refusal'
import { lockdownRefusal } from '@aglyn/tenant-data-admin/server/lockdown'
import { getOrgForUser, memberHasOrgPermission } from '@aglyn/tenant-data-admin/server/organizations'
import { permissionRefusalText } from '@aglyn/aglyn/app-utils/org-permissions'
import { consumeRateLimit } from '@aglyn/tenant-data-admin/server/rate-limit-store'
import { isServerReleaseFlagOnForOrg } from '@aglyn/tenant-data-admin/server/release-flags'
import { FieldValue } from 'firebase-admin/firestore'
import {
  crawlSiteForImport,
  readSiteVerificationMeta,
  type SiteImportCrawlSeams,
} from '../site-import/site-import-crawl'
import { SITE_IMPORT_RELEASE_FLAG } from '../site-import/site-import-flag'

export { SITE_IMPORT_RELEASE_FLAG }

/** Pages the crawl door reads in one request; the import job reads in waves. */
export const SITE_IMPORT_DOOR_MAX_PAGES = 25

/** Crawls one org may run through the door in a day. */
export const SITE_IMPORT_CRAWLS_PER_ORG_PER_DAY = 20

/** DNS and home-page checks one org may run in an hour. */
export const SITE_IMPORT_CHECKS_PER_ORG_PER_HOUR = 60

/** The door's own clock for a crawl, inside the route's `maxDuration`. */
const SITE_IMPORT_DOOR_TIME_MS = 45_000

export interface SiteImportGateContext {
  uid: string
  decoded: DecodedIdToken
  staff: boolean
  orgId: string
  org: Partial<AglynOrganization>
  member: AglynOrgMember | null
  firestore: FirebaseFirestore.Firestore
}

/** What the doors reach outside the process, replaceable in a spec. */
export interface SiteImportRouteSeams {
  ownership?: DomainOwnershipDeps
  crawl?: SiteImportCrawlSeams
}

function bearerToken(request: Request): string | undefined {
  const authorization = request.headers.get('authorization') ?? ''
  return authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : undefined
}

export async function siteImportGate(
  request: Request,
  rawOrgId: string,
): Promise<Response | SiteImportGateContext> {
  const idToken = bearerToken(request)
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  const app = firebaseAdmin.app()
  let decoded: DecodedIdToken
  try {
    decoded = await app.auth().verifyIdToken(idToken)
  } catch (error) {
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    throw error
  }
  if (!decoded.email_verified && !isImpersonationSession(decoded)) return emailUnverifiedResponse()
  const staff = decoded['staff'] === true
  const orgId = String(rawOrgId ?? '').trim()
  if (!orgId) {
    return Response.json({ error: 'Open a workspace before using this feature' }, { status: 400 })
  }
  const resolved = await getOrgForUser(decoded.uid, orgId)
  if (!resolved || resolved.orgId !== orgId) {
    return Response.json({ error: 'You are not a member of that organization' }, { status: 403 })
  }
  if (!staff && !(await isServerReleaseFlagOnForOrg(SITE_IMPORT_RELEASE_FLAG, orgId))) {
    return Response.json({ error: 'Not found' }, { status: 404 })
  }
  const member = resolved.member ?? null
  // "Bring a site in" (`ai.import`, AGL-4047), whose default is the owner and
  // admin this asked for.
  if (!member || !(await memberHasOrgPermission(orgId, member, 'ai.import'))) {
    return Response.json(
      { error: permissionRefusalText('ai.import'), reason: 'role' },
      { status: 403 },
    )
  }
  const org = resolved.org ?? {}
  if (resolveEffectivePlan(org) === 'free') {
    return Response.json(
      { error: 'Bringing an existing site in is included on every paid plan.', reason: 'plan' },
      { status: 403 },
    )
  }
  const locked = await lockdownRefusal({
    request,
    staff,
    uid: decoded.uid,
    org: org as Record<string, unknown>,
  })
  if (locked) return locked
  return { uid: decoded.uid, decoded, staff, orgId, org, member, firestore: app.firestore() }
}

/**
 * Whether "Bring my site" is offered to this reader (AGL-3976), in the
 * doors' own order, for Create site's choice card: `null` while the flag is
 * off (the card is not drawn), `role` or `plan` for a refusal the workspace
 * can change (the card is drawn disabled with the reason), `ready` otherwise.
 * Read by the jobs list only when the card asks, so no other read pays for it.
 */
export async function siteImportOfferFor(input: {
  orgId: string
  staff: boolean
  org: Partial<AglynOrganization> | null
  member: AglynOrgMember | null
}): Promise<'ready' | 'role' | 'plan' | null> {
  try {
    if (!input.staff && !(await isServerReleaseFlagOnForOrg(SITE_IMPORT_RELEASE_FLAG, input.orgId))) return null
  } catch {
    return null
  }
  if (!input.member || !(await memberHasOrgPermission(input.orgId, input.member, 'ai.import'))) return 'role'
  if (resolveEffectivePlan(input.org ?? {}) === 'free') return 'plan'
  return 'ready'
}

async function audit(
  gate: SiteImportGateContext,
  action: string,
  domain: string,
  after: Record<string, unknown>,
): Promise<void> {
  try {
    await addAdminAudit(gate.firestore, {
      actorUid: gate.uid,
      actorEmail: gate.decoded.email ?? null,
      action,
      target: `orgs/${gate.orgId}/domainOwnershipClaims/${domain}`,
      after: { ...after, ...(gate.staff ? { staff: true } : {}) },
      at: FieldValue.serverTimestamp(),
    })
  } catch (error) {
    console.error('site import audit write failed', { orgId: gate.orgId, action, error })
  }
}

function ownershipDeps(seams: SiteImportRouteSeams): DomainOwnershipDeps {
  return {
    readVerificationMeta: (domain) =>
      readSiteVerificationMeta(domain, DOMAIN_OWNERSHIP_META_NAME, seams.crawl),
    ...seams.ownership,
  }
}

const tooMany = (error: string) => Response.json({ error, reason: 'rate' }, { status: 429 })

/** `GET /api/ai/site-import/ownership?orgId=`. */
export async function listSiteImportOwnership(
  request: Request,
  seams: SiteImportRouteSeams = {},
): Promise<Response> {
  const orgId = new URL(request.url).searchParams.get('orgId') ?? ''
  const gate = await siteImportGate(request, orgId)
  if (gate instanceof Response) return gate
  const claims = await listDomainOwnershipClaims(gate.orgId, ownershipDeps(seams))
  return Response.json({ claims })
}

/** `POST /api/ai/site-import/ownership`. */
export async function postSiteImportOwnership(
  request: Request,
  seams: SiteImportRouteSeams = {},
): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') {
    return Response.json({ error: 'Send a JSON body' }, { status: 400 })
  }
  const gate = await siteImportGate(request, String(body['orgId'] ?? ''))
  if (gate instanceof Response) return gate
  const deps = ownershipDeps(seams)
  const action = String(body['action'] ?? '')
  const domain = String(body['domain'] ?? '')

  if (action === 'claim') {
    const { claim, error } = await issueDomainOwnershipClaim(gate.orgId, domain, gate.uid, deps)
    if (!claim) return Response.json({ error }, { status: 400 })
    await audit(gate, 'site-import.ownership.claim', claim.domain, { status: claim.status })
    return Response.json({ claim })
  }

  if (action === 'check') {
    const method = body['method']
    if (method !== 'dns' && method !== 'meta') {
      return Response.json({ error: 'method must be dns or meta' }, { status: 400 })
    }
    const window = await consumeRateLimit(`site-import-ownership-check:${gate.orgId}`, {
      limit: SITE_IMPORT_CHECKS_PER_ORG_PER_HOUR,
      windowMs: 60 * 60 * 1000,
    })
    if (!window.allowed) return tooMany('Too many checks. Try again in an hour.')
    const { result, error } = await checkDomainOwnership(gate.orgId, domain, method, deps)
    if (!result) return Response.json({ error }, { status: 400 })
    if (result.status === 'proven') {
      await audit(gate, 'site-import.ownership.proven', result.claim.domain, {
        method,
        detail: result.claim.provenDetail,
      })
    }
    return Response.json({ result })
  }

  if (action === 'send-code') {
    const sent = await sendDomainOwnershipCode(
      gate.orgId,
      domain,
      String(body['email'] ?? ''),
      { org: gate.org as Record<string, unknown> },
      deps,
    )
    if (!sent.claim) return Response.json({ error: sent.error }, { status: sent.status })
    await audit(gate, 'site-import.ownership.code-sent', sent.claim.domain, {
      address: sent.claim.email.pendingAddress,
    })
    return Response.json({ claim: sent.claim })
  }

  if (action === 'confirm-code') {
    const { result, error } = await confirmDomainOwnershipCode(gate.orgId, domain, String(body['code'] ?? ''), deps)
    if (!result) return Response.json({ error }, { status: 400 })
    if (result.status === 'proven') {
      await audit(gate, 'site-import.ownership.proven', result.claim.domain, {
        method: 'email',
        detail: result.claim.provenDetail,
      })
    }
    return Response.json({ result })
  }

  return Response.json(
    { error: 'action must be claim, check, send-code or confirm-code' },
    { status: 400 },
  )
}

/** `POST /api/ai/site-import/crawl`. */
export async function postSiteImportCrawl(
  request: Request,
  seams: SiteImportRouteSeams = {},
): Promise<Response> {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') {
    return Response.json({ error: 'Send a JSON body' }, { status: 400 })
  }
  const gate = await siteImportGate(request, String(body['orgId'] ?? ''))
  if (gate instanceof Response) return gate
  const { domain, error } = normalizeOwnershipDomain(String(body['domain'] ?? ''))
  if (!domain) return Response.json({ error }, { status: 400 })
  // Ownership BEFORE any page is read: a crawl of a site the org has not
  // proved is exactly the clone this whole feature is built to refuse.
  if (!(await isDomainOwnershipProven(gate.orgId, domain, ownershipDeps(seams)))) {
    return Response.json(
      { error: 'Verify that you own this site first.', reason: 'ownership' },
      { status: 403 },
    )
  }
  const window = await consumeRateLimit(`site-import-crawl:${gate.orgId}`, {
    limit: SITE_IMPORT_CRAWLS_PER_ORG_PER_DAY,
    windowMs: 24 * 60 * 60 * 1000,
  })
  if (!window.allowed) return tooMany('This workspace has read sites enough times today. Try again tomorrow.')
  const planPages = resolveOrgEntitlements(gate.org).screensPerHost
  const asked = Number(body['maxPages'])
  const maxPages = Math.max(
    1,
    Math.min(
      SITE_IMPORT_DOOR_MAX_PAGES,
      Number.isFinite(planPages) && planPages > 0 ? planPages : SITE_IMPORT_DOOR_MAX_PAGES,
      Number.isFinite(asked) && asked > 0 ? Math.floor(asked) : SITE_IMPORT_DOOR_MAX_PAGES,
    ),
  )
  const inventory = await crawlSiteForImport(
    { domain, maxPages, timeBudgetMs: SITE_IMPORT_DOOR_TIME_MS, signal: request.signal },
    seams.crawl,
  )
  await audit(gate, 'site-import.crawl', domain, {
    pages: inventory.pages.length,
    skipped: inventory.skipped.length + inventory.skippedOverflow,
    loginPagesRefused: inventory.skipped.filter((entry) => entry.reason === 'login-form').length,
    stoppedBy: inventory.stoppedBy,
    refused: inventory.refused,
    bytesRead: inventory.bytesRead,
  })
  return Response.json({ inventory })
}
