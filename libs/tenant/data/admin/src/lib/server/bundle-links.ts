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
 * A STAFF-MINTED BUNDLE CHECKOUT LINK (AGL-3955).
 *
 * At a booth or on a doorstep, a staff member who built the owner's site
 * shows a QR; the owner scans it on their own phone and lands on Billing with
 * the plan, the add-ons, the cadence and the coupon already chosen, one tap
 * from paid. The link itself is an ordinary Billing URL — the query the
 * marketing CTAs and the upgrade proposal already speak — so it works without
 * any record at all.
 *
 * The RECORD is for two things the URL cannot carry honestly:
 *
 * - the chosen domain and its price, which the Billing page shows as a line
 *   of its own and the owner then buys on the site's Custom Domain page. Read
 *   from the record, never from the URL, so an edited link cannot show a name
 *   or a price nobody quoted.
 * - the staff accountability that lets the link stand in for the domains
 *   plugin's 72-hour paid-invoice gate, once (Zach, 2026-10-19). A staff
 *   member met the owner and is named on the `billing.bundle-link-minted`
 *   audit row; the link is for one workspace, lives 24 hours and is spent by
 *   the first purchase it pre-clears. The plugin asks through
 *   `core.purchase-gate-preclearance` and never reads this collection.
 *
 * Documents live in the top-level `bundleLinks` collection, keyed by an
 * unguessable id and carrying the workspace. Only the Admin SDK reads or
 * writes them; the rules deny every client, staff included.
 */

import type { AiTierId, OrgPlan } from '@aglyn/aglyn/server'
import {
  fitBundleAddonsToPlan,
  normalizeBundleDomain,
  parseBundleAddons,
  type AddonKind,
  type BundleAddons,
} from '@aglyn/aglyn/app-utils/bundle-intent'
import { createResourceUid } from '@aglyn/aglyn/app-utils/create-resource-uid'
import { onboardingDestination } from '@aglyn/aglyn/app-utils/onboarding-deep-link'
import { isAiTierId } from '@aglyn/aglyn/app-utils/plan-entitlements'
import {
  isUpgradeProposalPlan,
  normalizeUpgradeProposalBundle,
  upgradeProposalIntent,
} from '@aglyn/aglyn/app-utils/upgrade-proposal'
import {
  isLiveSubscriptionStatus,
  ORG_BILLING_DOC_ID,
  ORG_BILLING_SUBCOLLECTION,
} from '@aglyn/aglyn/app-utils/org-billing-doc'
import type {
  PurchaseGatePreclearance,
  PurchaseGatePreclearanceInput,
} from '@aglyn/aglyn/plugin-manager/purchase-gate-preclearance'
import { FieldValue } from 'firebase-admin/firestore'
import { setAdminAudit } from './admin-audit-write'
import firebaseAdmin from './firebase-admin'

export const BUNDLE_LINKS_COLLECTION = 'bundleLinks'

/** How long a link pre-clears, from its minting. */
export const BUNDLE_LINK_TTL_MS = 24 * 60 * 60 * 1000

/** The query param that names the record, on a link that carries a domain. */
export const BUNDLE_LINK_PARAM = 'bundle'

/** The audit action every mint writes, with the staff member's uid. */
export const BUNDLE_LINK_AUDIT_ACTION = 'billing.bundle-link-minted'

/** The most a quoted domain may cost a year, in cents, before it reads as a typo. */
const DOMAIN_PRICE_MAX_CENTS = 100_000

/** Whether this deployment sells domains: the registrar the domains plugin buys through. */
export function domainsRegistrarConfigured(): boolean {
  return Boolean(String(process.env['DOMAINS_REGISTRAR'] ?? '').trim())
}

export interface BundleLinkDomain {
  /** The registrable name, lower-cased. */
  name: string
  /** The registrar's first-year price when the link was minted, in cents. */
  firstYearCents: number
  /** The yearly renewal price, in cents. */
  renewalCents: number
  /** The site the name is for: where the owner lands to buy it. */
  hostId: string
}

export interface BundleLinkDoc {
  /** The staff member accountable for the link. */
  mintedBy: string
  mintedByEmail: string | null
  /** The one workspace the link is for. */
  workspaceId: string
  createdAt: number
  expiresAt: number
  /** When a purchase spent the link's preclearance; null until then. */
  usedAt: number | null
  /** Which gate the purchase that spent it waived. */
  usedFor?: string
  /** A staff-minted link stands in for the domains plugin's invoice-age gate, once. */
  preclearsDomainGate: true
  intent: {
    plan: OrgPlan
    addons?: BundleAddons
    interval?: 'month' | 'year'
    coupon?: string
    /** The Aglyn AI tier an `ai:<tier>` entry named (AGL-3965). */
    aiTier?: AiTierId
  }
  domain?: BundleLinkDomain
}

/** A mint refused before anything was written. */
export class BundleLinkError extends Error {
  readonly status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = 'BundleLinkError'
    this.status = status
  }
}

