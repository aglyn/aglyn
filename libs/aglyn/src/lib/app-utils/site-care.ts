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
  SITE_CARE_EXTRA_HOUR_USD,
  SITE_CARE_INCLUDED_BLOCK_MINUTES,
  SITE_CARE_INCLUDED_MINUTES,
} from './plan-entitlements'
import { operatorIdentity } from './operator-identity'
import { describeHours, type OwnerApprovalRecord } from './owner-approval-record'

/**
 * SITE CARE REQUESTS: THE ARITHMETIC (AGL-3959).
 *
 * A Site Care owner asks for a change by email or from the console, and the
 * request is a support ticket tagged `siteCare`. Staff open it (a timer
 * starts), make the change, and close it with one number: the minutes. This
 * module is everything about that which needs no Firestore and no Stripe —
 * the month a request counts in, how its minutes are counted against the
 * included hour, what the close allows, what extra time bills, and the
 * statement the month adds up to. The routes, the staff panel, the owner's
 * Billing card and the reconciliation all read it, so they cannot disagree.
 *
 * ## The rules, from the Decision Log of 2026-10-19
 *
 * - The included hour is `SITE_CARE_INCLUDED_MINUTES` a month, no rollover,
 *   plus any goodwill minutes staff add to that month. Each request counts
 *   against it in `SITE_CARE_INCLUDED_BLOCK_MINUTES` blocks, rounded UP.
 * - A request's share of the hour is fixed when it closes, against what the
 *   month's earlier requests left. Correcting one request's minutes later
 *   recomputes that request alone, against the same remainder, so a fix
 *   never moves a charge on a request nobody touched.
 * - Past the hour, extra time bills at `SITE_CARE_EXTRA_HOUR_USD` per
 *   STARTED hour — whole hours, rounded up — and never less than the hours
 *   the owner approved. With no approval on file, or more time than was
 *   approved, the close is blocked: ask the owner first, or absorb it (no
 *   charge, the minutes still count).
 */

/** The `kind` a Site Care support ticket carries. */
export const SITE_CARE_TICKET_KIND = 'siteCare'

/** Site Care's promise: done within two business days. */
export const SITE_CARE_RESPONSE_BUSINESS_DAYS = 2

/** The zone a Site Care month is drawn in: where the work is done. */
export const SITE_CARE_TIME_ZONE = 'America/Chicago'

/** The close's minutes are rounded up to this step. */
export const SITE_CARE_CLOSE_STEP_MINUTES = 5

/** The most minutes one request may log. */
export const SITE_CARE_MAX_REQUEST_MINUTES = 60 * 40

/**
 * The tax code the extra-time item is billed under: the code every Aglyn
 * product carries (the Decision Log of 2026-10-18), read off the Site Care
 * product, which is checked to carry it before anything is charged.
 */
export const SITE_CARE_EXTRA_TIME_TAX_CODE = 'txcd_10103001'

/**
 * WHERE A CHANGE IS EMAILED (AGL-3997): the support address. Site Care has no
 * address of its own. An owner writes to the support address they already
 * know, and a message to it from a member of a workspace with Site Care files
 * itself as a request; every other message is ordinary support mail. The
 * support mailbox also delivers each message to `support@<inbound mail
 * domain>`, where the mail provider announces it, and every Site Care email
 * replies to `support+<requestId>@<inbound mail domain>`, so an answer joins
 * its own request.
 */
export const SITE_CARE_INBOUND_LOCAL_PART = 'support'

/**
 * The operator's support address, from the operator identity: what an owner
 * is told to email a change to, and what the intake reads as one. `null` on
 * a deployment that publishes no support address, where Request a change on
 * a site's dashboard is the only way in.
 */
export function siteCareSupportAddress(): string | null {
  return operatorIdentity().supportEmail
}

