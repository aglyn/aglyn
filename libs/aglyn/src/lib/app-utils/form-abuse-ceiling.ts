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
 * The two audiences of a tripped form-submission abuse ceiling (AGL-1666).
 *
 * AGL-1655 made the ceiling refuse correctly and bill nothing, but it refused
 * into silence: the visitor got the component's generic "something went
 * wrong" and the site's owner got a Firestore document. This module holds the
 * words both of them see, in one place, because the two are constrained in
 * OPPOSITE directions and a single file is the only way to keep that visible:
 *
 *  - The **visitor** is a stranger to the site. They must be told plainly
 *    that their message did not arrive, and must NOT be told why — that this
 *    site passed an abuse threshold is the owner's business, not a caller's.
 *  - The **owner** needs exactly the withheld half: the count, the ceiling,
 *    and when it lifts.
 */

/**
 * Refusal code carried by the abuse-ceiling 429 (AGL-1655).
 *
 * The Free plan's monthly wall answers 429 too, so the STATUS identifies
 * nothing — this code is the whole discriminator, and one means "the customer
 * needs a bigger plan" while the other means "this site is being flooded".
 * Shared rather than restated so the producer and the consumer cannot drift.
 */
export const FORM_ABUSE_CEILING_CODE = 'form-abuse-ceiling'

/**
 * The month key both the billable counter and the refusal counter are keyed
 * by. UTC, matching the month boundary the ceiling resets on.
 */
export function submissionMonthKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7)
}

/** What the visitor is shown when a site's form is not accepting. */
export interface FormUnavailableNotice {
  /** The whole message. Fixed copy — never the server's terse `error`. */
  message: string
  /**
   * An alternative way to reach the site, when the site publishes one
   * (`business.supportEmail`, the token whose own description is "where
   * visitors should write for help"). Absent when it does not.
   */
  contact?: string
}

/**
 * The visitor's sentence.
 *
 * Three things it must not do, all of which the generic error branch did or
 * a friendlier rewrite would:
 *
 *  1. **Not blame the visitor.** They filled in a form correctly. Nothing
 *     about their message, their address or their retry is the reason.
 *  2. **Not explain.** "Unusual volume", "temporarily over its limit", even
 *     "this site is receiving too many messages" all tell a stranger
 *     something about the site owner's account that the owner never chose to
 *     publish. The refusal is the owner's problem to see, not the caller's.
 *  3. **Not sound delivered.** "We'll get back to you", or anything ending
 *     in a thank-you, converts a lost lead into a person waiting for a reply
 *     that is never coming. So it says, in as many words, that the message
 *     was not sent.
 *
 * What is left is short on purpose. The one genuinely useful thing to add is
 * a door that still opens, which is why `contact` rides along.
 */
export const FORM_UNAVAILABLE_MESSAGE =
  'This form isn’t accepting messages right now, so your message was not ' +
  'sent. Please try again later.'

/**
 * A site's published support address is author-written, so it is validated
 * before being rendered as a link rather than trusted. Conservative on
 * purpose: a rejected address costs the visitor a convenience, an accepted
 * junk one costs them a bounced email and the site a lead it never learns it
 * lost. The `mailto:` scheme is written by the renderer, not taken from here,
 * so this is a plausibility check and not the injection defence.
 */
const CONTACT_EMAIL_PATTERN = /^[^\s@<>"']+@[^\s@<>"'.]+(\.[^\s@<>"'.]+)+$/

/**
 * Does this refused submit mean "this site's form is not accepting", rather
 * than "something broke"?
 *
 * Takes the BODY only, deliberately. The obvious signature — `(status, body)`,
 * matching `parseLockdownRefusal` — invites a caller to gate on the status
 * first, and the status is precisely what does not distinguish this refusal
 * from the Free plan's monthly wall. A caller holding only this function
 * cannot make that mistake.
 *
 * Returns `null` for every other body, so a caller's existing generic error
 * branch keeps handling real failures. Dressing a 500 as a deliberate pause
 * would be the same class of lie in the other direction.
 */
