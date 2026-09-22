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
 * ONE PERSON'S RUN THROUGH A SEQUENCE (AGL-2979).
 *
 * ## The state machine
 *
 *   active ──► paused ──► active
 *     │          │
 *     ├──────────┴──► replied · bounced · opted_out · stopped
 *     └─► finished · failed
 *
 * An enrollment sends only while `active`. Everything that ends the sending
 * records why (`stopReason`, `stopDetail`, when, and who). Ending the
 * sending does not end what can still be learned from the thread: a reply,
 * a bounce or an opt-out that arrives after the last step, after a member
 * stopped it or after a send failed is still recorded, and a person who
 * replied and then asked to be left alone moves on to `opted_out` — an
 * opt-out is the one fact every later sequence has to be able to find.
 * `bounced` and `opted_out` are final.
 *
 * Every function returns a PATCH — the fields to write — and never the
 * whole document, so a writer applies it with its own SDK and its own
 * timestamps.
 *==========================================*/

import {
  OUTREACH_ATTESTATION_KINDS,
  OUTREACH_STOP_REASONS_BY_STATUS,
  type OutreachAttestationKind,
  type OutreachAttestations,
  type OutreachEnrollment,
  type OutreachEnrollmentStatus,
  type OutreachEnrollmentTarget,
  type OutreachMailbox,
  type OutreachSequence,
  type OutreachStopReason,
} from '../model/outreach.types'
import { normalizeCampaignIds } from '@aglyn/aglyn/app-utils/campaign-membership'
import { normalizeOutreachPersonalLine } from './gates'
import { effectiveOutreachWindow, type OutreachRandom, scheduleOutreachDue } from './schedule'
import { isInThreadEmailStep } from './sequence-validation'

/** Where each status may go next. */
export const OUTREACH_ENROLLMENT_TRANSITIONS: Readonly<
  Record<OutreachEnrollmentStatus, readonly OutreachEnrollmentStatus[]>
> = {
  active: ['paused', 'finished', 'replied', 'bounced', 'opted_out', 'stopped', 'failed'],
  paused: ['active', 'replied', 'bounced', 'opted_out', 'stopped'],
  finished: ['replied', 'bounced', 'opted_out'],
  stopped: ['replied', 'bounced', 'opted_out'],
  failed: ['replied', 'bounced', 'opted_out'],
  replied: ['opted_out'],
  bounced: [],
  opted_out: [],
}

export function canTransitionOutreachEnrollment(
  from: OutreachEnrollmentStatus,
  to: OutreachEnrollmentStatus,
): boolean {
  return OUTREACH_ENROLLMENT_TRANSITIONS[from]?.includes(to) === true
}

/** Something that happened to an enrollment. `atMs` is when it happened. */
export type OutreachEnrollmentEvent =
  | { type: 'pause'; atMs: number; byUid: string | null; detail?: string | null }
  | { type: 'resume'; atMs: number; byUid: string | null }
  | {
      type: 'stop'
      atMs: number
      byUid: string | null
      reason?: Extract<OutreachStopReason, 'manual' | 'gate' | 'sequence_archived'>
      detail?: string | null
    }
  | { type: 'reply'; atMs: number; detail?: string | null }
  | {
      type: 'opt_out'
      atMs: number
      reason: Extract<OutreachStopReason, 'opt_out_reply' | 'unsubscribe' | 'do_not_contact'>
      detail?: string | null
    }
  | { type: 'bounce'; atMs: number; detail?: string | null }
  | { type: 'send_failed'; atMs: number; detail?: string | null }

/** The status fields an event writes. */
export interface OutreachEnrollmentStatusPatch {
  status: OutreachEnrollmentStatus
  stopReason: OutreachStopReason | null
  stopDetail: string | null
  stoppedAtMs: number | null
  stoppedByUid: string | null
  nextDueAtMs: number | null
}

/**
 * `patch` is what to write, or `null` when there is nothing to write — the
 * enrollment is already there, or the event is not allowed, in which case
 * `error` says why.
 */
export interface OutreachEnrollmentEventResult {
  patch: OutreachEnrollmentStatusPatch | null
  error: string | null
}

const STATUS_WORDS: Record<OutreachEnrollmentStatus, string> = {
  active: 'is active',
  paused: 'is paused',
  finished: 'finished',
  replied: 'got a reply',
  bounced: 'bounced',
  opted_out: 'opted out',
  stopped: 'was stopped',
  failed: 'failed',
}

const EVENT_TARGET: Record<OutreachEnrollmentEvent['type'], OutreachEnrollmentStatus> = {
  pause: 'paused',
  resume: 'active',
  stop: 'stopped',
  reply: 'replied',
  opt_out: 'opted_out',
  bounce: 'bounced',
  send_failed: 'failed',
}

const detailOf = (value: unknown): string | null => {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  return text ? text.slice(0, 500) : null
}

