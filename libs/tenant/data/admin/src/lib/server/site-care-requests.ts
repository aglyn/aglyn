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
  historyRow,
  requireHistoryReason,
  type AppendOnlyHistoryRow,
  type HistoryStripeRef,
} from '@aglyn/aglyn/app-utils/append-only-history'
import { createResourceUid } from '@aglyn/aglyn/app-utils/create-resource-uid'
import {
  describeHours,
  ownerApprovalSentence,
  readOwnerApprovalInput,
  readOwnerApprovalRecord,
  type OwnerApprovalRecord,
} from '@aglyn/aglyn/app-utils/owner-approval-record'
import {
  hasSiteCare,
  resolveEffectivePlan,
  SITE_CARE_EXTRA_HOUR_USD,
} from '@aglyn/aglyn/app-utils/plan-entitlements'
import {
  allocateSiteCareMinutes,
  closeMinutesFromTimer,
  formatSiteCareDate,
  formatSiteCareMinutes,
  formatSiteCareUsd,
  isSiteCareMonthKey,
  isSiteCarePublishAction,
  otherSiteCareCandidates,
  readSiteCareCandidates,
  readSiteCareMinutes,
  SITE_CARE_BODY_MAX,
  SITE_CARE_LIVE_CHARGE_STATUSES,
  SITE_CARE_RESPONSE_BUSINESS_DAYS,
  SITE_CARE_STAFF_COLLECTION,
  SITE_CARE_SUBJECT_MAX,
  SITE_CARE_TICKET_KIND,
  siteCareCandidatesSentence,
  siteCareChargeWords,
  siteCareCloseVerdict,
  siteCareExtraTimeCents,
  siteCareExtraTimeDescription,
  siteCareIncludedPool,
  siteCareMonthKey,
  siteCareMonthSentence,
  siteCareMonthStatement,
  siteCareMoveBlockedReason,
  siteCareOrgMonth,
  siteCarePublishSentence,
  siteCareStatementRequest,
  type SiteCareCharge,
  type SiteCareCloseVerdict,
  type SiteCareMonthStatement,
  type SiteCarePublishLink,
  type SiteCareRequest,
  type SiteCareSource,
  type SiteCareWorkspaceCandidate,
} from '@aglyn/aglyn/app-utils/site-care'
import { addBusinessDays } from '@aglyn/aglyn/app-utils/support-tiers'
import {
  SITE_CARE_APPROVAL_EMAIL_KEY,
  SITE_CARE_CHARGE_REVERSED_EMAIL_KEY,
  SITE_CARE_QUOTE_EMAIL_KEY,
  SITE_CARE_REQUEST_CORRECTED_EMAIL_KEY,
  SITE_CARE_REQUEST_DONE_EMAIL_KEY,
  SITE_CARE_REQUEST_RECEIVED_EMAIL_KEY,
  SITE_CARE_STATEMENT_EMAIL_KEY,
} from '@aglyn/shared-util-email'
import { createHash } from 'node:crypto'
import { FieldValue, Timestamp } from 'firebase-admin/firestore'
import {
  appendHistoryRow,
  commitHistoryRow,
  readHistoryRows,
  type HistoryAudit,
} from './append-only-history-write'
import { notifyStaff } from './notifications'
import { readOrgBilling } from './org-billing'
import { sendSiteCareEmail, type SiteCareEmailResult } from './site-care-emails'
import {
  createExtraTimeItem,
  creditExtraTimeItem,
  deleteExtraTimeItem,
  extraTimeItemIsEditable,
  readExtraTimeItem,
  siteCareExtraTimeProduct,
  siteCareSubscriptionId,
  subscriptionInvoiceFinalizedSince,
  updateExtraTimeItem,
  type SiteCareStripeOptions,
} from './site-care-stripe'

/**
 * SITE CARE REQUESTS, WITH FIRESTORE AND STRIPE (AGL-3959).
 *
 * A request is a support ticket (`supportTickets/{id}`, `kind: 'siteCare'`)
 * with a `siteCare` map holding everything about the work: the timer, the
 * one number staff close it with, how its minutes counted against the
 * included hour, the owner's recorded approval, the extra-time charge and
 * the publish that shipped it. Beside it, an append-only history
 * (`supportTickets/{id}/siteCareHistory`), and per workspace and month a
 * document for goodwill minutes with its own history
 * (`orgs/{orgId}/siteCareMonths/{YYYY-MM}`). An emailed request from a
 * sender in several Site Care workspaces also keeps every one of them, for
 * staff only, at `supportTickets/{id}/siteCareStaff/intake` (AGL-4031): the
 * ticket itself is returned to the workspace's members, and which other
 * workspaces the sender belongs to is not theirs to read. None of it is in the Firestore
 * rules: every read and write passes the console's routes, as the rest of
 * the support system does.
 *
 * Every change writes its history row in the same batch or transaction as
 * the change, and a staff member's change writes its `adminAudit` row there
 * too. Money moves in two steps around the Stripe call: a `charge.requested`
 * row and a `creating` charge commit first, then the call, then the result
 * and its row commit together. A Stripe success with no row behind it is a
 * `creating` charge with no item — which the reconciliation reports, and
 * which `retrySiteCareCharge` settles under the same idempotency key.
 *
 * The arithmetic is `@aglyn/aglyn/app-utils/site-care`, the approval record
 * `owner-approval-record`, the row `append-only-history`.
 */

const TICKETS = 'supportTickets'
export const SITE_CARE_HISTORY_COLLECTION = 'siteCareHistory'
export const SITE_CARE_MONTHS_COLLECTION = 'siteCareMonths'
const SITE_CARE_INTAKE_DOC = 'intake'

/** Who did something. `uid` null is the platform itself. */
export interface SiteCareActor {
  uid: string | null
  email: string | null
}

/** A refusal the caller turns into a response. */
export class SiteCareError extends Error {
  readonly status: number
  readonly detail: Record<string, unknown> | null
  constructor(message: string, status = 400, detail: Record<string, unknown> | null = null) {
    super(message)
    this.name = 'SiteCareError'
    this.status = status
    this.detail = detail
  }
}

/** The seams a spec replaces. */
export interface SiteCareDeps {
  now?: () => number
  stripe?: SiteCareStripeOptions
  email?: typeof sendSiteCareEmail
}

const nowOf = (deps: SiteCareDeps) => (deps.now ?? Date.now)()
const emailOf = (deps: SiteCareDeps) => deps.email ?? sendSiteCareEmail

function ticketRef(firestore: FirebaseFirestore.Firestore, ticketId: string) {
  return firestore.collection(TICKETS).doc(ticketId)
}

function ticketHistory(firestore: FirebaseFirestore.Firestore, ticketId: string) {
  return ticketRef(firestore, ticketId).collection(SITE_CARE_HISTORY_COLLECTION)
}

function intakeRef(firestore: FirebaseFirestore.Firestore, ticketId: string) {
  return ticketRef(firestore, ticketId).collection(SITE_CARE_STAFF_COLLECTION).doc(SITE_CARE_INTAKE_DOC)
}

function monthRef(firestore: FirebaseFirestore.Firestore, orgId: string, month: string) {
  return firestore.collection('orgs').doc(orgId).collection(SITE_CARE_MONTHS_COLLECTION).doc(month)
}

function monthHistory(firestore: FirebaseFirestore.Firestore, orgId: string, month: string) {
  return monthRef(firestore, orgId, month).collection(SITE_CARE_HISTORY_COLLECTION)
}

function requestAudit(orgId: string, ticketId: string, action: string): HistoryAudit {
  return { action: `siteCare.${action}`, scope: 'siteCare', target: `orgs/${orgId}/siteCare/${ticketId}` }
}

function monthAudit(orgId: string, month: string, action: string): HistoryAudit {
  return { action: `siteCare.${action}`, scope: 'siteCare', target: `orgs/${orgId}/siteCareMonths/${month}` }
}

/** A fresh request's map. */
export function newSiteCareRequest(input: {
  source: SiteCareSource
  hostId: string | null
  requesterEmail: string | null
  month: string
}): SiteCareRequest {
  return {
    source: input.source,
    hostId: input.hostId,
    requesterEmail: input.requesterEmail,
    state: 'open',
    month: input.month,
    timerStartedAtMs: null,
    timerStartedByUid: null,
    closedAtMs: null,
    minutesLogged: null,
    timerMinutes: null,
    countedMinutes: 0,
    includedMinutesUsed: 0,
    overMinutes: 0,
    billedHours: 0,
    absorbed: false,
    approval: null,
    charge: null,
    chargeSeq: 0,
    publish: null,
  }
}

/** A stored map read back with every field present. */
export function readSiteCareRequest(value: unknown): SiteCareRequest | null {
  if (!value || typeof value !== 'object') return null
  const stored = value as Partial<SiteCareRequest>
  const base = newSiteCareRequest({
    source: stored.source === 'email' ? 'email' : 'console',
    hostId: stored.hostId ?? null,
    requesterEmail: stored.requesterEmail ?? null,
    month: isSiteCareMonthKey(stored.month) ? stored.month : siteCareMonthKey(Date.now()),
  })
  return {
    ...base,
    ...stored,
    approval: readOwnerApprovalRecord(stored.approval),
    charge: stored.charge ?? null,
    chargeSeq: Number(stored.chargeSeq) || 0,
    publish: stored.publish ?? null,
  } as SiteCareRequest
}

interface LoadedTicket {
  ref: FirebaseFirestore.DocumentReference
  orgId: string
  subject: string
  request: SiteCareRequest
  data: Record<string, unknown>
}

