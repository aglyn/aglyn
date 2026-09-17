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

import { FieldPath } from 'firebase-admin/firestore'
import { INSIGHT_DIGESTS_FIELD, insightDigestSubscribed, notificationMuted } from '@aglyn/aglyn/app-utils/notifications'
import { hostRoleFor } from '@aglyn/aglyn/app-utils/organizations'
import { checkEntitlement, resolveBrandingProfile, resolveEffectivePlan } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { isReleaseFlagOnForOrg, parseOrgReleaseFlagOverrides, type ReleaseFlagValue } from '@aglyn/aglyn/app-utils/release-flags'
import type { AglynOrgMember } from '@aglyn/aglyn/foundation/definitions/organization.types'
import {
  AI_INSIGHTS_COLLECTION,
  aiInsightIsoWeek,
  type AiInsightRecord,
} from '../model/ai-insight'
import { isAiOnForSite } from '../model/ai-site-switch'
import { cancelAiJob, createAiJob, getAiJob } from '../jobs/ai-jobs'

/**
 * THE WEEKLY INSIGHTS (AGL-2915): `POST /api/admin/ai-insights-digest`, twice
 * a day on the console's scheduler.
 *
 * ## Who asked for it
 *
 * A person turns weekly insights on for a workspace beside the answers
 * themselves (`users/{uid}.insightDigests.{orgId}`), and off there or in
 * Notifications. It is opt-in, because each digest is a generation the
 * workspace pays for. At the sweep, every rung is asked again rather than
 * trusted from the switch: the workspace's plan includes `aiGenerative`,
 * `release_ai_generative` is on for it, its AI is not paused, the site has AI
 * on, and the person still holds `ai.generate` on the site.
 *
 * ## Monday: one job per site
 *
 * On a Monday run, for each workspace with someone who asked, the sites those
 * people reach — the busiest `AI_INSIGHT_DIGEST_MAX_SITES` by yesterday's page
 * views — each get one `insight` job with the `digest` surface, created by the
 * first of them who may generate there. The job runs on the AI jobs beat like
 * any other: it reserves, meters and records its credits, and a workspace at
 * its band — a Free one that has used its credits — has its job parked by the
 * reservation like any other. `orgs/{orgId}/aiInsightDigests/{week}` records
 * the jobs; `aiInsightDigestQueue/{week}` lists the workspaces still owed a
 * delivery, so a run that delivers reads one document rather than every
 * workspace.
 *
 * ## Every run: deliver what is written
 *
 * A digest whose job is done and kept at least one insight is delivered once:
 * a `content.insightsDigest` notification (unless the person muted the
 * category) and an email through the platform's own sending path, to each
 * person who asked for the workspace's insights and reaches the site. A job
 * that failed, kept nothing, or parked for credits is SKIPPED SILENTLY: a
 * parked job is canceled rather than left to spend later, and nobody is told,
 * because nobody asked about that week in particular. A job still running
 * past `AI_INSIGHT_DIGEST_DEADLINE_MS` is canceled and skipped the same way.
 *
 * The email says only what the answer says: the insights, each traced to the
 * figures it cites, and a link to the site's Analytics page. It is sent by the
 * platform to a person who asked for it, never to a contact.
 */

type Firestore = FirebaseFirestore.Firestore

export const AI_INSIGHTS_DIGEST_CRON_ID = 'ai-insights-digest'
export const AI_INSIGHTS_DIGEST_PATH = 'admin/ai-insights-digest'

/** Orgs one call reads; a chunk that times out never advances the cursor, so the safe size is one that finishes. */
export const AI_INSIGHT_DIGEST_ORG_CHUNK = 25

/** Sites one workspace's digest covers a week. */
export const AI_INSIGHT_DIGEST_MAX_SITES = 5

/** Sites a workspace's sweep reads before it ranks them. */
export const AI_INSIGHT_DIGEST_HOST_READ_LIMIT = 50

