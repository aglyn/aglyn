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

import { normalizeContactEmail } from '@aglyn/aglyn/app-utils/contacts'
import {
  signedLinkSignature,
  signedLinkSignatureMatches,
} from '@aglyn/tenant-data-admin/server/email-unsubscribe-link'
import { OUTREACH_API_ROUTES } from '../constants/api-routes'

/**
 * THE WAY OUT EVERY OUTREACH EMAIL CARRIES (AGL-2981).
 *
 * Two, in the `List-Unsubscribe` header, beside the footer's "reply no":
 *
 * - a signed HTTPS link on the console, `/api/outreach/unsubscribe?t=…`,
 *   which a mailbox provider POSTs with no person present (RFC 8058) and a
 *   mail client opens for a person;
 * - a `mailto:` at the rep's own mailbox, `<name>+unsubscribe@<domain>`,
 *   which the sync reads as an opt-out from whoever writes to it.
 *
 * ## The token
 *
 * `<payload>.<signature>`: the payload is base64url JSON naming the
 * organization and the enrollment, and the signature is the platform's
 * signed-link HMAC under Outreach's own purpose, so no other link verifies
 * as this one and this one verifies as no other. It carries no address —
 * the enrollment names the person, and a URL that lands in logs should not.
 *
 * It does not expire. CAN-SPAM holds an opt-out open for thirty days after
 * the send, and a link that stops working on day thirty-one helps nobody:
 * the only thing that retires one is rotating the signing secret
 * (`EMAIL_UNSUBSCRIBE_SECRET`, else `CRON_SECRET`).
 */

/** The purpose Outreach's links are signed under. */
export const OUTREACH_UNSUBSCRIBE_PURPOSE = 'outreach-unsubscribe'

/** The link's path on the console. */
export const OUTREACH_UNSUBSCRIBE_PATH = `/api/${OUTREACH_API_ROUTES.unsubscribe}`

/** The subaddress a mailbox's `mailto:` unsubscribe is written to. */
export const OUTREACH_UNSUBSCRIBE_SUBADDRESS = 'unsubscribe'

/** What a token names. */
export interface OutreachUnsubscribeTarget {
  orgId: string
  enrollmentId: string
}

/** A document id as a token may carry one. */
const DOCUMENT_ID = /^[A-Za-z0-9_-]{1,160}$/

const base64url = (text: string): string => Buffer.from(text, 'utf8').toString('base64url')

/** A token for one enrollment, or `null` when there is no secret to sign it with. */
export function mintOutreachUnsubscribeToken(
  target: OutreachUnsubscribeTarget,
  secret?: string,
): string | null {
  if (!DOCUMENT_ID.test(target.orgId) || !DOCUMENT_ID.test(target.enrollmentId)) return null
  const payload = base64url(JSON.stringify({ v: 1, o: target.orgId, e: target.enrollmentId }))
  const signature =
    secret === undefined
      ? signedLinkSignature(OUTREACH_UNSUBSCRIBE_PURPOSE, payload)
      : signedLinkSignature(OUTREACH_UNSUBSCRIBE_PURPOSE, payload, secret)
  return signature ? `${payload}.${signature}` : null
}

/** What a token names, or `null` for one that is malformed or not ours. */
export function readOutreachUnsubscribeToken(
  token: unknown,
  secret?: string,
): OutreachUnsubscribeTarget | null {
  const raw = typeof token === 'string' ? token.trim() : ''
  const dot = raw.indexOf('.')
  if (dot <= 0 || raw.length > 1024) return null
  const payload = raw.slice(0, dot)
  const signature = raw.slice(dot + 1)
  if (
    !signedLinkSignatureMatches({
      purpose: OUTREACH_UNSUBSCRIBE_PURPOSE,
      payload,
      signature,
      ...(secret === undefined ? {} : { secret }),
    })
  ) {
    return null
  }
  try {
    const body = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>
    const orgId = String(body['o'] ?? '')
    const enrollmentId = String(body['e'] ?? '')
    if (body['v'] !== 1 || !DOCUMENT_ID.test(orgId) || !DOCUMENT_ID.test(enrollmentId)) return null
    return { orgId, enrollmentId }
  } catch {
    return null
  }
}

/**
 * The HTTPS link for one enrollment on the console at `origin`, or `null`
 * when the origin is not HTTPS or there is no secret — no link rather than
 * one that points at nothing.
 */
export function outreachUnsubscribeUrl(input: {
  origin: string | null | undefined
  target: OutreachUnsubscribeTarget
  secret?: string
}): string | null {
  let origin: URL
  try {
    origin = new URL(String(input.origin ?? ''))
  } catch {
    return null
  }
  if (origin.protocol !== 'https:') return null
  const token = mintOutreachUnsubscribeToken(input.target, input.secret)
  return token ? `${origin.origin}${OUTREACH_UNSUBSCRIBE_PATH}?t=${token}` : null
}

/**
 * The `mailto:` unsubscribe at a mailbox: its account address with the
 * `+unsubscribe` subaddress, which Google Workspace delivers to the same
 * mailbox and the sync reads apart from the rep's other mail. `null` for an
 * address that is not one.
 */
export function outreachUnsubscribeMailbox(accountEmail: string): { address: string; uri: string } | null {
  const email = normalizeContactEmail(accountEmail)
  if (!email) return null
  const at = email.lastIndexOf('@')
  const local = email.slice(0, at).split('+')[0]
  if (!local) return null
  const address = `${local}+${OUTREACH_UNSUBSCRIBE_SUBADDRESS}@${email.slice(at + 1)}`
  return { address, uri: `mailto:${address}?subject=unsubscribe` }
}
