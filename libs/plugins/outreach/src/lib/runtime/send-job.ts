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

import { consentGroupForHost } from '@aglyn/aglyn/app-utils/consent-groups'
import { CRM_COLLECTIONS } from '@aglyn/aglyn/app-utils/crm'
import { normalizeCrmEmailTemplate } from '@aglyn/aglyn/app-utils/crm-email-templates'
import { FieldValue } from 'firebase-admin/firestore'
import { randomUUID } from 'node:crypto'
import { composeOutreachEmail } from '../engine/compose'
import { planOutreachStepCompletion, type OutreachEnrollmentEvent } from '../engine/enrollment-state'
import { evaluateOutreachGates, type OutreachGateBlock, type OutreachGateLookups } from '../engine/gates'
import {
  outreachSentToday,
  outreachTickAllowance,
  selectDueOutreachEnrollments,
  type OutreachDueCandidate,
} from '../engine/sending-capacity'
import { readOutreachEnrollCandidates, type OutreachEnrollCandidate } from '../enrollment/enroll-people'
import { readOutreachGateLookups } from '../enrollment/gate-lookups'
import { mailboxRef } from '../mailboxes/mailbox-credentials'
import { outreachEffectiveDailyCap, outreachLocalDay } from '../mailboxes/mailbox-settings'
import type { OpenedOutreachMailbox } from '../mailboxes/mailbox-transport'
import { effectiveOutreachAllowedCountries } from '../model/compliance-settings'
import {
  OUTREACH_COLLECTIONS,
  type OutreachComplianceSettingsDocument,
  type OutreachEnrollment,
  type OutreachMailbox,
  type OutreachSequence,
  type OutreachStepRecord,
  type OutreachTaskStep,
} from '../model/outreach.types'
import { readOutreachComplianceSettingsDoc } from '../storage/compliance-settings-store'
import {
  outreachEnrollmentLink,
  outreachEnrollmentPerson,
  outreachOrgCollection,
  readStoredOutreachEnrollment,
  readStoredOutreachMailbox,
  readStoredOutreachSequence,
} from '../storage/outreach-records'
import { GmailTransportError, isReconnectRequired } from '../transport/gmail-errors'
import { Rfc5322MessageError } from '../transport/rfc5322'
import { sendComposedOutreachEmail } from '../transport/send-message'
import { creditOutreachFirstSend } from './campaign-credit'
import { newOutreachLinkId, outreachStoredLink, type OutreachStoredLink } from './click-link'
import { applyOutreachEvent } from './enrollment-events'
import { outreachSendDigest, withRecentSend } from './mailbox-health-store'
import { noteOutreachMailboxReconnectRequired } from './mailbox-notices'
import type { OutreachRuntimeDeps } from './runtime-deps'
import { fileOutreachEmail, fileOutreachTask, OUTREACH_TASK_KIND_TO_RECORD } from './timeline'
import { outreachListUnsubscribe } from './unsubscribe-link'

/*==========================================
 * THE SEND JOB (AGL-2981): every fifteen minutes, on the console.
 *
 * ## What comes due
 *
 * One collection-group read finds every active enrollment whose next step
 * is due, oldest first, bounded per run. They are grouped by workspace and
 * mailbox, and each group is judged before anything is sent:
 *
 * - the workspace: Outreach switched on, entitled and released to it;
 * - the mailbox: an enrollment whose mailbox is gone, disconnected, or whose
 *   member left the organization is STOPPED — nothing will ever send it, and
 *   leaving it active would show a sequence that is not running. A paused
 *   mailbox, or one waiting to be reconnected, holds its enrollments;
 * - the member it sends as: a lockdown of the platform, the workspace or the
 *   member holds everything.
 *
 * ## How much goes
 *
 * The engine's per-run allowance — the day's cap and ramp, spread across
 * the window, at most five a run — picks the enrollments (follow-ups first);
 * a task step is due whenever its time comes and spends no allowance.
 *
 * ## One send, exactly once
 *
 * Each email is CLAIMED before it is sent: a transaction over the enrollment
 * and its mailbox checks the enrollment is still active on the same step
 * with no live claim, and that the mailbox's day has room under its cap,
 * then writes the claim and reserves the day's count. Two runs racing for
 * one enrollment write one claim; two racing for one mailbox's last slot
 * reserve it once. The claim carries the `Message-ID` minted for the send,
 * so a claim a run died holding is settled by finding the message in the
 * mailbox rather than by sending it a second time. A send that fails hands
 * its reservation back.
 *
 * Before it is claimed, every gate is asked again — the do-not-contact
 * list, the suppression lists, the sales topic, the roster, the other
 * sequences — because a person enrolled on Monday can unsubscribe by
 * Thursday. A lookup that could not be made holds the send; a gate that
 * refuses stops the enrollment, saying why.
 *==========================================*/

export { OUTREACH_SEND_JOB_ID } from '../constants/runtime-jobs'

/** The most due enrollments one run reads. */
export const OUTREACH_SEND_SCAN_LIMIT = 300

