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

/*==========================================
 * HELD FOR REVIEW: outbound mail from a young workspace (AGL-3356).
 *
 * The phishing screen (`screenOutboundEmail`, shared-util-email) decides
 * whether a message carries a phishing signal, and `signalsThatHold` beside
 * it decides which signals hold for whom. This module is what happens next,
 * for every surface that screens — the send seam every tenant message
 * crosses ({@link installOutboundScreenGate}), the campaign core and the
 * automation step before they commit, and a site publish
 * (`hosted-page-review.ts`) — so none restates it:
 *
 * - WHO IS SCREENED. Every workspace, in two tiers. A lookalike link holds
 *   whatever the workspace's age. The soft rules (a brand in the sender
 *   name, the three-part lure) hold only for a workspace younger than
 *   {@link OUTBOUND_REVIEW_YOUNG_DAYS}: the incident's workspace was days
 *   old, and an established customer's clumsy copy never waits on them. An
 *   org whose creation date cannot be read is an existing customer (the same
 *   reading `orgAgeDays` gives the sending ramp) and is not young.
 * - WHERE A HOLD GOES. Into the abuse queue at `/admin/abuse-reports` — the
 *   staff surface that already exists to answer "is this phishing", with its
 *   audit trail, its urgent count and its staff notification — as a
 *   `phishing` row whose `heldSend` names the message. Not a new queue: a
 *   second place to look is a place nobody looks.
 * - HOW STAFF DECIDE. By the row's existing status. `dismissed` (a false
 *   positive) RELEASES the send; `actioned` REJECTS it. The admin route
 *   calls {@link decideHeldOutboundSend} in the same act as the status
 *   write, so the decision and its audit row cannot come apart.
 * - WHAT A RELEASE COVERS. Exactly the content that was held: the review
 *   row's id is derived from the message's source and a hash of its
 *   content, so an edited message is screened afresh rather than riding a
 *   release granted to different words.
 *
 * A hold is never a drop. A held campaign is parked as a scheduled send that
 * a release puts back on the clock; a held automation step fails that one
 * run with a reason the merchant can read, or — after a wait — stays queued
 * until the decision.
 *=========================================*/

import { createHash } from 'crypto'
import { ABUSE_REPORT_COLLECTION } from '@aglyn/aglyn/app-utils/abuse-report'
import { TENANT_APEX } from '@aglyn/aglyn/app-utils/host-naming'
import {
  describePhishingScreenSignals,
  isYoungWorkspaceAge,
  OUTBOUND_REVIEW_YOUNG_DAYS,
  type PhishingScreenInput,
  type PhishingScreenSignal,
  screenOutboundEmail,
  signalsThatHold,
} from '@aglyn/shared-util-email/outbound-phishing-screen'
import {
  type OutboundScreenGateRequest,
  type OutboundScreenGateVerdict,
  type SendingWorkspace,
  setOutboundScreenGate,
} from '@aglyn/shared-util-email/outbound-screen-gate'
import { FieldValue } from 'firebase-admin/firestore'
import { orgAgeDays } from './org-age'
import firebaseAdmin from './firebase-admin'
import { notifyRiskEvent, type RiskEventItem } from './risk-notice'

/** A workspace younger than this many days has the soft rules applied. */
export { OUTBOUND_REVIEW_YOUNG_DAYS }

/**
 * Where a held campaign is parked: a send time no processor run reaches.
 * A release replaces it with "now"; nothing else ever does, so a hold that
 * nobody decides stays a hold rather than lapsing into a send.
 */
export const HELD_SEND_AT_MS = 253402300799000

/**
 * Which surface held it: a campaign, an automation step, any other tenant
 * message at the send seam (`message`), a site publish (`page`), or a
 * submission to a public catalog a plugin keeps — a marketplace listing, its
 * publisher profile (`listing`, AGL-3365).
 */
export type HeldOutboundSendKind =
  | 'campaign'
  | 'action'
  | 'workflow'
  | 'orgAutomation'
  | 'message'
  | 'page'
  | 'listing'

/** The decision state a held send carries on its review row. */
export type HeldOutboundSendState = 'held' | 'released' | 'rejected'

