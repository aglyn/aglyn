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

import { createHmac } from 'crypto'
import {
  SITE_PREVIEW_COOKIE_TTL_MS,
  SITE_PREVIEW_ENTER_TTL_MS,
} from '@aglyn/aglyn/app-utils/site-preview'
import { tokenSigningSecret } from './media-signing'
import { safeEqual } from './safe-equal'

/**
 * A capability to see ONE site that is in preview (AGL-4086).
 *
 * On `*.aglyn.app` the site knows a console user by the `aglyn_edit_hint`
 * cookie the sign-in bounce plants on the tenant apex. A CUSTOM domain is
 * cross-site with every console cookie, so there the console mints an enter
 * link instead: `https://{domain}/api/site-preview/enter?blob=…`. The tenant
 * verifies the blob, plants an HttpOnly cookie on that host alone, and every
 * request after that is verified again before the site renders.
 *
 * ## Two kinds, deliberately non-interchangeable
 *
 * - `enter` rides the URL once. URLs are logged and shared, so it lives
 *   {@link SITE_PREVIEW_ENTER_TTL_MS} — long enough for one click.
 * - `cookie` is the planted value, living {@link SITE_PREVIEW_COOKIE_TTL_MS}.
 *
 * The kind is inside the signed context, so a leaked enter URL can never be
 * replayed as a 12-hour cookie, and a stolen cookie value cannot be pasted
 * into an enter link to plant itself on a second browser.
 *
 * ## What the signature is over
 *
 * `site-preview:{kind}:{payload}`, where the payload carries the `hostId` and
 * `exp`. The tenant compares the `hostId` with the site the REQUEST resolved
 * to, never with anything the URL says, so a token for one site opens no
 * other. The `site-preview:` prefix separates it from the media, edit-hint
 * and collection-preview signatures that share `TOKEN_SIGNING_SECRET`.
 *
 * ## What it is not
 *
 * It names a site and a time, not a person, and buys nothing but "render this
 * site as its team sees it". The person was checked when the console minted
 * the enter link (`siteViewRefusal`), and the 12 hours bound how long that
 * check is trusted.
 */

/** Version tag, mirroring the edit-hint token's. */
const TOKEN_PREFIX = 'aglyn-site-preview-v1'

export type SitePreviewTokenKind = 'enter' | 'cookie'

export interface SitePreviewClaims {
  hostId: string
  /** Expiry, epoch ms. */
  exp: number
}

export interface MintedSitePreviewToken {
  token: string
  expiresAtMs: number
}

function signPayload(kind: SitePreviewTokenKind, payloadB64: string): string {
  return createHmac('sha256', tokenSigningSecret())
    .update(`site-preview:${kind}:${payloadB64}`)
    .digest('base64url')
}

function ttlOf(kind: SitePreviewTokenKind): number {
  return kind === 'enter' ? SITE_PREVIEW_ENTER_TTL_MS : SITE_PREVIEW_COOKIE_TTL_MS
}

/**
 * Mints a token of the given kind for a site the caller has ALREADY decided
 * the person may see. The mint checks nothing.
 */
export function mintSitePreviewToken(
  kind: SitePreviewTokenKind,
  hostId: string,
  nowMs: number = Date.now(),
): MintedSitePreviewToken {
  if (!hostId) throw new Error('hostId is required')
  const exp = nowMs + ttlOf(kind)
  const claims: SitePreviewClaims = { hostId, exp }
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString(
    'base64url',
  )
  return {
    token: `${TOKEN_PREFIX}.${payload}.${signPayload(kind, payload)}`,
    expiresAtMs: exp,
  }
}

/**
 * Verifies a token AS the stated kind, FOR the stated site. `null` for
 * anything else: expired, tampered, malformed, another version, another kind,
 * another site, or a deploy with no signing secret (fail closed).
 *
 * An expiry further out than the kind allows is refused too, so a token
 * minted under a longer TTL by an older build cannot outlive this one's.
 */
export function verifySitePreviewToken(
  kind: SitePreviewTokenKind,
  token: unknown,
  hostId: string,
  nowMs: number = Date.now(),
): SitePreviewClaims | null {
  if (!hostId) return null
  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) {
    return null
  }
  const parts = token.split('.')
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) return null
  const [, payload, sig] = parts
  let expected: string
  try {
    expected = signPayload(kind, payload)
  } catch {
    return null
  }
  if (!safeEqual(sig, expected)) return null
  let claims: SitePreviewClaims
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  const exp = Number(claims?.exp)
  if (!Number.isFinite(exp) || exp <= nowMs) return null
  if (exp - nowMs > ttlOf(kind)) return null
  if (typeof claims.hostId !== 'string' || claims.hostId !== hostId) return null
  return { hostId: claims.hostId, exp }
}

/** The value of one cookie in a `Cookie` header, or `undefined`. */
export function readCookieValue(
  cookieHeader: string | null | undefined,
  name: string,
): string | undefined {
  if (!cookieHeader) return undefined
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim()
    if (trimmed.startsWith(`${name}=`)) return trimmed.slice(name.length + 1)
  }
  return undefined
}
