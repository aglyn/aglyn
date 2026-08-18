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
 * THE STAFF SIDE OF THE ABUSE QUEUE (AGL-1964).
 *
 * `GET` lists reports for `/admin/abuse-reports`; `POST` moves one between
 * statuses. Staff-gated end to end, same shape as
 * `/api/admin/media-quarantine` — this is the surface those two levers
 * finally have an input for.
 *
 * ## Why a route rather than a client Firestore listener
 *
 * `abuseReports` is `allow write: if false` for every client including a
 * staff browser, so a status change cannot be an `updateDoc`. That is
 * deliberate and it is not only about forgery (see the rules comment): moving
 * a report to `actioned` is the moment a lockdown or a quarantine gets its
 * justification, so it has to write the `adminAudit` row in the same act. A
 * bare client write would be a decision with no record of who made it.
 *
 * Reads could have been a listener — the rules allow a staff read — but going
 * through the route keeps one obligation in one place: **redaction**. See
 * below.
 *
 * ## Redaction, and why `support` staff see less than `super`
 *
 * A report carries the reporter's email and, on a DMCA notice, their real
 * legal name — the statute requires a signature, so we hold identity we did
 * not choose to collect. `support` is the read-only tier and the larger one;
 * it can triage every report without knowing who filed it, so it does not get
 * the identity. `super` sees it, because answering a counter-notice means
 * putting the two parties in contact and somebody has to be able to.
 *
 * This is a narrowing rather than a rule the product needed before: nothing
 * in the queue's workflow reads `reporterEmail`, so denying it to the tier
 * that only triages costs nothing.
 *
 * ## What this route deliberately does NOT do
 *
 * It does not delete reports and it does not offer an edit. A queue whose
 * rows can be removed is a queue that cannot answer "did we know, and when" —
 * which is the question that matters if a `*.aglyn.app` block ever gets
 * argued about. `dismissed` is a status, not a deletion.
 *
 * ## The other three quarters of §512 (AGL-1983)
 *
 * AGL-1964 left this route able to receive a copyright notice and act on it,
 * which is one of the four things §512 asks for. The rest arrive here rather
 * than in a parallel queue, because a counter-notice is a report with a
 * different shape and a different destination, and a strike is a consequence
 * of a decision made on this page:
 *
 *  - **The §512(g) put-back clock.** `GET` returns counter-notices alongside
 *    reports with their statutory deadline computed, and `POST` moves one
 *    between statuses. Forwarding a counter-notice — the §512(g)(2)(A)
 *    obligation — is the transition that stamps the site's own
 *    `suspendedUntilMs` with the restore instant, so the lock lifts itself.
 *    See {@link scheduleRestoration}.
 *  - **The §512(i) strike ledger.** Actioning a copyright report writes a
 *    strike against the ORG; moving it back off `actioned`, or restoring
 *    under a counter-notice, takes that strike off. See
 *    {@link syncStrikeLedger}.
 *  - **The threshold that does something.** At the termination threshold this
 *    route REFUSES to close a further copyright report on that account
 *    without a recorded decision. That refusal is the whole difference
 *    between a counter and a policy: §512(i) conditions the safe harbour on a
 *    policy "adopted and reasonably implemented", and a number nobody has to
 *    look at is the thing courts have declined to credit.
 *
 * ### The one thing none of this may ever do
 *
 * Break a healthy site. Every write below is conditioned on the host or org
 * ALREADY carrying a suspension: the counter-notice path can shorten or lift
 * a lock and can never create one, and the strike ledger suspends nothing at
 * all by itself. An earlier pass at `hostWritesFrozen` nearly shipped a
 * freeze that took publishing away from every paying customer, and that is
 * the failure mode here too — a takedown mechanism whose bug is indiscriminate
 * is worse than the hole it closes.
 */

import * as Aglyn from '@aglyn/aglyn/server'
import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'

export const dynamic = 'force-dynamic'

/**
 * Distinct orgs whose strike ledger one listing will read.
 *
 * The ledger lives at `orgs/{orgId}/dmcaStrikes`, so showing a strike count
 * beside a copyright report costs one subcollection read per DISTINCT org
 * carrying one on the page — not per row. Capped anyway: a page that somehow
 * held a hundred different orgs' copyright reports would otherwise turn one
 * queue render into a hundred reads, and the counts past the cap are reported
 * as unknown rather than as zero. A missing count that reads as "none" is how
 * a repeat infringer looks clean.
 */
const STRIKE_LOOKUP_MAX_ORGS = 25

