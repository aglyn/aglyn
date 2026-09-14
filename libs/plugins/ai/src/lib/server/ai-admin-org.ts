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

import {
  isLiveSubscriptionStatus,
  ORG_BILLING_DOC_ID,
  ORG_BILLING_SUBCOLLECTION,
  isLiveSubscriptionStatus,
  orgCogsInputFrom,
  pluginRequestFromWeb,
} from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  readOrgBilling,
} from '@aglyn/tenant-data-admin'
import { assistUsageMonth } from '@aglyn/tenant-data-admin/server/assist-usage'
import { assistRefusalCounts } from '@aglyn/tenant-data-admin/server/assist-refusals'
import { readOrgAiUsageByUser } from '@aglyn/tenant-data-admin/server/ai-usage-by-user'
import { recordAdminAudit } from '@aglyn/tenant-data-admin/server/admin-audit'
import { invalidIdTokenResponse } from '@aglyn/tenant-data-admin/server/id-token-refusal'
import { addonKindFromPriceId } from '@aglyn/tenant-data-admin/server/billing-addons'
import { orgMarginRow } from '@aglyn/aglyn/app-utils/margin-utilization'
import {
  assistCogsAlertThresholdUsd,
  assistMarginMultiple,
} from '@aglyn/aglyn/app-utils/usage-budget'
import {
  composeStaffOrgAiAddon,
  composeStaffOrgAiMargin,
  composeStaffOrgAiOverage,
  composeStaffOrgAiPool,
  emptyJobCounts,
  STAFF_ORG_AI_JOB_STATUSES,
  type StaffOrgAiAddon,
  type StaffOrgAiJob,
  type StaffOrgAiJobs,
  type StaffOrgAiResponse,
  type StaffOrgAiUser,
} from '../usage/staff-org-ai'

/**
 * THE STAFF AI CARD'S BACKING READ (AGL-2930).
 *
 * One request composes everything the card on the staff org page shows: the
 * add-on and when it was bought, the credit pool and its parts, the month's
 * overage and the org's own ceilings, the refusal counter, the generation
 * jobs, the per-user rollup and the margin. Staff-gated exactly as
 * `/api/admin/org-usage` is, and read-only — every access below is a `get()`.
 *
 * ## The reads, stated
 *
 * The org document and its billing mirror; this month's `assistUsage`
 * document; the newest usage rollup (for the contribution margin, the same
 * read the margin route makes); a bounded page of `aiJobs`; the per-user
 * rollup for the month; and, when the add-on is on, ONE Stripe subscription
 * lookup that is cached in-process — see `addonSinceFor`.
 *
 * ## The `access` audit row
 *
 * Opening the card reads per-user attribution, which is the one thing on it
 * that is about a person rather than a workspace. So the open is recorded to
 * `adminAudit` as an ACCESS — `org.ai-viewed`, target the org's assist usage
 * path — through the same writer that records a staff member opening a
 * customer's email. No `subjectUid`: the row is about the org, and naming
 * every uid on the leaderboard would put a row on ten people's pages for one
 * staff glance at a table.
 */

/** Generation jobs read per request; the counts are a floor past it. */
const JOBS_SCAN = 200

/** How many jobs the card lists. */
const JOBS_RECENT = 10

/** How many people the leaderboard names. */
const TOP_USERS = 10

/**
 * How long a Stripe answer to "when was the add-on bought" is kept.
 *
 * The date does not move once the item exists, and the card is opened far
 * more often than an add-on is bought, so the only cost of a stale entry is
 * a card that says "since —" for up to this long after a purchase. The
 * alternative — a Stripe round trip on every render — is the thing the brief
 * forbade.
 */
const ADDON_SINCE_TTL_MS = 15 * 60 * 1000

interface AddonSince {
  since: string | null
  sinceSource: StaffOrgAiAddon['sinceSource']
  at: number
}

const addonSinceCache = new Map<string, AddonSince>()

/** Test seam: drop every cached Stripe answer. */
export function resetAddonSinceCache(): void {
  addonSinceCache.clear()
}

/**
 * The instant the add-on's subscription item was created, from Stripe.
 *
 * The org document carries the add-on as a quantity (`seatAddons.aiAddon`)
 * and nothing about WHEN — the webhook mirrors items, not their dates. Stripe
 * has it as `created` on the subscription item, found by the price id the
 * add-on sells at (`addonKindFromPriceId`), so a rename or a price change
 * does not lose it.
 */
async function addonSinceFor(orgId: string): Promise<AddonSince> {
  const cached = addonSinceCache.get(orgId)
  if (cached && Date.now() - cached.at < ADDON_SINCE_TTL_MS) return cached
  const answer = await readAddonSince(orgId)
  addonSinceCache.set(orgId, answer)
  return answer
}

