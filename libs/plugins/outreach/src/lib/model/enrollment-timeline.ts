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
 * EVERYTHING THAT HAPPENED TO ONE PERSON IN ONE SEQUENCE (AGL-3332).
 *
 * The enrollment's detail view is one list, newest first, and this builds
 * it from what is stored — the enrollment itself, and its history rows —
 * without inventing anything that is not:
 *
 * - **Each send** is a step record: the step, the time, the subject as
 *   sent, and whether it went out as the person's curated copy.
 * - **Each click** is a history row: the destination, the step whose email
 *   carried it, and a person's or a scanner's. Clicks from before the
 *   history began exist only as totals, and are ONE row saying so — never
 *   a row per click, which would be a fabrication with a timestamp on it.
 * - **Each member's act** — pause, resume, stop, do-not-contact — is a
 *   history row with who and why. An enrollment holds only its current
 *   stop, so the row is the only record of a pause that was resumed.
 * - **The current stop** — a reply, a bounce, an opt-out, a hold — comes
 *   from the enrollment's own fields, with its full reason, unless a
 *   history row already says it.
 * - **The gateway hold** (AGL-3326), and its release.
 * - **The enrollment**, with who enrolled them, and each curated step.
 *
 * Client-safe and free of React: the view renders these entries, and the
 * spec reads them.
 *=========================================*/

import type { OutreachClickMachineReason } from '../engine/click-tracking'
import { OUTREACH_MAIL_GATEWAY_LABELS, type OutreachMailGateway } from '../engine/mail-gateway'
import { outreachClickSummary } from './enrollment-engagement'
import {
  OUTREACH_ENROLLMENT_HISTORY_MAX,
  OUTREACH_TASK_KIND_LABELS,
  type OutreachEnrollment,
  type OutreachEnrollmentHistoryEntry,
  type OutreachHistoryAction,
  type OutreachSequenceStep,
  type OutreachStepRecord,
} from './outreach.types'

/** What kind of thing an entry is, which the view draws an icon for. */
export type OutreachTimelineKind =
  | 'enrolled'
  | 'curated'
  | 'sent'
  | 'task'
  | 'click'
  | 'scanner'
  | 'earlier-clicks'
  | 'paused'
  | 'resumed'
  | 'stopped'
  | 'do-not-contact'
  | 'replied'
  | 'bounced'
  | 'opted-out'
  | 'held'
  | 'released'
  | 'failed'
  | 'finished'

/** How loudly the view draws an entry. */
export type OutreachTimelineTone = 'default' | 'success' | 'info' | 'warning' | 'error'

/** One line of the timeline. */
export interface OutreachTimelineEntry {
  /** Stable across renders, for React and for a spec. */
  key: string
  kind: OutreachTimelineKind
  atMs: number
  /** What happened, in a few words. */
  title: string
  /** The one fact that matters most, shown in full: a subject, a reason, a diagnostic. */
  detail?: string | null
  /** The rest, each short: the step, who, a scanner's reason. */
  facts: string[]
  /** A destination the person followed, shown whole and linkable. */
  url?: string | null
  /** What `url` is, when it is not simply "the link they followed". */
  urlLabel?: string
  /** The Gmail thread this entry opened, for an "Open in Gmail" link. */
  gmailThreadId?: string | null
  tone: OutreachTimelineTone
}

export interface OutreachTimelineInput {
  enrollment: OutreachEnrollment
  steps: readonly OutreachSequenceStep[]
  /** The history rows, newest or oldest first; `null` while unread or unreadable. */
  history: readonly OutreachEnrollmentHistoryEntry[] | null
  /** A member's name for a stored uid; the uid itself when the roster does not know it. */
  memberName: (uid: string) => string
  /** A moment as the reader reads it — in the mailbox's zone. */
  formatTime: (ms: number) => string
  /** The mail gateway in front of the person's domain, when it is known. */
  gateway?: OutreachMailGateway | null
}

