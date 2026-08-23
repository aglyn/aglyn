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
 * AGL-2486: the matcher behaves the way a person expects, and the caption can
 * therefore say what it says.
 *
 * The headline case is the first test in this file and it is the whole reason
 * the mechanism changed: the previous implementation was a Firestore prefix
 * range, so somebody looking for "Main Layout" who typed `layout` got nothing
 * and concluded they did not have one.
 */

import {
  compareScored,
  foldForSearch,
  isSearchableQuery,
  MATCH_SCORE,
  MIN_QUERY_LENGTH,
  scoreMatch,
  searchWords,
} from './global-search-match'

const score = (name: string, query: string, extra?: string[]) =>
  scoreMatch({ name, extra }, query)

describe('what counts as a match', () => {
  /**
   * The defect, stated as a test. A prefix matcher scores this `null`.
   */
  it('finds a word inside the name, not only the start of it', () => {
    expect(score('Main Layout', 'layout')).toBe(MATCH_SCORE.wordPrefix)
    expect(score('Main Layout', 'lay')).toBe(MATCH_SCORE.wordPrefix)
  })

  it('still finds the start of the name, and ranks it higher', () => {
    expect(score('Main Layout', 'main')).toBe(MATCH_SCORE.namePrefix)
    expect(score('Main Layout', 'main')).toBeGreaterThan(
      score('Main Layout', 'layout') as number,
    )
  })

  it('ranks an exact name above a prefix of it', () => {
    expect(score('Blog', 'blog')).toBe(MATCH_SCORE.exact)
    expect(score('Blog archive', 'blog')).toBe(MATCH_SCORE.namePrefix)
    expect(score('Blog', 'blog')).toBeGreaterThan(
      score('Blog archive', 'blog') as number,
    )
  })

  it('matches mid-word, below every word-boundary match', () => {
    expect(score('Main Layout', 'ayou')).toBe(MATCH_SCORE.substring)
    expect(MATCH_SCORE.substring).toBeLessThan(MATCH_SCORE.wordPrefix)
  })

  it('requires EVERY word of a multi-word query to land', () => {
    expect(score('Main Layout', 'main lay')).toBe(MATCH_SCORE.namePrefix)
    expect(score('Main Layout', 'lay main')).toBe(MATCH_SCORE.allWords)
    // The reader typed two words and meant both.
    expect(score('Main Layout', 'layout home')).toBeNull()
  })

  it('does not match on nothing', () => {
    expect(score('Main Layout', 'zzz')).toBeNull()
    expect(score('', 'main')).toBeNull()
  })

  /**
   * `nameSearchKey`, the Firestore write-side key, deliberately PRESERVES
   * diacritics because a range query compares against exactly what was
   * stored. This matcher is client-side and has no such constraint, and on a
   * US keyboard `Cafe` → "Café" is the common direction.
   */
  it('folds diacritics, which the stored key deliberately does not', () => {
    expect(score('Café menu', 'cafe')).toBe(MATCH_SCORE.namePrefix)
    expect(foldForSearch('Café')).toBe('cafe')
  })

  it('splits on punctuation as well as spaces', () => {
    expect(searchWords('main-layout')).toEqual(['main', 'layout'])
    expect(score('main-layout', 'layout')).toBe(MATCH_SCORE.wordPrefix)
  })
})

describe('secondary fields', () => {
  it('are searchable, so a route or slug fragment finds the page', () => {
    expect(score('About us', 'pricing', ['/pricing'])).toBe(
      MATCH_SCORE.secondary,
    )
  })

  /**
   * The ordering claim that matters: a slug hit must never outrank a name
   * hit, or typing a word that appears in many slugs buries the row actually
   * named after it.
   */
  /**
   * Compared against the WEAKEST name-based score, not the strongest.
   * Comparing against an exact match proves almost nothing: `secondary`
   * could be raised to just below `exact` and still pass, which is exactly
   * what the mutation run showed. `allWords` is the floor a name hit can
   * score, so this is the real invariant.
   */
  it('never outrank even the weakest hit on the name', () => {
    const weakestNameHit = score('Main Layout', 'lay main') as number
    expect(weakestNameHit).toBe(MATCH_SCORE.allWords)
    const onSlug = score('About us', 'pricing', ['/pricing']) as number
    expect(onSlug).toBeLessThan(weakestNameHit)
    expect(MATCH_SCORE.secondary).toBeLessThan(MATCH_SCORE.allWords)
  })

  it('are ignored when absent, rather than matching everything', () => {
    expect(score('About us', 'pricing')).toBeNull()
    expect(score('About us', 'pricing', [])).toBeNull()
    expect(score('About us', 'pricing', [null as any, undefined])).toBeNull()
  })
})

describe('ordering', () => {
  it('puts the stronger score first', () => {
    const rows = [
      { score: MATCH_SCORE.wordPrefix, label: 'Main Layout' },
      { score: MATCH_SCORE.exact, label: 'Layout' },
    ]
    expect([...rows].sort(compareScored)[0].label).toBe('Layout')
  })

  /**
   * At equal score the shorter name is nearly always the thing meant —
   * "Blog" over "Blog post archive template" for `blog`.
   */
  it('breaks a tie on the shorter name, then alphabetically', () => {
    // The labels are chosen so length order and alphabetical order DISAGREE.
    // With `Blog`/`Blog archive` they agree, so dropping the length rule
    // leaves the order unchanged and the test proves nothing — which is what
    // the mutation run showed.
    const rows = [
      { score: MATCH_SCORE.namePrefix, label: 'Alpha blog archive' },
      { score: MATCH_SCORE.namePrefix, label: 'Zeta' },
    ]
    expect([...rows].sort(compareScored).map((row) => row.label)).toEqual([
      'Zeta',
      'Alpha blog archive',
    ])
  })

  it('falls back to alphabetical only when the lengths match', () => {
    const rows = [
      { score: MATCH_SCORE.namePrefix, label: 'Zeta' },
      { score: MATCH_SCORE.namePrefix, label: 'Beta' },
    ]
    expect([...rows].sort(compareScored).map((row) => row.label)).toEqual([
      'Beta',
      'Zeta',
    ])
  })

  /**
   * A palette whose row order changes between two identical queries teaches
   * the reader not to trust the first row, which is the row the whole feature
   * exists to put there.
   */
  it('is total, so two identical queries cannot disagree', () => {
    const rows = [
      { score: 10, label: 'same' },
      { score: 10, label: 'same' },
    ]
    expect(compareScored(rows[0], rows[1])).toBe(0)
  })
})

describe('the read-cost floor', () => {
  /**
   * The cheapest control in the whole feature: a one-character query matches
   * a large fraction of any collection, so it would spend a read in every
   * group to render a list nobody can use.
   */
  it('refuses to spend reads on a query shorter than the floor', () => {
    expect(MIN_QUERY_LENGTH).toBe(2)
    expect(isSearchableQuery('')).toBe(false)
    expect(isSearchableQuery(' ')).toBe(false)
    expect(isSearchableQuery('a')).toBe(false)
    expect(isSearchableQuery('ab')).toBe(true)
  })

  it('measures the folded query, so padding does not buy a read', () => {
    expect(isSearchableQuery('  a  ')).toBe(false)
  })
})
