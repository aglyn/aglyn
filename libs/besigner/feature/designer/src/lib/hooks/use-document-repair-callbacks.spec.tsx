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
import { renderHook } from '@testing-library/react'

const mockConfirm = jest.fn(() => Promise.resolve())

jest.mock('@aglyn/shared-ui-jsx', () => ({
  useConfirmationContext: () => ({ confirm: mockConfirm }),
}))

import {
  useClearCanvasCallback,
  useRepairDocumentCallback,
} from './use-document-repair-callbacks'

const node = (id: string, parentId: string, nodes: string[] = []) => ({
  $id: id,
  type: 'node' as const,
  parentId,
  componentId: 'div',
  props: {},
  sx: {},
  nodes,
})

function seed(extra: Record<string, any> = {}, rootChildren = ['a']) {
  Aglyn.canvas.reset()
  Aglyn.canvas.setNodes({
    [Aglyn.NODE_ROOT_ID]: node(
      Aglyn.NODE_ROOT_ID,
      Aglyn.NODE_ROOT_ID,
      rootChildren,
    ),
    a: node('a', Aglyn.NODE_ROOT_ID),
    ...extra,
  } as any)
}

const ids = () => Object.keys(Aglyn.canvas.toJSON().nodes).sort()

describe('Repair page (AGL-2555)', () => {
  beforeEach(() => mockConfirm.mockClear())
  afterAll(() => Aglyn.canvas.reset())

  /**
   * An author who runs this on a hunch should get an answer, not an undo
   * entry — so a sound document is reported and nothing is written.
   */
  it('reports a sound document and changes nothing', async () => {
    seed()
    const before = ids()
    const { result } = renderHook(() => useRepairDocumentCallback('page'))
    await result.current()

    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Nothing to repair' }),
    )
    expect(ids()).toEqual(before)
    expect(Aglyn.canvas.canUndo).toBe(false)
  })

  it('drops the id that renders as an Invalid node row, keeping the parent', async () => {
    seed({ a: node('a', Aglyn.NODE_ROOT_ID, ['ghost']) })
    const { result } = renderHook(() => useRepairDocumentCallback('page'))
    await result.current()

    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Repair page' }),
    )
    expect(Aglyn.canvas.getNode('a')).toBeTruthy()
    expect(Aglyn.canvas.getNode('a')!.nodes).toEqual([])
  })

  /** Nothing is written until the author accepts the preview. */
  it('writes nothing when the preview is dismissed', async () => {
    seed({ a: node('a', Aglyn.NODE_ROOT_ID, ['ghost']) })
    mockConfirm.mockImplementationOnce(() => Promise.reject(new Error('nope')))
    const { result } = renderHook(() => useRepairDocumentCallback('page'))
    await result.current()

    expect(Aglyn.canvas.getNode('a')!.nodes).toEqual(['ghost'])
  })

  it('lands as one undoable step', async () => {
    seed({ a: node('a', Aglyn.NODE_ROOT_ID, ['ghost']) })
    const { result } = renderHook(() => useRepairDocumentCallback('page'))
    await result.current()

    expect(Aglyn.canvas.canUndo).toBe(true)
    Aglyn.canvas.undo()
    expect(Aglyn.canvas.getNode('a')!.nodes).toEqual(['ghost'])
  })
})

describe('Clear canvas (AGL-2554)', () => {
  beforeEach(() => mockConfirm.mockClear())
  afterAll(() => Aglyn.canvas.reset())

  it('empties the document and keeps the root', async () => {
    seed({ b: node('b', 'a') }, ['a'])
    const { result } = renderHook(() => useClearCanvasCallback('page'))
    await result.current()

    expect(ids()).toEqual([Aglyn.NODE_ROOT_ID])
    expect(Aglyn.canvas.rootNode!.nodes).toEqual([])
  })

  it('leaves the document alone when cancelled', async () => {
    seed()
    mockConfirm.mockImplementationOnce(() => Promise.reject(new Error('nope')))
    const { result } = renderHook(() => useClearCanvasCallback('page'))
    await result.current()

    expect(Aglyn.canvas.getNode('a')).toBeTruthy()
  })

  it('is undoable', async () => {
    seed()
    const { result } = renderHook(() => useClearCanvasCallback('page'))
    await result.current()

    expect(Aglyn.canvas.canUndo).toBe(true)
    Aglyn.canvas.undo()
    expect(Aglyn.canvas.getNode('a')).toBeTruthy()
  })

  /**
   * The case it exists for: a tree the hierarchy cannot render. Those rows
   * are not selectable, so Delete Element cannot reach them.
   */
  it('clears a document holding unrenderable nodes', async () => {
    Aglyn.canvas.reset()
    Aglyn.canvas.setNodes({
      [Aglyn.NODE_ROOT_ID]: node(Aglyn.NODE_ROOT_ID, Aglyn.NODE_ROOT_ID, [
        'ghost',
        'a',
      ]),
      a: node('a', Aglyn.NODE_ROOT_ID),
    } as any)
    const { result } = renderHook(() => useClearCanvasCallback('page'))
    await result.current()

    expect(ids()).toEqual([Aglyn.NODE_ROOT_ID])
  })
})
