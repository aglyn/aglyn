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

import isEqual from 'lodash-es/isEqual'

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

/**
 * Whether a map we are about to write already INCORPORATES everything the
 * stored document gained since we last agreed with it (AGL-2486).
 *
 * ## Why the version stamp is the wrong question in a co-edited room
 *
 * {@link hasConcurrentWrite} asks "did the stored document move", and that
 * was the right question while a besigner session was an island. With the
 * co-edit mirror running it is not: a colleague's changes reach this canvas
 * node by node, *before* they press Save. So by the time their save moves
 * the stamp, this session usually already holds what they stored, and its
 * own write is a SUPERSET of it rather than a clobber. Refusing it protects
 * nothing and blocks the ordinary rhythm of two people building a page —
 * Zach: *"one user may save their edits then the other user may click save
 * as well, there should be no problem with this"*.
 *
 * So the question becomes "does my document contain theirs", and this
 * answers it from evidence rather than from an assumption that the mirror
 * is healthy:
 *
 * * Take every node whose STORED value differs from the baseline. That set
 *   is exactly what the other writer changed — added, edited or deleted.
 * * Require our map to carry the stored value for every one of them, an
 *   absent node included, which is how a deletion is incorporated.
 *
 * ## What cannot satisfy it
 *
 * A session that has fallen behind. A tab that lost its connection, or
 * whose mirror entries were reaped, never received those nodes — so it
 * still holds the BASELINE value for them, which by construction differs
 * from what is stored, and the very first one refuses the save. Same for a
 * write that never went through the mirror at all: an admin backfill that
 * edits `nodes` directly (AGL-1301) is invisible to every canvas in the
 * room and is caught here exactly as it was by the content check.
 *
 * A node we have edited OURSELVES since their value arrived also refuses,
 * and that is deliberate rather than a gap: it is the same-element
 * simultaneous edit, the one case co-editing genuinely cannot merge, and
 * papering over it is how the last writer silently wins. The author is sent
 * to reload, with their work still on the canvas.
 *
 * ## Absent inputs
 *
 * A missing baseline or a missing stored map answers FALSE, the opposite of
 * {@link hasConcurrentWrite}'s "not a conflict". The two defaults face the
 * same way: that function decides whether to REFUSE, and refusing on no
 * evidence would break editing; this one decides whether to RELAX a refusal
 * already justified, and relaxing on no evidence would lose work.
 */
export function incorporatesStoredNodes(
  baseNodes: unknown,
  storedNodes: unknown,
  ourNodes: unknown,
): boolean {
  const base = asNodeMap(baseNodes)
  const stored = asNodeMap(storedNodes)
  const ours = asNodeMap(ourNodes)
  if (!base || !stored || !ours) return false
  const ids = new Set([...Object.keys(base), ...Object.keys(stored)])
  for (const id of ids) {
    // Untouched by them: whatever we hold for it is our own business.
    if (isEqual(base[id], stored[id])) continue
    if (!isEqual(ours[id], stored[id])) return false
  }
  return true
}

function asNodeMap(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
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
