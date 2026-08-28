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
 * THE PER-RECIPIENT DELIVERY LOG,
 * `emailDeliveries/{emailKey}/messages/{providerMessageId}`.
 *
 * ## What it answers
 *
 * "Did this person get their invite, and did they open it?" — the question
 * every support conversation about a missing email starts with, and the one
 * that until now could only be answered by signing into the sending provider
 * and searching a list that is not scoped to the account being discussed.
 *
 * ## Why a store, and where the provider still comes in
 *
 * The READ is always local. Fanning out to the ESP on render would put a
 * vendor at the centre of a staff screen, at three specific costs: lock-in to
 * a per-vendor list shape, a rolling retention window our own record outlives,
 * and a third-party round trip on every page view. Resend's list endpoint also
 * has no recipient filter at all, so a per-person lookup would mean paging the
 * whole account's history on each render.
 *
 * The WRITE has two sources, and the second exists because the first is not
 * enough on its own:
 *
 *  - **The event feed** ({@link recordEmailDeliveryEvent}) — live, complete,
 *    and the only source of open and click counts. It knows nothing about
 *    mail sent before it was connected.
 *  - **A history import** ({@link importEmailDeliveryHistory}) — a one-off
 *    (and re-runnable) sweep of the provider's own list, through the same
 *    neutral vocabulary. Without it the log is empty for every message that
 *    predates the webhook, which is exactly the mail a support question is
 *    about. A card that shows nothing for a person we demonstrably emailed is
 *    the failure this whole file exists to remove.
 *
 * ## Shape
 *
 * A subcollection per recipient rather than one flat collection with a `to`
 * field. The read is then a single ordered query inside one small collection
 * — no composite index to go missing, and no `where` clause whose absent
 * field would silently drop documents. The parent id is
 * {@link emailSuppressionKey}'s `sha256`, deliberately the SAME derivation the
 * suppression lists use, so the two can never disagree about which document
 * describes which person.
 *
 * One document per MESSAGE, not per event: `sent`, `delivered`, `opened` and
 * three `clicked`s are one row in the staff view, and an append-only event
 * collection would make the common read six documents instead of one. Opens
 * and clicks are counted rather than listed, because the count is the fact a
 * staffer uses and an unbounded array is how a document reaches the 1 MiB
 * limit on a mailing nobody was watching.
 *
 * ## Never throws
 *
 * Every function here is best-effort, on the same reasoning as the rest of the
 * mail path: a webhook must acknowledge the provider, and a staff page must
 * render, whatever Firestore is doing. A failed write loses a row from a log;
 * a thrown one loses the delivery event AND teaches the provider to retry.
 */

import { FieldValue } from 'firebase-admin/firestore'
import {
  type EmailDeliveryEvent,
  type EmailDeliveryEventType,
  type EmailDeliveryHistorySource,
  type EmailDeliverySnapshot,
  worstDeliveryStatus,
} from '@aglyn/shared-util-email'
import { emailSuppressionKey } from './email-suppression'
import firebaseAdmin from './firebase-admin'

const defaultFirestore = () => firebaseAdmin.app().firestore()

export const EMAIL_DELIVERIES_COLLECTION = 'emailDeliveries'
export const EMAIL_DELIVERY_MESSAGES_COLLECTION = 'messages'

/** The most messages one staff read will return. */
export const EMAIL_DELIVERY_READ_LIMIT = 50

/**
 * The most distinct links one message records.
 *
 * A newsletter with forty links clicked by one reader must not grow the
 * document without bound; the first few tell a staffer what they need.
 */
export const EMAIL_DELIVERY_MAX_LINKS = 10

/** One message as the staff view reads it. */
export interface EmailDeliveryRecord {
  /** The provider's message id — also the document id. */
  messageId: string
  provider: string
  to: string
  subject: string | null
  /** The sender label, e.g. `'invite'`. Null for a send that carried none. */
  context: string | null
  /** Furthest-along (worst) lifecycle state seen. */
  status: EmailDeliveryEventType
  /** Epoch ms per state, absent for states that never happened. */
  timestamps: Partial<Record<EmailDeliveryEventType, number>>
  /** First event we saw for this message. Always present — the sort key. */
  firstSeenAtMs: number
  openCount: number
  clickCount: number
  /** Distinct destinations followed, capped. */
  clickedLinks: string[]
  bounceType: string | null
  detail: string | null
  hostId: string | null
  campaignId: string | null
}

