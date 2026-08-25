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
 * `x-vercel-signature` verification for the log-drain receiver (AGL-1921).
 *
 * Its own module, with no dependency beyond `node:crypto`, so the security
 * boundary can be tested without a Firebase app, a credential or a fetch —
 * and so nothing in the ingest path can be imported without it.
 *
 * Vercel documents the header as `hmac-sha1(rawBody, drainSecret)` in hex
 * (docs/drains/security). Two consequences that are easy to get wrong:
 *
 * 1. **RAW body.** `await request.text()` BEFORE any parse. Parsing and
 *    re-serializing changes key order and whitespace and will not reproduce
 *    the digest, and the failure looks like a wrong secret rather than a bug.
 * 2. **Timing-safe compare.** A plain `===` on a hex digest leaks the digest
 *    a byte at a time to an attacker who can post repeatedly, which for an
 *    endpoint whose URL is discoverable is the entire attack.
 *
 * FAILS CLOSED at every branch: no secret configured, no header, wrong
 * length, wrong value — all false. There is no configuration of this function
 * under which an unsigned body is accepted.
 */
import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Is `signature` the drain signature for `rawBody` under `secret`?
 *
 * `secret` is passed in rather than read from the environment here so the
 * caller owns the "unset means reject" decision visibly, and so the test can
 * prove rejection without mutating `process.env`.
 */
export function isValidDrainSignature(
  rawBody: string,
  signature: string | null | undefined,
  secret: string | undefined,
): boolean {
  if (!secret) return false
  if (!signature) return false
  const expected = createHmac('sha1', secret)
    .update(rawBody, 'utf8')
    .digest('hex')
  const provided = signature.trim().toLowerCase()
  // `timingSafeEqual` THROWS on a length mismatch, which would be a 500 and a
  // length oracle at once; compare lengths first and reject.
  if (provided.length !== expected.length) return false
  return timingSafeEqual(
    Buffer.from(provided, 'utf8'),
    Buffer.from(expected, 'utf8'),
  )
}

/**
 * The signature Vercel would send for this body — test and tooling helper.
 * Exported so the spec signs its fixtures the way the real sender does
 * instead of restating the algorithm, which would let both drift together.
 */
export function drainSignatureFor(rawBody: string, secret: string): string {
  return createHmac('sha1', secret).update(rawBody, 'utf8').digest('hex')
}
