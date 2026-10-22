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

/**
 * Replay tolerance (AGL-499), in seconds: a delivery whose signed timestamp
 * is further than this from now is rejected, so a captured — once valid —
 * payload cannot be replayed indefinitely. 300s matches the default Stripe's
 * own `constructEvent` applies.
 *
 * Exported and pinned by spec on purpose. Widening it weakens the replay
 * control for every billing consumer at once, so it must be an argued change
 * (see AGL-1552, which asks whether retries need a wider window) and never a
 * silent edit to a magic number.
 */
export const STRIPE_REPLAY_TOLERANCE_SECONDS = 300

/**
 * Verifies a `Stripe-Signature` header against one signing secret.
 *
 * The header is a comma-separated list of `key=value` entries — one `t`
 * (the signed timestamp) and one or more `v1` HMACs — and `v1` REPEATS.
 * During a signing-secret roll Stripe signs each delivery with both the old
 * and the new secret and sends both signatures in the same header; that
 * overlap is the entire mechanism that makes a roll zero-downtime.
 *
 * This used to parse with `Object.fromEntries`, which keeps only the LAST
 * value for a repeated key. A caller holding the old secret therefore threw
 * away the signature it could actually verify whenever Stripe ordered the
 * new one last — roughly half of deliveries 400ing precisely during the
 * window meant to prevent downtime. So: collect EVERY `v1` and accept when
 * ANY of them verifies.
 *
 * Accepting more candidates does not loosen the replay window (AGL-499),
 * which is applied once, to the single signed timestamp, before any HMAC is
 * computed at all.
 */
export function verifyStripeSignature(
  payload: Buffer,
  header: string,
  secret: string,
): boolean {
  let timestamp = ''
  const candidates: string[] = []
  for (const entry of String(header ?? '').split(',')) {
    // Split on the FIRST `=` only: a value is opaque and may contain one.
    const separator = entry.indexOf('=')
    if (separator < 0) continue
    const key = entry.slice(0, separator).trim()
    const value = entry.slice(separator + 1).trim()
    if (!value) continue
    // First `t` wins. Only one is ever sent; taking the first means an
    // appended `t=<now>` cannot re-stamp a captured header past the window.
    if (key === 't') {
      if (!timestamp) timestamp = value
    } else if (key === 'v1') {
      candidates.push(value)
    }
    // Any other scheme (`v0`, future versions) is ignored, not trusted.
  }
  if (!timestamp || !candidates.length) return false

  // Replay window (AGL-499): reject deliveries whose signed timestamp is
  // more than STRIPE_REPLAY_TOLERANCE_SECONDS from now — matching Stripe's
  // constructEvent default — so a captured, once-valid payload cannot be
  // replayed indefinitely. Unchanged by the multi-signature parsing above.
  const timestampSeconds = Number(timestamp)
  if (
    !Number.isFinite(timestampSeconds) ||
    Math.abs(Date.now() / 1000 - timestampSeconds) >
      STRIPE_REPLAY_TOLERANCE_SECONDS
  ) {
    return false
  }

  const expected = Buffer.from(
    createHmac('sha256', secret)
      .update(`${timestamp}.${payload.toString('utf8')}`)
      .digest('hex'),
  )
  let matched = false
  for (const candidate of candidates) {
    const supplied = Buffer.from(candidate)
    // timingSafeEqual THROWS on unequal lengths, so the length must be
    // checked first — a wrong-length `v1` has to be a plain rejection, not a
    // 500. The digest length is fixed and public, so this leaks nothing.
    if (supplied.length !== expected.length) continue
    // Deliberately not `return true`: every same-length candidate is
    // compared in constant time and the loop runs to the end, so neither the
    // outcome nor the position of the matching signature is timing-visible.
    if (
      timingSafeEqual(new Uint8Array(supplied), new Uint8Array(expected))
    ) {
      matched = true
    }
  }
  return matched
}