function loadedTicket(snapshot: FirebaseFirestore.DocumentSnapshot): LoadedTicket {
  const data = (snapshot.data() ?? null) as Record<string, unknown> | null
  if (!data) throw new SiteCareError('Unknown request', 404)
  if (data['kind'] !== SITE_CARE_TICKET_KIND) throw new SiteCareError('That ticket is not a Site Care request', 400)
  const request = readSiteCareRequest(data['siteCare'])
  if (!request) throw new SiteCareError('That ticket has no Site Care record', 409)
  return {
    ref: snapshot.ref,
    orgId: String(data['orgId'] ?? ''),
    subject: String(data['subject'] ?? ''),
    request,
    data,
  }
}

/** The org document joined with its billing keys, as `hasSiteCare` reads it. */
export async function readSiteCareOrg(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
): Promise<Record<string, unknown> | null> {
  const snapshot = await firestore.collection('orgs').doc(orgId).get()
  if (!snapshot.exists) return null
  const billing = await readOrgBilling(orgId)
  return { $id: orgId, ...(snapshot.data() ?? {}), ...(billing ?? {}) }
}

/** Whether a workspace has Site Care in force. */
export function orgHasSiteCare(org: Record<string, unknown> | null): boolean {
  return Boolean(org) && hasSiteCare(org as never)
}

/** The owner's address, from the owner's member row. */
export async function siteCareOwnerEmail(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  org: Record<string, unknown> | null,
): Promise<string | null> {
  const ownerUid = typeof org?.['ownerUid'] === 'string' ? (org['ownerUid'] as string) : ''
  if (!ownerUid) return null
  const member = await firestore.collection('orgs').doc(orgId).collection('members').doc(ownerUid).get()
  const email = member.get('email')
  return typeof email === 'string' && email ? email : null
}

/** Records an email as the request's (or the month's) history row. */
async function recordEmail(
  firestore: FirebaseFirestore.Firestore,
  history: FirebaseFirestore.CollectionReference,
  result: SiteCareEmailResult,
  what: string,
  atMs: number,
  subjectId: string | null,
): Promise<void> {
  await commitHistoryRow(
    firestore,
    history,
    historyRow({
      atMs,
      by: { uid: null, email: null },
      kind: result.sent ? 'email.sent' : 'email.notSent',
      summary: result.sent
        ? `Emailed ${what} to ${result.to}.`
        : `The ${what} email was not sent${result.to ? ` to ${result.to}` : ''} (${result.reason ?? 'unknown'}).`,
      after: { subject: result.subject, to: result.to, sent: result.sent },
      subjectId,
    }),
  ).catch((error) => console.error('[site-care] email history row failed', error))
}

// ── Intake ──────────────────────────────────────────────────────────────────

export interface OpenSiteCareRequestInput {
  orgId: string
  org: Record<string, unknown>
  hostId: string | null
  subject: string
  body: string
  requester: SiteCareActor
  source: SiteCareSource
  /**
   * A received message's id, when the request came by email: the ticket is
   * keyed by it, so a provider redelivering the same message opens nothing
   * twice.
   */
  dedupeKey?: string | null
  /**
   * Every Site Care workspace an emailed request's sender belongs to, the
   * one it is filed on included (AGL-4031). Kept, for staff only, when there
   * is more than one, so staff can move the request to the right one.
   */
  candidates?: readonly SiteCareWorkspaceCandidate[]
}

/** A document id derived from a received message, alphanumeric so it fits a reply address. */
export function siteCareMessageDocId(prefix: string, key: string): string {
  return `${prefix}${createHash('sha256').update(key).digest('hex').slice(0, 24)}`
}

/**
 * Opens a request: the tagged ticket, its first message, the opening history
 * row, the staff notice and the "we have your request" email. Shared by the
 * console's "Request a change" and the inbound address.
 */
export async function openSiteCareRequest(
  firestore: FirebaseFirestore.Firestore,
  input: OpenSiteCareRequestInput,
  deps: SiteCareDeps = {},
): Promise<{ ticketId: string; dueAtMs: number; duplicate?: boolean }> {
  const subject = String(input.subject ?? '').trim().slice(0, SITE_CARE_SUBJECT_MAX)
  const body = String(input.body ?? '').trim().slice(0, SITE_CARE_BODY_MAX)
  if (!subject) throw new SiteCareError('Say what you would like changed.', 400)
  if (!body) throw new SiteCareError('Describe the change.', 400)
  if (!orgHasSiteCare(input.org)) {
    throw new SiteCareError('Site Care is not on this workspace. Add it on Billing.', 403)
  }
  const nowMs = nowOf(deps)
  const month = siteCareMonthKey(nowMs)
  const dueAtMs = addBusinessDays(nowMs, SITE_CARE_RESPONSE_BUSINESS_DAYS)
  const ref = input.dedupeKey
    ? firestore.collection(TICKETS).doc(siteCareMessageDocId('care', input.dedupeKey))
    : firestore.collection(TICKETS).doc(createResourceUid())
  if (input.dedupeKey && (await ref.get()).exists) return { ticketId: ref.id, dueAtMs, duplicate: true }
  const candidates = readSiteCareCandidates(input.candidates)
  const others = candidates.length > 1 ? otherSiteCareCandidates(candidates, input.orgId) : []
  const now = FieldValue.serverTimestamp()
  const batch = firestore.batch()
  batch.create(ref, {
    orgId: input.orgId,
    subject,
    status: 'open',
    kind: SITE_CARE_TICKET_KIND,
    plan: resolveEffectivePlan(input.org as never),
    supportTier: 'siteCare',
    supportTierRank: 0,
    // Site Care's promise is DONE within two business days, so the clock
    // runs until the request closes, not until the first staff reply.
    responseDueAt: Timestamp.fromMillis(dueAtMs),
    firstRespondedAt: null,
    siteCare: newSiteCareRequest({
      source: input.source,
      hostId: input.hostId,
      requesterEmail: input.requester.email,
      month,
    }),
    siteCareMonth: month,
    siteCareOrgMonth: siteCareOrgMonth(input.orgId, month),
    createdAt: now,
    updatedAt: now,
  })
  batch.create(ref.collection('messages').doc(createResourceUid()), {
    authorId: input.requester.uid,
    authorEmail: input.requester.email,
    staff: false,
    body,
    source: input.source,
    createdAt: now,
  })
  if (others.length) {
    batch.create(ref.collection(SITE_CARE_STAFF_COLLECTION).doc(SITE_CARE_INTAKE_DOC), {
      candidates,
      filedOnOrgId: input.orgId,
      createdAt: now,
    })
  }
  appendHistoryRow(
    batch,
    firestore,
    ref.collection(SITE_CARE_HISTORY_COLLECTION),
    historyRow({
      atMs: nowMs,
      by: input.requester,
      kind: 'request.opened',
      summary: `${input.requester.email ?? 'The owner'} asked ${
        input.source === 'email' ? 'by email' : 'from the console'
      }: “${subject}”.`,
      after: { subject, source: input.source, dueAtMs },
      subjectId: ref.id,
    }),
  )
  await batch.commit()

  await notifyStaff({
    type: 'support.ticketOpened',
    title: `New Site Care request: ${subject}`,
    body:
      `${input.requester.email ?? 'An owner'} asked ${input.source === 'email' ? 'by email' : 'from the console'} ` +
      `for workspace ${String(input.org['name'] ?? input.orgId)} (${input.orgId}). ` +
      `It is due done by ${formatSiteCareDate(dueAtMs)}.` +
      (others.length
        ? ` The sender is in more than one Site Care workspace. ${siteCareCandidatesSentence(
            others.map((other) => ({ ...other, name: `${other.name} (${other.orgId})` })),
          )}. If it belongs to one of those, move it from the Site Care card on the request.`
        : ''),
    link: `/admin/support?ticketId=${ref.id}`,
    orgId: input.orgId,
  })

  const due = new Date(dueAtMs).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'America/Chicago',
  })
  const result = await emailOf(deps)({
    key: SITE_CARE_REQUEST_RECEIVED_EMAIL_KEY,
    to: input.requester.email,
    org: input.org,
    requestId: ref.id,
    merge: { 'request.title': subject, 'request.message': body, 'request.due': due },
    fallback: {
      subject: `We have your request: ${subject}`,
      text: `We received “${subject}” and will have it done by ${due}.\n\n${body}`,
    },
  })
  await recordEmail(firestore, ref.collection(SITE_CARE_HISTORY_COLLECTION), result, 'the request receipt', nowOf(deps), ref.id)
  return { ticketId: ref.id, dueAtMs }
}

/**
 * Adds a reply that arrived by email to its request's thread. The sender
 * must be a member of the request's workspace.
 */
export async function appendSiteCareReply(
  firestore: FirebaseFirestore.Firestore,
  input: { ticketId: string; from: SiteCareActor; body: string; dedupeKey?: string | null },
  deps: SiteCareDeps = {},
): Promise<{ appended: boolean }> {
  const snapshot = await ticketRef(firestore, input.ticketId).get()
  if (!snapshot.exists) return { appended: false }
  const ticket = loadedTicket(snapshot)
  const body = String(input.body ?? '').trim().slice(0, SITE_CARE_BODY_MAX)
  if (!body) return { appended: false }
  const nowMs = nowOf(deps)
  const now = FieldValue.serverTimestamp()
  const messageRef = input.dedupeKey
    ? ticket.ref.collection('messages').doc(siteCareMessageDocId('mail', input.dedupeKey))
    : ticket.ref.collection('messages').doc(createResourceUid())
  if (input.dedupeKey && (await messageRef.get()).exists) return { appended: false }
  const batch = firestore.batch()
  batch.create(messageRef, {
    authorId: input.from.uid,
    authorEmail: input.from.email,
    staff: false,
    body,
    source: 'email',
    createdAt: now,
  })
  batch.update(ticket.ref, { status: 'open', updatedAt: now })
  appendHistoryRow(
    batch,
    firestore,
    ticketHistory(firestore, input.ticketId),
    historyRow({
      atMs: nowMs,
      by: input.from,
      kind: 'request.replied',
      summary: `${input.from.email ?? 'The owner'} replied by email.`,
      subjectId: input.ticketId,
    }),
  )
  await batch.commit()
  await notifyStaff({
    type: 'support.ticketReply',
    title: `Site Care reply: ${ticket.subject}`,
    body: `${input.from.email ?? 'The owner'} replied by email on “${ticket.subject.slice(0, 120)}” for workspace ${ticket.orgId}.`,
    link: `/admin/support?ticketId=${input.ticketId}`,
    orgId: ticket.orgId,
  })
  return { appended: true }
}

