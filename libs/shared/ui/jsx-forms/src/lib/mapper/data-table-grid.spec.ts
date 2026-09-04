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

import {
  alignmentsFromDivider,
  readDataTableAlignments,
  serializeDataTable,
  normalizeEmphasisColumn,
  parseDataTableRows,
  withCellSet,
  withColumnAdded,
  withColumnRemoved,
  withRowAdded,
  withRowRemoved,
} from '@aglyn/shared-data-enums'

/*
  The parser lives in `@aglyn/shared-data-enums`, which has only `build` and
  `lint` targets — no test runner. So it is specced from a consumer, exactly
  as `parseBreakpointSpan` is by `breakpoint-span.spec.tsx` next door. Left in
  the enums lib these cases would sit in the tree looking like coverage and
  never execute.
*/
describe('the table grid (AGL-2543)', () => {
  it('reads a markdown table pasted straight in', () => {
    // The whole reason the stored syntax is pipes: the comparison tables
    // already authored inside Markdown elements are the migration path, and
    // an author should be able to paste one rather than retype it.
    const pasted = [
      '| Feature | Aglyn | Webflow |',
      '| --- | :---: | ---: |',
      '| Self-hostable | Yes | No |',
      '| Open source | Yes | No |',
    ].join('\n')
    expect(parseDataTableRows(pasted)).toEqual([
      ['Feature', 'Aglyn', 'Webflow'],
      ['Self-hostable', 'Yes', 'No'],
      ['Open source', 'Yes', 'No'],
    ])
  })

  it('drops the divider row rather than rendering a row of dashes', () => {
    // It carries no content. Rendered, it is three cells of `---` that the
    // author then has to notice and delete.
    const rows = parseDataTableRows('a | b\n--- | ---\n1 | 2')
    expect(rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('reads the divider’s alignment intent separately', () => {
    expect(alignmentsFromDivider('| --- | :---: | ---: |')).toEqual([
      'left',
      'center',
      'right',
    ])
    // A content row must never be mistaken for a divider.
    expect(alignmentsFromDivider('| Yes | No |')).toBeNull()
    expect(alignmentsFromDivider('')).toBeNull()
  })

  it('pads a short row instead of leaving a ragged grid', () => {
    // A missing cell is an authoring accident, and a table that renders with
    // a hole is harder to fix than one with an empty cell — there is nothing
    // to click on to fill it.
    expect(parseDataTableRows('a | b | c\nd | e')).toEqual([
      ['a', 'b', 'c'],
      ['d', 'e', ''],
    ])
  })

  it('round-trips a cell containing a pipe', () => {
    // Escaping has to survive both directions, and the split must honour the
    // escape — splitting first would turn `a\|b` into two columns.
    const rows = [['a|b', 'plain']]
    const stored = serializeDataTable(rows)
    expect(stored).toContain('\\|')
    expect(parseDataTableRows(stored)).toEqual(rows)
  })

  it('treats an empty or non-string value as an empty grid', () => {
    for (const value of ['', '   ', null, undefined, 42, {}]) {
      expect(parseDataTableRows(value)).toEqual([])
    }
  })

  describe('alignment travels in the grid string (AGL-2543)', () => {
    it('reads a pasted table’s alignment instead of flattening it to left', () => {
      const pasted = 'a | b | c\n--- | :---: | ---:\n1 | 2 | 3'
      expect(readDataTableAlignments(pasted, 3)).toEqual([
        'left',
        'center',
        'right',
      ])
      // …and the grid itself is unaffected by the divider being there.
      expect(parseDataTableRows(pasted)).toEqual([
        ['a', 'b', 'c'],
        ['1', '2', '3'],
      ])
    })

    it('defaults every column when there is no divider', () => {
      expect(readDataTableAlignments('a | b', 2)).toEqual(['left', 'left'])
      expect(readDataTableAlignments('', 2)).toEqual(['left', 'left'])
    })

    it('writes no divider when every column is the default', () => {
      // An all-left table must not grow a row of dashes nobody asked for.
      const stored = serializeDataTable([['a', 'b']], ['left', 'left'])
      expect(stored).toBe('a | b')
      expect(stored).not.toContain('---')
    })

    it('round-trips grid and alignment together', () => {
      const rows = [
        ['Feature', 'Aglyn'],
        ['Open source', 'Yes'],
      ]
      const alignments = ['left', 'center'] as const
      const stored = serializeDataTable(rows, alignments)
      expect(parseDataTableRows(stored)).toEqual(rows)
      expect(readDataTableAlignments(stored, 2)).toEqual(['left', 'center'])
    })
  })

  describe('the emphasised column', () => {
    it('is 1-based, and out of range means none', () => {
      expect(normalizeEmphasisColumn(2, 3)).toBe(2)
      expect(normalizeEmphasisColumn(0, 3)).toBe(0)
      // The case that matters: deleting a column must not leave the table
      // pointing at one that is gone.
      expect(normalizeEmphasisColumn(4, 3)).toBe(0)
      expect(normalizeEmphasisColumn('nonsense', 3)).toBe(0)
      expect(normalizeEmphasisColumn(undefined, 3)).toBe(0)
    })
  })

  describe('editing operations', () => {
    const grid = () => [
      ['h1', 'h2'],
      ['a', 'b'],
    ]

    it('adds and removes rows and columns', () => {
      expect(withRowAdded(grid())).toHaveLength(3)
      expect(withRowAdded(grid())[2]).toEqual(['', ''])
      expect(withRowRemoved(grid(), 0)).toEqual([['a', 'b']])
      expect(withColumnAdded(grid())[0]).toEqual(['h1', 'h2', ''])
      expect(withColumnRemoved(grid(), 0)).toEqual([['h2'], ['b']])
    })

    it('REFUSES to remove the last row or column', () => {
      // A zero-row or zero-column grid cannot be typed back into through the
      // editor — there is no cell left to click — so the table would be
      // unrecoverable without the raw JSON editor.
      expect(withRowRemoved([['only']], 0)).toEqual([['only']])
      expect(withColumnRemoved([['only']], 0)).toEqual([['only']])
    })

    it('sets one cell without disturbing its neighbours', () => {
      expect(withCellSet(grid(), 1, 1, 'changed')).toEqual([
        ['h1', 'h2'],
        ['a', 'changed'],
      ])
    })
  })
})