/** How long a claim holds before a later run settles it. */
export const OUTREACH_CLAIM_STALE_MS = 10 * 60_000

/** What one run did, for the tick's answer. */
export interface OutreachSendReport {
  [key: string]: number
  due: number
  sent: number
  tasks: number
  /** Stopped by a gate or an unusable mailbox. */
  stopped: number
  /** Paused for the rep to fix, or failed for good. */
  failed: number
  /** Due, and left for a later run: the allowance, a lookup, a hold. */
  held: number
  /** Claims a dead run left, settled. */
  recovered: number
}

type Firestore = FirebaseFirestore.Firestore

interface MailboxRun {
  orgId: string
  org: Record<string, unknown>
  mailbox: OutreachMailbox
  settings: OutreachComplianceSettingsDocument
  report: OutreachSendReport
  deadlineMs: number
  opened: OpenedOutreachMailbox | null
  /** Set once the mailbox itself cannot send this run. */
  stopped: boolean
  templates: Map<string, string | null>
  /**
   * The click-tracking origin for this mailbox's sending domain (AGL-3306):
   * `undefined` until a tracked send first asks, then the verified
   * `https://links.<domain>` or `null` for the console's own address.
   */
  linkOrigin?: string | null
}

const blankReport = (): OutreachSendReport => ({
  due: 0,
  sent: 0,
  tasks: 0,
  stopped: 0,
  failed: 0,
  held: 0,
  recovered: 0,
})

/** Runs the send job once — see the module note. */
export async function runOutreachSendJob(
  deps: OutreachRuntimeDeps,
  context: { nowMs: number; deadlineMs: number },
): Promise<OutreachSendReport> {
  const firestore = deps.firestore()
  const report = blankReport()
  const due = await firestore
    .collectionGroup(OUTREACH_COLLECTIONS.enrollments)
    .where('status', '==', 'active')
    .where('nextDueAtMs', '<=', context.nowMs)
    .orderBy('nextDueAtMs')
    .limit(OUTREACH_SEND_SCAN_LIMIT)
    .get()
  report.due = due.size
  const byOrg = new Map<string, Map<string, OutreachEnrollment[]>>()
  for (const doc of due.docs) {
    const orgId = doc.ref.parent.parent?.id
    const enrollment = readStoredOutreachEnrollment(doc.id, doc.data())
    if (!orgId || !enrollment) continue
    const mailboxes = byOrg.get(orgId) ?? new Map<string, OutreachEnrollment[]>()
    mailboxes.set(enrollment.mailboxId, [...(mailboxes.get(enrollment.mailboxId) ?? []), enrollment])
    byOrg.set(orgId, mailboxes)
  }

  for (const [orgId, mailboxes] of byOrg) {
    const waiting = [...mailboxes.values()].reduce((sum, list) => sum + list.length, 0)
    if (deps.now() >= context.deadlineMs) {
      report.held += waiting
      continue
    }
    const orgSnapshot = await firestore.collection('orgs').doc(orgId).get()
    const org = (orgSnapshot.exists ? orgSnapshot.data() : null) as Record<string, unknown> | null
    if (!org || (await deps.orgRefusal(orgId, org))) {
      report.held += waiting
      continue
    }
    const settings = await readOutreachComplianceSettingsDoc(firestore, orgId)
    for (const [mailboxId, enrollments] of mailboxes) {
      await runMailbox(deps, firestore, { orgId, org, mailboxId, enrollments, settings, report, context })
    }
  }
  return report
}

/** The reason an unusable mailbox stops an enrollment, or `null` for a usable one. */
async function unusableMailbox(
  firestore: Firestore,
  orgId: string,
  mailbox: OutreachMailbox | null,
): Promise<string | null> {
  if (!mailbox) return 'The mailbox this sequence sends from was removed.'
  if (mailbox.status === 'disconnected') return 'The mailbox this sequence sends from was disconnected.'
  const member = await firestore.collection('orgs').doc(orgId).collection('members').doc(mailbox.connectedByUid).get()
  return member.exists
    ? null
    : 'The member who connected the mailbox this sequence sends from is no longer in the organization.'
}