// ── Timer ───────────────────────────────────────────────────────────────────

/**
 * Starts the request's timer the first time staff open it. A second open,
 * a reload or another staff member opening it changes nothing.
 */
export async function startSiteCareTimer(
  firestore: FirebaseFirestore.Firestore,
  input: { ticketId: string; actor: SiteCareActor },
  deps: SiteCareDeps = {},
): Promise<SiteCareRequest> {
  return firestore.runTransaction(async (tx) => {
    const ticket = loadedTicket(await tx.get(ticketRef(firestore, input.ticketId)))
    if (ticket.request.state !== 'open' || ticket.request.timerStartedAtMs) return ticket.request
    const nowMs = nowOf(deps)
    const request: SiteCareRequest = {
      ...ticket.request,
      timerStartedAtMs: nowMs,
      timerStartedByUid: input.actor.uid,
    }
    tx.update(ticket.ref, { siteCare: request, updatedAt: FieldValue.serverTimestamp() })
    appendHistoryRow(
      tx,
      firestore,
      ticketHistory(firestore, input.ticketId),
      historyRow({
        atMs: nowMs,
        by: input.actor,
        kind: 'timer.started',
        summary: 'Started work.',
        after: { timerStartedAtMs: nowMs },
        subjectId: input.ticketId,
      }),
      requestAudit(ticket.orgId, input.ticketId, 'timer.started'),
    )
    return request
  })
}

// ── Moving to another workspace ─────────────────────────────────────────────

/** The candidates recorded for a request, or none. */
export async function readSiteCareCandidatesFor(
  firestore: FirebaseFirestore.Firestore,
  ticketId: string,
): Promise<SiteCareWorkspaceCandidate[]> {
  const snapshot = await intakeRef(firestore, ticketId).get()
  return readSiteCareCandidates(snapshot.get('candidates'))
}

export interface MoveSiteCareResult {
  request: SiteCareRequest
  fromOrgId: string
  orgId: string
}

/**
 * Moves an open request to another Site Care workspace its sender belongs
 * to (AGL-4031): an emailed request from a sender in several is filed on a
 * default one, and staff move it when it belongs to another.
 *
 * Refused for a closed request, one with a charge or an owner's approval on
 * it ({@link siteCareMoveBlockedReason}), and for any workspace that is not
 * one of the candidates recorded at intake, no longer has Site Care, or no
 * longer has the sender as a member.
 *
 * What moves is everything the request holds against a workspace: the
 * ticket's `orgId` and plan, and its month key (`siteCareOrgMonth`), which
 * is what puts a request in a workspace's month. A month's totals are not
 * stored: they are read from the requests that carry its key, and an open
 * request has logged no minutes yet (they are logged at close), so changing
 * the key in this one write takes it out of the old workspace's month and
 * into the new one's at once. A site it named is cleared, since that site
 * is the old workspace's. The `request.moved` row and the staff audit row
 * commit in the same transaction; nothing earlier is rewritten.
 */
export async function moveSiteCareRequest(
  firestore: FirebaseFirestore.Firestore,
  input: { ticketId: string; actor: SiteCareActor; orgId: unknown },
  deps: SiteCareDeps = {},
): Promise<MoveSiteCareResult> {
  const targetOrgId = typeof input.orgId === 'string' ? input.orgId.trim() : ''
  if (!targetOrgId) throw new SiteCareError('Choose the workspace to move it to.', 400)
  const target = await readSiteCareOrg(firestore, targetOrgId)
  if (!orgHasSiteCare(target)) {
    throw new SiteCareError('That workspace does not have Site Care, so the request cannot move there.', 409)
  }
  const nowMs = nowOf(deps)
  return firestore.runTransaction(async (tx) => {
    const [ticketSnap, intakeSnap] = await Promise.all([
      tx.get(ticketRef(firestore, input.ticketId)),
      tx.get(intakeRef(firestore, input.ticketId)),
    ])
    const ticket = loadedTicket(ticketSnap)
    const candidates = readSiteCareCandidates(intakeSnap.get('candidates'))
    const others = otherSiteCareCandidates(candidates, ticket.orgId)
    const blocked = siteCareMoveBlockedReason(ticket.request, others)
    if (blocked) throw new SiteCareError(blocked, 409)
    const candidate = others.find((other) => other.orgId === targetOrgId)
    if (!candidate) {
      throw new SiteCareError(
        targetOrgId === ticket.orgId
          ? 'The request is already on that workspace.'
          : 'The sender is not recorded as a member of that workspace, so the request cannot move there.',
        409,
      )
    }
    const member = await tx.get(firestore.collection('orgs').doc(targetOrgId).collection('members').doc(candidate.uid))
    if (!member.exists) {
      throw new SiteCareError('The sender is no longer a member of that workspace, so the request cannot move there.', 409)
    }
    const fromOrgId = ticket.orgId
    const toName = String(target?.['name'] ?? '') || candidate.name
    const request: SiteCareRequest = { ...ticket.request, hostId: null }
    tx.update(ticket.ref, {
      orgId: targetOrgId,
      plan: resolveEffectivePlan(target as never),
      siteCare: request,
      siteCareOrgMonth: siteCareOrgMonth(targetOrgId, request.month),
      updatedAt: FieldValue.serverTimestamp(),
    })
    appendHistoryRow(
      tx,
      firestore,
      ticketHistory(firestore, input.ticketId),
      historyRow({
        atMs: nowMs,
        by: input.actor,
        kind: 'request.moved',
        // The new workspace's statement and export read this row, so it
        // names only that workspace; the one it left is an id in `before`.
        summary: `Moved to ${toName}, the workspace it belongs to.`,
        before: { orgId: fromOrgId, hostId: ticket.request.hostId },
        after: { orgId: targetOrgId, hostId: null, month: request.month },
        subjectId: input.ticketId,
      }),
      requestAudit(targetOrgId, input.ticketId, 'request.moved'),
    )
    return { request, fromOrgId, orgId: targetOrgId }
  })
}

// ── Allocation against the month ────────────────────────────────────────────

interface MonthContext {
  goodwillMinutes: number
  /** Included minutes the month's OTHER closed requests used. */
  otherIncludedUsed: number
  /** The month's requests as the statement reads them, this one excluded. */
  others: ReturnType<typeof siteCareStatementRequest>[]
}

async function readMonthContext(
  reader: Pick<FirebaseFirestore.Transaction, 'get'> | null,
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  month: string,
  excludeTicketId: string,
): Promise<MonthContext> {
  const query = firestore.collection(TICKETS).where('siteCareOrgMonth', '==', siteCareOrgMonth(orgId, month))
  const [monthSnap, requests] = reader
    ? await Promise.all([reader.get(monthRef(firestore, orgId, month)), reader.get(query)])
    : await Promise.all([monthRef(firestore, orgId, month).get(), query.get()])
  const others = requests.docs
    .filter((doc) => doc.id !== excludeTicketId)
    .map((doc) =>
      siteCareStatementRequest(doc.id, String(doc.get('subject') ?? ''), readSiteCareRequest(doc.get('siteCare'))),
    )
  return {
    goodwillMinutes: Number(monthSnap.get('goodwillMinutes') ?? 0) || 0,
    otherIncludedUsed: others
      .filter((r) => r.state === 'closed')
      .reduce((sum, r) => sum + r.includedMinutesUsed, 0),
    others,
  }
}

function statementWith(
  month: string,
  context: MonthContext,
  ticketId: string,
  subject: string,
  request: SiteCareRequest,
): SiteCareMonthStatement {
  return siteCareMonthStatement({
    month,
    goodwillMinutes: context.goodwillMinutes,
    requests: [...context.others, siteCareStatementRequest(ticketId, subject, request)],
  })
}

/** Why a close or a correction is blocked, as the staff panel says it. */
export function siteCareBlockedMessage(verdict: Extract<SiteCareCloseVerdict, { ok: false }>): string {
  return verdict.reason === 'no-approval'
    ? `This takes the month past the included hour by ${describeHours(verdict.requiredHours)}, and no approval is on file. Ask the owner first, or absorb it.`
    : `This needs ${describeHours(verdict.requiredHours)} of extra time and the owner approved ${describeHours(
        verdict.approvedHours ?? 0,
      )}. Ask the owner first, or absorb it.`
}

// ── Publish link ────────────────────────────────────────────────────────────

/**
 * The newest publish on any of the workspace's sites since `sinceMs`, from
 * each site's activity log — the change the request shipped.
 */