export interface MintBundleLinkOptions {
  orgId: string
  /** The staff member minting it. */
  actor: { uid: string; email?: string | null }
  /** The console origin the link is built on. */
  origin: string
  plan: unknown
  addons?: unknown
  interval?: unknown
  coupon?: unknown
  /**
   * The Aglyn AI tier staff chose (AGL-4025), kept with the AI add-on; an
   * `ai:<tier>` entry in `addons` names one too, and this wins when both do.
   */
  aiTier?: unknown
  /** The chosen domain, quoted from the registrar's search; optional. */
  domain?: {
    name?: unknown
    firstYearCents?: unknown
    renewalCents?: unknown
    hostId?: unknown
  } | null
  /** Clock seam. */
  now?: number
}

export interface MintedBundleLink {
  id: string
  url: string
  expiresAt: number
  intent: BundleLinkDoc['intent']
  domain: BundleLinkDomain | null
  /** Add-ons asked for that the plan does not sell, left off the link. */
  droppedAddons: Array<AddonKind | string>
}

const firestore = () => firebaseAdmin.app().firestore()

function cents(value: unknown): number | null {
  const number = Math.round(Number(value))
  return Number.isFinite(number) && number > 0 && number <= DOMAIN_PRICE_MAX_CENTS ? number : null
}

/**
 * Mint a link for one workspace: validate the bundle the way the proposal
 * does, write the record and its audit row in one batch, and answer the URL.
 *
 * Refused for a plan the workspace cannot buy itself, for a workspace with a
 * live subscription (checkout would refuse it; plan changes are Billing's),
 * and for a domain on a deployment that does not sell domains, for a site
 * outside the workspace, or without a price.
 */
export async function mintBundleLink(options: MintBundleLinkOptions): Promise<MintedBundleLink> {
  const { orgId, actor, origin } = options
  const now = options.now ?? Date.now()
  if (!orgId) throw new BundleLinkError('Missing orgId')
  if (!isUpgradeProposalPlan(options.plan)) {
    throw new BundleLinkError('Choose a paid plan the workspace can buy itself')
  }
  const plan: OrgPlan = options.plan
  const parsed = parseBundleAddons(options.addons)
  const fitted = fitBundleAddonsToPlan(parsed.addons, plan)
  const bundle = normalizeUpgradeProposalBundle(plan, {
    addons: fitted.addons,
    interval: options.interval,
    coupon: options.coupon,
    // The tier staff chose (AGL-4025), or the one an `ai:<tier>` entry named
    // (AGL-3965), kept with the AI add-on.
    aiTier: isAiTierId(options.aiTier) ? options.aiTier : parsed.aiTier,
  })
  const intent: BundleLinkDoc['intent'] = { plan, ...bundle }

  const db = firestore()
  const orgRef = db.collection('orgs').doc(orgId)
  const [orgSnapshot, billingSnapshot] = await Promise.all([
    orgRef.get(),
    orgRef.collection(ORG_BILLING_SUBCOLLECTION).doc(ORG_BILLING_DOC_ID).get(),
  ])
  if (!orgSnapshot.exists) throw new BundleLinkError('Unknown organization', 404)
  const slug = orgSnapshot.get('slug')
  if (typeof slug !== 'string' || !slug) {
    throw new BundleLinkError('This workspace has no address yet, so no link can point at it', 409)
  }
  const status =
    (billingSnapshot.get('subscription') as { status?: unknown } | undefined)?.status ??
    orgSnapshot.get('billingStatus')
  if (isLiveSubscriptionStatus(status)) {
    throw new BundleLinkError(
      'This workspace already has a live subscription; change its plan from Billing instead',
      409,
    )
  }

  let domain: BundleLinkDomain | null = null
  if (options.domain && options.domain.name) {
    if (!domainsRegistrarConfigured()) {
      throw new BundleLinkError('Buying a domain is not available on this deployment yet', 409)
    }
    const name = normalizeBundleDomain(options.domain.name)
    if (!name) throw new BundleLinkError('That is not a domain name')
    const firstYearCents = cents(options.domain.firstYearCents)
    const renewalCents = cents(options.domain.renewalCents)
    if (firstYearCents === null || renewalCents === null) {
      throw new BundleLinkError('Quote the domain’s first-year and renewal prices from its search')
    }
    const hostId = String(options.domain.hostId ?? '').trim()
    const host = hostId ? await db.collection('hosts').doc(hostId).get() : null
    if (!host?.exists || host.get('orgId') !== orgId) {
      throw new BundleLinkError('Choose the site in this workspace the domain is for')
    }
    domain = { name, firstYearCents, renewalCents, hostId }
  }

  const ref = db.collection(BUNDLE_LINKS_COLLECTION).doc(createResourceUid())
  const doc: BundleLinkDoc = {
    mintedBy: actor.uid,
    mintedByEmail: actor.email ?? null,
    workspaceId: orgId,
    createdAt: now,
    expiresAt: now + BUNDLE_LINK_TTL_MS,
    usedAt: null,
    preclearsDomainGate: true,
    intent,
    ...(domain ? { domain } : {}),
  }
  const batch = db.batch()
  batch.set(ref, doc)
  setAdminAudit(batch, db, {
    actorUid: actor.uid,
    ...(actor.email ? { actorEmail: actor.email } : {}),
    action: BUNDLE_LINK_AUDIT_ACTION,
    target: `orgs/${orgId}`,
    after: {
      bundleLinkId: ref.id,
      intent,
      domain,
      expiresAt: doc.expiresAt,
      preclearsDomainGate: true,
    },
    at: FieldValue.serverTimestamp(),
  })
  await batch.commit()

  const path = onboardingDestination(slug, upgradeProposalIntent(intent))
  const url = `${origin}${path}${domain ? `&${BUNDLE_LINK_PARAM}=${ref.id}` : ''}`
  return {
    id: ref.id,
    url,
    expiresAt: doc.expiresAt,
    intent,
    domain,
    droppedAddons: [...parsed.dropped, ...fitted.notSold],
  }
}

