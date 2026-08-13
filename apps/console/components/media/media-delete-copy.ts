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
 * ## Why it does NOT offer them back
 *
 * The bucket keeps deleted objects for seven days, so an undo could in
 * principle be backed by something real. It is not backed by anything today:
 * `app/api/media/upload/route.ts` hard-deletes the Firestore document
 * (`mediaRef.delete()`) and decrements the counters, so the bytes surviving
 * in Cloud Storage are unreachable — nothing in the product knows the id, the
 * folder, the tags, the alt text or the scope tokens any more. Copy that says
 * "recoverable for 7 days" would therefore be true of the bucket and false of
 * the console, which is the worst of the three options. `media-delete-copy`
 * says what is true: it is gone from here. The spec holds that line by
 * asserting the offer is UNREACHABLE, not merely absent.
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
 * The first sentence of the delete confirmation.
 *
 * Shared by the grid card and the detail drawer (AGL-1461) so the two
 * surfaces cannot drift, and stated as permanent because from the console it
 * is: see the module header on why "recoverable" is not on offer here.
 */
export function deleteConfirmationLead(fileName: string): string {
  return (
    `${quote(fileName)} will be permanently removed from storage, and ` +
    'elements using its URL will stop rendering it. This cannot be undone ' +
    'from the console.'
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
