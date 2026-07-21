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
 * Comparable form of a version doc's `updatedAt` (AGL-674).
 *
 * Deliberately compares for EQUALITY, never ordering. `updatedAt` is written
 * with a client clock (`Timestamp.now()` in the version converter), so two
 * machines' timestamps cannot be ordered against each other — but any write
 * by anyone changes the value, and "did this change since I loaded it" is
 * the only question conflict detection needs to answer.
 *
 * Returns null for a missing/!unrecognised stamp so a doc that has never
 * been written cannot be mistaken for one that has.
 */
export function versionStamp(updatedAt: unknown): string | null {
  if (!updatedAt) return null
  const value = updatedAt as {
    seconds?: number
    nanoseconds?: number
    toMillis?: () => number
  }
  if (typeof value.toMillis === 'function') {
    try {
      return `ms:${value.toMillis()}`
    } catch {
      // Fall through to the field form below.
    }
  }
  if (typeof value.seconds === 'number') {
    return `ts:${value.seconds}.${value.nanoseconds ?? 0}`
  }
  if (typeof updatedAt === 'number') return `ms:${updatedAt}`
  if (typeof updatedAt === 'string') return `s:${updatedAt}`
  return null
}

/**
 * Whether the stored document has moved since the editor loaded it.
 *
 * An absent base means "we never established one" — treated as NOT a
 * conflict, because refusing every save on a document we failed to stamp
 * would break editing entirely to protect against a case we cannot
 * confirm. An absent stored stamp likewise: the doc has no write to
 * conflict with.
 */
export function hasConcurrentWrite(
  baseStamp: string | null,
  storedStamp: string | null,
): boolean {
  if (!baseStamp || !storedStamp) return false
  return baseStamp !== storedStamp
}

/** Thrown by a guarded save when someone else wrote first. */
export class ConcurrentEditError extends Error {
  constructor() {
    super(
      'Someone else saved this document while you were editing. Reload to ' +
        'see their changes — your work is still here until you do.',
    )
    this.name = 'ConcurrentEditError'
  }
}