/** Rows returned by one listing. The queue is triaged, not browsed. */
const PAGE_SIZE = 100

/** Doc ids are hex from the intake's sha256 — nothing else is addressable. */
const REPORT_ID = /^[a-f0-9]{8,64}$/

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null

const asMillis = (value: unknown): number | null => {
  if (value && typeof (value as any).toMillis === 'function') {
    try {
      return (value as any).toMillis()
    } catch {
      return null
    }
  }
  return typeof value === 'number' ? value : null
}

/**
 * One row, shaped for the page.
 *
 * `identityVisible` is returned explicitly rather than letting the page infer
 * "no email" from an absent field: a support-tier operator has to be able to
 * tell "this reporter was anonymous" from "you are not allowed to see who
 * this was", because only the first one means there is nobody to reply to.
 */
function rowPayload(
  id: string,
  data: Record<string, unknown>,
  canSeeIdentity: boolean,
) {
  const category = Aglyn.abuseReportCategory(data['category'])
  const dmca = (data['dmca'] ?? null) as Record<string, unknown> | null
  return {
    id,
    reference: asString(data['reference']),
    status: asString(data['status']) ?? 'open',
    category: category?.id ?? asString(data['category']),
    categoryLabel: category?.label ?? null,
    severity: category?.severity ?? asString(data['severity']),
    url: asString(data['url']),
    reportedHostname: asString(data['reportedHostname']),
    hostId: asString(data['hostId']),
    orgId: asString(data['orgId']),
    details: asString(data['details']),
    reportCount: Number(data['reportCount'] ?? 1),
    createdAtMs: asMillis(data['createdAt']),
    updatedAtMs: asMillis(data['updatedAt']),
    identityVisible: canSeeIdentity,
    reporterEmail: canSeeIdentity ? asString(data['reporterEmail']) : null,
    reporterName: canSeeIdentity ? asString(data['reporterName']) : null,
    // Whether a report HAS a contactable reporter is triage information at
    // every tier — it decides whether a follow-up question is even possible —
    // so the boolean is not redacted even when the address is.
    hasReporterContact: Boolean(data['reporterEmail']),
    dmca: dmca
      ? {
          work: asString(dmca['work']),
          // The signature is the reporter's real legal name, so it follows
          // the identity rule rather than the notice rule.
          signature: canSeeIdentity ? asString(dmca['signature']) : null,
          goodFaith: dmca['goodFaith'] === true,
          underPenalty: dmca['underPenalty'] === true,
        }
      : null,
    resolution: asString(data['resolution']),
    resolvedBy: asString(data['resolvedByEmail']),
    resolvedAtMs: asMillis(data['resolvedAt']),
  }
}

/**
 * One counter-notice row, shaped for the page, with its clock resolved.
 *
 * The three statutory instants are computed here rather than stored, so a row
 * written before the target inside the window last moved still renders
 * against today's arithmetic — and so the page never has to do date maths of
 * its own and disagree.
 *
 * The subscriber's identity follows the SAME redaction rule as the reporter's
 * on the notice side, and for a stronger reason: §512(g)(3)(D) forces a
 * counter-notice to carry a home address and a phone number, so this is the
 * most personal data anywhere in the queue, and it is data the filer had no
 * choice about supplying. `support` triages the deadline without it.
 */
