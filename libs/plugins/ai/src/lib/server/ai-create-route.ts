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


// lockdown-423: via libs/plugins/ai/src/lib/server/ai-jobs-gate.ts
// The follow view climbs `aiJobsGate`, whose lockdown rung is the verdict. The
// door answers what a list draws and starts nothing: a locked workspace's
// start is refused by the jobs route's own ladder, in its own words.

import type { DecodedIdToken } from 'firebase-admin/auth'
import { checkEntitlement } from '@aglyn/aglyn/server'
import { COLLECTIONS_MAX_PER_HOST } from '@aglyn/aglyn/app-utils/collection-entries'
import {
  aiAddonName,
  isUncappedPlanComp,
  orgSubscriptionState,
  resolveEffectivePlan,
} from '@aglyn/aglyn/app-utils/plan-entitlements'
import { listPluginSeatAddons } from '@aglyn/aglyn/plugin-manager/plugin-entitlements'
import type { AglynOrganization, AglynOrgMember } from '@aglyn/aglyn/foundation/definitions/organization.types'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin/server/firebase-admin'
import { invalidIdTokenResponse } from '@aglyn/tenant-data-admin/server/id-token-refusal'
import { getOrgForUser, memberHasPermissionOnHost } from '@aglyn/tenant-data-admin/server/organizations'
import { isServerReleaseFlagOnForOrg } from '@aglyn/tenant-data-admin/server/release-flags'
import { aiJobSiteRefusal } from '../jobs/ai-job-admission'
import { aiJobSummary, getAiJob, listAiJobs } from '../jobs/ai-jobs'
import {
  aiCreateDoorView,
  aiJobFollowView,
  isAiCreateKind,
  type AiCreateCreditsFacts,
  type AiCreateKind,
} from '../model/ai-create-view'
import { AI_JOB_ACTIVE_STATUSES, AI_PAGE_BUILDING_JOB_KINDS, aiSiteBuildInFlight } from '../model/ai-job-activity'
import { aiTemplateCollectionOptions } from '../model/ai-template-collections'
import { assistSpendAfterReturnsUsd, ASSIST_RETURNED_USD_FIELD } from '../usage/assist-credit-returns'
import { assistBandRefuses, publicAssistCredits, resolveAssistBudgetUsd } from '../usage/assist-credits'
import { readFreeAiCreditsLeft } from '../usage/free-ai-credits-left'
import { aiJobsGate } from './ai-jobs-gate'

/**
 * `GET /api/ai/create?orgId&hostId&kind` — the door one list's "Create with
 * AI" reads in the apps (AGL-3854), and `GET /api/ai/create/:jobId?orgId` —
 * the job it started, as the dialog's follow card reads it.
 *
 * The console draws each entry from its shell's gates and its own components
 * (`ai-describe-button`, `ai-brief-dialog`, `ai-job-follow`); the apps have
 * neither, so these answer the same verdicts and the same words as data
 * (`model/ai-create-view.ts`). Both only read. Starting, confirming and
 * canceling go through the jobs routes the console calls, whose ladder decides
 * every request exactly as it does for the console.
 */

function bearerToken(request: Request): string | undefined {
  const authorization = request.headers.get('authorization') ?? ''
  return authorization.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : undefined
}

/** Every rung the console's shell climbs before it draws the entry, in the jobs gate's order. */
interface DoorCaller {
  decoded: DecodedIdToken
  staff: boolean
  orgId: string
  org: Partial<AglynOrganization>
  member: AglynOrgMember | null
}

async function doorCaller(request: Request, orgId: string): Promise<Response | DoorCaller> {
  const idToken = bearerToken(request)
  if (!idToken) return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  let decoded: DecodedIdToken
  try {
    decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
  } catch (error) {
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    throw error
  }
  if (!decoded.email_verified && !isImpersonationSession(decoded)) return emailUnverifiedResponse()
  if (!orgId) return Response.json({ error: 'Open a workspace before using this feature' }, { status: 400 })
  const resolved = await getOrgForUser(decoded.uid, orgId)
  if (!resolved || resolved.orgId !== orgId) {
    return Response.json({ error: 'You are not a member of that organization' }, { status: 403 })
  }
  return {
    decoded,
    staff: decoded['staff'] === true,
    orgId,
    org: resolved.org ?? {},
    member: resolved.member ?? null,
  }
}