async function runMailbox(
  deps: OutreachRuntimeDeps,
  firestore: Firestore,
  input: {
    orgId: string
    org: Record<string, unknown>
    mailboxId: string
    enrollments: OutreachEnrollment[]
    settings: OutreachComplianceSettingsDocument
    report: OutreachSendReport
    context: { nowMs: number; deadlineMs: number }
  },
): Promise<void> {
  const { orgId, org, report, context } = input
  const nowMs = context.nowMs
  const snapshot = await mailboxRef(firestore, orgId, input.mailboxId).get()
  const mailbox = readStoredOutreachMailbox(input.mailboxId, snapshot.exists ? snapshot.data() : undefined)
  const unusable = await unusableMailbox(firestore, orgId, mailbox)
  if (unusable || !mailbox) {
    for (const enrollment of input.enrollments) {
      const outcome = await applyOutreachEvent(firestore, {
        orgId,
        enrollmentId: enrollment.id,
        event: { type: 'stop', atMs: nowMs, byUid: null, reason: 'gate', detail: unusable },
        nowMs,
      })
      if (outcome.changed) report.stopped += 1
    }
    return
  }
  if (mailbox.status !== 'connected' || (await deps.sendRefusal({ orgId, org, uid: mailbox.connectedByUid }))) {
    report.held += input.enrollments.length
    return
  }

  const run: MailboxRun = {
    orgId,
    org,
    mailbox,
    settings: input.settings,
    report,
    deadlineMs: context.deadlineMs,
    opened: null,
    stopped: false,
    templates: new Map(),
  }
  const sequenceIds = [...new Set(input.enrollments.map((enrollment) => enrollment.sequenceId))]
  const sequenceSnapshots = await firestore.getAll(
    ...sequenceIds.map((id) => outreachOrgCollection(firestore, orgId, 'sequences').doc(id)),
  )
  const sequences = new Map<string, OutreachSequence>()
  sequenceSnapshots.forEach((sequenceSnapshot, index) => {
    const sequence = readStoredOutreachSequence(
      sequenceIds[index],
      sequenceSnapshot.exists ? sequenceSnapshot.data() : undefined,
    )
    if (sequence) sequences.set(sequence.id, sequence)
  })

  const candidates: OutreachDueCandidate[] = []
  for (const enrollment of input.enrollments) {
    const sequence = sequences.get(enrollment.sequenceId)
    const claim = enrollment.sendClaim
    if (claim && nowMs - claim.atMs < OUTREACH_CLAIM_STALE_MS) continue
    if (claim && sequence) {
      if (await recoverClaim(deps, firestore, run, enrollment, sequence)) report.recovered += 1
      continue
    }
    if (sequence) candidates.push({ enrollment, sequence })
  }

  const allowance = outreachTickAllowance({ mailbox, nowMs })
  const selection = selectDueOutreachEnrollments({ candidates, mailbox, nowMs, allowance: allowance.allowance })
  report.held += selection.deferred.length

  for (const candidate of selection.tasks) {
    if (deps.now() >= context.deadlineMs) {
      report.held += 1
      continue
    }
    if (await runTaskStep(deps, firestore, run, candidate)) report.tasks += 1
  }
  if (!selection.emails.length) return

  // The people behind the emails, read once per site: the contact and its
  // company, and every lookup the gates decide on.
  const people = new Map<string, OutreachEnrollCandidate>()
  const lookups = new Map<string, OutreachGateLookups>()
  const byHost = new Map<string, OutreachEnrollment[]>()
  for (const candidate of selection.emails) {
    const enrollment = candidate.enrollment as OutreachEnrollment
    byHost.set(enrollment.hostId, [...(byHost.get(enrollment.hostId) ?? []), enrollment])
  }
  const siteNames = new Map<string, string>()
  for (const [hostId, enrollments] of byHost) {
    const contactGroupId = consentGroupForHost(org, hostId).groupId
    // Each by the record it names — the contact, or the lead while the
    // person is one (AGL-3234) — keyed by that record's id.
    const [candidatesRead, lookupsRead, host] = await Promise.all([
      readOutreachEnrollCandidates(firestore, {
        orgId,
        hostId,
        contactGroupId,
        people: enrollments.map(outreachEnrollmentPerson),
      }),
      readOutreachGateLookups(firestore, {
        orgId,
        hostId,
        people: enrollments.map((enrollment) => {
          const person = outreachEnrollmentPerson(enrollment)
          return {
            personId: person.id,
            contactId: person.kind === 'contact' ? person.id : null,
            leadId: person.kind === 'lead' ? person.id : null,
            email: enrollment.email,
          }
        }),
      }),
      firestore.collection('hosts').doc(hostId).get(),
    ])
    for (const person of candidatesRead) people.set(person.personId, person)
    for (const [personId, answer] of lookupsRead) lookups.set(personId, answer)
    siteNames.set(hostId, host.exists ? String(host.get('name') ?? '') : '')
  }

  for (const candidate of selection.emails) {
    if (run.stopped || deps.now() >= context.deadlineMs) {
      report.held += 1
      continue
    }
    const enrollment = candidate.enrollment as OutreachEnrollment
    const personId = outreachEnrollmentPerson(enrollment).id
    await runEmailStep(deps, firestore, run, {
      enrollment,
      sequence: candidate.sequence as OutreachSequence,
      person: people.get(personId) ?? null,
      lookups: lookups.get(personId) ?? null,
      siteName: siteNames.get(enrollment.hostId) ?? '',
    })
  }
}

/** Any lookup the runtime could not make: the send waits for a run that can. */
function uncheckable(lookups: OutreachGateLookups | null): boolean {
  return !lookups || Object.values(lookups).some((value) => value === null)
}

