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

import type { PluginWebApiHandler } from '@aglyn/aglyn/server'
import { randomUUID } from 'node:crypto'
import {
  composeOutreachManualReply,
  mergeOutreachInboundMessages,
  outreachEnrollmentHasInbound,
  outreachInboundMessagesOf,
  outreachMailboxAddress,
  outreachManualReplyRefusal,
  outreachMessageToAnswer,
  outreachReplySubject,
  type OutreachManualReplyRefusal,
} from '../engine/manual-reply'
import { outreachThreadMessageFromGmail, type OutreachThreadMessage } from '../engine/thread-message'
import { mailboxRef } from '../mailboxes/mailbox-credentials'
import { outreachLocalDay } from '../mailboxes/mailbox-settings'
import {
  markOutreachMailboxReconnectRequired,
  type OpenedOutreachMailbox,
} from '../mailboxes/mailbox-transport'
import type {
  OutreachEnrollmentReplyResponse,
  OutreachEnrollmentThreadResponse,
  OutreachReplyDraft,
} from '../model/outreach-api'
import type {
  OutreachEnrollment,
  OutreachInboundMessage,
  OutreachMailbox,
  OutreachStepRecord,
} from '../model/outreach.types'
import { fileOutreachEmail } from '../runtime/timeline'
import { outreachUnsubscribeMailbox } from '../runtime/unsubscribe-link'
import {
  lookupOutreachDoNotContact,
  lookupOutreachDoNotContactDomains,
} from '../storage/do-not-contact-store'
import {
  outreachEnrollmentLink,
  outreachOrgCollection,
  readStoredOutreachEnrollment,
  readStoredOutreachMailbox,
} from '../storage/outreach-records'
import type { OutreachMailClient } from '../transport/mail-client'
import { GmailTransportError, googleFailureAnswer, isReconnectRequired } from '../transport/gmail-errors'
import { Rfc5322MessageError } from '../transport/rfc5322'
import { sendOutreachReply } from '../transport/send-message'
import type { OutreachEnrollRouteDeps } from './enroll-routes'
import type { OutreachRouteCaller } from './route-gate'
import { outreachRouteGate } from './route-gate'
import {
  outreachMethodNotAllowed,
  outreachOk,
  outreachRefusal,
  readOutreachDocumentId,
  readOutreachJsonBody,
} from './route-http'

/**
 * ANSWERING A PERSON WHO WROTE BACK (AGL-4020): `outreach/enrollments/thread`
 * and `outreach/enrollments/reply`.
 *
 * A person who answered a sequence email is answered by a member, from the
 * enrollment's own mailbox, in the same thread — never from the platform's
 * mail service, which carries no prospecting, and never as a new thread.
 * The engine writes the answer (`engine/manual-reply.ts`); these routes read
 * what it answers, check what still refuses, and send it.
 *
 * ## What the person wrote
 *
 * The sync keeps every message of theirs on the enrollment. A reply synced
 * before they were kept is on the enrollment only as an id, so when the
 * enrollment says someone wrote back and keeps nothing they wrote, the
 * `thread` route reads the enrollment's threads in the mailbox — and, when
 * they answered in a thread of their own, the messages from their address
 * since they were enrolled — and keeps what it finds. That read is made only
 * for a member who may send from the mailbox: nobody reads another member's
 * mail through these routes.
 *
 * ## The answer is no step of the sequence
 *
 * It is kept as a `manual_reply` step record and filed on the person's CRM
 * record. It never restarts the sequence or moves its step; it never counts
 * against the mailbox's daily cap, joins the sends a bounce rate is judged
 * over, or bumps the sequence's figures. The mailbox counts it apart, on
 * `health.daily.<day>.manualReplies`, so it can never pause the mailbox.
 * Its `Message-ID` joins the enrollment's when it went into the current
 * thread, so a later step of an enrollment still running answers it, and
 * the enrollment's `lastSentAtMs` moves, which keeps the thread watched for
 * what the person writes next.
 *
 * ## Once
 *
 * The composer mints a key per answer, which becomes its `Message-ID`. The
 * answer is claimed in a transaction before it is sent: a retry of the same
 * answer that already went is answered with its record, and a second answer
 * while one is in flight is refused. A send that fails hands the claim back.
 */

/** Answers one mailbox may send in an hour: a conversation, not a campaign. */
export const OUTREACH_MANUAL_REPLIES_PER_HOUR = 30

