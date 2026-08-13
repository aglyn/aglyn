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
 * AGL-1462: which DAM mutations pay for the loaded window and which do not.
 *
 * `use-media-pages.spec.tsx` proves the state machine: `dropLocal` keeps the
 * window and costs no fetch, `refresh` throws it away and costs one. What that
 * cannot reach is which of the library's mutation handlers calls WHICH — a
 * property of the 3,400-line component's declaration, asserted here the same
 * way the AGL-1380/AGL-1413/AGL-1461 specs in this folder assert theirs.
 *
 * The mechanism that dropped the window was `refresh()` → `refreshKey` → the
 * load effect keyed on it → `setPages([page one])`. Twelve call sites shared
 * it, which is why this file is a list rather than a single assertion: a
 * future handler that reaches for `refresh()` where the client already knows
 * the answer is the regression, and it looks like a one-line convenience.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SOURCE = readFileSync(
  join(__dirname, 'media-library.component.tsx'),
  'utf8',
)
const CARD = readFileSync(
  join(__dirname, 'media-asset-card.component.tsx'),
  'utf8',
)

/**
 * The body of a `const <name> = useCallback(` block, to its closing paren,
 * with comments removed.
 *
 * These handlers are heavily commented and several of the comments discuss
 * `refresh()` by name — including the ones explaining why it is no longer
 * called. Asserting over the code alone is the difference between "this
 * handler re-reads the collection" and "this handler mentions re-reading".
 */
function handlerBody(name: string): string {
  const start = SOURCE.indexOf(`const ${name} = useCallback(`)
  expect(start).toBeGreaterThan(-1)
  const end = SOURCE.indexOf('\n  )', start)
  expect(end).toBeGreaterThan(start)
  return SOURCE.slice(start, end)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

describe('a delete edits the window instead of re-reading it (AGL-1462)', () => {
  it('the single-file delete drops the id locally', () => {
    const body = handlerBody('handleDelete')
    expect(body).toContain('dropLocal([media.$id')
    expect(body).not.toMatch(/\brefresh\(\)/)
  })

  it('the bulk delete drops every id it actually deleted', () => {
    const body = handlerBody('handleBulkDelete')
    expect(body).toContain('dropLocal(')
    expect(body).not.toMatch(/\brefresh\(\)/)
  })

  /**
   * The half that is easy to lose: the ids dropped have to be the ones the
   * server confirmed, not the whole selection. A bulk delete deletes one file
   * per request and reports both halves (AGL-1461) — dropping a file whose
   * request failed would hide a file that is still in the library.
   */
  it('the bulk delete drops only the confirmed ids, not the selection', () => {
    const body = handlerBody('handleBulkDelete')
    expect(body).toContain('deletedIds.push(mediaId)')
    expect(body).toContain('dropLocal(deletedIds)')
    expect(body).not.toContain('dropLocal([...selected])')
  })

  /** AGL-1461's return contract, which the drawer's delete depends on. */
  it('still answers whether the file went, for the drawer', () => {
    expect(handlerBody('handleDelete')).toContain('Promise<boolean>')
  })
})

describe('what still pays for a refetch, deliberately (AGL-1462)', () => {
  /**
   * Not every mutation can be answered locally, and pretending otherwise
   * would show a stale grid. An upload creates documents the client has no
   * ids or sort position for; a move and a folder delete change the
   * server-side `count()` aggregates the folder rail draws.
   */
  it('an upload still re-reads — the client cannot know the new page', () => {
    expect(handlerBody('handleFiles')).toMatch(/\brefresh\(\)/)
  })

  it('a move still re-reads — the folder counts are server aggregates', () => {
    expect(handlerBody('moveMedia')).toMatch(/\brefresh\(\)/)
  })
})

describe('⇧-click selects the range between two cards (AGL-1462)', () => {
  it('the card reports whether ⇧ was held', () => {
    expect(CARD).toContain('shiftKey')
    expect(CARD).toContain('onToggleSelect')
  })

  /**
   * The grid resolves the range through the tested module rather than
   * open-coding a slice — an index-anchored open-coding is the version that
   * breaks after a delete from the middle of a range.
   */
  it('the grid resolves it through nextMediaSelection', () => {
    expect(SOURCE).toContain('nextMediaSelection')
    expect(SOURCE).toContain('forgetMediaSelection')
  })

  it('measures the range against the order on screen', () => {
    expect(SOURCE).toContain('orderedIds')
    expect(SOURCE).toContain('visibleItems.map')
  })
})
