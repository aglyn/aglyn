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
 * Inbound SMS keyword handling — the STOP half of Privacy Policy v4 §11
 * (AGL-1592).
 *
 * THIS IS A SEAM, NOT AN INTEGRATION. There is no SMS pipeline in this product
 * yet: nothing sends a text, so nothing receives a reply, and there is no
 * provider to name. Inventing one here would mean guessing a webhook payload
 * shape and a signature scheme, and a guess that is never exercised is not a
 * mechanism — it is a second promise with nothing behind it.
 *
 * What is real and worth having in advance is the part that is provider-
 * independent and that a provider integration cannot get right by itself:
 * WHICH words are an opt-out, and WHAT an opt-out does to our records. Those
 * are decided by CTIA's messaging principles and by TCPA, not by a vendor.
 *
 * WIRING THIS UP LATER — the checklist, deliberately written down here because
 * the thing that goes wrong is skipping step 1:
 *
 *  1. VERIFY THE PROVIDER'S SIGNATURE on the webhook request BEFORE calling
 *     `applyInboundSmsKeyword`. The `from` number is the entire authorization
 *     for the write: an unauthenticated caller who can post `{from, body}` can
 *     opt a stranger out (annoying) or, via START, opt a stranger BACK IN
 *     (a statutory violation with our name on it). Nothing in this file
 *     authenticates anything.
 *  2. Reply to the opt-out. CTIA expects a single confirmation message, and
 *     that reply is itself permitted after a STOP — it is the one message you
 *     may still send.
 *  3. Answer HELP with the program name and contact details.
 *  4. Only THEN is there anything to send. See the note on `releasePhoneContact`:
 *     clearing a suppression is not consent, and the consent mechanism is a
 *     different piece of work (AGL-1564).
 */

import {
  releasePhoneContact,
  suppressPhoneContact,
  type ContactChannel,
} from './contact-suppression'

/**
 * CTIA's standard opt-out set. These are the words a carrier expects every
 * program to honour, and several carriers enforce STOP at the network level
 * whether or not the program does.
 */
export const SMS_STOP_KEYWORDS = [
  'stop',
  'stopall',
  'unsubscribe',
  'cancel',
  'end',
  'quit',
  'optout',
] as const

/** The standard opt-back-in set. */
export const SMS_START_KEYWORDS = ['start', 'unstop', 'yes', 'optin'] as const

/** The standard help set. */
export const SMS_HELP_KEYWORDS = ['help', 'info'] as const

export type SmsKeywordVerdict = 'stop' | 'start' | 'help' | null

/**
 * Classify an inbound message body.
 *
 * Matching is deliberately STRICT — the whole message, once trimmed and
 * stripped of surrounding punctuation, must be the keyword. A substring match
 * would read "please don't stop sending these" as an opt-out, and "yes I want
 * to cancel my account" as both a START and a STOP depending on scan order.
 * Carriers apply the same whole-word rule.
 *
 * The one deliberate looseness is Unicode: smart quotes and full-width forms
 * arrive from real handsets, so the body is normalized before comparison.
 * Getting this wrong fails in the direction that matters — an unrecognised
 * STOP is an opt-out we ignored.
 */
export function parseSmsKeyword(body: string | null | undefined): SmsKeywordVerdict {
  const cleaned = String(body ?? '')
    .normalize('NFKC')
    .trim()
    // Strip surrounding punctuation and whitespace only: "STOP." and "«STOP»"
    // are opt-outs, "STOP CALLING ME" is handled below.
    .replace(/^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu, '')
    .toLowerCase()
  if (!cleaned) return null
  if ((SMS_STOP_KEYWORDS as readonly string[]).includes(cleaned)) return 'stop'
  if ((SMS_START_KEYWORDS as readonly string[]).includes(cleaned)) return 'start'
  if ((SMS_HELP_KEYWORDS as readonly string[]).includes(cleaned)) return 'help'
  return null
}

/**
 * Apply an inbound keyword to the suppression list.
 *
 * A STOP suppresses TEXTS ONLY, not calls. That is a real distinction and not
 * an oversight: the person replied to a text message, so a texting opt-out is
 * what they asked for, and silently widening it to calls would be us recording
 * a request nobody made. §11 offers the call opt-out through the other two
 * routes, and the staff intake records exactly what was asked for.
 *
 * @param from the originating number, as the provider reports it. MUST have
 *             been authenticated by the caller — see the file header.
 * @returns the verdict acted on, so the webhook knows which reply to send.
 */
export async function applyInboundSmsKeyword(input: {
  from: string
  body: string | null | undefined
  firestore?: any
}): Promise<{ verdict: SmsKeywordVerdict; applied: boolean }> {
  const verdict = parseSmsKeyword(input.body)
  if (verdict === 'stop') {
    const channels: ContactChannel[] = ['texts']
    await suppressPhoneContact({
      phoneNumber: input.from,
      channels,
      source: 'sms-keyword',
      note: 'Inbound keyword opt-out',
      ...(input.firestore ? { firestore: input.firestore } : {}),
    })
    return { verdict, applied: true }
  }
  if (verdict === 'start') {
    const applied = await releasePhoneContact({
      phoneNumber: input.from,
      note: 'Inbound keyword opt-in',
      ...(input.firestore ? { firestore: input.firestore } : {}),
    })
    return { verdict, applied }
  }
  // HELP and unrecognised bodies change no records. HELP still needs a reply,
  // which is the webhook's job.
  return { verdict, applied: false }
}
