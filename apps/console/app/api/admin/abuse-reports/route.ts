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
 * `GET` answers three reads, each served by its own query
 * (`utils/abuse-report-list-query.ts`, AGL-3321):
 *
 *   (default)                one page of reports — the staff list wire,
 *                            Status and Category on the query, cursor-paged
 *   `queue=counterNotices`   one page of counter-notices, oldest receipt first
 *   `view=summary`           the queue's counts, each a query of its own
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
  closeRiskNotice,
  decideHeldOutboundSend,
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  resolveHostConsolePaths,
} from '@aglyn/tenant-data-admin'
import {
  heldPageConsolePath,
  heldPageDetails,
  heldPageLabel,
  heldPageVisitorSentence,
  type HeldPageSubject,
} from '@aglyn/shared-util-email/held-page'
import {
  renderStaffRiskNotice,
  resolveStaffRiskActions,
  RISK_NOTICE_CATALOG,
  riskKindForAbuseRow,
} from '@aglyn/shared-util-email/risk-notice-catalog'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'
import {
  describePhishingScreenSignals,
  type PhishingScreenSignal,
} from '@aglyn/shared-util-email/outbound-phishing-screen'
import { FieldValue } from 'firebase-admin/firestore'
import { addAdminAudit } from '@aglyn/tenant-data-admin/server/admin-audit-write'
import {
  ABUSE_REPORT_LIST_QUERY,
  COUNTER_NOTICE_AWAITING_STATUSES,
  COUNTER_NOTICE_LIST_QUERY,
  COUNTER_NOTICE_LIST_SORT,
  COUNTER_NOTICE_OVERDUE_READ_MAX,
  URGENT_ABUSE_CATEGORIES,
  counterNoticeOverdueBefore,
} from '../../../../utils/abuse-report-list-query'
import {
  readStaffListQuery,
  runStaffListQuery,
} from '../../../../utils/server/staff-list-query'
import { revalidateEntireHost } from '../../../../utils/server/tenant-revalidate'
import { SUSPENDED_FIELD, suspensionInForce } from '../../../../utils/server/suspended-flag'

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
 * Did the submitter's emailed receipt actually leave? (AGL-2400)
 *
 * THREE answers, and collapsing any two of them is the bug. `'sent'` and
 * `'failed'` are written by the tenant intake after it calls Resend; `null`
 * means the row carries no record at all — every submission filed before that
 * shipped, and every row from a deployment that never configured mail before
 * this landed.
 *
 * `null` is UNKNOWN and must render as unknown. Reading it as `'failed'` fills
 * the queue with imaginary work the day this deploys, which is how staff learn
 * to scroll past the flag; reading it as `'sent'` asserts a delivery nothing
 * measured. Deliberately the same "a verdict needs a third state" discipline
 * the strike counter uses for an org past the lookup cap.
 *
 * Anything else in the field — a value from a future writer, or a corrupted
 * row — answers `null` rather than being passed through, so the page's three
 * branches stay exhaustive.
 */
function receiptStatus(value: unknown): 'sent' | 'failed' | null {
  return value === 'sent' || value === 'failed' ? value : null
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
    /**
     * The receipt's fate (AGL-2400). NOT redacted, on the same argument as
     * `hasReporterContact` above: "this person is holding nothing" is triage
     * information at every tier, and a support-tier operator who can see the
     * failure can escalate it to someone who can see the address. Redacting it
     * would hide the work rather than the identity.
     */
    receiptStatus: receiptStatus(data['receiptStatus']),
    receiptReason: asString(data['receiptReason']),
    receiptAttemptedAtMs:
      asMillis(data['receiptAttemptedAtMs']) ??
      asMillis(data['receiptAttemptedAt']),
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
    /**
     * Who filed the row: `outbound-screen` for a send the phishing screen
     * held (AGL-3356), `payment-velocity` for a site whose payment doors
     * crossed the card-testing alarm (AGL-3363), absent for the public
     * intake.
     */
    source: asString(data['source']),
    heldSend: heldSendPayload(data['heldSend']),
    heldPage: heldPagePayload(data),
    paymentSignal: paymentSignalPayload(data['paymentSignal']),
    sellerPattern: sellerPatternPayload(data['sellerPattern']),
    riskNotice: riskNoticePayload(id, data),
    ownerReviewRequests: ownerReviewRequestsPayload(data['ownerReviewRequests']),
    reviewRequestedAtMs: asMillis(data['reviewRequestedAtMs']),
  }
}

