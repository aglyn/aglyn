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

import { normalizeContactEmail } from '@aglyn/aglyn/app-utils/contacts'
import { isPublicMailboxDomain } from '@aglyn/aglyn/app-utils/crm'
import { crmInboundExcerpt, emailAddressOf } from '@aglyn/aglyn/app-utils/crm-inbound'
import { outreachMessageIdHeader } from '../engine/compose'
import { readOutreachDeliveryReport } from '../engine/delivery-status'
import { outreachEmailDomain } from '../engine/do-not-contact-domain'
import type { OutreachEnrollmentEvent } from '../engine/enrollment-state'
import { isOutreachGatewayBlock, outreachGatewayBlockDetail } from '../engine/gateway-block'
import { effectiveOutreachWindow, postponeOutreachForAutoReply } from '../engine/schedule'
import {
  decideOutreachThread,
  type OutreachMessageClassification,
  type OutreachThreadDecision,
} from '../engine/thread-classification'
import { outreachHeader, outreachThreadMessageFromGmail, type OutreachThreadMessage } from '../engine/thread-message'
import { mailboxRef } from '../mailboxes/mailbox-credentials'
import {
  OUTREACH_COLLECTIONS,
  type OutreachEnrollment,
  type OutreachMailbox,
  type OutreachSequence,
} from '../model/outreach.types'
import { addOutreachDoNotContact, addOutreachDoNotContactDomain } from '../storage/do-not-contact-store'
import {
  outreachEnrollmentLink,
  outreachOrgCollection,
  readStoredOutreachEnrollment,
  readStoredOutreachMailbox,
  readStoredOutreachSequence,
} from '../storage/outreach-records'
import type { GmailClient } from '../transport/gmail-client'
import { GmailTransportError, isReconnectRequired } from '../transport/gmail-errors'
import { creditOutreachReply } from './campaign-credit'
import { applyOutreachEvent, recordOutreachOptOut } from './enrollment-events'
import {
  applyOutreachMailboxHealth,
  emptyOutreachHealthDelta,
  type OutreachMailboxHealthDelta,
} from './mailbox-health-store'
import { noteOutreachMailboxReconnectRequired } from './mailbox-notices'
import type { OutreachRuntimeDeps } from './runtime-deps'
import { markOutreachLeadWorking } from './lead-records'
import { fileOutreachEmail, fileOutreachTask, markOutreachEmailDelivery } from './timeline'
import { outreachUnsubscribeMailbox } from './unsubscribe-link'

/*==========================================
 * THE SYNC JOB (AGL-2981): every fifteen minutes, on the console.
 *
 * For each connected or paused mailbox, what came back since the last run —
 * read with `format=full`, turned into the engine's message shape and
 * classified by `decideOutreachThread`:
 *
 * - a REPLY stops the enrollment, files the message on the contact's
 *   timeline (once per `Message-ID`, under the capture address's own id for
 *   it) and gives the rep the task "Reply from <name>";
 * - an OUT-OF-OFFICE postpones the next step a working week from the reply;
 * - an OPT-OUT — a reply asking to be left alone, or a message to the
 *   `+unsubscribe` address the `mailto:` names — puts the address on the
 *   organization's do-not-contact list and off the site's `sales` topic,
 *   and stops every open enrollment of it;
 * - a HARD BOUNCE stops the enrollment, files the address on the platform's
 *   suppression list and the do-not-contact list — and, when its diagnostic
 *   reads as the domain's mail gateway refusing the sender rather than one
 *   address being unknown (`engine/gateway-block`, AGL-3244), files the
 *   DOMAIN on the do-not-contact list too, and says so on the enrollment.
 *
 * Every verdict a list takes is said on the record the person is as well
 * (AGL-3245): the lead and the contact carry `emailState` through the
 * platform's stamp, and a bounce or a complaint lands on the send's own
 * timeline entry, so a member reading the record sees what the runtime saw.
 *
 * Four reads find those, each narrowed by Gmail rather than read in full:
 * the threads of this mailbox's enrollments that have new mail; delivery
 * reports outside those threads (a receiving server's own bounce), by
 * searching for the mail systems that send them; messages to the
 * unsubscribe address; and messages from the people this mailbox is
 * writing to, in a thread of their own.
 *
 * Every write it makes is idempotent — the do-not-contact list keeps its
 * first entry, a topic opt-out keeps its first moment, a timeline entry is
 * filed once per message — and the messages it handled are marked AFTER
 * their effects, on the enrollment and on the mailbox, so a run that dies
 * part-way repeats harmless work rather than skipping some. The mailbox's
 * health takes the run's bounces and complaints in one write at the end,
 * which is where it pauses itself.
 *==========================================*/

