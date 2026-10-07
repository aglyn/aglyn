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
import { tokenSigningSecret } from './download'

/**
 * The guest order-status link (AGL-3610): `/order-status?o=<orderId>&t=<token>`
 * on the store's own address, mailed in every buyer email so a guest can see
 * their order without an account.
 *
 * The token is `HMAC(order-status:hostId:orderId)` under the commerce
 * `TOKEN_SIGNING_SECRET` — the supplier-callback shape: a pure function of
 * identifiers the order already has, so nothing is stored and every email ever
 * sent for the order carries the same working link. The `order-status:` prefix
 * keeps it from being replayed as a download or supplier token, which sign
 * other payloads under the same secret.
 *
 * NO EXPIRY, deliberately. A buyer opens a shipping email weeks later to find
 * a tracking number, and a link that has died by then is a support ticket.
 * What the page shows is bounded to match: the order's own lines, totals,
 * status and shipments — never the buyer's email, phone or full address — so
 * a forwarded link discloses no more than the email it came in.
 */
const ORDER_STATUS_TOKEN_LENGTH = 32

function signOrderStatus(hostId: string, orderId: string): string {
  return createHmac('sha256', tokenSigningSecret())
    .update(`order-status:${hostId}:${orderId}`)
    .digest('hex')
    .slice(0, ORDER_STATUS_TOKEN_LENGTH)
}

/** The token for one order, or `null` when the signing secret is unset. */
export function mintOrderStatusToken(
  hostId: string,
  orderId: string,
): string | null {
  try {
    return signOrderStatus(hostId, orderId)
  } catch {
    return null
  }
}

/** Constant-time check of a presented token. False when the secret is unset. */
export function verifyOrderStatusToken(
  hostId: string,
  orderId: string,
  token: string,
): boolean {
  if (!hostId || !orderId || !token) return false
  let expected: string
  try {
    expected = signOrderStatus(hostId, orderId)
  } catch {
    return false
  }
  const a = Buffer.from(String(token))
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(new Uint8Array(a), new Uint8Array(b))
}

/** The path the commerce page resolver serves the status page at. */
export const ORDER_STATUS_PATH = 'order-status'

/**
 * The absolute status link for an order, or `null` when either half is
 * missing: a site with no public address, or no signing secret. Callers fall
 * back to the store's home page rather than mail a broken link.
 */
export function orderStatusUrl(
  host: { cname?: unknown; subdomain?: unknown } | null | undefined,
  hostId: string,
  orderId: string,
): string | null {
  const origin = hostPublicOrigin({
    cname: typeof host?.cname === 'string' ? host.cname : null,
    subdomain: typeof host?.subdomain === 'string' ? host.subdomain : null,
  })
  const token = mintOrderStatusToken(hostId, orderId)
  if (!origin || !token) return null
  return (
    `${origin}/${ORDER_STATUS_PATH}?o=${encodeURIComponent(orderId)}` +
    `&t=${token}`
  )
}
