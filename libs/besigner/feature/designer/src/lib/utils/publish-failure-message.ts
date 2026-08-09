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
 * What to tell an author whose publish threw (AGL-1334).
 *
 * A failed publish used to surface the raw thrown message — for the bug this
 * fixes, a Firestore "called with invalid data, unsupported field value:
 * undefined, found in field nodes.(id).props.startIconPath" — in a toast that
 * auto-dismissed. That is the most dangerous possible
 * failure surface for this action: publishing is the ONLY step that moves work
 * onto live pages, the editor still reads `UP TO DATE` (the save really did
 * succeed), and an author who misses the toast walks away believing the
 * component shipped while every instance keeps rendering the old markup. It is
 * how AGL-1318's fix sat stranded for hours.
 *
 * So every message here leads with the fact that matters — the live pages did
 * NOT change — and names a next step. The underlying text is kept, last, for
 * a bug report; it is evidence, not an explanation.
 */
export function publishFailureMessage(error: unknown): string {
  const detail =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : ''
  const lead = 'Not published — live pages still show the previous version.'

  if (/permission|insufficient|unauthenticated/i.test(detail)) {
    return `${lead} You do not have permission to publish this component. Ask an owner or admin of this site to publish it.`
  }
  if (/invalid data|unsupported field value/i.test(detail)) {
    return `${lead} This component has an element the site cannot store. Reload the editor and publish again — if it happens twice, report it with this: ${detail}`
  }
  if (/offline|unavailable|network|deadline/i.test(detail)) {
    return `${lead} The site could not be reached. Check your connection and publish again.`
  }
  if (!detail) {
    return `${lead} Publishing failed for an unknown reason — reload the editor and try again.`
  }
  return `${lead} Publishing failed: ${detail}`
}

export default publishFailureMessage