/** The event a gate's refusal ends an enrollment with. */
function gateEvent(blocks: readonly OutreachGateBlock[], atMs: number): OutreachEnrollmentEvent {
  const optedOut = blocks.find((block) => block.code === 'do_not_contact' || block.code === 'sales_opted_out')
  if (optedOut) return { type: 'opt_out', atMs, reason: 'do_not_contact', detail: optedOut.reason }
  return { type: 'stop', atMs, byUid: null, reason: 'gate', detail: blocks.map((block) => block.reason).join(' ') }
}

/**
 * The click-tracking origin for mail sent as `senderAddress`, or `null` for
 * the console's own address — which is also what a failed lookup reads as: a
 * link on the app address still counts the click, so no send waits on it.
 */
async function trackingLinkOrigin(
  deps: OutreachRuntimeDeps,
  orgId: string,
  senderAddress: string,
): Promise<string | null> {
  if (!deps.clickLinkOrigin) return null
  try {
    return await deps.clickLinkOrigin({ orgId, senderAddress })
  } catch (error) {
    console.warn('[outreach] the click-tracking host could not be read; links use the app address', error)
    return null
  }
}

/** The sender line a mailbox's mail goes out with. */
const senderOf = (mailbox: OutreachMailbox) => ({
  address: mailbox.sendAs || mailbox.email,
  name: mailbox.displayName || null,
})

async function openClient(deps: OutreachRuntimeDeps, run: MailboxRun) {
  const opened = (run.opened ??= await deps.openMailbox(run.mailbox.id))
  if (opened.ok === true) return opened.client
  run.stopped = true
  if (opened.reason !== 'not-configured') {
    await noteOutreachMailboxReconnectRequired(deps, {
      orgId: run.orgId,
      mailboxId: run.mailbox.id,
      errorCode: opened.reason,
      nowMs: deps.now(),
    })
  }
  return null
}

/**
 * Claims one step: the enrollment still active on the same step with no
 * live claim, and — for an email — a slot under the mailbox's cap today,
 * reserved in the same transaction.
 */
async function claimStep(
  deps: OutreachRuntimeDeps,
  firestore: Firestore,
  run: MailboxRun,
  enrollment: OutreachEnrollment,
  messageId: string | null,
): Promise<'claimed' | 'taken' | 'cap'> {
  const enrollmentRef = outreachOrgCollection(firestore, run.orgId, 'enrollments').doc(enrollment.id)
  const boxRef = mailboxRef(firestore, run.orgId, run.mailbox.id)
  const nowMs = deps.now()
  return firestore.runTransaction(async (transaction) => {
    const [current, box] = await Promise.all([transaction.get(enrollmentRef), transaction.get(boxRef)])
    const stored = readStoredOutreachEnrollment(enrollment.id, current.exists ? current.data() : undefined)
    const claim = stored?.sendClaim
    if (
      !stored ||
      stored.status !== 'active' ||
      stored.stepIndex !== enrollment.stepIndex ||
      stored.nextDueAtMs === null ||
      stored.nextDueAtMs > nowMs ||
      (claim && nowMs - claim.atMs < OUTREACH_CLAIM_STALE_MS)
    ) {
      return 'taken'
    }
    if (messageId) {
      const mailbox = readStoredOutreachMailbox(run.mailbox.id, box.exists ? box.data() : undefined)
      if (!mailbox || mailbox.status !== 'connected') return 'taken'
      const sent = outreachSentToday(mailbox.health, nowMs, mailbox.timezone)
      if (sent >= outreachEffectiveDailyCap(mailbox, nowMs)) return 'cap'
      transaction.update(boxRef, {
        'health.sentToday': sent + 1,
        'health.sentOnDay': outreachLocalDay(nowMs, mailbox.timezone),
      })
    }
    transaction.update(enrollmentRef, {
      sendClaim: { token: randomUUID(), atMs: nowMs, stepIndex: enrollment.stepIndex, messageId },
      updatedAtMs: nowMs,
    })
    return 'claimed'
  })
}

/** Drops a claim, and hands an email's reservation back to the mailbox's day. */
async function releaseClaim(
  deps: OutreachRuntimeDeps,
  firestore: Firestore,
  run: MailboxRun,
  enrollment: Pick<OutreachEnrollment, 'id'>,
  reserved: boolean,
  event: OutreachEnrollmentEvent | null = null,
): Promise<void> {
  const nowMs = deps.now()
  await applyOutreachEvent(firestore, {
    orgId: run.orgId,
    enrollmentId: enrollment.id,
    event,
    extra: () => ({ sendClaim: null }),
    nowMs,
  })
  if (!reserved) return
  const boxRef = mailboxRef(firestore, run.orgId, run.mailbox.id)
  await firestore.runTransaction(async (transaction) => {
    const box = await transaction.get(boxRef)
    const mailbox = readStoredOutreachMailbox(run.mailbox.id, box.exists ? box.data() : undefined)
    if (!mailbox || mailbox.health?.sentOnDay !== outreachLocalDay(nowMs, mailbox.timezone)) return
    transaction.update(boxRef, { 'health.sentToday': Math.max(0, (Number(mailbox.health.sentToday) || 0) - 1) })
  })
}