/**
 * The page a held or flagged row is about, by name (AGL-3374): what it is,
 * its route, the entry it was showing, the layout or component its flagged
 * content lives in, what visitors see, and where to open it in the console
 * (`consoleHref`, filled by {@link withHeldPageLinks}). A row filed before
 * rows described their page names what it recorded.
 */
function heldPagePayload(data: Record<string, unknown>) {
  const held = (data['heldPage'] ?? null) as Record<string, unknown> | null
  if (!held || typeof held !== 'object') return null
  const hostId = asString(data['hostId'])
  const subject = held['subject'] as HeldPageSubject | undefined
  if (subject && typeof subject === 'object' && subject.screenId) {
    return {
      label: heldPageLabel(subject),
      kind: subject.kind,
      route: subject.route,
      url: subject.url,
      entryUrl: subject.entryUrl,
      details: heldPageDetails(subject),
      visitorSentence: heldPageVisitorSentence(subject),
      consolePath: hostId ? heldPageConsolePath(subject, hostId) : null,
      consoleHref: null as string | null,
    }
  }
  const screenId = asString(held['screenId'])
  const versionId = asString(held['versionId'])
  return {
    label: `screen ${screenId ?? 'unknown'}`,
    kind: null,
    route: null,
    url: asString(held['url']),
    entryUrl: null,
    details: [] as string[],
    visitorSentence: null,
    consolePath:
      hostId && screenId && versionId
        ? `/${hostId}/screens/${encodeURIComponent(screenId)}/versions/${encodeURIComponent(versionId)}/view`
        : null,
    consoleHref: null as string | null,
  }
}

/**
 * Each page row's console link, resolved for staff — who have no org of
 * their own to resolve a site path against — in one batch (AGL-3374).
 */
async function withHeldPageLinks<
  T extends { hostId: string | null; orgId: string | null; heldPage: ReturnType<typeof heldPagePayload> },
>(firestore: FirebaseFirestore.Firestore, rows: T[]): Promise<T[]> {
  const entries = rows.flatMap((row) =>
    row.heldPage?.consolePath && row.hostId
      ? [{ hostId: row.hostId, orgId: row.orgId, path: row.heldPage.consolePath }]
      : [],
  )
  if (!entries.length) return rows
  const hrefs = await resolveHostConsolePaths(firestore, entries).catch(
    () => new Map<string, string>(),
  )
  return rows.map((row) =>
    row.heldPage?.consolePath && row.hostId
      ? {
          ...row,
          heldPage: {
            ...row.heldPage,
            consoleHref: hrefs.get(`${row.hostId}\n${row.heldPage.consolePath}`) ?? null,
          },
        }
      : row,
  )
}

/**
 * The catalog's staff half for a row a risk source filed (AGL-3368): the
 * same title and summary the staff alert carried, and the actions — each a
 * deep link to the real control — so nobody has to hunt for where to act.
 * Null for a row from the public report form.
 */
