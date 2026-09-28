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
 * whether a message carries a strong phishing signal. This module is what
 * happens next, for the two senders that screen — the campaign core and the
 * automation `sendEmail` step — so neither restates it:
 *
 * - WHO IS SCREENED. A workspace younger than
 *   {@link OUTBOUND_REVIEW_YOUNG_DAYS}. The incident's workspace was days
 *   old; an established customer's campaign never waits on this. An org
 *   whose creation date cannot be read is an existing customer (the same
 *   reading `orgAgeDays` gives the sending ramp) and is not screened.
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
  type PhishingScreenInput,
  type PhishingScreenSignal,
  screenOutboundEmail,
} from '@aglyn/shared-util-email/outbound-phishing-screen'
import { FieldValue } from 'firebase-admin/firestore'
import { orgAgeDays } from './org-age'
import firebaseAdmin from './firebase-admin'
import { notifyStaff } from './notifications'

/** A workspace younger than this many days has its outbound mail screened. */
export const OUTBOUND_REVIEW_YOUNG_DAYS = 14

/**
 * Where a held campaign is parked: a send time no processor run reaches.
 * A release replaces it with "now"; nothing else ever does, so a hold that
 * nobody decides stays a hold rather than lapsing into a send.
 */
export const HELD_SEND_AT_MS = 253402300799000

/** Which sender held the message. */
export type HeldOutboundSendKind = 'campaign' | 'action' | 'workflow' | 'orgAutomation'

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
  const age = orgAgeDays(org?.createdAt, nowMs)
  return age !== null && age < OUTBOUND_REVIEW_YOUNG_DAYS
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
  replyTo?: string | readonly string[] | null
  preheader?: string | null
  bodies: readonly (string | null | undefined)[]
  nowMs?: number
}

/**
 * The screen's answer for one message, and what to do with it.
 *
 * - `send` — not screened (an established workspace), clean, or held
 *   earlier and RELEASED by staff for exactly this content.
 * - `held` — hold it. The review row is written (or its count bumped) and
 *   staff are told the first time.
 * - `rejected` — staff rejected exactly this content. Never sent.
 *
 * Fails OPEN on a store error, the posture of every other control on the
 * send path: an outage on the review queue must not become an outage on
 * every young workspace's mail. The screen itself cannot fail.
 */
export async function screenOutboundSend(
  request: OutboundScreenRequest,
): Promise<
  | { outcome: 'send' }
  | { outcome: 'held' | 'rejected'; reviewId: string; reference: string; contentHash: string }
> {
  const nowMs = request.nowMs ?? Date.now()
  if (!isYoungWorkspace(request.org as { createdAt?: unknown }, nowMs)) {
    return { outcome: 'send' }
  }
  const verdict = screenOutboundEmail({
    subject: request.subject,
    fromName: request.fromName ?? null,
    replyTo: request.replyTo ?? null,
    preheader: request.preheader ?? null,
    bodies: request.bodies,
    ...workspaceScreenIdentity({ org: request.org, host: request.host }),
  })
  if (!verdict.hold) return { outcome: 'send' }

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
    const firestore = firebaseAdmin.app().firestore()
    const ref = firestore.collection(ABUSE_REPORT_COLLECTION).doc(reviewId)
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
      const ageDays = orgAgeDays(
        (request.org as { createdAt?: unknown } | null)?.createdAt,
        nowMs,
      )
      const flagged = verdict.signals.find(
        (signal): signal is Extract<PhishingScreenSignal, { host: string }> =>
          'host' in signal,
      )
      const heldSend: HeldOutboundSend = {
        kind: request.kind,
        path: request.path,
        hostId: request.hostId,
        orgId: request.orgId,
        contentHash,
        subject: request.subject.slice(0, 300),
        fromName: request.fromName ? String(request.fromName).slice(0, 120) : null,
        signals: verdict.signals,
        state: 'held',
        heldAtMs: nowMs,
        ageDays,
      }
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
          // as a link, and this one is a phishing kit's.
          url: flagged ? `https://${flagged.host}/` : null,
          reportedHostname: flagged?.host ?? null,
          hostId: request.hostId,
          orgId: request.orgId,
          details: [
            `Held ${request.kind === 'campaign' ? 'campaign' : `${request.kind} email step`} ` +
              `"${heldSend.subject}" from a workspace ${ageDays ?? '?'} day(s) old.`,
            ...describePhishingScreenSignals(verdict.signals),
            'Dismiss to release this send; mark it actioned to reject it.',
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
            ? heldSend
            : { ...heldSend, heldAtMs: stored?.heldAtMs ?? nowMs },
          updatedAt: FieldValue.serverTimestamp(),
          ...(first
            ? { status: 'open', createdAt: FieldValue.serverTimestamp() }
            : {}),
        },
        { merge: true },
      )
    })
    if (state === 'released') return { outcome: 'send' }
    if (first) {
      await notifyStaff({
        type: 'system.abuseReportUrgent',
        title: 'Outbound email held for review — possible phishing',
        body:
          `A ${request.kind === 'campaign' ? 'campaign' : 'automated email'} ` +
          `from a new workspace was held: "${request.subject.slice(0, 120)}". ` +
          `Reference ${reference}.`,
        link: '/admin/abuse-reports',
      })
    }
    return { outcome: state === 'rejected' ? 'rejected' : 'held', reviewId, reference, contentHash }
  } catch (error) {
    console.error('[outbound-review] hold could not be recorded — allowing', error)
    return { outcome: 'send' }
  }
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