export { OUTREACH_SYNC_JOB_ID } from '../constants/runtime-jobs'

/** The furthest back a run reads: a mailbox's first run, or one that fell behind. */
export const OUTREACH_SYNC_LOOKBACK_MS = 7 * 24 * 60 * 60_000

/** How far a run reads back past the previous one, for mail Gmail indexed late. */
export const OUTREACH_SYNC_OVERLAP_MS = 2 * 60 * 60_000

/** How long after its last send an enrollment's mail is still watched. */
export const OUTREACH_SYNC_WATCH_MS = 45 * 24 * 60 * 60_000

/** The most pages of one search a run reads. */
const SEARCH_PAGES = 5
/** Handled message ids a mailbox keeps, and an enrollment keeps. */
const MAILBOX_HANDLED_MAX = 500
const ENROLLMENT_HANDLED_MAX = 100
/** Addresses in one `from:` search. */
const FROM_CHUNK = 15

type Firestore = FirebaseFirestore.Firestore

export interface OutreachSyncReport {
  [key: string]: number
  mailboxes: number
  threads: number
  replies: number
  optOuts: number
  bounces: number
  /** Hard bounces that read as a gateway block, each filing its domain (AGL-3244). */
  gatewayBlocks: number
  postponed: number
  paused: number
}

interface SyncContext {
  deps: OutreachRuntimeDeps
  firestore: Firestore
  orgId: string
  mailbox: OutreachMailbox
  client: GmailClient
  selfAddresses: string[]
  unsubscribeAddress: string | null
  sequences: Map<string, OutreachSequence | null>
  delta: OutreachMailboxHealthDelta
  report: OutreachSyncReport
  nowMs: number
}

/** Runs the sync job once — see the module note. */
export async function runOutreachSyncJob(
  deps: OutreachRuntimeDeps,
  context: { nowMs: number; deadlineMs: number },
): Promise<OutreachSyncReport> {
  const firestore = deps.firestore()
  const report: OutreachSyncReport = {
    mailboxes: 0,
    threads: 0,
    replies: 0,
    optOuts: 0,
    bounces: 0,
    gatewayBlocks: 0,
    postponed: 0,
    paused: 0,
  }
  const all = await firestore.collectionGroup(OUTREACH_COLLECTIONS.mailboxes).get()
  const byOrg = new Map<string, OutreachMailbox[]>()
  for (const doc of all.docs) {
    const orgId = doc.ref.parent.parent?.id
    const mailbox = readStoredOutreachMailbox(doc.id, doc.data())
    if (!orgId || !mailbox || (mailbox.status !== 'connected' && mailbox.status !== 'paused')) continue
    byOrg.set(orgId, [...(byOrg.get(orgId) ?? []), mailbox])
  }
  for (const [orgId, mailboxes] of byOrg) {
    if (deps.now() >= context.deadlineMs) break
    const orgSnapshot = await firestore.collection('orgs').doc(orgId).get()
    const org = (orgSnapshot.exists ? orgSnapshot.data() : null) as Record<string, unknown> | null
    if (!org || (await deps.orgRefusal(orgId, org))) continue
    for (const mailbox of mailboxes) {
      if (deps.now() >= context.deadlineMs) break
      try {
        await syncMailbox(deps, firestore, { orgId, mailbox, report, nowMs: context.nowMs })
        report.mailboxes += 1
      } catch (error) {
        // One mailbox's failure is its own; the next mailbox is read. A grant
        // Google refused is the mailbox's to reconnect.
        if (isReconnectRequired(error)) {
          await noteOutreachMailboxReconnectRequired(deps, {
            orgId,
            mailboxId: mailbox.id,
            errorCode: error instanceof GmailTransportError ? error.code : 'invalid_grant',
            nowMs: context.nowMs,
          })
        }
        console.error('[outreach] syncing a mailbox failed', error)
      }
    }
  }
  return report
}