/**
 * The Reply-To of a Site Care email: `support+<requestId>@<domain>` for an
 * email about one request, so the answer joins it; the support address for
 * one about no single request (a statement, a project), so the answer reaches
 * the support inbox like any other message to it.
 */
export function siteCareReplyAddress(
  requestId: string | null,
  domain: string,
  supportEmail: string | null = siteCareSupportAddress(),
): string {
  if (requestId) return `${SITE_CARE_INBOUND_LOCAL_PART}+${requestId}@${domain}`
  return supportEmail ?? `${SITE_CARE_INBOUND_LOCAL_PART}@${domain}`
}

/** The longest title and message a request keeps. */
export const SITE_CARE_SUBJECT_MAX = 150
export const SITE_CARE_BODY_MAX = 5000

/** Stripe's limit on an invoice item's description is generous; ours is not. */
export const SITE_CARE_LINE_DESCRIPTION_MAX = 480

/** Where a request came from. */
export type SiteCareSource = 'email' | 'console'

/**
 * Where an extra-time charge stands, as the platform recorded it.
 *
 * `creating` is written BEFORE the Stripe call and `pending` after it, so a
 * call that succeeded with no row behind it shows as `creating` with no item
 * id — which the reconciliation reports. Whether a `pending` item has been
 * invoiced yet is read from Stripe when it matters, never assumed.
 */
export type SiteCareChargeStatus =
  | 'creating'
  | 'pending'
  | 'failed'
  | 'voided'
  | 'credited'
  | 'refunded'

/** Charges that still bill, or are about to. */
export const SITE_CARE_LIVE_CHARGE_STATUSES: readonly SiteCareChargeStatus[] = [
  'creating',
  'pending',
]

export interface SiteCareCharge {
  status: SiteCareChargeStatus
  /** Whole hours billed. */
  hours: number
  /** `hours × rate`, in cents, before tax. */
  amountCents: number
  /** The invoice line description, exactly as it was sent. */
  description: string
  /** The key the create was sent under, so a retry makes nothing twice. */
  idempotencyKey: string
  invoiceItemId: string | null
  /** The invoice the item landed on, once read. */
  invoiceId: string | null
  creditNoteId: string | null
  refundId: string | null
  /** What Stripe said, when a call failed. */
  error: string | null
  updatedAtMs: number
}

/** The site publish that shipped the change, from the site's activity log. */
export interface SiteCarePublishLink {
  hostId: string
  activityId: string
  action: string
  targetName: string | null
  targetId: string | null
  atMs: number
}

/** The `siteCare` map on a Site Care ticket. */
export interface SiteCareRequest {
  source: SiteCareSource
  hostId: string | null
  requesterEmail: string | null
  state: 'open' | 'closed'
  /** The month the request counts in: opened, until it closes; then closed. */
  month: string
  timerStartedAtMs: number | null
  timerStartedByUid: string | null
  closedAtMs: number | null
  /** The one number staff entered at close, or the latest correction of it. */
  minutesLogged: number | null
  /** The timer's own minutes at close, unrounded, for the record. */
  timerMinutes: number | null
  countedMinutes: number
  includedMinutesUsed: number
  overMinutes: number
  billedHours: number
  absorbed: boolean
  approval: OwnerApprovalRecord | null
  charge: SiteCareCharge | null
  /** How many charges this request has ever started; keys each one. */
  chargeSeq: number
  publish: SiteCarePublishLink | null
}

/** Whether a value is a `YYYY-MM` month key. */
export function isSiteCareMonthKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)
}

/** The month an instant falls in, in Site Care's zone: `2026-10`. */
export function siteCareMonthKey(ms: number): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SITE_CARE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date(ms))
  const year = parts.find((part) => part.type === 'year')?.value ?? '1970'
  const month = parts.find((part) => part.type === 'month')?.value ?? '01'
  return `${year}-${month}`
}

