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
 * What basis lets a sender from the Inbox be put on a marketing list.
 *
 * Pure policy, no Firestore and no network, so the rule that decides whether
 * somebody joins a marketing audience can be asserted without an enrollment
 * path. The handler in `../server.ts` is the only caller.
 *
 * ## A reply is transactional; a list is marketing
 *
 * These are two acts and this module exists because they are constantly
 * mistaken for one. Answering a form submission is the transaction the person
 * started, so `reply-policy.ts` requires no consent record. Putting them on a
 * list is a standing invitation to mail them about things they never asked
 * about, and it requires a basis. Nothing in the reply path reaches this
 * module and nothing here sends anything.
 *
 * ## A basis is DECLARED, never inferred
 *
 * The submission itself is not a basis. Somebody who filled in a contact form
 * asked to be answered; that is the whole of what they asked for. Neither is
 * writing to the merchant, buying, booking or holding an account — the shared
 * `marketing-consent` module makes the same point for the send-time join, and
 * this is the enrollment-time half of it. So there are exactly two ways in:
 *
 * 1. the person's own record already carries a stored opt-in, which is
 *    carried across unchanged, timestamp and all; or
 * 2. the merchant states that they have this person's permission, and THAT
 *    STATEMENT IS ITSELF THE RECORDED BASIS — stored with the account that
 *    made it and the moment they did.
 *
 * There is no third way and, in particular, no unattributed one. The absence
 * of a record is reported to the merchant as an absence rather than resolved
 * quietly in either direction.
 *
 * ## A stored refusal ends it
 *
 * `declined` is checked first and answers before anything else is considered,
 * including an attestation. A merchant cannot attest their way past somebody
 * who said no; that is the one thing an attestation must not be able to buy,
 * because if it could there would be no difference between recording a
 * refusal and discarding it.
 */

import type { MarketingConsentRecord } from '@aglyn/aglyn/server'
import type { ReplyRefusal } from './reply-policy'

/** Why an address cannot be put on a list. Each maps to one refusal message. */
export type AssignmentRefusal =
  /**
   * The two address failures and the two suppression failures are shared with
   * the reply path, because they are properties of the ADDRESS rather than of
   * the act: a form with no email field has nobody to enroll for the same
   * reason it has nobody to answer.
   */
  | ReplyRefusal
  /** A stored refusal. Never enrollable, and there is no override. */
  | 'declined'
  /** No record either way, and the merchant asserted nothing. */
  | 'no-basis'

/** The basis an enrollment would carry, resolved server-side. */
export interface AssignmentBasisDecision {
  basis: 'contact-opt-in' | 'operator-attested'
  /** When the basis was recorded — the person's own moment, or the merchant's. */
  atMs: number
  /** The account answerable for an attestation; `null` for a pass-through. */
  byUid: string | null
}

/**
 * Decides what basis, if any, an enrollment may carry.
 *
 * The client never names the basis. It says only whether the merchant is
 * asserting one, and the pass-through is derived here from the person's own
 * record — a caller that could claim `contact-opt-in` would be a caller that
 * can manufacture an opt-in for anybody by naming it.
 *
 * @param stored   the person's consent facts, read off their own record.
 * @param attested whether the merchant asserted permission in this request.
 */
export function assignmentBasis(input: {
  stored: MarketingConsentRecord
  attested: boolean
  actingUid: string
  nowMs: number
}): AssignmentBasisDecision | { refusal: AssignmentRefusal } {
  // First, and above the attestation on purpose. See the module note.
  if (input.stored.basis === 'declined') return { refusal: 'declined' }
  if (input.stored.basis === 'granted') {
    return {
      basis: 'contact-opt-in',
      /*
       * The person's own timestamp, and `nowMs` only when their record
       * carries none. A pass-through that restamped the moment would report
       * every historical opt-in as having happened when a merchant pressed a
       * button, which moves records across the enforcement cutoff the consent
       * policy grandfathers on and makes the audit answer the wrong question.
       */
      atMs: input.stored.basisAtMs ?? input.nowMs,
      byUid: null,
    }
  }
  if (!input.attested) return { refusal: 'no-basis' }
  return {
    basis: 'operator-attested',
    atMs: input.nowMs,
    // Never optional for this basis: an attestation nobody is named for is
    // indistinguishable from an opt-in, which is the conflation the whole
    // module exists to prevent.
    byUid: input.actingUid,
  }
}

/** What the merchant is shown before they decide. */
export interface AssignmentReadout {
  /** Can this person be enrolled at all, by any answer the merchant gives? */
  enrollable: boolean
  /**
   * Must the merchant assert permission for the enrollment to proceed?
   *
   * False both when a stored opt-in already carries it and when nothing can
   * carry it, so the UI reads this alone to decide whether to show the
   * assertion control — a surface that showed it on a refusal would offer an
   * override that does not exist.
   */
  requiresAttestation: boolean
  /** One sentence of consent facts, in the merchant's terms. */
  summary: string
}

/**
 * The readout for one address, from the same inputs the decision uses.
 *
 * It lives here rather than in the component so the sentence on screen and
 * the rule that runs on the server cannot drift: a UI that computed its own
 * summary would eventually tell a merchant that somebody may be added and
 * then refuse them, or — far worse — say a check was performed that was not.
 *
 * @param suppression a suppression refusal for the address, when there is
 *                    one. It outranks consent in the readout because it is
 *                    the answer regardless of what any consent record says.
 */
export function assignmentReadout(input: {
  stored: MarketingConsentRecord
  suppression: ReplyRefusal | null
}): AssignmentReadout {
  if (input.suppression) {
    return {
      enrollable: false,
      requiresAttestation: false,
      summary: ASSIGNMENT_REFUSAL_MESSAGES[input.suppression],
    }
  }
  if (input.stored.basis === 'declined') {
    return {
      enrollable: false,
      requiresAttestation: false,
      summary: ASSIGNMENT_REFUSAL_MESSAGES['declined'],
    }
  }
  if (input.stored.basis === 'granted') {
    const when = input.stored.basisAtMs
      ? ` on ${new Date(input.stored.basisAtMs).toLocaleDateString()}`
      : ''
    return {
      enrollable: true,
      requiresAttestation: false,
      summary: `This person opted in to marketing email${when}. Adding them carries that opt-in across.`,
    }
  }
  return {
    enrollable: true,
    requiresAttestation: true,
    summary:
      'There is no marketing opt-in on record for this person. Sending this ' +
      'form does not create one. To add them you have to state that you have ' +
      'their permission, and that statement is recorded against your account.',
  }
}

/** What a refusal says to the merchant. One line, naming the cause. */
export const ASSIGNMENT_REFUSAL_MESSAGES: Record<AssignmentRefusal, string> = {
  'no-address':
    'This submission has no email field, so there is nobody to add to a list.',
  'unroutable-address':
    'The email address on this submission is not a valid address.',
  'suppressed-platform':
    'This address bounced or reported a message as spam, so it cannot be mailed or added to a list.',
  'suppressed-host':
    'This address unsubscribed from this site, so it cannot be mailed or added to a list.',
  declined:
    'This person declined marketing email. They cannot be added to a list, and there is no way to override that.',
  'no-basis':
    'This person has no marketing opt-in on record, so they can only be added if you state that you have their permission.',
}