/** Every stub a search finds, a few pages deep. */
async function search(
  client: GmailClient,
  q: string,
): Promise<Array<{ id: string; threadId: string }>> {
  const found: Array<{ id: string; threadId: string }> = []
  let pageToken: string | null = null
  for (let page = 0; page < SEARCH_PAGES; page += 1) {
    const list = await client.listMessages({ q, maxResults: 100, pageToken, includeSpamTrash: true })
    found.push(...list.messages.filter((message) => message.id))
    pageToken = list.nextPageToken
    if (!pageToken) break
  }
  return found
}

async function syncMailbox(
  deps: OutreachRuntimeDeps,
  firestore: Firestore,
  input: { orgId: string; mailbox: OutreachMailbox; report: OutreachSyncReport; nowMs: number },
): Promise<void> {
  const { orgId, mailbox, report, nowMs } = input
  const opened = await deps.openMailbox(mailbox.id)
  if (opened.ok === false) {
    if (opened.reason !== 'not-configured') {
      await noteOutreachMailboxReconnectRequired(deps, {
        orgId,
        mailboxId: mailbox.id,
        errorCode: opened.reason,
        nowMs,
      })
    }
    return
  }
  const unsubscribe = outreachUnsubscribeMailbox(mailbox.email)
  const context: SyncContext = {
    deps,
    firestore,
    orgId,
    mailbox,
    client: opened.client,
    selfAddresses: [
      mailbox.email,
      mailbox.sendAs,
      ...(mailbox.sendAsOptions ?? []).map((option) => option.email),
    ].filter(Boolean),
    unsubscribeAddress: unsubscribe?.address ?? null,
    sequences: new Map(),
    delta: emptyOutreachHealthDelta(),
    report,
    nowMs,
  }

  // The enrollments this mailbox is writing to, by thread and by address.
  const watched = await outreachOrgCollection(firestore, orgId, 'enrollments')
    .where('mailboxId', '==', mailbox.id)
    .where('lastSentAtMs', '>=', nowMs - OUTREACH_SYNC_WATCH_MS)
    .get()
  const byThread = new Map<string, OutreachEnrollment>()
  const byAddress = new Map<string, OutreachEnrollment>()
  for (const doc of watched.docs) {
    const enrollment = readStoredOutreachEnrollment(doc.id, doc.data())
    if (!enrollment) continue
    for (const threadId of enrollment.gmailThreadIds) byThread.set(threadId, enrollment)
    const known = byAddress.get(enrollment.email)
    if (!known || (enrollment.lastSentAtMs ?? 0) > (known.lastSentAtMs ?? 0)) byAddress.set(enrollment.email, enrollment)
  }

  const sinceMs = Math.max(Number(mailbox.sync?.throughMs) || 0, nowMs - OUTREACH_SYNC_LOOKBACK_MS) - OUTREACH_SYNC_OVERLAP_MS
  const after = `after:${Math.floor(sinceMs / 1000)}`
  // Every message this run or an earlier one handled outside an enrollment's
  // thread; one message is handled once however many searches find it.
  const handled = new Set(mailbox.sync?.handledMessageIds ?? [])
  const newlyHandled: string[] = []
  const markHandled = (id: string) => {
    if (handled.has(id)) return
    handled.add(id)
    newlyHandled.push(id)
  }
  const fresh = (stub: { id: string; threadId: string }) => !handled.has(stub.id) && !byThread.has(stub.threadId)

  // 1. The enrollments' own threads that have new mail.
  const inbound = await search(context.client, `${after} -from:me`)
  for (const threadId of new Set(inbound.map((stub) => stub.threadId))) {
    const enrollment = byThread.get(threadId)
    if (!enrollment) continue
    const thread = await context.client.getFullThread(threadId)
    report.threads += 1
    await applyMessages(context, enrollment, thread.messages.map(outreachThreadMessageFromGmail))
  }

  // 2. Delivery reports outside those threads: a receiving server's bounce.
  for (const stub of await search(context.client, `${after} from:(mailer-daemon OR postmaster)`)) {
    if (!fresh(stub)) continue
    const message = outreachThreadMessageFromGmail(await context.client.getFullMessage(stub.id))
    const delivery = readOutreachDeliveryReport(message)
    if (delivery?.kind === 'hard') {
      for (const address of delivery.failedAddresses) {
        const enrollment = byAddress.get(address)
        if (enrollment) await applyMessages(context, enrollment, [message])
      }
    }
    markHandled(stub.id)
  }

  // 3. Messages to the unsubscribe address: whoever wrote asked to leave.
  if (unsubscribe) {
    for (const stub of await search(context.client, `${after} to:${unsubscribe.address}`)) {
      if (handled.has(stub.id)) continue
      const metadata = await context.client.getMessage(stub.id, { metadataHeaders: ['From'] })
      const from = emailAddressOf(metadata.headers.find((header) => header.name.toLowerCase() === 'from')?.value ?? '')
      const address = normalizeContactEmail(from)
      if (address && !context.selfAddresses.includes(address)) {
        const enrollment = byAddress.get(address) ?? null
        await recordOutreachOptOut(deps, {
          orgId,
          email: address,
          source: 'unsubscribe',
          enrollment,
          hostIds: enrollment ? [enrollment.hostId] : [],
          detail: 'Wrote to the unsubscribe address.',
          nowMs,
        })
        report.optOuts += 1
      }
      markHandled(stub.id)
    }
  }

  // 4. The people this mailbox writes to, answering in a thread of their own.
  const addresses = [...byAddress.keys()]
  for (let start = 0; start < addresses.length; start += FROM_CHUNK) {
    const chunk = addresses.slice(start, start + FROM_CHUNK)
    for (const stub of await search(context.client, `${after} from:(${chunk.join(' OR ')})`)) {
      if (!fresh(stub)) continue
      const message = outreachThreadMessageFromGmail(await context.client.getFullMessage(stub.id))
      const enrollment = byAddress.get(normalizeContactEmail(emailAddressOf(message.from)) ?? '')
      if (enrollment) await applyMessages(context, enrollment, [message])
      markHandled(stub.id)
    }
  }

  const paused = await applyOutreachMailboxHealth(deps, { orgId, mailboxId: mailbox.id, delta: context.delta })
  if (paused) report.paused += 1
  await mailboxRef(firestore, orgId, mailbox.id).update({
    sync: {
      throughMs: nowMs,
      handledMessageIds: [...(mailbox.sync?.handledMessageIds ?? []), ...newlyHandled].slice(-MAILBOX_HANDLED_MAX),
    },
  })
}