export async function findSiteCarePublish(
  firestore: FirebaseFirestore.Firestore,
  orgId: string,
  sinceMs: number,
): Promise<SiteCarePublishLink | null> {
  const hosts = await firestore.collection('hosts').where('orgId', '==', orgId).limit(10).get()
  let best: SiteCarePublishLink | null = null
  for (const host of hosts.docs) {
    const rows = await host.ref
      .collection('activity')
      .where('createdAt', '>=', Timestamp.fromMillis(sinceMs))
      .orderBy('createdAt', 'desc')
      .limit(50)
      .get()
    for (const row of rows.docs) {
      const action = row.get('action')
      if (!isSiteCarePublishAction(action)) continue
      const atMs = (row.get('createdAt') as Timestamp | undefined)?.toMillis?.() ?? 0
      if (!best || atMs > best.atMs) {
        best = {
          hostId: host.id,
          activityId: row.id,
          action: String(action),
          targetName: (row.get('target.name') as string | undefined) ?? null,
          targetId: (row.get('target.id') as string | undefined) ?? null,
          atMs,
        }
      }
      break
    }
  }
  return best
}

// ── Charges ─────────────────────────────────────────────────────────────────

function chargeKey(ticketId: string, seq: number): string {
  return `site-care:${ticketId}:charge:${seq}`
}

function newCharge(input: {
  ticketId: string
  seq: number
  hours: number
  description: string
  nowMs: number
}): SiteCareCharge {
  return {
    status: 'creating',
    hours: input.hours,
    amountCents: siteCareExtraTimeCents(input.hours),
    description: input.description,
    idempotencyKey: chargeKey(input.ticketId, input.seq),
    invoiceItemId: null,
    invoiceId: null,
    creditNoteId: null,
    refundId: null,
    error: null,
    updatedAtMs: input.nowMs,
  }
}

function chargeRequestedRow(
  ticketId: string,
  charge: SiteCareCharge,
  actor: SiteCareActor,
  nowMs: number,
): AppendOnlyHistoryRow {
  return historyRow({
    atMs: nowMs,
    by: actor,
    kind: 'charge.requested',
    summary: `Adding ${describeHours(charge.hours)} of extra time (${formatSiteCareUsd(charge.amountCents)}) to the next invoice.`,
    after: { hours: charge.hours, amountCents: charge.amountCents, idempotencyKey: charge.idempotencyKey },
    subjectId: ticketId,
  })
}

/**
 * Creates the Stripe item for a `creating` (or `failed`) charge and records
 * the outcome. The key is the charge's own, so a retry after a lost
 * response returns the item the first call made rather than a second one.
 */
async function settleCharge(
  firestore: FirebaseFirestore.Firestore,
  input: { ticketId: string; actor: SiteCareActor },
  deps: SiteCareDeps,
): Promise<SiteCareCharge | null> {
  const snapshot = await ticketRef(firestore, input.ticketId).get()
  const ticket = loadedTicket(snapshot)
  const charge = ticket.request.charge
  if (!charge || (charge.status !== 'creating' && charge.status !== 'failed')) return charge
  const billing = await readOrgBilling(ticket.orgId)
  const customerId = String((billing as { stripeCustomerId?: unknown }).stripeCustomerId ?? '')
  const subscription = await siteCareSubscriptionId(customerId, deps.stripe)
  const product = subscription.ok ? await siteCareExtraTimeProduct(deps.stripe) : null
  const created =
    subscription.ok && product?.ok
      ? await createExtraTimeItem(
          {
            customerId,
            subscriptionId: subscription.subscriptionId,
            productId: product.productId,
            hours: charge.hours,
            description: charge.description,
            metadata: {
              siteCareRequestId: input.ticketId,
              orgId: ticket.orgId,
              month: ticket.request.month,
            },
            idempotencyKey: charge.idempotencyKey,
          },
          deps.stripe,
        )
      : null
  const nowMs = nowOf(deps)
  const error = subscription.ok === false
    ? subscription.error
    : product && product.ok === false
      ? product.error
      : created && created.ok === false
        ? created.error
        : null
  const next: SiteCareCharge =
    created && created.ok
      ? { ...charge, status: 'pending', invoiceItemId: created.invoiceItemId, error: null, updatedAtMs: nowMs }
      : { ...charge, status: 'failed', error: error ?? 'Unknown failure', updatedAtMs: nowMs }
  const batch = firestore.batch()
  batch.update(ticket.ref, { 'siteCare.charge': next, updatedAt: FieldValue.serverTimestamp() })
  appendHistoryRow(
    batch,
    firestore,
    ticketHistory(firestore, input.ticketId),
    historyRow({
      atMs: nowMs,
      by: input.actor,
      kind: next.status === 'pending' ? 'charge.created' : 'charge.failed',
      summary:
        next.status === 'pending'
          ? `Added ${describeHours(next.hours)} of extra time (${formatSiteCareUsd(next.amountCents)}) to the next invoice.`
          : `The extra time could not be added to the invoice: ${next.error}`,
      after: { status: next.status, invoiceItemId: next.invoiceItemId, error: next.error },
      stripe:
        next.status === 'pending' && next.invoiceItemId
          ? { object: 'invoiceitem', id: next.invoiceItemId, amountCents: next.amountCents }
          : null,
      subjectId: input.ticketId,
    }),
    requestAudit(ticket.orgId, input.ticketId, next.status === 'pending' ? 'charge.created' : 'charge.failed'),
  )
  await batch.commit()
  return next
}

/** Re-runs a charge that failed, or whose result never landed. */
export async function retrySiteCareCharge(
  firestore: FirebaseFirestore.Firestore,
  input: { ticketId: string; actor: SiteCareActor },
  deps: SiteCareDeps = {},
): Promise<SiteCareCharge | null> {
  const ticket = loadedTicket(await ticketRef(firestore, input.ticketId).get())
  const status = ticket.request.charge?.status
  if (status !== 'failed' && status !== 'creating') {
    throw new SiteCareError('There is no charge waiting to be retried on this request.', 409)
  }
  return settleCharge(firestore, input, deps)
}

// ── Close ───────────────────────────────────────────────────────────────────

export interface CloseSiteCareInput {
  ticketId: string
  actor: SiteCareActor
  minutes: unknown
  absorb?: boolean
}

export interface CloseSiteCareResult {
  request: SiteCareRequest
  statement: SiteCareMonthStatement
}

/**
 * Closes a request with one number. Refuses with the verdict when the
 * minutes take the month past the included hour and no approval covers it
 * — the panel then offers "Ask the owner first" and "Absorb it".
 */
export async function closeSiteCareRequest(
  firestore: FirebaseFirestore.Firestore,
  input: CloseSiteCareInput,
  deps: SiteCareDeps = {},
): Promise<CloseSiteCareResult> {
  const minutes = readSiteCareMinutes(input.minutes)
  if (minutes === null) throw new SiteCareError('Enter the minutes this took.', 400)
  const nowMs = nowOf(deps)
  const month = siteCareMonthKey(nowMs)
  const first = loadedTicket(await ticketRef(firestore, input.ticketId).get())
  const publish = await findSiteCarePublish(
    firestore,
    first.orgId,
    first.request.timerStartedAtMs ?? (first.data['createdAt'] as Timestamp | undefined)?.toMillis?.() ?? nowMs,
  ).catch(() => null)

  const result = await firestore.runTransaction(async (tx) => {
    const ticket = loadedTicket(await tx.get(ticketRef(firestore, input.ticketId)))
    if (ticket.request.state === 'closed') throw new SiteCareError('This request is already closed. Correct its minutes instead.', 409)
    const context = await readMonthContext(tx, firestore, ticket.orgId, month, input.ticketId)
    const allocation = allocateSiteCareMinutes({
      minutes,
      otherIncludedUsed: context.otherIncludedUsed,
      goodwillMinutes: context.goodwillMinutes,
    })
    const verdict = siteCareCloseVerdict({
      requiredHours: allocation.requiredHours,
      approval: ticket.request.approval,
      absorb: input.absorb === true,
    })
    if (verdict.ok === false) {
      throw new SiteCareError(siteCareBlockedMessage(verdict), 409, { blocked: verdict, allocation })
    }
    const timerMinutes = ticket.request.timerStartedAtMs
      ? Math.round((nowMs - ticket.request.timerStartedAtMs) / 60_000)
      : null
    let request: SiteCareRequest = {
      ...ticket.request,
      state: 'closed',
      month,
      closedAtMs: nowMs,
      minutesLogged: minutes,
      timerMinutes,
      countedMinutes: allocation.countedMinutes,
      includedMinutesUsed: allocation.includedMinutesUsed,
      overMinutes: allocation.overMinutes,
      billedHours: verdict.billedHours,
      absorbed: verdict.absorbed,
      publish,
    }
    let charge: SiteCareCharge | null = null
    if (verdict.billedHours > 0) {
      const statement = statementWith(month, context, input.ticketId, ticket.subject, request)
      const seq = request.chargeSeq + 1
      charge = newCharge({
        ticketId: input.ticketId,
        seq,
        hours: verdict.billedHours,
        description: siteCareExtraTimeDescription({
          title: ticket.subject,
          minutesLogged: minutes,
          overMinutes: allocation.overMinutes,
          billedHours: verdict.billedHours,
          approvedHours: request.approval?.hours ?? null,
          statement,
        }),
        nowMs,
      })
      request = { ...request, charge, chargeSeq: seq }
    }
    const statement = statementWith(month, context, input.ticketId, ticket.subject, request)
    tx.update(ticket.ref, {
      siteCare: request,
      siteCareMonth: month,
      siteCareOrgMonth: siteCareOrgMonth(ticket.orgId, month),
      status: 'closed',
      // The promise was "done", and it is: the SLA sweep stops here even if
      // the owner later replies and reopens the thread.
      ...(ticket.data['firstRespondedAt'] ? {} : { firstRespondedAt: FieldValue.serverTimestamp() }),
      updatedAt: FieldValue.serverTimestamp(),
    })
    const history = ticketHistory(firestore, input.ticketId)
    if (timerMinutes !== null) {
      appendHistoryRow(
        tx,
        firestore,
        history,
        historyRow({
          atMs: nowMs,
          by: input.actor,
          kind: 'timer.stopped',
          summary: `Stopped work after ${formatSiteCareMinutes(timerMinutes)} on the timer.`,
          after: { timerMinutes },
          subjectId: input.ticketId,
        }),
      )
    }
    appendHistoryRow(
      tx,
      firestore,
      history,
      historyRow({
        atMs: nowMs,
        by: input.actor,
        kind: 'request.closed',
        summary:
          `Finished “${ticket.subject}”: ${formatSiteCareMinutes(minutes)} of work, ` +
          `${allocation.includedMinutesUsed} included minutes used` +
          (allocation.overMinutes > 0
            ? verdict.absorbed
              ? `, ${formatSiteCareMinutes(allocation.overMinutes)} past the included hour absorbed at no charge.`
              : `, ${describeHours(verdict.billedHours)} of extra time billed.`
            : '.'),
        after: {
          minutesLogged: minutes,
          timerMinutes,
          countedMinutes: allocation.countedMinutes,
          includedMinutesUsed: allocation.includedMinutesUsed,
          overMinutes: allocation.overMinutes,
          billedHours: verdict.billedHours,
          absorbed: verdict.absorbed,
          publishActivityId: publish?.activityId ?? null,
        },
        subjectId: input.ticketId,
      }),
      requestAudit(ticket.orgId, input.ticketId, verdict.absorbed ? 'request.closedAbsorbed' : 'request.closed'),
    )
    if (charge) {
      appendHistoryRow(tx, firestore, history, chargeRequestedRow(input.ticketId, charge, input.actor, nowMs))
    }
    return { ticket, request, statement }
  })

  let request = result.request
  if (request.charge) {
    const settled = await settleCharge(firestore, { ticketId: input.ticketId, actor: input.actor }, deps)
    request = { ...request, charge: settled }
  }
  await emailDoneSummary(firestore, result.ticket, request, result.statement, deps)
  return { request, statement: result.statement }
}