/** "Email 2 · step 3" for an email step, "Step 2 · Call" for a task, "Step 4" for one the sequence no longer has. */
export function outreachStepName(steps: readonly OutreachSequenceStep[], stepIndex: number): string {
  const step = steps[stepIndex]
  if (step?.kind === 'email') {
    const position = steps.slice(0, stepIndex + 1).filter((entry) => entry.kind === 'email').length
    return `Email ${position} · step ${stepIndex + 1}`
  }
  if (step?.kind === 'task') return `Step ${stepIndex + 1} · ${OUTREACH_TASK_KIND_LABELS[step.taskKind]}`
  return `Step ${stepIndex + 1}`
}

/** Why a click was read as a scanner's, as the timeline says it. */
export const OUTREACH_MACHINE_REASON_LABELS: Record<OutreachClickMachineReason, string> = {
  agent: 'the request named itself as a scanner or a link preview',
  too_soon: 'it came within 30 seconds of the email arriving, faster than anyone reads',
  method: 'it checked the link without opening the page',
}

const ACTION_TITLES: Record<OutreachHistoryAction, string> = {
  pause: 'Paused',
  resume: 'Resumed',
  stop: 'Stopped by a member',
  do_not_contact: 'Marked do-not-contact',
}
const ACTION_KINDS: Record<OutreachHistoryAction, OutreachTimelineKind> = {
  pause: 'paused',
  resume: 'resumed',
  stop: 'stopped',
  do_not_contact: 'do-not-contact',
}