/** The sequence an enrollment runs through, read once per run. */
async function sequenceOf(context: SyncContext, sequenceId: string): Promise<OutreachSequence | null> {
  if (!context.sequences.has(sequenceId)) {
    const snapshot = await outreachOrgCollection(context.firestore, context.orgId, 'sequences').doc(sequenceId).get()
    context.sequences.set(sequenceId, readStoredOutreachSequence(sequenceId, snapshot.exists ? snapshot.data() : undefined))
  }
  return context.sequences.get(sequenceId) ?? null
}

/** A message's `Message-ID` in header form, or `null` when it carries none. */
const messageIdOf = (message: OutreachThreadMessage) => outreachMessageIdHeader(outreachHeader(message, 'Message-ID'))

/** A bounce's diagnostic with the recipient's address taken out of it. */
export function scrubbedOutreachDiagnostic(diagnostic: string | null, email: string): string | null {
  if (!diagnostic) return null
  const pattern = new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')
  return diagnostic.replace(pattern, 'the address')
}

/** Files a message the person wrote on their timeline. */
async function fileInbound(context: SyncContext, enrollment: OutreachEnrollment, message: OutreachThreadMessage) {
  const messageId = messageIdOf(message)
  if (!messageId) return
  await fileOutreachEmail(context.deps, {
    orgId: context.orgId,
    hostId: enrollment.hostId,
    link: outreachEnrollmentLink(enrollment),
    direction: 'inbound',
    subject: message.subject,
    from: emailAddressOf(message.from) ?? message.from,
    to: context.mailbox.sendAs || context.mailbox.email,
    messageId,
    inReplyTo: outreachMessageIdHeader(outreachHeader(message, 'In-Reply-To')),
    body: crmInboundExcerpt(message.textBody ?? message.snippet ?? '', message.htmlBody ?? ''),
    atMs: message.internalDateMs,
    byUid: '',
  })
}