function billingSentence(request: SiteCareRequest): string {
  if (request.overMinutes <= 0) return 'No extra charge: this fit in your included hour.'
  if (request.absorbed || request.billedHours === 0) {
    return 'It ran past your included hour, and we did not charge for the extra time.'
  }
  const status = request.charge?.status
  if (status === 'failed') {
    return `It ran past your included hour; we will add ${describeHours(request.billedHours)} of extra time to your next invoice.`
  }
  return `${describeHours(request.billedHours)} of extra time (${formatSiteCareUsd(
    siteCareExtraTimeCents(request.billedHours),
  )}, at $${SITE_CARE_EXTRA_HOUR_USD} an hour, the time you approved) will be on your next invoice.`
}

function minutesLeftSentence(statement: SiteCareMonthStatement): string {
  return `${formatSiteCareMinutes(statement.minutesLeft)} of this month’s included time`
}

async function emailDoneSummary(
  firestore: FirebaseFirestore.Firestore,
  ticket: LoadedTicket,
  request: SiteCareRequest,
  statement: SiteCareMonthStatement,
  deps: SiteCareDeps,
): Promise<void> {
  const org = await readSiteCareOrg(firestore, ticket.orgId)
  const to = (await siteCareOwnerEmail(firestore, ticket.orgId, org)) ?? request.requesterEmail
  const changes =
    siteCarePublishSentence(request.publish, formatSiteCareDate) ?? `We made the change you asked for: “${ticket.subject}”.`
  const result = await emailOf(deps)({
    key: SITE_CARE_REQUEST_DONE_EMAIL_KEY,
    to,
    org,
    requestId: ticket.ref.id,
    merge: {
      'request.title': ticket.subject,
      'request.changes': changes,
      'request.minutes': formatSiteCareMinutes(request.minutesLogged ?? 0),
      'month.minutesLeft': minutesLeftSentence(statement),
      'request.billing': billingSentence(request),
    },
    fallback: {
      subject: `Done: ${ticket.subject}`,
      text:
        `We finished your request “${ticket.subject}”. ${billingSentence(request)}\n\n` +
        `What changed: ${changes}\nTime: ${formatSiteCareMinutes(request.minutesLogged ?? 0)}\n` +
        `Left this month: ${minutesLeftSentence(statement)}`,
    },
  })
  await recordEmail(firestore, ticketHistory(firestore, ticket.ref.id), result, 'the summary', nowOf(deps), ticket.ref.id)
}

// ── Approval ────────────────────────────────────────────────────────────────

/**
 * Records — or corrects — how the owner said yes to extra time, and emails
 * them the confirmation that is the written record.
 */
export async function recordSiteCareApproval(
  firestore: FirebaseFirestore.Firestore,
  input: { ticketId: string; actor: SiteCareActor & { uid: string }; approval: Record<string, unknown> },
  deps: SiteCareDeps = {},
): Promise<OwnerApprovalRecord> {
  const nowMs = nowOf(deps)
  const { ticket, record, previous } = await firestore.runTransaction(async (tx) => {
    const ticket = loadedTicket(await tx.get(ticketRef(firestore, input.ticketId)))
    const previous = ticket.request.approval
    const read = readOwnerApprovalInput(input.approval, {
      rateUsd: SITE_CARE_EXTRA_HOUR_USD,
      nowMs,
      by: { uid: input.actor.uid, email: input.actor.email },
      previous,
    })
    if (read.ok === false) throw new SiteCareError(read.error, 400)
    const record = read.record
    tx.update(ticket.ref, { 'siteCare.approval': record, updatedAt: FieldValue.serverTimestamp() })
    appendHistoryRow(
      tx,
      firestore,
      ticketHistory(firestore, input.ticketId),
      historyRow({
        atMs: nowMs,
        by: input.actor,
        kind: previous ? 'approval.corrected' : 'approval.recorded',
        summary: previous
          ? `Corrected the approval: ${describeHours(previous.hours)} → ${describeHours(record.hours)}, ${record.channel}.`
          : ownerApprovalSentence(record, ticket.subject, formatSiteCareDate),
        reason: record.correctionReason,
        before: previous ? { ...previous } : null,
        after: { ...record },
        subjectId: input.ticketId,
      }),
      requestAudit(ticket.orgId, input.ticketId, previous ? 'approval.corrected' : 'approval.recorded'),
    )
    return { ticket, record, previous }
  })
  const org = await readSiteCareOrg(firestore, ticket.orgId)
  const to = await siteCareOwnerEmail(firestore, ticket.orgId, org)
  const sentence = ownerApprovalSentence(record, ticket.subject, formatSiteCareDate)
  const correction = previous
    ? `This corrects the earlier record (${describeHours(previous.hours)}): ${record.correctionReason}`
    : ''
  const heading = previous ? 'Corrected: your approval of extra time' : 'You approved extra time'
  const result = await emailOf(deps)({
    key: SITE_CARE_APPROVAL_EMAIL_KEY,
    to,
    org,
    requestId: input.ticketId,
    merge: {
      'request.title': ticket.subject,
      'approval.heading': heading,
      'approval.sentence': sentence,
      'approval.correction': correction,
    },
    fallback: {
      subject: `${heading}: extra time for ${ticket.subject}`,
      text: `${sentence} ${correction}\n\nIf this is not what you agreed to, reply to this email.`,
    },
  })
  await recordEmail(firestore, ticketHistory(firestore, input.ticketId), result, 'the approval confirmation', nowOf(deps), input.ticketId)
  return record
}

// ── Corrections ─────────────────────────────────────────────────────────────

/**
 * Whether the request's minutes may still change: until the subscription
 * invoice that carries (or would carry) them finalizes.
 */
async function assertMinutesEditable(
  orgId: string,
  request: SiteCareRequest,
  deps: SiteCareDeps,
): Promise<void> {
  const charge = request.charge
  if (charge && charge.status === 'creating') {
    throw new SiteCareError('A charge on this request is still being created. Retry it first.', 409)
  }
  if (charge && charge.status === 'pending' && charge.invoiceItemId) {
    const read = await readExtraTimeItem(charge.invoiceItemId, deps.stripe)
    if (read.ok === false) throw new SiteCareError(read.error, 502)
    if (!extraTimeItemIsEditable(read.state.stage) && read.state.stage !== 'deleted') {
      throw new SiteCareError(
        'The invoice with this extra time has been finalized, so its minutes are locked. Void, credit or refund the charge instead.',
        409,
      )
    }
    return
  }
  const billing = await readOrgBilling(orgId)
  const customerId = String((billing as { stripeCustomerId?: unknown }).stripeCustomerId ?? '')
  if (!customerId) return
  const subscription = await siteCareSubscriptionId(customerId, deps.stripe)
  if (subscription.ok === false) return
  const finalized = await subscriptionInvoiceFinalizedSince(
    { subscriptionId: subscription.subscriptionId, sinceMs: request.closedAtMs ?? 0 },
    deps.stripe,
  )
  if (finalized.ok === false) throw new SiteCareError(finalized.error, 502)
  if (finalized.finalized) {
    throw new SiteCareError(
      'The invoice for this request’s month has been finalized, so its minutes are locked.',
      409,
    )
  }
}

/**
 * Changes the minutes on a closed request, with a reason, and recomputes its
 * share of the included hour and its extra time: a pending item is corrected
 * or deleted, a new one is added only under an approval. The owner gets a
 * "corrected" summary with the before and after.
 */
