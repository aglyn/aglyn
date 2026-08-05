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
import { act, renderHook } from '@testing-library/react'
import useBesignerDocument from './use-besigner-document'

/**
 * The AGL-1262 wedge, against the REAL canvas.
 *
 * `use-besigner-document.spec.tsx` replaces the canvas with a stub to drive
 * the save branches; this file deliberately does not, because the bug is the
 * interaction between the two: which snapshot becomes the canvas's saved
 * baseline, and what the editor then believes about it.
 *
 * The scenario is the one measured on production 2026-08-05. A screen was
 * edited (`sx.width` 440 → '100%'), Save was pressed, and the write was
 * never acknowledged. `persistentLocalCache` replays a queued write into the
 * first snapshot after a reload — so the editor loaded a document that
 * looked like the edit had landed, adopted it as "saved", went clean, and
 * disabled Save. The work was on the canvas, absent from the version
 * document, and there was no longer any way to write it: re-applying the
 * same value is not a mutation, and the recovered draft held the same
 * content the canvas already had.
 */
describe('useBesignerDocument: the saved baseline vs the store', () => {
  const ROOT = Aglyn.CANVAS_ROOT_ELEMENT_ID

  /** What the server actually holds. */
  const SERVER_NODES = {
    [ROOT]: { $id: ROOT, type: 'node', componentId: 'div', nodes: ['box'] },
    box: {
      $id: 'box',
      type: 'node',
      parentId: ROOT,
      componentId: 'muiStack',
      sx: { width: 440 },
      nodes: [],
    },
  } as never

  /** …and what a snapshot carrying our own unacknowledged write shows. */
  const PENDING_NODES = {
    [ROOT]: { $id: ROOT, type: 'node', componentId: 'div', nodes: ['box'] },
    box: {
      $id: 'box',
      type: 'node',
      parentId: ROOT,
      componentId: 'muiStack',
      sx: { width: '100%', maxWidth: '440px' },
      nodes: [],
    },
  } as never

  function open(overrides: Record<string, unknown> = {}) {
    const save = jest.fn().mockResolvedValue(undefined)
    const notify = jest.fn()
    const rendered = renderHook(() =>
      useBesignerDocument({
        nodes: PENDING_NODES,
        status: 'success',
        save,
        notify,
        noun: 'screen',
        ...overrides,
      } as never),
    )
    return { ...rendered, save, notify }
  }

  const canvasWidth = () =>
    (Aglyn.canvas.toJSON().nodes as Record<string, { sx?: { width?: unknown } }>)
      .box?.sx?.width

  beforeEach(() => {
    Aglyn.canvas.reset()
  })
  afterEach(() => {
    Aglyn.canvas.reset()
  })

  it('shows unacknowledged work rather than hiding it', () => {
    open({ pendingWrites: true })
    // Never the other way round: the author's work must be on the canvas
    // whatever its acknowledgement state.
    expect(canvasWidth()).toBe('100%')
  })

  it('does not call unacknowledged work "saved"', () => {
    const { result, rerender } = open({ pendingWrites: true })
    // The document lands in an effect, so read the flag on the following
    // render — which is what the `observer` page does when the canvas
    // changes under it.
    act(() => rerender())

    // The whole bug in one assertion. The canvas holds work the store does
    // not, so there is something to save — and the editor must say so, or
    // its Save control is dead and the work is gone.
    expect(result.current.saveAvailable).toBe(true)
  })

  it('writes that work when Save is pressed', async () => {
    const { result, save } = open({ pendingWrites: true })

    await act(async () => {
      await result.current.handleSave()
    })

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        box: expect.objectContaining({
          sx: { width: '100%', maxWidth: '440px' },
        }),
      }),
    )
  })

  it('goes clean once that save is the acknowledged state', async () => {
    const { result, rerender } = open({ pendingWrites: true })

    await act(async () => {
      await result.current.handleSave()
    })
    act(() => rerender())

    expect(result.current.saveAvailable).toBe(false)
  })

  it('leaves an acknowledged document clean, as before', () => {
    const { result, rerender } = open({ nodes: SERVER_NODES, pendingWrites: false })
    act(() => rerender())
    expect(result.current.saveAvailable).toBe(false)
    expect(canvasWidth()).toBe(440)
  })

  /**
   * The escape hatch, independent of the cause. Whatever put the editor out
   * of step with the document, an explicit Save must produce either a write
   * or an answer — never silence.
   */
  it('saves anyway when a clean editor disagrees with the stored document', async () => {
    const { result, save, notify, rerender } = open({
      nodes: SERVER_NODES,
      pendingWrites: false,
    })
    act(() => rerender())
    expect(result.current.saveAvailable).toBe(false)

    // Something the editor did not account for changes the canvas — here,
    // the co-editing mirror replaying a peer's unsaved node — and the
    // baseline is not moved with it.
    act(() => {
      Aglyn.canvas.setNodes(
        {
          box: {
            $id: 'box',
            type: 'node',
            parentId: ROOT,
            componentId: 'muiStack',
            sx: { width: '100%' },
            nodes: [],
          },
        } as never,
        true,
      )
      Aglyn.canvas.updateInitialNodes()
    })
    act(() => rerender())
    expect(result.current.saveAvailable).toBe(false)

    await act(async () => {
      await result.current.handleSave()
    })

    expect(save).toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalledWith('Already saved', expect.anything())
  })
})
