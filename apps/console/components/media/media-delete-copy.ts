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
 * What the DAM says around a delete (AGL-1461).
 *
 * Sibling of `media-usage-copy`, which owns what the library may CLAIM about
 * where an asset is used. This module owns the plainer question of what it
 * says about the delete itself — before it, while the usage scan is still
 * running, and after the file has gone.
 *
 * ## Why the snackbar has to name things
 *
 * It read "File deleted", full stop. On 2026-08-13 a pass over 65 files
 * removed two that should have been kept, and nothing on screen ever said
 * which files had left: the confirmation named the file, the snackbar that
 * replaced it named nothing, and the grid it was covering had already
 * changed. They were recovered only because somebody remembered, inside the
 * retention window, roughly what they had clicked.
 *
 * ## What it now offers back, and what it still may not claim (AGL-1467)
 *
 * It used to offer nothing, and that was right at the time: the delete
 * hard-deleted the Firestore document, so the seven days of bytes the bucket
 * was holding had no address and any word like "undo" would have been true of
 * the bucket and false of the console. AGL-1467 built the tombstone that gives
 * them an address, so `UNDO_LABEL` is now backed by a real call to
 * `/api/media/restore` and the copy is allowed to say so.
 *
 * The rule that produced the old silence survives intact, and it is why
 * nothing here names a DURATION. The tombstone lives seven days; the snackbar
 * lives seconds. "Recoverable for 7 days" would describe the record rather
 * than the only control on screen — the same mistake one layer along. The
 * duration belongs to a durable recently-deleted surface, and that surface was
 * deliberately not built (see the route's header): it would be a second
 * browsable copy of customer content, which is precisely the object AGL-1443
 * is open on.
 */

/**
 * Names shown before the message elides. A snackbar is one line; past a
 * handful the count is the useful fact.
 */
export const MAX_NAMED = 3

const quote = (name: string) => `"${name}"`

/** `"a"`, `"a" and "b"`, `"a", "b" and "c"` — Oxford-free, snackbar-length. */
function joinNames(names: string[]): string {
  const quoted = names.map(quote)
  if (quoted.length <= 1) return quoted[0] ?? ''
  return `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`
}

/**
 * `Deleted "hero.png"` / `Deleted 12 files: "a.png", "b.png", "c.png" and 9
 * more`.
 *
 * The elision is counted rather than silent: "and 9 more" keeps the sentence
 * honest about how much of the answer it is showing, which is the same rule
 * the usage copy follows for a truncated scan.
 */
export function deletedMediaMessage(names: string[]): string {
  if (names.length === 0) return 'Nothing was deleted'
  if (names.length === 1) return `Deleted ${quote(names[0])}`
  const shown = names.slice(0, MAX_NAMED)
  const hidden = names.length - shown.length
  const list = hidden
    ? `${shown.map(quote).join(', ')} and ${hidden} more`
    : joinNames(shown)
  return `Deleted ${names.length} files: ${list}`
}

/**
 * What is left when a delete does not finish.
 *
 * The bulk path deletes one file per request, so a failure halfway through
 * leaves the earlier ones gone. Reporting only "an error has occurred" hides
 * both halves of that — which files went and which did not — and the second
 * half is the one an author has to act on.
 */
export function deleteFailureMessage(names: string[]): string {
  if (names.length === 0) return 'Delete failed'
  if (names.length === 1) {
    return `Could not delete ${quote(names[0])} — it is still in the library`
  }
  const shown = names.slice(0, MAX_NAMED)
  const hidden = names.length - shown.length
  const list = hidden
    ? `${shown.map(quote).join(', ')} and ${hidden} more`
    : joinNames(shown)
  return `Could not delete ${names.length} files: ${list} — they are still in the library`
}

/**
 * The snackbar's undo action (AGL-1467).
 *
 * One word, because a snackbar action is read in the half-second before the
 * grid redraws, and because it is the whole contract: the thing that just
 * happened can be taken back by pressing this.
 */
export const UNDO_LABEL = 'Undo'

/** `Restored "hero.png"` / `Restored 3 files: …`, mirroring the delete. */
export function restoredMediaMessage(names: string[]): string {
  if (names.length === 0) return 'Nothing was restored'
  if (names.length === 1) return `Restored ${quote(names[0])}`
  const shown = names.slice(0, MAX_NAMED)
  const hidden = names.length - shown.length
  const list = hidden
    ? `${shown.map(quote).join(', ')} and ${hidden} more`
    : joinNames(shown)
  return `Restored ${names.length} files: ${list}`
}

/**
 * What a refused undo says.
 *
 * The server knows things the client does not — the retention window has
 * closed, or putting the bytes back would breach the plan's storage limit —
 * and it answers with a sentence rather than a code. That sentence is passed
 * through verbatim, because "Undo failed" is the AGL-1461 defect wearing a
 * different verb: an outcome reported without the one fact you would act on.
 */
export function restoreFailureMessage(
  fileName: string,
  reason?: string,
): string {
  return reason?.trim()
    ? reason.trim()
    : `Could not restore ${quote(fileName)}`
}

/**
 * The first sentence of the delete confirmation.
 *
 * Shared by the grid card and the detail drawer (AGL-1461) so the two
 * surfaces cannot drift. It used to end "This cannot be undone from the
 * console", which was true until AGL-1467 and is not now — and a confirmation
 * that overstates the finality of an act is the mirror of one that
 * understates it: either way the author decides against a false model.
 *
 * "and only there" is the load-bearing half. Undo lives on the message that
 * follows and nowhere else, so an author who dismisses it has no second route,
 * and this is the sentence that has to say so before they click.
 */
export function deleteConfirmationLead(fileName: string): string {
  return (
    `${quote(fileName)} will be removed from storage, and elements using ` +
    'its URL will stop rendering it. You can undo this from the message ' +
    'that follows, and only there.'
  )
}

/**
 * Placeholder for the usage note while the scan is in flight.
 *
 * The dialog now opens before `/api/media/references` answers, so the space
 * the AGL-1413 warning occupies is briefly empty — and an empty space after a
 * check reads as "we looked and there is nothing to say", which is the exact
 * confusion that issue existed to remove. Leading space because it joins the
 * lead sentence, same as `deleteConfirmationNote`.
 */
export const SCAN_PENDING_NOTE = ' Checking where this file is used…'