/** The month before a month key. */
export function previousSiteCareMonthKey(key: string): string {
  const [year, month] = key.split('-').map(Number)
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`
}

/** "October 2026". */
export function siteCareMonthLabel(key: string): string {
  if (!isSiteCareMonthKey(key)) return key
  const [year, month] = key.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, 15)).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** The document id of an org's month: `{orgId}_{YYYY-MM}`, and the ticket field. */
export function siteCareOrgMonth(orgId: string, month: string): string {
  return `${orgId}_${month}`
}

/** "45 min", "1 h", "1 h 15 min". */
export function formatSiteCareMinutes(minutes: number): string {
  const total = Math.max(0, Math.round(Number(minutes) || 0))
  if (total < 60) return `${total} min`
  const hours = Math.floor(total / 60)
  const rest = total % 60
  return rest ? `${hours} h ${rest} min` : `${hours} h`
}

/** "$79", "$158.00" → always whole-dollar style when whole. */
export function formatSiteCareUsd(cents: number): string {
  const dollars = (Math.round(Number(cents) || 0) / 100)
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`
}

/**
 * The close's number from the timer: elapsed minutes rounded UP to the next
 * five, and never less than five — a request somebody opened and closed was
 * still a request worked.
 */
export function closeMinutesFromTimer(startedAtMs: number | null, nowMs: number): number {
  if (!startedAtMs || nowMs <= startedAtMs) return SITE_CARE_CLOSE_STEP_MINUTES
  const elapsed = (nowMs - startedAtMs) / 60_000
  const rounded = Math.ceil(elapsed / SITE_CARE_CLOSE_STEP_MINUTES) * SITE_CARE_CLOSE_STEP_MINUTES
  return Math.min(SITE_CARE_MAX_REQUEST_MINUTES, Math.max(SITE_CARE_CLOSE_STEP_MINUTES, rounded))
}

/** Staff's number read back, or null when it is not a usable count of minutes. */
export function readSiteCareMinutes(value: unknown): number | null {
  const minutes = Number(value)
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > SITE_CARE_MAX_REQUEST_MINUTES) {
    return null
  }
  return minutes
}

/** Minutes as they count against the included hour: whole blocks, rounded up. */
export function countedSiteCareMinutes(minutes: number): number {
  const value = Math.max(0, Number(minutes) || 0)
  return Math.ceil(value / SITE_CARE_INCLUDED_BLOCK_MINUTES) * SITE_CARE_INCLUDED_BLOCK_MINUTES
}

/** The month's included minutes: the hour plus goodwill. */
export function siteCareIncludedPool(goodwillMinutes: number): number {
  return SITE_CARE_INCLUDED_MINUTES + Math.max(0, Math.floor(Number(goodwillMinutes) || 0))
}

export interface SiteCareAllocation {
  countedMinutes: number
  includedMinutesUsed: number
  overMinutes: number
  /** Whole hours the over-time needs, rounded up; 0 when within the hour. */
  requiredHours: number
  /** Included minutes the month had left before this request. */
  remainingBefore: number
}

/**
 * One request's minutes against what the month's OTHER closed requests left
 * of the included pool.
 */
export function allocateSiteCareMinutes(input: {
  minutes: number
  otherIncludedUsed: number
  goodwillMinutes: number
}): SiteCareAllocation {
  const countedMinutes = countedSiteCareMinutes(input.minutes)
  const remainingBefore = Math.max(
    0,
    siteCareIncludedPool(input.goodwillMinutes) - Math.max(0, input.otherIncludedUsed),
  )
  const includedMinutesUsed = Math.min(countedMinutes, remainingBefore)
  const overMinutes = countedMinutes - includedMinutesUsed
  return {
    countedMinutes,
    includedMinutesUsed,
    overMinutes,
    requiredHours: overMinutes > 0 ? Math.ceil(overMinutes / 60) : 0,
    remainingBefore,
  }
}