/** Workspaces one run delivers to, per week. */
export const AI_INSIGHT_DIGEST_DELIVER_LIMIT = 100

/** How long a digest's job may take before its week is given up. */
export const AI_INSIGHT_DIGEST_DEADLINE_MS = 48 * 60 * 60_000

/**
 * The time one call works before it stops and leaves the rest to the next:
 * inside the plugin dispatcher's 60 s function ceiling, with room for the
 * reads before the first check and the reply after the last. A call killed
 * mid-send could send one person a site's digest twice, because a send is
 * stamped after it goes.
 */
export const AI_INSIGHT_DIGEST_RUN_BUDGET_MS = 45_000

export const AI_INSIGHT_DIGEST_MARKERS = 'aiInsightDigests'
export const AI_INSIGHT_DIGEST_QUEUE = 'aiInsightDigestQueue'

export type AiInsightDigestSiteState = 'pending' | 'delivered' | 'skipped'

export interface AiInsightDigestSite {
  jobId: string
  name: string
  state: AiInsightDigestSiteState
  /**
   * The people already sent this site's digest, so a run the send rate
   * stopped never sends one twice. Dropped when the site settles, so a
   * settled marker names no person.
   */
  sent?: Record<string, boolean>
}

export interface AiInsightDigestMarker {
  week: string
  createdAtMs: number
  sites: Record<string, AiInsightDigestSite>
}

/** What a send answered: whether it went, and whether the platform's send rate refused it for now. */
export interface AiInsightDigestSendResult {
  sent: boolean
  rateLimited: boolean
}

/** Everything the sweep reaches beyond Firestore, so a spec can hold each one. */
export interface AiInsightDigestDeps {
  firestore: Firestore
  now: Date
  flagValue: ReleaseFlagValue
  listMembers: (orgId: string) => Promise<AglynOrgMember[]>
  mayGenerate: (orgId: string, hostId: string, member: AglynOrgMember) => Promise<boolean>
  paused: (orgId: string) => Promise<boolean>
  notify: (uid: string, payload: { title: string; body: string; link: string; orgId: string; hostId: string }) => Promise<void>
  send: (email: { to: string; subject: string; text: string; fromName: string }) => Promise<AiInsightDigestSendResult>
  /** The console's absolute origin for an email link, or `''` when none is configured. */
  consoleOrigin: string
  /** The call's working time; `AI_INSIGHT_DIGEST_RUN_BUDGET_MS` unless a spec holds it. */
  budgetMs?: number
}

export interface AiInsightDigestReport {
  week: string
  swept: number
  created: number
  delivered: number
  skipped: number
  /** The send rate refused or the call's time ran out; the run stops, and the next one delivers the rest. */
  deferred: boolean
  nextCursor: string | null
  done: boolean
}

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/** The week a Monday digest covers: the week the run falls in. */
export function aiInsightDigestWeek(now: Date): string {
  return aiInsightIsoWeek(now)
}

/** The week before, whose late digests a run still delivers. */
function previousWeek(now: Date): string {
  return aiInsightIsoWeek(new Date(now.getTime() - 7 * 86_400_000))
}

/** A digest email's words: the insights, the site's Analytics page, and where to turn it off. */
export function aiInsightDigestEmailText(input: {
  siteName: string
  productName: string
  insights: ReadonlyArray<{ text: string }>
  /** Absolute links, or `null` where no console origin is configured to build one from. */
  analyticsUrl: string | null
  settingsUrl: string | null
}): string {
  return [
    `Here is what ${input.siteName}'s figures showed this week.`,
    '',
    ...input.insights.map((insight, index) => `${index + 1}. ${insight.text}`),
    '',
    input.analyticsUrl
      ? `Each of these is traced to the figures it cites. See them in ${input.productName}: ${input.analyticsUrl}`
      : `Each of these is traced to the figures it cites. See them on the site's Analytics page in ${input.productName}.`,
    '',
    input.settingsUrl
      ? `You asked for weekly insights for this workspace. Turn them off in Notifications: ${input.settingsUrl}`
      : `You asked for weekly insights for this workspace. Turn them off in your Notifications settings.`,
  ].join('\n')
}

