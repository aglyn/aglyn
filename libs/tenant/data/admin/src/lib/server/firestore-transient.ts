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
 * Firestore failures that a second attempt can succeed past: contention
 * (`ABORTED`, which the admin SDK has already retried inside a transaction),
 * an unreachable backend, a deadline, or a quota burst. The admin SDK reports
 * gRPC codes as numbers. The string forms are kept for anything that
 * normalises them.
 *
 * `recursiveDelete` reports a failed bulk delete with the LAST failed write's
 * code copied onto its own error, so the same test classifies it.
 */
const TRANSIENT_FIRESTORE_CODES = new Set<unknown>([
  4, // DEADLINE_EXCEEDED
  8, // RESOURCE_EXHAUSTED
  10, // ABORTED
  14, // UNAVAILABLE
  'deadline-exceeded',
  'resource-exhausted',
  'aborted',
  'unavailable',
])

export function isTransientFirestoreError(error: unknown): boolean {
  try {
    return TRANSIENT_FIRESTORE_CODES.has((error as { code?: unknown } | null)?.code)
  } catch {
    return false
  }
}

export interface TransientFirestoreRetryOptions {
  /**
   * The wait before each retry, in order. Its length is the number of
   * retries, so the total attempts are `delaysMs.length + 1`.
   */
  delaysMs?: readonly number[]
  /** Called before each retry with the failure it follows. */
  onRetry?: (error: unknown, attempt: number) => void
}

/** 250 ms, 1 s, 2.5 s: past a burst without holding a request for long. */
export const DEFAULT_TRANSIENT_RETRY_DELAYS_MS: readonly number[] = [250, 1000, 2500]

/**
 * Run `operation`, and run it again after a pause when it fails with a
 * {@link isTransientFirestoreError | transient} code. Anything else, and the
 * last transient failure once the delays are spent, is thrown as it came.
 *
 * Only for an operation that is safe to repeat: a delete, a merge set, an
 * idempotent sweep. A retried `add` writes twice.
 */
export async function retryTransientFirestore<T>(
  operation: () => Promise<T>,
  options: TransientFirestoreRetryOptions = {},
): Promise<T> {
  const delaysMs = options.delaysMs ?? DEFAULT_TRANSIENT_RETRY_DELAYS_MS
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      if (attempt >= delaysMs.length || !isTransientFirestoreError(error)) throw error
      options.onRetry?.(error, attempt + 1)
      await new Promise((resolve) => setTimeout(resolve, delaysMs[attempt]))
    }
  }
}