/** Whether a stored link still pre-clears: unused, unexpired, and flagged. */
export function bundleLinkIsLive(doc: Partial<BundleLinkDoc> | undefined, now: number): boolean {
  return (
    !!doc &&
    doc.preclearsDomainGate === true &&
    (doc.usedAt === null || doc.usedAt === undefined) &&
    typeof doc.expiresAt === 'number' &&
    doc.expiresAt > now
  )
}

/**
 * The workspace's live link, or null. Read by the workspace alone (a
 * single-field equality, no composite index) and narrowed here: a workspace
 * holds a handful of links at most, each gone in a day.
 */
async function liveLinkFor(orgId: string, now: number): Promise<{ id: string } | null> {
  const snapshot = await firestore()
    .collection(BUNDLE_LINKS_COLLECTION)
    .where('workspaceId', '==', orgId)
    .limit(50)
    .get()
  const live = snapshot.docs
    .filter((doc) => bundleLinkIsLive(doc.data() as Partial<BundleLinkDoc>, now))
    .sort((a, b) => Number(b.get('createdAt') ?? 0) - Number(a.get('createdAt') ?? 0))
  return live[0] ? { id: live[0].id } : null
}

/**
 * The bundle links' answer to `core.purchase-gate-preclearance`.
 *
 * `check` reads only. `consume` marks the link used in a transaction that
 * writes only when nothing has, so two purchases racing on one link spend it
 * once: the second reads `usedAt` set and answers false.
 */
export function bundleLinkPreclearance(options: { now?: () => number } = {}): PurchaseGatePreclearance {
  const clock = options.now ?? (() => Date.now())
  return {
    async check(input: PurchaseGatePreclearanceInput) {
      const orgId = String(input?.orgId ?? '').trim()
      if (!orgId || input?.gate !== 'domain-payment-history') return null
      const live = await liveLinkFor(orgId, clock())
      return live ? { preclearanceId: live.id } : null
    },
    async consume(preclearanceId: string) {
      const id = String(preclearanceId ?? '').trim()
      if (!id || id.includes('/')) return false
      const db = firestore()
      const ref = db.collection(BUNDLE_LINKS_COLLECTION).doc(id)
      return db.runTransaction(async (tx) => {
        const snapshot = await tx.get(ref)
        if (!snapshot.exists) return false
        const now = clock()
        if (!bundleLinkIsLive(snapshot.data() as Partial<BundleLinkDoc>, now)) return false
        tx.update(ref, { usedAt: now, usedFor: 'domain-payment-history' })
        return true
      })
    },
  }
}

export interface BundleLinkDomainLine {
  name: string
  firstYearCents: number
  renewalCents: number
  /** The site's Custom Domain page segment: its subdomain, else its id. */
  host: string
  hostId: string
}

/**
 * The domain line Billing shows for a link (AGL-3955), or why there is none:
 * the link is for another workspace, is spent or expired, names no domain,
 * or this deployment does not sell domains (`available: false`, so the page
 * can show the line disabled with the reason rather than hide it).
 */
export async function readBundleLinkDomain(
  orgId: string,
  linkId: string,
  now: number = Date.now(),
): Promise<{ domain: BundleLinkDomainLine | null; available: boolean }> {
  const available = domainsRegistrarConfigured()
  const id = String(linkId ?? '').trim()
  if (!orgId || !id || id.includes('/')) return { domain: null, available }
  const db = firestore()
  const snapshot = await db.collection(BUNDLE_LINKS_COLLECTION).doc(id).get()
  const doc = snapshot.data() as Partial<BundleLinkDoc> | undefined
  if (!snapshot.exists || doc?.workspaceId !== orgId || !doc?.domain) {
    return { domain: null, available }
  }
  if (!bundleLinkIsLive(doc, now)) return { domain: null, available }
  const host = await db.collection('hosts').doc(doc.domain.hostId).get()
  if (!host.exists || host.get('orgId') !== orgId) return { domain: null, available }
  return {
    available,
    domain: {
      name: doc.domain.name,
      firstYearCents: doc.domain.firstYearCents,
      renewalCents: doc.domain.renewalCents,
      hostId: doc.domain.hostId,
      host: String(host.get('subdomain') ?? doc.domain.hostId),
    },
  }
}