function counterNoticePayload(
  id: string,
  data: Record<string, unknown>,
  canSeeIdentity: boolean,
  nowMs: number,
) {
  const receivedAtMs =
    typeof data['receivedAtMs'] === 'number'
      ? (data['receivedAtMs'] as number)
      : asMillis(data['receivedAt'])
  const status = asString(data['status']) ?? 'received'
  const clock =
    typeof receivedAtMs === 'number' && Number.isFinite(receivedAtMs)
      ? Aglyn.counterNoticeClock(receivedAtMs)
      : null
  const awaiting = Aglyn.counterNoticeAwaitsRestoration(status)
  return {
    id,
    reference: asString(data['reference']),
    noticeReference: asString(data['noticeReference']),
    status,
    url: asString(data['url']),
    reportedHostname: asString(data['reportedHostname']),
    hostId: asString(data['hostId']),
    orgId: asString(data['orgId']),
    material: asString(data['material']),
    submissionCount: Number(data['submissionCount'] ?? 1),
    receivedAtMs: receivedAtMs ?? null,
    // The clock, in the shape the page renders. `earliest`/`latest` travel
    // with `restoreAt` so the surface can SHOW that the date we chose sits
    // inside the window §512(g)(2)(C) draws, rather than asserting it.
    earliestRestoreMs: clock?.earliestMs ?? null,
    restoreAtMs: clock?.restoreAtMs ?? null,
    latestRestoreMs: clock?.latestMs ?? null,
    /**
     * Is the deadline behind us with the put-back still owed?
     *
     * The single most important number on the page. Restoring LATE is its own
     * §512(g) violation, and it is the failure that produces the outcome
     * AGL-1983 is really about — a customer locked out of their own work
     * because a queue was quiet.
     */
    overdue: Boolean(awaiting && clock && clock.latestMs <= nowMs),
    awaitingRestoration: awaiting,
    identityVisible: canSeeIdentity,
    subscriberName: canSeeIdentity ? asString(data['subscriberName']) : null,
    subscriberEmail: canSeeIdentity ? asString(data['subscriberEmail']) : null,
    subscriberAddress: canSeeIdentity ? asString(data['subscriberAddress']) : null,
    subscriberPhone: canSeeIdentity ? asString(data['subscriberPhone']) : null,
    signature: canSeeIdentity ? asString(data['signature']) : null,
    // The three sworn statements are NOT redacted: they are what makes the
    // document effective, and a support-tier operator has to be able to see
    // that it is complete in order to triage it at all.
    goodFaithMistake: data['goodFaithMistake'] === true,
    consentJurisdiction: data['consentJurisdiction'] === true,
    acceptService: data['acceptService'] === true,
    resolution: asString(data['resolution']),
    resolvedBy: asString(data['resolvedByEmail']),
    forwardedAtMs: asMillis(data['forwardedAt']),
    restoredAtMs: asMillis(data['restoredAt']),
  }
}

/**
 * Standing strikes for one org.
 *
 * Reads the ledger rather than a denormalized counter on the org document,
 * because the count decides whether an account gets terminated and a
 * denormalized number is one failed write away from being wrong in the
 * direction that matters. The ledger rows are the record; this is arithmetic
 * over them.
 *
 * `select('withdrawnAt')` projects to the one field the predicate reads —
 * deliberately that field and not none, because a projection that dropped it
 * would make `countStandingStrikes` see `undefined` on every row and count
 * every withdrawn strike as standing. A cheaper query that answers a
 * different question is the expensive kind of mistake here.
 */
async function standingStrikes(
  firestore: any,
  orgId: string,
): Promise<number> {
  const snapshot = await firestore
    .collection('orgs')
    .doc(orgId)
    .collection(Aglyn.STRIKE_LEDGER_SUBCOLLECTION)
    .select('withdrawnAt')
    .get()
  return Aglyn.countStandingStrikes(
    snapshot.docs.map((entry: any) => entry.data() as { withdrawnAt?: unknown }),
  )
}

/**
 * Add or withdraw the strike a copyright report carries.
 *
 * Keyed by the report id, which is what makes both halves exact: actioning a
 * report twice writes the same document twice and the count does not move,
 * and withdrawing removes precisely the strike this report created rather
 * than recomputing a total that some other report might have contributed to.
 *
 * Withdrawal MARKS rather than deletes. "Did we know, and when" is the
 * question this queue exists to answer, and a strike that was lifted — plus
 * the reason it was lifted — is part of that answer. `countStandingStrikes`
 * ignores marked rows.
 *
 * Returns what it did, so the caller can put it in the audit row: a strike
 * appearing or disappearing is a step toward or away from terminating a
 * paying customer's account, and it must never be a silent side effect.
 */