/** How long a claim on an answer holds before another answer may go. */
const REPLY_CLAIM_STALE_MS = 2 * 60_000

/** The most of an enrollment's threads one read opens, newest first. */
const THREADS_READ_MAX = 5

/** The most messages from the person's address one read opens, outside those threads. */
const OWN_THREAD_MESSAGES_MAX = 10

/** A reply key as the composer mints one: a UUID, or anything as plain. */
const REPLY_KEY = /^[A-Za-z0-9][A-Za-z0-9-]{7,63}$/

/** The routes' reach beyond the shared route deps: the mailbox, and the platform's rate limit. */
export interface OutreachReplyDeps {
  /** Opens a mailbox's client from its sealed grant. */
  openMailbox(mailboxId: string): Promise<OpenedOutreachMailbox>
  consumeRateLimit(key: string, options: { limit: number; windowMs: number }): Promise<{ allowed: boolean }>
}

type Firestore = FirebaseFirestore.Firestore

interface Loaded {
  enrollment: OutreachEnrollment
  mailbox: OutreachMailbox | null
}

/** The enrollment, and the mailbox an answer goes from: its own, else its sequence's. */
async function loadEnrollment(firestore: Firestore, orgId: string, enrollmentId: string): Promise<Loaded | null> {
  const snapshot = await outreachOrgCollection(firestore, orgId, 'enrollments').doc(enrollmentId).get()
  const enrollment = readStoredOutreachEnrollment(enrollmentId, snapshot.exists ? snapshot.data() : undefined)
  if (!enrollment) return null
  let mailboxId = enrollment.mailboxId
  if (!mailboxId && enrollment.sequenceId) {
    const sequence = await outreachOrgCollection(firestore, orgId, 'sequences').doc(enrollment.sequenceId).get()
    mailboxId = String(sequence.exists ? (sequence.get('mailboxId') ?? '') : '')
  }
  if (!mailboxId) return { enrollment, mailbox: null }
  const box = await mailboxRef(firestore, orgId, mailboxId).get()
  return { enrollment, mailbox: readStoredOutreachMailbox(mailboxId, box.exists ? box.data() : undefined) }
}

/** The member is the mailbox's own, or an organization owner or admin. */
const mayUseMailbox = (caller: OutreachRouteCaller, mailbox: OutreachMailbox | null) =>
  Boolean(mailbox) && (mailbox?.connectedByUid === caller.uid || caller.isOrgAdmin)

/** The mailbox's own addresses: the account's, and every alias it sends as. */
const selfAddressesOf = (mailbox: OutreachMailbox) =>
  [mailbox.email, mailbox.sendAs, ...(mailbox.sendAsOptions ?? []).map((option) => option.email)].filter(Boolean)

/**
 * What the person wrote, read from the mailbox: the enrollment's threads,
 * newest first, and — when none holds a message of theirs — the messages
 * from their address since they were enrolled.
 */
async function readMailboxInbound(
  client: OutreachMailClient,
  enrollment: OutreachEnrollment,
  mailbox: OutreachMailbox,
): Promise<OutreachInboundMessage[]> {
  const context = {
    selfAddresses: selfAddressesOf(mailbox),
    unsubscribeAddress: outreachUnsubscribeMailbox(mailbox.email)?.address ?? null,
    threadSubject: enrollment.threadSubject,
  }
  const threads = [
    ...new Set([...(enrollment.gmailThreadIds ?? []), enrollment.gmailThreadId].filter((id): id is string => Boolean(id))),
  ]
    .reverse()
    .slice(0, THREADS_READ_MAX)
  const messages: OutreachThreadMessage[] = []
  for (const threadId of threads) {
    const thread = await client.getFullThread(threadId)
    messages.push(...thread.messages.map(outreachThreadMessageFromGmail))
  }
  let found = outreachInboundMessagesOf(messages, context)
  if (!found.length && enrollment.email) {
    const listed = await client.searchMessages(
      { afterMs: enrollment.createdAtMs || 0, from: [enrollment.email] },
      { maxResults: OWN_THREAD_MESSAGES_MAX },
    )
    const own: OutreachThreadMessage[] = []
    for (const stub of listed.messages.slice(0, OWN_THREAD_MESSAGES_MAX)) {
      own.push(outreachThreadMessageFromGmail(await client.getFullMessage(stub.id)))
    }
    found = outreachInboundMessagesOf(own, context)
  }
  return found
}