function riskNoticePayload(id: string, data: Record<string, unknown>) {
  const stamp = (data['riskNotice'] ?? null) as Record<string, unknown> | null
  const kind = riskKindForAbuseRow({
    source: data['source'],
    heldSend: (data['heldSend'] ?? null) as { kind?: unknown } | null,
    riskNotice: stamp as { kind?: unknown } | null,
  })
  if (!kind) return null
  const seller = (data['sellerPattern'] ?? null) as Record<string, unknown> | null
  const orgId = asString(data['orgId'])
  const hostId = asString(data['hostId'])
  const createdAtMs = asMillis(data['createdAt'])
  const copy = renderStaffRiskNotice(kind, {
    'workspace.name': orgId,
    'item.label':
      asString(stamp?.['itemLabel']) ??
      asString(data['url']) ??
      asString(data['reportedHostname']),
    reference: asString(data['reference']),
    occurredAt: createdAtMs
      ? `${new Date(createdAtMs).toISOString().replace('T', ' ').slice(0, 16)} UTC`
      : null,
    // The row's own details carry the evidence, right beside this.
    'staff.evidence': '',
  })
  return {
    kind,
    noticeId: asString(stamp?.['noticeId']),
    ownersNotifiedAtMs: asMillis(stamp?.['ownersNotifiedAtMs']),
    title: copy.title,
    summary: copy.summary,
    reviewable: RISK_NOTICE_CATALOG[kind].reviewable,
    actions: resolveStaffRiskActions(kind, {
      reviewId: id,
      orgId,
      hostId,
      stripeUrl:
        asString(stamp?.['stripeUrl']) ?? asString(seller?.['stripeAccountUrl']),
      lockScope: hostId ? 'host' : orgId ? 'org' : null,
      lockTargetId: hostId ?? orgId,
    }).map((action) => ({
      id: action.id,
      label: action.label,
      hint: action.hint,
      href: action.href,
    })),
  }
}

/** The owners' review requests on a row, oldest first (AGL-3368). */
function ownerReviewRequestsPayload(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.slice(-20).map((entry) => {
    const request = (entry ?? {}) as Record<string, unknown>
    return {
      atMs: asMillis(request['atMs']),
      email: asString(request['email']),
      note: asString(request['note']) ?? '',
    }
  })
}

/**
 * A seller's fraud pattern, shaped for the page (AGL-3360): the connected
 * account whose sales drew several fraud warnings or disputes, the charges,
 * the workspaces and sites they were for, and its Stripe Dashboard page.
 */
function sellerPatternPayload(value: unknown) {
  if (!value || typeof value !== 'object') return null
  const pattern = value as Record<string, unknown>
  const strings = (list: unknown) =>
    Array.isArray(list) ? list.map((item) => String(item)).filter(Boolean) : []
  const threshold = Number(pattern['threshold'])
  const windowDays = Number(pattern['windowDays'])
  return {
    sellerAccountId: asString(pattern['sellerAccountId']),
    stripeAccountUrl: asString(pattern['stripeAccountUrl']),
    chargeIds: strings(pattern['chargeIds']),
    orgIds: strings(pattern['orgIds']),
    hostIds: strings(pattern['hostIds']),
    threshold: Number.isFinite(threshold) ? threshold : null,
    windowDays: Number.isFinite(windowDays) ? windowDays : null,
    livemode: pattern['livemode'] === true,
  }
}

/**
 * A Stripe fraud signal, shaped for the page (AGL-3356): which signal, the
 * charge and amount, what the card's checks said, and the org page's
 * Subscription card to act on. Staff-internal ids only; nothing a reporter
 * wrote.
 */
function paymentSignalPayload(value: unknown) {
  if (!value || typeof value !== 'object') return null
  const signal = value as Record<string, unknown>
  const checks = (signal['checks'] ?? null) as Record<string, unknown> | null
  const amount = Number(signal['amountCents'])
  return {
    kind: asString(signal['kind']),
    stripeObjectId: asString(signal['stripeObjectId']),
    chargeId: asString(signal['chargeId']),
    paymentIntentId: asString(signal['paymentIntentId']),
    amountCents:
      signal['amountCents'] === null || !Number.isFinite(amount) ? null : amount,
    currency: asString(signal['currency']) ?? 'usd',
    detail: asString(signal['detail']),
    livemode: signal['livemode'] === true,
    subscriptionCard: asString(signal['subscriptionCard']),
    checks: checks
      ? {
          cvcCheck: asString(checks['cvcCheck']),
          addressPostalCodeCheck: asString(checks['addressPostalCodeCheck']),
          cardCountry: asString(checks['cardCountry']),
          riskLevel: asString(checks['riskLevel']),
          threeDSecure: asString(checks['threeDSecure']),
        }
      : null,
  }
}

