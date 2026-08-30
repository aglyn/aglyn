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
 *     one whose answer is permanent.
 *  2. **An engagement sunset**, when an operator has configured a window —
 *     off by default, and it costs a read only when it is on.
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
 * stays exactly where they were, and the next window mails them again.
 */

import {
  getMarketingSendGate,
  marketingFrequencyVerdict,
  marketingSunsetDays,
  marketingSunsetVerdict,
  setMarketingSendGate,
  type MarketingSendGateRequest,
  type MarketingSendGateVerdict,
} from '@aglyn/shared-util-email'
import firebaseAdmin from './firebase-admin'
import { readPersonEngagement } from './email-delivery-log'
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
}

/** The stored window and the first-send stamp, read together. */
interface FrequencyState {
  sentAtMs: number[]
  firstSentAtMs: number | null
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
  return (await readFrequencyState(hostId, email, firestore)).sentAtMs
}

/**
 * The whole row: the window AND the first-send stamp, in one read.
 *
 * One read rather than two because the gate needs both on the same send, and
 * the sunset must not add a second round trip to a path that is already one
 * awaited HTTP POST per recipient.
 *
 * FAILS OPEN on both halves, for the same reason and in the same direction:
 * an empty window means "there is room", and a null stamp means "no record",
 * which refuses nobody.
 */
async function readFrequencyState(
  hostId: string,
  email: string,
  firestore?: any,
): Promise<FrequencyState> {
  const key = emailSuppressionKey(email)
  if (!key) return { sentAtMs: [], firstSentAtMs: null }
  try {
    const snapshot = await frequencyDoc(hostId, key, firestore).get()
    if (!snapshot.exists) return { sentAtMs: [], firstSentAtMs: null }
    const stored = snapshot.get('sentAtMs')
    const first = Number(snapshot.get('firstSentAtMs') ?? 0)
    return {
      sentAtMs: Array.isArray(stored)
        ? stored.map((at: unknown) => Number(at))
        : [],
      firstSentAtMs: Number.isFinite(first) && first > 0 ? first : null,
    }
  } catch (error) {
    console.error('[email-marketing] frequency read failed; allowing', error)
    return { sentAtMs: [], firstSentAtMs: null }
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
      const existing: FrequencyState = await ref
        .get()
        .then((snapshot: any) =>
          snapshot.exists
            ? {
                sentAtMs: snapshot.get('sentAtMs') ?? [],
                firstSentAtMs: Number(snapshot.get('firstSentAtMs') ?? 0) || null,
              }
            : { sentAtMs: [], firstSentAtMs: null },
        )
        .catch(() => ({ sentAtMs: [], firstSentAtMs: null }))
      const window = marketingFrequencyVerdict(
        [...(Array.isArray(existing.sentAtMs) ? existing.sentAtMs.map(Number) : []), nowMs],
        nowMs,
      )
      await ref.set(
        {
          email,
          sentAtMs: window.inWindow,
          // Write-once. Overwriting it would restart the sunset clock on
          // every send, which would make the sunset unreachable — a person
          // whose relationship is always "as old as the last message" is
          // never older than the window.
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

  const state = await readFrequencyState(
    request.hostId,
    email,
    options?.firestore,
  )

  /*
   * THE SUNSET, ahead of the frequency ceiling.
   *
   * Ordered first among the two because its refusal is TERMINAL and the
   * ceiling's is not: a sweep defers a `frequency-capped` message and retries
   * it, so reporting the retryable refusal for a person the sunset would
   * refuse anyway means the same doomed row comes back on every beat. The
   * suppression above stays first because its answer is permanent.
   *
   * `request.capped` governs it, the same flag the ceiling reads, so a
   * campaign — a reviewed act with its recipient count on screen — is exempt
   * for the reason recorded on `MarketingSendContext.capped`. That leaves the
   * sunset governing the automated paths, which fire with no human present.
   *
   * The engagement read is spent only when a window is configured. Off is the
   * default, and off costs nothing.
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
      }
    }
  }

  const verdict = marketingFrequencyVerdict(state.sentAtMs, nowMs)
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
        {
          email,
          sentAtMs: appended.inWindow,
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