/** What the review row records about the message it holds. */
export interface HeldOutboundSend {
  kind: HeldOutboundSendKind
  /** The document the message came from — a send, an action, a workflow. */
  path: string
  hostId: string
  orgId: string | null
  contentHash: string
  subject: string
  fromName: string | null
  signals: PhishingScreenSignal[]
  state: HeldOutboundSendState
  heldAtMs: number
  /** Workspace age in days when it was held, for the reviewer. */
  ageDays: number | null
}

/**
 * Is this workspace young enough to screen?
 *
 * Age alone, deliberately. Payment history was the other candidate and the
 * incident is the argument against it: the actor PAID, on a card that never
 * met 3-D Secure, within days of signing up. A paid invoice proves a card
 * worked, not that its holder is who they say.
 */
export function isYoungWorkspace(
  org: { createdAt?: unknown } | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  return isYoungWorkspaceAge(orgAgeDays(org?.createdAt, nowMs))
}

/**
 * The workspace a host's mail belongs to, as the send seam's screen reads it
 * — stamped on the sending identity by `hostSendingIdentity` from the host
 * and org documents it has already read.
 */
export function sendingWorkspaceFor(input: {
  hostId: string
  orgId: string | null
  org?: Record<string, unknown> | null
  host?: Record<string, unknown> | null
  nowMs?: number
}): SendingWorkspace {
  const identity = workspaceScreenIdentity({ org: input.org, host: input.host })
  return {
    hostId: input.hostId,
    orgId: input.orgId,
    ageDays: orgAgeDays(
      (input.org as { createdAt?: unknown } | null | undefined)?.createdAt,
      input.nowMs ?? Date.now(),
    ),
    ownNames: (identity.ownNames ?? []).filter((name): name is string => Boolean(name)),
    ownDomains: (identity.ownDomains ?? []).filter((domain): domain is string => Boolean(domain)),
  }
}

/**
 * The workspace's own names and hosts, as the screen reads them: a brand in
 * its own name is its own, and a link to its own site is not "elsewhere".
 */
export function workspaceScreenIdentity(input: {
  org?: Record<string, unknown> | null
  host?: Record<string, unknown> | null
}): Pick<PhishingScreenInput, 'ownNames' | 'ownDomains'> {
  const org = input.org ?? {}
  const host = input.host ?? {}
  const text = (value: unknown) => (typeof value === 'string' ? value : '')
  const subdomain = text(host['subdomain'])
  return {
    ownNames: [text(org['name']), text(host['name']), subdomain],
    ownDomains: [
      subdomain ? `${subdomain}.${TENANT_APEX}` : '',
      text(host['cname']),
      text(host['sendingDomain']),
    ],
  }
}

/**
 * JSON with every object's keys sorted, so the same design serializes to the
 * same string however it was read. Firestore hands back a map's keys in an
 * order that differs by reader, and a release keyed on a hash of an unsorted
 * serialization would not match the very content it released.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, entry) =>
    entry && typeof entry === 'object' && !Array.isArray(entry)
      ? Object.fromEntries(
          Object.keys(entry as Record<string, unknown>)
            .sort()
            .map((key) => [key, (entry as Record<string, unknown>)[key]]),
        )
      : entry,
  )
}

/** A stable hash of what a message says, so a release covers these words only. */
export function outboundContentHash(parts: readonly unknown[]): string {
  return createHash('sha256').update(canonicalJson(parts)).digest('hex')
}

/**
 * The review row's id: one row per (source, content). Hex, so the admin
 * route's report-id pattern addresses it like any intake row.
 */
export function heldOutboundReviewId(path: string, contentHash: string): string {
  return createHash('sha256')
    .update(`outbound-hold:${path}:${contentHash}`)
    .digest('hex')
    .slice(0, 40)
}

/** The staff-facing reference, in the intake's `AR-` style. */
export function heldOutboundReference(reviewId: string): string {
  return `HS-${reviewId.slice(0, 10).toUpperCase()}`
}

export interface OutboundScreenRequest {
  kind: HeldOutboundSendKind
  path: string
  hostId: string
  orgId: string | null
  org: Record<string, unknown> | null
  host: Record<string, unknown> | null
  subject: string
  fromName?: string | null
  /**
   * The address it leaves from (AGL-3362). Read by the lookalike rule only,
   * and kept out of the content hash so a release granted before this was
   * read still names the same row.
   */
  fromAddress?: string | null
  replyTo?: string | readonly string[] | null
  preheader?: string | null
  bodies: readonly (string | null | undefined)[]
  nowMs?: number
}