async function readUsers(firestore: Firestore, uids: readonly string[]) {
  if (!uids.length) return new Map<string, FirebaseFirestore.DocumentSnapshot>()
  const docs = await firestore.getAll(...uids.map((uid) => firestore.collection('users').doc(uid)))
  return new Map(docs.map((doc) => [doc.id, doc]))
}

/** Creates one workspace's digests for the week; answers how many jobs it created. */
async function createOrgDigest(
  deps: AiInsightDigestDeps,
  orgDoc: FirebaseFirestore.QueryDocumentSnapshot,
  week: string,
): Promise<number> {
  const { firestore, now } = deps
  const orgId = orgDoc.id
  const org = (orgDoc.data() ?? {}) as Record<string, unknown>
  if (!checkEntitlement(org as never, 'aiGenerative')) return 0
  const flagOn = isReleaseFlagOnForOrg(
    'release_ai_generative',
    deps.flagValue,
    orgId,
    parseOrgReleaseFlagOverrides(org['releaseFlags']),
    resolveEffectivePlan(org as never),
  )
  if (!flagOn || (await deps.paused(orgId))) return 0
  const markerRef = orgDoc.ref.collection(AI_INSIGHT_DIGEST_MARKERS).doc(week)
  if ((await markerRef.get()).exists) return 0

  const members = (await deps.listMembers(orgId)).filter((member) => member.orgSuspended !== true)
  const users = await readUsers(firestore, members.map((member) => member.$id).sort())
  const subscribers = members
    .filter((member) => insightDigestSubscribed(users.get(member.$id)?.get(INSIGHT_DIGESTS_FIELD), orgId))
    .sort((a, b) => a.$id.localeCompare(b.$id))
  if (!subscribers.length) return 0

  const hosts = await firestore
    .collection('hosts')
    .where('orgId', '==', orgId)
    .limit(AI_INSIGHT_DIGEST_HOST_READ_LIMIT)
    .get()
  const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10)
  const candidates: Array<{ hostId: string; name: string; creator: string; views: number }> = []
  for (const host of hosts.docs) {
    const data = host.data() ?? {}
    if (!isAiOnForSite(org, data)) continue
    let creator: string | null = null
    for (const member of subscribers) {
      if (hostRoleFor(member, host.id) !== null && (await deps.mayGenerate(orgId, host.id, member))) {
        creator = member.$id
        break
      }
    }
    if (!creator) continue
    const day = await host.ref.collection('analytics').doc(yesterday).get()
    candidates.push({
      hostId: host.id,
      name: str(data['displayName']) || str(data['name']) || str(data['subdomain']) || host.id,
      creator,
      views: Number(day.get('total') ?? 0) || 0,
    })
  }
  const chosen = candidates
    .sort((a, b) => b.views - a.views || a.hostId.localeCompare(b.hostId))
    .slice(0, AI_INSIGHT_DIGEST_MAX_SITES)
  if (!chosen.length) return 0

  const sites: Record<string, AiInsightDigestSite> = {}
  for (const site of chosen) {
    const job = await createAiJob(
      firestore,
      {
        orgId,
        hostId: site.hostId,
        kind: 'insight',
        brief: `Weekly insights for ${site.name}`,
        inputs: { surface: 'digest', week },
        createdBy: site.creator,
      },
      now,
    )
    sites[site.hostId] = { jobId: job.$id, name: site.name, state: 'pending' }
  }
  const marker: AiInsightDigestMarker = { week, createdAtMs: now.getTime(), sites }
  await markerRef.set(marker)
  await firestore
    .collection(AI_INSIGHT_DIGEST_QUEUE)
    .doc(week)
    .set({ week, pending: { [orgId]: true } }, { merge: true })
  return chosen.length
}