export async function correctSiteCareMinutes(
  firestore: FirebaseFirestore.Firestore,
  input: {
    ticketId: string
    actor: SiteCareActor
    minutes: unknown
    reason: unknown
    absorb?: boolean
  },
  deps: SiteCareDeps = {},
): Promise<CloseSiteCareResult> {
  const minutes = readSiteCareMinutes(input.minutes)
  if (minutes === null) throw new SiteCareError('Enter the corrected minutes.', 400)
  const reason = requireHistoryReason(input.reason)
  if (reason.ok === false) throw new SiteCareError(reason.error, 400)
  const before = loadedTicket(await ticketRef(firestore, input.ticketId).get())
  if (before.request.state !== 'closed') {
    throw new SiteCareError('Only a finished request’s minutes are corrected; close it instead.', 409)
  }
  await assertMinutesEditable(before.orgId, before.request, deps)
  const nowMs = nowOf(deps)

  const result = await firestore.runTransaction(async (tx) => {
    const ticket = loadedTicket(await tx.get(ticketRef(firestore, input.ticketId)))
    const old = ticket.request
    if (old.charge?.status === 'creating') {
      throw new SiteCareError('A charge on this request is still being created. Retry it first.', 409)
    }
    const month = old.month
    const context = await readMonthContext(tx, firestore, ticket.orgId, month, input.ticketId)
    const allocation = allocateSiteCareMinutes({
      minutes,
      otherIncludedUsed: context.otherIncludedUsed,
      goodwillMinutes: context.goodwillMinutes,
    })
    const verdict = siteCareCloseVerdict({
      requiredHours: allocation.requiredHours,
      approval: old.approval,
      absorb: input.absorb ?? old.absorbed,
    })
    if (verdict.ok === false) {
      throw new SiteCareError(siteCareBlockedMessage(verdict), 409, { blocked: verdict, allocation })
    }
    let request: SiteCareRequest = {
      ...old,
      minutesLogged: minutes,
      countedMinutes: allocation.countedMinutes,
      includedMinutesUsed: allocation.includedMinutesUsed,
      overMinutes: allocation.overMinutes,
      billedHours: verdict.billedHours,
      absorbed: verdict.absorbed,
    }
    const live = old.charge && old.charge.status === 'pending' ? old.charge : null
    const statementNow = statementWith(month, context, input.ticketId, ticket.subject, request)
    const description = siteCareExtraTimeDescription({
      title: ticket.subject,
      minutesLogged: minutes,
      overMinutes: allocation.overMinutes,
      billedHours: verdict.billedHours,
      approvedHours: request.approval?.hours ?? null,
      statement: statementNow,
    })
    // What the Stripe side must do, decided here and done after the commit.
    let stripeStep: 'none' | 'update' | 'delete' | 'create' = 'none'
    if (live && verdict.billedHours === 0) stripeStep = 'delete'
    else if (live && (live.hours !== verdict.billedHours || live.description !== description)) stripeStep = 'update'
    else if (!live && verdict.billedHours > 0) stripeStep = 'create'
    if (stripeStep === 'create') {
      const seq = request.chargeSeq + 1
      request = {
        ...request,
        chargeSeq: seq,
        charge: newCharge({ ticketId: input.ticketId, seq, hours: verdict.billedHours, description, nowMs }),
      }
    } else if (old.charge?.status === 'failed' && verdict.billedHours === 0) {
      // A charge Stripe refused never made an item, and the corrected time
      // no longer owes one: it is settled as voided, so the reconciliation
      // stops reporting hours that are no longer owed.
      request = { ...request, charge: { ...old.charge, status: 'voided', updatedAtMs: nowMs } }
    }
    tx.update(ticket.ref, { siteCare: request, updatedAt: FieldValue.serverTimestamp() })
    const history = ticketHistory(firestore, input.ticketId)
    // The correction's own row id keys its Stripe call: one correction, one
    // key, so a retried call cannot apply it twice (and a later correction,
    // with its own row, is never mistaken for a replay of this one).
    const correctionRef = appendHistoryRow(
      tx,
      firestore,
      history,
      historyRow({
        atMs: nowMs,
        by: input.actor,
        kind: 'minutes.corrected',
        summary: `Corrected the time from ${formatSiteCareMinutes(old.minutesLogged ?? 0)} to ${formatSiteCareMinutes(minutes)}.`,
        reason: reason.reason,
        before: {
          minutesLogged: old.minutesLogged,
          countedMinutes: old.countedMinutes,
          includedMinutesUsed: old.includedMinutesUsed,
          overMinutes: old.overMinutes,
          billedHours: old.billedHours,
        },
        after: {
          minutesLogged: minutes,
          countedMinutes: allocation.countedMinutes,
          includedMinutesUsed: allocation.includedMinutesUsed,
          overMinutes: allocation.overMinutes,
          billedHours: verdict.billedHours,
          chargeStatus: request.charge?.status ?? null,
        },
        subjectId: input.ticketId,
      }),
      requestAudit(ticket.orgId, input.ticketId, 'minutes.corrected'),
    )
    if (stripeStep === 'create' && request.charge) {
      appendHistoryRow(tx, firestore, history, chargeRequestedRow(input.ticketId, request.charge, input.actor, nowMs))
    }
    return {
      ticket,
      old,
      request,
      statement: statementNow,
      stripeStep,
      live,
      description,
      correctionId: correctionRef.id,
    }
  })

  let request = result.request
  if (result.stripeStep === 'create') {
    const settled = await settleCharge(firestore, { ticketId: input.ticketId, actor: input.actor }, deps)
    request = { ...request, charge: settled }
  } else if ((result.stripeStep === 'update' || result.stripeStep === 'delete') && result.live?.invoiceItemId) {
    request = await correctLiveCharge(
      firestore,
      {
        ticket: result.ticket,
        request,
        live: result.live,
        step: result.stripeStep,
        hours: request.billedHours,
        description: result.description,
        actor: input.actor,
        reason: reason.reason,
        correctionId: result.correctionId,
      },
      deps,
    )
  }

  const org = await readSiteCareOrg(firestore, result.ticket.orgId)
  const to = (await siteCareOwnerEmail(firestore, result.ticket.orgId, org)) ?? request.requesterEmail
  const emailed = await emailOf(deps)({
    key: SITE_CARE_REQUEST_CORRECTED_EMAIL_KEY,
    to,
    org,
    requestId: input.ticketId,
    merge: {
      'request.title': result.ticket.subject,
      'correction.before': formatSiteCareMinutes(result.old.minutesLogged ?? 0),
      'correction.after': formatSiteCareMinutes(minutes),
      'correction.reason': reason.reason,
      'request.billing': billingSentence(request),
      'month.minutesLeft': minutesLeftSentence(result.statement),
    },
    fallback: {
      subject: `Corrected: the time on ${result.ticket.subject}`,
      text:
        `We corrected the time on “${result.ticket.subject}” from ${formatSiteCareMinutes(result.old.minutesLogged ?? 0)} ` +
        `to ${formatSiteCareMinutes(minutes)}. ${reason.reason} ${billingSentence(request)}`,
    },
  })
  await recordEmail(firestore, ticketHistory(firestore, input.ticketId), emailed, 'the corrected summary', nowOf(deps), input.ticketId)
  return { request, statement: result.statement }
}

/**
 * The idempotency key of a correction's Stripe call: the charge's own key
 * and the id of the history row that records the correction. A clock would
 * make every retry a new request to Stripe; the row id makes it the same one.
 */
export function siteCareCorrectionKey(chargeKey: string, correctionId: string): string {
  return `${chargeKey}:fix:${correctionId}`
}

/** Updates or deletes a pending item after a correction, with its row. */
async function correctLiveCharge(
  firestore: FirebaseFirestore.Firestore,
  input: {
    ticket: LoadedTicket
    request: SiteCareRequest
    live: SiteCareCharge
    step: 'update' | 'delete'
    hours: number
    description: string
    actor: SiteCareActor
    reason: string
    /** The `minutes.corrected` history row this Stripe call carries out. */
    correctionId: string
  },
  deps: SiteCareDeps,
): Promise<SiteCareRequest> {
  const itemId = String(input.live.invoiceItemId)
  const nowMs = nowOf(deps)
  const seqKey = siteCareCorrectionKey(input.live.idempotencyKey, input.correctionId)
  const outcome =
    input.step === 'delete'
      ? await deleteExtraTimeItem(itemId, deps.stripe)
      : await updateExtraTimeItem(
          { invoiceItemId: itemId, hours: input.hours, description: input.description, idempotencyKey: seqKey },
          deps.stripe,
        )
  const outcomeError = outcome.ok === false ? outcome.error : null
  const charge: SiteCareCharge = outcomeError === null
    ? input.step === 'delete'
      ? { ...input.live, status: 'voided', updatedAtMs: nowMs, error: null }
      : {
          ...input.live,
          hours: input.hours,
          amountCents: siteCareExtraTimeCents(input.hours),
          description: input.description,
          updatedAtMs: nowMs,
          error: null,
        }
    : { ...input.live, error: outcomeError, updatedAtMs: nowMs }
  const batch = firestore.batch()
  batch.update(input.ticket.ref, { 'siteCare.charge': charge, updatedAt: FieldValue.serverTimestamp() })
  appendHistoryRow(
    batch,
    firestore,
    ticketHistory(firestore, input.ticket.ref.id),
    historyRow({
      atMs: nowMs,
      by: input.actor,
      kind: outcomeError !== null ? 'charge.correctionFailed' : input.step === 'delete' ? 'charge.voided' : 'charge.updated',
      summary: outcomeError !== null
        ? `The charge could not be corrected in Stripe: ${outcomeError}`
        : input.step === 'delete'
          ? `Removed the extra-time charge (${formatSiteCareUsd(input.live.amountCents)}) before it was invoiced.`
          : `Changed the extra-time charge from ${describeHours(input.live.hours)} to ${describeHours(input.hours)}.`,
      reason: input.reason,
      before: { hours: input.live.hours, amountCents: input.live.amountCents, description: input.live.description },
      after: { hours: charge.hours, amountCents: charge.amountCents, status: charge.status, error: charge.error },
      stripe: { object: 'invoiceitem', id: itemId, amountCents: charge.amountCents },
      subjectId: input.ticket.ref.id,
    }),
    requestAudit(
      input.ticket.orgId,
      input.ticket.ref.id,
      outcomeError !== null ? 'charge.correctionFailed' : input.step === 'delete' ? 'charge.voided' : 'charge.updated',
    ),
  )
  await batch.commit()
  return { ...input.request, charge }
}