/** What a screen answers for one piece of content. */
export type OutboundScreenOutcome =
  | {
      outcome: 'send'
      /** The review row staff released this content under, when there is one. */
      releasedReviewId?: string
    }
  | { outcome: 'held' | 'rejected'; reviewId: string; reference: string; contentHash: string }

/** What a surface files when its screen holds, for {@link fileOutboundHold}. */
export interface OutboundHoldFiling {
  reviewId: string
  heldSend: HeldOutboundSend
  /** Extra fields a surface records beside `heldSend` (a page's version). */
  extra?: Record<string, unknown>
  /** The first line of the row's details, naming what was held. */
  headline: string
  /** The staff alert's title and body, the first time. */
  alertTitle: string
  alertBody: string
  /** The URL the row reports: the flagged host, or the held page. */
  url: string | null
  reportedHostname: string | null
  /**
   * What the workspace's owners are told the first time (AGL-3368): the held
   * item in their words and its console page. The alert title and body above
   * are the STAFF half; the owners read the catalog's own words, which never
   * name the signals.
   */
  item?: RiskEventItem | null
}

/**
 * The held item as the owners see it, from the surface and the source path
 * (AGL-3368): the campaign's own email page, the automation list, or nothing
 * for a message the send seam held (the notice then leads to Holds & reviews).
 */
export function heldSendItem(input: {
  kind: HeldOutboundSendKind
  path: string
  hostId: string
  subject: string
  context?: string | null
}): RiskEventItem {
  const subject = input.subject.slice(0, 120)
  const id = input.path.split('/').pop() ?? ''
  switch (input.kind) {
    case 'campaign':
      return {
        label: `the campaign "${subject}"`,
        path: id ? `/org/emails/messages/${encodeURIComponent(id)}` : null,
      }
    case 'orgAutomation':
      return { label: `the automated email "${subject}"`, path: '/org/automation' }
    case 'workflow':
    case 'action':
      return { label: `the automated email "${subject}"`, path: `/${input.hostId}/automation` }
    case 'page':
      return { label: `the page ${subject}`, path: null }
    default:
      return {
        label: input.context
          ? `the email "${subject}" (${input.context})`
          : `the email "${subject}"`,
        path: null,
      }
  }
}

/**
 * Write (or count) the review row for a hold, and tell staff the first time.
 * Returns the row's decision state — a row staff already decided answers
 * with that decision and is not written.
 *
 * One writer for every surface, so a campaign, a seam message and a page
 * land in the queue in the one shape the admin route and page already read.
 */
export async function fileOutboundHold(
  filing: OutboundHoldFiling,
): Promise<HeldOutboundSendState> {
  const firestore = firebaseAdmin.app().firestore()
  const ref = firestore.collection(ABUSE_REPORT_COLLECTION).doc(filing.reviewId)
  const reference = heldOutboundReference(filing.reviewId)
  let first = false
  let state = 'held' as HeldOutboundSendState
  await firestore.runTransaction(async (transaction) => {
    const existing = await transaction.get(ref)
    first = !existing.exists
    const stored = existing.exists
      ? (existing.get('heldSend') as Partial<HeldOutboundSend> | undefined)
      : undefined
    state = stored?.state === 'released' || stored?.state === 'rejected'
      ? stored.state
      : 'held'
    if (state !== 'held') return
    transaction.set(
      ref,
      {
        reference,
        category: 'phishing',
        severity: 'urgent',
        // Who filed it: the screen, not a person. The queue reads it to
        // say so, and a reporter-contact field stays honestly empty.
        source: 'outbound-screen',
        // The flagged host as TEXT — the page never renders a reported URL
        // as a link, and this one may be a phishing kit's.
        url: filing.url,
        reportedHostname: filing.reportedHostname,
        hostId: filing.heldSend.hostId,
        orgId: filing.heldSend.orgId,
        details: [
          filing.headline,
          ...describePhishingScreenSignals(filing.heldSend.signals),
          filing.heldSend.kind === 'page'
            ? 'Dismiss to release this publish; mark it actioned to reject it.'
            : filing.heldSend.kind === 'listing'
              ? 'Dismiss to release this submission (the publisher submits it again and it ' +
                'goes through); mark it actioned to reject it.'
              : 'Dismiss to release this send; mark it actioned to reject it.',
        ]
          .join('\n')
          .slice(0, 5000),
        reporterEmail: null,
        reporterName: null,
        dmca: null,
        // Every message the same content held counts here, so a workflow
        // firing on each new contact reads as the volume it is.
        reportCount: FieldValue.increment(1),
        heldSend: first
          ? filing.heldSend
          : { ...filing.heldSend, heldAtMs: stored?.heldAtMs ?? filing.heldSend.heldAtMs },
        ...(filing.extra ?? {}),
        updatedAt: FieldValue.serverTimestamp(),
        ...(first
          ? { status: 'open', createdAt: FieldValue.serverTimestamp() }
          : {}),
      },
      { merge: true },
    )
  })
  if (first && state === 'held') {
    // The owners learn what was held and how to ask for a review; staff get
    // the alert with the evidence and a link to this row. One seam, once.
    await notifyRiskEvent({
      kind: filing.heldSend.kind === 'page' ? 'page-held' : 'email-held',
      orgId: filing.heldSend.orgId,
      hostId: filing.heldSend.hostId,
      reviewId: filing.reviewId,
      reference,
      occurredAtMs: filing.heldSend.heldAtMs,
      item:
        filing.item ??
        heldSendItem({
          kind: filing.heldSend.kind,
          path: filing.heldSend.path,
          hostId: filing.heldSend.hostId,
          subject: filing.heldSend.subject,
        }),
      staffEvidence: [
        filing.alertBody,
        ...describePhishingScreenSignals(filing.heldSend.signals),
      ].join(' '),
    })
  }
  return state
}

