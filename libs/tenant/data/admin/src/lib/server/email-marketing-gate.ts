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
 * MARKETING MAIL — the durable half.
 *
 * `marketing-send.ts` in `@aglyn/shared-util-email` states the policy and
 * holds the injection seam; this answers the question, because answering it
 * needs Firestore and that library may not hold the Admin SDK.
 *
 * Five things, in the order they cost:
 *
 *  1. **Both suppression lists**, through the one shared helper. A person who
 *     unsubscribed from this site, hard-bounced anywhere in the product, or
 *     pressed "report spam" is not mailed. Asked first because it is the only
 *     one whose answer is permanent.
 *  2. **The pace the RECIPIENT asked for** on the preference page, if they
 *     asked for one.
 *  3. **An engagement sunset**, when an operator has configured a window —
 *     off by default, and it costs a read only when it is on.
 *  4. **A frequency ceiling**, per recipient per site, over a rolling day.
 *  5. **The signed unsubscribe URL**, so the message carries a way out.
 *
 * ## The order of the three pace refusals, and who each one is for
 *
 * Suppression is first and needs no argument: its answer is permanent, and
 * the frequency record must not count a message that was never going to
 * leave. The other three are all refusals about PACE, and they are ordered by
 * whose refusal it is, then by what asking costs.
 *
 * **The recipient's own cadence is second — above both platform controls.**
 * It is the only one of the three a PERSON asked for; the sunset is an
 * inference this platform drew about them and the ceiling is a guard against
 * the merchant. When more than one applies, the honest answer to "why did
 * this not send" is the fact somebody stated, not the guess we made. It is
 * also the cheapest to ask: it is already on the counter document the ceiling
 * reads, so a recipient who asked for monthly mail never pays for the
 * sunset's engagement read. And it is the only one that binds a campaign, so
 * putting it first makes the campaign path and the automated paths evaluate
 * the same refusals in the same order rather than interleaving one control a
 * campaign skips with one it does not.
 *
 * **The sunset is third, above the ceiling.** Its refusal is TERMINAL and the
 * ceiling's is not: a sweep defers a `frequency-capped` message and retries
 * it, so reporting the retryable refusal for a person the sunset would refuse
 * anyway means the same doomed row comes back on every beat. That argument
 * does not reach past the cadence, because a cadence gap is a day, a week or
 * a month — a sweep retries such a row once per interval, not once per beat.
 *
 * ## Which refusals bind a campaign
 *
 * `MarketingSendContext.capped` is `false` for a campaign, and it governs
 * exactly two of the four:
 *
 * | Refusal            | A campaign is |
 * | ------------------ | ------------- |
 * | `suppressed`       | **bound** |
 * | `cadence-limited`  | **bound** |
 * | `unengaged`        | exempt (`capped`) |
 * | `frequency-capped` | exempt (`capped`) |
 *
 * The two exemptions share one reason: a campaign is a merchant's reviewed,
 * one-shot act with a recipient count on screen before they press Send, and a
 * platform control that silently removed people from that number would make
 * it a lie. That reason is about a control the merchant did not ask for and
 * cannot see. It does not reach a request the RECIPIENT made — a campaign
 * that overrode the preference page would make it a form recording a choice
 * nothing honors, which is ignoring an unsubscribe one notch quieter.
 *
 * A campaign COUNTS toward the ceiling either way; it is exempt from the
 * refusal, never from the counting.
 *
 * ## The counter is a WINDOW, not a total
 *
 * `hosts/{hostId}/emailFrequency/{sha256(address)}` holds the instants of the
 * marketing messages this site sent this person, trimmed to the window on
 * every touch. A rolling window needs the instants; a running total would
 * need a reset nobody triggers, and a per-day bucket would let a merchant
 * send the whole ceiling at 23:55 and the whole ceiling again at 00:05.
 *
 * The record is bounded by the cap — a handful of numbers — because
 * `marketingFrequencyVerdict` returns the trimmed window and this writes back
 * only that. It is server-owned: the address is hashed exactly as the two
 * suppression lists hash it, and no client writes or reads it.
 *
 * ## The check and the write are not one transaction, on purpose
 *
 * Two concurrent marketing sends to the same person can both read a window
 * with room and both append, so the cap can be exceeded by the number of
 * messages genuinely in flight at that instant. That is accepted rather than
 * papered over: a transaction per recipient would double the round trips on a
 * path that is already one awaited HTTP POST per person, and being off by one
 * on a runaway guard costs a recipient one extra message. Being slow costs
 * every recipient.
 *
 * ## Never a reduction of the person or their data
 *
 * A cap here refuses a SEND. It never removes a contact, never unsubscribes
 * anybody, never trims an audience and never deletes a counter row belonging
 * to somebody. `over-limit.ts` states the rule for capacity limits and this is
 * the same instrument pointed at time: the message does not go, the person
 * stays exactly where they were, and the next window mails them again. The
 * recipient's own cadence is the same shape — a person who asked for monthly
 * mail stays on every audience they were on and is mailed again next month.
 */