/**
 * Records a step that ran: the engine's completion patch, the claim
 * cleared, the step's record kept — and for an email the mailbox's send on
 * its day, its last-sent time and its window of recent sends. Refuses
 * (answers false) when the claim is no longer this run's.
 */
async function completeStep(
  deps: OutreachRuntimeDeps,
  firestore: Firestore,
  run: MailboxRun,
  input: {
    enrollment: OutreachEnrollment
    sequence: OutreachSequence
    record: OutreachStepRecord
    sent: { messageId: string; threadId: string; subject: string } | null
    claimMessageId: string | null
  },
): Promise<boolean> {
  const enrollmentRef = outreachOrgCollection(firestore, run.orgId, 'enrollments').doc(input.enrollment.id)
  const boxRef = mailboxRef(firestore, run.orgId, run.mailbox.id)
  const nowMs = deps.now()
  /*
   * Whether this is the FIRST email this person has had from the sequence
   * (AGL-3239), decided from the same read the step is recorded against and
   * so re-decided on every transaction retry. It is what `stats.people`
   * counts: the denominator of every engagement rate, and the thing
   * `stats.sent` is not, since one person takes several steps.
   */
  let firstEmail = false
  const completed = await firestore.runTransaction(async (transaction) => {
    const [current, box] = await Promise.all([
      transaction.get(enrollmentRef),
      input.sent ? transaction.get(boxRef) : Promise.resolve(null),
    ])
    const stored = readStoredOutreachEnrollment(input.enrollment.id, current.exists ? current.data() : undefined)
    if (!stored?.sendClaim || stored.sendClaim.messageId !== input.claimMessageId) return false
    if (stored.stepIndex !== input.enrollment.stepIndex) return false
    // The step RAN, whatever happened to the enrollment while it did — a
    // member paused it, a reply stopped it — so it is recorded as run, and a
    // resume never sends it twice.
    firstEmail =
      input.sent !== null &&
      !(stored.stepRecords ?? []).some((record) => record.kind === 'email')
    const plan = planOutreachStepCompletion({
      enrollment: { ...stored, status: 'active' },
      sequence: input.sequence,
      mailbox: run.mailbox,
      completedAtMs: nowMs,
      sent: input.sent,
      random: deps.random,
    })
    const patch: Record<string, unknown> = {
      sendClaim: null,
      stepRecords: [...(stored.stepRecords ?? []), input.record].slice(-20),
      updatedAtMs: nowMs,
      ...(plan.patch ?? {}),
    }
    if (stored.status !== 'active') {
      patch['status'] = stored.status
      if (stored.status !== 'paused') patch['nextDueAtMs'] = null
    }
    transaction.update(enrollmentRef, patch)
    if (input.sent && box?.exists) {
      const mailbox = readStoredOutreachMailbox(run.mailbox.id, box.data())
      if (mailbox) {
        const day = outreachLocalDay(nowMs, mailbox.timezone)
        const counts = mailbox.health?.daily?.[day] ?? { sent: 0, bounces: 0, replies: 0 }
        transaction.update(boxRef, {
          'health.lastSentAtMs': nowMs,
          'health.lastErrorAtMs': null,
          'health.lastErrorCode': null,
          [`health.daily.${day}`]: { ...counts, sent: (Number(counts.sent) || 0) + 1 },
          'health.recentSends': withRecentSend(mailbox.health?.recentSends, {
            id: outreachSendDigest(input.sent.messageId),
            atMs: nowMs,
            bounced: false,
          }),
          updatedAtMs: nowMs,
        })
      }
    }
    return true
  })
  if (completed && input.sent) {
    await bumpOutreachSequenceStats(firestore, {
      orgId: run.orgId,
      sequenceId: input.sequence.id,
      firstEmail,
      trackedLinks: input.record.links?.length ?? 0,
    })
  }
  return completed
}

/**
 * The sequence's send counters (AGL-3239), written outside the enrollment's
 * transaction.
 *
 * One sequence holds every enrollment, so a transaction over it would
 * serialise every recipient against every other; `FieldValue.increment` is a
 * blind write with nothing to contend on. It is bookkeeping beside the act,
 * so a failure is logged and the send stands — the email has already left.
 *
 * `clickTracked` is stamped by the first send that actually carried a
 * rewritten link, never by the SETTING: a sequence with the setting on whose
 * emails have no links in them measured nothing, and the report must say
 * "not measured" for it rather than publish a 0% click rate.
 */
async function bumpOutreachSequenceStats(
  firestore: Firestore,
  input: { orgId: string; sequenceId: string; firstEmail: boolean; trackedLinks: number },
): Promise<void> {
  if (!input.sequenceId) return
  await outreachOrgCollection(firestore, input.orgId, 'sequences')
    .doc(input.sequenceId)
    .update({
      'stats.sent': FieldValue.increment(1),
      ...(input.firstEmail ? { 'stats.people': FieldValue.increment(1) } : {}),
      ...(input.trackedLinks > 0 ? { 'stats.clickTracked': true } : {}),
    })
    .catch((error: unknown) => {
      console.warn('[outreach] a send could not be counted on its sequence', error)
    })
}

