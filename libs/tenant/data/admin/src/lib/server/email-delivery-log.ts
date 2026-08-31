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
import { eraseCampaignAttributionsForPersonKey } from './campaign-attribution-store'
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
 * What one {@link recordEmailDeliveryEvent} call did.
 *
 * `firstOfType` exists so a CAMPAIGN counter can be incremented once per
 * recipient without buying a read of its own. This transaction already holds
 * the message's prior state, and "has this message ever been opened before"
 * is the fact a distinct-openers count needs — deriving it here costs
 * nothing, and deriving it anywhere else costs a document read per event.
 *
 * It is also what makes those counters idempotent, on the same reasoning the
 * webhook's replay guard rests on: a redelivered or replayed event finds the
 * state already recorded and reports `false`, so the counter cannot be
 * incremented twice for one message's first open.
 */
export interface EmailDeliveryEventOutcome {
  /**
   * No event of this TYPE had been recorded against this message before.
   *
   * Read off `timestamps`, which is written for every event type, rather than
   * off `openCount`/`clickCount`, which exist for two of them.
   */
  firstOfType: boolean
  /** The message this event was recorded against. */
  providerMessageId: string
  /** The recipient, lowercased — the person the event is about. */
  to: string
  /** Which event this was. */
  type: EmailDeliveryEventType
  /** When it happened, epoch ms. */
  at: number
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
 * @returns the outcome, or `null` when nothing was written. `null` is the
 *          ordinary answer for an address that is not an address; it is never
 *          an error.
 */
export async function recordEmailDeliveryEvent(
  event: EmailDeliveryEvent,
  firestore?: any,
): Promise<EmailDeliveryEventOutcome | null> {
  const key = emailSuppressionKey(event.to)
  if (!key || !event.providerMessageId) return null

  let firstOfType = false
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

      /*
       * Set INSIDE the transaction body, which may run more than once: a
       * Firestore transaction retries on contention, and a value computed
       * before the retry would describe the state that lost the race. This
       * assignment (not `||=`) makes the last attempt — the one whose write
       * committed — the one whose reading is reported.
       */
      firstOfType = !(
        existing.timestamps && existing.timestamps[event.type] !== undefined
      )

      const update: Record<string, unknown> = {
        messageId: event.providerMessageId,
        provider: event.provider,
        to: event.to,
        status: worstDeliveryStatus(existing.status, event.type),
        /*
         * A NESTED MAP, not a dotted key.
         *
         * `set({merge:true})` treats `'timestamps.sent'` as a field whose
         * NAME contains a dot — only `update()` reads a dot as a path. So the
         * dotted form wrote a top-level field nothing reads and left
         * `timestamps` empty, which the staff card rendered as a message with
         * no send date. What merge DOES do is merge nested maps at depth, so
         * this form keeps every sibling state rather than replacing them.
         */
        timestamps: { [event.type]: event.at },
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
    return {
      firstOfType,
      providerMessageId: event.providerMessageId,
      to: event.to,
      type: event.type,
      at: event.at,
    }
  } catch (error) {
    console.error(
      '[email-delivery-log] write failed',
      event.providerMessageId,
      error,
    )
    return null
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
      // the webhook's arrived with the rest of that message's truth. Nested
      // map rather than a dotted key, for the reason recorded above.
      if (!existing.timestamps?.sent) {
        update.timestamps = { sent: snapshot.sentAt }
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

/**
 * Records a batch, independently — one bad event must not lose the others.
 *
 * @returns one outcome per event that was WRITTEN; events that wrote nothing
 *          are absent, so the length is still the count the old return value
 *          reported.
 */
export async function recordEmailDeliveryEvents(
  events: EmailDeliveryEvent[],
  firestore?: any,
): Promise<EmailDeliveryEventOutcome[]> {
  const results = await Promise.all(
    events.map((event) => recordEmailDeliveryEvent(event, firestore)),
  )
  return results.filter((one): one is EmailDeliveryEventOutcome => one !== null)
}

/*==========================================
 * THE PER-PERSON ENGAGEMENT ROLLUP.
 *
 * The message rows above answer "what did we send this person". They cannot
 * answer "has this person engaged with anything lately" without reading every
 * row in their `messages` subcollection, which is the expensive-read shape
 * this codebase refuses — and that single absence is what made an audience
 * rule like "opened in the last 30 days" unanswerable and engagement-based
 * sunsetting unbuildable.
 *
 * So the rollup lands on the PARENT of the messages, `emailDeliveries/{key}`,
 * which already exists as the erasure tombstone's home. One document per
 * person, read by key, no query and therefore no index.
 *
 * ## Address-global, not per site
 *
 * The store keys on an address, the erasure path treats it as an address, and
 * the deliverability problem the rollup exists to serve is domain-wide: every
 * tenant's mail leaves on one domain under one DKIM `d=`, so the engagement
 * that moves the platform's spam rate is engagement with ANY of it. A
 * per-site map would also have to be capped, and capping a map needs a read
 * of it on every write.
 *
 * The cost of that choice is stated rather than hidden: a person who engages
 * with one site's mail reads as engaged when a second site asks. That is the
 * lenient direction for a control whose only power is to REFUSE a send.
 *
 * ## What one webhook event costs
 *
 * A rollup that wrote on every event would be a write per event per person,
 * which is a bill — a single reader opening a newsletter six times, plus
 * mailbox-provider prefetches, is one fact and six writes. So the rollup
 * moves only on an event that is the FIRST of its type for its message, which
 * {@link recordEmailDeliveryEvent}'s transaction already decided at no extra
 * cost. `delivered`, `bounced`, `complained`, `sent` and `delayed` move
 * nothing here at all.
 *
 * That bound is also what makes it replay-proof for free, by the same
 * reasoning the campaign counters rest on: a redelivered or replayed event
 * finds its type already recorded, reports `firstOfType: false`, and
 * contributes nothing.
 *
 * ⚠️ The bound has one consequence worth naming. A reader who opens only mail
 * they have already opened does not advance their own stamp, so a person can
 * read a year-old message and still measure as cold. Every message we send
 * them afterwards is a fresh first-open, so the stamp advances the moment
 * they engage with anything new — which is the population any sunset rule is
 * actually about.
 *=========================================*/

/** The event types that count as a person engaging. */
const ENGAGEMENT_TYPES: readonly EmailDeliveryEventType[] = ['opened', 'clicked']

/** What one person's mail says about whether they are still listening. */
export interface EmailPersonEngagement {
  /** The later of {@link lastOpenedAtMs} and {@link lastClickedAtMs}. */
  lastEngagedAtMs: number | null
  lastOpenedAtMs: number | null
  /**
   * Clicks are the metric to lean on. Apple's Mail Privacy Protection
   * prefetches images, so an open is partly a statement about the recipient's
   * mail client; a click is a statement about the recipient.
   */
  lastClickedAtMs: number | null
}

/** The empty answer, so a caller never has to invent one. */
export const NO_PERSON_ENGAGEMENT: EmailPersonEngagement = {
  lastEngagedAtMs: null,
  lastOpenedAtMs: null,
  lastClickedAtMs: null,
}

/** Reads the three stamps off a parent document's data. */
function engagementFrom(data: Record<string, unknown> | null | undefined) {
  const number = (value: unknown): number | null => {
    const parsed = Number(value ?? 0)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  }
  const opened = number(data?.['lastOpenedAtMs'])
  const clicked = number(data?.['lastClickedAtMs'])
  const engaged = number(data?.['lastEngagedAtMs'])
  return {
    lastEngagedAtMs:
      engaged ?? (opened || clicked ? Math.max(opened ?? 0, clicked ?? 0) : null),
    lastOpenedAtMs: opened,
    lastClickedAtMs: clicked,
  }
}

/**
 * Advances the engagement stamps for the people these outcomes are about.
 *
 * A transaction, and it buys exactly one property: the stamps only ever move
 * FORWARD. Provider events are not ordered, and a replay of an event whose
 * first delivery never landed can carry an instant from months ago — a blind
 * merge-set would let that overwrite a fresh stamp and quietly make an active
 * subscriber look cold to a control whose whole job is refusing to mail cold
 * people. Reading before writing is a cheaper unit than the write beside it,
 * and it happens at most once per message per event type.
 *
 * Never throws, for the same reason nothing else in this file does: a rollup
 * that failed loses a stamp, and a rollup that threw would lose the webhook's
 * acknowledgement and teach the provider to retry the whole event.
 *
 * @returns how many person documents were written.
 */
export async function recordPersonEngagement(
  outcomes: readonly EmailDeliveryEventOutcome[],
  firestore?: any,
): Promise<number> {
  /** Person key → the newest instant seen per engagement type in this batch. */
  const byPerson = new Map<
    string,
    { openedAtMs: number; clickedAtMs: number }
  >()
  for (const outcome of outcomes) {
    if (!outcome.firstOfType) continue
    if (!ENGAGEMENT_TYPES.includes(outcome.type)) continue
    const key = emailSuppressionKey(outcome.to)
    const at = Number(outcome.at)
    if (!key || !Number.isFinite(at) || at <= 0) continue
    const held = byPerson.get(key) ?? { openedAtMs: 0, clickedAtMs: 0 }
    if (outcome.type === 'opened') {
      held.openedAtMs = Math.max(held.openedAtMs, at)
    } else {
      held.clickedAtMs = Math.max(held.clickedAtMs, at)
    }
    byPerson.set(key, held)
  }
  if (!byPerson.size) return 0

  const db = firestore ?? defaultFirestore()
  let written = 0
  for (const [key, seen] of byPerson) {
    try {
      const ref = db.collection(EMAIL_DELIVERIES_COLLECTION).doc(key)
      await db.runTransaction(async (transaction: any) => {
        const snapshot = await transaction.get(ref)
        const stored = engagementFrom(
          (snapshot.exists ? snapshot.data() : null) ?? {},
        )
        const opened = Math.max(stored.lastOpenedAtMs ?? 0, seen.openedAtMs)
        const clicked = Math.max(stored.lastClickedAtMs ?? 0, seen.clickedAtMs)
        const engaged = Math.max(stored.lastEngagedAtMs ?? 0, opened, clicked)
        // Nothing moved forward, so nothing is written. An out-of-order event
        // is the ordinary case this skips, and skipping it costs a write
        // rather than losing a fact.
        if (
          opened === (stored.lastOpenedAtMs ?? 0) &&
          clicked === (stored.lastClickedAtMs ?? 0) &&
          engaged === (stored.lastEngagedAtMs ?? 0)
        ) {
          return
        }
        /*
         * A merge-set that CREATES. Unlike the campaign counters, there is no
         * document here to resurrect: `emailDeliveries/{key}` is a container
         * this store owns, its only other content is the erasure tombstone,
         * and a person's first recorded open is exactly when it should come
         * into existence.
         */
        transaction.set(
          ref,
          {
            ...(opened ? { lastOpenedAtMs: opened } : {}),
            ...(clicked ? { lastClickedAtMs: clicked } : {}),
            lastEngagedAtMs: engaged,
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        )
        written += 1
      })
    } catch (error) {
      console.error('[email-delivery-log] engagement rollup failed', key, error)
    }
  }
  return written
}

/**
 * One person's engagement, by address. Never throws.
 *
 * Returns {@link NO_PERSON_ENGAGEMENT} for an address we hold nothing about,
 * AND for a read that failed. The two are deliberately the same answer here:
 * every caller uses this to decide whether to REFUSE something, and both
 * readings must resolve to "we have no evidence this person is cold", which
 * is the only safe direction for a control that stops mail.
 */
export async function readPersonEngagement(
  email: string | null | undefined,
  firestore?: any,
): Promise<EmailPersonEngagement> {
  const key = emailSuppressionKey(email)
  if (!key) return NO_PERSON_ENGAGEMENT
  try {
    const db = firestore ?? defaultFirestore()
    const snapshot = await db
      .collection(EMAIL_DELIVERIES_COLLECTION)
      .doc(key)
      .get()
    // No `exists` branch: a missing document has no data, and `engagementFrom`
    // already answers an absent field with null. A second gate saying the same
    // thing would be a line no test can distinguish from its own removal.
    return engagementFrom(snapshot.data() ?? {})
  } catch (error) {
    console.error('[email-delivery-log] engagement read failed', error)
    return NO_PERSON_ENGAGEMENT
  }
}

/**
 * Engagement for many people at once, keyed by their person key.
 *
 * A `getAll` rather than a query: these are keyed document reads, so this
 * needs no index, cannot be truncated by a `limit`, and cannot drop somebody
 * for missing a field the way an `orderBy` would. The audience materializer
 * calls it a page at a time and counts every read against its scan budget.
 *
 * A key with no document is present in the result with
 * {@link NO_PERSON_ENGAGEMENT}, so a caller never has to tell "absent" from
 * "not read" — and a failure returns every requested key that way for the
 * same reason {@link readPersonEngagement} does.
 */
export async function readPersonEngagementByKeys(
  keys: readonly string[],
  firestore?: any,
): Promise<Map<string, EmailPersonEngagement>> {
  const wanted = [...new Set(keys.filter(Boolean))]
  const found = new Map<string, EmailPersonEngagement>()
  for (const key of wanted) found.set(key, NO_PERSON_ENGAGEMENT)
  if (!wanted.length) return found
  try {
    const db = firestore ?? defaultFirestore()
    const collection = db.collection(EMAIL_DELIVERIES_COLLECTION)
    const snapshots = await db.getAll(
      ...wanted.map((key: string) => collection.doc(key)),
    )
    for (const snapshot of snapshots) {
      if (!snapshot?.exists) continue
      found.set(snapshot.id, engagementFrom(snapshot.data() ?? {}))
    }
  } catch (error) {
    console.error('[email-delivery-log] engagement batch read failed', error)
  }
  return found
}

/*==========================================
 * THE CAMPAIGN TOUCH — which campaign this person last CLICKED, per site.
 *
 * The engagement rollup above answers "is this person still listening". It
 * cannot answer "which email brought them here", because it keeps instants
 * and not identities, and that second question is what revenue attribution
 * is: an order arrives, and something has to say which campaign preceded it.
 *
 * ## Here, on the person's own document
 *
 * The alternative was a per-host collection of touch documents, and it fails
 * on erasure. `eraseEmailDeliveriesForAddresses` erases by ADDRESS and knows
 * nothing about which sites have mailed it, so a per-host collection would be
 * a record of a person's clicks that an erasure request could not reach. On
 * the person document it is one field, deleted with the stamps it belongs
 * beside — a click is the same personal fact as the open recorded next to it.
 *
 * ## A CLICK ONLY
 *
 * `ENGAGEMENT_TYPES` includes opens because the control it feeds REFUSES to
 * mail people, and the generous signal is the correct one for a refusal. This
 * is the opposite kind of decision — it CREDITS a campaign with money — so it
 * takes the strict signal. Since Apple's Mail Privacy Protection an open is
 * substantially a statement about the recipient's mail client, and crediting
 * revenue to one would credit whichever campaign most recently reached an
 * Apple Mail user with orders from people who never read it.
 *
 * ## Per host, and capped
 *
 * A single global touch would credit site A's campaign with site B's order,
 * or refuse both — the send path refuses cross-site reach and the revenue
 * join has to agree with it. So the field is a map keyed by host, and a map
 * on a document has to be bounded: past {@link EMAIL_TOUCH_MAX_HOSTS} the
 * oldest touch is evicted, inside the transaction the forward-only rule
 * already pays for. A person who clicks mail from eleven different sites
 * loses their oldest click, which costs an attribution rather than a fact
 * anybody else reads.
 *=========================================*/

/** The field on `emailDeliveries/{key}` holding the per-host touches. */
export const EMAIL_TOUCH_FIELD = 'campaignTouches'

/**
 * How many sites' touches one person's document keeps.
 *
 * A cap, not a page size: the map lives in a document with a 1 MiB ceiling
 * and nothing else bounds how many sites may mail one address.
 */
export const EMAIL_TOUCH_MAX_HOSTS = 10

/** The last campaign one person clicked on one site. */
export interface EmailCampaignTouch {
  hostId: string
  campaignId: string
  /** When the click happened, epoch ms — the provider's instant. */
  clickedAtMs: number
}

/** Reads the touch map off a person document's data, defensively. */
function touchesFrom(
  data: Record<string, unknown> | null | undefined,
): Record<string, { campaignId: string; atMs: number }> {
  const raw = data?.[EMAIL_TOUCH_FIELD]
  if (!raw || typeof raw !== 'object') return {}
  const found: Record<string, { campaignId: string; atMs: number }> = {}
  for (const [hostId, entry] of Object.entries(
    raw as Record<string, { campaignId?: unknown; atMs?: unknown }>,
  )) {
    const campaignId = String(entry?.campaignId ?? '')
    const atMs = Number(entry?.atMs ?? 0)
    if (!campaignId || !Number.isFinite(atMs) || atMs <= 0) continue
    found[hostId] = { campaignId, atMs }
  }
  return found
}

/**
 * Records that this person clicked this campaign's mail. Never throws.
 *
 * Forward-only, in a transaction, for the reason {@link recordPersonEngagement}
 * is: provider delivery is at-least-once and unordered, so a replayed click
 * from last month must not displace this week's. That same property is what
 * makes this idempotent — a redelivered event finds its own instant already
 * stored and writes nothing.
 *
 * @returns whether the touch moved forward.
 */
export async function recordEmailCampaignTouch(
  touch: {
    email: string | null | undefined
    hostId: string
    campaignId: string
    atMs: number
  },
  firestore?: any,
): Promise<boolean> {
  const key = emailSuppressionKey(touch.email)
  const hostId = String(touch.hostId ?? '')
  const campaignId = String(touch.campaignId ?? '')
  const atMs = Number(touch.atMs)
  if (!key || !hostId || !campaignId) return false
  if (!Number.isFinite(atMs) || atMs <= 0) return false

  try {
    const db = firestore ?? defaultFirestore()
    const ref = db.collection(EMAIL_DELIVERIES_COLLECTION).doc(key)
    let moved = false
    await db.runTransaction(async (transaction: any) => {
      moved = false
      const snapshot = await transaction.get(ref)
      const stored = touchesFrom(
        (snapshot.exists ? snapshot.data() : null) ?? {},
      )
      const held = stored[hostId]
      // Not newer than what is already there, so nothing is written. An
      // out-of-order or replayed event is the ordinary case this skips.
      if (held && held.atMs >= atMs) return

      const update: Record<string, unknown> = {
        [hostId]: { campaignId, atMs },
      }
      /*
       * EVICTION, and only when this host is NEW to the map. Replacing an
       * existing host's touch cannot grow it, so the cap is checked exactly
       * where the map can cross it. The oldest goes, because the window makes
       * an old touch the one least likely to be credited with anything.
       *
       * `FieldValue.delete()` INSIDE the map: a merge-set merges nested maps
       * at depth, which is what keeps every other host's touch — and is also
       * why an evicted key has to be deleted explicitly rather than by
       * omission.
       */
      if (!held && Object.keys(stored).length >= EMAIL_TOUCH_MAX_HOSTS) {
        const oldest = Object.entries(stored).sort(
          (a, b) => a[1].atMs - b[1].atMs || a[0].localeCompare(b[0]),
        )[0]
        if (oldest) update[oldest[0]] = FieldValue.delete()
      }

      transaction.set(
        ref,
        { [EMAIL_TOUCH_FIELD]: update, updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      )
      moved = true
    })
    return moved
  } catch (error) {
    console.error('[email-delivery-log] campaign touch write failed', error)
    return false
  }
}

/**
 * The last campaign this person clicked on this site, or `null`.
 *
 * One keyed document read — no query, no index, and nothing that can be
 * truncated. `null` for an address we hold no touch for AND for a read that
 * failed, which are the same answer on purpose: both mean "we cannot say
 * which campaign preceded this order", and the only safe thing to do with
 * that is credit nobody.
 */
export async function readEmailCampaignTouch(
  email: string | null | undefined,
  hostId: string,
  firestore?: any,
): Promise<EmailCampaignTouch | null> {
  const key = emailSuppressionKey(email)
  if (!key || !hostId) return null
  try {
    const db = firestore ?? defaultFirestore()
    const snapshot = await db
      .collection(EMAIL_DELIVERIES_COLLECTION)
      .doc(key)
      .get()
    const held = touchesFrom(snapshot.data() ?? {})[hostId]
    if (!held) return null
    return {
      hostId,
      campaignId: held.campaignId,
      clickedAtMs: held.atMs,
    }
  } catch (error) {
    console.error('[email-delivery-log] campaign touch read failed', error)
    return null
  }
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

  return snapshot.docs.map(deliveryRecordFrom)
}

/**
 * One stored message document as {@link EmailDeliveryRecord}.
 *
 * Shared by every reader in this file so the defaults are decided once. A
 * second copy would be a second answer to "what does an absent `openCount`
 * mean", and the two would drift the first time a field is added.
 */
function deliveryRecordFrom(doc: any): EmailDeliveryRecord {
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

/*==========================================
 * ACROSS THE CAMPAIGNS OF ONE SITE.
 *
 * The readers above answer "what did we send this person". This one answers
 * the other direction — "who did this campaign reach, and which of them
 * opened it" — and it is the SAME store, queried across the recipient
 * documents instead of down one of them.
 *
 * That direction is a collection-group query, and it is the one shape this
 * file's header says the per-address layout avoids. It is worth the index
 * here for the reason the index exists at all: the alternative is a second
 * per-recipient store keyed by campaign, written by the same webhook, which
 * would be two records of the same fact and one of them eventually wrong.
 *
 * ⚠️ EVERY caller must be authorised on `hostId` before calling. The rows
 * carry recipient addresses, and the `hostId` filter below is a query
 * predicate, not a permission — it narrows the read to one site's mail and
 * says nothing about who is asking.
 *=========================================*/

/** The most recipient rows one campaign-engagement read returns. */
export const EMAIL_CAMPAIGN_ENGAGEMENT_PAGE_SIZE = 25

/**
 * How many campaigns one engagement read can span.
 *
 * Firestore's `in` operator takes at most 30 values, and the query below runs
 * as a merge of one sub-query per value — so this is a hard limit of the
 * store rather than a number worth tuning. A design used by more campaigns
 * than this reads its most recent 30, and the caller is told so.
 */
export const EMAIL_CAMPAIGN_ENGAGEMENT_MAX_CAMPAIGNS = 30

/** Which recipients a campaign-engagement read returns. */
export type EmailEngagementFilter = 'all' | 'opened' | 'clicked'

/** One page of recipient rows. */
export interface EmailCampaignEngagementPage {
  rows: EmailDeliveryRecord[]
  /**
   * Cursor for the next page, or null at the end.
   *
   * The full document PATH of the last row, which is
   * `emailDeliveries/{sha256(address)}/messages/{messageId}`. It is re-read
   * as a snapshot to resume the query, rather than resuming from the ordered
   * VALUE: a value cursor positions after every document sharing it, so two
   * messages recorded in the same millisecond would lose one of them between
   * pages — silently, and only under load.
   */
  cursor: string | null
  /** The read failed, as distinct from finding nothing. */
  lookupFailed: boolean
  /** Campaigns past {@link EMAIL_CAMPAIGN_ENGAGEMENT_MAX_CAMPAIGNS}. */
  campaignsOmitted: number
}

/**
 * The recipients of one site's campaigns, newest message first.
 *
 * ## What each filter orders on, and why it is not one query with a flag
 *
 * `all` orders on `firstSeenAtMs`, which {@link recordEmailDeliveryEvent}
 * guarantees on creation. `opened` and `clicked` carry an inequality —
 * `openCount > 0` — and Firestore requires the first ordering to be on the
 * inequality's own field, so those two order on the count and then on the
 * time. That is not a workaround: a message never opened has no `openCount`
 * field at all, so the inequality is also what excludes it, and the ordering
 * puts the most engaged recipient first, which is the order a merchant reads
 * such a table in.
 *
 * ## Never throws
 *
 * Same contract as the rest of this file: `lookupFailed` distinguishes a read
 * that could not run — a missing index is the likely one — from a campaign
 * nobody opened. Rendering those two the same way is how a merchant concludes
 * their campaign reached nobody.
 */
export async function readCampaignEngagement(options: {
  /** The site whose mail this is. The caller must already have proven it. */
  hostId: string
  /** Campaign ids to read, most recent first. */
  campaignIds: readonly string[]
  filter?: EmailEngagementFilter
  limit?: number
  /** A `cursor` from a previous page. */
  cursor?: string | null
  firestore?: any
}): Promise<EmailCampaignEngagementPage> {
  const {
    hostId,
    campaignIds,
    filter = 'all',
    cursor = null,
    firestore,
  } = options
  const pageSize = Math.max(
    1,
    Math.min(
      EMAIL_CAMPAIGN_ENGAGEMENT_PAGE_SIZE,
      options.limit ?? EMAIL_CAMPAIGN_ENGAGEMENT_PAGE_SIZE,
    ),
  )
  const ids = campaignIds
    .filter(Boolean)
    .slice(0, EMAIL_CAMPAIGN_ENGAGEMENT_MAX_CAMPAIGNS)
  const campaignsOmitted = Math.max(
    0,
    campaignIds.filter(Boolean).length - ids.length,
  )
  const empty: EmailCampaignEngagementPage = {
    rows: [],
    cursor: null,
    lookupFailed: false,
    campaignsOmitted,
  }
  if (!hostId || !ids.length) return empty

  try {
    const db = firestore ?? defaultFirestore()
    let query = db
      .collectionGroup(EMAIL_DELIVERY_MESSAGES_COLLECTION)
      // `hostId` first so the read is provably one site's mail even if a
      // caller ever passes a campaign id belonging to another.
      .where('hostId', '==', hostId)
      .where('campaignId', 'in', ids)
    if (filter === 'opened') {
      query = query.where('openCount', '>', 0).orderBy('openCount', 'desc')
    } else if (filter === 'clicked') {
      query = query.where('clickCount', '>', 0).orderBy('clickCount', 'desc')
    }
    query = query.orderBy('firstSeenAtMs', 'desc')

    if (cursor) {
      const anchor = await db.doc(cursor).get()
      // A cursor whose document has been erased resumes nothing rather than
      // silently restarting at page one, which would loop the reader through
      // the same rows forever.
      if (!anchor.exists) return empty
      query = query.startAfter(anchor)
    }

    const snapshot = await query.limit(pageSize).get()
    const rows = snapshot.docs.map(deliveryRecordFrom)
    return {
      rows,
      // Null on a short page: a full page is the only state from which more
      // rows can exist, and offering a cursor that returns nothing makes a
      // finished table look unfinished.
      cursor:
        rows.length === pageSize
          ? String(snapshot.docs[snapshot.docs.length - 1].ref.path)
          : null,
      lookupFailed: false,
      campaignsOmitted,
    }
  } catch (error) {
    console.error('[email-delivery-log] campaign engagement read failed', error)
    return { ...empty, lookupFailed: true }
  }
}

/*==========================================
 * ACROSS EVERY ADDRESS AN ACCOUNT HOLDS.
 *
 * The single-address functions above are the primitive and stay exactly as
 * they were — one address, one document. What was wrong was never the
 * primitive; it was that every CALLER passed the Auth record's current
 * primary and nothing else, so a changed address orphaned the history and an
 * erasure missed the mail sitting under the other addresses.
 *
 * The address list is resolved ONCE, by `account-addresses.ts`, and passed
 * in. This module deliberately does not resolve it: a store keyed by a hash
 * should not also own the rule for which hashes describe a person, and a copy
 * of that rule here is the second copy the whole change exists to prevent.
 *=========================================*/

/**
 * A record that delivery data WAS held for an address and has been erased.
 *
 * Written into the parent `emailDeliveries/{emailKey}` document, which the
 * messages subcollection otherwise leaves empty.
 *
 * ⚠️ It carries no address, no subject, no message id and no uid — nothing
 * the erasure was performed to destroy. `count` is a magnitude, which is what
 * makes the row honest without reconstituting anything: it says data existed
 * and is gone, and nothing about what it was.
 */
export interface EmailDeliveryErasure {
  /** Epoch ms. */
  at: number
  /** How many messages were removed. */
  count: number
}

/** One account's mail, gathered from every address it holds. */
export interface EmailDeliveryHistory {
  lookupFailed: boolean
  rows: EmailDeliveryRecord[]
  /**
   * The addresses actually read, in the order they were given.
   *
   * The card names them. A staffer looking at mail sent to an address that is
   * no longer this account's primary has to be able to see that that is what
   * they are looking at.
   */
  addressesRead: string[]
  /**
   * Erasure tombstones found, keyed by address.
   *
   * An address whose records were erased under somebody's request reads as an
   * empty table otherwise — which is the precise failure this card's copy
   * warns about, recreated by the fix for it.
   */
  erasures: Record<string, EmailDeliveryErasure>
}

/** The tombstone on one address, or null. Never throws. */
export async function readEmailDeliveryErasure(
  email: string | null | undefined,
  firestore?: any,
): Promise<EmailDeliveryErasure | null> {
  const key = emailSuppressionKey(email)
  if (!key) return null
  try {
    const db = firestore ?? defaultFirestore()
    const doc = await db.collection(EMAIL_DELIVERIES_COLLECTION).doc(key).get()
    if (!doc.exists) return null
    const at = Number(doc.get('erasedAtMs') ?? 0)
    if (!at) return null
    return { at, count: Number(doc.get('erasedCount') ?? 0) }
  } catch {
    return null
  }
}

/**
 * Every message sent to any address this account holds, newest first.
 *
 * Merged and re-sorted rather than concatenated: the rows are one person's
 * mail and a staffer reads them as a timeline, so grouping them by which
 * address happened to receive them would put the answer in two places and
 * make "what was the last thing we sent them" a question about two tables.
 * Each row keeps its own `to`, so the card can still say which address.
 *
 * `lookupFailed` is true when ANY address failed. A partial read of a
 * delivery log is the same hazard as an empty one — it under-reports mail we
 * sent — and reporting it as a clean result is how a staffer comes to tell a
 * customer something untrue.
 */
export async function readEmailDeliveryHistoryForAddresses(
  addresses: readonly string[],
  options?: { limit?: number; firestore?: any },
): Promise<EmailDeliveryHistory> {
  const limit = Math.max(1, options?.limit ?? EMAIL_DELIVERY_READ_LIMIT)
  const addressesRead: string[] = []
  const erasures: Record<string, EmailDeliveryErasure> = {}
  const rows: EmailDeliveryRecord[] = []
  let lookupFailed = false

  for (const address of addresses) {
    const key = emailSuppressionKey(address)
    if (!key) continue
    addressesRead.push(address)
    try {
      rows.push(...(await readEmailDeliveries(address, { limit, ...options })))
    } catch (error) {
      console.error('[email-delivery-log] read failed', error)
      lookupFailed = true
    }
    const erasure = await readEmailDeliveryErasure(address, options?.firestore)
    if (erasure) erasures[address] = erasure
  }

  rows.sort((a, b) => b.firstSeenAtMs - a.firstSeenAtMs)
  return { lookupFailed, rows: rows.slice(0, limit), addressesRead, erasures }
}

/** What one multi-address erasure did. */
export interface EmailDeliveryErasureResult {
  /** Messages removed, across every address that was erased. */
  removed: number
  /** The addresses actually erased. Tombstoned, one document each. */
  addresses: string[]
  /**
   * Addresses left INTACT because another account is also known to hold them.
   *
   * Never empty and ignorable: a caller erasing an account has to treat a
   * non-empty list as an erasure it did not finish. See
   * {@link eraseEmailDeliveriesForAddresses}.
   */
  contestedAddresses: string[]
}

/**
 * Erase the delivery log for every address an account holds, except the ones
 * a second account also holds.
 *
 * ## The shared-address decision
 *
 * The log describes an ADDRESS, not an account. Where one account holds an
 * address, erasing it is simply erasing the subject's mail, and this sweeps
 * it.
 *
 * Where TWO accounts hold one address, the same rows are two people's answer
 * to "what did you send me", and the two readings are incompatible:
 *
 *  - **One human, two accounts** — the ordinary live shape, an account whose
 *    federated provider address is another account's primary. Erasing is
 *    right; the mail is the requester's.
 *  - **A genuinely shared mailbox** — `billing@`, `support@`, a role account
 *    two different people hold. Erasing destroys the second person's delivery
 *    history for an address they legitimately hold, and they asked for
 *    nothing.
 *
 * ⛔ **Nothing here can tell those apart.** The difference is a fact about the
 * humans, and the data holds no fact about the humans — only that two account
 * records name one address. So this function does not choose. It erases what
 * it can decide about and reports the rest as CONTESTED, and `eraseUser`
 * refuses the whole erasure rather than half-perform one: destroying the
 * second party's mail has no remedy, and quietly leaving it while reporting
 * the erasure complete is the gap this area exists to close. Refusing is the
 * only outcome that is neither, and it is reversible — a human decides which
 * reading applies, detaches the address or confirms the account, and the
 * erasure runs.
 *
 * ⚠️ A contested address is not tombstoned. The tombstone means "the records
 * here were removed under an erasure request", and writing one over rows that
 * are still present would tell the second holder their mail is gone while it
 * sits underneath — a worse misreading than the blank table, because it is
 * confidently wrong rather than merely empty. Nothing was removed, so their
 * card renders their mail exactly as before.
 *
 * ⚠️ `shared` is one-directional evidence. True proves a second holder; false
 * only means none was found, because there is no lookup for an account
 * holding an address through a federated provider (see
 * `account-addresses.ts`). So the tombstone is still written for EVERY
 * address that IS erased, not only ones believed unshared — it costs one
 * small document and closes the case where a second holder exists behind the
 * gap in the probe and would otherwise meet a blank table.
 *
 * ⛔ Only addresses the account HOLDS, resolved through the one resolver. An
 * address arriving here that the account does not hold erases a stranger's
 * mail, which no erasure request authorises.
 */
export async function eraseEmailDeliveriesForAddresses(
  addresses: readonly { address: string; shared?: boolean }[],
  firestore?: any,
): Promise<EmailDeliveryErasureResult> {
  const db = firestore ?? defaultFirestore()
  const erased: string[] = []
  const contestedAddresses: string[] = []
  let removed = 0

  for (const entry of addresses) {
    const key = emailSuppressionKey(entry.address)
    if (!key) continue

    // Before any write for this address, so a contested one is untouched
    // rather than erased-then-regretted. There is no undo below this line.
    if (entry.shared === true) {
      contestedAddresses.push(entry.address)
      continue
    }

    erased.push(entry.address)
    const count = await eraseEmailDeliveries(entry.address, db).catch(() => 0)
    removed += count

    // The tombstone lands whether or not anything was removed: an address we
    // erased and found empty is still an address whose records this request
    // covered, and a later import must not be able to refill it silently.
    try {
      await db
        .collection(EMAIL_DELIVERIES_COLLECTION)
        .doc(key)
        .set(
          {
            erasedAtMs: Date.now(),
            erasedCount: FieldValue.increment(count),
            /*
             * The engagement rollup goes with the messages it was summarised
             * from. "This person read our mail on the 3rd" is the same
             * personal fact as the row it was derived from, and a summary
             * that outlived its source would leave an erasure that removed
             * the evidence and kept the conclusion.
             */
            lastEngagedAtMs: FieldValue.delete(),
            lastOpenedAtMs: FieldValue.delete(),
            lastClickedAtMs: FieldValue.delete(),
            /*
             * And the campaign touches, for the same reason and one step
             * further: "this person clicked THIS campaign on the 3rd" names
             * both the person and what they were reading, so it is the
             * strongest personal fact on the document. The orders it has
             * already been credited with keep their own record — that one is
             * a commercial fact about a sale, held under the order's id
             * rather than the person's — but nothing here may go on
             * attributing their FUTURE orders to mail they asked us to forget.
             */
            [EMAIL_TOUCH_FIELD]: FieldValue.delete(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        )
    } catch (error) {
      console.error('[email-delivery-log] tombstone write failed', error)
    }

    /*
     * And the CONCLUSIONS drawn from those touches, on every site.
     *
     * A conversion attribution says "this person came from that campaign and
     * then submitted this form / became this lead / made this booking". It is
     * derived from the click stamp deleted a few lines above and is a
     * strictly stronger statement than the stamp was, so deleting the stamp
     * and keeping the attribution would be an erasure that removed the
     * evidence and kept the conclusion.
     *
     * Keyed on `personKey`, which is `emailSuppressionKey` — the same
     * derivation, one function — so the sweep covers exactly the person this
     * loop is erasing. Per address rather than per host, because an erasure
     * request names an address and knows nothing about which sites it ever
     * visited.
     */
    await eraseCampaignAttributionsForPersonKey(key, db)
  }

  return { removed, addresses: erased, contestedAddresses }
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
