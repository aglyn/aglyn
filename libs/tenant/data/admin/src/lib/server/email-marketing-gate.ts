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
 * Four things, in the order they cost:
 *
 *  1. **Both suppression lists**, through the one shared helper. A person who
 *     unsubscribed from this site, hard-bounced anywhere in the product, or
 *     pressed "report spam" is not mailed. Asked first because it is the only
 *     one of the four whose answer is permanent.
 *  2. **The pace the RECIPIENT asked for** on the preference page, if they
 *     asked for one. Above the ceiling because it is a request somebody made
 *     rather than a guard the platform imposes, and unlike the ceiling it
 *     binds a campaign too.
 *  3. **A frequency ceiling**, per recipient per site, over a rolling day.
 *  4. **The signed unsubscribe URL**, so the message carries a way out.
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
  normalizeMarketingCadence,
  setMarketingSendGate,
  type MarketingCadence,
  type MarketingSendGateRequest,
  type MarketingSendGateVerdict,
} from '@aglyn/shared-util-email'
import firebaseAdmin from './firebase-admin'
import { emailSuppressionKey, filterSendableForHost } from './email-suppression'
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
   * The most recent marketing send, NEVER trimmed.
   *
   * `sentAtMs` is a rolling day, so after a quiet day it is empty and cannot
   * answer "when did this site last mail this person" — which is the only
   * question a weekly or monthly cadence asks. One number rather than a
   * window kept for a month.
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

/** What one recipient's counter document says, with its defaults applied. */
export interface MarketingFrequencyState {
  /** Send instants inside the rolling window. */
  window: number[]
  /** The most recent send, or `null` for somebody never mailed. */
  lastSentAtMs: number | null
  /** The recipient's chosen pace. */
  cadence: MarketingCadence
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
 * The whole counter document: the window, the last send, and the recipient's
 * chosen pace.
 *
 * One read for all three, which is the point of storing the cadence here —
 * see {@link EmailFrequencyRecord.cadence}. Fails open on every field for the
 * reason {@link readMarketingFrequency} states: an unreadable counter is not
 * evidence that anybody asked for less.
 */
export async function readMarketingFrequencyState(
  hostId: string,
  email: string,
  firestore?: any,
): Promise<MarketingFrequencyState> {
  const empty: MarketingFrequencyState = {
    window: [],
    lastSentAtMs: null,
    cadence: 'all',
  }
  const key = emailSuppressionKey(email)
  if (!key) return empty
  try {
    const snapshot = await frequencyDoc(hostId, key, firestore).get()
    if (!snapshot.exists) return empty
    const stored = snapshot.get('sentAtMs')
    const window = Array.isArray(stored)
      ? stored.map((at: unknown) => Number(at))
      : []
    const last = Number(snapshot.get('lastSentAtMs'))
    return {
      window,
      /*
       * The stored instant, or the newest entry still inside the window.
       *
       * The fallback is what makes this work on every record written before
       * `lastSentAtMs` existed: those carry a window and nothing else, and
       * reading `null` for them would let a monthly cadence pass on the first
       * message after this ships for anybody mailed in the last day.
       */
      lastSentAtMs: Number.isFinite(last)
        ? last
        : window.length
          ? Math.max(...window)
          : null,
      cadence: normalizeMarketingCadence(snapshot.get('cadence')),
    }
  } catch (error) {
    console.error('[email-marketing] frequency read failed; allowing', error)
    return empty
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
      const existing = await ref
        .get()
        .then((snapshot: any) =>
          snapshot.exists ? snapshot.get('sentAtMs') : null,
        )
        .catch(() => null)
      const window = marketingFrequencyVerdict(
        [...(Array.isArray(existing) ? existing.map(Number) : []), nowMs],
        nowMs,
      )
      await ref.set(
        { email, sentAtMs: window.inWindow, lastSentAtMs: nowMs },
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
 * {@link marketingSendVerdict} enforces the same rule per message and is the
 * backstop. THIS exists so a campaign's recipient count is true before the
 * merchant presses Send: the argument for exempting a campaign from the
 * platform ceiling is that a control which silently removed people from a
 * reviewed one-shot send would make the number on screen a lie, and the way
 * to keep a request the recipient actually made from having that problem is
 * to subtract it where every other refusal is already subtracted.
 *
 * Keyed and read with one `getAll`, matching its three neighbours: one round
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
      const stored = snapshot.get('sentAtMs')
      const window = Array.isArray(stored)
        ? stored.map((at: unknown) => Number(at))
        : []
      const last = Number(snapshot.get('lastSentAtMs'))
      const verdict = marketingCadenceVerdict(
        normalizeMarketingCadence(snapshot.get('cadence')),
        Number.isFinite(last)
          ? last
          : window.length
            ? Math.max(...window)
            : null,
        nowMs,
      )
      if (!verdict.allowed) holding.add(entry.email)
    })
    return emails.filter((email) => !holding.has(email))
  } catch (error) {
    console.error('[email-marketing] cadence lookup failed; failing open', error)
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

  const unsubscribeUrl = buildUnsubscribeUrl({
    siteBase: request.siteBase,
    hostId: request.hostId,
    email,
  })

  const state = await readMarketingFrequencyState(
    request.hostId,
    email,
    options?.firestore,
  )

  /*
   * THE RECIPIENT'S OWN REQUEST, and it is not subject to `capped`.
   *
   * `capped: false` exempts a campaign from the platform CEILING, because a
   * ceiling that silently removed people from a reviewed one-shot send would
   * make the recipient count on screen a lie. That argument is about a
   * control the merchant did not ask for and cannot see. It does not reach
   * this one: a person used the preference page to ask this site for less
   * mail, and a campaign that overrode them would make that page a form that
   * records a request nobody honors — which is the same failure as ignoring
   * an unsubscribe, one notch quieter.
   *
   * The count stays honest a different way: `filterCadenceSendable` subtracts
   * these people BEFORE a campaign reports its audience, exactly where the
   * two suppression lists and the topic opt-outs are already subtracted.
   */
  const cadence = marketingCadenceVerdict(
    state.cadence,
    state.lastSentAtMs,
    nowMs,
  )
  if (!cadence.allowed) {
    return {
      allowed: false,
      refusal: 'cadence-limited',
      detail:
        `This address asked this site for no more than one marketing ` +
        `message ${CADENCE_PHRASES[state.cadence]}. The next one may go on ` +
        `${new Date(cadence.nextAllowedAtMs).toISOString()}.`,
      unsubscribeUrl,
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
        { email, sentAtMs: appended.inWindow, lastSentAtMs: nowMs },
        { merge: true },
      )
      // Never blocks the send. A counter write that failed is a ceiling
      // measured one message low, and refusing delivery over it would let a
      // Firestore hiccup become an outage on a merchant's mail.
      .catch((error: unknown) => {
        console.error('[email-marketing] frequency write failed', error)
      })
  }

  return { allowed: true, unsubscribeUrl }
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