/**
 * Whether an add-on this workspace can buy grants `aiGenerative`: the
 * console's `entitlementPurchasable`, over the add-ons the AI plugin declares
 * on the server.
 */
export function aiGenerativePurchasable(org: Partial<AglynOrganization>): boolean {
  const billing = org as Parameters<typeof checkEntitlement>[0]
  if (orgSubscriptionState(billing as never) !== 'live') return false
  const plan = resolveEffectivePlan(billing as never)
  return listPluginSeatAddons().some(
    (addon) =>
      addon.features?.includes('aiGenerative') && (!addon.quota || (addon.quota.perUnitByPlan[plan] ?? 0) > 0),
  )
}

/** What is left of the month's credits, as the AI credits meter reads it. */
async function creditsFacts(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  org: Partial<AglynOrganization>,
  now: Date,
): Promise<AiCreateCreditsFacts> {
  if (resolveEffectivePlan(org as never) === 'free') {
    const left = await readFreeAiCreditsLeft(firestore, { orgId, org: org as object, now })
    return left ? { kind: 'free', left } : { kind: 'none' }
  }
  const budgetUsd = resolveAssistBudgetUsd(org as never)
  if (budgetUsd === null) return isUncappedPlanComp(org as never) ? { kind: 'unlimited' } : { kind: 'none' }
  const usage = await firestore
    .collection('orgs')
    .doc(orgId)
    .collection('assistUsage')
    .doc(now.toISOString().slice(0, 7))
    .get()
  const credits = publicAssistCredits(
    assistSpendAfterReturnsUsd(usage.get('estCostUsd'), usage.get(ASSIST_RETURNED_USD_FIELD)),
    budgetUsd,
  )
  if (credits.limit === null || credits.remaining === null) return { kind: 'none' }
  return {
    kind: 'band',
    used: credits.used,
    limit: credits.limit,
    remaining: credits.remaining,
    stopsAtBand: assistBandRefuses(org as never),
  }
}

const ID_CHARS = /^[A-Za-z0-9_-]{1,100}$/

