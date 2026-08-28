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
 * The rows on screen, when the fetch width and the page width differ (AGL-693).
 *
 * Most lists have one page size: the query asks for it and the footer names
 * it. A few cannot. The staff Users list walks Firebase Auth pools two
 * hundred accounts at a time because `listUsersAcrossPools` only appends
 * tenant-pool users once the project-level walk runs out of pages — a narrow
 * walk hides every enterprise SSO account behind several round trips, which
 * is the invisible-users bug AGL-1122 fixed.
 *
 * Two hundred is a fine transport width and a terrible page. Conflating them
 * put 200 in a size menu whose options are 10/25/50, so the control rendered
 * with no value selected and then had to be switched off entirely — a footer
 * drawing a control over state it did not own.
 *
 * This is the seam. The fetch keeps its width; the reader gets a page.
 *
 * ## Why it slices the WALK and not the last response
 *
 * So the count line is monotonic. Indexing within the current round trip
 * restarts the numbering at one every two hundred rows, and a reader who has
 * paged past a seam they were never shown has no way to read that as
 * anything but the list starting over.
 */
export interface DisplayWindow<T> {
  /** The rows to render — never more than `size`. */
  shown: T[]
  /** A further page exists in what has ALREADY been fetched. */
  hasMore: boolean
  /**
   * The next page is not fully buffered.
   *
   * Separate from `hasMore` because they answer different questions and the
   * caller acts on them differently: `hasMore` keeps Next live, this one says
   * a round trip has to happen before the page it leads to can be drawn.
   * A control that advanced without it would stop at whatever happened to be
   * loaded — the truncation bug in a different coat, and on a directory of
   * accounts it is the one that makes a person look deleted.
   */
  needsFetch: boolean
}

export function displayWindow<T>(
  rows: readonly T[],
  page: number,
  size: number,
): DisplayWindow<T> {
  // A non-positive size would slice nothing and report no more, which reads
  // as an empty collection rather than as a bad argument.
  const width = Math.max(Math.floor(size), 1)
  const first = Math.max(Math.floor(page), 0) * width
  return {
    shown: rows.slice(first, first + width),
    hasMore: first + width < rows.length,
    // Strictly greater: a page that ends exactly on the last buffered row is
    // complete, and asking for another round trip to draw it would spend a
    // read to change nothing.
    needsFetch: first + 2 * width > rows.length,
  }
}