async function readAddonSince(orgId: string): Promise<AddonSince> {
  const at = Date.now()
  const stripeKey = process.env.STRIPE_SECRET_KEY
  if (!stripeKey) return { since: null, sinceSource: 'unavailable', at }
  try {
    const customerId = (await readOrgBilling(orgId)).stripeCustomerId
    if (!customerId) return { since: null, sinceSource: 'no-subscription', at }
    const response = await fetch(
      `https://api.stripe.com/v1/subscriptions?customer=${encodeURIComponent(
        String(customerId),
      )}&status=all&limit=10`,
      { headers: { Authorization: `Bearer ${stripeKey}` } },
    )
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      console.error('[ai/admin/org] Stripe subscription lookup failed', {
        orgId,
        status: response.status,
        detail: payload?.error?.message ?? null,
      })
      return { since: null, sinceSource: 'unavailable', at }
    }
    const subscriptions = (payload?.data ?? []) as Array<{
      status?: string
      items?: { data?: Array<{ created?: number; price?: { id?: string } }> }
    }>
    // The LIVE subscription's item, when one exists: an add-on on a canceled
    // subscription is not an add-on the org has, and `hasAiAddon` already
    // says so — the date beside "off" would only confuse.
    const live = subscriptions.filter((subscription) =>
      isLiveSubscriptionStatus(subscription.status),
    )
    for (const subscription of live.length ? live : subscriptions) {
      for (const item of subscription.items?.data ?? []) {
        if (addonKindFromPriceId(item.price?.id) !== 'aiAddon') continue
        const created = Number(item.created)
        if (Number.isFinite(created) && created > 0) {
          return {
            since: new Date(created * 1000).toISOString(),
            sinceSource: 'stripe',
            at,
          }
        }
      }
    }
    return { since: null, sinceSource: 'stripe', at }
  } catch (error) {
    console.error('[ai/admin/org] Stripe subscription lookup threw', error)
    return { since: null, sinceSource: 'unavailable', at }
  }
}

const toIso = (value: unknown): string | null => {
  const converted = (value as { toDate?: () => Date } | null)?.toDate?.()
  if (converted instanceof Date) return converted.toISOString()
  if (value instanceof Date) return value.toISOString()
  return null
}

/**
 * The month's generation jobs, summarized (AGL-2904's collection).
 *
 * Reads `orgs/{orgId}/aiJobs` by `createdAt` from the first instant of the
 * month, newest first, up to `JOBS_SCAN`. An org with no such collection
 * answers an empty snapshot, which is the honest "no generation jobs yet";
 * a read that FAILED answers `null`, which the card renders as a failure
 * rather than as an idle org. The field names are the ones `AiJob` declares
 * in `ai-jobs.types.ts`: `kind`, `status`, `creditsReserved`, `creditsSpent`,
 * `createdAt`, `createdBy`.
 */
export async function readOrgAiJobsSummary(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  month: string,
): Promise<StaffOrgAiJobs | null> {
  try {
    const monthStart = new Date(`${month}-01T00:00:00.000Z`)
    const snapshot = await firestore
      .collection('orgs')
      .doc(orgId)
      .collection('aiJobs')
      .where('createdAt', '>=', monthStart)
      .orderBy('createdAt', 'desc')
      .limit(JOBS_SCAN + 1)
      .get()
    const truncated = snapshot.docs.length > JOBS_SCAN
    const docs = truncated ? snapshot.docs.slice(0, JOBS_SCAN) : snapshot.docs
    const counts = emptyJobCounts()
    const recent: StaffOrgAiJob[] = []
    for (const doc of docs) {
      const status = String(doc.get('status') ?? '')
      if ((STAFF_ORG_AI_JOB_STATUSES as readonly string[]).includes(status)) {
        counts[status as keyof typeof counts] += 1
      }
      if (recent.length < JOBS_RECENT) {
        recent.push({
          id: doc.id,
          kind: String(doc.get('kind') ?? ''),
          status,
          creditsReserved: Number(doc.get('creditsReserved') ?? 0) || 0,
          creditsSpent: Number(doc.get('creditsSpent') ?? 0) || 0,
          createdAt: toIso(doc.get('createdAt')),
          createdBy:
            typeof doc.get('createdBy') === 'string'
              ? String(doc.get('createdBy'))
              : null,
        })
      }
    }
    return { counts, recent, truncated }
  } catch (error) {
    console.error('[ai/admin/org] jobs read failed', error)
    return null
  }
}

/**
 * The month's per-user rollup, dearest first (AGL-2928).
 *
 * `readOrgAiUsageByUser` is the one reader of
 * `orgs/{orgId}/aiUsageByUser/{uid}/months/{month}` — the customer's Usage
 * table reads through it too — joined to the roster for names and carrying
 * each person's share of the org's measured spend. The card keeps the
 * dearest `TOP_USERS`.
 */
