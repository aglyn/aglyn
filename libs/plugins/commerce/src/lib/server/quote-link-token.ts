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

import { hostPublicOrigin } from '@aglyn/aglyn/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { quotePageHref } from '../constants/quote-page'
import { tokenSigningSecret } from './download'

/**
 * A quote's pay link (AGL-4094): `/pay-quote?q=<quoteId>&t=<token>` on the
 * business's own site, where the customer sees the quote and pays it.
 *
 * The token is `<version>.<signature>`: the quote's link version
 * (`quote.linkVersion`, absent reading as 1) and the first 32 hex characters of
 * `HMAC(quote-link:hostId:quoteId:version)` under the commerce
 * `TOKEN_SIGNING_SECRET`. A pure function of what the quote already holds, so
 * nothing is stored per link and every message that carried the link carries
 * the same working one. The `quote-link:` prefix keeps it from being replayed
 * as an order-status, download or supplier token, which sign other payloads
 * under the same secret.
 *
 * NO EXPIRY. A quote is paid when the customer is ready, and a link that died
 * first would be a quote they could not pay. The version is what retires a
 * link: replacing it bumps the version on the quote, and a link signed for an
 * older version still verifies, so its page can say the quote was replaced,
 * without showing any of it.
 */
const SIGNATURE_LENGTH = 32
const MAX_VERSION = 1_000_000

function signQuoteLink(hostId: string, quoteId: string, version: number): string {
  return createHmac('sha256', tokenSigningSecret())
    .update(`quote-link:${hostId}:${quoteId}:${version}`)
    .digest('hex')
    .slice(0, SIGNATURE_LENGTH)
}

/** The token's two halves, or null for a token not shaped like one. */
export function parseQuoteLinkToken(token: string): { version: number; signature: string } | null {
  const match = /^([1-9]\d{0,6})\.([0-9a-f]{32})$/.exec(String(token ?? ''))
  if (!match) return null
  const version = Number(match[1])
  if (!Number.isSafeInteger(version) || version > MAX_VERSION) return null
  return { version, signature: match[2] }
}

/** The token for one version of a quote's link, or null when the signing secret is unset. */
export function mintQuoteLinkToken(hostId: string, quoteId: string, version: number): string | null {
  if (!hostId || !quoteId || !Number.isSafeInteger(version) || version < 1 || version > MAX_VERSION) {
    return null
  }
  try {
    return `${version}.${signQuoteLink(hostId, quoteId, version)}`
  } catch {
    return null
  }
}

/**
 * Checks a presented token in constant time and answers the link version it
 * was signed for, or null for a token that is wrong, malformed or unverifiable
 * (no secret). The caller compares the version with the quote's own.
 */
export function verifyQuoteLinkToken(hostId: string, quoteId: string, token: string): number | null {
  if (!hostId || !quoteId) return null
  const parsed = parseQuoteLinkToken(token)
  if (!parsed) return null
  let expected: string
  try {
    expected = signQuoteLink(hostId, quoteId, parsed.version)
  } catch {
    return null
  }
  const a = Buffer.from(parsed.signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return null
  return timingSafeEqual(new Uint8Array(a), new Uint8Array(b)) ? parsed.version : null
}

/**
 * The absolute pay link for a quote at a link version, or null when either
 * half is missing: a site with no public address, or no signing secret. What
 * the console copies, and what a quote or invoice email puts in front of the
 * customer.
 */
export function quotePayLinkUrl(
  host: { cname?: unknown; subdomain?: unknown } | null | undefined,
  hostId: string,
  quoteId: string,
  version: number,
): string | null {
  const origin = hostPublicOrigin({
    cname: typeof host?.cname === 'string' ? host.cname : null,
    subdomain: typeof host?.subdomain === 'string' ? host.subdomain : null,
  })
  const token = mintQuoteLinkToken(hostId, quoteId, version)
  if (!origin || !token) return null
  return `${origin}${quotePageHref(quoteId, token)}`
}

/**
 * The absolute address of one of the current revision's proofs, behind the
 * same signed link as the page (`GET /api/commerce/quote-proof`, AGL-4096),
 * or null when the site has no public address or no signing secret. What the
 * quote email draws a proof image from (AGL-4097); a link the business
 * replaces stops serving it, with the page.
 */
export function quoteProofLinkUrl(
  host: { cname?: unknown; subdomain?: unknown } | null | undefined,
  hostId: string,
  quoteId: string,
  version: number,
  proofId: string,
): string | null {
  const origin = hostPublicOrigin({
    cname: typeof host?.cname === 'string' ? host.cname : null,
    subdomain: typeof host?.subdomain === 'string' ? host.subdomain : null,
  })
  const token = mintQuoteLinkToken(hostId, quoteId, version)
  if (!origin || !token || !proofId) return null
  const query = new URLSearchParams({ hostId, q: quoteId, t: token, file: proofId })
  return `${origin}/api/commerce/quote-proof?${query.toString()}`
}