import {
  getMarketingSendGate,
  marketingCadenceVerdict,
  marketingFrequencyVerdict,
  marketingSunsetDays,
  marketingSunsetVerdict,
  normalizeMarketingCadence,
  setMarketingSendGate,
  type MarketingCadence,
  type MarketingSendGateRequest,
  type MarketingSendGateVerdict,
} from '@aglyn/shared-util-email'
import firebaseAdmin from './firebase-admin'
import { readPersonEngagement } from './email-delivery-log'
import {
  emailSuppressionKey,
  filterSendableForHost,
  filterTopicSendable,
} from './email-suppression'
import { buildUnsubscribeUrl } from './email-unsubscribe-link'

const defaultFirestore = () => firebaseAdmin.app().firestore()

/**
 * Where the per-recipient window lives.
 *
 * Under the host rather than the org: the ceiling is "how much mail this SITE
 * sends one person", which is the unit a recipient experiences and the unit
 * the unsubscribe link is scoped to. An org-wide counter would let one site's
 * newsletter suppress a sibling site's order-related marketing, and the two
 * sites may be unrelated brands.
 */
export const EMAIL_FREQUENCY_SUBCOLLECTION = 'emailFrequency'

/** How each cadence reads inside a refusal sentence. */
const CADENCE_PHRASES: Record<MarketingCadence, string> = {
  all: 'at this pace',
  daily: 'a day',
  weekly: 'a week',
  monthly: 'a month',
}

/** The stored window. */
export interface EmailFrequencyRecord {
  /** The address, in the clear, lowercased. The id is its hash. */
  email: string
  /** Marketing send instants, trimmed to the window on every touch. */
  sentAtMs: number[]
  /**
   * When this site FIRST sent this person marketing mail.
   *
   * Written once and never again, and it rides here rather than in a store of
   * its own because this document is already written on every marketing send:
   * carrying the field costs nothing, and a second per-recipient document
   * would be a write per send per person for one number.
   *
   * The sunset is what reads it — see `marketingSunsetVerdict`. A person we
   * have not been mailing for longer than the sunset window cannot have been
   * quiet for longer than the sunset window, so this is the field that keeps
   * a new subscriber from being refused for having nothing on record yet.
   *
   * Null for every row written before this field existed, which reads as "no
   * record" and therefore refuses nobody. That is the conservative direction
   * for a field introduced after the data, and it self-heals: the row gains
   * the stamp on this site's next marketing send to that person, and the
   * clock starts from then rather than from a past nobody recorded.
   */
  firstSentAtMs?: number
  /**
   * The most recent marketing send, NEVER trimmed.
   *
   * `sentAtMs` is a rolling day, so after a quiet day it is empty and cannot
   * answer "when did this site last mail this person" — which is the only
   * question a weekly or monthly cadence asks. One number rather than a
   * window kept for a month.
   *
   * The bookends of the same relationship: `firstSentAtMs` never moves and
   * this one moves on every send, so between them they answer both "how long
   * have we been mailing this person" and "how long since we last did".
   */
  lastSentAtMs?: number
  /**
   * How often the RECIPIENT asked to hear from this site.
   *
   * Stored on the counter document rather than beside the topic opt-outs, and
   * that is the whole reason it costs nothing: the gate already reads this
   * document on every marketing message, so honoring the preference adds no
   * round trip to any send. It also puts the preference in the one document
   * that is already about how much mail this site sends this person.
   *
   * Absent on every record written before it existed, which reads as no
   * expressed preference — see `normalizeMarketingCadence`.
   */
  cadence?: MarketingCadence
  /** When the recipient chose it, for the record that the request was made. */
  cadenceSetAtMs?: number
}

