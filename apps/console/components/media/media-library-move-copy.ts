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

import type { MediaLibraryDirection } from '@aglyn/aglyn/app-utils/media-library-move'

/**
 * What the media library says around a move to the other library (site ↔
 * organization). Same rules as a folder move (`media-move-copy`): a partial
 * result is never called a failure, what did not move is named and stays
 * selected, and every sentence says where the files are now.
 */

const files = (count: number) => `${count} file${count === 1 ? '' : 's'}`
const uses = (count: number) => `${count} use${count === 1 ? '' : 's'}`

/** The action's label, by where the file is now. */
export function moveToOtherLibraryLabel(direction: MediaLibraryDirection): string {
  return direction === 'to-site'
    ? "Move to this site's library"
    : 'Move to organization library'
}

/** Where the files go, in a sentence. */
export function libraryName(direction: MediaLibraryDirection): string {
  return direction === 'to-site' ? "this site's library" : 'the organization library'
}

/** The dialog's explanation before anything moves. */
export function moveToOtherLibraryIntro(
  direction: MediaLibraryDirection,
  movable: number,
  documents: number,
): string {
  const where = libraryName(direction)
  const what =
    direction === 'to-site'
      ? 'Only this site will be able to use them.'
      : 'Every site in the workspace will be able to use them.'
  const updated =
    documents > 0
      ? ` ${documents} page${documents === 1 ? '' : 's'}, product${documents === 1 ? '' : 's'} or setting${documents === 1 ? '' : 's'} that use${documents === 1 ? 's' : ''} them will be updated to the new address, and the old address keeps working.`
      : ' Nothing uses them yet.'
  return `${files(movable)} will move to ${where}. ${what}${updated}`
}

/** `Moved 12 files to this site's library and updated 31 uses`. */
export function movedToOtherLibraryMessage(
  direction: MediaLibraryDirection,
  moved: number,
  rewrote: number,
): string {
  return `Moved ${files(moved)} to ${libraryName(direction)} and updated ${uses(rewrote)}`
}

/**
 * `Moved 7 of 9 to this site's library and updated 12 uses — 2 could not be
 * moved: "a.png" and "b.png", and are still selected`.
 */
export function partialOtherLibraryMessage(options: {
  direction: MediaLibraryDirection
  moved: number
  total: number
  rewrote: number
  notMoved: Array<{ name: string; reason?: string }>
}): string {
  const { direction, moved, total, rewrote, notMoved } = options
  const named = notMoved
    .slice(0, 3)
    .map((one) => (one.reason ? `"${one.name}" (${one.reason})` : `"${one.name}"`))
  const more = notMoved.length > 3 ? ` and ${notMoved.length - 3} more` : ''
  const head = moved
    ? `Moved ${moved} of ${total} to ${libraryName(direction)} and updated ${uses(rewrote)}`
    : `Could not move ${files(total)} to ${libraryName(direction)}`
  return `${head} — ${notMoved.length} ${moved ? 'could not be moved' : 'are where they were'}: ${named.join(', ')}${more}, and ${notMoved.length === 1 ? 'is' : 'are'} still selected`
}