/**
 * Records one normalized event against its message.
 *
 * A transaction rather than a merge-set, for one property that matters to the
 * reader: `firstSeenAtMs` must be written exactly once and must never be
 * absent. Events arrive out of order — an `opened` can beat its own `sent`
 * through the queue — so "create with the first event's time, then leave it
 * alone" needs a read in the same atomic step as the write. A document missing
 * that field would be dropped from the `orderBy` read entirely and the message
 * would simply not appear, which is the failure mode a delivery log can least
 * afford.
 *
 * @returns whether a row was written. `false` is the ordinary answer for an
 *          address that is not an address; it is never an error.
 */
export async function recordEmailDeliveryEvent(
  event: EmailDeliveryEvent,
  firestore?: any,
): Promise<boolean> {
  const key = emailSuppressionKey(event.to)
  if (!key || !event.providerMessageId) return false

  try {
    const db = firestore ?? defaultFirestore()
    const ref = db
      .collection(EMAIL_DELIVERIES_COLLECTION)
      .doc(key)
      .collection(EMAIL_DELIVERY_MESSAGES_COLLECTION)
      .doc(event.providerMessageId)

    await db.runTransaction(async (transaction: any) => {
      const snapshot = await transaction.get(ref)
      const existing = (snapshot.exists ? snapshot.data() : null) ?? {}

      const update: Record<string, unknown> = {
        messageId: event.providerMessageId,
        provider: event.provider,
        to: event.to,
        status: worstDeliveryStatus(existing.status, event.type),
        [`timestamps.${event.type}`]: event.at,
        lastEventAtMs: event.at,
        updatedAt: FieldValue.serverTimestamp(),
      }

      // Written once. A later event for the same message carries the same
      // subject, but an `email.opened` payload may carry none at all — and
      // overwriting a known subject with null is how a staff row loses the
      // only thing that identifies it.
      if (!snapshot.exists) update.firstSeenAtMs = event.at
      if (event.subject && !existing.subject) update.subject = event.subject
      if (event.context && !existing.context) update.context = event.context
      if (event.tags?.hostId && !existing.hostId)
        update.hostId = event.tags.hostId
      if (event.tags?.campaignId && !existing.campaignId)
        update.campaignId = event.tags.campaignId
      if (event.bounceType) update.bounceType = event.bounceType
      if (event.detail) update.detail = event.detail

      if (event.type === 'opened') update.openCount = FieldValue.increment(1)
      if (event.type === 'clicked') {
        update.clickCount = FieldValue.increment(1)
        if (event.link) {
          const links: string[] = Array.isArray(existing.clickedLinks)
            ? existing.clickedLinks.map(String)
            : []
          if (
            !links.includes(event.link) &&
            links.length < EMAIL_DELIVERY_MAX_LINKS
          ) {
            update.clickedLinks = [...links, event.link]
          }
        }
      }

      transaction.set(ref, update, { merge: true })
    })
    return true
  } catch (error) {
    console.error(
      '[email-delivery-log] write failed',
      event.providerMessageId,
      error,
    )
    return false
  }
}

/**
 * Records one message the PROVIDER already knows about — the history import.
 *
 * ## Why this is not just `recordEmailDeliveryEvent` with a made-up event
 *
 * A snapshot is weaker evidence than an event, in two specific ways, and
 * writing it as an event would silently promote it:
 *
 *  - **It carries no counts.** A provider's list reports one `last_event` per
 *    message and no engagement detail, so `opened` means "at least once" and
 *    can never mean "three times". Incrementing `openCount` from a snapshot
 *    would invent a number, and re-running the import would invent it again.
 *  - **It can be STALER than what we already hold.** The event feed is live;
 *    an import is a page of results fetched some time ago. So the status is
 *    merged with {@link worstDeliveryStatus} rather than assigned, and a row
 *    the webhook has already advanced is never walked backwards.
 *
 * Everything else it fills is a gap-fill only: `subject` and `sentAt` are
 * written when absent and left alone when present. The net effect is that
 * importing history is idempotent and can be run as often as you like, and a
 * message the event feed has covered is untouched by it.
 *
 * `context` is deliberately NOT recoverable here. It comes from a send tag,
 * and the list endpoint does not return tags — so an imported row shows the
 * subject and the status but cannot say which of our senders produced it. The
 * card renders that absence rather than guessing.
 *
 * @returns whether a row was written or updated.
 */
