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
  type AglynOrgBilling,
  type AglynOrgMember,
  buildMemberDigests,
  buildRoute,
  composeCrmDigestEmailText,
  composeCrmDigestSubject,
  composeCrmDigestSummary,
  CRM_COLLECTIONS,
  CRM_DIGEST_DEFAULT_TIME_ZONE,
  CRM_DIGEST_LEAD_AGE_MS,
  CRM_DIGEST_LEAD_WINDOW,
  CRM_DIGEST_TASK_CEILING,
  crmDailyDigestEnabled,
  crmDigestCounts,
  crmDigestEntitled,
  type CrmDigestLead,
  type CrmDigestTask,
  crmDigestWindow,
  type CrmMemberDigest,
  DIGEST_PREFS_FIELD,
  hostRoleFor,
  isReleaseFlagOnForOrg,
  isUnworkedLead,
  notificationMuted,
  parseOrgReleaseFlagOverrides,
  pluginRequestFromWeb,
  resolveBrandingProfile,
  resolveEffectivePlan,
  resolveOrgEntitlements,
  Route,
  utcDayKey,
} from '@aglyn/aglyn/server'
import { rateLimitedRetryAtMs, sendEmail } from '@aglyn/shared-util-email'
import {
  findUserByUidAcrossPools,
  firebaseAdmin,
  getServerReleaseFlagValues,
  listOrgMembers,
  memberHasOrgPermission,
  meterPlatformEmail,
  notifyUsers,
} from '@aglyn/tenant-data-admin'
// From the LEAF, not the barrel (AGL-2407): the cron specs mock
// `@aglyn/tenant-data-admin` wholesale, and a suppression gate imported
// through the barrel would be silently replaced by whatever the factory
// lists. Same reasoning as `usage-alert-email.ts`.
import { filterSuppressedEmails } from '@aglyn/tenant-data-admin/server/email-suppression'
import { isCronAuthorized, isCronDryRun } from '../../../../utils/cron-auth'
import { recordCronBeat } from '../../../../utils/cron-beat'
import { brandSupportLine } from '../../_lib/brand-support-line'
import { consoleOrigin } from '../../_lib/usage-alert-email'

// lockdown-423: exempt — server-internal cron (x-cron-secret), no user caller; it reads an org's CRM to remind its members and writes nothing a locked org could lose.

/**
 * The daily CRM digest (AGL-2619): `POST /api/crm/daily-digest`.
 *
 * Overdue and due-today are computed at read time by design (AGL-2599), so
 * until this route nothing ever told anybody a task was late — overdue work
 * was found by opening the Tasks section. Once a morning, per org and per
 * member with open work, this counts their overdue and due-today tasks and
 * the leads nobody has worked, and says so ONCE: a console notification
 * (`content.crmDailyDigest`) and an email through the platform's own
 * sending path. The words and the arithmetic live in `crm-digest.ts`; this
 * file is the reads, the sends and the sweep.
 *
 * ## Who is told, and who is not
 *
 * A task's assignee, a lead's owner, and — for a lead nobody owns — every
 * member who reaches the site it was captured on. Only members who may open
 * the CRM (`data.manage`, resolved through their custom role the way the task
 * routes resolve it), and only in an org whose plan carries the suite and
 * whose `release_contacts` flag is on: a digest about a surface the reader
 * cannot open is a reminder to pay, not a reminder to call.
 *
 * Two switches on the recipient's own account are honored. The **Daily CRM
 * digest** preference (`users/{uid}.digestPrefs.crmDaily`, on until turned
 * off) governs the whole digest, mail included. The operational category
 * mute (`notificationPrefs.content`) governs the console notification alone,
 * as it does for every other `content.` type — the mute is a fact about the
 * console feed, and the digest switch is a fact about the digest.
 *
 * ## Once a day, and resumable
 *
 * `orgs/{orgId}/crmDigests/{YYYY-MM-DD}` records, per member, that today's
 * digest went out. It is stamped AFTER the sends, so a run that dies
 * mid-org re-sends only to the members it never reached, and a second run
 * on the same UTC day sends nothing. Orgs are swept in id order behind a
 * cursor the way `usage-alerts` sweeps them, so the workflow's `done:false`
 * loop carries a platform of any size across invocations.
 *
 * The email is a `bulk` send under the platform send-rate governor
 * (AGL-2409): a cron fan-out on the shared sending domain, answering nothing
 * anybody just did. A refusal STOPS the run and reports `done: true` — the
 * window is full, and re-POSTing into it would only red the workflow — and
 * because the refused member was never stamped, tomorrow's run digests them
 * afresh. Nothing about today's list is worth mailing tomorrow anyway.
 *
 * Metered as PLATFORM mail, not the org's: this is the platform reminding a
 * member, and a reminder that pushed an org toward its email overage would
 * be its own small absurdity. It is not a one-to-one CRM send and counts
 * against no per-member sending allowance.
 */