/**
 * Voids, credits or refunds a request's extra-time charge, with a reason —
 * deleted before its invoice finalizes, credited after, refunded once paid.
 * `absorb` also records that the request is not charged for its extra time.
 */
export async function reverseSiteCareCharge(
  firestore: FirebaseFirestore.Firestore,
  input: { ticketId: string; actor: SiteCareActor; reason: unknown; absorb?: boolean },
  deps: SiteCareDeps = {},
): Promise<SiteCareCharge> {
  const reason = requireHistoryReason(input.reason)
  if (reason.ok === false) throw new SiteCareError(reason.error, 400)
  const ticket = loadedTicket(await ticketRef(firestore, input.ticketId).get())
  const charge = ticket.request.charge
  if (!charge || !SITE_CARE_LIVE_CHARGE_STATUSES.includes(charge.status) || !charge.invoiceItemId) {
    throw new SiteCareError('There is no extra-time charge on this request to reverse.', 409)
  }
  const read = await readExtraTimeItem(charge.invoiceItemId, deps.stripe)
  if (read.ok === false) throw new SiteCareError(read.error, 502)
  const stage = read.state.stage
  if (stage === 'void' || stage === 'uncollectible') {
    throw new SiteCareError(`The invoice with this charge is ${stage}; there is nothing to reverse.`, 409)
  }
  const nowMs = nowOf(deps)
  const intended = stage === 'paid' ? 'refund' : stage === 'open' ? 'credit' : 'void'
  // The intent first, so a call whose answer is lost still left a row.
  await commitHistoryRow(
    firestore,
    ticketHistory(firestore, input.ticketId),
    historyRow({
      atMs: nowMs,
      by: input.actor,
      kind: `charge.${intended}Requested`,
      summary: `Reversing the extra-time charge (${formatSiteCareUsd(charge.amountCents)}): ${intended}.`,
      reason: reason.reason,
      before: { status: charge.status, stage },
      subjectId: input.ticketId,
    }),
    requestAudit(ticket.orgId, input.ticketId, `charge.${intended}Requested`),
  )
  let next: SiteCareCharge
  let stripeRef: HistoryStripeRef
  if (intended === 'void') {
    const deleted = stage === 'deleted' ? ({ ok: true, deleted: true } as const) : await deleteExtraTimeItem(charge.invoiceItemId, deps.stripe)
    if (deleted.ok === false) throw new SiteCareError(deleted.error, 502)
    next = { ...charge, status: 'voided', updatedAtMs: nowOf(deps), error: null }
    stripeRef = { object: 'invoiceitem', id: charge.invoiceItemId, amountCents: charge.amountCents }
  } else {
    const credited = await creditExtraTimeItem(
      {
        invoiceId: String(read.state.invoiceId),
        invoiceItemId: charge.invoiceItemId,
        refund: intended === 'refund',
        memo: `Site Care: ${reason.reason}`,
        metadata: { siteCareRequestId: input.ticketId, orgId: ticket.orgId },
        idempotencyKey: `${charge.idempotencyKey}:${intended}`,
      },
      deps.stripe,
    )
    if (credited.ok === false) throw new SiteCareError(credited.error, 502)
    next = {
      ...charge,
      status: intended === 'refund' ? 'refunded' : 'credited',
      invoiceId: read.state.invoiceId,
      creditNoteId: credited.creditNoteId,
      refundId: credited.refundId,
      updatedAtMs: nowOf(deps),
      error: null,
    }
    stripeRef = { object: 'credit_note', id: credited.creditNoteId, amountCents: credited.amountCents }
  }
  const batch = firestore.batch()
  batch.update(ticket.ref, {
    'siteCare.charge': next,
    ...(input.absorb ? { 'siteCare.absorbed': true, 'siteCare.billedHours': 0 } : {}),
    updatedAt: FieldValue.serverTimestamp(),
  })
  const doneKind = next.status === 'voided' ? 'charge.voided' : next.status === 'refunded' ? 'charge.refunded' : 'charge.credited'
  appendHistoryRow(
    batch,
    firestore,
    ticketHistory(firestore, input.ticketId),
    historyRow({
      atMs: nowOf(deps),
      by: input.actor,
      kind: doneKind,
      summary:
        next.status === 'voided'
          ? `Removed the extra-time charge (${formatSiteCareUsd(charge.amountCents)}); it will not be invoiced.`
          : next.status === 'refunded'
            ? `Refunded the extra-time charge (${formatSiteCareUsd(charge.amountCents)} plus its tax).`
            : `Credited the extra-time charge (${formatSiteCareUsd(charge.amountCents)} plus its tax) back on the invoice.`,
      reason: reason.reason,
      before: { status: charge.status },
      after: { status: next.status, creditNoteId: next.creditNoteId, refundId: next.refundId, absorbed: input.absorb === true },
      stripe: stripeRef,
      subjectId: input.ticketId,
    }),
    requestAudit(ticket.orgId, input.ticketId, doneKind),
  )
  await batch.commit()

  const org = await readSiteCareOrg(firestore, ticket.orgId)
  const to = await siteCareOwnerEmail(firestore, ticket.orgId, org)
  const heading =
    next.status === 'voided' ? 'Charge removed' : next.status === 'refunded' ? 'Charge refunded' : 'Charge credited'
  const amount = formatSiteCareUsd(charge.amountCents)
  const sentence =
    next.status === 'voided'
      ? `The ${amount} for ${describeHours(charge.hours)} of extra time will not be on your next invoice.`
      : next.status === 'refunded'
        ? `We refunded the ${amount} for ${describeHours(charge.hours)} of extra time, with its tax, to the card it was paid with.`
        : `We credited the ${amount} for ${describeHours(charge.hours)} of extra time, with its tax, on the invoice it was on.`
  const result = await emailOf(deps)({
    key: SITE_CARE_CHARGE_REVERSED_EMAIL_KEY,
    to,
    org,
    requestId: input.ticketId,
    merge: {
      'request.title': ticket.subject,
      'charge.heading': heading,
      'charge.sentence': sentence,
      'charge.reason': reason.reason,
    },
    fallback: { subject: `${heading}: ${ticket.subject}`, text: `${sentence}\n\nWhy: ${reason.reason}` },
  })
  await recordEmail(firestore, ticketHistory(firestore, input.ticketId), result, 'the charge notice', nowOf(deps), input.ticketId)
  return next
}

// ── Goodwill ────────────────────────────────────────────────────────────────