/**
 * What the new messages of one enrollment mean, done: the effects first,
 * each idempotent, then the event and the handled ids in one transaction.
 */
async function applyMessages(
  context: SyncContext,
  enrollment: OutreachEnrollment,
  messages: readonly OutreachThreadMessage[],
): Promise<void> {
  const { deps, firestore, report, nowMs } = context
  const decision: OutreachThreadDecision = decideOutreachThread({
    messages,
    recipient: enrollment.email,
    handledMessageIds: enrollment.syncedMessageIds ?? [],
    selfAddresses: context.selfAddresses,
    unsubscribeAddress: context.unsubscribeAddress,
    threadSubject: enrollment.threadSubject,
  })
  const freshIds = decision.classifications.map((classification) => classification.messageId).filter(Boolean)
  if (!freshIds.length) return
  const decidedBy: OutreachMessageClassification | null = decision.decidedBy
  const decidingMessage = decidedBy ? messages.find((message) => message.id === decidedBy.messageId) ?? null : null
  const lastSentMessageId = enrollment.messageIds[enrollment.messageIds.length - 1] ?? null

  for (const classification of decision.classifications) {
    const aboutRecipient =
      !classification.bounce?.recipients.length || classification.bounce.recipients.includes(enrollment.email)
    if (classification.kind === 'hard_bounce' && aboutRecipient) {
      context.delta.bounces.push({ atMs: classification.atMs || nowMs, messageId: lastSentMessageId })
    }
    if (classification.complaint) {
      context.delta.complaintAtMs = Math.max(context.delta.complaintAtMs ?? 0, classification.atMs || nowMs)
    }
  }

  let event: OutreachEnrollmentEvent | null = null
  let postponedTo: number | null = null
  switch (decision.outcome) {
    case 'opted_out': {
      if (decidingMessage) await fileInbound(context, enrollment, decidingMessage)
      const complaint = decidedBy?.complaint === true
      await recordOutreachOptOut(deps, {
        orgId: context.orgId,
        email: enrollment.email,
        source: decidedBy?.evidence?.startsWith('To:') ? 'unsubscribe' : 'opt_out_reply',
        enrollment,
        hostIds: [enrollment.hostId],
        detail: decidedBy?.evidence ?? null,
        nowMs,
        complaint,
      })
      // A reply that called the email spam marks the send it answered
      // (AGL-3245), as the campaign webhook would mark a reported one.
      if (complaint) {
        await markOutreachEmailDelivery(deps, {
          orgId: context.orgId,
          messageId: lastSentMessageId,
          state: 'complained',
          atMs: decidedBy?.atMs || nowMs,
          detail: decidedBy?.evidence ?? null,
        })
      }
      report.optOuts += 1
      break
    }
    case 'replied': {
      if (decidingMessage) {
        await fileInbound(context, enrollment, decidingMessage)
        try {
          await fileOutreachTask(deps, {
            orgId: context.orgId,
            hostId: enrollment.hostId,
            link: outreachEnrollmentLink(enrollment),
            dedupeKey: `reply:${messageIdOf(decidingMessage) ?? decidingMessage.id}`,
            title: `Reply from ${enrollment.contactName || enrollment.email}`,
            notes: crmInboundExcerpt(decidingMessage.textBody ?? decidingMessage.snippet ?? '', decidingMessage.htmlBody ?? '').slice(0, 500),
            kind: 'email',
            dueAtMs: nowMs,
            assigneeUid: context.mailbox.connectedByUid,
          })
        } catch (error) {
          console.error('[outreach] the reply task could not be filed', error)
        }
      }
      // A lead somebody wrote back to is being worked (AGL-3234).
      if (enrollment.target === 'lead' && enrollment.leadId) {
        await markOutreachLeadWorking(firestore, { hostId: enrollment.hostId, leadId: enrollment.leadId })
      }
      context.delta.replies += 1
      event = { type: 'reply', atMs: decidedBy?.atMs || nowMs, detail: decidedBy?.evidence ?? null }
      report.replies += 1
      // Once per enrollment (AGL-3254): a reply moves the status to
      // `replied`, and nothing is synced for it again.
      await creditOutreachReply(deps, { enrollment, atMs: event.atMs })
      break
    }
    case 'bounced': {
      const diagnostic = scrubbedOutreachDiagnostic(decidedBy?.bounce?.diagnostic ?? decidedBy?.bounce?.status ?? null, enrollment.email)
      await deps.suppressBouncedEmail({ email: enrollment.email, hostId: enrollment.hostId })
      await addOutreachDoNotContact(firestore, {
        orgId: context.orgId,
        email: enrollment.email,
        reason: 'hard_bounce',
        source: 'runtime',
        nowMs,
        enrollmentId: enrollment.id,
        sequenceId: enrollment.sequenceId,
        detail: diagnostic,
      })
      let detail = diagnostic
      // A gateway block is the domain's verdict on the sender (AGL-3244):
      // the domain is filed beside the address, and the enrollment says so.
      // Never a public mailbox provider's domain — Gmail refusing one
      // message on policy is not a reason to stop writing to Gmail.
      const domain = outreachEmailDomain(enrollment.email)
      const gateway = isOutreachGatewayBlock(decidedBy?.bounce ?? null)
      if (domain && !isPublicMailboxDomain(domain) && gateway) {
        await addOutreachDoNotContactDomain(firestore, {
          orgId: context.orgId,
          domain,
          reason: 'gateway_block',
          source: 'runtime',
          nowMs,
          enrollmentId: enrollment.id,
          sequenceId: enrollment.sequenceId,
          detail: diagnostic,
        })
        detail = outreachGatewayBlockDetail(domain, diagnostic)
        report.gatewayBlocks += 1
      }
      const bouncedAtMs = decidedBy?.atMs || nowMs
      // The record the person is says so too (AGL-3245): the verdict on the
      // lead and the contact, and the bounce on the send's own timeline
      // entry, so the record reads Sent, then Bounced.
      await deps.stampRecordEmailState({
        orgId: context.orgId,
        email: enrollment.email,
        state: {
          status: gateway ? 'blocked' : 'bounced',
          atMs: bouncedAtMs,
          source: 'sequence',
          detail: diagnostic,
          enrollmentId: enrollment.id,
        },
      })
      await markOutreachEmailDelivery(deps, {
        orgId: context.orgId,
        messageId: lastSentMessageId,
        state: 'bounced',
        atMs: bouncedAtMs,
        detail: diagnostic,
      })
      event = { type: 'bounce', atMs: bouncedAtMs, detail }
      report.bounces += 1
      break
    }
    case 'postpone': {
      const sequence = await sequenceOf(context, enrollment.sequenceId)
      postponedTo = postponeOutreachForAutoReply({
        nextDueAtMs: enrollment.nextDueAtMs,
        receivedAtMs: decidedBy?.atMs || nowMs,
        timeZone: context.mailbox.timezone,
        window: effectiveOutreachWindow(sequence?.settings.window, context.mailbox.window),
        random: deps.random,
      })
      break
    }
    default:
      break
  }

  const outcome = await applyOutreachEvent(firestore, {
    orgId: context.orgId,
    enrollmentId: enrollment.id,
    event,
    extra: (current) => {
      const extra: Record<string, unknown> = {
        syncedMessageIds: [...(current.syncedMessageIds ?? []), ...freshIds].slice(-ENROLLMENT_HANDLED_MAX),
      }
      const waiting = current.status === 'active' || current.status === 'paused'
      if (postponedTo !== null && waiting && current.nextDueAtMs !== null && postponedTo > current.nextDueAtMs) {
        extra['nextDueAtMs'] = postponedTo
      }
      return extra
    },
    nowMs,
  })
  if (postponedTo !== null && outcome.enrollment?.nextDueAtMs === postponedTo) report.postponed += 1
  // The run's own view of the enrollment moves with it, so a second message
  // of it in this run is judged against what this one did.
  if (outcome.enrollment) Object.assign(enrollment, outcome.enrollment)
}