/** The beat `/api/health/crons` would read, were this job in its inventory. */
export const CRM_DIGEST_JOB_ID = 'crm-daily-digest'

/**
 * Orgs per invocation.
 *
 * Fewer than `usage-alerts`' hundred: an org costs a task query, a paged
 * host list, a leads query per site, the roster, and a send per member with
 * work, under `maxDuration = 60`. A chunk that times out never advances its
 * cursor, so the safe size is the one that finishes.
 */
export const CRM_DIGEST_ORG_CHUNK = 25

/** Hosts read per page inside one org, ordered by id like the orgs sweep. */
const CRM_DIGEST_HOST_PAGE = 100

/**
 * The most sites one org's digest reads leads from, after which the sweep
 * stops and SAYS SO in the response rather than reading without bound.
 */
export const CRM_DIGEST_HOST_CEILING = 200

/** `orgs/{orgId}/crmDigests/{day}` — server-written, matched by no rule. */
export const CRM_DIGEST_MARKER_COLLECTION = 'crmDigests'

/**
 * The most members per org whose address is chased through the auth pools
 * when their member document carries none. Bounds WORK, not audience — the
 * denormalized copy is normally present, and `orgAdminEmails` draws the same
 * line for the same reason.
 */
export const CRM_DIGEST_EMAIL_MAX_UID_LOOKUPS = 5

/**
 * The zone the digest's "today" is drawn in.
 *
 * `CRM_DIGEST_TIME_ZONE` overrides the default for a self-hosted console
 * whose team wakes up elsewhere; a value `Intl` does not know falls back to
 * the default with a warning rather than throwing the whole run away.
 */
export function digestTimeZone(env: NodeJS.ProcessEnv = process.env): string {
  const configured = String(env['CRM_DIGEST_TIME_ZONE'] ?? '').trim()
  if (!configured) return CRM_DIGEST_DEFAULT_TIME_ZONE
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: configured })
    return configured
  } catch {
    console.warn(
      `crm-daily-digest: CRM_DIGEST_TIME_ZONE "${configured}" is not a zone — ` +
        `using ${CRM_DIGEST_DEFAULT_TIME_ZONE}`,
    )
    return CRM_DIGEST_DEFAULT_TIME_ZONE
  }
}

type Firestore = FirebaseFirestore.Firestore
type Snapshot = FirebaseFirestore.QueryDocumentSnapshot

/**
 * Every host owned by an org, paged by document id — the shape
 * `usage-alerts` reads hosts with, at a lower ceiling because each host here
 * costs a leads query.
 */
async function hostsOfOrg(
  firestore: Firestore,
  orgId: string,
): Promise<{ docs: Snapshot[]; truncated: boolean }> {
  const docs: Snapshot[] = []
  let cursor: string | null = null
  for (;;) {
    let query = firestore
      .collection('hosts')
      .where('orgId', '==', orgId)
      .orderBy(firebaseAdmin.firestore.FieldPath.documentId())
      .limit(CRM_DIGEST_HOST_PAGE)
    if (cursor) query = query.startAfter(firestore.collection('hosts').doc(cursor))
    const page = await query.get()
    for (const doc of page.docs) docs.push(doc)
    if (page.docs.length < CRM_DIGEST_HOST_PAGE) return { docs, truncated: false }
    if (docs.length >= CRM_DIGEST_HOST_CEILING) {
      console.warn(
        `crm-daily-digest: org ${orgId} has more than ${CRM_DIGEST_HOST_CEILING} ` +
          'hosts — leads on the rest are not digested',
      )
      return { docs, truncated: true }
    }
    cursor = page.docs[page.docs.length - 1].id
  }
}

/** What one member's row in the response says. */
interface MemberReport {
  skipped?: string
  overdue?: number
  today?: number
  leads?: number
  notified?: boolean
  emailed?: boolean
  emailReason?: string
  deferred?: boolean
}

interface OrgReport {
  skipped?: string
  digests: number
  notified: number
  emailed: number
  members?: Record<string, MemberReport>
  hostsTruncated?: boolean
  tasksTruncated?: boolean
  /** The send-rate governor refused; the sweep stops here. */
  deferred?: boolean
}

