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
 * AGL-1460: what the DAM search box can express.
 *
 * The matcher is deliberately client-side and it is only ever run over a
 * COMPLETE set (see `use-media-pages`' `loadAll` and the wiring spec) — that
 * is the whole reason the capability is allowed to be this rich. Firestore
 * has no `LIKE`, no full-text and no way to range a map value, so wildcard,
 * fuzzy and custom-metadata search cannot be query-side at any price; the
 * only honest way to offer them is over every document, in memory.
 */

import {
  matchesMediaQuery,
  mediaSearchScopeMessage,
  parseMediaQuery,
  searchMedia,
} from './media-search'

const FOLDERS = { f1: 'Marketing', f2: 'Brand' }

const HERO = {
  $id: 'hero',
  fileName: 'mock-hero-noshadow.png',
  alt: 'Hero shot of the product',
  description: 'Landing page hero',
  tags: ['hero', 'marketing'],
  folderId: 'f1',
  customMetadata: { campaign: 'spring', photographer: 'Ada Lovelace' },
}
const CARD = {
  $id: 'card',
  fileName: 'mock-card-noshadow.png',
  alt: '',
  description: '',
  tags: ['marketing'],
  folderId: 'f1',
  customMetadata: {},
}
const SHADOWED = {
  $id: 'shadowed',
  fileName: 'mock-card-shadow.png',
  tags: ['marketing'],
  folderId: 'f1',
}
const LOGO = {
  $id: 'logo',
  fileName: 'logo.svg',
  alt: 'Aglyn logo',
  tags: ['brand'],
  folderId: 'f2',
  customMetadata: { campaign: 'evergreen' },
}
const ITEMS = [HERO, CARD, SHADOWED, LOGO]

const ids = (result: { items: any[] }) => result.items.map((item) => item.$id)
const find = (raw: string) =>
  searchMedia(ITEMS, parseMediaQuery(raw), { folderNameById: FOLDERS })

describe('an empty query is not a filter (AGL-1460)', () => {
  it('returns everything, in the order the grid already sorted it', () => {
    const result = find('   ')
    expect(result.mode).toBe('all')
    expect(ids(result)).toEqual(['hero', 'card', 'shadowed', 'logo'])
  })

  /**
   * `tag:` on its own is what a half-typed field filter looks like. Treating
   * it as "matches nothing" empties the grid under the cursor mid-keystroke.
   */
  it('ignores a field filter whose value has not been typed yet', () => {
    expect(parseMediaQuery('tag:').clauses).toEqual([])
    expect(find('tag:').mode).toBe('all')
  })
})

describe('a bare term searches the metadata, not just the name (AGL-1460 #5)', () => {
  it('matches the file name', () => {
    expect(ids(find('noshadow'))).toEqual(['hero', 'card'])
  })

  it('matches alt text', () => {
    expect(ids(find('product'))).toEqual(['hero'])
  })

  it('matches the description', () => {
    expect(ids(find('landing'))).toEqual(['hero'])
  })

  it('matches a tag', () => {
    expect(ids(find('brand'))).toEqual(['logo'])
  })

  it('matches the folder name', () => {
    expect(ids(find('marketing')).sort()).toEqual([
      'card',
      'hero',
      'shadowed',
    ])
  })

  /** `+ ADD FIELD` in the detail drawer writes here (AGL-1460 #6). */
  it('matches a custom metadata value', () => {
    expect(ids(find('lovelace'))).toEqual(['hero'])
  })

  it('ANDs two bare terms', () => {
    expect(ids(find('mock shadow'))).toEqual(['hero', 'card', 'shadowed'])
    expect(ids(find('mock lovelace'))).toEqual(['hero'])
  })

  it('takes a quoted phrase as one term', () => {
    expect(ids(find('"landing page"'))).toEqual(['hero'])
    expect(ids(find('landing page'))).toEqual(['hero'])
  })

  /**
   * The old matcher joined every field with spaces and ran `includes` over
   * the result, so a term could match across a field boundary — "png hero"
   * matched a file called `x.png` tagged `hero`. Terms match WITHIN a field.
   */
  it('does not let one term straddle two fields', () => {
    const query = parseMediaQuery('"noshadow.png hero"')
    const context = { folderNameById: FOLDERS }
    expect(matchesMediaQuery(HERO, query, context)).toBe(false)
    expect(matchesMediaQuery(CARD, query, context)).toBe(false)
    // Nothing reads it literally, so the search falls through to the fuzzy
    // pass — which is disclosed, rather than presented as a literal hit.
    expect(find('"noshadow.png hero"').mode).toBe('fuzzy')
  })
})

describe('wildcards (AGL-1460 #3)', () => {
  it('expresses a family of files', () => {
    expect(ids(find('mock-*-noshadow.png'))).toEqual(['hero', 'card'])
  })

  it('anchors, so a wildcard pattern is not a substring match', () => {
    expect(ids(find('mock-*'))).toEqual(['hero', 'card', 'shadowed'])
    expect(ids(find('*-shadow.png'))).toEqual(['shadowed'])
  })

  it('supports ? for a single character', () => {
    expect(ids(find('logo.sv?'))).toEqual(['logo'])
  })

  it('escapes the rest of the pattern rather than treating it as a regex', () => {
    expect(ids(find('mock-hero-noshadow.png*'))).toEqual(['hero'])
    // The `.` is a literal dot, not "any character" — so an `x` in its place
    // matches nothing. A regex-shaped `[` or `(` in a file name is likewise
    // a character rather than a syntax error.
    expect(ids(find('mock-hero-noshadowxpng*'))).toEqual([])
    expect(ids(find('mock-(hero)*'))).toEqual([])
  })

  it('combines with a field filter', () => {
    expect(ids(find('name:mock-*-noshadow.png tag:hero'))).toEqual(['hero'])
  })
})

describe('field filters (AGL-1460 #6)', () => {
  it('tag: restricts to tags', () => {
    expect(ids(find('tag:hero'))).toEqual(['hero'])
    // "marketing" is also a FOLDER name — the field filter says which.
    expect(ids(find('tag:marketing'))).toEqual(['hero', 'card', 'shadowed'])
    expect(ids(find('folder:marketing'))).toEqual(['hero', 'card', 'shadowed'])
  })

  it('name:, alt: and desc: restrict to their field', () => {
    expect(ids(find('alt:logo'))).toEqual(['logo'])
    expect(ids(find('name:logo'))).toEqual(['logo'])
    expect(ids(find('desc:landing'))).toEqual(['hero'])
    // `logo` appears in the alt text of `logo.svg` and nowhere else's name.
    expect(ids(find('alt:hero'))).toEqual(['hero'])
    expect(ids(find('desc:hero'))).toEqual(['hero'])
  })

  it('meta.<key>: addresses one custom field', () => {
    expect(ids(find('meta.campaign:spring'))).toEqual(['hero'])
    expect(ids(find('meta.campaign:evergreen'))).toEqual(['logo'])
    expect(ids(find('meta.photographer:ada'))).toEqual(['hero'])
    expect(ids(find('meta.campaign:ada'))).toEqual([])
  })

  it('meta: without a key searches every custom value', () => {
    expect(ids(find('meta:evergreen'))).toEqual(['logo'])
  })

  it('is case insensitive on both the field and the value', () => {
    expect(ids(find('TAG:Hero'))).toEqual(['hero'])
    expect(ids(find('Meta.Campaign:SPRING'))).toEqual(['hero'])
  })

  /** A colon in a file name or URL must not be read as a field filter. */
  it('leaves an unknown prefix as a literal term', () => {
    const clauses = parseMediaQuery('https://example.com').clauses
    expect(clauses).toHaveLength(1)
    expect(clauses[0].field).toBe('any')
    expect(clauses[0].value).toBe('https://example.com')
  })
})

describe('fuzzy matching, the way the icon picker does it (AGL-1460 #4)', () => {
  /**
   * `useMdiIconsFuzzy` ranks with Fuse over weighted keys. The DAM cannot
   * simply re-rank: the grid has a Sort control the author chose, and
   * reordering it on every keystroke would silently override that. So fuzzy
   * is a FALLBACK — it engages only when the literal reading of the query
   * found nothing, which is exactly the typo case, and the mode says so.
   */
  it('finds a typo that the literal reading misses', () => {
    const result = find('noshadwo')
    expect(result.mode).toBe('fuzzy')
    // Ranked, so the two files that were actually meant come first. A fuzzy
    // pass is looser than a literal one BY DESIGN — `mock-card-shadow.png`
    // is a near miss and appears below them — which is exactly why the mode
    // is surfaced in the caption rather than the results being passed off as
    // an exact answer.
    expect(ids(result).slice(0, 2).sort()).toEqual(['card', 'hero'])
    expect(ids(result)).not.toContain('logo')
  })

  it('does not engage while the literal reading still matches', () => {
    const result = find('noshadow')
    expect(result.mode).toBe('exact')
    expect(ids(result)).toEqual(['hero', 'card'])
  })

  /**
   * A wildcard is an exact statement about the shape of a name. Loosening it
   * would mean the pattern quietly matched things it does not describe.
   */
  it('never loosens a wildcard or a field filter', () => {
    expect(find('mock-*-nowhere.png').mode).toBe('exact')
    expect(ids(find('mock-*-nowhere.png'))).toEqual([])
    expect(ids(find('tag:heroo'))).toEqual([])
  })

  it('keeps a field filter as a hard gate under the fuzzy pass', () => {
    // `noshadwo` is fuzzy-reachable from both mock files, but only one of
    // them carries the tag.
    expect(ids(find('tag:hero noshadwo'))).toEqual(['hero'])
  })
})

describe('matchesMediaQuery is the single reading of a query', () => {
  it('answers per item so the grid and the drawer cannot drift', () => {
    const query = parseMediaQuery('tag:marketing mock-*')
    expect(matchesMediaQuery(HERO, query, { folderNameById: FOLDERS })).toBe(
      true,
    )
    expect(matchesMediaQuery(LOGO, query, { folderNameById: FOLDERS })).toBe(
      false,
    )
  })

  it('reads the legacy free-text folder string too', () => {
    const legacy = { $id: 'legacy', fileName: 'a.png', folder: 'Brand' }
    expect(matchesMediaQuery(legacy, parseMediaQuery('folder:brand'), {})).toBe(
      true,
    )
  })
})

/**
 * The helper text is the honesty of the feature. Before AGL-1460 it read
 * "Searches loaded files — Load more to widen" whenever another page existed,
 * which is true but is not an answer: it never said how much of the library
 * was actually being searched, and it never changed once the window was full.
 */
describe('the helper text says what was actually searched (AGL-1460)', () => {
  const base = {
    active: true,
    loaded: 60,
    total: 174,
    complete: false,
    completing: false,
    truncated: false,
    mode: 'exact' as const,
    matches: 3,
  }

  it('offers the syntax when nothing is typed', () => {
    const text = mediaSearchScopeMessage({ ...base, active: false })
    expect(text).toContain('tag:')
    expect(text).toContain('*')
  })

  it('names the partial window while the rest is still coming', () => {
    expect(mediaSearchScopeMessage(base)).toBe(
      'Searching 60 of 174 loaded files',
    )
  })

  it('says so while it completes the set', () => {
    const text = mediaSearchScopeMessage({ ...base, completing: true })
    expect(text).toContain('Loading the rest')
  })

  it('claims the whole library only once it holds it', () => {
    expect(
      mediaSearchScopeMessage({ ...base, complete: true, loaded: 174 }),
    ).toBe('Searched all 174 files')
  })

  /**
   * A folder or type facet is part of the query, so a complete window over
   * it is genuinely complete — but "Searched all 70 files" reads as a claim
   * about a 174-file library. The claim is scoped to what it covers.
   */
  it('scopes the claim when a filter narrowed the query', () => {
    expect(
      mediaSearchScopeMessage({ ...base, complete: true, loaded: 70 }),
    ).toBe('Searched all 70 files in this view')
  })

  /** The one state where the claim has to be smaller than the library. */
  it('admits the cap rather than implying a full search', () => {
    const text = mediaSearchScopeMessage({
      ...base,
      truncated: true,
      complete: false,
      loaded: 1200,
      total: 9000,
    })
    expect(text).toContain('first 1,200')
    expect(text).not.toContain('all')
  })

  it('says when the results are fuzzy rather than literal', () => {
    const text = mediaSearchScopeMessage({
      ...base,
      complete: true,
      loaded: 174,
      mode: 'fuzzy',
      matches: 2,
    })
    expect(text).toContain('No exact match')
    expect(text).toContain('2 close matches')
  })
})