export function parseFormUnavailableRefusal(
  body: unknown,
): FormUnavailableNotice | null {
  if (!body || typeof body !== 'object') return null
  const payload = body as { code?: unknown; contact?: unknown }
  if (payload.code !== FORM_ABUSE_CEILING_CODE) return null
  const contact =
    typeof payload.contact === 'string' && payload.contact.trim()
      ? payload.contact.trim()
      : undefined
  return {
    message: FORM_UNAVAILABLE_MESSAGE,
    ...(contact && CONTACT_EMAIL_PATTERN.test(contact) ? { contact } : {}),
  }
}

/** What the site's owner is shown while their form is paused. */
export interface FormsPausedOwnerNotice {
  title: string
  /** What happened, how many, and that none of it is billed. */
  message: string
  /** When it lifts, as a local-reading sentence — never a raw month key. */
  until: string
}

/**
 * The moment the ceiling resets: 00:00 UTC on the first of next month, which
 * is the same boundary AGL-1655's `Retry-After` points at and the same one
 * the `YYYY-MM` counter key rolls over on.
 */
export function formCeilingResetAt(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
}

/**
 * The honeypot's month, as the one sentence every surface renders (AGL-1831
 * staff chip tooltip, AGL-1836 owner inbox notice).
 *
 * The framing is the point, and it is why the sentence lives here instead of
 * in either component: the count reports the honeypot WORKING — caught and
 * dropped, nothing stored, nothing billed — not something wrong. A surface
 * that restated it could drift into alarm ("N spam attacks!") and train the
 * owner to fear the number that should reassure them. It is also the
 * AGL-1664 revisit input: spam creeping toward ~20% of a paying host's
 * submissions is the trigger for reopening the App Check / CAPTCHA call.
 *
 * Returns `null` below one catch, same rule as `formSubmissionsPausedNotice`
 * and for the same reason — the counter document persists from its first
 * catch forever, and a reassuring zero trains the reader to ignore the row.
 */
export function formSpamCaughtNotice(input: { spam: number }): string | null {
  const spam = Math.floor(Number(input.spam) || 0)
  if (spam < 1) return null
  return (
    `${spam.toLocaleString()} bot submission${spam === 1 ? '' : 's'} ` +
    `${spam === 1 ? 'was' : 'were'} caught and dropped by the honeypot ` +
    `this month — nothing was stored or billed.`
  )
}

/**
 * The owner's notice — the half deliberately withheld from the visitor.
 *
 * Shaped like `LockdownRefusalNotice` ({title, message, until}) so the
 * console renders it with the same three lines `LockdownNotice` already
 * establishes for "a thing is blocked, here is why and how it ends". The
 * console surface for a blocked thing should not look different depending on
 * which subsystem blocked it.
 *
 * Returns `null` below one refusal, so a quiet month renders nothing at all
 * rather than a reassuring zero — the counter document exists from the first
 * trip and never goes away, and "0 refused" on every subsequent month is
 * noise that trains the owner to ignore the row that will one day be real.
 */
export function formSubmissionsPausedNotice(input: {
  /** Refusals recorded for the month being displayed. */
  refused: number
  /** The site's ceiling, from the counter document. Omitted if unknown. */
  ceiling?: number
  now?: Date
}): FormsPausedOwnerNotice | null {
  const refused = Math.floor(Number(input.refused) || 0)
  if (refused < 1) return null
  const now = input.now ?? new Date()
  const ceiling =
    typeof input.ceiling === 'number' && Number.isFinite(input.ceiling)
      ? Math.floor(input.ceiling)
      : undefined
  const reset = formCeilingResetAt(now).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    // The boundary is a UTC instant; rendering it in the reader's zone would
    // move a 1 September reset to 31 August for most of the Americas.
    timeZone: 'UTC',
  })
  return {
    title: 'Form submissions are paused',
    message:
      `${refused.toLocaleString()} submission${refused === 1 ? '' : 's'} ` +
      `to this site ${refused === 1 ? 'has' : 'have'} been refused this month` +
      (ceiling
        ? ` after it passed ${ceiling.toLocaleString()} submissions`
        : '') +
      '. Refused submissions are not stored and are not billed. This ' +
      'usually means a bot is filling in one of your forms — if it is real ' +
      'traffic, contact support and we will raise the limit.',
    until: `Submissions start being accepted again on ${reset}.`,
  }
}