export type SiteCareCloseVerdict =
  | { ok: true; billedHours: number; absorbed: boolean }
  | {
      ok: false
      /** No approval on file, or one for fewer hours than the work took. */
      reason: 'no-approval' | 'approval-exceeded'
      requiredHours: number
      approvedHours: number | null
    }

/**
 * What a close (or a correction) may do with a request's extra time.
 *
 * Within the hour nothing bills. Past it, `absorb` closes with no charge;
 * otherwise an approval must cover the whole hours needed, and the bill is
 * the larger of those and the approved hours — the approved amount is the
 * floor. Nothing bills without the owner's recorded yes.
 */
export function siteCareCloseVerdict(input: {
  requiredHours: number
  approval: Pick<OwnerApprovalRecord, 'hours'> | null
  absorb: boolean
}): SiteCareCloseVerdict {
  if (input.requiredHours <= 0) return { ok: true, billedHours: 0, absorbed: false }
  if (input.absorb) return { ok: true, billedHours: 0, absorbed: true }
  if (!input.approval) {
    return {
      ok: false,
      reason: 'no-approval',
      requiredHours: input.requiredHours,
      approvedHours: null,
    }
  }
  if (input.approval.hours < input.requiredHours) {
    return {
      ok: false,
      reason: 'approval-exceeded',
      requiredHours: input.requiredHours,
      approvedHours: input.approval.hours,
    }
  }
  return {
    ok: true,
    billedHours: Math.max(input.requiredHours, input.approval.hours),
    absorbed: false,
  }
}

/** Extra time in cents, before tax. */
export function siteCareExtraTimeCents(hours: number): number {
  return Math.max(0, Math.floor(hours)) * SITE_CARE_EXTRA_HOUR_USD * 100
}

/** One request as the month's statement counts it. */
export interface SiteCareStatementRequest {
  requestId: string
  title: string
  state: 'open' | 'closed'
  closedAtMs: number | null
  minutesLogged: number | null
  countedMinutes: number
  includedMinutesUsed: number
  overMinutes: number
  billedHours: number
  absorbed: boolean
  chargeStatus: SiteCareChargeStatus | null
  chargeCents: number
}

export interface SiteCareMonthStatement {
  month: string
  monthLabel: string
  includedMinutes: number
  goodwillMinutes: number
  poolMinutes: number
  requests: number
  openRequests: number
  minutesLogged: number
  countedMinutes: number
  includedMinutesUsed: number
  minutesLeft: number
  /** Hours on charges that still bill. */
  extraHoursBilled: number
  extraBilledCents: number
  /** Cents voided, credited or refunded. */
  extraReversedCents: number
}

/** A request's facts as the statement reads them, from the stored map. */
export function siteCareStatementRequest(
  requestId: string,
  title: string,
  request: Partial<SiteCareRequest> | null | undefined,
): SiteCareStatementRequest {
  const charge = request?.charge ?? null
  return {
    requestId,
    title,
    state: request?.state === 'closed' ? 'closed' : 'open',
    closedAtMs: request?.closedAtMs ?? null,
    minutesLogged: request?.minutesLogged ?? null,
    countedMinutes: Number(request?.countedMinutes) || 0,
    includedMinutesUsed: Number(request?.includedMinutesUsed) || 0,
    overMinutes: Number(request?.overMinutes) || 0,
    billedHours: Number(request?.billedHours) || 0,
    absorbed: request?.absorbed === true,
    chargeStatus: charge?.status ?? null,
    chargeCents: Number(charge?.amountCents) || 0,
  }
}

