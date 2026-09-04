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
 * THE MAILBOX HALF OF A SENDING IDENTITY — which mailbox a site sends as, and
 * what a sent message records about the address it left on.
 *
 * `sending-domain.ts` decides the DOMAIN, which is never free: DMARC on the
 * mail apex is published with `adkim=s`, so the `From:` domain has to be
 * exactly the domain whose DKIM key signed the message. Nothing a merchant
 * types can move it. What a merchant CAN choose is the part in front of the
 * `@`, and this module is where that choice is validated and where the
 * address a message actually left on is turned into a stored record.
 *
 * ## The mailbox is a SITE setting, not a per-send field
 *
 * The two halves of "who is this from" separate on whether the value has to
 * be a real mailbox. A display name and a `Reply-To:` may vary per campaign —
 * they name a person and a destination, and the composer already carries
 * both. The local part may not, because it addresses the mailbox that a
 * bounce comes back to and that a mail client ignoring `Reply-To:` will
 * answer. A mailbox that exists in one campaign's headers and nowhere else
 * is an address nobody serves.
 *
 * `campaign-send.ts` states the same boundary from the other side: the
 * sending identity named in a send request is read by nothing, because the
 * address is resolved from the host document. Accepting a per-send local part
 * would reintroduce exactly the input path that closure removed.
 *
 * ## Pure, for the reason `sending-domain.ts` is pure
 *
 * Validating a mailbox name and composing the record of a send are decisions
 * about strings. They are unit-testable with no Firestore harness and no
 * route, and they are needed on both sides of the wire — the console route
 * that stores the choice and the surface that renders what a send recorded.
 */

import { normalizeLocalPart } from './sending-domain'

/*==========================================
  The mailbox a site sends as
==========================================*/

/**
 * The mailbox a site sends as before anybody chooses one.
 *
 * Here rather than beside either reader, because it had two definitions: the
 * console identity route and `resolveHostSendingIdentity` each carried their
 * own `'hello'`, and a default that is written down twice is a default that
 * disagrees with itself the first time either moves. The route's copy decides
 * what a merchant is shown; the resolver's decides what is actually sent.
 */
export const DEFAULT_SENDING_LOCAL_PART = 'hello'

/**
 * Mailbox names a site may not send as.
 *
 * Not a spam-word list — every entry is a mailbox that carries a meaning
 * somebody else relies on:
 *
 * `postmaster` and `abuse` are the role mailboxes RFC 2142 requires a domain
 * to RECEIVE at, and mail receivers treat traffic from them as operational.
 * A campaign leaving as `abuse@` is a merchant asserting a role they cannot
 * serve on a name whose complaints route elsewhere.
 *
 * `bounce`, `bounces` and `dmarc` are the return-path and reporting mailboxes
 * on the sending subdomain. On a domain Aglyn issues, the whole zone is ours
 * and those names are already spoken for; on a customer's own domain they are
 * where their DMARC aggregate reports land, and a merchant sending as one
 * would be reading their own campaign replies out of a reporting feed.
 *
 * A short list on purpose. Every additional refusal is a merchant told no for
 * a reason they have to be talked through, so a name earns its place here by
 * being one that BREAKS something rather than one that reads oddly.
 */
export const RESERVED_SENDING_LOCAL_PARTS: readonly string[] = [
  'abuse',
  'bounce',
  'bounces',
  'dmarc',
  'postmaster',
]

/**
 * `{ value, error }` rather than a discriminated union, matching
 * {@link SendingDomainCheck}: `strictNullChecks` is off repo-wide, so a
 * `{ ok: true } | { ok: false }` union does not narrow across a library
 * boundary. Both keys always present, exactly one of them null.
 */
export interface SendingLocalPartCheck {
  localPart: string | null
  error: string | null
}

/**
 * The mailbox name a site asked to send as, or the sentence refusing it.
 *
 * {@link normalizeLocalPart} is the safety half and is already sufficient as
 * one: its pattern is anchored at both ends of a trimmed string over
 * `[a-z0-9._+-]`, so no value it accepts can carry a CR, an LF, an `@`, a
 * quote or an angle bracket — the characters that turn a `From:` line into
 * two headers — and its 64-character ceiling is the local-part limit RFC 5321
 * sets. Nothing here loosens that; this function is called for what it
 * returns when the pattern says no.
 *
 * Which is the reason it exists. `normalizeLocalPart` answers the empty
 * string for anything malformed, and the console route read that answer
 * through `|| DEFAULT_LOCAL_PART` — so a merchant who typed `sales team!`
 * was told their site now sends as `hello@`, which is a real address they did
 * not choose presented as though they had. A refusal that names the rule is
 * the difference between a mistake somebody can correct and a setting that
 * silently disagrees with the person who set it.
 */
