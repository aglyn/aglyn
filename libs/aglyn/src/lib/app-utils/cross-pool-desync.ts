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
 * Recognizes the rejection Firebase raises when another tab signs in to a
 * DIFFERENT account pool (AGL-3280).
 *
 * The console recovers from it (`apps/console/utils/cross-pool-desync.ts`
 * holds the reload and its fences) and the error beacon labels it, so the
 * two must agree on what it is. One definition, here, because a second copy
 * fails silently: a shape learned by the recovery would go on paging from the
 * beacon, or the other way round.
 *
 * Pure and framework-free — the beacon ships in every page's client bundle.
 */

/** The SDK's code for "the incoming user is not in this instance's pool". */
export const CROSS_POOL_DESYNC_CODE = 'auth/tenant-id-mismatch'

/**
 * Is this the cross-pool desync? Matched on `code` first, which is the field
 * Firebase promises; the message is the fallback for a rejection that arrived
 * as something plainer.
 *
 * Nothing here may throw: it runs inside rejection handlers, where a getter
 * that throws would lose the event it was asked about.
 */
export function isCrossPoolDesync(reason: unknown): boolean {
  try {
    if (!reason || typeof reason !== 'object') return false
    const error = reason as { code?: unknown; message?: unknown }
    if (String(error.code ?? '') === CROSS_POOL_DESYNC_CODE) return true
    return String(error.message ?? '').includes(CROSS_POOL_DESYNC_CODE)
  } catch {
    return false
  }
}