/** One task step: the rep's task on the contact, then the step recorded. */
async function runTaskStep(
  deps: OutreachRuntimeDeps,
  firestore: Firestore,
  run: MailboxRun,
  candidate: OutreachDueCandidate,
): Promise<boolean> {
  const enrollment = candidate.enrollment as OutreachEnrollment
  const sequence = candidate.sequence as OutreachSequence
  const step = sequence.steps[enrollment.stepIndex] as OutreachTaskStep
  if ((await claimStep(deps, firestore, run, enrollment, null)) !== 'claimed') return false
  const nowMs = deps.now()
  let taskId: string | null
  try {
    const written = await fileOutreachTask(deps, {
      orgId: run.orgId,
      hostId: enrollment.hostId,
      link: outreachEnrollmentLink(enrollment),
      dedupeKey: `step:${enrollment.id}:${step.id}`,
      title: step.title,
      notes: `From sequence step ${enrollment.stepIndex + 1}.`,
      kind: OUTREACH_TASK_KIND_TO_RECORD[step.taskKind] ?? 'todo',
      dueAtMs: nowMs,
      assigneeUid: run.mailbox.connectedByUid,
    })
    taskId = written?.ok ? written.id : null
    if (written?.ok === false) console.warn(`[outreach] a task step's task was not filed: ${written.error}`)
  } catch (error) {
    // The record system failed rather than refused: the step waits for a
    // run that can file its task.
    console.error('[outreach] filing a task step failed; the step waits', error)
    await releaseClaim(deps, firestore, run, enrollment, false)
    return false
  }
  return completeStep(deps, firestore, run, {
    enrollment,
    sequence,
    record: { stepIndex: enrollment.stepIndex, stepId: step.id, kind: 'task', atMs: nowMs, taskId },
    sent: null,
    claimMessageId: null,
  })
}

/** A CRM template's body, read once per run. */
async function templateBody(firestore: Firestore, run: MailboxRun, templateId: string): Promise<string | null> {
  if (!run.templates.has(templateId)) {
    const snapshot = await firestore
      .collection('orgs')
      .doc(run.orgId)
      .collection(CRM_COLLECTIONS.emailTemplates)
      .doc(templateId)
      .get()
    run.templates.set(
      templateId,
      snapshot.exists ? normalizeCrmEmailTemplate(snapshot.data() as Record<string, unknown>).body : null,
    )
  }
  return run.templates.get(templateId) ?? null
}