async function readOrgAiTopUsers(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  month: string,
): Promise<StaffOrgAiUser[]> {
  try {
    const usage = await readOrgAiUsageByUser(firestore, orgId, month)
    return usage.rows.slice(0, TOP_USERS).map((row) => ({
      uid: row.uid,
      name: row.name,
      credits: row.credits,
      estCostUsd: row.estCostUsd,
      share: row.share,
      requests: row.requests,
      refusals: row.refusals,
      byKind: row.byKind,
      byHost: row.byHost,
    }))
  } catch (error) {
    console.error('[ai/admin/org] per-user read failed', error)
    return []
  }
}

async function handler(request: Request): Promise<Response> {
  const {
    method,
    query,
    headers: rawHeaders,
  } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken)
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  const orgId = String(query.orgId ?? '')
  if (!orgId) return Response.json({ error: 'Missing orgId' }, { status: 400 })

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    if (!decoded['staff']) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }

    const now = new Date()
    const month = assistUsageMonth(now)
    const db = firebaseAdmin.app().firestore()
    const orgRef = db.collection('orgs').doc(orgId)

    const [orgSnap, billingSnap, monthSnap, rollupSnap] = await Promise.all([
      orgRef.get(),
      orgRef.collection(ORG_BILLING_SUBCOLLECTION).doc(ORG_BILLING_DOC_ID).get(),
      orgRef.collection('assistUsage').doc(month).get(),
      orgRef.collection('usage').orderBy('month', 'desc').limit(1).get(),
    ])
    if (!orgSnap.exists) {
      return Response.json({ error: 'No such organization' }, { status: 404 })
    }
    // Org doc FIRST so a stale inline `subscription` loses to the billing
    // mirror — the same merge the margin route and the org detail read make.
    const org = {
      ...(orgSnap.data() ?? {}),
      ...(billingSnap.exists ? billingSnap.data() : {}),
    } as Record<string, unknown>
    const monthDoc = monthSnap.exists ? (monthSnap.data() ?? {}) : null

    /*
     * The row is written BEFORE the person-shaped read is served, and it is
     * awaited: a card that rendered the leaderboard and then failed to
     * record the look would be the access this collection exists to never
     * lose. A failed write logs and still serves — the card is not a closed
     * collection the way the delivery log is — but the order is the point.
     */
    try {
      await recordAdminAudit({
        actorUid: decoded.uid,
        action: 'org.ai-viewed',
        target: `orgs/${orgId}/assistUsage`,
        note: `AI card opened for ${month}`,
      })
    } catch (error) {
      console.error('[ai/admin/org] audit write failed', error)
    }

    const [jobs, users, since] = await Promise.all([
      readOrgAiJobsSummary(db, orgId, month),
      readOrgAiTopUsers(db, orgId, month),
      addonSinceFor(orgId),
    ])

    const pool = composeStaffOrgAiPool(org as never, monthDoc, now)
    const overage = composeStaffOrgAiOverage(org as never, pool.providerUsd)
    const addon = composeStaffOrgAiAddon(org as never, {
      since: since.since,
      sinceSource: since.sinceSource,
    })
    const thresholdUsd = assistCogsAlertThresholdUsd(
      process.env.ASSIST_ORG_MONTHLY_COGS_ALERT_USD,
    )
    const rollupDoc = rollupSnap.docs[0]
    // The whole-org contribution margin, on the same row the margin
    // utilization page builds — with THIS month's live assist spend in
    // place of the figure frozen onto the rollup, as that route does.
    const contributionRow = rollupDoc
      ? orgMarginRow({
          orgId,
          name: (org['name'] as string | undefined) ?? null,
          org: org as never,
          month: String(rollupDoc.get('month') ?? rollupDoc.id),
          rollup: {
            ...orgCogsInputFrom(rollupDoc.data()),
            assistCostUsd: pool.providerUsd,
          },
        })
      : null
    const margin = composeStaffOrgAiMargin({
      org: org as never,
      pool,
      overage,
      addon,
      thresholdUsd,
      multiple: assistMarginMultiple(pool.providerUsd, thresholdUsd),
      contribution: {
        month: contributionRow?.month ?? null,
        marginPct: contributionRow?.marginPct ?? null,
        rating: contributionRow?.rating ?? null,
      },
    })

    const body: StaffOrgAiResponse = {
      month,
      addon,
      pool,
      overage,
      refusals: assistRefusalCounts(monthDoc?.['refusals']),
      jobs,
      users,
      margin,
    }
    return Response.json(body, { status: 200 })
  } catch (error) {
    // An unverifiable credential is a 401, not a fault of ours
    // (AGL-1993). Null for anything else, so a real failure keeps its 500.
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error('[ai/admin/org]', error)
    return Response.json({ error: 'AI lookup failed' }, { status: 500 })
  }
}

export { handler as GET }
