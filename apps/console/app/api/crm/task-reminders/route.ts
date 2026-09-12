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
  buildRoute,
  composeCrmTaskReminderBody,
  composeCrmTaskReminderEmailText,
  composeCrmTaskReminderSubject,
  CRM_COLLECTIONS,
  CRM_TASK_REMINDER_CEILING,
  type CrmReminderTask,
  crmDigestEntitled,
  crmTaskReminderDue,
  crmTaskReminderLink,
  isReleaseFlagOnForOrg,
  notificationMuted,
  parseOrgReleaseFlagOverrides,
  pluginRequestFromWeb,
  resolveBrandingProfile,
  resolveEffectivePlan,
  resolveOrgEntitlements,
  Route,
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
// lists. Same reasoning as the digest beside this route.
import { filterSuppressedEmails } from '@aglyn/tenant-data-admin/server/email-suppression'
import { isCronAuthorized, isCronDryRun } from '../../../../utils/cron-auth'
import { recordCronBeat } from '../../../../utils/cron-beat'
import { brandSupportLine } from '../../_lib/brand-support-line'
import { consoleOrigin } from '../../_lib/usage-alert-email'
import { digestTimeZone } from '../daily-digest/route'

// lockdown-423: exempt — server-internal cron (x-cron-secret), no user caller; it reads an org's CRM to remind its members and writes nothing a locked org could lose.

/**
 * A task's reminder at its own time (AGL-2659): `POST /api/crm/task-reminders`.
 *
 * The digest beside this route says once a morning what is late and what
 * is due today; nothing said "the 3:00 call is at 3:00". Every hour this
 * reads, per org, the open tasks whose `remindAtMs` has come and tells
 * each one's assignee ONCE — a console notification per task
 * (`content.taskReminder`, opening the record the task is for) and one
 * email per member per run listing everything of theirs that fell due.
 * The words and the rule live in `crm-task-reminders.ts`; this file is the
 * reads, the sends and the sweep, in the digest's shape wherever the two
 * do the same thing.
 *
 * ## Who is told, and who is not
 *
 * The task's ASSIGNEE, and nobody else — an unassigned task is a deliberate
 * choice in the drawer, as the digest reads it. Only a member who may open
 * the CRM (`data.manage`, resolved through their custom role), only in an
 * org whose plan carries the suite and whose `release_crm` flag is
 * on: the plan gate is the digest's own (`crmDigestEntitled`), so a plan
 * that gets no digest gets no reminders either. The recipient's
 * operational-category mute (`notificationPrefs.content`) governs the WHOLE
 * reminder, mail included — unlike the digest, which has a switch of its
 * own for the schedule it keeps; a reminder is one message about one task.
 *
 * ## Once, and resumable
 *
 * `reminderSentAtMs` on the task is the idempotence: stamped in one batch
 * with the member's sends, so a rerun over the same hour reads the mark and
 * sends nothing, and stamped on every reminder the run HANDLED — sent, or
 * found nobody to send it to — so a reminder nobody can be told about does
 * not come back every hour. A reminder is left unstamped only when the run
 * never reached a verdict: the send-rate governor refused, or the org
 * threw. Orgs are swept in id order behind a cursor, as the digest sweeps
 * them, so the workflow's `done:false` loop carries a platform of any
 * size across invocations.
 *
 * The task query reads the NEWEST reminders that have come due, not the
 * oldest — see `CRM_TASK_REMINDER_CEILING` for why that is what makes a
 * bounded page safe against a window that only ever grows.
 *
 * The email is a `bulk` send under the platform send-rate governor
 * (AGL-2409), metered as PLATFORM mail, for the digest's reasons: a cron
 * fan-out on the shared sending domain, and the platform reminding a
 * member is not the org's sending. A refusal STOPS the run and reports
 * `done: true`; the refused member was never stamped, and the next hour's
 * run finds their reminders at the top of the window again.
 */

/** The beat `/api/health/crons` reads — the `SCHEDULED_JOBS` row's id. */
export const CRM_TASK_REMINDERS_JOB_ID = 'crm-task-reminders'