/** The door: whether a list draws Create with AI, as what, and every word its brief says. */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const kind = url.searchParams.get('kind') ?? ''
  if (!isAiCreateKind(kind)) {
    return Response.json({ error: 'kind must be one of page, template, layout, form, component' }, { status: 400 })
  }
  const hostId = url.searchParams.get('hostId') ?? ''
  if (!ID_CHARS.test(hostId)) return Response.json({ error: 'hostId is not a site id' }, { status: 400 })
  const caller = await doorCaller(request, (url.searchParams.get('orgId') ?? '').trim())
  if (caller instanceof Response) return caller
  const { staff, orgId, org, member } = caller
  const firestore = firebaseAdmin.app().firestore()
  const now = new Date()
  const hidden = () =>
    Response.json(
      aiCreateDoorView({
        kind,
        shown: false,
        entitled: false,
        purchasable: false,
        canManageBilling: false,
        credits: { kind: 'none' },
        addonName: aiAddonName(),
      }),
      { headers: { 'Cache-Control': 'no-store' } },
    )

  // The shell's rungs, in the jobs gate's order: the reader's `ai.generate`
  // on this site, the release flag, then the site's own AI switch. Any of
  // them draws no entry at all; staff pass the first two, as they do there.
  if (!staff && !(await memberHasPermissionOnHost(orgId, hostId, member, 'ai.generate'))) return hidden()
  if (!staff && !(await isServerReleaseFlagOnForOrg('release_ai_generative', orgId))) return hidden()
  if (await aiJobSiteRefusal({ firestore, org, hostId })) return hidden()

  const entitled = checkEntitlement(org as never, 'aiGenerative')
  if (!entitled) {
    // Its own upsell where only the add-on is missing (AGL-3601): the add-on
    // store open to this workspace, and an add-on it can buy that grants it.
    const storeOpen = staff || (await isServerReleaseFlagOnForOrg('release_addon_store', orgId))
    const purchasable = !staff && storeOpen && aiGenerativePurchasable(org)
    const canManageBilling = purchasable && (await memberHasPermissionOnHost(orgId, null, member, 'billing.manage'))
    return Response.json(
      aiCreateDoorView({
        kind,
        shown: true,
        entitled: false,
        purchasable,
        canManageBilling,
        credits: { kind: 'none' },
        addonName: aiAddonName(),
      }),
      { headers: { 'Cache-Control': 'no-store' } },
    )
  }

  const [credits, collections, buildInFlight] = await Promise.all([
    creditsFacts(firestore, orgId, org, now).catch((error) => {
      console.error('[ai-create] credits read failed', orgId, error)
      return { kind: 'none' } as const
    }),
    kind === 'template'
      ? firestore
          .collection('hosts')
          .doc(hostId)
          .collection('collections')
          .limit(COLLECTIONS_MAX_PER_HOST)
          .get()
          .then((snapshot) => ({
            status: 'success' as const,
            options: aiTemplateCollectionOptions(
              snapshot.docs.map((doc) => ({ ...(doc.data() as Record<string, unknown>), $id: doc.id })),
            ),
          }))
          .catch(() => ({ status: 'error' as const, options: [] }))
      : Promise.resolve(null),
    kind === 'page'
      ? listAiJobs(firestore, orgId, { statuses: AI_JOB_ACTIVE_STATUSES })
          .then((jobs) => aiSiteBuildInFlight(jobs.map((job) => aiJobSummary(job, now)), { hostId }) !== null)
          .catch(() => false)
      : Promise.resolve(false),
  ])
  return Response.json(
    aiCreateDoorView({
      kind: kind as AiCreateKind,
      shown: true,
      entitled: true,
      purchasable: false,
      canManageBilling: false,
      credits,
      collections,
      buildInFlight,
      addonName: aiAddonName(),
    }),
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

/** The follow view: one job of the workspace's, as the dialog that started it reads it. */
export async function GET_FOLLOW(request: Request, { params }: { params: Promise<{ jobId: string }> }): Promise<Response> {
  const { jobId } = await params
  if (!ID_CHARS.test(jobId ?? '')) return Response.json({ error: 'Not found' }, { status: 404 })
  const url = new URL(request.url)
  const gate = await aiJobsGate(request, url.searchParams.get('orgId') ?? '')
  if (gate instanceof Response) return gate
  const now = new Date()
  const job = await getAiJob(gate.firestore, gate.orgId, jobId)
  if (!job) return Response.json({ error: 'Not found' }, { status: 404 })
  const summary = aiJobSummary(job, now)
  // Confirming builds pages while another job is building on the site
  // (AGL-3765): asked only while this one waits on its plan.
  const askInFlight =
    summary.status === 'needs_review' &&
    summary.review?.reason === 'plan' &&
    AI_PAGE_BUILDING_JOB_KINDS.includes(summary.kind)
  const buildInFlight = askInFlight
    ? await listAiJobs(gate.firestore, gate.orgId, { statuses: AI_JOB_ACTIVE_STATUSES })
        .then(
          (jobs) =>
            aiSiteBuildInFlight(
              jobs.map((one) => aiJobSummary(one, now)),
              { hostId: summary.hostId, exceptJobId: summary.id },
            ) !== null,
        )
        .catch(() => false)
    : false
  return Response.json(
    {
      job: summary,
      view: aiJobFollowView(summary, {
        // Console addresses name the workspace by its slug, as every link the apps resolve does.
        orgSlug: typeof gate.org.slug === 'string' ? gate.org.slug : null,
        staff: gate.staff,
        buildInFlight,
        now: now.getTime(),
      }),
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  )
}

export const dynamic = 'force-dynamic'
