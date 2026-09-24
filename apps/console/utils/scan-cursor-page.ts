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
 * One page of a cursor feed whose query cannot express every predicate.
 *
 * An audit feed is ordered newest first and resumed from the last document a
 * page READ. Most of its filters go onto that query; a few cannot — a word
 * search over a field no index tokenizes, a site the document names only by
 * its path — and those are answered by reading the feed in batches and keeping
 * the rows that match, up to a page or a read budget, whichever comes first.
 *
 * The page it returns is short when the budget runs out first, and the cursor
 * is the last document READ rather than the last one kept: the next page
 * carries on from there, so a row that did not match is never re-read and a
 * row that did is never skipped. Nothing past the budget is hidden — it is on
 * the next page.
 *
 * Written against a `read` callback so the Admin SDK routes and the browser
 * SDK pages walk a feed the same way.
 */

export interface ScanCursorPageOptions<Doc, Row> {
  pageSize: number
  /** The most documents one page may read while it looks for matches. */
  scanCap: number
  /** Documents per read. `pageSize + 1` when every row matches. */
  batchSize: number
  /** The last document the previous page read; `null` for the first page. */
  after: Doc | null
  /** The next `count` documents after `after`, in the feed's order. */
  read: (after: Doc | null, count: number) => Promise<readonly Doc[]>
  /** The row a document shows as, or `null` when it does not match. */
  accept: (doc: Doc) => Row | null
}

export interface ScanCursorPage<Doc, Row> {
  rows: Row[]
  /** The last document read, which the next page resumes after. */
  last: Doc | null
  /** Whether the feed ran out: every document after `after` was read. */
  exhausted: boolean
  /** Documents read to fill the page, matching or not. */
  scanned: number
}

export async function scanCursorPage<Doc, Row>(
  options: ScanCursorPageOptions<Doc, Row>,
): Promise<ScanCursorPage<Doc, Row>> {
  const { pageSize, scanCap, batchSize, read, accept } = options
  const rows: Row[] = []
  let last = options.after
  let scanned = 0
  let exhausted = false
  while (rows.length < pageSize && scanned < scanCap) {
    const docs = await read(last, batchSize)
    let consumed = 0
    for (const doc of docs) {
      // Stop BEFORE a document the page has no room for: `last` is where the
      // next page resumes, so reading past a row that is not kept would drop
      // it from every page.
      if (rows.length >= pageSize || scanned >= scanCap) break
      consumed += 1
      scanned += 1
      last = doc
      const row = accept(doc)
      if (row !== null) rows.push(row)
    }
    // A short batch read to its end is the end of the feed. A short batch the
    // page stopped part-way through is not: its tail is the next page.
    if (docs.length < batchSize && consumed === docs.length) {
      exhausted = true
      break
    }
  }
  return { rows, last, exhausted, scanned }
}
