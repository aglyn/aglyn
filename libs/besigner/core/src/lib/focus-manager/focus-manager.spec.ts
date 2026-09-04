/**
 * @jest-environment jsdom
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

import * as Aglyn from '@aglyn/aglyn'
import {
  clearSelection,
  getSelected,
  resolveSelectionAfterDeletion,
  selectFirstSurviving,
  setSelectedNode,
} from './focus-manager'

const node = (id: string, parentId: string, nodes: string[] = []) => ({
  $id: id,
  type: 'node' as const,
  parentId,
  componentId: 'div',
  props: {},
  sx: {},
  nodes,
})

/** root › [a, b, c], where `b` has [b1, b2]. */
function seed() {
  Aglyn.canvas.reset()
  Aglyn.canvas.setNodes({
    [Aglyn.NODE_ROOT_ID]: node(Aglyn.NODE_ROOT_ID, Aglyn.NODE_ROOT_ID, [
      'a',
      'b',
      'c',
    ]),
    a: node('a', Aglyn.NODE_ROOT_ID),
    b: node('b', Aglyn.NODE_ROOT_ID, ['b1', 'b2']),
    b1: node('b1', 'b'),
    b2: node('b2', 'b'),
    c: node('c', Aglyn.NODE_ROOT_ID),
  } as any)
  clearSelection()
}

const get = (id: string) => Aglyn.canvas.getNode(id)!
const ids = (nodes: Aglyn.NodeSchema<any>[]) => nodes.map((n) => n.$id)

describe('selection after deletion (AGL-2553)', () => {
  beforeEach(seed)
  afterAll(() => Aglyn.canvas.reset())

  it('prefers the NEXT sibling, which slides into the deleted slot', () => {
    expect(ids(resolveSelectionAfterDeletion([get('a')]))[0]).toBe('b')
  })

  it('falls back to the previous sibling when the last child goes', () => {
    expect(ids(resolveSelectionAfterDeletion([get('c')]))[0]).toBe('b')
  })

  it('falls back to the parent for an only child', () => {
    // Deleting b1 then b2 leaves `b` childless; the parent keeps the branch
    // open at the level the author was working in.
    Aglyn.canvas.deleteNode(get('b1'))
    expect(ids(resolveSelectionAfterDeletion([get('b2')]))).toEqual(['b'])
  })

  it('offers every sibling and then the parent, best first', () => {
    expect(ids(resolveSelectionAfterDeletion([get('b')]))).toEqual([
      'c',
      'a',
      Aglyn.NODE_ROOT_ID,
    ])
  })

  it('THE POINT: a delete leaves something selected', () => {
    setSelectedNode(get('a'))
    const candidates = resolveSelectionAfterDeletion([get('a')])
    Aglyn.canvas.deleteNode(get('a'))
    selectFirstSurviving(candidates)
    expect(ids(getSelected())).toEqual(['b'])
  })

  it('skips a candidate that the same delete removed', () => {
    // Multi-selecting b and c: `c` is the best candidate for `b`, but it is
    // doomed too. Resolving before and applying after is what catches that —
    // no ancestor walking, the map simply no longer has it.
    const doomed = [get('b'), get('c')]
    const candidates = resolveSelectionAfterDeletion(doomed)
    expect(ids(candidates)[0]).toBe('c')
    for (const target of doomed) Aglyn.canvas.deleteNode(target)
    selectFirstSurviving(candidates)
    expect(ids(getSelected())).toEqual(['a'])
  })

  it('skips a candidate that hung off a node the same delete removed', () => {
    // b1's only sibling is b2; deleting their PARENT takes both. The survivor
    // check reaches past them without knowing they were related.
    const candidates = resolveSelectionAfterDeletion([get('b1')])
    expect(ids(candidates)).toEqual(['b2', 'b'])
    Aglyn.canvas.deleteNode(get('b'))
    selectFirstSurviving(candidates)
    expect(getSelected()).toEqual([])
  })

  it('is safe on an empty set and on the root, which cannot be deleted', () => {
    expect(resolveSelectionAfterDeletion([])).toEqual([])
    // The root names itself as its own parent, so it resolves to a parent that
    // is also itself rather than walking off the tree.
    expect(ids(resolveSelectionAfterDeletion([get(Aglyn.NODE_ROOT_ID)]))).toEqual(
      [Aglyn.NODE_ROOT_ID],
    )
  })
})
