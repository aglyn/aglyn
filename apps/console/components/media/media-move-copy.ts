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
 * What the DAM says around a move (AGL-1469).
 *
 * Sibling of `media-delete-copy`, and the same defect one verb along. A bulk
 * move of nineteen files returned a red **"Move failed"** while seven of them
 * had already moved.
 *
 * ## Why a total-failure message over a partial success is the worst shape
 *
 * Not because it is inaccurate — because it **inverts the safe response.**
 * "Failed" means "do it again", and doing it again runs against a selection
 * seven of whose members are no longer where the selection thinks they are. A
 * clean failure would have been safe to retry and a clean success would have
 * needed no retry; only the denial of a partial success actively points at
 * the wrong next action.
 *
 * And a move is copy-then-delete. Those seven objects had already been
 * rewritten to a new prefix in the bucket while the message said nothing had
 * happened, so this was a partial rewrite of storage being reported as a
 * no-op — not a database update that could be re-issued for free.
 *
 * ## What these sentences are obliged to carry
 *
 * - **The split, in AGL-1461's vocabulary.** `Moved 7 of 19 — 12 could not be
 *   moved`. The count that succeeded and the count that did not, never one
 *   without the other.
 * - **The boundary.** Which files did not move: named while a snackbar can
 *   hold them, counted when it cannot, and left SELECTED in every case, which
 *   is the part that survives the message being dismissed.
 * - **The destination, by path.** `to "Blog / Covers"`, never `to "Covers"` —
 *   the sibling issue is that two folders can share a name, and this line is
 *   the last chance to show which one the files actually went to.
 */

import { MAX_NAMED } from './media-delete-copy'

const quote = (name: string) => `"${name}"`

/** `"a"`, `"a" and "b"`, `"a", "b" and "c"` — Oxford-free, snackbar-length. */
function joinNames(names: string[]): string {
  const quoted = names.map(quote)
  if (quoted.length <= 1) return quoted[0] ?? ''
  return `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`
}

/** `"a.png", "b.png", "c.png" and 9 more` — elision counted, never trailing off. */
function nameList(names: string[]): string {
  const shown = names.slice(0, MAX_NAMED)
  const hidden = names.length - shown.length
  return hidden
    ? `${shown.map(quote).join(', ')} and ${hidden} more`
    : joinNames(shown)
}

/**
 * How the destination is named. `null` is the root, and it has no path — so
 * it is described by what happened rather than given a fake folder name.
 */
function destinationClause(destination: string | null): string {
  return destination ? `to ${quote(destination)}` : 'out of their folders'
}

/** `Moved 11 files to "Blog / Covers"`. */
export function movedMediaMessage(
  count: number,
  destination: string | null,
): string {
  const files = `${count} file${count === 1 ? '' : 's'}`
  return destination
    ? `Moved ${files} to ${quote(destination)}`
    : `Moved ${files} out of their folders`
}

export interface PartialMove {
  movedCount: number
  totalCount: number
  destination: string | null
  /** Names of what did not move, for as many as the line can hold. */
  failedNames: string[]
}

/**
 * `Moved 7 of 19 to "Blog / Covers" — 12 could not be moved, and are still
 * selected`.
 *
 * The trailing clause is not politeness. It is the only sentence that tells an
 * author the retry in front of them is the RIGHT retry — the twelve are still
 * selected and the seven are not, so clicking MOVE TO FOLDER… again does the
 * correct thing without them reconstructing which was which.
 */
export function partialMoveMessage(move: PartialMove): string {
  const { movedCount, totalCount, destination, failedNames } = move
  const failedCount = totalCount - movedCount
  const named = failedNames.length ? `: ${nameList(failedNames)}` : ''
  return (
    `Moved ${movedCount} of ${totalCount} ${destinationClause(destination)} — ` +
    `${failedCount} could not be moved${named}, and are still selected`
  )
}

/**
 * Nothing moved — the one case where "failed" is honest.
 *
 * It still has to say where the files are NOW, because the reason the old
 * message was dangerous was never the word "failed": it was leaving that
 * question unanswered.
 */
export function moveFailureMessage(count: number, names: string[]): string {
  if (count === 1) {
    const which = names[0] ? quote(names[0]) : 'the file'
    return `Could not move ${which} — it is still in its original folder`
  }
  const named = names.length ? `: ${nameList(names)}` : ''
  return `Could not move ${count} files${named} — they are still in their original folder`
}