/**
 * What one recipient's counter document says, with its defaults applied.
 *
 * Everything the gate asks of Firestore about this person on this site, in
 * one shape, because it is fetched in one round trip — see
 * {@link readMarketingFrequencyState}.
 */
export interface MarketingFrequencyState {
  /** Send instants inside the rolling window. */
  window: number[]
  /** When this site first mailed them, or `null` for no record. */
  firstSentAtMs: number | null
  /** The most recent send, or `null` for somebody never mailed. */
  lastSentAtMs: number | null
  /** The recipient's chosen pace. */
  cadence: MarketingCadence
}

/** What an unreadable, absent or unkeyable counter reads as. */
const NO_RECORD: MarketingFrequencyState = {
  window: [],
  firstSentAtMs: null,
  lastSentAtMs: null,
  cadence: 'all',
}

/**
 * One counter snapshot, decoded.
 *
 * Shared by {@link readMarketingFrequencyState} and
 * {@link filterCadenceSendable} so the two cannot come to different
 * conclusions about the same document — in particular about the
 * `lastSentAtMs` fallback, where a per-message answer and a per-campaign
 * answer that disagreed would refuse a recipient on one path and mail them on
 * the other.
 */
function stateFromSnapshot(snapshot: any): MarketingFrequencyState {
  const stored = snapshot.get('sentAtMs')
  const window = Array.isArray(stored)
    ? stored.map((at: unknown) => Number(at))
    : []
  const first = Number(snapshot.get('firstSentAtMs'))
  const last = Number(snapshot.get('lastSentAtMs'))
  return {
    window,
    firstSentAtMs: Number.isFinite(first) && first > 0 ? first : null,
    /*
     * The stored instant, or the newest entry still inside the window.
     *
     * The fallback is what makes this work on every record written before
     * `lastSentAtMs` existed: those carry a window and nothing else, and
     * reading `null` for them would let a monthly cadence pass on the first
     * message after this ships for anybody mailed in the last day.
     *
     * `firstSentAtMs` deliberately has NO such fallback. The window would be
     * the wrong answer for it in exactly the direction that matters: a
     * relationship dated from a send inside the last day is younger than any
     * sunset window, so the sunset could never fire — and a relationship
     * dated from the oldest entry in a rolling DAY is not the first send
     * either. Absent means "no record", and no record refuses nobody.
     */
    lastSentAtMs: Number.isFinite(last)
      ? last
      : window.length
        ? Math.max(...window)
        : null,
    cadence: normalizeMarketingCadence(snapshot.get('cadence')),
  }
}

function frequencyDoc(
  hostId: string,
  emailKey: string,
  firestore?: any,
): FirebaseFirestore.DocumentReference {
  return (firestore ?? defaultFirestore())
    .collection('hosts')
    .doc(hostId)
    .collection(EMAIL_FREQUENCY_SUBCOLLECTION)
    .doc(emailKey)
}

/**
 * The instants inside the window for one recipient of one site's mail.
 *
 * FAILS OPEN — an empty window, meaning "nothing recorded, so there is room".
 * The opposite of {@link filterSendableForHost}, and the difference is what
 * each answer costs when it is wrong. A suppression read that fails open
 * mails somebody who told us to stop; a frequency read that fails closed
 * refuses a message nobody objected to, over a counter that is a runaway
 * guard rather than a consent record.
 */