/** What an event does to an enrollment's status — see the module note. */
export function applyOutreachEnrollmentEvent(
  enrollment: Pick<OutreachEnrollment, 'status' | 'nextDueAtMs'>,
  event: OutreachEnrollmentEvent,
): OutreachEnrollmentEventResult {
  const from = enrollment.status
  const to = EVENT_TARGET[event.type]
  if (!to) return { patch: null, error: 'That is not something that happens to an enrollment.' }
  if (from === to) return { patch: null, error: null }
  if (!canTransitionOutreachEnrollment(from, to)) {
    return {
      patch: null,
      error: `This enrollment ${STATUS_WORDS[from]}, so it can't be marked as one that ${STATUS_WORDS[to]}.`,
    }
  }
  if (event.type === 'resume') {
    return {
      patch: {
        status: 'active',
        stopReason: null,
        stopDetail: null,
        stoppedAtMs: null,
        stoppedByUid: null,
        nextDueAtMs: enrollment.nextDueAtMs,
      },
      error: null,
    }
  }
  const reason: OutreachStopReason =
    event.type === 'pause'
      ? 'manual'
      : event.type === 'stop'
        ? (event.reason ?? 'manual')
        : event.type === 'reply'
          ? 'reply'
          : event.type === 'opt_out'
            ? event.reason
            : event.type === 'bounce'
              ? 'hard_bounce'
              : 'send_failed'
  const allowed = OUTREACH_STOP_REASONS_BY_STATUS[to as keyof typeof OUTREACH_STOP_REASONS_BY_STATUS]
  if (!allowed?.includes(reason)) {
    return { patch: null, error: `"${reason}" isn't a reason an enrollment ${STATUS_WORDS[to]}.` }
  }
  const byUid = 'byUid' in event && typeof event.byUid === 'string' && event.byUid ? event.byUid : null
  return {
    patch: {
      status: to,
      stopReason: reason,
      stopDetail: detailOf(event.detail),
      stoppedAtMs: event.atMs,
      stoppedByUid: byUid,
      // A paused enrollment keeps its place, so resuming it picks up where it
      // stopped; every other status has nothing left waiting.
      nextDueAtMs: to === 'paused' ? enrollment.nextDueAtMs : null,
    },
    error: null,
  }
}

type ScheduleMailbox = Pick<OutreachMailbox, 'timezone' | 'window'>
type ScheduleSequence = Pick<OutreachSequence, 'steps' | 'settings'>

/** When a new enrollment's first step comes due, or `null` when it cannot be placed. */
export function planOutreachFirstDue(input: {
  sequence: ScheduleSequence
  mailbox: ScheduleMailbox
  enrolledAtMs: number
  random: OutreachRandom
}): number | null {
  const first = input.sequence.steps?.[0]
  if (!first) return null
  return scheduleOutreachDue({
    fromMs: input.enrolledAtMs,
    delayBusinessDays: first.delayBusinessDays,
    timeZone: input.mailbox.timezone,
    window: effectiveOutreachWindow(input.sequence.settings?.window, input.mailbox.window),
    random: input.random,
  })
}

/** Stamps the attestations a rep ticked with who ticked them and when; unknown kinds are dropped. */
export function outreachAttestationsFrom(
  kinds: readonly unknown[],
  uid: string,
  atMs: number,
): OutreachAttestations {
  const attestations: OutreachAttestations = {}
  for (const kind of kinds ?? []) {
    if ((OUTREACH_ATTESTATION_KINDS as readonly unknown[]).includes(kind)) {
      attestations[kind as OutreachAttestationKind] = { uid, atMs }
    }
  }
  return attestations
}

export interface OutreachEnrollmentDraft {
  id: string
  sequence: Pick<OutreachSequence, 'id' | 'hostId' | 'mailboxId' | 'steps' | 'settings' | 'campaignIds'>
  mailbox: ScheduleMailbox
  /** The record the person is (AGL-3234); a contact when absent. */
  target?: OutreachEnrollmentTarget
  /** The contact's id; `''` for a lead. */
  contactId: string
  /** The lead's person key, for an enrollment made on a lead. */
  leadId?: string | null
  /** The contact's name as the sending site knows it; `''` for none. */
  contactName?: string | null
  /** The address, as the gates normalized it. */
  email: string
  /** The gates' `cold`. */
  cold: boolean
  personalLine: string
  attestations: OutreachAttestations
  enrolledByUid: string
  nowMs: number
  random: OutreachRandom
}

/**
 * A new enrollment document, first step scheduled — one builder for every
 * door that enrolls, so an enrollment made from a contact and one made from
 * a list are the same shape. Call it after the gates allowed the person.
 */
