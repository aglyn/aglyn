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
import * as Besigner from '@aglyn/besigner'
import { renderHook } from '@testing-library/react'

const mockConfirm = jest.fn(() => Promise.resolve())

jest.mock('@aglyn/shared-ui-jsx', () => ({
  useConfirmationContext: () => ({ confirm: mockConfirm }),
}))

import {
  useDeleteElementCallback,
  useDeleteElementsCallback,
} from './use-delete-element-callback'

const node = (id: string, parentId: string, nodes: string[] = []) => ({
  $id: id,
  type: 'node' as const,
  parentId,
  componentId: 'div',
  props: {},
  sx: {},
  nodes,
})

/** root › [a, b, c]. */
function seed() {
  Aglyn.canvas.reset()
  Aglyn.canvas.setNodes({
    [Aglyn.NODE_ROOT_ID]: node(Aglyn.NODE_ROOT_ID, Aglyn.NODE_ROOT_ID, [
      'a',
      'b',
      'c',
    ]),
    a: node('a', Aglyn.NODE_ROOT_ID),
    b: node('b', Aglyn.NODE_ROOT_ID),
    c: node('c', Aglyn.NODE_ROOT_ID),
  } as any)
  Besigner.focus.clearSelection()
}

const get = (id: string) => Aglyn.canvas.getNode(id)!
const selectedIds = () => Besigner.focus.getSelected().map((n) => n.$id)

describe('deleting keeps a selection (AGL-2553)', () => {
  beforeEach(() => {
    mockConfirm.mockClear()
    seed()
  })
  afterAll(() => Aglyn.canvas.reset())

  it('single delete selects the next sibling instead of clearing', async () => {
    Besigner.focus.setSelectedNode(get('a'))
    const { result } = renderHook(() => useDeleteElementCallback())
    await result.current(get('a'))

    expect(Aglyn.canvas.getNode('a')).toBeUndefined()
    // The regression this guards: it used to be []. An empty selection is
    // what lets the hierarchy collapse.
    expect(selectedIds()).toEqual(['b'])
  })

  it('does nothing at all when the confirm is cancelled', async () => {
    mockConfirm.mockImplementationOnce(() => Promise.reject(new Error('nope')))
    Besigner.focus.setSelectedNode(get('a'))
    const { result } = renderHook(() => useDeleteElementCallback())
    await result.current(get('a'))

    expect(Aglyn.canvas.getNode('a')).toBeTruthy()
    expect(selectedIds()).toEqual(['a'])
  })

  it('bulk delete lands on a survivor, not on one of the deleted', async () => {
    const { result } = renderHook(() => useDeleteElementsCallback())
    await result.current([get('b'), get('c')])

    expect(Aglyn.canvas.getNode('b')).toBeUndefined()
    expect(Aglyn.canvas.getNode('c')).toBeUndefined()
    expect(selectedIds()).toEqual(['a'])
  })

  // An invariant rather than a proof of this change: it passed before too,
  // because an empty selection also names no deleted id. Kept because a
  // selection pointing at a node the map no longer has is the failure this
  // whole two-phase resolve exists to make impossible.
  it('clears rather than selecting a ghost when everything went', async () => {
    const { result } = renderHook(() => useDeleteElementsCallback())
    await result.current([get('a'), get('b'), get('c')])

    // Only the root is left, and it is its own parent — selecting it is
    // legitimate; what must never happen is a selection naming a deleted id.
    for (const id of selectedIds()) {
      expect(Aglyn.canvas.getNode(id)).toBeTruthy()
    }
  })
})
