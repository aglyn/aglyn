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

import { randomBytes } from 'node:crypto'
import {
  signedLinkSignature,
  signedLinkSignatureMatches,
} from '@aglyn/tenant-data-admin/server/email-unsubscribe-link'
import { OUTREACH_API_ROUTES } from '../constants/api-routes'

/**
 * THE LINK A TRACKED SEQUENCE EMAIL CARRIES IN PLACE OF YOURS (AGL-3239,
 * AGL-3297).
 *
 * ## Short, and stored
 *
 * Every send since AGL-3297 carries `/api/outreach/l/<id>`: a random
 * {@link OUTREACH_LINK_ID_LENGTH}-character id naming an `outreachLinks`
 * document that holds the organization, the enrollment, the step, the link's
 * index and the destination. The send writes those documents before the
 * email leaves, and the route reads one to answer.
 *
 * The first design put all of that in a signed token instead, so the
 * redirect needed no read. It cost a ~350-character link, which in a
 * one-to-one plain-text email reads as bulk marketing — the whole thing a
 * sequence is not. A read per click is the cheaper of the two.
 *
 * The signed links already in inboxes keep working: the `click` route still
 * verifies and follows them, and {@link readOutreachClickToken} stays for it.
 * Nothing mints one any more.
 *
 * ## It cannot be turned into an open redirect
 *
 * The destination comes only from the stored document, which only the
 * sending runtime writes, and only for a URL written in that sequence's own
 * step; clients cannot read or write the collection at all. An id that names
 * no document is refused rather than followed. For the signed links, the
 * signature covers the destination, to the same end.
 *
 * ## It names ids, never an address
 *
 * A tracking URL lands in the recipient's history, in their gateway's logs
 * and in ours. The short link carries nothing but a random id; the stored
 * document names the enrollment, which names the person — a lookup that is
 * ours to make, not a bystander's to read off a URL.
 *
 * ## The id is unguessable
 *
 * Ten characters of base 62 from the platform's CSPRNG — about 59.5 bits. A
 * guess that lands resolves to a destination someone else was sent, and
 * would count a click that is recorded as the one it is (see
 * `click-events.ts`); it grants nothing else.
 */

/** The purpose Outreach's click links are signed under. */
export const OUTREACH_CLICK_PURPOSE = 'outreach-click'

/** The signed link's path on the console — answered, no longer minted. */
export const OUTREACH_CLICK_PATH = `/api/${OUTREACH_API_ROUTES.click}`

/** The short link's path on the console, before the id (AGL-3297). */
export const OUTREACH_SHORT_LINK_PATH = `/api/${OUTREACH_API_ROUTES.shortLink.replace(/\/:linkId$/, '')}`

/**
 * The longest destination a tracking link will carry.
 *
 * A token is a URL inside a URL, and mail clients wrap, truncate and refuse
 * to linkify very long ones. Past this the link is left alone: an unmeasured
 * click beats a link that arrives broken.
 */
export const OUTREACH_CLICK_TARGET_MAX = 512

/** What a click token names. */
export interface OutreachClickTarget {
  orgId: string
  enrollmentId: string
  /** The step whose email carried the link. */
  stepIndex: number
  /** The link's index among the ones that step rewrote. */
  linkIndex: number
  /** Where the recipient asked to go. */
  url: string
}

/** A document id as a token may carry one. */
const DOCUMENT_ID = /^[A-Za-z0-9_-]{1,160}$/

const base64url = (text: string): string => Buffer.from(text, 'utf8').toString('base64url')

/** A destination we will sign, or `null` for one we will not. */
export function outreachClickTargetUrl(value: unknown): string | null {
  const raw = String(value ?? '').trim()
  if (!raw || raw.length > OUTREACH_CLICK_TARGET_MAX) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  return url.href
}

/** Whether an index is one a token may carry. */
const index = (value: unknown): boolean =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 1000

/** A token for one link in one step of one enrollment, or `null` when it cannot be signed. */
export function mintOutreachClickToken(
  target: OutreachClickTarget,
  secret?: string,
): string | null {
  const url = outreachClickTargetUrl(target.url)
  if (!url) return null
  if (!DOCUMENT_ID.test(target.orgId) || !DOCUMENT_ID.test(target.enrollmentId)) return null
  if (!index(target.stepIndex) || !index(target.linkIndex)) return null
  const payload = base64url(
    JSON.stringify({
      v: 1,
      o: target.orgId,
      e: target.enrollmentId,
      s: target.stepIndex,
      i: target.linkIndex,
      u: url,
    }),
  )
  const signature =
    secret === undefined
      ? signedLinkSignature(OUTREACH_CLICK_PURPOSE, payload)
      : signedLinkSignature(OUTREACH_CLICK_PURPOSE, payload, secret)
  return signature ? `${payload}.${signature}` : null
}