/**
 * Orgs per invocation.
 *
 * More than the digest's twenty-five: an org here costs one task query and,
 * only when something fell due, the roster and the sends. The common hour
 * finds nothing due in most orgs, and a chunk that reads a hundred empty
 * queries finishes well inside `maxDuration = 60`.
 */
export const CRM_TASK_REMINDERS_ORG_CHUNK = 100

/**
 * The most members per org whose address is chased through the auth pools
 * when their member document carries none — the digest's bound, for the
 * digest's reason: work, not audience.
 */
export const CRM_TASK_REMINDERS_MAX_UID_LOOKUPS = 5

type Firestore = FirebaseFirestore.Firestore
type Snapshot = FirebaseFirestore.QueryDocumentSnapshot

/** What one member's row in the response says. */
interface MemberReport {
  tasks: number
  skipped?: string
  notified?: number
  emailed?: boolean
  emailReason?: string
  deferred?: boolean
}

interface OrgReport {
  skipped?: string
  /** Reminders that had come due and were not yet handled. */
  due: number
  /** Reminders this run stamped as handled. */
  handled: number
  /** Console notifications sent. */
  notified: number
  /** Emails sent — one per member per run. */
  emailed: number
  members?: Record<string, MemberReport>
  tasksTruncated?: boolean
  /** The send-rate governor refused; the sweep stops here. */
  deferred?: boolean
}

interface SweepContext {
  firestore: Firestore
  nowMs: number
  timeZone: string
  dryRun: boolean
  flagValues: Awaited<ReturnType<typeof getServerReleaseFlagValues>>
  origin: string
}

/** A due reminder with the document it came from, so the stamp has a target. */
interface DueTask extends CrmReminderTask {
  ref: FirebaseFirestore.DocumentReference
}

