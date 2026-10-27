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

import { createHmac, timingSafeEqual } from 'crypto'
import { tokenSigningSecret } from '@aglyn/tenant-data-admin/server/media-signing'

/*==========================================
 * SIGNING ON THE CUSTOMER DISPLAY (AGL-4042): a grant.
 *
 * A register's paired customer display has no staff session, only the
 * display token of the plugin that runs the register, which this plugin
 * never sees. So when a staff member who may take signatures asks to sign on
 * the display, the console mints a grant: `{orgId, hostId, staff, exp}`
 * signed with the shared, fail-closed `TOKEN_SIGNING_SECRET`, domain-separated
 * by `waiver-display:` so it can never replay as any other signature under
 * that secret. The display's page signs with it, and the signature records
 * the staff member exactly as a tablet handed over at the window does.
 *
 * Short-lived (thirty minutes, core's `CUSTOMER_DISPLAY_SCREEN_TTL_MS`) and
 * good for one site's waivers; each signing under it is still its own
 * attempt, rate-limited and checked like any other. It names no customer.
 *=========================================*/

/** Thirty minutes: the life of a screen on a customer display. */
export const WAIVER_DISPLAY_GRANT_TTL_MS = 30 * 60 * 1000

const PREFIX = 'aglyn-waiver-display-v1'

export interface WaiverDisplayGrant {
  orgId: string
  hostId: string
  /** The staff member who put the waiver on the display. */
  staffUid: string
  staffName: string | null
  /** Expiry, epoch ms. */
  exp: number
}

let secretOverride: (() => string) | null = null

/** Test seam. */
export function setWaiverDisplaySecretForTests(secret: (() => string) | null): void {
  secretOverride = secret
}

const sign = (payload: string): string =>
  createHmac('sha256', (secretOverride ?? tokenSigningSecret)())
    .update(`waiver-display:${payload}`)
    .digest('base64url')

/** Mints a grant. Checks nothing itself: only the gated grant route calls it. */
export function mintWaiverDisplayGrant(
  claims: Omit<WaiverDisplayGrant, 'exp'>,
  nowMs: number,
): { grant: string; expiresAtMs: number } {
  const exp = nowMs + WAIVER_DISPLAY_GRANT_TTL_MS
  const payload = Buffer.from(
    JSON.stringify({
      orgId: claims.orgId,
      hostId: claims.hostId,
      staffUid: claims.staffUid,
      staffName: claims.staffName ? claims.staffName.slice(0, 120) : null,
      exp,
    }),
    'utf8',
  ).toString('base64url')
  return { grant: `${PREFIX}.${payload}.${sign(payload)}`, expiresAtMs: exp }
}

/**
 * A grant's claims, or `null` for anything else: expired, tampered,
 * malformed, another version, or a deploy with no signing secret (fail
 * closed).
 */
export function verifyWaiverDisplayGrant(grant: unknown, nowMs: number): WaiverDisplayGrant | null {
  if (typeof grant !== 'string' || grant.length > 2000) return null
  const [prefix, payload, signature, extra] = grant.split('.')
  if (prefix !== PREFIX || !payload || !signature || extra !== undefined) return null
  let expected: string
  try {
    expected = sign(payload)
  } catch {
    return null
  }
  const given = Buffer.from(signature)
  const wanted = Buffer.from(expected)
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return null
  let claims: Partial<WaiverDisplayGrant>
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<WaiverDisplayGrant>
  } catch {
    return null
  }
  if (
    typeof claims.orgId !== 'string' ||
    typeof claims.hostId !== 'string' ||
    typeof claims.staffUid !== 'string' ||
    typeof claims.exp !== 'number' ||
    !(claims.exp > nowMs)
  ) {
    return null
  }
  return {
    orgId: claims.orgId,
    hostId: claims.hostId,
    staffUid: claims.staffUid,
    staffName: typeof claims.staffName === 'string' ? claims.staffName : null,
    exp: claims.exp,
  }
}