export async function readMarketingFrequency(
  hostId: string,
  email: string,
  firestore?: any,
): Promise<number[]> {
  return (await readMarketingFrequencyState(hostId, email, firestore)).window
}

/**
 * The whole counter document — the window, the first send, the last send and
 * the recipient's chosen pace — in ONE round trip.
 *
 * **One read, four facts, and that is a requirement rather than a tidiness.**
 * Three separate refusals in {@link marketingSendVerdict} read this document,
 * and a `get` per refusal would be three awaited round trips on a path that
 * is already one awaited HTTP POST per recipient. Which is also why the
 * recipient's cadence is stored HERE rather than beside the topic opt-outs:
 * honoring a preference this gate has to consult on every marketing message
 * has to cost nothing, and riding on a document already being read is the
 * only shape that does. See {@link EmailFrequencyRecord.cadence}.
 *
 * FAILS OPEN on every field, and in the same direction each time: an empty
 * window means "there is room", a null `firstSentAtMs` means "no record", a
 * null `lastSentAtMs` means "never mailed", and an unreadable cadence reads
 * as no preference expressed. An unreadable counter is not evidence that
 * somebody asked for less, and it is not evidence that they have gone cold —
 * the opposite of {@link filterSendableForHost}, for the reason
 * {@link readMarketingFrequency} states.
 */
export async function readMarketingFrequencyState(
  hostId: string,
  email: string,
  firestore?: any,
): Promise<MarketingFrequencyState> {
  const key = emailSuppressionKey(email)
  if (!key) return { ...NO_RECORD }
  try {
    const snapshot = await frequencyDoc(hostId, key, firestore).get()
    if (!snapshot.exists) return { ...NO_RECORD }
    return stateFromSnapshot(snapshot)
  } catch (error) {
    console.error('[email-marketing] frequency read failed; allowing', error)
    return { ...NO_RECORD }
  }
}

/**
 * Records the pace a recipient asked for.
 *
 * Written from the preference page, which is unauthenticated and reached by a
 * signed link — so the CALLER has already proved the request is this
 * address's. A merge, because the document is the send counter and this must
 * not disturb the window it shares with.
 *
 * Never throws: a preference that failed to store is a page that should say
 * so, not a 500 on a screen a recipient reached in order to leave.
 *
 * @returns whether it was stored.
 */
export async function setMarketingCadence(
  hostId: string,
  email: string,
  cadence: MarketingCadence,
  options?: { nowMs?: number; firestore?: any },
): Promise<boolean> {
  const key = emailSuppressionKey(email)
  if (!key || !hostId) return false
  try {
    await frequencyDoc(hostId, key, options?.firestore).set(
      {
        email: String(email).trim().toLowerCase(),
        cadence: normalizeMarketingCadence(cadence),
        cadenceSetAtMs: options?.nowMs ?? Date.now(),
      },
      { merge: true },
    )
    return true
  } catch (error) {
    console.error('[email-marketing] cadence write failed', error)
    return false
  }
}

/**
 * Records marketing messages against the recipients' windows.
 *
 * Takes a LIST because the campaign sender records a whole batch at once: it
 * is exempt from the refusal (a reviewed, one-shot act whose recipient count
 * is on screen before it goes) but not from the counting, since a campaign is
 * most of the mail a person receives from a site. Doing that per recipient
 * inside the send loop would add a round trip to each of up to 500 sequential
 * sends; doing it here adds one batch after them.
 *
 * Never throws. A lost counter increment means one recipient's ceiling is
 * measured a message low, which is not worth failing a delivered send over.
 */