/** The month, summed. */
export function siteCareMonthStatement(input: {
  month: string
  requests: readonly SiteCareStatementRequest[]
  goodwillMinutes: number
}): SiteCareMonthStatement {
  const closed = input.requests.filter((request) => request.state === 'closed')
  const goodwillMinutes = Math.max(0, Math.floor(Number(input.goodwillMinutes) || 0))
  const poolMinutes = siteCareIncludedPool(goodwillMinutes)
  const includedMinutesUsed = closed.reduce((sum, r) => sum + r.includedMinutesUsed, 0)
  const live = closed.filter(
    (r) => r.chargeStatus !== null && SITE_CARE_LIVE_CHARGE_STATUSES.includes(r.chargeStatus),
  )
  const reversed = closed.filter(
    (r) => r.chargeStatus === 'voided' || r.chargeStatus === 'credited' || r.chargeStatus === 'refunded',
  )
  return {
    month: input.month,
    monthLabel: siteCareMonthLabel(input.month),
    includedMinutes: SITE_CARE_INCLUDED_MINUTES,
    goodwillMinutes,
    poolMinutes,
    requests: input.requests.length,
    openRequests: input.requests.length - closed.length,
    minutesLogged: closed.reduce((sum, r) => sum + (r.minutesLogged ?? 0), 0),
    countedMinutes: closed.reduce((sum, r) => sum + r.countedMinutes, 0),
    includedMinutesUsed,
    minutesLeft: Math.max(0, poolMinutes - includedMinutesUsed),
    extraHoursBilled: live.reduce((sum, r) => sum + r.billedHours, 0),
    extraBilledCents: live.reduce((sum, r) => sum + r.chargeCents, 0),
    extraReversedCents: reversed.reduce((sum, r) => sum + r.chargeCents, 0),
  }
}

/** The month's totals in one line, as the statement and the invoice line say them. */
export function siteCareMonthSentence(statement: SiteCareMonthStatement): string {
  const requests = `${statement.requests} ${statement.requests === 1 ? 'request' : 'requests'}`
  return (
    `${statement.monthLabel}: ${requests}, ${formatSiteCareMinutes(statement.minutesLogged)} of work, ` +
    `${statement.includedMinutesUsed} of ${statement.poolMinutes} included minutes used` +
    (statement.extraHoursBilled > 0
      ? `, ${describeHours(statement.extraHoursBilled)} of extra time billed`
      : '') +
    '.'
  )
}

/**
 * The extra-time invoice line's description: the request, its minutes, the
 * hours billed and why, and the month's statement — what the owner reads on
 * the invoice, and what the reconciliation compares Stripe's copy against.
 */
export function siteCareExtraTimeDescription(input: {
  title: string
  minutesLogged: number
  overMinutes: number
  billedHours: number
  approvedHours: number | null
  statement: SiteCareMonthStatement
}): string {
  const title = input.title.length > 80 ? `${input.title.slice(0, 79)}…` : input.title
  const approved =
    input.approvedHours && input.approvedHours > Math.ceil(input.overMinutes / 60)
      ? ` (the ${describeHours(input.approvedHours)} you approved)`
      : ''
  const line =
    `Site Care extra time — “${title}”: ${formatSiteCareMinutes(input.minutesLogged)} of work, ` +
    `${formatSiteCareMinutes(input.overMinutes)} past the included hour, billed as ` +
    `${describeHours(input.billedHours)}${approved} at $${SITE_CARE_EXTRA_HOUR_USD}/hour. ` +
    siteCareMonthSentence(input.statement)
  return line.length > SITE_CARE_LINE_DESCRIPTION_MAX
    ? `${line.slice(0, SITE_CARE_LINE_DESCRIPTION_MAX - 1)}…`
    : line
}

/** A charge's standing in the owner's words. */
export function siteCareChargeWords(status: SiteCareChargeStatus | null): string {
  switch (status) {
    case 'creating':
    case 'pending':
      return 'On your next invoice'
    case 'failed':
      return 'Not billed'
    case 'voided':
      return 'Removed, not billed'
    case 'credited':
      return 'Credited back'
    case 'refunded':
      return 'Refunded'
    default:
      return 'Included'
  }
}