export function buildOutreachEnrollment(draft: OutreachEnrollmentDraft): OutreachEnrollment {
  return {
    id: draft.id,
    sequenceId: draft.sequence.id,
    target: draft.target ?? 'contact',
    contactId: draft.contactId,
    leadId: draft.leadId ?? null,
    contactName: String(draft.contactName ?? '').replace(/\s+/g, ' ').trim().slice(0, 200),
    email: String(draft.email ?? '').trim().toLowerCase(),
    hostId: draft.sequence.hostId,
    mailboxId: draft.sequence.mailboxId,
    stepIndex: 0,
    nextDueAtMs: planOutreachFirstDue({
      sequence: draft.sequence,
      mailbox: draft.mailbox,
      enrolledAtMs: draft.nowMs,
      random: draft.random,
    }),
    status: 'active',
    stopReason: null,
    stopDetail: null,
    stoppedAtMs: null,
    stoppedByUid: null,
    personalLine: normalizeOutreachPersonalLine(draft.personalLine),
    cold: draft.cold === true,
    attestations: { ...(draft.attestations ?? {}) },
    enrolledByUid: draft.enrolledByUid,
    gmailThreadId: null,
    gmailThreadIds: [],
    threadSubject: null,
    messageIds: [],
    lastSentAtMs: null,
    // The sequence's campaigns as they stand now (AGL-3254): what this
    // enrollment's outcomes are credited to, whatever the sequence joins later.
    campaignIds: normalizeCampaignIds(draft.sequence.campaignIds),
    createdAtMs: draft.nowMs,
    updatedAtMs: draft.nowMs,
  }
}

/** What the provider reported for an email step that was sent. */
export interface OutreachSentEmail {
  /** The `Message-ID` header the message went out with, angle brackets included. */
  messageId: string
  /** The provider's thread id. */
  threadId: string
  /** The subject as sent. */
  subject: string
}

export interface OutreachStepCompletionInput {
  enrollment: Pick<
    OutreachEnrollment,
    'status' | 'stepIndex' | 'gmailThreadId' | 'gmailThreadIds' | 'messageIds' | 'threadSubject'
  >
  sequence: ScheduleSequence
  mailbox: ScheduleMailbox
  /** When the step ran. */
  completedAtMs: number
  /** For an email step, what was sent; not read for a task. */
  sent?: OutreachSentEmail | null
  random: OutreachRandom
}

/** The fields a completed step writes. */
export interface OutreachStepCompletionPatch {
  status: 'active' | 'finished'
  stepIndex: number
  nextDueAtMs: number | null
  lastSentAtMs: number
  gmailThreadId?: string
  gmailThreadIds?: string[]
  threadSubject?: string
  messageIds?: string[]
}

export interface OutreachStepCompletionResult {
  patch: OutreachStepCompletionPatch | null
  /**
   * Why there is no patch, or — beside one — that the next step could not
   * be placed on the calendar (a window that never opens, a zone `Intl` does
   * not know), which leaves the enrollment with nothing due until a member
   * fixes the window and resumes it.
   */
  error: string | null
}

/**
 * What running the current step writes: the send recorded on the thread
 * fields, and the next step scheduled — or the enrollment `finished` when
 * that was the last.
 */
export function planOutreachStepCompletion(
  input: OutreachStepCompletionInput,
): OutreachStepCompletionResult {
  const { enrollment, sequence } = input
  if (enrollment.status !== 'active') {
    return { patch: null, error: 'Only an active enrollment runs its steps.' }
  }
  const steps = sequence.steps ?? []
  const step = steps[enrollment.stepIndex]
  if (!step) return { patch: null, error: 'This enrollment has no step at its position.' }
  const patch: OutreachStepCompletionPatch = {
    status: 'active',
    stepIndex: enrollment.stepIndex + 1,
    nextDueAtMs: null,
    lastSentAtMs: input.completedAtMs,
  }
  if (step.kind === 'email') {
    const sent = input.sent
    const messageId = String(sent?.messageId ?? '').trim()
    const threadId = String(sent?.threadId ?? '').trim()
    if (!messageId || !threadId) {
      return { patch: null, error: 'An email step needs the sent message and thread ids.' }
    }
    const threadIds = [...(enrollment.gmailThreadIds ?? [])]
    if (!threadIds.includes(threadId)) threadIds.push(threadId)
    patch.gmailThreadId = threadId
    patch.gmailThreadIds = threadIds
    if (isInThreadEmailStep(steps, enrollment.stepIndex) && enrollment.threadSubject) {
      patch.messageIds = [...(enrollment.messageIds ?? []), messageId]
    } else {
      patch.threadSubject = String(sent.subject ?? '').trim()
      patch.messageIds = [messageId]
    }
  }
  const next = steps[patch.stepIndex]
  if (!next) {
    patch.status = 'finished'
    return { patch, error: null }
  }
  patch.nextDueAtMs = scheduleOutreachDue({
    fromMs: input.completedAtMs,
    delayBusinessDays: next.delayBusinessDays,
    timeZone: input.mailbox.timezone,
    window: effectiveOutreachWindow(sequence.settings?.window, input.mailbox.window),
    random: input.random,
  })
  return {
    patch,
    error:
      patch.nextDueAtMs === null
        ? "The next step couldn't be scheduled: check the sending window and the mailbox's timezone."
        : null,
  }
}