/** Keeps what the mailbox held on the enrollment; answers the enrollment as stored. */
async function keepInbound(
  firestore: Firestore,
  orgId: string,
  enrollment: OutreachEnrollment,
  found: readonly OutreachInboundMessage[],
  nowMs: number,
): Promise<OutreachEnrollment> {
  const ref = outreachOrgCollection(firestore, orgId, 'enrollments').doc(enrollment.id)
  return firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref)
    const current = readStoredOutreachEnrollment(enrollment.id, snapshot.exists ? snapshot.data() : undefined)
    if (!current) return enrollment
    const inboundMessages = mergeOutreachInboundMessages(current.inboundMessages, found)
    transaction.update(ref, { inboundMessages, updatedAtMs: nowMs })
    return { ...current, inboundMessages, updatedAtMs: nowMs }
  })
}

type InboundRead =
  | { ok: true; enrollment: OutreachEnrollment; readMailbox: boolean }
  | { ok: false; response: Response }

/**
 * The enrollment with what the person wrote: as kept, or — when it says
 * they wrote back and keeps nothing — read from the mailbox and kept.
 */
async function withInbound(
  deps: OutreachEnrollRouteDeps,
  replyDeps: OutreachReplyDeps,
  caller: OutreachRouteCaller,
  loaded: Loaded,
): Promise<InboundRead> {
  const { enrollment, mailbox } = loaded
  const unread =
    !enrollment.inboundMessages?.length &&
    outreachEnrollmentHasInbound(enrollment) &&
    mailbox !== null &&
    (mailbox.status === 'connected' || mailbox.status === 'paused') &&
    mayUseMailbox(caller, mailbox)
  if (!unread || !mailbox) return { ok: true, enrollment, readMailbox: false }
  const firestore = deps.firestore()
  const nowMs = deps.now()
  const opened = await replyDeps.openMailbox(mailbox.id)
  if (opened.ok === false) {
    if (opened.reason === 'not-configured') return { ok: true, enrollment, readMailbox: false }
    await markOutreachMailboxReconnectRequired(firestore, {
      orgId: caller.orgId,
      mailboxId: mailbox.id,
      errorCode: opened.reason,
      nowMs,
    })
    mailbox.status = 'reconnect_required'
    return { ok: true, enrollment, readMailbox: false }
  }
  let found: OutreachInboundMessage[]
  try {
    found = await readMailboxInbound(opened.client, enrollment, mailbox)
  } catch (error) {
    if (isReconnectRequired(error)) {
      await markOutreachMailboxReconnectRequired(firestore, {
        orgId: caller.orgId,
        mailboxId: mailbox.id,
        errorCode: error instanceof GmailTransportError ? error.code : 'invalid_grant',
        nowMs,
      })
      mailbox.status = 'reconnect_required'
      return { ok: true, enrollment, readMailbox: false }
    }
    if (!(error instanceof GmailTransportError)) throw error
    const answer = googleFailureAnswer(error, 'reply thread read')
    return { ok: false, response: outreachRefusal(answer.status, answer.reason, answer.error) }
  }
  if (!found.length) return { ok: true, enrollment, readMailbox: true }
  return { ok: true, enrollment: await keepInbound(firestore, caller.orgId, enrollment, found, nowMs), readMailbox: true }
}

/** Every gate an answer still passes — see `outreachManualReplyRefusal`. */
async function refusalFor(
  firestore: Firestore,
  caller: OutreachRouteCaller,
  enrollment: OutreachEnrollment,
  mailbox: OutreachMailbox | null,
  to: string | null,
): Promise<OutreachManualReplyRefusal | null> {
  const recipients = [...new Set([enrollment.email, to].filter((address): address is string => Boolean(address)))]
  const [addresses, domains] = await Promise.all([
    lookupOutreachDoNotContact(firestore, caller.orgId, recipients),
    lookupOutreachDoNotContactDomains(firestore, caller.orgId, recipients),
  ])
  const fold = (answers: Map<string, boolean | null>): boolean | null => {
    const values = recipients.map((address) => answers.get(address) ?? null)
    if (values.includes(true)) return true
    return values.includes(null) ? null : false
  }
  return outreachManualReplyRefusal({
    enrollment,
    doNotContact: fold(addresses),
    doNotContactDomain: fold(domains),
    mailbox,
    mayUseMailbox: mayUseMailbox(caller, mailbox),
  })
}

