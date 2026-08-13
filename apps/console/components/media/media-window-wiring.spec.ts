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

import { code } from '../../specs/source-text'

/**
 * Comments removed, through the shared bounded stripper (AGL-1479).
 *
 * These handlers are heavily commented and several of the comments discuss
 * `refresh()` by name — including the ones explaining why it is no longer
 * called. Asserting over the code alone is the difference between "this
 * handler re-reads the collection" and "this handler mentions re-reading".
 *
 * The copy of the stripper this file carried was applied per-slice and read
 * `accept="image/*"` as a comment opener; stripping the whole file once and
 * slicing the RESULT is what lets the bound in `specs/source-text.ts` see it.
 */
const SOURCE = code(
  readFileSync(join(__dirname, 'media-library.component.tsx'), 'utf8'),
  'media-library.component.tsx',
)

/** The body of a `const <name> = useCallback(` block, to its closing paren. */
function handlerBody(name: string): string {
  const start = SOURCE.indexOf(`const ${name} = useCallback(`)
  expect(start).toBeGreaterThan(-1)
  const end = SOURCE.indexOf('\n  )', start)
  expect(end).toBeGreaterThan(start)
  return SOURCE.slice(start, end)
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

/**
 * What is left of the ⇧-click claims once the behavioural specs have taken
 * the halves they can execute (AGL-1482).
 *
 * The card's half — that a ⇧-click emits `range: true` and does NOT open the
 * details drawer over the selection being built — is proved by mounting the
 * real card in `media-asset-card-selection.spec.tsx`. The algorithm's half —
 * that the range is inclusive, id-anchored, and survives a delete from its
 * middle — is proved by executing it in `media-selection.spec.ts`.
 *
 * `CARD.toContain('shiftKey')` and `SOURCE.toContain('nextMediaSelection')`
 * lived here and were measured against both breaks: emitting `range: false`
 * from a ⇧-click, and computing the range exclusive of its far end. Neither
 * text assertion moved; six behavioural ones went red. They were checking that
 * the identifiers exist, which nothing was threatening.
 *
 * What no render can reach is the ARGUMENT the grid hands the matcher. The
 * range is measured against `orderedIds` — the filtered, sorted list actually
 * on screen — and not against the fetch order or an index into it, which is
 * the version that breaks after a delete from the middle of a range. That is a
 * property of the call site inside a component that mounts a Firestore
 * listener stack and a dnd-kit surface, so it stays here, and it is asserted
 * as the SHAPE of the call rather than as the presence of a name.
 */
describe('⇧-click measures against the order on screen (AGL-1462)', () => {
  it('feeds the matcher the ids the grid is currently drawing', () => {
    expect(SOURCE).toMatch(/nextMediaSelection\(prev, \{\s*orderedIds,/)
  })

  it('and that order is the visible list, not the fetch order', () => {
    expect(SOURCE).toMatch(
      /const orderedIds = useMemo\(\s*\(\) => visibleItems\.map\(/,
    )
  })

  /**
   * The other end of the id-anchored design: a delete drops the anchor rather
   * than leaving it pointing at whichever file slid into that position.
   */
  it('forgets the anchor when its file is deleted', () => {
    expect(SOURCE).toContain('forgetMediaSelection(prev, ids)')
  })
})