export async function recordEmailDeliverySnapshot(
  snapshot: EmailDeliverySnapshot,
  firestore?: any,
): Promise<boolean> {
  const key = emailSuppressionKey(snapshot.to)
  if (!key || !snapshot.providerMessageId || !snapshot.sentAt) return false

  try {
    const db = firestore ?? defaultFirestore()
    const ref = db
      .collection(EMAIL_DELIVERIES_COLLECTION)
      .doc(key)
      .collection(EMAIL_DELIVERY_MESSAGES_COLLECTION)
      .doc(snapshot.providerMessageId)

    await db.runTransaction(async (transaction: any) => {
      const stored = await transaction.get(ref)
      const existing = (stored.exists ? stored.data() : null) ?? {}

      const update: Record<string, unknown> = {
        messageId: snapshot.providerMessageId,
        provider: snapshot.provider,
        to: snapshot.to,
        status: worstDeliveryStatus(existing.status, snapshot.status),
        importedAtMs: Date.now(),
        updatedAt: FieldValue.serverTimestamp(),
      }
      if (!stored.exists) update.firstSeenAtMs = snapshot.sentAt
      if (snapshot.subject && !existing.subject) update.subject = snapshot.subject
      // Only when the event feed has not already dated the send itself. An
      // imported `created_at` is the provider's, and so is the webhook's, but
      // the webhook's arrived with the rest of that message's truth.
      if (!existing.timestamps?.sent) {
        update['timestamps.sent'] = snapshot.sentAt
      }

      transaction.set(ref, update, { merge: true })
    })
    return true
  } catch (error) {
    console.error(
      '[email-delivery-log] snapshot write failed',
      snapshot.providerMessageId,
      error,
    )
    return false
  }
}

/** Records a batch, independently — one bad event must not lose the others. */
export async function recordEmailDeliveryEvents(
  events: EmailDeliveryEvent[],
  firestore?: any,
): Promise<number> {
  const results = await Promise.all(
    events.map((event) => recordEmailDeliveryEvent(event, firestore)),
  )
  return results.filter(Boolean).length
}

/** What one {@link importEmailDeliveryHistory} run did. */
export interface EmailDeliveryImportResult {
  /** Provider messages read. */
  scanned: number
  /** Per-recipient rows written or refreshed. */
  recorded: number
  pages: number
  /** Cursor to resume from, or null when the history was exhausted. */
  nextCursor: string | null
  /** True when the page budget ran out before the history did. */
  truncated: boolean
}

/** Default page budget for one import run. 100 messages per page. */
export const EMAIL_DELIVERY_IMPORT_MAX_PAGES = 20

/**
 * Imports already-sent mail from a provider into the log.
 *
 * Bounded by PAGES rather than run to completion: this is called from a
 * request handler, and an account with a large history would otherwise hold
 * one open until it timed out — losing every page it had already written,
 * because a partial import that reports nothing is indistinguishable from one
 * that did nothing. Instead it stops at the budget, returns `nextCursor`, and
 * the caller resumes. Every page is written before the next is fetched, so an
 * interrupted run keeps its work.
 *
 * Idempotent by construction — see {@link recordEmailDeliverySnapshot}: a
 * message the event feed already covered is not walked backwards, and
 * re-running invents no counts.
 *
 * The `source` is injected rather than constructed here. This module may not
 * know which provider is in use, and a test must be able to run the whole
 * loop — pagination, cursor handling, the stop condition — without a network.
 */
export async function importEmailDeliveryHistory(options: {
  source: EmailDeliveryHistorySource
  cursor?: string | null
  maxPages?: number
  firestore?: any
}): Promise<EmailDeliveryImportResult> {
  const maxPages = Math.max(1, options.maxPages ?? EMAIL_DELIVERY_IMPORT_MAX_PAGES)
  let cursor = options.cursor ?? null
  let scanned = 0
  let recorded = 0
  let pages = 0

  while (pages < maxPages) {
    const page = await options.source({ cursor })
    pages += 1
    scanned += page.snapshots.length
    for (const snapshot of page.snapshots) {
      if (await recordEmailDeliverySnapshot(snapshot, options.firestore)) {
        recorded += 1
      }
    }
    cursor = page.nextCursor
    if (!cursor) break
  }

  return {
    scanned,
    recorded,
    pages,
    nextCursor: cursor,
    truncated: Boolean(cursor),
  }
}

