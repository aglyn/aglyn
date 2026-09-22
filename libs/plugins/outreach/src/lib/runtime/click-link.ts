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

import {
  signedLinkSignature,
  signedLinkSignatureMatches,
} from '@aglyn/tenant-data-admin/server/email-unsubscribe-link'
import { OUTREACH_API_ROUTES } from '../constants/api-routes'

/**
 * THE LINK A TRACKED SEQUENCE EMAIL CARRIES IN PLACE OF YOURS (AGL-3239).
 *
 * `/api/outreach/click?t=…` on the console, minted exactly as the one-click
 * unsubscribe link is and for the same reasons: `<payload>.<signature>`,
 * where the payload is base64url JSON and the signature is the platform's
 * signed-link HMAC under Outreach's own purpose. No other link verifies as
 * this one and this one verifies as no other.
 *
 * ## The destination is IN the token
 *
 * The alternative — an index into the enrollment's stored step record — mints
 * a shorter link, and it was rejected. A link in an email has to keep working
 * after the enrollment is gone: a person erased from the workspace, a
 * sequence deleted, a workspace closed. With the destination in the token the
 * redirect needs no read at all to answer, and the RECORDING is what becomes
 * best-effort — bookkeeping beside the act, which is the same order
 * `runtime/timeline.ts` puts them in.
 *
 * It costs a long link, which in a cold plain-text email is a real cost and
 * is why a sequence's `trackClicks` setting is off by default.
 *
 * ## It cannot be turned into an open redirect
 *
 * The signature covers the destination, so the only URLs this route will
 * forward to are ones a send of ours signed, and the only URLs a send signs
 * are the ones written in that sequence's own step. Anything else fails the
 * check and is refused rather than followed.
 *
 * ## It names ids, never an address
 *
 * A tracking URL lands in the recipient's history, in their gateway's logs
 * and in ours. It carries the organization, the enrollment, the step and the
 * link's index — the enrollment names the person, and that lookup is ours to
 * make, not a bystander's to read off a URL.
 */

/** The purpose Outreach's click links are signed under. */
export const OUTREACH_CLICK_PURPOSE = 'outreach-click'

/** The link's path on the console. */
export const OUTREACH_CLICK_PATH = `/api/${OUTREACH_API_ROUTES.click}`

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