/** Which of two entries at the same moment reads first: the outcome above what led to it. */
const TIE_ORDER: Record<OutreachTimelineKind, number> = {
  finished: 0,
  replied: 1,
  bounced: 1,
  'opted-out': 1,
  failed: 1,
  stopped: 2,
  'do-not-contact': 2,
  paused: 2,
  held: 2,
  released: 3,
  resumed: 3,
  click: 4,
  scanner: 4,
  'earlier-clicks': 4,
  task: 5,
  sent: 5,
  curated: 6,
  enrolled: 7,
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`
const byWhom = (uid: string | null | undefined, memberName: (uid: string) => string) =>
  uid ? `By ${memberName(uid)}` : null

/** The step records that are emails, in the order they went. */
function emailRecords(enrollment: OutreachEnrollment): OutreachStepRecord[] {
  return (enrollment.stepRecords ?? []).filter((record) => record?.kind === 'email')
}

/**
 * The timeline, newest first — see the module note.
 */
export function outreachEnrollmentTimeline(input: OutreachTimelineInput): OutreachTimelineEntry[] {
  const { enrollment, steps, memberName } = input
  const entries: OutreachTimelineEntry[] = []
  const history = input.history ?? []
  const gatewayName = input.gateway ? OUTREACH_MAIL_GATEWAY_LABELS[input.gateway] : null

  // ── The enrollment ──────────────────────────────────────────────────────
  if (enrollment.createdAtMs) {
    entries.push({
      key: 'enrolled',
      kind: 'enrolled',
      atMs: enrollment.createdAtMs,
      title: 'Enrolled',
      facts: [
        byWhom(enrollment.enrolledByUid, memberName),
        enrollment.target === 'lead' ? 'As a lead' : 'As a contact',
        enrollment.cold ? 'Cold — confirmed by the member who enrolled them' : null,
      ].filter((fact): fact is string => Boolean(fact)),
      tone: 'default',
    })
  }

  // ── Curated copies (AGL-3324) ───────────────────────────────────────────
  for (const [key, override] of Object.entries(enrollment.stepOverrides ?? {})) {
    if (!override.draftedAtMs) continue
    entries.push({
      key: `curated-${key}`,
      kind: 'curated',
      atMs: override.draftedAtMs,
      title: `Curated ${outreachStepName(steps, Number(key))}`,
      facts: [
        override.source === 'ai' ? (override.edited ? 'AI draft, edited' : 'AI draft') : 'Written by a member',
        byWhom(override.draftedByUid, memberName),
      ].filter((fact): fact is string => Boolean(fact)),
      tone: 'default',
    })
  }

  // ── Sends and tasks ─────────────────────────────────────────────────────
  let previousThread: string | null = null
  ;(enrollment.stepRecords ?? []).forEach((record, index) => {
    if (!record || typeof record.atMs !== 'number') return
    if (record.kind === 'task') {
      const step = steps.find((entry) => entry.id === record.stepId) ?? steps[record.stepIndex]
      entries.push({
        key: `task-${index}`,
        kind: 'task',
        atMs: record.atMs,
        title:
          step?.kind === 'task'
            ? `${OUTREACH_TASK_KIND_LABELS[step.taskKind]} task filed`
            : 'Task filed',
        detail: step?.kind === 'task' ? step.title : null,
        facts: [
          outreachStepName(steps, record.stepIndex),
          record.taskId === null ? 'The CRM could not file it' : null,
        ].filter((fact): fact is string => Boolean(fact)),
        tone: 'default',
      })
      return
    }
    const thread = record.gmailThreadId ?? null
    // The link to Gmail sits on the email that STARTED a thread, once.
    const startsThread = Boolean(thread) && thread !== previousThread
    previousThread = thread ?? previousThread
    entries.push({
      key: `sent-${index}`,
      kind: 'sent',
      atMs: record.atMs,
      title: `${outreachStepName(steps, record.stepIndex)} sent`,
      detail: record.subject ? `Subject: ${record.subject}` : null,
      facts: [
        record.curated === 'ai'
          ? 'Curated copy — AI draft'
          : record.curated === 'member'
            ? 'Curated copy — written by a member'
            : null,
        record.links?.length ? plural(record.links.length, 'tracked link', 'tracked links') : null,
      ].filter((fact): fact is string => Boolean(fact)),
      gmailThreadId: startsThread ? thread : null,
      tone: 'default',
    })
  })

  // ── Clicks ──────────────────────────────────────────────────────────────
  for (const row of history) {
    if (row.kind !== 'click') continue
    entries.push(
      row.human
        ? {
            key: `history-${row.id}`,
            kind: 'click',
            atMs: row.atMs,
            title: 'Clicked a link',
            url: row.url,
            facts: [`From ${outreachStepName(steps, row.stepIndex)}`],
            tone: 'success',
          }
        : {
            key: `history-${row.id}`,
            kind: 'scanner',
            atMs: row.atMs,
            title: 'A scanner followed a link — not counted',
            url: row.url,
            facts: [
              `From ${outreachStepName(steps, row.stepIndex)}`,
              row.machineReason ? `Read as a scanner: ${OUTREACH_MACHINE_REASON_LABELS[row.machineReason]}` : null,
            ].filter((fact): fact is string => Boolean(fact)),
            tone: 'default',
          },
    )
  }

  /*
   * Clicks with no row of their own: counted before the per-click history
   * began, or past its limit. ONE entry, placed at the first of them when
   * that is known, saying what the totals hold and nothing more.
   */
  const clicks = outreachClickSummary(enrollment.engagement)
  const engagement = enrollment.engagement
  if (clicks.unloggedClicks > 0 || clicks.unloggedMachineClicks > 0) {
    const everyHumanUnlogged = clicks.unloggedClicks === clicks.clicks
    const loggedRows = clicks.clicks - clicks.unloggedClicks + (clicks.machineClicks - clicks.unloggedMachineClicks)
    const facts: string[] = []
    const first = engagement?.firstClickAtMs ?? null
    const last = engagement?.lastClickAtMs ?? null
    if (clicks.unloggedClicks > 0 && first !== null && everyHumanUnlogged && last !== null) {
      facts.push(
        clicks.unloggedClicks === 1
          ? `At ${input.formatTime(first)}`
          : first === last
            ? `First and last at ${input.formatTime(first)}`
            : `First at ${input.formatTime(first)}, last at ${input.formatTime(last)}`,
      )
    } else if (clicks.unloggedClicks > 0 && first !== null) {
      // Later clicks have rows of their own, so only the first is one of these.
      facts.push(`First at ${input.formatTime(first)}`)
    }
    if (clicks.unloggedMachineClicks > 0) {
      facts.push(plural(clicks.unloggedMachineClicks, 'scanner click, not counted', 'scanner clicks, not counted'))
    }
    entries.push({
      key: 'earlier-clicks',
      kind: 'earlier-clicks',
      atMs:
        (clicks.unloggedClicks > 0 ? engagement?.firstClickAtMs : null) ??
        engagement?.lastClickAtMs ??
        emailRecords(enrollment)[0]?.atMs ??
        enrollment.createdAtMs,
      title:
        clicks.unloggedClicks > 0
          ? `${plural(clicks.unloggedClicks, 'earlier click', 'earlier clicks')}, kept as a total`
          : `${plural(clicks.unloggedMachineClicks, 'earlier scanner click', 'earlier scanner clicks')}, kept as a total`,
      detail:
        loggedRows >= OUTREACH_ENROLLMENT_HISTORY_MAX
          ? `Each click is listed on its own up to ${OUTREACH_ENROLLMENT_HISTORY_MAX}; these came before per-click history began, or after this person reached that limit.`
          : 'These came before each click was recorded on its own, so only their count and times were kept.',
      // The last destination is theirs only when every counted click was.
      url: clicks.unloggedClicks > 0 && everyHumanUnlogged ? (engagement?.lastClickUrl ?? null) : null,
      urlLabel: clicks.unloggedClicks === 1 ? 'Link' : 'Last link',
      facts,
      tone: clicks.unloggedClicks > 0 ? 'success' : 'default',
    })
  }

  // ── Members' acts ───────────────────────────────────────────────────────
  const actionTimes = new Set<number>()
  for (const row of history) {
    if (row.kind !== 'action') continue
    actionTimes.add(row.atMs)
    const released =
      row.action === 'resume' && enrollment.gatewayHold?.releasedAtMs === row.atMs
    if (released) continue
    entries.push({
      key: `history-${row.id}`,
      kind: ACTION_KINDS[row.action],
      atMs: row.atMs,
      title: ACTION_TITLES[row.action],
      detail: row.detail,
      facts: [byWhom(row.byUid, memberName)].filter((fact): fact is string => Boolean(fact)),
      tone: row.action === 'resume' ? 'default' : row.action === 'pause' ? 'warning' : 'default',
    })
  }

  // ── The gateway hold (AGL-3326) ─────────────────────────────────────────
  const hold = enrollment.gatewayHold
  const holdGateway = hold ? OUTREACH_MAIL_GATEWAY_LABELS[hold.gateway] : null
  if (hold?.heldAtMs) {
    entries.push({
      key: 'held',
      kind: 'held',
      atMs: hold.heldAtMs,
      title: `Held — ${holdGateway} refused this sender`,
      detail:
        enrollment.stopReason === 'gateway_blocked_here' && enrollment.stoppedAtMs === hold.heldAtMs
          ? enrollment.stopDetail
          : null,
      facts: ['Nothing was sent to them while it was held'],
      tone: 'warning',
    })
  }
  if (hold?.releasedAtMs) {
    entries.push({
      key: 'released',
      kind: 'released',
      atMs: hold.releasedAtMs,
      title: hold.heldAtMs
        ? `Resumed past the ${holdGateway} hold — sent anyway`
        : `Enrolled past the ${holdGateway} warning`,
      facts: [byWhom(hold.releasedByUid, memberName)].filter((fact): fact is string => Boolean(fact)),
      tone: 'default',
    })
  }

  // ── The current stop, from the enrollment ───────────────────────────────
  const stoppedAtMs = enrollment.stoppedAtMs
  const alreadySaid =
    stoppedAtMs !== null &&
    (actionTimes.has(stoppedAtMs) ||
      (enrollment.stopReason === 'gateway_blocked_here' && hold?.heldAtMs === stoppedAtMs))
  if (stoppedAtMs && !alreadySaid && enrollment.status !== 'active' && enrollment.status !== 'finished') {
    const stop = currentStop(enrollment, memberName, gatewayName)
    if (stop) entries.push({ key: 'stop', atMs: stoppedAtMs, ...stop })
  }

  // ── Finished ────────────────────────────────────────────────────────────
  if (enrollment.status === 'finished') {
    const last = (enrollment.stepRecords ?? []).at(-1)
    entries.push({
      key: 'finished',
      kind: 'finished',
      atMs: last?.atMs ?? enrollment.updatedAtMs,
      title: 'Finished — every step ran',
      facts: [],
      tone: 'success',
    })
  }

  return entries.sort((a, b) => b.atMs - a.atMs || TIE_ORDER[a.kind] - TIE_ORDER[b.kind])
}

/** The entry for the stop the enrollment is in now. */
function currentStop(
  enrollment: OutreachEnrollment,
  memberName: (uid: string) => string,
  gatewayName: string | null,
): Omit<OutreachTimelineEntry, 'key' | 'atMs'> | null {
  const detail = enrollment.stopDetail
  const by = byWhom(enrollment.stoppedByUid, memberName)
  const facts = (...values: Array<string | null>) => values.filter((fact): fact is string => Boolean(fact))
  switch (enrollment.stopReason) {
    case 'reply':
      return {
        kind: 'replied',
        title: 'Replied',
        detail,
        facts: ['The sequence stopped for them'],
        gmailThreadId: enrollment.gmailThreadId ?? enrollment.gmailThreadIds.at(-1) ?? null,
        tone: 'info',
      }
    case 'hard_bounce':
      return {
        kind: 'bounced',
        title: 'Bounced',
        detail,
        facts: facts(gatewayName ? `Their mail gateway: ${gatewayName}` : null, 'The address is on the do-not-contact list'),
        tone: 'error',
      }
    case 'opt_out_reply':
      return { kind: 'opted-out', title: 'Asked not to be emailed, in a reply', detail, facts: [], tone: 'warning' }
    case 'unsubscribe':
      return { kind: 'opted-out', title: 'Unsubscribed', detail, facts: [], tone: 'warning' }
    case 'do_not_contact':
      return { kind: 'do-not-contact', title: 'Put on the do-not-contact list', detail, facts: facts(by), tone: 'warning' }
    case 'manual':
      return enrollment.status === 'paused'
        ? { kind: 'paused', title: 'Paused', detail, facts: facts(by), tone: 'warning' }
        : { kind: 'stopped', title: 'Stopped by a member', detail, facts: facts(by), tone: 'default' }
    case 'gate':
      return { kind: 'stopped', title: 'Stopped — no longer eligible', detail, facts: [], tone: 'default' }
    case 'sequence_archived':
      return { kind: 'stopped', title: 'Stopped — the sequence was archived', detail, facts: [], tone: 'default' }
    case 'gateway_blocked_here':
      return { kind: 'held', title: 'Held — their mail gateway refused this sender', detail, facts: [], tone: 'warning' }
    case 'send_failed':
      return { kind: 'failed', title: 'An email couldn’t be sent', detail, facts: [], tone: 'error' }
    default:
      return null
  }
}

/** The five figures above the timeline. */
export interface OutreachEnrollmentFigures {
  emailsSent: number
  clicks: number
  /** Distinct destinations followed; `atLeast` when only a floor is known. */
  linksFollowed: { count: number; atLeast: boolean }
  scannerClicks: number
  replies: number
  /** Whether anything has happened to them beyond being enrolled. */
  anything: boolean
}

export function outreachEnrollmentFigures(enrollment: OutreachEnrollment): OutreachEnrollmentFigures {
  const clicks = outreachClickSummary(enrollment.engagement)
  const emailsSent = emailRecords(enrollment).length
  const replies =
    enrollment.status === 'replied' || enrollment.stopReason === 'reply' || enrollment.stopReason === 'opt_out_reply'
      ? 1
      : 0
  return {
    emailsSent,
    clicks: clicks.clicks,
    linksFollowed:
      clicks.linkCount === null
        ? { count: clicks.followed.length, atLeast: true }
        : { count: clicks.linkCount, atLeast: clicks.linksCapped },
    scannerClicks: clicks.machineClicks,
    replies,
    anything:
      emailsSent > 0 ||
      (enrollment.stepRecords ?? []).length > 0 ||
      clicks.clicks > 0 ||
      clicks.machineClicks > 0 ||
      enrollment.stoppedAtMs !== null,
  }
}
