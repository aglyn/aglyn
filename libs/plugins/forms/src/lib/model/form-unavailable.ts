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
 * What a VISITOR is told when a site's form is not accepting (AGL-1666).
 *
 * The door answers a flooded site's submissions with a refusal the form
 * element recognises by its code, and the element shows the sentence below.
 * The owner's half of the same moment — the count, the ceiling and when it
 * lifts — is the forms plugin's `visitorDoors` declaration, which the Inbox
 * and the staff pages read without loading this plugin. The two halves are
 * constrained in opposite directions: the visitor is a stranger and must not
 * be told why; the owner needs exactly that.
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