export async function recordMarketingSends(
  hostId: string,
  emails: readonly string[],
  options?: { nowMs?: number; firestore?: any },
): Promise<number> {
  const nowMs = options?.nowMs ?? Date.now()
  const keyed = new Map<string, string>()
  for (const email of emails) {
    const key = emailSuppressionKey(email)
    if (key) keyed.set(key, String(email).trim().toLowerCase())
  }
  if (!keyed.size || !hostId) return 0
  let recorded = 0
  try {
    const db = options?.firestore ?? defaultFirestore()
    for (const [key, email] of keyed) {
      const ref = frequencyDoc(hostId, key, db)
      const existing: MarketingFrequencyState = await ref
        .get()
        .then((snapshot: any) =>
          snapshot.exists ? stateFromSnapshot(snapshot) : { ...NO_RECORD },
        )
        .catch(() => ({ ...NO_RECORD }))
      const window = marketingFrequencyVerdict(
        [...existing.window, nowMs],
        nowMs,
      )
      await ref.set(
        {
          email,
          sentAtMs: window.inWindow,
          lastSentAtMs: nowMs,
          // Write-once, unlike `lastSentAtMs` beside it. Overwriting it would
          // restart the sunset clock on every send, which would make the
          // sunset unreachable — a person whose relationship is always "as
          // old as the last message" is never older than the window.
          ...(existing.firstSentAtMs ? {} : { firstSentAtMs: nowMs }),
        },
        { merge: true },
      )
      recorded += 1
    }
  } catch (error) {
    console.error('[email-marketing] frequency record failed', error)
  }
  return recorded
}

/**
 * The subset of `emails` that has NOT asked this site for mail less often
 * than right now.
 *
 * The fourth filter a campaign passes, after the platform suppression list,
 * the site's own and the topic opt-outs — and the only one that is not in
 * `email-suppression.ts` beside those three, because it reads the counter
 * document this module owns and that module is this module's dependency.
 *
 * {@link marketingSendVerdict} enforces the same rule per message, for the
 * senders that reach the gate. THIS is the campaign path's copy, and it is
 * the enforcement there rather than only a count: a campaign carries no
 * `marketing` context — it mints its own unsubscribe URL upstream — so the
 * gate is not on its path at all, and a rule asked only there would not be
 * asked of the sender that produces most of a person's mail.
 *
 * Answering it as a FILTER rather than per message is also the only placement
 * that keeps the composer honest. The argument for exempting a campaign from
 * the platform ceiling is that a control which silently removed people from a
 * reviewed one-shot send would make the number on screen a lie; subtracting
 * a request the recipient actually made, where every other refusal is already
 * subtracted, is what keeps this one from having that problem.
 *
 * Keyed and read with one `getAll`, matching its three neighbors: one round
 * trip bounded by the size of the send, and no composite index to go missing.
 *
 * ## Fails OPEN, like the topic filter beside it
 *
 * A cadence is a PACE, not a stop. Guessing wrong on an unreadable counter
 * costs one recipient one message sooner than they asked for; guessing wrong
 * the other way withholds a whole campaign on a transient read failure. The
 * two suppression lists have already refused everybody who asked us to stop
 * entirely, so nobody who said "no" reaches this line.
 */
export async function filterCadenceSendable(
  hostId: string,
  emails: readonly string[],
  options?: { nowMs?: number; firestore?: any },
): Promise<string[]> {
  if (!emails.length || !hostId) return [...emails]
  const nowMs = options?.nowMs ?? Date.now()
  // An unkeyable address carries no counter, so it has expressed no pace. It
  // is dropped from the LOOKUP and kept in the answer, exactly as the topic
  // filter keeps one: the stricter filters above have already had their say.
  const lookups: Array<{ email: string; key: string }> = []
  for (const email of emails) {
    const key = emailSuppressionKey(email)
    if (key) lookups.push({ email, key })
  }
  if (!lookups.length) return [...emails]
  try {
    const db = options?.firestore ?? defaultFirestore()
    const counters = db
      .collection('hosts')
      .doc(hostId)
      .collection(EMAIL_FREQUENCY_SUBCOLLECTION)
    const snapshots = await db.getAll(
      ...lookups.map((entry) => counters.doc(entry.key)),
    )
    const holding = new Set<string>()
    lookups.forEach((entry, index) => {
      const snapshot = snapshots[index]
      if (!snapshot?.exists) return
      // The same decoder the per-message path uses, so the two cannot
      // disagree about one document. The sunset's `firstSentAtMs` comes back
      // with it and is deliberately unused: a campaign is exempt from that
      // refusal, so subtracting on it here would remove people from a count
      // the gate is going to mail anyway.
      const state = stateFromSnapshot(snapshot)
      const verdict = marketingCadenceVerdict(
        state.cadence,
        state.lastSentAtMs,
        nowMs,
      )
      if (!verdict.allowed) holding.add(entry.email)
    })
    return emails.filter((email) => !holding.has(email))
  } catch (error) {
    console.error(
      '[email-marketing] cadence lookup failed; failing open',
      error,
    )
    return [...emails]
  }
}