async function remindOrg(ctx: SweepContext, orgDoc: Snapshot): Promise<OrgReport> {
  const { firestore, nowMs, timeZone, dryRun } = ctx
  const orgId = orgDoc.id
  const org = (orgDoc.data() ?? {}) as Partial<AglynOrgBilling> & Record<string, unknown>
  const quiet: OrgReport = { due: 0, handled: 0, notified: 0, emailed: 0 }

  if (!crmDigestEntitled(resolveOrgEntitlements(org).features)) {
    return { ...quiet, skipped: 'not-entitled' }
  }
  const flagOn = isReleaseFlagOnForOrg(
    'release_crm',
    ctx.flagValues['release_crm'],
    orgId,
    parseOrgReleaseFlagOverrides(org['releaseFlags']),
    resolveEffectivePlan(org),
  )
  if (!flagOn) return { ...quiet, skipped: 'release-flag' }

  /*
   * Every open task whose reminder has come, newest first, on
   * `(status, remindAtMs desc)`. The "not yet handled" half is a fact about
   * a field's absence, which a query cannot select on, so it is asked of
   * the page in memory — and the page being the NEWEST five hundred is what
   * keeps the handled ones from crowding out the next one due.
   */
  const page = await orgDoc.ref
    .collection(CRM_COLLECTIONS.tasks)
    .where('status', '==', 'open')
    .where('remindAtMs', '<=', nowMs)
    .orderBy('remindAtMs', 'desc')
    .limit(CRM_TASK_REMINDER_CEILING)
    .get()
  const due: DueTask[] = []
  for (const doc of page.docs) {
    const data = doc.data() as Record<string, unknown>
    if (!crmTaskReminderDue(data as Parameters<typeof crmTaskReminderDue>[0], nowMs)) continue
    due.push({
      ref: doc.ref,
      id: doc.id,
      title: String(data['title'] ?? ''),
      kind: (data['kind'] as CrmReminderTask['kind']) ?? 'todo',
      dueAtMs: typeof data['dueAtMs'] === 'number' ? (data['dueAtMs'] as number) : null,
      remindAtMs: Number(data['remindAtMs']),
      assigneeUid: String(data['assigneeUid'] ?? ''),
      hostId: String(data['hostId'] ?? ''),
      contactId: (data['contactId'] as string) || undefined,
      companyId: (data['companyId'] as string) || undefined,
      dealId: (data['dealId'] as string) || undefined,
    })
  }
  const tasksTruncated = page.docs.length >= CRM_TASK_REMINDER_CEILING
  if (!due.length) {
    return { ...quiet, skipped: 'nothing-due', ...(tasksTruncated ? { tasksTruncated } : {}) }
  }

  const report: OrgReport = { due: due.length, handled: 0, notified: 0, emailed: 0, members: {} }
  if (tasksTruncated) report.tasksTruncated = true
  const rows = report.members as Record<string, MemberReport>

  /**
   * Stamp a set of reminders as handled, in one batch, unless this is a
   * plan. Everything a member's verdict covers lands together, which is
   * what makes a rerun read the same answer for all of them.
   */
  const settle = async (tasks: DueTask[]): Promise<void> => {
    report.handled += tasks.length
    if (dryRun) return
    const batch = firestore.batch()
    for (const task of tasks) batch.update(task.ref, { reminderSentAtMs: nowMs })
    await batch.commit()
  }

  const byAssignee = new Map<string, DueTask[]>()
  const unassigned: DueTask[] = []
  for (const task of due) {
    if (!task.assigneeUid) {
      unassigned.push(task)
      continue
    }
    const mine = byAssignee.get(task.assigneeUid) ?? []
    mine.push(task)
    byAssignee.set(task.assigneeUid, mine)
  }
  // A reminder for nobody is handled by saying so: it would otherwise sit
  // at the top of the window every hour for as long as the task is open.
  if (unassigned.length) {
    rows[''] = { tasks: unassigned.length, skipped: 'unassigned' }
    await settle(unassigned)
  }
  if (!byAssignee.size) return report

  const members = (await listOrgMembers(orgId)).filter(
    (member) => member.orgSuspended !== true,
  )
  const memberById = new Map(members.map((member) => [member.$id, member]))
  // Sorted so the order members are told in — and the member a refusal
  // lands on — is the same on every run.
  const uids = [...byAssignee.keys()].sort()
  const userDocs = await firestore.getAll(
    ...uids.map((uid) => firestore.collection('users').doc(uid)),
  )
  const userById = new Map(userDocs.map((doc) => [doc.id, doc]))

  // The sites the due tasks name, for the absolute links the mail carries.
  const hostIds = [...new Set(due.map((task) => task.hostId).filter(Boolean))]
  const hostDocs = hostIds.length
    ? await firestore.getAll(...hostIds.map((hostId) => firestore.collection('hosts').doc(hostId)))
    : []
  const hostById = new Map(hostDocs.map((doc) => [doc.id, doc]))

  const branding = resolveBrandingProfile(org)
  const orgSlug = String(org['slug'] ?? '')
  const orgHub = orgSlug ? `${ctx.origin}${buildRoute(Route.ORG_HOME, { orgSlug })}/crm` : null
  const hubUrl = (hostId: string): string | null => {
    if (!hostId) return orgHub
    const subdomain = String(hostById.get(hostId)?.get('subdomain') ?? '')
    if (!orgSlug || !subdomain) return null
    return `${ctx.origin}${buildRoute(Route.HOST_DASHBOARD, { orgSlug, host: subdomain })}/crm`
  }
  // The record the task is for, on its own hub — the notification's link
  // past the `/{hostId}/crm` or `/org/crm` prefix the console rewrites.
  const taskUrl = (task: CrmReminderTask): string => {
    const hub = hubUrl(task.hostId)
    if (!hub) return ctx.origin
    const link = crmTaskReminderLink(task.hostId || null, task)
    return `${hub}${link.slice(link.indexOf('/crm') + '/crm'.length)}`
  }
  const settingsUrl = `${ctx.origin}${buildRoute(Route.MANAGE_NOTIFICATIONS)}`
  const supportLine = brandSupportLine(branding)
  let poolLookups = 0

  for (const uid of uids) {
    const tasks = byAssignee.get(uid) as DueTask[]
    const row: MemberReport = { tasks: tasks.length }
    rows[uid] = row
    const member = memberById.get(uid)
    if (!member) {
      row.skipped = 'not-a-member'
      await settle(tasks)
      continue
    }
    if (!(await memberHasOrgPermission(orgId, member as AglynOrgMember, 'data.manage'))) {
      row.skipped = 'no-data-manage'
      await settle(tasks)
      continue
    }
    const userDoc = userById.get(uid)
    if (notificationMuted(userDoc?.get('notificationPrefs'), 'content.taskReminder')) {
      row.skipped = 'muted'
      await settle(tasks)
      continue
    }
    if (dryRun) {
      row.notified = tasks.length
      row.emailed = true
      await settle(tasks)
      continue
    }

    /*
     * THE EMAIL FIRST, for the digest's reason: a refusal from the
     * send-rate governor stops the run with nothing else done for this
     * member — no notification to double next hour, no mark to skip them
     * on — so the order here is the idempotence, not a preference.
     */
    let emailed = false
    let emailReason: string | undefined
    let address = String(member.email ?? '').trim().toLowerCase()
    if (!address.includes('@') && poolLookups < CRM_TASK_REMINDERS_MAX_UID_LOOKUPS) {
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
        subject: composeCrmTaskReminderSubject(tasks),
        text: composeCrmTaskReminderEmailText({
          tasks,
          timeZone,
          productName: branding.productName,
          taskUrl,
          settingsUrl,
          supportLine,
        }),
        fromName: branding.fromName,
        context: 'crm-task-reminder',
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

    // One notification per task: each opens the record it is for.
    for (const task of tasks) {
      await notifyUsers([uid], {
        type: 'content.taskReminder',
        title: 'Task reminder',
        body: composeCrmTaskReminderBody(task, timeZone),
        link: crmTaskReminderLink(task.hostId || null, task),
        orgId,
        ...(task.hostId ? { hostId: task.hostId } : {}),
      })
    }
    await settle(tasks)
    row.notified = tasks.length
    row.emailed = emailed
    if (emailReason) row.emailReason = emailReason
    report.notified += tasks.length
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
      { error: 'Task reminders are not configured (CRON_SECRET).' },
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
  // Stamped on the invocation, not on the work (AGL-1955): an hour with
  // nothing due still ran.
  if (method === 'POST') await recordCronBeat(CRM_TASK_REMINDERS_JOB_ID)

  try {
    const firestore = firebaseAdmin.app().firestore()
    const nowMs = Date.now()
    const ctx: SweepContext = {
      firestore,
      nowMs,
      timeZone: digestTimeZone(),
      dryRun,
      flagValues: await getServerReleaseFlagValues(),
      origin: consoleOrigin(),
    }

    // The resumable sweep, in the shape the digest reads orgs (AGL-2220):
    // ordered by id, `limit + 1` to learn whether there is more, the cursor
    // validated as an org id before it becomes a reference.
    const requestedLimit = Number((body as { limit?: unknown } | undefined)?.limit)
    const pageSize =
      Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(Math.floor(requestedLimit), CRM_TASK_REMINDERS_ORG_CHUNK)
        : CRM_TASK_REMINDERS_ORG_CHUNK
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
    let due = 0
    let handled = 0
    let notified = 0
    let emailed = 0
    let deferred = false
    for (const orgDoc of orgDocs) {
      try {
        const report = await remindOrg(ctx, orgDoc)
        orgs[orgDoc.id] = report
        due += report.due
        handled += report.handled
        notified += report.notified
        emailed += report.emailed
        if (report.deferred) {
          deferred = true
          break
        }
      } catch (error) {
        console.error('[crm] task reminders failed for org', orgDoc.id, error)
        failures[orgDoc.id] = (error as Error)?.message ?? 'unknown'
      }
    }
    const failed = Object.keys(failures)
    return Response.json(
      {
        timeZone: ctx.timeZone,
        dryRun,
        swept: orgDocs.length,
        due,
        handled,
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
    console.error('[crm] task reminders run failed', error)
    return Response.json({ error: 'Task reminders run failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as POST }

/** Cron routes run long: this one sweeps every org (AGL-1141). */
export const maxDuration = 60