/**
 * A held outbound send, shaped for the page (AGL-3356): what was held, why,
 * and where the decision stands. The workspace's own words are shown as
 * text; the flagged host rides in `url`, which the page never links.
 */
function heldSendPayload(value: unknown) {
  if (!value || typeof value !== 'object') return null
  const held = value as Record<string, unknown>
  const signals = Array.isArray(held['signals'])
    ? (held['signals'] as PhishingScreenSignal[])
    : []
  return {
    kind: asString(held['kind']),
    path: asString(held['path']),
    subject: asString(held['subject']),
    fromName: asString(held['fromName']),
    state: asString(held['state']) ?? 'held',
    ageDays: typeof held['ageDays'] === 'number' ? (held['ageDays'] as number) : null,
    heldAtMs: asMillis(held['heldAtMs']),
    decidedBy: asString(held['decidedByEmail']),
    decidedAtMs: asMillis(held['decidedAtMs']),
    reasons: describePhishingScreenSignals(signals),
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
    /**
     * The receipt's fate (AGL-2400), unredacted for the same reason as on a
     * report — and sharper here. A counter-notice always carries an address,
     * because §512(g)(3) requires one, so `failed` on this row is never
     * ambiguous: somebody swore a legal statement, is locked out of their own
     * site, was told on the form that this address is *"how we will tell you
     * what happens next"*, and holds nothing.
     */
    receiptStatus: receiptStatus(data['receiptStatus']),
    receiptReason: asString(data['receiptReason']),
    receiptAttemptedAtMs:
      asMillis(data['receiptAttemptedAtMs']) ??
      asMillis(data['receiptAttemptedAt']),
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
 * ## The projection carries the whole answer now (AGL-2328)
 *
 * It used to be `select('withdrawnAt')` — the one field `countStandingStrikes`
 * reads. That was right about the arithmetic and wrong about the question.
 * `syncStrikeLedger` writes `url`, `recordedAt`, `recordedByEmail`,
 * `withdrawnReason`, `withdrawnByEmail` and says in its own docblock why
 * withdrawal MARKS rather than deletes: *"'Did we know, and when' is the
 * question this queue exists to answer."* Nothing could answer it. The count
 * reached a screen; every field that makes the count evidence was projected
 * away one line above the only reader, so the §512(i) repeat-infringer
 * defence was write-only.
 *
 * A projection that starves its consumer is the cheaper mistake here in both
 * directions: dropping `withdrawnAt` would count every withdrawn strike as
 * standing, and dropping the rest leaves a number nobody can substantiate.
 */
async function strikeLedger(
  firestore: any,
  orgId: string,
): Promise<{
  rows: Record<string, unknown>[]
  standing: number
}> {
  const snapshot = await firestore
    .collection('orgs')
    .doc(orgId)
    .collection(Aglyn.STRIKE_LEDGER_SUBCOLLECTION)
    .get()
  const data = snapshot.docs.map(
    (entry: any) => entry.data() as Record<string, unknown>,
  )
  const millis = (value: any) =>
    value?.toMillis?.() ?? (value?.seconds ? value.seconds * 1000 : null)
  const rows = data
    .map((row) => ({
      reportId: row['reportId'] ?? null,
      url: row['url'] ?? null,
      recordedAt: millis(row['recordedAt']),
      recordedByEmail: row['recordedByEmail'] ?? null,
      withdrawnAt: millis(row['withdrawnAt']),
      withdrawnReason: row['withdrawnReason'] ?? null,
      withdrawnByEmail: row['withdrawnByEmail'] ?? null,
      // Derived here so the page and the count cannot disagree about which
      // rows are standing — two implementations of that predicate is how a
      // termination decision and the evidence for it drift apart.
      standing: row['withdrawnAt'] == null,
    }))
    // Newest first. A §512(i) review reads "when did this start" off the
    // bottom of the list and "are they still at it" off the top.
    .sort((a, b) => (b.recordedAt ?? 0) - (a.recordedAt ?? 0))
  return {
    rows,
    standing: Aglyn.countStandingStrikes(
      data as { withdrawnAt?: unknown }[],
    ),
  }
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
  // The stored flag follows the window it now has: a put-back instant
  // already passed ends the lock on this write (`suspended-flag.ts`).
  await ref.set(
    {
      suspendedUntilMs: restoreAtMs,
      [SUSPENDED_FIELD]: suspensionInForce(true, restoreAtMs),
    },
    { merge: true },
  )
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
  // Open-ended again, so in force again — even when the put-back instant had
  // already passed and the lists had cleared the flag (`suspended-flag.ts`).
  await ref.set(
    { suspendedUntilMs: FieldValue.delete(), [SUSPENDED_FIELD]: true },
    { merge: true },
  )
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
      const nowMs = Date.now()

      /**
       * One row by id (AGL-3368): what a staff alert's deep link opens. The
       * queue is paged, so the row a notification names may be on no page
       * the list has loaded.
       */
      const oneId = asString(query?.['id'])
      if (oneId) {
        if (!REPORT_ID.test(oneId)) {
          return Response.json({ error: 'Malformed id' }, { status: 400 })
        }
        const snapshot = await collection.doc(oneId).get()
        if (!snapshot.exists) {
          return Response.json({ error: 'No such report' }, { status: 404 })
        }
        const [report] = await withHeldPageLinks(firestore, [
          rowPayload(oneId, snapshot.data() as Record<string, unknown>, canSeeIdentity),
        ])
        return Response.json(
          { report },
          { status: 200, headers: { 'Cache-Control': 'no-store' } },
        )
      }

      /**
       * The queue's counts, each its own query over the whole queue — never
       * a count of the rows one page happened to hold. An operator reading
       * "3 urgent" is reading the queue, whatever page the list is on.
       */
      if (asString(query?.['view']) === 'summary') {
        const counterNotices = firestore.collection(
          Aglyn.DMCA_COUNTER_NOTICE_COLLECTION,
        )
        const [urgent, received, candidates] = await Promise.all([
          collection
            .where('status', '==', 'open')
            .where('category', 'in', [...URGENT_ABUSE_CATEGORIES])
            .count()
            .get(),
          counterNotices.where('status', '==', 'received').count().get(),
          /**
           * The §512(g) breaches: the awaiting counter-notices old enough to
           * be past their ceiling, each checked against its own clock. Read
           * in the list's order, so a queue past the bound still says
           * "at least" about the oldest — the ones furthest past the date.
           */
          counterNotices
            .where('status', 'in', [...COUNTER_NOTICE_AWAITING_STATUSES])
            .where(
              COUNTER_NOTICE_LIST_SORT.path,
              '<=',
              counterNoticeOverdueBefore(nowMs),
            )
            .orderBy(COUNTER_NOTICE_LIST_SORT.path, COUNTER_NOTICE_LIST_SORT.direction)
            .limit(COUNTER_NOTICE_OVERDUE_READ_MAX + 1)
            .get(),
        ])
        const overdue = candidates.docs
          .slice(0, COUNTER_NOTICE_OVERDUE_READ_MAX)
          .filter((entry: any) => {
            const receivedAtMs = entry.get(COUNTER_NOTICE_LIST_SORT.path)
            return (
              typeof receivedAtMs === 'number' &&
              Aglyn.counterNoticeClock(receivedAtMs).latestMs <= nowMs
            )
          }).length
        return Response.json(
          {
            // Open reports in an urgent category, across the whole queue.
            openUrgent: Number(urgent.data().count ?? 0),
            // Two numbers, and they mean different things. `awaitingForward`
            // is work; `overdueRestorations` is a breach that has already
            // happened and a customer already locked out past the date we
            // owed them.
            awaitingForward: Number(received.data().count ?? 0),
            overdueRestorations: overdue,
            // The oldest `COUNTER_NOTICE_OVERDUE_READ_MAX` candidates were
            // read and more exist: the count is a floor, and says so.
            overdueAtLeast: candidates.docs.length > COUNTER_NOTICE_OVERDUE_READ_MAX,
            counterNoticeStatuses: Aglyn.COUNTER_NOTICE_STATUSES,
            restoreBusinessDays: Aglyn.COUNTER_NOTICE_RESTORE_BUSINESS_DAYS,
            identityVisible: canSeeIdentity,
            actorRole,
            statuses: Aglyn.ABUSE_REPORT_STATUSES,
            readAtMs: nowMs,
          },
          { status: 200, headers: { 'Cache-Control': 'no-store' } },
        )
      }

      // Both lists answer the staff list wire (`readStaffListQuery`): every
      // Filters-panel clause on the query, paged by a cursor in the list's
      // own order. A request whose filters cannot be read is refused rather
      // than answered with the whole queue under chips that say otherwise.
      const listRequest = readStaffListQuery(query ?? {})
      if (!listRequest) {
        return Response.json({ error: 'Unreadable filters' }, { status: 400 })
      }

      /**
       * The §512(g) queue, paged on its own beside the reports.
       *
       * Ordered by RECEIPT ascending, not by `updatedAt` descending like the
       * reports, and the difference is the point: a report queue is read
       * newest-first because the freshest report is the most urgent thing in
       * it, while a counter-notice queue is read oldest-first because the
       * oldest one is the one whose statutory deadline is closest. Sorting
       * these two the same way would bury the row that is about to become a
       * violation.
       */
      if (asString(query?.['queue']) === 'counterNotices') {
        const page = await runStaffListQuery({
          firestore,
          collection: firestore.collection(Aglyn.DMCA_COUNTER_NOTICE_COLLECTION),
          declaration: COUNTER_NOTICE_LIST_QUERY,
          request: listRequest,
          row: (entry) =>
            counterNoticePayload(
              entry.id,
              entry.data() as Record<string, unknown>,
              canSeeIdentity,
              nowMs,
            ),
        })
        return Response.json(
          {
            counterNotices: page.rows,
            nextCursor: page.nextCursor,
            hasMore: page.hasMore,
            refused: page.refused,
            notices: page.notices,
            identityVisible: canSeeIdentity,
            actorRole,
            readAtMs: nowMs,
          },
          { status: 200, headers: { 'Cache-Control': 'no-store' } },
        )
      }

      const page = await runStaffListQuery({
        firestore,
        collection,
        declaration: ABUSE_REPORT_LIST_QUERY,
        request: listRequest,
        row: (entry) =>
          rowPayload(entry.id, entry.data() as Record<string, unknown>, canSeeIdentity),
      })

      /**
       * Strike counts for the orgs on this page, one read per DISTINCT org,
       * carried on each copyright row.
       *
       * Only orgs that actually have a copyright report here: a strike count
       * beside a phishing report would invite reading it as a general
       * misconduct score, which is not what §512(i) counts and not what the
       * published policy will say. An org past the lookup cap is marked
       * `strikeUnknown` — an UNKNOWN count, which the page must never render
       * as zero, because a zero there is how a repeat infringer looks clean.
       */
      const strikeOrgIds = [
        ...new Set(
          page.rows
            .filter((report) => report.category === 'dmca' && report.orgId)
            .map((report) => report.orgId as string),
        ),
      ]
      const strikes: Record<string, Record<string, unknown>> = {}
      for (const orgId of strikeOrgIds.slice(0, STRIKE_LOOKUP_MAX_ORGS)) {
        const ledger = await strikeLedger(firestore, orgId)
        strikes[orgId] = {
          ...Aglyn.repeatInfringerVerdict(ledger.standing),
          // THE EVIDENCE BEHIND THE NUMBER (AGL-2328). The verdict alone is
          // an assertion; the ledger is what makes it a §512(i) defence.
          ledger: ledger.rows,
        }
      }
      const reports = (await withHeldPageLinks(firestore, page.rows)).map((report) => {
        const counted = report.category === 'dmca' && report.orgId
        return {
          ...report,
          strike: counted ? (strikes[report.orgId as string] ?? null) : null,
          strikeUnknown: Boolean(counted && !strikes[report.orgId as string]),
        }
      })
      return Response.json(
        {
          reports,
          nextCursor: page.nextCursor,
          hasMore: page.hasMore,
          refused: page.refused,
          notices: page.notices,
          identityVisible: canSeeIdentity,
          actorRole,
          readAtMs: nowMs,
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

      await addAdminAudit(firestore, {
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
        (await strikeLedger(firestore, reportOrgId)).standing,
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
     * A HELD SEND IS DECIDED BY CLOSING ITS ROW (AGL-3356).
     *
     * The phishing screen files a held campaign, email or published page
     * here as a `phishing` row carrying `heldSend`. Closing it is the decision, so the
     * queue needs no second pair of buttons and the decision cannot happen
     * without the note and the audit row every close already demands:
     * `dismissed` — a false positive — RELEASES the send, and `actioned`
     * REJECTS it. Moving it anywhere else leaves it held.
     *
     * After the status write, so a decision is never applied to a row whose
     * status did not move; before the audit row, so the audit says what it
     * did to the send.
     */
    const heldSendDecision =
      closing && before.get('heldSend')
        ? await decideHeldOutboundSend({
            reviewId: id,
            decision: status === 'dismissed' ? 'release' : 'reject',
            actorUid: decoded.uid,
            actorEmail: decoded.email ? String(decoded.email) : null,
            firestore,
          })
        : null

    /*
     * A held PAGE is served from the site's cache for up to an hour, and a
     * release is only real once visitors can see it — so the decision drops
     * the whole site's cache, the lockdown path's own drop. A rejection drops
     * it too, so a stale copy of the held version cannot outlive the verdict.
     */
    const heldHostId = asString(before.get('hostId'))
    if (
      heldSendDecision &&
      heldSendDecision !== 'not-held' &&
      (before.get('heldSend') as { kind?: string } | undefined)?.kind === 'page' &&
      heldHostId
    ) {
      await revalidateEntireHost(firestore, heldHostId)
    }

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
    /*
     * The closing notice (AGL-3368): the owners who were told this item was
     * held or flagged are told how it ended — released, or not approved —
     * in the catalog's words. Only on a closing status, only for a row a
     * risk source filed, and once per decision. Never throws.
     */
    const riskNoticeClose = closing
      ? await closeRiskNotice({
          reviewId: id,
          decision: status === 'dismissed' ? 'released' : 'rejected',
        })
      : null
    const ledgerAfter = reportOrgId
      ? await strikeLedger(firestore, reportOrgId)
      : null
    const strikesAfter = ledgerAfter?.standing ?? 0

    await addAdminAudit(firestore, {
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
        ...(heldSendDecision ? { heldSend: heldSendDecision } : {}),
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
        report: (
          await withHeldPageLinks(firestore, [
            rowPayload(id, after.data() as Record<string, unknown>, canSeeIdentity),
          ])
        )[0],
        strike: strikeEffect,
        // What closing the row did to the send it held (AGL-3356), or null.
        heldSend: heldSendDecision,
        // Whether the owners were told how it ended (AGL-3368), or null.
        ownerNotice: riskNoticeClose
          ? {
              duplicate: riskNoticeClose.duplicate,
              emailed: riskNoticeClose.owners.emailed,
              recipients: riskNoticeClose.owners.recipients,
              error: riskNoticeClose.error,
            }
          : null,
        // Recomputed from the ledger rather than adjusted arithmetically, so
        // the number the page shows after an action is one the database
        // actually holds.
        repeatInfringer: reportOrgId
          ? {
              ...Aglyn.repeatInfringerVerdict(strikesAfter),
              // The ledger travels with the verdict here too, so the card
              // does not have to re-list the queue to refresh its evidence
              // after an action (AGL-2328).
              ledger: ledgerAfter?.rows ?? [],
            }
          : null,
        confirmed: asString(after.get('status')) === status,
      },
      { status: 200, headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    // An unverifiable credential is a 401, not a fault of ours
    // (AGL-1993). Null for anything else, so a real failure keeps its 500.
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error('abuse report admin route failed', error)
    return Response.json({ error: 'Request failed' }, { status: 500 })
  }
}

export const GET = handler
export const POST = handler