/**
 * The gate itself, exported so it can be exercised without installing it.
 *
 * ORDER MATTERS. The suppression check is first because its answer is
 * permanent and the frequency record must not count a message that was never
 * going to leave — a suppressed address whose window kept growing would stay
 * capped for a day after being released.
 */
export async function marketingSendVerdict(
  request: MarketingSendGateRequest,
  options?: { nowMs?: number; firestore?: any },
): Promise<MarketingSendGateVerdict> {
  const nowMs = options?.nowMs ?? Date.now()
  const email = String(request.email ?? '')
    .trim()
    .toLowerCase()
  const sendable = await filterSendableForHost(
    request.hostId,
    [email],
    options?.firestore,
  )
  if (!sendable.length) {
    return {
      allowed: false,
      refusal: 'suppressed',
      detail:
        'This address has unsubscribed, bounced permanently, or reported a ' +
        'message as spam.',
    }
  }

  // Normalized once, and read by both the links below and the topic check
  // further down: two spellings of "which stream is this" is how a link comes
  // to carry a topic the gate did not check.
  const topicId = String(request.topicId ?? '').trim()

  /*
   * TWO URLS OVER ONE SIGNATURE, the same split `campaign-send.ts` makes and
   * for the same reason (RFC 8058).
   *
   * `oneClickUrl` is what `List-Unsubscribe` names: a mailbox provider POSTs
   * it with nobody present and expects the act to have happened when it reads
   * the 200, so it points at the route whose POST writes immediately.
   *
   * `unsubscribeUrl` is the link a PERSON clicks in the footer, and it points
   * at the preference page. Every caller on this path — the abandoned-cart
   * sweep, the restock notice, the newsletter welcome, the automation step —
   * names a topic, and a footer pointing at the one-click route gives the
   * recipient of one of those exactly one choice: stop hearing from this site
   * entirely. The page offers leaving that one stream instead, with
   * "Unsubscribe from everything" still on it.
   *
   * The topic rides both links, so the page opens on the stream the message
   * belonged to rather than on a list the recipient has to search.
   */
  const link = {
    siteBase: request.siteBase,
    hostId: request.hostId,
    email,
    ...(topicId ? { topicId } : {}),
  }
  const unsubscribeUrl = buildUnsubscribeUrl({
    ...link,
    surface: 'preferences',
  })
  const oneClickUrl = buildUnsubscribeUrl({ ...link, surface: 'one-click' })

  /*
   * THE STREAM THIS MESSAGE BELONGS TO — the third list, and the narrowest.
   *
   * ONLY when the caller named one. An absent topic is not "the default
   * topic": it is a message that belongs to no stream, and there is nothing
   * for a person to have left. That is what keeps this check off the mail it
   * must never touch — a receipt, a password reset, a booking confirmation,
   * none of which declare a `marketing` context at all and none of which name
   * a stream if they somehow did.
   *
   * After the suppression lists and before the counter read below, matching
   * the order `campaign-send.ts` filters in, for two reasons that agree. It
   * is the weaker fact, and the weaker fact should never be the one that
   * decides — a person who unticked "Promotions and offers" is still a
   * subscriber, where a person on either suppression list is not. And it is a
   * TERMINAL refusal, so answering it before the counter read means a
   * recipient this message was never going to reach costs one lookup rather
   * than three.
   *
   * Fails OPEN, because `filterTopicSendable` does: a topic preference is a
   * narrower fact than a suppression, and a read that failed for an unrelated
   * reason is no reason to withhold a message from somebody the two lists
   * above already cleared.
   */
  if (topicId) {
    const onTopic = await filterTopicSendable(
      request.hostId,
      topicId,
      [email],
      options?.firestore,
    )
    if (!onTopic.length) {
      /*
       * ⛔ A REFUSAL AND NOTHING ELSE, as with the pace refusals below.
       *
       * No suppression is written, no membership changes, and the frequency
       * window is not appended to — a message that never left must not count
       * against what this person has received. They stay on every other
       * stream they subscribe to, and the next message on one of those goes.
       */
      return {
        allowed: false,
        refusal: 'topic-unsubscribed',
        detail:
          'This address has left the email topic this message belongs to. ' +
          'They still receive the other streams from this site.',
        unsubscribeUrl,
        oneClickUrl,
      }
    }
  }

  // ONE read, and every refusal below is answered from it — except the
  // sunset's engagement half, which is a different document and is fetched
  // only when a window is configured and nothing above has already refused.
  const state = await readMarketingFrequencyState(
    request.hostId,
    email,
    options?.firestore,
  )

  /*
   * THE RECIPIENT'S OWN REQUEST, first among the three pace refusals and the
   * only one not subject to `capped`.
   *
   * `capped: false` exempts a campaign from the platform CEILING and from the
   * SUNSET, because a control the merchant did not ask for and cannot see,
   * silently removing people from a reviewed one-shot send, would make the
   * recipient count on screen a lie. That argument does not reach this one: a
   * person used the preference page to ask this site for less mail, and a
   * campaign that overrode them would make that page a form that records a
   * request nobody honors — the same failure as ignoring an unsubscribe, one
   * notch quieter.
   *
   * Above the sunset for three reasons. It is the only one of the three a
   * PERSON asked for, and when both apply the honest answer to "why did this
   * not send" is the fact somebody stated rather than the inference we drew.
   * It is answered entirely from the counter document already in hand, so a
   * recipient who asked for monthly mail never pays for the sunset's second
   * read. And it is the one refusal a campaign is bound by, so asking it
   * first gives the campaign path and the automated paths the same order.
   *
   * The sunset's terminality argument does not out-rank any of that: a sweep
   * that defers this row retries it once per cadence interval — a day, a week
   * or a month — not once per beat, which is what that argument is about.
   *
   * A campaign is bound by the rule but not by THIS enforcement of it: it
   * carries no `marketing` context, so nothing on its path reaches this
   * function. {@link filterCadenceSendable} is where it is asked there, and
   * asked as a filter so the recipient count reflects it before Send.
   */
  const cadence = marketingCadenceVerdict(
    state.cadence,
    state.lastSentAtMs,
    nowMs,
  )
  if (!cadence.allowed) {
    /*
     * ⛔ A REFUSAL AND NOTHING ELSE, exactly as below.
     *
     * Nobody is unsubscribed, no membership changes, no contact is touched,
     * and the frequency window is not appended to — a message that never left
     * must not count against what this person has received. Somebody who
     * asked for monthly mail stays on every audience they were on and is
     * mailed again next month.
     */
    return {
      allowed: false,
      refusal: 'cadence-limited',
      detail:
        `This address asked this site for no more than one marketing ` +
        `message ${CADENCE_PHRASES[state.cadence]}. The next one may go on ` +
        `${new Date(cadence.nextAllowedAtMs).toISOString()}.`,
      unsubscribeUrl,
      oneClickUrl,
    }
  }

  /*
   * THE SUNSET, ahead of the frequency ceiling.
   *
   * Ordered above the ceiling because its refusal is TERMINAL and the
   * ceiling's is not: a sweep defers a `frequency-capped` message and retries
   * it, so reporting the retryable refusal for a person the sunset would
   * refuse anyway means the same doomed row comes back on every beat.
   *
   * `request.capped` governs it, the same flag the ceiling reads, so a
   * campaign — a reviewed act with its recipient count on screen — is exempt
   * for the reason recorded on `MarketingSendContext.capped`. That leaves the
   * sunset governing the automated paths, which fire with no human present.
   *
   * The engagement read is the ONLY second round trip on this path, and it is
   * spent only when a window is configured, the caller is capped, and the
   * cadence above has already allowed. Off is the default, and off costs
   * nothing.
   */
  const sunsetDays = marketingSunsetDays()
  if (request.capped && sunsetDays > 0) {
    const engagement = await readPersonEngagement(email, options?.firestore)
    const sunset = marketingSunsetVerdict(
      {
        firstSentAtMs: state.firstSentAtMs,
        lastEngagedAtMs: engagement.lastEngagedAtMs,
      },
      nowMs,
      sunsetDays,
    )
    if (!sunset.allowed) {
      /*
       * ⛔ A REFUSAL AND NOTHING ELSE.
       *
       * No suppression is written, no membership is touched, no contact is
       * changed, and the frequency window below is not appended to — a
       * message that never left must not count against what this person has
       * received. The person is exactly where they were, and the next send
       * after they open anything goes.
       */
      return {
        allowed: false,
        refusal: 'unengaged',
        detail:
          `This address has not opened or clicked anything for ` +
          `${sunset.quietForDays} days, and this site has been mailing it ` +
          `for longer than the ${sunset.days}-day engagement window. It ` +
          `becomes mailable again as soon as they engage.`,
        unsubscribeUrl,
        oneClickUrl,
      }
    }
  }

  const verdict = marketingFrequencyVerdict(state.window, nowMs)
  if (request.capped && !verdict.allowed) {
    return {
      allowed: false,
      refusal: 'frequency-capped',
      detail:
        `This address has already received ${verdict.used} marketing ` +
        `messages from this site today (the ceiling is ${verdict.cap}).`,
      unsubscribeUrl,
      oneClickUrl,
    }
  }

  /*
   * The send is granted, so it is counted — including for a campaign, which
   * is exempt from the refusal above and not from this. `sentAtMs` therefore
   * measures what the recipient actually receives rather than only the part
   * of it a cap may stop, which is the difference between a ceiling and a
   * number that describes nothing.
   */
  const appended = marketingFrequencyVerdict(
    [...verdict.inWindow, nowMs],
    nowMs,
  )
  const key = emailSuppressionKey(email)
  if (key) {
    await frequencyDoc(request.hostId, key, options?.firestore)
      .set(
        {
          email,
          sentAtMs: appended.inWindow,
          lastSentAtMs: nowMs,
          // Write-once — see EmailFrequencyRecord.firstSentAtMs. Re-stamping
          // it on every send would keep the relationship permanently younger
          // than any sunset window, so the sunset could never fire.
          ...(state.firstSentAtMs ? {} : { firstSentAtMs: nowMs }),
        },
        { merge: true },
      )
      // Never blocks the send. A counter write that failed is a ceiling
      // measured one message low, and refusing delivery over it would let a
      // Firestore hiccup become an outage on a merchant's mail.
      .catch((error: unknown) => {
        console.error('[email-marketing] frequency write failed', error)
      })
  }

  return { allowed: true, unsubscribeUrl, oneClickUrl }
}

/**
 * Puts the gate on `sendEmail`'s path.
 *
 * **Called at module load**, from the bottom of this file, so that importing
 * `@aglyn/tenant-data-admin` anywhere is enough — every server surface in the
 * product already imports that barrel, and `export *` forces this module to
 * evaluate. The alternative, a call at each server entrypoint, is the
 * many-places-to-remember shape this codebase has rejected twice already.
 *
 * Idempotent: installing twice replaces the same closure with an equivalent
 * one, and the closure holds no state — the state is the Firestore document.
 */
export function installMarketingSendGate(): void {
  setMarketingSendGate((request) => marketingSendVerdict(request))
}

/** Whether a gate is installed. Reads the shared seam, not a local flag. */
export function isMarketingSendGateInstalled(): boolean {
  return getMarketingSendGate() !== null
}

installMarketingSendGate()