async function syncStrikeLedger(
  firestore: any,
  options: {
    orgId: string | null
    reportId: string
    category: string | null
    status: string
    actorUid: string
    actorEmail: string | null
    url: string | null
    withdrawalReason: Aglyn.StrikeWithdrawalReason
  },
): Promise<'added' | 'withdrawn' | null> {
  const { orgId, reportId, category, status } = options
  // No org means no account to count it against — a report about a site we
  // could not resolve, or one already erased. Recorded on the report either
  // way; there is simply nowhere to hang the strike.
  if (!orgId) return null
  const ref = firestore
    .collection('orgs')
    .doc(orgId)
    .collection(Aglyn.STRIKE_LEDGER_SUBCOLLECTION)
    .doc(reportId)

  if (Aglyn.strikeEarnedBy(category, status)) {
    await ref.set(
      {
        reportId,
        url: options.url,
        recordedByUid: options.actorUid,
        recordedByEmail: options.actorEmail,
        recordedAt: FieldValue.serverTimestamp(),
        // Cleared explicitly rather than left alone: a report that was
        // actioned, reversed, and then actioned again must not stay withdrawn
        // because the first reversal's mark survived the merge.
        withdrawnAt: null,
        withdrawnReason: null,
      },
      { merge: true },
    )
    return 'added'
  }

  if (Aglyn.strikeRemovedBy(category, status)) {
    const existing = await ref.get()
    // Nothing to withdraw: this report never earned one. Writing a withdrawn
    // row here would invent a strike in order to cancel it, and the ledger is
    // read as history.
    if (!existing.exists) return null
    if (existing.get('withdrawnAt') != null) return null
    await ref.set(
      {
        withdrawnAt: FieldValue.serverTimestamp(),
        withdrawnReason: options.withdrawalReason,
        withdrawnByUid: options.actorUid,
        withdrawnByEmail: options.actorEmail,
      },
      { merge: true },
    )
    return 'withdrawn'
  }

  return null
}

/**
 * Stamp the site's suspension with the put-back instant §512(g) requires.
 *
 * This is the moment the counter-notice stops being paperwork. `hosts/{id}`
 * carries `suspendedUntilMs` as an optional expiry, honoured server-side
 * since AGL-1512 and — since AGL-1981, in the same pass as this — by Firestore
 * rules too. Writing it here means the lock lifts ITSELF on the statutory
 * date, with no scheduled job to fail silently and no operator to remember.
 *
 * The clock is computed from RECEIPT, not from this call, which is the
 * property that makes the whole design safe: staff latency comes out of the
 * remaining wait rather than being added to the customer's lockout. A
 * counter-notice forwarded a week late restores a week sooner, not a week
 * later.
 *
 * ### Two refusals that keep this from being a weapon
 *
 *  - **It never creates a suspension.** If the host is not currently
 *    suspended there is nothing to schedule the end of, and writing
 *    `suspendedUntilMs` onto a healthy site would be writing half a takedown.
 *    Returns `notSuspended` and says so.
 *  - **It never EXTENDS one.** If the host already carries an expiry sooner
 *    than the statutory date, the sooner one stands. A counter-notice is a
 *    subscriber asking for their site back; it must not be capable of keeping
 *    a site down longer than the takedown staff actually imposed.
 */
async function scheduleRestoration(
  firestore: any,
  options: { hostId: string | null; restoreAtMs: number },
): Promise<'scheduled' | 'notSuspended' | 'alreadySooner' | 'noHost'> {
  const { hostId, restoreAtMs } = options
  if (!hostId) return 'noHost'
  const ref = firestore.collection('hosts').doc(hostId)
  const snapshot = await ref.get()
  if (!snapshot.exists || snapshot.get('suspendedAt') == null) {
    return 'notSuspended'
  }
  const existing = snapshot.get('suspendedUntilMs')
  if (typeof existing === 'number' && existing <= restoreAtMs) {
    return 'alreadySooner'
  }
  await ref.set({ suspendedUntilMs: restoreAtMs }, { merge: true })
  return 'scheduled'
}

/**
 * Cancel a scheduled put-back, returning the suspension to open-ended.
 *
 * The §512(g)(2)(B) exception: the complainant told us they filed an action
 * seeking a court order, so the material stays down. Also the path for a
 * counter-notice the subscriber withdrew or that was not one at all.
 *
 * Deletes the field rather than setting it far in the future, so the host
 * document ends up in the state an ordinary indefinite takedown produces —
 * one representation of "suspended with no end date", not two.
 *
 * Guarded the same way as scheduling: it will not touch a host that is not
 * suspended.
 */
async function cancelRestoration(
  firestore: any,
  hostId: string | null,
): Promise<'cancelled' | 'nothingScheduled' | 'noHost'> {
  if (!hostId) return 'noHost'
  const ref = firestore.collection('hosts').doc(hostId)
  const snapshot = await ref.get()
  if (!snapshot.exists || snapshot.get('suspendedAt') == null) {
    return 'nothingScheduled'
  }
  if (snapshot.get('suspendedUntilMs') == null) return 'nothingScheduled'
  await ref.set({ suspendedUntilMs: FieldValue.delete() }, { merge: true })
  return 'cancelled'
}