interface SweepContext {
  firestore: Firestore
  nowMs: number
  day: string
  timeZone: string
  dryRun: boolean
  flagValues: Awaited<ReturnType<typeof getServerReleaseFlagValues>>
  origin: string
}

/** The console path a notification opens — the legacy `/{hostDocId}/rest` shape every host notification uses. */
function notificationLink(hostId: string, section: 'tasks' | 'leads'): string {
  return `/${hostId}/crm/${section}`
}

async function digestOrg(ctx: SweepContext, orgDoc: Snapshot): Promise<OrgReport> {
  const { firestore, nowMs, day, timeZone, dryRun } = ctx
  const orgId = orgDoc.id
  const org = (orgDoc.data() ?? {}) as Partial<AglynOrgBilling> & Record<string, unknown>
  const quiet: OrgReport = { digests: 0, notified: 0, emailed: 0 }

  if (!crmDigestEntitled(resolveOrgEntitlements(org).features)) {
    return { ...quiet, skipped: 'not-entitled' }
  }
  const flagOn = isReleaseFlagOnForOrg(
    'release_contacts',
    ctx.flagValues['release_contacts'],
    orgId,
    parseOrgReleaseFlagOverrides(org['releaseFlags']),
    resolveEffectivePlan(org),
  )
  if (!flagOn) return { ...quiet, skipped: 'release-flag' }

  const window = crmDigestWindow(nowMs, timeZone)

  /*
   * Every open task due before tomorrow, soonest first — overdue and today
   * in one query on `(status, dueAtMs)`, bucketed afterwards. Undated tasks
   * carry `dueAtMs: null`, which a range excludes.
   */
  const taskPage = await orgDoc.ref
    .collection(CRM_COLLECTIONS.tasks)
    .where('status', '==', 'open')
    .where('dueAtMs', '<', window.endMs)
    .orderBy('dueAtMs', 'asc')
    .limit(CRM_DIGEST_TASK_CEILING)
    .get()
  const tasks: CrmDigestTask[] = taskPage.docs.map((doc) => ({
    id: doc.id,
    title: String(doc.get('title') ?? ''),
    kind: doc.get('kind') ?? 'todo',
    dueAtMs: Number(doc.get('dueAtMs')),
    assigneeUid: String(doc.get('assigneeUid') ?? ''),
    hostId: String(doc.get('hostId') ?? ''),
    contactId: doc.get('contactId') || undefined,
    companyId: doc.get('companyId') || undefined,
    dealId: doc.get('dealId') || undefined,
  }))
  const tasksTruncated = taskPage.docs.length >= CRM_DIGEST_TASK_CEILING

  /*
   * The leads nobody has worked, per site. A window of the newest old leads
   * by first sighting, filtered in memory, for the reason the Leads section
   * gives: the capture door stamps no `status`, and a query cannot select on
   * a field's absence.
   */
  const hosts = await hostsOfOrg(firestore, orgId)
  const hostById = new Map(hosts.docs.map((doc) => [doc.id, doc]))
  const leadCutoff = nowMs - CRM_DIGEST_LEAD_AGE_MS
  const leads: CrmDigestLead[] = []
  for (const host of hosts.docs) {
    const page = await host.ref
      .collection('leads')
      .where('firstSeenAtMs', '<=', leadCutoff)
      .orderBy('firstSeenAtMs', 'desc')
      .limit(CRM_DIGEST_LEAD_WINDOW)
      .get()
    for (const doc of page.docs) {
      const data = doc.data() as Record<string, unknown>
      if (!isUnworkedLead(data as Parameters<typeof isUnworkedLead>[0], nowMs)) continue
      leads.push({
        id: doc.id,
        hostId: host.id,
        email: String(data['email'] ?? ''),
        name: String(data['name'] ?? '') || undefined,
        ownerUid: String(data['ownerUid'] ?? '') || undefined,
        firstSeenAtMs: Number(data['firstSeenAtMs']),
      })
    }
  }

  if (!tasks.length && !leads.length) return { ...quiet, skipped: 'nothing-owed' }

  const members = (await listOrgMembers(orgId)).filter(
    (member) => member.orgSuspended !== true,
  )
  const memberById = new Map(members.map((member) => [member.$id, member]))
  const digests = buildMemberDigests({
    tasks,
    leads,
    window,
    members: members.map((member) => ({
      uid: member.$id,
      reachesHost: (hostId: string) => hostRoleFor(member, hostId) !== null,
    })),
  })
  if (!digests.size) return { ...quiet, skipped: 'nobody-to-tell' }

  const markerRef = orgDoc.ref.collection(CRM_DIGEST_MARKER_COLLECTION).doc(day)
  const marker = await markerRef.get()
  const sentToday = (marker.get('members') ?? {}) as Record<string, unknown>

  // Sorted so the order members are told in — and the member a refusal
  // lands on — is the same on every run.
  const uids = [...digests.keys()].sort()
  const userDocs = await firestore.getAll(
    ...uids.map((uid) => firestore.collection('users').doc(uid)),
  )
  const userById = new Map(userDocs.map((doc) => [doc.id, doc]))

  const branding = resolveBrandingProfile(org)
  const orgSlug = String(org['slug'] ?? '')
  const hostName = (hostId: string): string => {
    const host = hostById.get(hostId)
    return String(host?.get('name') || host?.get('subdomain') || hostId)
  }
  const hubUrl = (hostId: string): string | null => {
    const subdomain = String(hostById.get(hostId)?.get('subdomain') ?? '')
    if (!orgSlug || !subdomain) return null
    return `${ctx.origin}${buildRoute(Route.HOST_DASHBOARD, { orgSlug, host: subdomain })}/crm`
  }
  const settingsUrl = `${ctx.origin}${buildRoute(Route.MANAGE_NOTIFICATIONS)}`
  const supportLine = brandSupportLine(branding)

  const report: OrgReport = { digests: 0, notified: 0, emailed: 0, members: {} }
  if (hosts.truncated) report.hostsTruncated = true
  if (tasksTruncated) report.tasksTruncated = true
  const rows = report.members as Record<string, MemberReport>
  let poolLookups = 0

  for (const uid of uids) {
    const digest = digests.get(uid) as CrmMemberDigest
    if (sentToday[uid]) {
      rows[uid] = { skipped: 'already-sent' }
      continue
    }
    const member = memberById.get(uid) as AglynOrgMember
    if (!(await memberHasOrgPermission(orgId, member, 'data.manage'))) {
      rows[uid] = { skipped: 'no-data-manage' }
      continue
    }
    const userDoc = userById.get(uid)
    if (!crmDailyDigestEnabled(userDoc?.get(DIGEST_PREFS_FIELD))) {
      rows[uid] = { skipped: 'digest-off' }
      continue
    }
    const muted = notificationMuted(
      userDoc?.get('notificationPrefs'),
      'content.crmDailyDigest',
    )
    const counts = crmDigestCounts(digest)
    const row: MemberReport = { ...counts }
    rows[uid] = row
    report.digests += 1
    if (dryRun) {
      row.notified = !muted
      continue
    }

    // The site the links open on: where the first task lives, else where
    // the first lead was captured.
    const anchorHostId = digest.overdue[0]?.hostId || digest.today[0]?.hostId || digest.leads[0]?.hostId || ''
    const section = counts.overdue + counts.today > 0 ? 'tasks' : 'leads'
    const hub = hubUrl(anchorHostId)

    /*
     * THE EMAIL FIRST. A refusal from the send-rate governor stops the run
     * with nothing else done for this member — no notification to double
     * tomorrow, no marker to skip them on — so the order here is the
     * idempotence, not a preference.
     */
    let emailed = false
    let emailReason: string | undefined
    let address = String(member.email ?? '').trim().toLowerCase()
    if (!address.includes('@') && poolLookups < CRM_DIGEST_EMAIL_MAX_UID_LOOKUPS) {
      poolLookups += 1
      const pooled = await findUserByUidAcrossPools(uid).catch(() => null)
      address = String(pooled?.record?.email ?? '').trim().toLowerCase()
    }
    const recipients = address.includes('@')
      ? await filterSuppressedEmails([address], firestore)
      : []
    if (!recipients.length) {
      emailReason = address.includes('@') ? 'suppressed' : 'no-recipient'
    } else {
      const result = await sendEmail({
        to: recipients,
        subject: composeCrmDigestSubject(counts),
        text: composeCrmDigestEmailText({
          digest,
          nowMs,
          timeZone,
          productName: branding.productName,
          tasksUrl: hub ? `${hub}/tasks` : ctx.origin,
          leadsUrl: (hostId) => `${hubUrl(hostId) ?? ctx.origin}/leads`,
          settingsUrl,
          hostName,
          supportLine,
        }),
        fromName: branding.fromName,
        context: 'crm-daily-digest',
        priority: 'bulk',
      })
      if (result.sent) {
        emailed = true
        await meterPlatformEmail().catch(() => undefined)
      } else if (rateLimitedRetryAtMs(result) !== null) {
        row.deferred = true
        report.deferred = true
        return report
      } else {
        emailReason = (result as { reason?: string }).reason ?? 'failed'
      }
    }

    let notified = false
    if (!muted) {
      await notifyUsers([uid], {
        type: 'content.crmDailyDigest',
        title: 'Your CRM today',
        body: composeCrmDigestSummary(counts),
        link: notificationLink(anchorHostId, section),
        orgId,
        ...(anchorHostId ? { hostId: anchorHostId } : {}),
      })
      notified = true
    }

    await markerRef.set(
      {
        day,
        members: {
          [uid]: { atMs: nowMs, ...counts, notified, emailed },
        },
        updatedAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
    row.notified = notified
    row.emailed = emailed
    if (emailReason) row.emailReason = emailReason
    if (notified) report.notified += 1
    if (emailed) report.emailed += 1
  }
  return report
}

async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders, query } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST' && method !== 'GET') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  if (!process.env.CRON_SECRET) {
    return Response.json(
      { error: 'The CRM digest is not configured (CRON_SECRET).' },
      { status: 501 },
    )
  }
  if (!isCronAuthorized(headers)) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }
  // A GET reports the plan and sends nothing; a bodyless POST — what the
  // scheduled workflow sends — is a real run. `isCronDryRun` keys the
  // default on the METHOD for exactly that reason.
  const dryRun = isCronDryRun({ method, body, query })
  // Stamped on the invocation, not on the work (AGL-1955), so the beat is
  // already there the day this job joins `SCHEDULED_JOBS`.
  if (method === 'POST') await recordCronBeat(CRM_DIGEST_JOB_ID)

  try {
    const firestore = firebaseAdmin.app().firestore()
    const nowMs = Date.now()
    const ctx: SweepContext = {
      firestore,
      nowMs,
      day: utcDayKey(nowMs),
      timeZone: digestTimeZone(),
      dryRun,
      flagValues: await getServerReleaseFlagValues(),
      origin: consoleOrigin(),
    }

    // The resumable sweep, in the shape `usage-alerts` reads orgs (AGL-2220):
    // ordered by id, `limit + 1` to learn whether there is more, the cursor
    // validated as an org id before it becomes a reference.
    const requestedLimit = Number((body as { limit?: unknown } | undefined)?.limit)
    const pageSize =
      Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(Math.floor(requestedLimit), CRM_DIGEST_ORG_CHUNK)
        : CRM_DIGEST_ORG_CHUNK
    const rawCursor = (body as { cursor?: unknown } | undefined)?.cursor
    const cursor =
      typeof rawCursor === 'string' && rawCursor.length > 0 && !rawCursor.includes('/')
        ? rawCursor
        : null
    let orgQuery = firestore
      .collection('orgs')
      .orderBy(firebaseAdmin.firestore.FieldPath.documentId())
      .limit(pageSize + 1)
    if (cursor) orgQuery = orgQuery.startAfter(firestore.collection('orgs').doc(cursor))
    const page = await orgQuery.get()
    const hasMore = page.docs.length > pageSize
    const orgDocs = hasMore ? page.docs.slice(0, pageSize) : page.docs

    const orgs: Record<string, OrgReport> = {}
    const failures: Record<string, string> = {}
    let digests = 0
    let notified = 0
    let emailed = 0
    let deferred = false
    for (const orgDoc of orgDocs) {
      try {
        const report = await digestOrg(ctx, orgDoc)
        orgs[orgDoc.id] = report
        digests += report.digests
        notified += report.notified
        emailed += report.emailed
        if (report.deferred) {
          deferred = true
          break
        }
      } catch (error) {
        console.error('[crm] daily digest failed for org', orgDoc.id, error)
        failures[orgDoc.id] = (error as Error)?.message ?? 'unknown'
      }
    }
    const failed = Object.keys(failures)
    return Response.json(
      {
        day: ctx.day,
        timeZone: ctx.timeZone,
        dryRun,
        swept: orgDocs.length,
        digests,
        notified,
        emailed,
        orgs,
        ...(deferred ? { deferred: true } : {}),
        ...(failed.length ? { failures } : {}),
        // A deferred run reports `done: true` — see the module comment —
        // so the workflow's loop does not re-POST into a full window.
        nextCursor: deferred || !hasMore ? null : (orgDocs[orgDocs.length - 1]?.id ?? null),
        done: deferred || !hasMore,
      },
      // 207: this chunk finished and some org in it needs a person, which is
      // what fails the workflow (its one alerting channel).
      { status: failed.length ? 207 : 200 },
    )
  } catch (error) {
    console.error('[crm] daily digest run failed', error)
    return Response.json({ error: 'CRM digest run failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as POST }

/** Cron routes run long: this one sweeps every org (AGL-1141). */
export const maxDuration = 60