async function runEmailStep(
  deps: OutreachRuntimeDeps,
  firestore: Firestore,
  run: MailboxRun,
  input: {
    enrollment: OutreachEnrollment
    sequence: OutreachSequence
    person: OutreachEnrollCandidate | null
    lookups: OutreachGateLookups | null
    siteName: string
  },
): Promise<void> {
  const { enrollment, sequence, person } = input
  const { report, mailbox } = run
  const nowMs = deps.now()
  const stop = async (event: OutreachEnrollmentEvent, counter: 'stopped' | 'failed') => {
    const outcome = await applyOutreachEvent(firestore, { orgId: run.orgId, enrollmentId: enrollment.id, event, nowMs })
    if (outcome.changed) report[counter] += 1
  }

  // Every gate again, on the person as they stand now.
  if (!person?.contact) {
    return stop(
      {
        type: 'stop',
        atMs: nowMs,
        byUid: null,
        reason: 'gate',
        detail:
          enrollment.target === 'lead'
            ? "This lead no longer exists in the sequence's site's CRM."
            : 'This contact no longer exists in the CRM.',
      },
      'stopped',
    )
  }
  if (person.convertedContactId && enrollment.target === 'lead') {
    // The lead converted and the enrollment has not followed it yet: the
    // conversion's listener re-points it, and the next run sends as the contact.
    report.held += 1
    return
  }
  if (!person.visible) {
    return stop(
      { type: 'stop', atMs: nowMs, byUid: null, reason: 'gate', detail: "This contact is no longer in the sequence's site's CRM." },
      'stopped',
    )
  }
  if (uncheckable(input.lookups)) {
    report.held += 1
    return
  }
  const contactGroupId = consentGroupForHost(run.org, enrollment.hostId).groupId
  const gate = evaluateOutreachGates({
    email: enrollment.email,
    contact: person.contact,
    contactGroupId,
    company: person.company,
    settings: {
      ...sequence.settings,
      allowedCountries: effectiveOutreachAllowedCountries(
        sequence.settings.allowedCountries,
        run.settings.allowedCountries,
      ),
    },
    personalLine: enrollment.personalLine,
    attestations: enrollment.attestations,
    enrollmentId: enrollment.id,
    lookups: input.lookups as OutreachGateLookups,
  })
  if (!gate.allowed) return stop(gateEvent(gate.blocks, nowMs), 'stopped')

  /*
   * The email, with its way out. The footer's "reply 'no'" line and the
   * postal address are always there (compose refuses without them). The
   * `List-Unsubscribe` header is the sequence's own setting (AGL-3296), read
   * here per send like click tracking, and absent reads as off.
   */
  const unsubscribe = outreachListUnsubscribe({
    enabled: sequence.settings.listUnsubscribe,
    mintUrl: () => deps.unsubscribeUrl({ orgId: run.orgId, enrollmentId: enrollment.id }),
    mailboxEmail: mailbox.email,
  })
  if (unsubscribe.status === 'unavailable') {
    // On, but no link can be minted — no secret, or no HTTPS console origin
    // — and an email without the way out its sequence promised does not leave.
    console.error('[outreach] no unsubscribe link could be minted; nothing sends until one can')
    run.stopped = true
    report.held += 1
    return
  }
  const step = sequence.steps[enrollment.stepIndex]
  const sender = senderOf(mailbox)
  /*
   * Click tracking is the sequence's own setting (AGL-3239) and is read
   * here, per send, rather than once per run: a member turning it off
   * applies to the next email, not to the next hour. Each link becomes a
   * short link (AGL-3297) whose document is written below, before the email
   * leaves; a link that cannot be made is left exactly as the step wrote it.
   */
  if (sequence.settings.trackClicks && run.linkOrigin === undefined) {
    run.linkOrigin = await trackingLinkOrigin(deps, run.orgId, sender.address)
  }
  const shortLinks: Array<{ id: string; doc: OutreachStoredLink }> = []
  const rewriteLink = sequence.settings.trackClicks
    ? (link: { url: string; index: number }) => {
        const doc = outreachStoredLink(
          {
            orgId: run.orgId,
            enrollmentId: enrollment.id,
            stepIndex: enrollment.stepIndex,
            linkIndex: link.index,
            url: link.url,
          },
          nowMs,
        )
        const id = newOutreachLinkId()
        const url = doc ? deps.clickLinkUrl(id, run.linkOrigin ?? null) : null
        if (!doc || !url) return null
        shortLinks.push({ id, doc })
        return url
      }
    : null
  const composed = composeOutreachEmail({
    sequence,
    enrollment,
    orgSettings: run.settings,
    rewriteLink,
    merge: {
      // For a lead, the contact-shaped view of it (`leadAsContact`), so a
      // step written with `{{contact.*}}` reads the lead; `{{lead.*}}` reads
      // the lead's own document beside it.
      contact: person.contact,
      contactGroupId,
      lead: person.lead,
      sender: { name: mailbox.displayName, email: sender.address },
      site: { name: input.siteName },
    },
    templateBody: step?.kind === 'email' && step.templateId ? await templateBody(firestore, run, step.templateId) : null,
    listUnsubscribeUrl: unsubscribe.status === 'ready' ? unsubscribe.url : null,
    listUnsubscribeMailto: unsubscribe.status === 'ready' ? unsubscribe.mailto : null,
  })
  if (composed.error || !composed.email) {
    const code = composed.error?.code
    if (code === 'missing_postal_address' || code === 'missing_legal_name') {
      // The organization's footer: nothing of theirs sends until it is set.
      run.stopped = true
      report.held += 1
      return
    }
    if (code === 'invalid_recipient' || code === 'missing_thread' || code === 'not_an_email_step') {
      return stop({ type: 'send_failed', atMs: nowMs, detail: composed.error?.message }, 'failed')
    }
    // The sequence's own words: the rep fixes the step and resumes.
    return stop({ type: 'pause', atMs: nowMs, byUid: null, detail: composed.error?.message }, 'failed')
  }
  if (composed.unresolvedFields.length) {
    const fields = composed.unresolvedFields.map((field) => `{{${field}}}`).join(', ')
    return stop(
      {
        type: 'pause',
        atMs: nowMs,
        byUid: null,
        detail: `Paused before sending: this contact has nothing for ${fields}. Fill it in and resume.`,
      },
      'failed',
    )
  }

  /*
   * The short links' documents, before anything is claimed or sent: a link
   * in an email that already left must resolve on the first click. A write
   * that fails holds the send for the next run, which mints new ones — an
   * orphaned document is inert, an email whose links go nowhere is not.
   */
  if (shortLinks.length) {
    try {
      const batch = firestore.batch()
      for (const link of shortLinks) {
        batch.create(firestore.collection(OUTREACH_COLLECTIONS.links).doc(link.id), link.doc)
      }
      await batch.commit()
    } catch (error) {
      console.error('[outreach] the short links could not be stored; the send waits for the next run', error)
      report.held += 1
      return
    }
  }

  // Claimed, then sent, then recorded.
  const domain = sender.address.slice(sender.address.lastIndexOf('@') + 1)
  const local = randomUUID()
  const messageId = `<${local}@${domain}>`
  const claimed = await claimStep(deps, firestore, run, enrollment, messageId)
  if (claimed !== 'claimed') {
    if (claimed === 'cap') run.stopped = true
    report.held += 1
    return
  }
  const client = await openClient(deps, run)
  if (!client) {
    await releaseClaim(deps, firestore, run, enrollment, true)
    report.held += 1
    return
  }
  let sent: Awaited<ReturnType<typeof sendComposedOutreachEmail>>
  try {
    sent = await sendComposedOutreachEmail(client, composed.email, sender, {
      messageIdLocalPart: local,
      messageIdDomain: domain,
    })
  } catch (error) {
    if (error instanceof Rfc5322MessageError || (error instanceof GmailTransportError && error.code === 'invalid_request')) {
      await releaseClaim(deps, firestore, run, enrollment, true, {
        type: 'send_failed',
        atMs: deps.now(),
        detail: `Gmail refused the email: ${error.message}`,
      })
      report.failed += 1
      return
    }
    await releaseClaim(deps, firestore, run, enrollment, true)
    report.held += 1
    run.stopped = true
    const code = error instanceof GmailTransportError ? error.code : 'unexpected'
    if (isReconnectRequired(error)) {
      await noteOutreachMailboxReconnectRequired(deps, {
        orgId: run.orgId,
        mailboxId: mailbox.id,
        errorCode: code,
        nowMs: deps.now(),
      })
    } else {
      await mailboxRef(firestore, run.orgId, mailbox.id)
        .update({ 'health.lastErrorAtMs': deps.now(), 'health.lastErrorCode': code })
        .catch(() => undefined)
    }
    console.error(`[outreach] a send from a mailbox failed (${code}); its sends wait for the next run`)
    return
  }

  const record: OutreachStepRecord = {
    stepIndex: enrollment.stepIndex,
    stepId: step?.id ?? '',
    kind: 'email',
    atMs: deps.now(),
    gmailMessageId: sent.gmailMessageId,
    gmailThreadId: sent.threadId,
    messageId: sent.messageId,
    subject: sent.subject,
    ...(composed.email.trackedLinks.length ? { links: composed.email.trackedLinks } : {}),
  }
  await completeStep(deps, firestore, run, {
    enrollment,
    sequence,
    record,
    sent: { messageId: sent.messageId, threadId: sent.threadId, subject: sent.subject },
    claimMessageId: messageId,
  })
  report.sent += 1
  await fileOutreachEmail(deps, {
    orgId: run.orgId,
    hostId: enrollment.hostId,
    link: outreachEnrollmentLink(enrollment),
    direction: 'outbound',
    subject: sent.subject,
    from: sender.address,
    to: composed.email.to,
    messageId: sent.messageId,
    inReplyTo: composed.email.inReplyTo ?? null,
    body: composed.email.text,
    atMs: record.atMs,
    byUid: mailbox.connectedByUid,
    byName: mailbox.displayName || null,
  })
  // The first email is the touch (AGL-3254): `sent` on the sequence's
  // campaigns, and the person's record credited to the first of them.
  // Judged on the enrollment as it was read, before this step's record.
  await creditOutreachFirstSend(deps, { enrollment, atMs: record.atMs })
}