/** Whether a site activity row is a publish a request can be linked to. */
export function isSiteCarePublishAction(action: unknown): boolean {
  return typeof action === 'string' && /^published\b/i.test(action.trim())
}

/** A publish link as a sentence: "Published “Home” on Oct 19, 2026, 3:04 PM". */
export function siteCarePublishSentence(
  publish: SiteCarePublishLink | null,
  formatDate: (ms: number) => string,
): string | null {
  if (!publish) return null
  const what = publish.targetName ? ` “${publish.targetName}”` : ''
  return `${publish.action}${what} on ${formatDate(publish.atMs)}`
}

/** A date as the owner's emails and statement write it, in Site Care's zone. */
export function formatSiteCareDate(ms: number): string {
  return new Date(ms).toLocaleString('en-US', {
    timeZone: SITE_CARE_TIME_ZONE,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  })
}

/**
 * The subcollection of a Site Care ticket that only staff read (AGL-4031):
 * `supportTickets/{id}/siteCareStaff/intake` holds the workspaces an emailed
 * request's sender belongs to. A workspace's own reads and exports of its
 * tickets leave it out.
 */
export const SITE_CARE_STAFF_COLLECTION = 'siteCareStaff'

/**
 * A Site Care workspace an emailed request could belong to (AGL-4031): the
 * sender is a member of it (as `uid`) and it has Site Care. A sender in
 * several such workspaces has every one recorded at intake, staff-only,
 * because which workspaces a person belongs to is theirs, not the filed
 * workspace's to read.
 */
export interface SiteCareWorkspaceCandidate {
  orgId: string
  /** The workspace's name when the request came in. */
  name: string
  /** The sender's account in that workspace. */
  uid: string
}

/** Recorded candidates read back, malformed entries dropped, one per workspace. */
export function readSiteCareCandidates(value: unknown): SiteCareWorkspaceCandidate[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  const candidates: SiteCareWorkspaceCandidate[] = []
  for (const entry of value) {
    const orgId = typeof entry?.orgId === 'string' ? entry.orgId : ''
    const uid = typeof entry?.uid === 'string' ? entry.uid : ''
    if (!orgId || !uid || seen.has(orgId)) continue
    seen.add(orgId)
    candidates.push({ orgId, uid, name: typeof entry.name === 'string' && entry.name ? entry.name : orgId })
  }
  return candidates
}

/** The candidates other than the workspace the request is on now. */
export function otherSiteCareCandidates(
  candidates: readonly SiteCareWorkspaceCandidate[],
  orgId: string,
): SiteCareWorkspaceCandidate[] {
  return candidates.filter((candidate) => candidate.orgId !== orgId)
}

/** "Also a member of: Acme Builders, Acme Rentals". */
export function siteCareCandidatesSentence(others: readonly SiteCareWorkspaceCandidate[]): string | null {
  return others.length ? `Also a member of: ${others.map((candidate) => candidate.name).join(', ')}` : null
}

/**
 * Why a request may not move to another workspace, or null when it may.
 * Only an open request with nothing billed against its workspace moves: a
 * finished one has counted its minutes against that workspace's month, a
 * charge was billed to its Stripe customer, and an owner's approval was
 * given for it. The server enforces the same rules.
 */
export function siteCareMoveBlockedReason(
  request: Pick<SiteCareRequest, 'state' | 'charge' | 'chargeSeq' | 'approval'>,
  others: readonly SiteCareWorkspaceCandidate[],
): string | null {
  if (request.state === 'closed') {
    return 'This request is finished, so it stays on the workspace its time counted against.'
  }
  if (request.charge || request.chargeSeq > 0) {
    return 'Extra time has been charged on this request, so it stays on the workspace that was billed.'
  }
  if (request.approval) {
    return 'An owner’s approval of extra time is recorded on this request, so it stays on that workspace.'
  }
  if (!others.length) return 'The sender is not a member of another workspace with Site Care.'
  return null
}