/** Where an answer to the newest message would go, from what, under what subject. */
function draftFor(enrollment: OutreachEnrollment, mailbox: OutreachMailbox | null): OutreachReplyDraft | null {
  const answering = outreachMessageToAnswer(enrollment.inboundMessages)
  if (!answering || !mailbox) return null
  return {
    answerId: answering.id,
    to: answering.replyTo ?? answering.from,
    subject: outreachReplySubject(answering, enrollment.threadSubject),
    // A mailbox connected before Microsoft ones existed names no provider: it is Google's.
    from: { address: outreachMailboxAddress(mailbox), name: mailbox.displayName || '', provider: mailbox.provider ?? 'google' },
  }
}

const REFUSAL_STATUS: Record<OutreachManualReplyRefusal['code'], number> = {
  'opted-out': 409,
  bounced: 409,
  'do-not-contact': 409,
  unchecked: 503,
  'mailbox-unavailable': 409,
  permission: 403,
}

/** `outreach/enrollments/thread` — see the module note. */
export function createOutreachEnrollmentThreadRoute(
  deps: OutreachEnrollRouteDeps,
  replyDeps: OutreachReplyDeps,
): PluginWebApiHandler {
  return async (request) => {
    if (request.method !== 'POST') return outreachMethodNotAllowed('POST')
    const body = await readOutreachJsonBody(request)
    const caller = await outreachRouteGate(request, body['orgId'], deps.gate)
    if (caller instanceof Response) return caller
    const enrollmentId = readOutreachDocumentId(body['enrollmentId'])
    if (!enrollmentId) return outreachRefusal(400, 'invalid-request', 'Name the enrollment.')
    const firestore = deps.firestore()
    const loaded = await loadEnrollment(firestore, caller.orgId, enrollmentId)
    if (!loaded) return outreachRefusal(404, 'enrollment-not-found', 'That enrollment no longer exists.')
    const read = await withInbound(deps, replyDeps, caller, loaded)
    if (read.ok === false) return read.response
    const { enrollment, readMailbox } = read
    const draft = draftFor(enrollment, loaded.mailbox)
    const refusal = draft ? await refusalFor(firestore, caller, enrollment, loaded.mailbox, draft.to) : null
    return outreachOk({
      ok: true,
      enrollment,
      inboundMessages: enrollment.inboundMessages ?? [],
      draft,
      refusal,
      readMailbox,
    } satisfies OutreachEnrollmentThreadResponse)
  }
}