/** Adds included minutes to a workspace's month, with a reason. */
export async function addSiteCareGoodwill(
  firestore: FirebaseFirestore.Firestore,
  input: { orgId: string; month: unknown; minutes: unknown; reason: unknown; actor: SiteCareActor },
  deps: SiteCareDeps = {},
): Promise<{ goodwillMinutes: number }> {
  const month = String(input.month ?? '')
  if (!isSiteCareMonthKey(month)) throw new SiteCareError('Choose the month.', 400)
  const minutes = readSiteCareMinutes(input.minutes)
  if (minutes === null) throw new SiteCareError('Enter the goodwill minutes.', 400)
  const reason = requireHistoryReason(input.reason)
  if (reason.ok === false) throw new SiteCareError(reason.error, 400)
  const nowMs = nowOf(deps)
  return firestore.runTransaction(async (tx) => {
    const ref = monthRef(firestore, input.orgId, month)
    const snapshot = await tx.get(ref)
    const before = Number(snapshot.get('goodwillMinutes') ?? 0) || 0
    const after = before + minutes
    tx.set(ref, { orgId: input.orgId, month, goodwillMinutes: after, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
    appendHistoryRow(
      tx,
      firestore,
      monthHistory(firestore, input.orgId, month),
      historyRow({
        atMs: nowMs,
        by: input.actor,
        kind: 'goodwill.added',
        summary: `Added ${formatSiteCareMinutes(minutes)} of included time to this month, at no charge.`,
        reason: reason.reason,
        before: { goodwillMinutes: before },
        after: { goodwillMinutes: after },
      }),
      monthAudit(input.orgId, month, 'goodwill.added'),
    )
    return { goodwillMinutes: after }
  })
}

// ── The month ───────────────────────────────────────────────────────────────

export interface SiteCareMonthRequestView {
  ticketId: string
  subject: string
  status: string
  request: SiteCareRequest
  history: Array<AppendOnlyHistoryRow & { $id: string }>
}

export interface SiteCareMonthView {
  orgId: string
  month: string
  statement: SiteCareMonthStatement
  goodwillMinutes: number
  requests: SiteCareMonthRequestView[]
  monthHistory: Array<AppendOnlyHistoryRow & { $id: string }>
}

/** Every request of a workspace's month, each with its history, and the totals. */
export async function readSiteCareMonth(
  firestore: FirebaseFirestore.Firestore,
  input: { orgId: string; month: string },
): Promise<SiteCareMonthView> {
  if (!isSiteCareMonthKey(input.month)) throw new SiteCareError('Choose the month.', 400)
  const [snapshot, monthSnap, monthRows] = await Promise.all([
    firestore
      .collection(TICKETS)
      .where('siteCareOrgMonth', '==', siteCareOrgMonth(input.orgId, input.month))
      .limit(200)
      .get(),
    monthRef(firestore, input.orgId, input.month).get(),
    readHistoryRows(monthHistory(firestore, input.orgId, input.month)),
  ])
  const requests = await Promise.all(
    snapshot.docs.map(async (doc) => ({
      ticketId: doc.id,
      subject: String(doc.get('subject') ?? ''),
      status: String(doc.get('status') ?? ''),
      request: readSiteCareRequest(doc.get('siteCare')) as SiteCareRequest,
      history: await readHistoryRows(doc.ref.collection(SITE_CARE_HISTORY_COLLECTION)),
    })),
  )
  requests.sort((a, b) => (a.request.closedAtMs ?? Infinity) - (b.request.closedAtMs ?? Infinity))
  const goodwillMinutes = Number(monthSnap.get('goodwillMinutes') ?? 0) || 0
  return {
    orgId: input.orgId,
    month: input.month,
    goodwillMinutes,
    statement: siteCareMonthStatement({
      month: input.month,
      goodwillMinutes,
      requests: requests.map((r) => siteCareStatementRequest(r.ticketId, r.subject, r.request)),
    }),
    requests,
    monthHistory: monthRows,
  }
}

/** One request as the statement lists it, in the owner's words. */
export function siteCareStatementLine(view: SiteCareMonthRequestView): string {
  const r = view.request
  if (r.state !== 'closed') return `${view.subject}: in progress`
  const billed =
    r.billedHours > 0
      ? `${describeHours(r.billedHours)} billed (${formatSiteCareUsd(siteCareExtraTimeCents(r.billedHours))}), ${siteCareChargeWords(
          r.charge?.status ?? null,
        ).toLowerCase()}`
      : r.overMinutes > 0
        ? 'extra time not charged'
        : 'included'
  return `${view.subject}: ${formatSiteCareMinutes(r.minutesLogged ?? 0)}, ${billed}`
}

/** Every recorded row of the month, oldest first, as dated lines. */
export function siteCareStatementHistory(view: SiteCareMonthView): string[] {
  const rows = [...view.monthHistory, ...view.requests.flatMap((r) => r.history)].sort((a, b) => a.atMs - b.atMs)
  return rows.map(
    (row) => `${formatSiteCareDate(row.atMs)}: ${row.summary}${row.reason ? ` Why: ${row.reason}` : ''}`,
  )
}

/** Emails the owner the month's statement, on demand. */
export async function sendSiteCareStatement(
  firestore: FirebaseFirestore.Firestore,
  input: { orgId: string; month: string; actor: SiteCareActor },
  deps: SiteCareDeps = {},
): Promise<SiteCareEmailResult> {
  const view = await readSiteCareMonth(firestore, input)
  const org = await readSiteCareOrg(firestore, input.orgId)
  const to = await siteCareOwnerEmail(firestore, input.orgId, org)
  const summary = siteCareMonthSentence(view.statement)
  const lines = view.requests.map(siteCareStatementLine).join('\n') || 'No requests this month.'
  const history = siteCareStatementHistory(view).join('\n') || 'Nothing recorded yet.'
  const result = await emailOf(deps)({
    key: SITE_CARE_STATEMENT_EMAIL_KEY,
    to,
    org,
    requestId: null,
    merge: {
      'month.label': view.statement.monthLabel,
      'statement.summary': summary,
      'statement.lines': lines,
      'statement.history': history,
    },
    fallback: {
      subject: `Your Site Care statement for ${view.statement.monthLabel}`,
      text: `${summary}\n\n${lines}\n\nEverything we recorded:\n${history}`,
    },
  })
  await commitHistoryRow(
    firestore,
    monthHistory(firestore, input.orgId, input.month),
    historyRow({
      atMs: nowOf(deps),
      by: input.actor,
      kind: result.sent ? 'statement.sent' : 'statement.notSent',
      summary: result.sent
        ? `Emailed the ${view.statement.monthLabel} statement to ${result.to}.`
        : `The ${view.statement.monthLabel} statement was not sent (${result.reason ?? 'unknown'}).`,
      after: { to: result.to, sent: result.sent, summary },
    }),
    monthAudit(input.orgId, input.month, result.sent ? 'statement.sent' : 'statement.notSent'),
  )
  return result
}

// ── The quote reply ─────────────────────────────────────────────────────────

/**
 * "This one is bigger than Site Care covers, here is the quote": staff send
 * it from the request; it lands on the thread and in the owner's inbox. The
 * invoice itself is the staff "Charge for work" (AGL-3970).
 */
export async function sendSiteCareQuote(
  firestore: FirebaseFirestore.Firestore,
  input: { ticketId: string; actor: SiteCareActor; amountUsd: unknown; scope: unknown },
  deps: SiteCareDeps = {},
): Promise<SiteCareEmailResult> {
  const amount = Number(input.amountUsd)
  if (!Number.isInteger(amount) || amount < 1 || amount > 100_000) {
    throw new SiteCareError('Enter the quote as a whole number of dollars.', 400)
  }
  const scope = String(input.scope ?? '').trim().slice(0, 1000)
  if (!scope) throw new SiteCareError('Say what the price covers.', 400)
  const ticket = loadedTicket(await ticketRef(firestore, input.ticketId).get())
  const org = await readSiteCareOrg(firestore, ticket.orgId)
  const to = (await siteCareOwnerEmail(firestore, ticket.orgId, org)) ?? ticket.request.requesterEmail
  const price = `$${amount}`
  const result = await emailOf(deps)({
    key: SITE_CARE_QUOTE_EMAIL_KEY,
    to,
    org,
    requestId: input.ticketId,
    merge: { 'request.title': ticket.subject, 'quote.amount': price, 'quote.scope': scope },
    fallback: {
      subject: `A quote for ${ticket.subject}`,
      text:
        `Site Care covers changes to what your site already has. “${ticket.subject}” adds something new, ` +
        `so it is a project with one flat price: ${price}.\n\nWhat it covers: ${scope}\n\n` +
        'Reply to say yes and we will send the invoice. Nothing is charged until you do.',
    },
  })
  const nowMs = nowOf(deps)
  const batch = firestore.batch()
  batch.create(ticket.ref.collection('messages').doc(createResourceUid()), {
    authorId: input.actor.uid,
    authorEmail: input.actor.email,
    staff: true,
    body: `Quote sent: ${price} — ${scope}`,
    createdAt: FieldValue.serverTimestamp(),
  })
  batch.update(ticket.ref, { updatedAt: FieldValue.serverTimestamp() })
  appendHistoryRow(
    batch,
    firestore,
    ticketHistory(firestore, input.ticketId),
    historyRow({
      atMs: nowMs,
      by: input.actor,
      kind: result.sent ? 'quote.sent' : 'quote.notSent',
      summary: result.sent
        ? `Sent a flat quote of ${price}: this is bigger than Site Care covers.`
        : `The quote of ${price} was not emailed (${result.reason ?? 'unknown'}).`,
      after: { amountUsd: amount, scope, to: result.to, sent: result.sent },
      subjectId: input.ticketId,
    }),
    requestAudit(ticket.orgId, input.ticketId, result.sent ? 'quote.sent' : 'quote.notSent'),
  )
  await batch.commit()
  return result
}

// ── A ticket's panel ────────────────────────────────────────────────────────

export interface SiteCareRequestPanel {
  ticketId: string
  orgId: string
  subject: string
  request: SiteCareRequest
  history: Array<AppendOnlyHistoryRow & { $id: string }>
  /** The close's prefilled number, from the timer. */
  suggestedMinutes: number
  /** What this request's month looks like with its other requests. */
  monthMinutesLeft: number
  /** Other Site Care workspaces the sender belongs to (AGL-4031). */
  otherWorkspaces: SiteCareWorkspaceCandidate[]
  /** Why "Move to workspace" is refused, or null when it is offered. */
  moveBlockedReason: string | null
}

/** Everything the staff panel shows for one request. */
export async function readSiteCareRequestPanel(
  firestore: FirebaseFirestore.Firestore,
  ticketId: string,
  deps: SiteCareDeps = {},
): Promise<SiteCareRequestPanel> {
  const ticket = loadedTicket(await ticketRef(firestore, ticketId).get())
  const nowMs = nowOf(deps)
  const month = ticket.request.state === 'closed' ? ticket.request.month : siteCareMonthKey(nowMs)
  const [history, context, candidates] = await Promise.all([
    readHistoryRows(ticketHistory(firestore, ticketId)),
    readMonthContext(null, firestore, ticket.orgId, month, ticketId),
    readSiteCareCandidatesFor(firestore, ticketId),
  ])
  const otherWorkspaces = otherSiteCareCandidates(candidates, ticket.orgId)
  const pool = siteCareIncludedPool(context.goodwillMinutes)
  return {
    ticketId,
    orgId: ticket.orgId,
    subject: ticket.subject,
    request: ticket.request,
    history,
    suggestedMinutes: closeMinutesFromTimer(ticket.request.timerStartedAtMs, nowMs),
    monthMinutesLeft: Math.max(0, pool - context.otherIncludedUsed),
    otherWorkspaces,
    moveBlockedReason: otherWorkspaces.length ? siteCareMoveBlockedReason(ticket.request, otherWorkspaces) : null,
  }
}