async function handler(request: Request): Promise<Response> {
  const {
    method,
    body,
    query,
    headers: rawHeaders,
  } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    if (!decoded['staff']) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }
    // Fails CLOSED to `support` on a missing claim, the AGL-495 posture: a
    // token without a role is the least-privileged reader, never the most.
    const actorRole = String(decoded['staffRole'] ?? 'support')
    const canSeeIdentity = actorRole === 'super'
    const firestore = firebaseAdmin.app().firestore()
    const collection = firestore.collection(Aglyn.ABUSE_REPORT_COLLECTION)

    if (method === 'GET') {
      const status = asString(query?.['status'])
      let listing = collection.orderBy('updatedAt', 'desc').limit(PAGE_SIZE)
      if (status && Aglyn.isAbuseReportStatus(status)) {
        listing = collection
          .where('status', '==', status)
          .orderBy('updatedAt', 'desc')
          .limit(PAGE_SIZE)
      }
      const snapshot = await listing.get()
      const reports = snapshot.docs.map((entry) =>
        rowPayload(entry.id, entry.data() as Record<string, unknown>, canSeeIdentity),
      )
      // Counted from the returned page, and SAID so. An operator reading "3
      // urgent" has to know whether that is the whole truth or the first
      // hundred rows' worth of it — a count that silently means the latter is
      // how a queue gets trusted while it is behind.
      const openUrgent = reports.filter(
        (report) => report.status === 'open' && report.severity === 'urgent',
      ).length

      /**
       * The §512(g) queue, alongside the reports rather than behind a tab.
       *
       * Ordered by RECEIPT ascending, not by `updatedAt` descending like the
       * reports above, and the difference is the point: a report queue is
       * read newest-first because the freshest report is the most urgent
       * thing in it, while a counter-notice queue is read oldest-first
       * because the oldest one is the one whose statutory deadline is closest.
       * Sorting these two the same way would bury the row that is about to
       * become a violation.
       */
      const nowMs = Date.now()
      const counterSnapshot = await firestore
        .collection(Aglyn.DMCA_COUNTER_NOTICE_COLLECTION)
        .orderBy('receivedAtMs', 'asc')
        .limit(PAGE_SIZE)
        .get()
      const counterNotices = counterSnapshot.docs.map((entry) =>
        counterNoticePayload(
          entry.id,
          entry.data() as Record<string, unknown>,
          canSeeIdentity,
          nowMs,
        ),
      )
      // Two numbers, and they mean different things. `awaitingForward` is
      // work; `overdueRestorations` is a breach that has already happened and
      // a customer already locked out past the date we owed them.
      const awaitingForward = counterNotices.filter(
        (notice) => notice.status === 'received',
      ).length
      const overdueRestorations = counterNotices.filter(
        (notice) => notice.overdue,
      ).length

      /**
       * Strike counts for the orgs on this page, one read per DISTINCT org.
       *
       * Only orgs that actually have a copyright report here: a strike count
       * beside a phishing report would invite reading it as a general
       * misconduct score, which is not what §512(i) counts and not what the
       * published policy will say.
       */
      const strikeOrgIds = [
        ...new Set(
          reports
            .filter((report) => report.category === 'dmca' && report.orgId)
            .map((report) => report.orgId as string),
        ),
      ]
      const strikes: Record<string, unknown> = {}
      for (const orgId of strikeOrgIds.slice(0, STRIKE_LOOKUP_MAX_ORGS)) {
        strikes[orgId] = Aglyn.repeatInfringerVerdict(
          await standingStrikes(firestore, orgId),
        )
      }
      return Response.json(
        {
          reports,
          counterNotices,
          strikes,
          // Said explicitly rather than inferred from a short map: an org
          // past the cap has an UNKNOWN count, and a page that rendered that
          // as zero would show a repeat infringer as clean.
          strikesTruncated: strikeOrgIds.length > STRIKE_LOOKUP_MAX_ORGS,
          counterNoticeCount: counterNotices.length,
          counterNoticesTruncated: counterNotices.length === PAGE_SIZE,
          awaitingForward,
          overdueRestorations,
          counterNoticeStatuses: Aglyn.COUNTER_NOTICE_STATUSES,
          restoreBusinessDays: Aglyn.COUNTER_NOTICE_RESTORE_BUSINESS_DAYS,
          count: reports.length,
          pageSize: PAGE_SIZE,
          truncated: reports.length === PAGE_SIZE,
          openUrgent,
          identityVisible: canSeeIdentity,
          actorRole,
          statuses: Aglyn.ABUSE_REPORT_STATUSES,
          readAtMs: Date.now(),
        },
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      )
    }

    if (method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 })
    }

    /**
     * The §512(g) branch, taken when the body names a counter-notice.
     *
     * A separate branch rather than a separate route: the two live in one
     * queue because they are one conversation, and one staff-auth /
     * audit-writing boundary is easier to keep honest than two.
     */
    const counterNoticeId = String(body?.['counterNoticeId'] ?? '').trim()
    if (counterNoticeId) {
      if (!REPORT_ID.test(counterNoticeId)) {
        return Response.json(
          { error: 'counterNoticeId is malformed' },
          { status: 400 },
        )
      }
      const nextStatus = String(body?.['counterNoticeStatus'] ?? '')
      if (!Aglyn.isCounterNoticeStatus(nextStatus)) {
        return Response.json(
          {
            error: `counterNoticeStatus must be one of ${Aglyn.COUNTER_NOTICE_STATUSES.join(', ')}`,
          },
          { status: 400 },
        )
      }
      const note = String(body?.['resolution'] ?? '').trim().slice(0, 2000)
      // Every counter-notice transition is a legal act with a consequence for
      // two named parties, so unlike a report status there is no "optional
      // note" case: `forwarded` means we sent it somewhere, `suitFiled` means
      // somebody told us about a court action, `rejected` means we declined a
      // sworn document. A year later, an unexplained row here is the one that
      // cannot be defended.
      if (!note) {
        return Response.json(
          {
            error:
              'Say what you did and why — a counter-notice step with no note ' +
              'cannot be explained later',
          },
          { status: 400 },
        )
      }

      const noticeRef = firestore
        .collection(Aglyn.DMCA_COUNTER_NOTICE_COLLECTION)
        .doc(counterNoticeId)
      const noticeBefore = await noticeRef.get()
      if (!noticeBefore.exists) {
        return Response.json({ error: 'No such counter-notice' }, { status: 404 })
      }
      const noticeData = noticeBefore.data() as Record<string, unknown>
      const previousStatus = asString(noticeData['status']) ?? 'received'
      const hostId = asString(noticeData['hostId'])
      const orgId = asString(noticeData['orgId'])
      const receivedAtMs =
        typeof noticeData['receivedAtMs'] === 'number'
          ? (noticeData['receivedAtMs'] as number)
          : asMillis(noticeData['receivedAt'])

      /**
       * The clock, computed from RECEIPT — never from now.
       *
       * This single line is what makes staff latency the queue's problem
       * rather than the customer's. Computing from `Date.now()` here would
       * restart the statutory window at the moment somebody got round to the
       * row, so a counter-notice that sat unread for a week would keep the
       * subscriber locked out a week longer than the law allows, and every
       * test that only checked "a date was written" would still be green.
       */
      const clock =
        typeof receivedAtMs === 'number' && Number.isFinite(receivedAtMs)
          ? Aglyn.counterNoticeClock(receivedAtMs)
          : null

      let scheduling:
        | 'scheduled'
        | 'notSuspended'
        | 'alreadySooner'
        | 'noHost'
        | 'cancelled'
        | 'nothingScheduled'
        | 'noClock'
        | null = null
      let strikeEffect: 'added' | 'withdrawn' | null = null

      if (nextStatus === 'forwarded') {
        // §512(g)(2)(A) discharged, and the put-back scheduled in the same
        // act, so the two cannot come apart.
        scheduling = clock
          ? await scheduleRestoration(firestore, {
              hostId,
              restoreAtMs: clock.restoreAtMs,
            })
          : 'noClock'
      } else if (
        nextStatus === 'suitFiled' ||
        nextStatus === 'withdrawn' ||
        nextStatus === 'rejected'
      ) {
        // The material stays down. Back to an open-ended suspension.
        scheduling = await cancelRestoration(firestore, hostId)
      }

      /**
       * A restoration withdraws the strike the takedown earned.
       *
       * The §512(g) process running to completion means the removal was
       * reversed, and a strike that survived it would count an infringement
       * the procedure just declined to affirm — the shape of unfairness that
       * makes a repeat-infringer policy read as unreasonably implemented,
       * which is the half of §512(i) providers actually lose on.
       *
       * Matched by the ORIGINAL notice's reference when the subscriber gave
       * us one. Without it there is nothing to key the strike on, and
       * guessing from the hostname could withdraw a strike earned by a
       * different, unrelated notice against the same site.
       */
      if (nextStatus === 'restored') {
        const linkedReference = asString(noticeData['noticeReference'])
        if (linkedReference && orgId) {
          const linked = await collection
            .where('reference', '==', linkedReference)
            .limit(1)
            .get()
          const linkedDoc = linked.docs[0]
          if (linkedDoc) {
            strikeEffect = await syncStrikeLedger(firestore, {
              orgId,
              reportId: linkedDoc.id,
              category: asString(linkedDoc.get('category')),
              // Not the report's real status — the report stays `actioned`,
              // because it WAS actioned and the history says so. This asks
              // the ledger for the withdrawal arm directly.
              status: 'dismissed',
              actorUid: decoded.uid,
              actorEmail: decoded.email ? String(decoded.email) : null,
              url: asString(linkedDoc.get('url')),
              withdrawalReason: 'counterNoticeRestored',
            })
          }
        }
      }

      const closing =
        nextStatus === 'restored' ||
        nextStatus === 'suitFiled' ||
        nextStatus === 'withdrawn' ||
        nextStatus === 'rejected'
      await noticeRef.set(
        {
          status: nextStatus,
          resolution: note,
          resolvedByUid: closing ? decoded.uid : null,
          resolvedByEmail: closing && decoded.email ? String(decoded.email) : null,
          ...(nextStatus === 'forwarded'
            ? {
                forwardedAt: FieldValue.serverTimestamp(),
                // Stored as well as computed, because this one is a claim
                // about what we actually scheduled on the host, not a
                // derivation — the two can differ when the host was not
                // suspended, and the row has to say which happened.
                scheduledRestoreAtMs: clock?.restoreAtMs ?? null,
                schedulingOutcome: scheduling,
              }
            : {}),
          ...(nextStatus === 'restored'
            ? { restoredAt: FieldValue.serverTimestamp() }
            : {}),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      )

      await firestore.collection('adminAudit').add({
        actorUid: decoded.uid,
        actorEmail: decoded.email ? String(decoded.email) : null,
        action: `dmcaCounterNotice.${nextStatus}`,
        scope: 'dmcaCounterNotice',
        target: `${Aglyn.DMCA_COUNTER_NOTICE_COLLECTION}/${counterNoticeId}`,
        before: { status: previousStatus },
        after: {
          status: nextStatus,
          // What happened to the SITE, in the same row. A restoration
          // scheduled onto a customer's live suspension is the most
          // consequential thing this route does, and an audit row that
          // recorded only the status change would leave it invisible.
          scheduling,
          scheduledRestoreAtMs: clock?.restoreAtMs ?? null,
          strike: strikeEffect,
        },
        reason: asString(noticeData['url']),
        note,
        at: FieldValue.serverTimestamp(),
      })

      const after = await noticeRef.get()
      return Response.json(
        {
          counterNotice: counterNoticePayload(
            counterNoticeId,
            after.data() as Record<string, unknown>,
            canSeeIdentity,
            Date.now(),
          ),
          scheduling,
          strike: strikeEffect,
          confirmed: asString(after.get('status')) === nextStatus,
        },
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      )
    }

    const id = String(body?.['id'] ?? '').trim()
    if (!REPORT_ID.test(id)) {
      return Response.json({ error: 'id is missing or malformed' }, { status: 400 })
    }
    const status = String(body?.['status'] ?? '')
    if (!Aglyn.isAbuseReportStatus(status)) {
      return Response.json(
        {
          error: `status must be one of ${Aglyn.ABUSE_REPORT_STATUSES.join(', ')}`,
        },
        { status: 400 },
      )
    }
    // Free text saying what was done — which lever, which notice number.
    // Required to CLOSE a report and optional otherwise: "actioned" with no
    // note is the row that, months later, nobody can act on.
    const resolution = String(body?.['resolution'] ?? '').trim().slice(0, 2000)
    if ((status === 'actioned' || status === 'dismissed') && !resolution) {
      return Response.json(
        { error: 'Say what you did — a closed report with no note is unreadable later' },
        { status: 400 },
      )
    }

    const ref = collection.doc(id)
    const before = await ref.get()
    if (!before.exists) {
      return Response.json({ error: 'No such report' }, { status: 404 })
    }
    const beforeStatus = asString(before.get('status')) ?? 'open'
    const category = asString(before.get('category'))
    const reportOrgId = asString(before.get('orgId'))

    /**
     * THE THRESHOLD THAT DOES SOMETHING (§512(i)).
     *
     * An account already at the termination threshold cannot have a further
     * copyright report closed until somebody records what is being done about
     * the account itself. This is the line that turns a counter into a
     * policy: §512(i) conditions the whole safe harbour on a policy "adopted
     * and reasonably implemented", and a strike count that nobody is ever
     * forced to look at is exactly what courts have declined to credit.
     *
     * It is a REFUSAL, not an automatic termination. Closing a paying
     * customer's account on three assertions by strangers, with no human in
     * the loop, is nothing §512 asks for — the statute says "in appropriate
     * circumstances", and judging the circumstances is the part a person must
     * do. So the route makes the decision unavoidable and recorded, and takes
     * whatever answer it is given, including "not this time, because —".
     *
     * Deliberately narrow: only on CLOSING, only for `dmca`, only for an org
     * already at the threshold BEFORE this report. A gate that fired on a
     * phishing report or on a first strike would jam the queue, and a jammed
     * abuse queue is its own safety problem.
     */
    const closing = status === 'actioned' || status === 'dismissed'
    const repeatInfringerDecision = String(
      body?.['repeatInfringerDecision'] ?? '',
    )
      .trim()
      .slice(0, 2000)
    if (closing && category === 'dmca' && reportOrgId) {
      const verdict = Aglyn.repeatInfringerVerdict(
        await standingStrikes(firestore, reportOrgId),
      )
      if (verdict.decisionRequired && !repeatInfringerDecision) {
        return Response.json(
          {
            error:
              `This account is at the repeat-infringer threshold ` +
              `(${verdict.strikes} strikes). ${verdict.consequence}`,
            code: 'repeatInfringerDecisionRequired',
            strikes: verdict.strikes,
            level: verdict.level,
          },
          { status: 409 },
        )
      }
    }

    await ref.set(
      {
        status,
        resolution: resolution || null,
        resolvedByUid: closing ? decoded.uid : null,
        resolvedByEmail: closing && decoded.email ? String(decoded.email) : null,
        resolvedAt: closing ? FieldValue.serverTimestamp() : null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )

    /**
     * The strike moves in the same act as the decision that caused it.
     *
     * After the report write and before the audit row, so the audit row can
     * state what actually happened to the ledger. `staffReversed` is the
     * withdrawal reason because this arm is only ever reached by a human
     * moving the report off `actioned` — the counter-notice route has its own
     * reason and its own path.
     */
    const strikeEffect = await syncStrikeLedger(firestore, {
      orgId: reportOrgId,
      reportId: id,
      category,
      status,
      actorUid: decoded.uid,
      actorEmail: decoded.email ? String(decoded.email) : null,
      url: asString(before.get('url')),
      withdrawalReason: 'staffReversed',
    })
    const strikesAfter = reportOrgId
      ? await standingStrikes(firestore, reportOrgId)
      : 0

    await firestore.collection('adminAudit').add({
      actorUid: decoded.uid,
      actorEmail: decoded.email ? String(decoded.email) : null,
      action: `abuseReport.${status}`,
      scope: 'abuseReport',
      target: `${Aglyn.ABUSE_REPORT_COLLECTION}/${id}`,
      before: { status: beforeStatus },
      after: {
        status,
        // A strike appearing or disappearing is a step toward or away from
        // terminating a paying customer's account. It must never be a silent
        // side effect of a status change.
        strike: strikeEffect,
        ...(strikeEffect ? { strikesStanding: strikesAfter } : {}),
      },
      // The recorded answer to the threshold gate, when one was demanded.
      // This is the artefact that shows the policy was applied rather than
      // merely published.
      ...(repeatInfringerDecision
        ? { repeatInfringerDecision }
        : {}),
      // The audit row carries the reported URL, deliberately: it is the fact
      // that makes the row mean anything a year later, and it is not the
      // reporter's data.
      reason: asString(before.get('url')),
      note: resolution || null,
      at: FieldValue.serverTimestamp(),
    })

    // Read back what was written rather than reporting the intent: a
    // `confirmed: false` is an alarm, not a quiet success.
    const after = await ref.get()
    return Response.json(
      {
        report: rowPayload(
          id,
          after.data() as Record<string, unknown>,
          canSeeIdentity,
        ),
        strike: strikeEffect,
        // Recomputed from the ledger rather than adjusted arithmetically, so
        // the number the page shows after an action is one the database
        // actually holds.
        repeatInfringer: reportOrgId
          ? Aglyn.repeatInfringerVerdict(strikesAfter)
          : null,
        confirmed: asString(after.get('status')) === status,
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    console.error('abuse report admin route failed', error)
    return Response.json({ error: 'Request failed' }, { status: 500 })
  }
}

export const GET = handler
export const POST = handler