/** The first signal that names a host, for the row's reported URL. */
export function flaggedHostOf(signals: readonly PhishingScreenSignal[]): string | null {
  const flagged = signals.find(
    (signal): signal is Extract<PhishingScreenSignal, { host: string }> => 'host' in signal,
  )
  return flagged?.host ?? null
}

/**
 * The screen's answer for one message, and what to do with it.
 *
 * - `send` — clean under the tiers, or held earlier and RELEASED by staff
 *   for exactly this content (then `releasedReviewId` names the row, and the
 *   caller hands it to `sendEmail` so the seam's screen honors it too).
 * - `held` — hold it. The review row is written (or its count bumped) and
 *   staff are told the first time.
 * - `rejected` — staff rejected exactly this content. Never sent.
 *
 * Every workspace is screened; `signalsThatHold` applies the tiers, so an
 * established workspace is held only by a lookalike link.
 *
 * Fails OPEN on a store error, the posture of every other control on the
 * send path: an outage on the review queue must not become an outage on
 * every workspace's mail. The screen itself cannot fail.
 */
export async function screenOutboundSend(
  request: OutboundScreenRequest,
): Promise<OutboundScreenOutcome> {
  const nowMs = request.nowMs ?? Date.now()
  const ageDays = orgAgeDays(
    (request.org as { createdAt?: unknown } | null)?.createdAt,
    nowMs,
  )
  const verdict = screenOutboundEmail({
    subject: request.subject,
    fromName: request.fromName ?? null,
    fromAddress: request.fromAddress ?? null,
    replyTo: request.replyTo ?? null,
    preheader: request.preheader ?? null,
    bodies: request.bodies,
    ...workspaceScreenIdentity({ org: request.org, host: request.host }),
  })
  const signals = signalsThatHold(verdict.signals, { ageDays })
  if (!signals.length) return { outcome: 'send' }

  const contentHash = outboundContentHash([
    request.subject,
    request.fromName ?? '',
    request.replyTo ?? '',
    request.preheader ?? '',
    ...request.bodies.map((body) => body ?? ''),
  ])
  const reviewId = heldOutboundReviewId(request.path, contentHash)
  const reference = heldOutboundReference(reviewId)
  try {
    const heldSend: HeldOutboundSend = {
      kind: request.kind,
      path: request.path,
      hostId: request.hostId,
      orgId: request.orgId,
      contentHash,
      subject: request.subject.slice(0, 300),
      fromName: request.fromName ? String(request.fromName).slice(0, 120) : null,
      signals,
      state: 'held',
      heldAtMs: nowMs,
      ageDays,
    }
    const flagged = flaggedHostOf(signals)
    const state = await fileOutboundHold({
      reviewId,
      heldSend,
      headline:
        `Held ${request.kind === 'campaign' ? 'campaign' : `${request.kind} email step`} ` +
        `"${heldSend.subject}" from a workspace ${ageDays ?? '?'} day(s) old.`,
      alertTitle: 'Outbound email held for review — possible phishing',
      alertBody:
        `A ${request.kind === 'campaign' ? 'campaign' : 'automated email'} ` +
        `was held: "${request.subject.slice(0, 120)}".`,
      url: flagged ? `https://${flagged}/` : null,
      reportedHostname: flagged,
    })
    if (state === 'released') return { outcome: 'send', releasedReviewId: reviewId }
    return { outcome: state === 'rejected' ? 'rejected' : 'held', reviewId, reference, contentHash }
  } catch (error) {
    console.error('[outbound-review] hold could not be recorded — allowing', error)
    return { outcome: 'send' }
  }
}