/** `outreach/enrollments/reply` — see the module note. */
export function createOutreachEnrollmentReplyRoute(
  deps: OutreachEnrollRouteDeps,
  replyDeps: OutreachReplyDeps,
): PluginWebApiHandler {
  return async (request) => {
    if (request.method !== 'POST') return outreachMethodNotAllowed('POST')
    const body = await readOutreachJsonBody(request)
    const caller = await outreachRouteGate(request, body['orgId'], deps.gate)
    if (caller instanceof Response) return caller
    const enrollmentId = readOutreachDocumentId(body['enrollmentId'])
    if (!enrollmentId) return outreachRefusal(400, 'invalid-request', 'Name the enrollment.')
    const named = typeof body['replyKey'] === 'string' ? body['replyKey'].trim() : ''
    if (named && !REPLY_KEY.test(named)) return outreachRefusal(400, 'invalid-request', 'That reply key is not one the composer mints.')
    const replyKey = named || randomUUID()
    const answerId = typeof body['answerId'] === 'string' ? body['answerId'].trim() : null

    const firestore = deps.firestore()
    const loaded = await loadEnrollment(firestore, caller.orgId, enrollmentId)
    if (!loaded) return outreachRefusal(404, 'enrollment-not-found', 'That enrollment no longer exists.')
    const read = await withInbound(deps, replyDeps, caller, loaded)
    if (read.ok === false) return read.response
    const { mailbox } = loaded
    const answering = outreachMessageToAnswer(read.enrollment.inboundMessages, answerId)
    if (!answering) {
      return outreachRefusal(
        409,
        'nothing-to-answer',
        answerId
          ? 'That message of theirs is not one this enrollment kept.'
          : 'Nothing they wrote could be read, so there is nothing to answer here yet.',
      )
    }
    const composed = composeOutreachManualReply({
      enrollment: read.enrollment,
      answering,
      body: body['body'],
      timeZone: mailbox?.timezone,
    })
    if (composed.error || !composed.reply) {
      return outreachRefusal(400, 'invalid-request', composed.error?.message ?? 'The answer could not be written.')
    }
    const reply = composed.reply
    const refused = await refusalFor(firestore, caller, read.enrollment, mailbox, reply.to)
    if (refused || !mailbox) {
      const refusal = refused ?? { code: 'mailbox-unavailable' as const, message: 'The mailbox is no longer connected.' }
      return outreachRefusal(
        REFUSAL_STATUS[refusal.code],
        refusal.code === 'permission' ? 'permission' : 'reply-refused',
        refusal.message,
      )
    }
    const limited = await replyDeps.consumeRateLimit(`outreach-manual-reply:${mailbox.id}`, {
      limit: OUTREACH_MANUAL_REPLIES_PER_HOUR,
      windowMs: 60 * 60_000,
    })
    if (!limited.allowed) {
      return outreachRefusal(
        429,
        'rate-limited',
        `A mailbox can send ${OUTREACH_MANUAL_REPLIES_PER_HOUR} answers an hour. Try again later.`,
      )
    }

    const sender = { address: outreachMailboxAddress(mailbox), name: mailbox.displayName || null }
    const domain = sender.address.slice(sender.address.lastIndexOf('@') + 1)
    const messageId = `<${replyKey}@${domain}>`
    const ref = outreachOrgCollection(firestore, caller.orgId, 'enrollments').doc(enrollmentId)

    // Claimed before it is sent: a retry of this answer, or a second one in flight.
    const claim = await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref)
      const current = readStoredOutreachEnrollment(enrollmentId, snapshot.exists ? snapshot.data() : undefined)
      if (!current) return { kind: 'gone' as const }
      const sent = (current.stepRecords ?? []).find(
        (record) => record.kind === 'manual_reply' && (record.replyKey === replyKey || record.messageId === messageId),
      )
      if (sent) return { kind: 'sent' as const, enrollment: current, record: sent }
      const held = current.replyClaim
      if (held && deps.now() - held.atMs < REPLY_CLAIM_STALE_MS) return { kind: 'busy' as const }
      transaction.update(ref, { replyClaim: { messageId, byUid: caller.uid, atMs: deps.now() } })
      return { kind: 'claimed' as const }
    })
    if (claim.kind === 'gone') return outreachRefusal(404, 'enrollment-not-found', 'That enrollment no longer exists.')
    if (claim.kind === 'busy') {
      return outreachRefusal(409, 'reply-in-flight', 'An answer to them is already being sent. Wait a moment and look again.')
    }
    if (claim.kind === 'sent') {
      return outreachOk({
        ok: true,
        enrollment: claim.enrollment,
        record: claim.record,
        sentTo: claim.record.to ?? reply.to,
        subject: claim.record.subject ?? reply.subject,
        alreadySent: true,
      } satisfies OutreachEnrollmentReplyResponse)
    }
    const release = () =>
      ref.update({ replyClaim: null }).catch((error: unknown) => {
        console.error('[outreach] an answer’s claim could not be handed back', error)
      })

    const nowMs = deps.now()
    const opened = await replyDeps.openMailbox(mailbox.id)
    if (opened.ok === false) {
      await release()
      if (opened.reason === 'not-configured') {
        return outreachRefusal(503, 'mailbox-unavailable', 'Mailboxes are not set up on this deployment.')
      }
      await markOutreachMailboxReconnectRequired(firestore, {
        orgId: caller.orgId,
        mailboxId: mailbox.id,
        errorCode: opened.reason,
        nowMs,
      })
      return outreachRefusal(
        409,
        'mailbox-unavailable',
        `${sender.address} needs to be connected again. Reconnect it on the Mailboxes page to answer from it.`,
      )
    }
    let sent: Awaited<ReturnType<typeof sendOutreachReply>>
    try {
      sent = await sendOutreachReply(opened.client, reply, sender, {
        messageIdLocalPart: replyKey,
        messageIdDomain: domain,
      })
    } catch (error) {
      await release()
      if (error instanceof Rfc5322MessageError) {
        return outreachRefusal(400, 'invalid-request', `The answer could not be written: ${error.message}`)
      }
      if (error instanceof GmailTransportError && error.reconnectRequired) {
        await markOutreachMailboxReconnectRequired(firestore, {
          orgId: caller.orgId,
          mailboxId: mailbox.id,
          errorCode: error.code,
          nowMs,
        })
        return outreachRefusal(
          409,
          'mailbox-unavailable',
          `The mail provider refused ${sender.address}’s access. Reconnect it on the Mailboxes page to answer from it.`,
        )
      }
      const answer = googleFailureAnswer(error, 'manual reply send')
      return outreachRefusal(answer.status, answer.reason, answer.error)
    }

    const atMs = deps.now()
    const record: OutreachStepRecord = {
      stepIndex: read.enrollment.stepIndex,
      stepId: '',
      kind: 'manual_reply',
      atMs,
      byUid: caller.uid,
      from: sender.address,
      to: reply.to,
      body: reply.body,
      replyKey,
      gmailMessageId: sent.gmailMessageId,
      gmailThreadId: sent.threadId,
      messageId: sent.messageId,
      subject: sent.subject,
      ...(reply.inReplyTo ? { inReplyTo: reply.inReplyTo } : {}),
    }
    const enrollment = await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref)
      const current = readStoredOutreachEnrollment(enrollmentId, snapshot.exists ? snapshot.data() : undefined)
      if (!current) return null
      const patch: Record<string, unknown> = {
        stepRecords: [...(current.stepRecords ?? []), record].slice(-20),
        replyClaim: null,
        // The thread is watched for what they write next, and the
        // enrollments table reads this as the last thing that happened.
        lastSentAtMs: atMs,
        updatedAtMs: atMs,
      }
      if (sent.threadId && !current.gmailThreadIds.includes(sent.threadId)) {
        patch['gmailThreadIds'] = [...current.gmailThreadIds, sent.threadId]
      }
      // Into the current thread: a later step answers this answer.
      if (sent.threadId && sent.threadId === current.gmailThreadId && !current.messageIds.includes(sent.messageId)) {
        patch['messageIds'] = [...current.messageIds, sent.messageId]
      }
      transaction.update(ref, patch)
      return { ...current, ...patch } as OutreachEnrollment
    })
    await countManualReply(firestore, caller.orgId, mailbox, atMs)
    await fileOutreachEmail(deps, {
      orgId: caller.orgId,
      hostId: read.enrollment.hostId,
      link: outreachEnrollmentLink(read.enrollment),
      direction: 'outbound',
      subject: sent.subject,
      from: sender.address,
      to: reply.to,
      messageId: sent.messageId,
      inReplyTo: reply.inReplyTo,
      body: reply.body,
      atMs,
      byUid: caller.uid,
      byName: mailbox.connectedByUid === caller.uid ? mailbox.displayName || null : null,
    })
    return outreachOk({
      ok: true,
      enrollment: enrollment ?? read.enrollment,
      record,
      sentTo: reply.to,
      subject: sent.subject,
      alreadySent: false,
    } satisfies OutreachEnrollmentReplyResponse)
  }
}

/**
 * One more answer on the mailbox's local day, in
 * `health.daily.<day>.manualReplies` beside the day's sends and never in
 * them. Bookkeeping beside the act: the answer has left, so a failure is
 * logged.
 */
async function countManualReply(
  firestore: Firestore,
  orgId: string,
  mailbox: OutreachMailbox,
  nowMs: number,
): Promise<void> {
  const ref = mailboxRef(firestore, orgId, mailbox.id)
  try {
    await firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref)
      const stored = readStoredOutreachMailbox(mailbox.id, snapshot.exists ? snapshot.data() : undefined)
      if (!stored) return
      const day = outreachLocalDay(nowMs, stored.timezone)
      const counts = stored.health?.daily?.[day] ?? { sent: 0, bounces: 0, replies: 0 }
      const manualReplies = Math.max(0, Number(counts.manualReplies) || 0) + 1
      transaction.update(ref, { [`health.daily.${day}`]: { ...counts, manualReplies }, updatedAtMs: nowMs })
    })
  } catch (error) {
    console.warn('[outreach] an answer could not be counted on its mailbox', error)
  }
}