/** Delivers or settles one workspace's digests for a week; `deferred` when the send rate refused. */
async function deliverOrgDigest(
  deps: AiInsightDigestDeps,
  orgId: string,
  week: string,
  overBudget: () => boolean,
): Promise<{ delivered: number; skipped: number; settled: boolean; deferred: boolean }> {
  const { firestore, now } = deps
  const orgRef = firestore.collection('orgs').doc(orgId)
  const markerRef = orgRef.collection(AI_INSIGHT_DIGEST_MARKERS).doc(week)
  const markerSnapshot = await markerRef.get()
  const result = { delivered: 0, skipped: 0, settled: true, deferred: false }
  if (!markerSnapshot.exists) return result
  const marker = markerSnapshot.data() as AiInsightDigestMarker
  const org = ((await orgRef.get()).data() ?? {}) as Record<string, unknown>
  let members: AglynOrgMember[] | null = null
  const branding = resolveBrandingProfile(org as never)

  for (const [hostId, site] of Object.entries(marker.sites ?? {})) {
    if (site.state !== 'pending') continue
    const settle = async (state: AiInsightDigestSiteState) => {
      // Replaced whole rather than merged, which drops `sent`.
      const settled: AiInsightDigestSite = { jobId: site.jobId, name: site.name, state }
      await markerRef.update({ [`sites.${hostId}`]: settled })
      if (state === 'delivered') result.delivered += 1
      else result.skipped += 1
    }
    const job = await getAiJob(firestore, orgId, site.jobId)
    if (!job || job.status === 'failed' || job.status === 'canceled') {
      await settle('skipped')
      continue
    }
    if (job.status !== 'done') {
      const late = now.getTime() - Number(marker.createdAtMs ?? 0) > AI_INSIGHT_DIGEST_DEADLINE_MS
      // A job parked for credits — a Free workspace at its band — is given up
      // rather than left to spend on a week that is already over.
      if (job.status === 'needs_input' || late) {
        await cancelAiJob(firestore, orgId, site.jobId, now)
        await settle('skipped')
      } else {
        result.settled = false
      }
      continue
    }
    const answer = await orgRef.collection(AI_INSIGHTS_COLLECTION).doc(site.jobId).get()
    const record = answer.exists ? (answer.data() as AiInsightRecord) : null
    if (!record?.insights?.length) {
      await settle('skipped')
      continue
    }

    members ??= (await deps.listMembers(orgId)).filter((member) => member.orgSuspended !== true)
    const reaching = members.filter((member) => hostRoleFor(member, hostId) !== null)
    const users = await readUsers(firestore, reaching.map((member) => member.$id).sort())
    const host = (await firestore.collection('hosts').doc(hostId).get()).data() ?? {}
    const orgSlug = str(org['slug'])
    const subdomain = str(host['subdomain'])
    const origin = deps.consoleOrigin
    const analyticsUrl = origin && orgSlug && subdomain ? `${origin}/${orgSlug}/hosts/${subdomain}/analytics` : null
    for (const member of reaching.sort((a, b) => a.$id.localeCompare(b.$id))) {
      const user = users.get(member.$id)
      if (!insightDigestSubscribed(user?.get(INSIGHT_DIGESTS_FIELD), orgId)) continue
      if (site.sent?.[member.$id]) continue
      if (overBudget()) {
        // Out of time: what was sent is stamped, and the next run sends the rest.
        result.deferred = true
        result.settled = false
        return result
      }
      const address = str(member.email ?? user?.get('email')).toLowerCase()
      if (address.includes('@')) {
        const sent = await deps.send({
          to: address,
          subject: `Your weekly insights for ${site.name}`,
          text: aiInsightDigestEmailText({
            siteName: site.name,
            productName: branding.productName,
            insights: record.insights,
            analyticsUrl,
            settingsUrl: origin ? `${origin}/manage/notifications` : null,
          }),
          fromName: branding.fromName,
        })
        if (sent.rateLimited) {
          // Nothing is marked, so the next run delivers this site whole.
          result.deferred = true
          result.settled = false
          return result
        }
      }
      if (!notificationMuted(user?.get('notificationPrefs'), 'content.insightsDigest')) {
        await deps.notify(member.$id, {
          title: `Weekly insights · ${site.name}`,
          body: record.insights[0].text,
          link: `/${hostId}/analytics`,
          orgId,
          hostId,
        })
      }
      await markerRef.set({ sites: { [hostId]: { sent: { [member.$id]: true } } } }, { merge: true })
    }
    await settle('delivered')
  }
  return result
}