/**
 * How long this process trusts what it last learned about a seam row: that
 * it is held (so the next message carrying the same signals skips the
 * write), or how staff decided it. Short, because a decision must reach a
 * sender within a minute; long enough that a newsletter fanned out to a
 * thousand people costs one transaction rather than a thousand on one
 * document.
 */
const SEAM_MEMO_TTL_MS = 60_000
const seamMemo = new Map<string, { state: HeldOutboundSendState; atMs: number }>()

/** Test seam: forget what this process learned about seam rows. */
export function resetOutboundSeamMemoForTests(): void {
  seamMemo.clear()
}

/**
 * The seam row's id for a site and the signals that held. Keyed on the
 * SIGNALS rather than the words: a message at the seam is already
 * personalized per recipient, so its words differ for every person while
 * what makes it phishing — the lookalike host, the brand and the lure — does
 * not. A release therefore covers this site's use of exactly these signals,
 * and a message carrying any other signal is screened afresh.
 */
export function seamReviewId(hostId: string, signals: readonly PhishingScreenSignal[]): string {
  const key = signals
    .map((signal) => canonicalJson(signal))
    .sort()
    .join('\n')
  return heldOutboundReviewId(`hosts/${hostId}/outbound`, outboundContentHash([key]))
}

/** Is this row a staff RELEASE for this site? */
async function isReleaseForHost(reviewId: string, hostId: string): Promise<boolean> {
  const memoKey = `release:${hostId}:${reviewId}`
  const memo = seamMemo.get(memoKey)
  if (memo && Date.now() - memo.atMs < SEAM_MEMO_TTL_MS) return memo.state === 'released'
  const snapshot = await firebaseAdmin
    .app()
    .firestore()
    .collection(ABUSE_REPORT_COLLECTION)
    .doc(reviewId)
    .get()
  const held = snapshot.get('heldSend') as Partial<HeldOutboundSend> | undefined
  const released = held?.state === 'released' && held?.hostId === hostId
  seamMemo.set(memoKey, { state: released ? 'released' : 'held', atMs: Date.now() })
  return released
}

/**
 * The send seam's gate: what `sendEmail` asks when a tenant message carries
 * a signal that holds (see `outbound-screen-gate.ts`). Installed at module
 * load by {@link installOutboundScreenGate}.
 *
 * A seam hold REFUSES that one message (`held-for-review`) — the sender's own
 * failure handling reports it, the way it reports a suppression — and files
 * one row per site and signal set. Once staff release it, the site's next
 * message carrying those signals sends; reject it, and none does.
 */
export async function screenSeamMessage(
  request: OutboundScreenGateRequest,
): Promise<OutboundScreenGateVerdict> {
  const { workspace } = request
  if (
    request.releasedReviewId &&
    (await isReleaseForHost(request.releasedReviewId, workspace.hostId))
  ) {
    return { outcome: 'send' }
  }
  const reviewId = seamReviewId(workspace.hostId, request.signals)
  const reference = heldOutboundReference(reviewId)
  const memo = seamMemo.get(reviewId)
  if (memo && Date.now() - memo.atMs < SEAM_MEMO_TTL_MS) {
    return memo.state === 'released'
      ? { outcome: 'send' }
      : { outcome: memo.state === 'rejected' ? 'rejected' : 'held', reference }
  }
  const nowMs = Date.now()
  const subject = String(request.subject ?? '').slice(0, 300)
  const context = request.context ? String(request.context).slice(0, 80) : null
  const flagged = flaggedHostOf(request.signals)
  const state = await fileOutboundHold({
    reviewId,
    heldSend: {
      kind: 'message',
      path: `hosts/${workspace.hostId}`,
      hostId: workspace.hostId,
      orgId: workspace.orgId,
      contentHash: outboundContentHash([request.signals]),
      subject,
      fromName: request.fromName ? String(request.fromName).slice(0, 120) : null,
      signals: request.signals,
      state: 'held',
      heldAtMs: nowMs,
      ageDays: workspace.ageDays,
    },
    extra: { heldContext: context },
    item: heldSendItem({ kind: 'message', path: `hosts/${workspace.hostId}`, hostId: workspace.hostId, subject, context }),
    headline:
      `Held ${context ? `"${context}" ` : ''}email "${subject}" from a workspace ` +
      `${workspace.ageDays ?? '?'} day(s) old. Every later message from this site ` +
      'carrying the same signals waits on this decision.',
    alertTitle: 'Outbound email held for review — possible phishing',
    alertBody: `An email from a site was held: "${subject.slice(0, 120)}".`,
    url: flagged ? `https://${flagged}/` : null,
    reportedHostname: flagged,
  })
  seamMemo.set(reviewId, { state, atMs: Date.now() })
  return state === 'released'
    ? { outcome: 'send' }
    : { outcome: state === 'rejected' ? 'rejected' : 'held', reference }
}