/**
 * The messages sent to one address, newest first.
 *
 * Ordered on `firstSeenAtMs`, which the writer guarantees on creation, rather
 * than on a per-state timestamp that only some rows carry: `orderBy` drops
 * every document missing the field, so ordering on `timestamps.sent` would
 * silently hide any message whose `sent` webhook never arrived — exactly the
 * message a staffer is looking for.
 *
 * @returns the rows, or an empty array. The caller distinguishes "none" from
 *          "could not read" through {@link readEmailDeliveryHistory}.
 */
export async function readEmailDeliveries(
  email: string | null | undefined,
  options?: { limit?: number; firestore?: any },
): Promise<EmailDeliveryRecord[]> {
  const key = emailSuppressionKey(email)
  if (!key) return []
  const db = options?.firestore ?? defaultFirestore()
  const snapshot = await db
    .collection(EMAIL_DELIVERIES_COLLECTION)
    .doc(key)
    .collection(EMAIL_DELIVERY_MESSAGES_COLLECTION)
    .orderBy('firstSeenAtMs', 'desc')
    .limit(Math.max(1, options?.limit ?? EMAIL_DELIVERY_READ_LIMIT))
    .get()

  return snapshot.docs.map((doc: any) => {
    const data = doc.data() ?? {}
    return {
      messageId: String(data.messageId ?? doc.id),
      provider: String(data.provider ?? 'unknown'),
      to: String(data.to ?? ''),
      subject: data.subject ?? null,
      context: data.context ?? null,
      status: (data.status ?? 'sent') as EmailDeliveryEventType,
      timestamps: (data.timestamps ?? {}) as EmailDeliveryRecord['timestamps'],
      firstSeenAtMs: Number(data.firstSeenAtMs ?? 0),
      openCount: Number(data.openCount ?? 0),
      clickCount: Number(data.clickCount ?? 0),
      clickedLinks: Array.isArray(data.clickedLinks)
        ? data.clickedLinks.map(String)
        : [],
      bounceType: data.bounceType ?? null,
      detail: data.detail ?? null,
      hostId: data.hostId ?? null,
      campaignId: data.campaignId ?? null,
    }
  })
}

/**
 * {@link readEmailDeliveries} with the read failure kept separate from an
 * empty result.
 *
 * The same shape `devices` uses on the staff detail route, for the same
 * reason: "we have no record of any email to this person" and "we could not
 * reach the log" lead a staffer to opposite next actions, and a card that
 * renders both as an empty table sends them down the wrong one.
 */
export async function readEmailDeliveryHistory(
  email: string | null | undefined,
  options?: { limit?: number; firestore?: any },
): Promise<{ lookupFailed: boolean; rows: EmailDeliveryRecord[] }> {
  try {
    return { lookupFailed: false, rows: await readEmailDeliveries(email, options) }
  } catch (error) {
    console.error('[email-delivery-log] read failed', error)
    return { lookupFailed: true, rows: [] }
  }
}

/**
 * Deletes everything recorded for one address.
 *
 * The log holds an address, the subjects sent to it and when they were opened
 * — personal data by any reading — so the erasure path has to be able to reach
 * it. Batched because a long-lived account can hold hundreds of rows and a
 * single `delete()` per document would be one round trip each.
 */
export async function eraseEmailDeliveries(
  email: string | null | undefined,
  firestore?: any,
): Promise<number> {
  const key = emailSuppressionKey(email)
  if (!key) return 0
  const db = firestore ?? defaultFirestore()
  const parent = db
    .collection(EMAIL_DELIVERIES_COLLECTION)
    .doc(key)
    .collection(EMAIL_DELIVERY_MESSAGES_COLLECTION)

  let removed = 0
  // Bounded loop rather than `while (true)`: a pathological collection must
  // not be able to hold an erasure request open indefinitely.
  for (let pass = 0; pass < 20; pass += 1) {
    const snapshot = await parent.limit(400).get()
    if (snapshot.empty) break
    const batch = db.batch()
    snapshot.docs.forEach((doc: any) => batch.delete(doc.ref))
    await batch.commit()
    removed += snapshot.size
    if (snapshot.size < 400) break
  }
  return removed
}