/** What a token names, or `null` for one that is malformed or not ours. */
export function readOutreachClickToken(
  token: unknown,
  secret?: string,
): OutreachClickTarget | null {
  const raw = typeof token === 'string' ? token.trim() : ''
  const dot = raw.indexOf('.')
  // Generous, because the payload carries a destination — but bounded, so an
  // arbitrarily long string never reaches the HMAC.
  if (dot <= 0 || raw.length > 2048) return null
  const payload = raw.slice(0, dot)
  const signature = raw.slice(dot + 1)
  if (
    !signedLinkSignatureMatches({
      purpose: OUTREACH_CLICK_PURPOSE,
      payload,
      signature,
      ...(secret === undefined ? {} : { secret }),
    })
  ) {
    return null
  }
  try {
    const body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>
    if (body['v'] !== 1) return null
    const orgId = String(body['o'] ?? '')
    const enrollmentId = String(body['e'] ?? '')
    const stepIndex = body['s']
    const linkIndex = body['i']
    // Checked again on the way OUT, not only on the way in: the signature
    // says we minted this payload, and these say it is still one we will act
    // on — which is what keeps a destination that was signable under an
    // older rule from being followed under this one.
    const url = outreachClickTargetUrl(body['u'])
    if (!url) return null
    if (!DOCUMENT_ID.test(orgId) || !DOCUMENT_ID.test(enrollmentId)) return null
    if (!index(stepIndex) || !index(linkIndex)) return null
    return {
      orgId,
      enrollmentId,
      stepIndex: stepIndex as number,
      linkIndex: linkIndex as number,
      url,
    }
  } catch {
    return null
  }
}

/**
 * The tracking URL for one link on the console at `origin`, or `null` when
 * the origin is not HTTPS, the destination is not one we sign, or there is
 * no secret to sign with — no link rather than one that points at nothing.
 *
 * A `null` leaves the recipient with the destination the step actually
 * wrote, which is what `rewriteOutreachBodyLinks` does with it.
 */
export function outreachClickUrl(input: {
  origin: string | null | undefined
  target: OutreachClickTarget
  secret?: string
}): string | null {
  let origin: URL
  try {
    origin = new URL(String(input.origin ?? ''))
  } catch {
    return null
  }
  if (origin.protocol !== 'https:') return null
  const token = mintOutreachClickToken(input.target, input.secret)
  return token ? `${origin.origin}${OUTREACH_CLICK_PATH}?t=${token}` : null
}

/*==========================================
 * THE SHORT LINK (AGL-3297).
 *=========================================*/

/** How many characters a short link's id has. */
export const OUTREACH_LINK_ID_LENGTH = 10

const LINK_ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

/** A short link's id as the route will read one. */
const LINK_ID = new RegExp(`^[A-Za-z0-9]{${OUTREACH_LINK_ID_LENGTH}}$`)

/** Whether a value is shaped like a short link's id. */
export function isOutreachLinkId(value: unknown): value is string {
  return typeof value === 'string' && LINK_ID.test(value)
}

/**
 * A fresh short link id: base 62 from the CSPRNG, by rejection sampling so
 * every character is equally likely (62 does not divide 256).
 */
export function newOutreachLinkId(random: (size: number) => Uint8Array = randomBytes): string {
  let id = ''
  while (id.length < OUTREACH_LINK_ID_LENGTH) {
    for (const byte of random(OUTREACH_LINK_ID_LENGTH * 2)) {
      if (byte >= 248) continue
      id += LINK_ID_ALPHABET[byte % 62]
      if (id.length === OUTREACH_LINK_ID_LENGTH) break
    }
  }
  return id
}

/** What an `outreachLinks/{id}` document holds. */
export interface OutreachStoredLink extends OutreachClickTarget {
  v: 1
  createdAtMs: number
}

/**
 * The document for one link, or `null` when the target is not one we would
 * follow — the same checks the signed token applied at minting.
 */
export function outreachStoredLink(target: OutreachClickTarget, nowMs: number): OutreachStoredLink | null {
  const url = outreachClickTargetUrl(target.url)
  if (!url) return null
  if (!DOCUMENT_ID.test(target.orgId) || !DOCUMENT_ID.test(target.enrollmentId)) return null
  if (!index(target.stepIndex) || !index(target.linkIndex)) return null
  return {
    v: 1,
    orgId: target.orgId,
    enrollmentId: target.enrollmentId,
    stepIndex: target.stepIndex,
    linkIndex: target.linkIndex,
    url,
    createdAtMs: nowMs,
  }
}

/**
 * What a stored link names, or `null` for a document that is missing or not
 * one we will act on. Checked on the way OUT, as the token is: the document
 * was written by us, and these say it is still one we will follow.
 */
export function readOutreachStoredLink(data: unknown): OutreachClickTarget | null {
  if (!data || typeof data !== 'object') return null
  const body = data as Record<string, unknown>
  if (body['v'] !== 1) return null
  const orgId = String(body['orgId'] ?? '')
  const enrollmentId = String(body['enrollmentId'] ?? '')
  const url = outreachClickTargetUrl(body['url'])
  if (!url) return null
  if (!DOCUMENT_ID.test(orgId) || !DOCUMENT_ID.test(enrollmentId)) return null
  if (!index(body['stepIndex']) || !index(body['linkIndex'])) return null
  return {
    orgId,
    enrollmentId,
    stepIndex: body['stepIndex'] as number,
    linkIndex: body['linkIndex'] as number,
    url,
  }
}

/**
 * The short link for an id on the console at `origin`, or `null` when the
 * origin is not HTTPS or the id is not one — no link rather than one that
 * points at nothing. A `null` leaves the destination the step wrote.
 */
export function outreachShortLinkUrl(input: { origin: string | null | undefined; linkId: string }): string | null {
  let origin: URL
  try {
    origin = new URL(String(input.origin ?? ''))
  } catch {
    return null
  }
  if (origin.protocol !== 'https:' || !isOutreachLinkId(input.linkId)) return null
  return `${origin.origin}${OUTREACH_SHORT_LINK_PATH}/${input.linkId}`
}
