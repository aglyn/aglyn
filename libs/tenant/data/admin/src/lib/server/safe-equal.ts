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

import { timingSafeEqual } from 'crypto'

/**
 * Constant-time string comparison that tolerates a length mismatch
 * (AGL-1353 D8, extraction 2).
 *
 * The length-check-then-`timingSafeEqual` dance was hand-written in six files:
 * `media-signing.ts`, `edit-access-token.ts`, commerce `download.ts`,
 * `membership.ts`, `workflows/server.ts` and `apps/console/utils/cron-auth.ts`.
 * Every one of them carries its own note explaining the same hazard, which is
 * the shape of a helper that has not been written yet.
 *
 * **The length check is the load-bearing half.** `timingSafeEqual` THROWS on
 * buffers of different lengths, and in every one of those call sites the
 * length is attacker-controlled — a presented signature, a token segment, a
 * header. Forgetting it turns a `401`/`403` into an unhandled `500`, which is
 * both an outage and an oracle: a thrown request and a refused one are
 * distinguishable from outside.
 *
 * **What this does and does not hide.** The comparison itself is constant-time
 * for equal-length inputs. The length is compared first and in variable time,
 * so this leaks whether the candidate was the right LENGTH and nothing else —
 * the same property every hand-written copy had, and an acceptable one when
 * the expected length is a public constant (a hex digest, a base64url secret)
 * rather than a secret.
 *
 * Byte length, not code points: both sides are encoded as UTF-8 before
 * comparison, so a multi-byte candidate cannot slip past the length check and
 * reach the throwing call.
 */
export function safeEqual(
  presented: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (typeof presented !== 'string' || typeof expected !== 'string') {
    return false
  }
  const a = Buffer.from(presented, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  // Both empty is a match only in the vacuous sense, and every caller here is
  // comparing against a value that must exist. An empty expectation means a
  // secret was not configured, so refusing is the fail-closed answer.
  if (a.length === 0 || b.length === 0) return false
  if (a.length !== b.length) return false
  return timingSafeEqual(new Uint8Array(a), new Uint8Array(b))
}