/**
 * Settles a claim a run died holding. A task step's claim is dropped and
 * the step runs again (its task is filed once however often it is asked).
 * An email's claim looks for the message it minted in the mailbox: found,
 * the send happened and is recorded; not found, it did not, and the claim
 * and its reservation are handed back for the next run.
 */
async function recoverClaim(
  deps: OutreachRuntimeDeps,
  firestore: Firestore,
  run: MailboxRun,
  enrollment: OutreachEnrollment,
  sequence: OutreachSequence,
): Promise<boolean> {
  const claim = enrollment.sendClaim
  if (!claim) return false
  if (!claim.messageId) {
    await releaseClaim(deps, firestore, run, enrollment, false)
    return true
  }
  const client = await openClient(deps, run)
  if (!client) return false
  const bare = claim.messageId.replace(/^<|>$/g, '')
  const found = await client.listMessages({ q: `rfc822msgid:${bare}`, maxResults: 1, includeSpamTrash: true })
  const hit = found.messages[0]
  if (!hit) {
    await releaseClaim(deps, firestore, run, enrollment, true)
    return true
  }
  const message = await client.getMessage(hit.id, { metadataHeaders: ['Subject'] })
  const subject = message.headers.find((header) => header.name.toLowerCase() === 'subject')?.value ?? ''
  const step = sequence.steps[enrollment.stepIndex]
  const atMs = deps.now()
  const completed = await completeStep(deps, firestore, run, {
    enrollment,
    sequence,
    record: {
      stepIndex: enrollment.stepIndex,
      stepId: step?.id ?? '',
      kind: 'email',
      atMs,
      gmailMessageId: hit.id,
      gmailThreadId: hit.threadId,
      messageId: claim.messageId,
      subject,
    },
    sent: { messageId: claim.messageId, threadId: hit.threadId, subject },
    claimMessageId: claim.messageId,
  })
  // A recovered first email is still the first email (AGL-3254).
  if (completed) await creditOutreachFirstSend(deps, { enrollment, atMs })
  return completed
}