/**
 * One call of the sweep: delivery for this week and the last on the first
 * call, then — on a Monday — one chunk of workspaces' creation, resumed by
 * `cursor`. The response shape is the console crons' (`nextCursor`, `done`),
 * so the scheduler's loop carries a platform of any size across calls.
 */
export async function runAiInsightDigestSweep(
  deps: AiInsightDigestDeps,
  options: { cursor: string | null },
): Promise<AiInsightDigestReport> {
  const { firestore, now } = deps
  const startedAtMs = Date.now()
  const budgetMs = deps.budgetMs ?? AI_INSIGHT_DIGEST_RUN_BUDGET_MS
  const overBudget = () => Date.now() - startedAtMs > budgetMs
  const week = aiInsightDigestWeek(now)
  const report: AiInsightDigestReport = {
    week,
    swept: 0,
    created: 0,
    delivered: 0,
    skipped: 0,
    deferred: false,
    nextCursor: null,
    done: true,
  }

  if (!options.cursor) {
    for (const owed of [previousWeek(now), week]) {
      const queueRef = firestore.collection(AI_INSIGHT_DIGEST_QUEUE).doc(owed)
      const pending = Object.entries(((await queueRef.get()).get('pending') ?? {}) as Record<string, unknown>)
        .filter(([, owed]) => owed === true)
        .map(([orgId]) => orgId)
        .sort()
        .slice(0, AI_INSIGHT_DIGEST_DELIVER_LIMIT)
      for (const orgId of pending) {
        if (overBudget()) {
          report.deferred = true
          return report
        }
        try {
          const delivered = await deliverOrgDigest(deps, orgId, owed, overBudget)
          report.delivered += delivered.delivered
          report.skipped += delivered.skipped
          if (delivered.settled) {
            await queueRef.set({ pending: { [orgId]: false } }, { merge: true })
          }
          if (delivered.deferred) {
            report.deferred = true
            return report
          }
        } catch (error) {
          console.error('ai insight digest delivery failed', { orgId, week: owed, error })
        }
      }
    }
  }

  // Monday is the week's first day by ISO 8601, and the day a digest is made.
  if (now.getUTCDay() !== 1) return report

  let query = firestore.collection('orgs').orderBy(FieldPath.documentId()).limit(AI_INSIGHT_DIGEST_ORG_CHUNK + 1)
  if (options.cursor) query = query.startAfter(firestore.collection('orgs').doc(options.cursor))
  const page = await query.get()
  const orgs = page.docs.slice(0, AI_INSIGHT_DIGEST_ORG_CHUNK)
  for (const [index, orgDoc] of orgs.entries()) {
    if (overBudget()) {
      // Out of time: the next call resumes after the last workspace read. A
      // call that read none has no cursor to hand on, and the next scheduled
      // run starts the week's workspaces again, which the markers make safe.
      report.nextCursor = index ? orgs[index - 1].id : (options.cursor ?? null)
      report.done = report.nextCursor === null
      return report
    }
    report.swept += 1
    try {
      report.created += await createOrgDigest(deps, orgDoc, week)
    } catch (error) {
      console.error('ai insight digest creation failed', { orgId: orgDoc.id, week, error })
    }
  }
  const more = page.docs.length > AI_INSIGHT_DIGEST_ORG_CHUNK
  report.nextCursor = more ? (orgs[orgs.length - 1]?.id ?? null) : null
  report.done = !more
  return report
}
