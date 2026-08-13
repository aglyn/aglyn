/**
 * @jest-environment node
 */

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
 * AGL-1460, the question that had to be answered before anything was built:
 * does DAM search run client-side over the loaded window, or server-side?
 *
 * It is client-side, and this file is where that is pinned down. `fetchPage`
 * is the ONLY read of the media collection and `buildConstraints` is the only
 * place its constraints are assembled — so if the search text appears in
 * neither, the search text has never reached Firestore, and every answer the
 * box gave was an answer about the pages that happened to be loaded.
 *
 * That is not a detail of the six reported symptoms; it subsumes the first
 * one. "Changing the text does not update the results until you click Load
 * more" is what a window-scoped filter FEELS like when the matches live on
 * page two — the memo re-runs on every keystroke, it just has nothing to find
 * until Load more pages the matches in.
 *
 * The fix is therefore not a better filter. It is to make the set complete
 * before the filter runs, and to say so on screen when it is not.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SOURCE = readFileSync(
  join(__dirname, 'media-library.component.tsx'),
  'utf8',
)

/** A `const <name> = useCallback(` block, to its closing paren, decommented. */
function handlerBody(name: string): string {
  const start = SOURCE.indexOf(`const ${name} = useCallback(`)
  expect(start).toBeGreaterThan(-1)
  const end = SOURCE.indexOf('\n  )', start)
  expect(end).toBeGreaterThan(start)
  return SOURCE.slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('search is client-side, over the loaded window (AGL-1460)', () => {
  it('never reaches the query — no constraint is built from the text', () => {
    const body = handlerBody('buildConstraints')
    expect(body).toContain('where(')
    expect(body).not.toMatch(/\bsearch\b/)
  })

  it('never reaches the read either', () => {
    expect(handlerBody('fetchPage')).not.toMatch(/\bsearch\b/)
  })

  /**
   * The `nameLower` + `startAt`/`endAt` idiom from "Scalable switchers" is
   * the server-side answer for a PREFIX on one field, and it is deliberately
   * not used here — see the module header of `media-search.ts`. Asserting its
   * absence keeps this spec's first two claims meaningful: a future prefix
   * range added to the query would make "search never reaches Firestore"
   * false while both assertions above still passed.
   */
  it('and there is no prefix range standing in for one', () => {
    expect(SOURCE).not.toContain('nameLower')
    expect(SOURCE).not.toContain('startAt(')
  })
})

describe('the grid reads the query through the tested matcher (AGL-1460)', () => {
  it('parses and matches through media-search rather than an inline includes', () => {
    expect(SOURCE).toContain("from './media-search'")
    expect(SOURCE).toContain('parseMediaQuery(')
    expect(SOURCE).toContain('searchMedia(')
    // The old one-line reading of the whole query.
    expect(SOURCE).not.toContain('haystack.includes(term)')
  })

  it('feeds it the live text, so a keystroke is a re-search', () => {
    expect(SOURCE).toContain('parseMediaQuery(search)')
  })

  /** Folder names are searchable, so the matcher needs the map. */
  it('gives the matcher the folder names', () => {
    expect(SOURCE).toContain('folderNameById')
  })
})

describe('what a keystroke costs (AGL-1460)', () => {
  /**
   * Filtering is CPU and is deliberately NOT debounced — debouncing it would
   * reintroduce the exact complaint, a box whose text does not match the
   * grid. What is debounced is the one thing that costs Firestore reads:
   * completing the window.
   */
  it('debounces the completion read, not the filter', () => {
    expect(SOURCE).toContain('useDebounce(')
    expect(SOURCE).toContain('MEDIA_SEARCH_DEBOUNCE_MS')
    expect(SOURCE).toContain('debouncedSearch')
    // The filter takes the undebounced value.
    expect(SOURCE).not.toContain('parseMediaQuery(debouncedSearch)')
  })

  it('completes at most to the cap, and only with a query in the box', () => {
    expect(SOURCE).toContain('MEDIA_SEARCH_MAX_DOCS')
    expect(SOURCE).toContain('MEDIA_SEARCH_MIN_CHARS')
    expect(SOURCE).toContain('loadAll(MEDIA_SEARCH_MAX_DOCS)')
  })

  /** A completed window must not be re-completed on the next keystroke. */
  it('asks only while the query still has unread pages', () => {
    expect(SOURCE).toMatch(/hasMore[\s\S]{0,200}loadAll\(MEDIA_SEARCH_MAX_DOCS\)/)
  })
})

describe('the field tells the truth about its scope (AGL-1460)', () => {
  it('is the shared field, with the clear control and the honest caption', () => {
    expect(SOURCE).toContain('<MediaSearchField')
    expect(SOURCE).toContain('complete={')
    expect(SOURCE).toContain('truncated={')
  })

  /**
   * The caption it replaces. "Searches loaded files — Load more to widen"
   * was true and useless: it never said how much of the library that was,
   * and it disappeared entirely once `hasMore` went false — including when
   * `hasMore` went false because the FILTER had narrowed the query, not
   * because the library had been read.
   */
  it('no longer ships the old caption', () => {
    expect(SOURCE).not.toContain('Searches loaded files')
  })
})