/**
 * Puts the review store on `sendEmail`'s phishing screen.
 *
 * **Called at module load**, from the bottom of this file, for the reason
 * `installEmailSendGovernor` is — and this module is also imported by
 * `sending-domains.ts`, so any sender that resolved its identity through
 * `hostSendingIdentity` (the only thing that stamps a workspace on it, and
 * so the only thing the seam screens) has installed it.
 */
export function installOutboundScreenGate(): void {
  if (typeof setOutboundScreenGate !== 'function') return
  setOutboundScreenGate((request) => screenSeamMessage(request))
}

/**
 * Apply a staff decision to a held send (the admin abuse route, in the same
 * act as the row's status change).
 *
 * The row's `heldSend.state` is written first: it is what the screen reads,
 * so an automation step released here sends on its next run whatever
 * happens to the rest. A CAMPAIGN is also put back on the clock (released)
 * or canceled (rejected) — but only while it is still the parked send this
 * row held: a send that has since been edited, sent or canceled by the
 * merchant is left alone, and the answer says so.
 */
export async function decideHeldOutboundSend(input: {
  reviewId: string
  decision: 'release' | 'reject'
  actorUid: string
  actorEmail: string | null
  nowMs?: number
  firestore?: FirebaseFirestore.Firestore
}): Promise<'released' | 'rejected' | 'not-held' | 'campaign-moved'> {
  const nowMs = input.nowMs ?? Date.now()
  const firestore = input.firestore ?? firebaseAdmin.app().firestore()
  const ref = firestore.collection(ABUSE_REPORT_COLLECTION).doc(input.reviewId)
  const snapshot = await ref.get()
  const heldSend = snapshot.get('heldSend') as HeldOutboundSend | undefined
  if (!heldSend?.path || !heldSend.contentHash) return 'not-held'
  const state: HeldOutboundSendState =
    input.decision === 'release' ? 'released' : 'rejected'
  const decided = {
    state,
    decidedAtMs: nowMs,
    decidedByUid: input.actorUid,
    decidedByEmail: input.actorEmail,
  }
  await ref.set(
    { heldSend: { ...heldSend, ...decided } },
    { merge: true },
  )
  if (heldSend.kind !== 'campaign') return state

  const sendRef = firestore.doc(heldSend.path)
  const moved = await firestore.runTransaction(async (transaction) => {
    const send = await transaction.get(sendRef)
    const review = send.get('staffReview') as
      | { reviewId?: string; state?: string }
      | undefined
    const status = String(send.get('status') ?? '')
    if (
      !send.exists ||
      review?.reviewId !== input.reviewId ||
      (status !== 'scheduled' && status !== 'draft')
    ) {
      return true
    }
    transaction.set(
      sendRef,
      input.decision === 'release'
        ? {
            status: 'scheduled',
            // Due now: the next processor run sends it, and the screen
            // finds this row released for exactly this content.
            sendAtMs: nowMs,
            staffReview: { ...review, ...decided },
          }
        : {
            status: 'canceled',
            sendAtMs: FieldValue.delete(),
            staffReview: { ...review, ...decided },
          },
      { merge: true },
    )
    return false
  })
  return moved ? 'campaign-moved' : state
}

installOutboundScreenGate()