export function validateSendingLocalPart(
  input: string | null | undefined,
): SendingLocalPartCheck {
  const raw = String(input ?? '').trim()
  if (!raw) {
    return {
      localPart: null,
      error: 'Enter a mailbox name — the part of the address before the @.',
    }
  }
  if (raw.includes('@')) {
    return {
      localPart: null,
      error:
        'Enter only the part before the @. The domain is your site’s ' +
        'verified sending domain and cannot be changed here.',
    }
  }
  const localPart = normalizeLocalPart(raw)
  if (!localPart) {
    return {
      localPart: null,
      error:
        'A mailbox name uses letters, numbers, dots, dashes, plus signs and ' +
        'underscores, starts and ends with a letter or number, and is at ' +
        'most 64 characters. For example hello, sales or jamie.',
    }
  }
  if (RESERVED_SENDING_LOCAL_PARTS.includes(localPart)) {
    return {
      localPart: null,
      error:
        `${localPart}@ is reserved. Mail receivers and DMARC reporting treat ` +
        'it as an operational mailbox, so sending as it would misroute ' +
        'replies and complaints. Choose another name.',
    }
  }
  return { localPart, error: null }
}

/*==========================================
  Header-safe text
==========================================*/

/**
 * One line of text, safe to put in a header and short enough to fit one.
 *
 * Whitespace and control characters collapse to single spaces rather than
 * being stripped, because CR and LF inside a header value ARE the injection
 * shape and a name written across two lines is a name with a second header
 * after it. Truncation is last so the ceiling is measured over what survives.
 */
export function headerSafeText(
  value: string | null | undefined,
  max: number,
): string {
  return (
    String(value ?? '')
      /*
       * `\p{Cc}` names the control block by its Unicode property rather than
       * by a numeric range, which is what keeps the pattern readable as an
       * intention — the control characters are the POINT of this class, not
       * an accident in it — and keeps the file free of the literal escapes
       * that make a header-safety guard hard to review.
       */
      .replace(/[\p{Cc}\s]+/gu, ' ')
      .trim()
      .slice(0, Math.max(0, max))
  )
}

/** The line length an RFC 5322 display name has to live inside. */
export const SENDING_FROM_NAME_MAX = 78

/** The length an address may reach before it stops being deliverable. */
export const SENDING_REPLY_TO_MAX = 254

/*==========================================
  What a message recorded about its sender
==========================================*/

/**
 * The sender a message actually left with, as it is stored on the send.
 *
 * `from` is the envelope and header address — the local part and the domain
 * the resolver chose, never a domain a request named. `fromName` is the
 * display name that was in front of it, RESOLVED: the campaign's own name
 * where the composer set one and the org's branding default otherwise, which
 * is what the recipient saw and is not the same fact as the field the
 * composer stored. `replyTo` is present only when the send set one; a message
 * without it takes replies at `from`.
 */
export interface SentAsRecord {
  from: string
  fromName?: string
  replyTo?: string
}

/**
 * The fields a send stamps to record the address it left as, or nothing.
 *
 * Spread into the write that closes a send, beside the audience figures and
 * the list name, and for the same reason those are written rather than
 * re-derived: a site's sending identity is a setting, and a merchant who
 * verifies a new domain in November has not changed what went out in March.
 * A report that resolved the identity at read time would answer "what would
 * this send as today", which is a different question from the one a delivery
 * report is asked.
 *
 * Returns an EMPTY object when there is no address, so a caller spreading it
 * writes nothing at all rather than a record whose `from` is blank. A missing
 * `sentAs` is what a message sent before this shipped looks like, and a
 * surface has to be able to tell that apart from a send that recorded an
 * empty address — see `emailSentAs`, which reports it as unrecorded rather
 * than inventing one.
 */
export function sentAsStamp(options: {
  from?: string | null
  fromName?: string | null
  replyTo?: string | null
}): { sentAs?: SentAsRecord } {
  const from = String(options?.from ?? '')
    .trim()
    .toLowerCase()
  if (!from.includes('@')) return {}
  const fromName = headerSafeText(options?.fromName, SENDING_FROM_NAME_MAX)
  const replyTo = headerSafeText(
    options?.replyTo,
    SENDING_REPLY_TO_MAX,
  ).toLowerCase()
  return {
    sentAs: {
      from,
      ...(fromName ? { fromName } : {}),
      ...(replyTo ? { replyTo } : {}),
    },
  }
}
