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
import {
  besignerDraftKey,
  writeBesignerDraft,
} from '../drafts/besigner-draft-store'
import useBesignerDocument from './use-besigner-document'

/**
 * `canvas` is a mobx singleton whose `isInitialSame` is an own,
 * non-configurable computed — it cannot be spied on or shadowed. Replacing
 * the canvas with a plain stub is the only way to drive the dirty/clean and
 * save branches deterministically. Everything else from `@aglyn/aglyn`
 * (versionStamp, hasConcurrentWrite, measureNodeMap, ConcurrentEditError)
 * stays real, so the guards are tested against the actual implementations.
 */
const mockCanvas = {
  isInitialSame: true,
  didSetInitial: false,
  /**
   * Whether a co-editor has touched this canvas (AGL-2486). Modelled rather
   * than omitted: the draft prompt reads it to decide whether restoring is
   * still a private act, and an absent property would read as "nobody else
   * is here" for every case in this file.
   */
  hasRemoteEdits: false,
  reset: jest.fn(),
  setNodes: jest.fn(),
  processNodesToDenormalized: jest.fn((value: unknown) => value),
  // Both signatures mirror the real CanvasManager members, so the stub can be
  // driven with what the hook actually passes: `updateInitialNodes` takes the
  // confirmed-baseline options the AGL-1301/AGL-1262 cases read back off
  // `mock.calls`, and `toJSON` returns a node MAP — an empty one is the whole
  // point of the "never writes the empty canvas" case (AGL-1323).
  updateInitialNodes: jest.fn(
    (_nodes?: Record<string, unknown>, _options?: { confirmed?: boolean }) => {
      mockCanvas.didSetInitial = true
      mockCanvas.isInitialConfirmed = _options?.confirmed ?? true
    },
  ),
  /** Mirrors `CanvasManager._initialConfirmed`, which defaults to true. */
  isInitialConfirmed: true,
  /**
   * Stands in for the real `isEqual(_initial, serializeNodes())` check inside
   * `confirmInitialNodes`. The stub has no node map to compare, so the
   * "author edited while the write was in flight" case is expressed here —
   * modelled rather than assumed, because a double that always confirms
   * would report AGL-1262 as green whatever the hook did.
   */
  canvasMatchesInitial: true,
  confirmInitialNodes: jest.fn(() => {
    if (!mockCanvas.didSetInitial) return false
    if (mockCanvas.isInitialConfirmed) return true
    if (!mockCanvas.canvasMatchesInitial) return false
    mockCanvas.isInitialConfirmed = true
    return true
  }),
  applyNodes: jest.fn(),
  toJSON: jest.fn((): { nodes: Record<string, unknown> } => ({
    nodes: { root: {} },
  })),
}

jest.mock('@aglyn/aglyn', () => {
  const actual = jest.requireActual('@aglyn/aglyn')
  return new Proxy(actual, {
    get: (target, prop) =>
      prop === 'canvas' ? mockCanvas : Reflect.get(target, prop),
  })
})

/**
 * These cover the two behaviours that were copy-pasted into all four console
 * besigner routes and never had a test anywhere: refusing to overwrite a
 * concurrent editor (AGL-674) and refusing to save an oversized node map
 * (AGL-678). Both fail silently in production when broken — the first loses
 * someone's work, the second stops saving with a generic error — so they are
 * exactly the parts that must not regress during the extraction.
 */
describe('useBesignerDocument', () => {
  const NODES = { root: { $id: 'root', componentId: 'div' } } as never

  /** A Firestore-Timestamp-shaped value, which is what versionStamp reads. */
  const stamp = (millis: number) => ({ toMillis: () => millis })

  function setCanvasDirty(dirty: boolean) {
    mockCanvas.isInitialSame = !dirty
  }

  function setup(overrides: Record<string, unknown> = {}) {
    const notify = jest.fn()
    const save = jest.fn().mockResolvedValue(undefined)
    const dequeue = jest.fn()
    const queueLoading = jest.fn(() => dequeue)
    const rendered = renderHook((props: Record<string, unknown> = {}) =>
      useBesignerDocument({
        nodes: NODES,
        status: 'success',
        save,
        noun: 'screen',
        notify,
        queueLoading,
        ...overrides,
        ...props,
      } as never),
    )
    return { ...rendered, notify, save, dequeue, queueLoading }
  }

  beforeEach(() => {
    jest.restoreAllMocks()
    mockCanvas.isInitialSame = true
    mockCanvas.didSetInitial = false
    mockCanvas.isInitialConfirmed = true
    mockCanvas.canvasMatchesInitial = true
    mockCanvas.toJSON.mockReturnValue({ nodes: { root: {} } })
  })

  describe('save guards', () => {
    it('does not call save when nothing changed', async () => {
      setCanvasDirty(false)
      // "Nothing changed" means the canvas matches the stored document.
      mockCanvas.toJSON.mockReturnValue({ nodes: NODES })
      const { result, save, notify } = setup()

      await act(async () => {
        await result.current.handleSave()
      })

      expect(save).not.toHaveBeenCalled()
      expect(notify).toHaveBeenCalledWith(
        'Already saved',
        expect.objectContaining({ variant: 'info' }),
      )
    })

    /**
     * The data-loss shape of AGL-1262. The editor believed it was clean
     * while the canvas held work the document did not, so Save was a
     * no-op and the author had no way to write it — re-applying the same
     * value is not a mutation, and restoring the draft put back content
     * the canvas already had. A clean editor must therefore check the
     * document before agreeing there is nothing to write.
     */
    it('saves anyway when a clean editor disagrees with the stored document', async () => {
      setCanvasDirty(false)
      mockCanvas.toJSON.mockReturnValue({
        nodes: { root: { $id: 'root', componentId: 'div', sx: { width: '100%' } } },
      })
      const { result, save, notify } = setup()

      await act(async () => {
        await result.current.handleSave()
      })

      expect(save).toHaveBeenCalledWith(
        expect.objectContaining({
          root: expect.objectContaining({ sx: { width: '100%' } }),
        }),
        // The baseline rides along for the store-side precondition
        // (AGL-1301).
        expect.objectContaining({ baseNodes: expect.anything() }),
      )
      expect(notify).not.toHaveBeenCalledWith(
        'Already saved',
        expect.anything(),
      )
    })

    it('never writes the empty canvas over a document that has not loaded', async () => {
      setCanvasDirty(false)
      mockCanvas.toJSON.mockReturnValue({ nodes: {} })
      const { result, save, notify } = setup({
        nodes: undefined,
        status: 'loading',
      })

      await act(async () => {
        await result.current.handleSave()
      })

      expect(save).not.toHaveBeenCalled()
      expect(notify).toHaveBeenCalledWith(
        'Already saved',
        expect.objectContaining({ variant: 'info' }),
      )
    })

    it('refuses to save over a concurrent edit rather than merging', async () => {
      setCanvasDirty(true)

      const { result, save, notify, rerender } = setup({ updatedAt: stamp(1) })
      // A snapshot from somebody else's write arrives, carrying a node this
      // canvas has never seen. The CONTENT is what makes it a conflict, not
      // the stamp: a stamp that moves while the node map does not means
      // nobody changed the map, and a save into that cannot lose anything
      // (AGL-2486).
      act(() => {
        rerender({
          updatedAt: stamp(2),
          nodes: {
            root: { $id: 'root', componentId: 'div', nodes: ['theirs'] },
            theirs: {
              $id: 'theirs',
              componentId: 'muiTypography',
              parentId: 'root',
            },
          },
        } as never)
      })

      expect(result.current.remoteChanged).toBe(true)

      await act(async () => {
        await result.current.handleSave()
      })

      expect(save).not.toHaveBeenCalled()
      expect(notify).toHaveBeenCalledWith(
        new Aglyn.ConcurrentEditError().message,
        expect.objectContaining({ variant: 'warning' }),
      )
    })

    it('adopts the echo of our own write instead of flagging it', async () => {
      setCanvasDirty(true)
      // The canvas holds what the save will write, because that content is
      // now how the echo is RECOGNISED (AGL-2486) rather than it merely
      // being the next snapshot to arrive.
      mockCanvas.toJSON.mockReturnValue({ nodes: NODES })

      const { result, rerender } = setup({ updatedAt: stamp(1) })

      await act(async () => {
        await result.current.handleSave()
      })
      // The save's own snapshot lands.
      act(() => {
        rerender({ updatedAt: stamp(2) } as never)
      })

      expect(result.current.remoteChanged).toBe(false)
    })

    /**
     * Two tabs of ONE account, which is the case Zach lives in — he keeps
     * four open (AGL-2486).
     *
     * The console runs `persistentMultipleTabManager`, so tabs share a cache
     * and their snapshots coalesce: this session's save can be answered by a
     * single snapshot that already carries a LATER write from another
     * session. A guard that adopts "the next snapshot after my save" takes
     * that one, reports no conflict, and — the damaging half — advances the
     * baseline to their content, which then satisfies the AGL-1301
     * transaction as well. Their work is overwritten with no warning at
     * either layer.
     *
     * Nothing about that needs two different people. It needs two different
     * SESSIONS, which is what the guard now keys on.
     */
    it('flags another session’s write that lands in place of our echo', async () => {
      setCanvasDirty(true)
      const OURS = { root: { $id: 'root', componentId: 'div' } } as never
      const THEIRS = {
        root: { $id: 'root', componentId: 'div', sx: { p: 4 } },
      } as never
      mockCanvas.toJSON.mockReturnValue({ nodes: OURS })

      const { result, save, notify, rerender } = setup({ updatedAt: stamp(1) })

      await act(async () => {
        await result.current.handleSave()
      })
      expect(save).toHaveBeenCalledTimes(1)

      // One snapshot arrives, and it is NOT what we sent.
      act(() => {
        rerender({ updatedAt: stamp(2), nodes: THEIRS } as never)
      })

      expect(result.current.remoteChanged).toBe(true)

      // And the baseline did not walk forward onto their write, so the next
      // save is refused rather than silently overwriting them.
      await act(async () => {
        await result.current.handleSave()
      })
      expect(save).toHaveBeenCalledTimes(1)
      expect(notify).toHaveBeenCalledWith(
        new Aglyn.ConcurrentEditError().message,
        expect.objectContaining({ variant: 'warning' }),
      )
    })

    /**
     * The other half of the same rule: once another session's write has been
     * reported, a late echo of our own must not un-report it by advancing
     * the baseline behind the warning.
     */
    it('does not let a late echo walk the baseline past a reported conflict', async () => {
      setCanvasDirty(true)
      const OURS = { root: { $id: 'root', componentId: 'div' } } as never
      const THEIRS = {
        root: { $id: 'root', componentId: 'div', sx: { p: 4 } },
      } as never
      mockCanvas.toJSON.mockReturnValue({ nodes: OURS })

      const { result, save, rerender } = setup({ updatedAt: stamp(1) })

      await act(async () => {
        await result.current.handleSave()
      })
      act(() => {
        rerender({ updatedAt: stamp(2), nodes: THEIRS } as never)
      })
      expect(result.current.remoteChanged).toBe(true)

      // Another snapshot arrives — still carrying work this canvas does not
      // hold, so the refusal stands and the baseline has not moved onto it.
      act(() => {
        rerender({
          updatedAt: stamp(3),
          nodes: {
            ...(THEIRS as never as Record<string, unknown>),
            more: { $id: 'more', componentId: 'muiButton', parentId: 'root' },
          },
        } as never)
      })

      expect(result.current.remoteChanged).toBe(true)
      await act(async () => {
        await result.current.handleSave()
      })
      expect(save).toHaveBeenCalledTimes(1)
    })
  })

  /**
   * AGL-1301. The AGL-674 guard keyed on the `updatedAt` FIELD alone, so a
   * writer that updated `nodes` without touching it — admin scripts did
   * exactly this — was invisible and got clobbered by the next save. The
   * web SDK exposes no server-side updateTime on a snapshot, so the guard
   * now also keys on the content itself; and the save carries its baseline
   * so a Firestore provider can re-run the same check in a transaction,
   * closing the listener's delivery window.
   */
  describe('external writers and the save baseline (AGL-1301)', () => {
    const MOVED_NODES = {
      root: { $id: 'root', componentId: 'div', sx: { p: 2 } },
    } as never

    beforeEach(() => {
      jest.spyOn(Aglyn, 'measureNodeMap').mockReturnValue({
        bytes: 100,
        tooLarge: false,
        nearLimit: false,
        largest: [],
      } as never)
    })

    it('flags a write that changed nodes without touching the stamp', async () => {
      setCanvasDirty(true)
      const { result, save, notify, rerender } = setup({ updatedAt: stamp(1) })

      // A snapshot lands whose nodes moved but whose stamp did not.
      act(() => {
        rerender({ updatedAt: stamp(1), nodes: MOVED_NODES } as never)
      })

      expect(result.current.remoteChanged).toBe(true)

      await act(async () => {
        await result.current.handleSave()
      })

      expect(save).not.toHaveBeenCalled()
      expect(notify).toHaveBeenCalledWith(
        new Aglyn.ConcurrentEditError().message,
        expect.objectContaining({ variant: 'warning' }),
      )
    })

    it('hands save the baseline it last agreed with', async () => {
      setCanvasDirty(true)
      const { result, save } = setup({ updatedAt: stamp(1) })

      await act(async () => {
        await result.current.handleSave()
      })

      expect(save).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          baseStamp: Aglyn.versionStamp(stamp(1)),
          baseNodes: NODES,
        }),
      )
    })

    it('surfaces a store-side refusal through the conflict UX', async () => {
      setCanvasDirty(true)
      const save = jest
        .fn()
        .mockRejectedValue(new Aglyn.ConcurrentEditError())
      const { result, notify, dequeue } = setup({ save, updatedAt: stamp(1) })

      await act(async () => {
        await result.current.handleSave()
      })

      // Same refusal as the listener guard: warn, pause saving, keep the
      // work in the canvas. Never the generic error toast.
      expect(result.current.remoteChanged).toBe(true)
      expect(notify).toHaveBeenCalledWith(
        new Aglyn.ConcurrentEditError().message,
        expect.objectContaining({ variant: 'warning' }),
      )
      expect(dequeue).toHaveBeenCalled()
    })

    it('moves the content baseline with the echo of our own save', async () => {
      setCanvasDirty(true)
      // The canvas holds the content this save writes, so the echo carrying
      // it back is recognisable as ours (AGL-2486).
      mockCanvas.toJSON.mockReturnValue({ nodes: MOVED_NODES })
      const { result, rerender } = setup({ updatedAt: stamp(1) })

      await act(async () => {
        await result.current.handleSave()
      })
      // Our save's echo: new stamp AND new content — adopted, not flagged.
      act(() => {
        rerender({ updatedAt: stamp(2), nodes: MOVED_NODES } as never)
      })
      expect(result.current.remoteChanged).toBe(false)

      // A later stamp-less content change is measured against the ADOPTED
      // baseline, so it still reads as somebody else.
      act(() => {
        rerender({ updatedAt: stamp(2), nodes: NODES } as never)
      })
      expect(result.current.remoteChanged).toBe(true)
    })

    /**
     * `markOwnWrite` announces a write to OTHER fields of the same document
     * — component properties (AGL-1247). Its echo therefore moves the stamp
     * and leaves `nodes` where the baseline has them, and that is what is
     * expected: an announcement must not be a blanket amnesty for whatever
     * snapshot happens to arrive next (AGL-2486).
     */
    it('adopts a property write’s echo but not a colleague’s node write', () => {
      setCanvasDirty(true)
      const { result, rerender } = setup({ updatedAt: stamp(1) })

      act(() => result.current.markOwnWrite())
      act(() => {
        rerender({ updatedAt: stamp(2) } as never)
      })
      expect(result.current.remoteChanged).toBe(false)

      act(() => result.current.markOwnWrite())
      act(() => {
        rerender({ updatedAt: stamp(3), nodes: MOVED_NODES } as never)
      })
      expect(result.current.remoteChanged).toBe(true)
    })
  })

  /**
   * Two people building a page together must both be able to save
   * (AGL-2486).
   *
   * I made an edit in the top browser, saved it in the bottom
   * browser, then the alert appeared in the top browser for someone else
   * saved, the save button is still offered rather than up to date now. But
   * any user collaborating should be able to save as they all go along and
   * make changes.
   *
   * The guard used to ask "did the stored document move", which is the wrong
   * question once the co-edit mirror has already delivered their work to
   * this canvas: this session's write is then a superset of what they
   * stored, and refusing it protects nothing. It now asks whether this
   * document INCORPORATES what is stored — and these cases are written in
   * pairs so the relaxation cannot quietly become "always allow": every
   * permissive case has a stale or conflicting twin that must still refuse.
   */
  describe('saving in a converged room (AGL-2486)', () => {
    /** What the colleague saved, and what the mirror already replayed here. */
    const THEIRS = {
      root: { $id: 'root', componentId: 'div', nodes: ['a'] },
      a: { $id: 'a', componentId: 'muiTypography', parentId: 'root' },
    } as never
    /** THEIRS, plus work of our own the store has never seen. */
    const THEIRS_PLUS_OURS = {
      ...(THEIRS as never as Record<string, unknown>),
      b: { $id: 'b', componentId: 'muiButton', parentId: 'root' },
    } as never

    beforeEach(() => {
      jest.spyOn(Aglyn, 'measureNodeMap').mockReturnValue({
        bytes: 100,
        tooLarge: false,
        nearLimit: false,
        largest: [],
      } as never)
    })

    it('lets us save after a colleague saved work we already hold', async () => {
      setCanvasDirty(true)
      mockCanvas.toJSON.mockReturnValue({ nodes: THEIRS_PLUS_OURS })
      const { result, save, notify, rerender } = setup({ updatedAt: stamp(1) })

      // Their save lands. Everything in it is already on this canvas.
      act(() => {
        rerender({ updatedAt: stamp(2), nodes: THEIRS } as never)
      })

      expect(result.current.remoteChanged).toBe(false)

      await act(async () => {
        await result.current.handleSave()
      })

      expect(save).toHaveBeenCalledTimes(1)
      expect(notify).not.toHaveBeenCalledWith(
        new Aglyn.ConcurrentEditError().message,
        expect.anything(),
      )
      // The baseline handed to the store is THEIR write, so the transaction
      // still refuses anything that lands between here and the commit.
      expect(save).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ baseNodes: THEIRS }),
      )
    })

    it('still refuses a session that never received their work', async () => {
      setCanvasDirty(true)
      // The mirror never delivered node `a`: this tab has been offline, or
      // its entries were reaped. The canvas is the document as loaded.
      mockCanvas.toJSON.mockReturnValue({ nodes: NODES })
      const { result, save, notify, rerender } = setup({ updatedAt: stamp(1) })

      act(() => {
        rerender({ updatedAt: stamp(2), nodes: THEIRS } as never)
      })

      expect(result.current.remoteChanged).toBe(true)

      await act(async () => {
        await result.current.handleSave()
      })

      expect(save).not.toHaveBeenCalled()
      expect(notify).toHaveBeenCalledWith(
        new Aglyn.ConcurrentEditError().message,
        expect.objectContaining({ variant: 'warning' }),
      )
    })

    it('still refuses when we hold our own version of a node they saved', async () => {
      setCanvasDirty(true)
      // The same-element simultaneous edit — the one case co-editing cannot
      // merge. Relaxing it would be exactly the silent last-writer-wins the
      // guard exists to prevent.
      mockCanvas.toJSON.mockReturnValue({
        nodes: {
          root: { $id: 'root', componentId: 'div', nodes: ['a'] },
          a: {
            $id: 'a',
            componentId: 'muiTypography',
            parentId: 'root',
            props: { children: 'ours' },
          },
        },
      })
      const { result, save, rerender } = setup({ updatedAt: stamp(1) })

      act(() => {
        rerender({ updatedAt: stamp(2), nodes: THEIRS } as never)
      })

      expect(result.current.remoteChanged).toBe(true)
      await act(async () => {
        await result.current.handleSave()
      })
      expect(save).not.toHaveBeenCalled()
    })

    it('still refuses a node they DELETED that we never dropped', async () => {
      setCanvasDirty(true)
      const WITHOUT_A = {
        root: { $id: 'root', componentId: 'div', nodes: [] },
      } as never
      // We kept `a`, so our write would resurrect a node they removed.
      mockCanvas.toJSON.mockReturnValue({ nodes: THEIRS })
      const { result, save, rerender } = setup({
        updatedAt: stamp(1),
        nodes: THEIRS,
      })

      act(() => {
        rerender({ updatedAt: stamp(2), nodes: WITHOUT_A } as never)
      })

      expect(result.current.remoteChanged).toBe(true)
      await act(async () => {
        await result.current.handleSave()
      })
      expect(save).not.toHaveBeenCalled()
    })

    it('reads UP TO DATE once the canvas holds exactly what was stored', () => {
      setCanvasDirty(true)
      mockCanvas.toJSON.mockReturnValue({ nodes: THEIRS })
      const { rerender } = setup({ updatedAt: stamp(1) })
      mockCanvas.updateInitialNodes.mockClear()

      act(() => {
        rerender({ updatedAt: stamp(2), nodes: THEIRS } as never)
      })

      // No argument: the canvas as it stands IS the stored document, so it
      // becomes the saved baseline. The dirty flag was measuring a baseline
      // their save made stale, not work anybody still has to write.
      expect(mockCanvas.updateInitialNodes).toHaveBeenCalledWith()
    })

    it('does not call the document saved while we still hold unsaved work', () => {
      setCanvasDirty(true)
      mockCanvas.toJSON.mockReturnValue({ nodes: THEIRS_PLUS_OURS })
      const { rerender } = setup({ updatedAt: stamp(1) })
      mockCanvas.updateInitialNodes.mockClear()

      act(() => {
        rerender({ updatedAt: stamp(2), nodes: THEIRS } as never)
      })

      // Node `b` is ours and unstored — the editor must stay savable.
      expect(mockCanvas.updateInitialNodes).not.toHaveBeenCalled()
    })
  })

  describe('size guard', () => {
    it('refuses an oversized node map and names the largest element', async () => {
      setCanvasDirty(true)
      jest.spyOn(Aglyn, 'measureNodeMap').mockReturnValue({
        bytes: 1_200_000,
        tooLarge: true,
        nearLimit: false,
        largest: [{ id: 'hero', bytes: 900_000 }],
      } as never)

      const { result, save, notify, dequeue } = setup()

      await act(async () => {
        await result.current.handleSave()
      })

      expect(save).not.toHaveBeenCalled()
      const [message, options] = notify.mock.calls.at(-1) as [string, any]
      expect(message).toContain('too large to save')
      expect(message).toContain('largest element')
      expect(options.variant).toBe('error')
      // The loading indication must not be left running on the refusal path.
      expect(dequeue).toHaveBeenCalled()
    })

    it('warns near the limit but still saves', async () => {
      setCanvasDirty(true)
      jest.spyOn(Aglyn, 'measureNodeMap').mockReturnValue({
        bytes: 950_000,
        tooLarge: false,
        nearLimit: true,
        largest: [],
      } as never)

      const { result, save, notify } = setup()

      await act(async () => {
        await result.current.handleSave()
      })

      expect(save).toHaveBeenCalled()
      expect(
        notify.mock.calls.some(([message]) =>
          String(message).startsWith('Heads up:'),
        ),
      ).toBe(true)
    })

    it('uses the caller noun so copy stays accurate per document type', async () => {
      setCanvasDirty(true)
      jest.spyOn(Aglyn, 'measureNodeMap').mockReturnValue({
        bytes: 1_200_000,
        tooLarge: true,
        nearLimit: false,
        largest: [],
      } as never)

      const { result, notify } = setup({ noun: 'layout' })

      await act(async () => {
        await result.current.handleSave()
      })

      expect(notify.mock.calls.at(-1)?.[0]).toContain('This layout is')
    })
  })

  describe('save outcome', () => {
    beforeEach(() => {
      setCanvasDirty(true)
      jest.spyOn(Aglyn, 'measureNodeMap').mockReturnValue({
        bytes: 100,
        tooLarge: false,
        nearLimit: false,
        largest: [],
      } as never)
    })

    it('reports success and runs the saved callback', async () => {
      const onSaved = jest.fn()
      const { result, notify } = setup({ onSaved })

      await act(async () => {
        await result.current.handleSave()
      })

      expect(onSaved).toHaveBeenCalled()
      expect(notify).toHaveBeenCalledWith(
        'Screen saved successfully',
        expect.objectContaining({ variant: 'success' }),
      )
    })

    it('surfaces a rejected save without throwing', async () => {
      const save = jest.fn().mockRejectedValue(new Error('offline'))
      const { result, notify, dequeue } = setup({ save })

      await act(async () => {
        await result.current.handleSave()
      })

      expect(notify.mock.calls.at(-1)?.[1]).toEqual(
        expect.objectContaining({ variant: 'error' }),
      )
      expect(dequeue).toHaveBeenCalled()
    })

    it('always ends the loading indication', async () => {
      const { result, dequeue } = setup()

      await act(async () => {
        await result.current.handleSave()
      })

      expect(dequeue).toHaveBeenCalled()
    })
  })

  describe('json editor', () => {
    it('opens, applies nodes and closes', () => {
      const applyNodes = jest
        .spyOn(Aglyn.canvas, 'applyNodes')
        .mockImplementation(() => undefined as never)
      const { result } = setup()

      act(() => result.current.openJsonEditor())
      expect(result.current.jsonOpen).toBe(true)

      act(() => result.current.handleJsonSave(null, { root: {} }))
      expect(applyNodes).toHaveBeenCalledWith({ root: {} })
      expect(result.current.jsonOpen).toBe(false)
    })
  })

  /**
   * A Firestore snapshot is not proof of what Firestore holds:
   * `persistentLocalCache` replays a queued write into the first snapshot
   * after a reload, `updatedAt` (a server timestamp) still reads null, and
   * nothing in the payload says so. Recording that as the saved state is
   * what left a screen editable, dirty-looking on the canvas, and
   * permanently unsavable (AGL-1262).
   */
  describe('the saved baseline', () => {
    const confirmedOf = () =>
      mockCanvas.updateInitialNodes.mock.calls.at(-1)?.[1]

    it('is recorded as confirmed from an acknowledged snapshot', () => {
      setup({ pendingWrites: false })
      expect(mockCanvas.updateInitialNodes).toHaveBeenCalled()
      expect(confirmedOf()).toEqual(
        expect.objectContaining({ confirmed: true }),
      )
    })

    it('refuses to adopt a snapshot still carrying our own queued write', () => {
      setup({ pendingWrites: true })
      // Loaded — the work must be shown, never hidden…
      expect(mockCanvas.setNodes).toHaveBeenCalled()
      // …but nothing in it counts as saved.
      expect(confirmedOf()).toEqual(
        expect.objectContaining({ confirmed: false }),
      )
    })

    it('treats a store with no pending-write concept as acknowledged', () => {
      setup()
      expect(confirmedOf()).toEqual(
        expect.objectContaining({ confirmed: true }),
      )
    })
  })

  describe('document state', () => {
    it('reports notFound only once loading has settled with no nodes', () => {
      const { result: loading } = setup({ nodes: undefined, status: 'loading' })
      expect(loading.current.notFound).toBe(false)

      const { result: missing } = setup({ nodes: undefined, status: 'success' })
      expect(missing.current.notFound).toBe(true)

      /**
       * A refused read reaches `'error'` now (AGL-1066), and with nothing
       * cached behind it there is still no document to edit. Gating this on
       * `'success'` would have quietly stopped recognising the third state at
       * the moment it became reachable, leaving an editor open over nothing.
       */
      const { result: denied } = setup({ nodes: undefined, status: 'error' })
      expect(denied.current.notFound).toBe(true)
    })

    /**
     * The AGL-1066 constraint, at the hook that six editors read through.
     *
     * `hasError` is what each page swaps the canvas for "Not found" on, so it
     * must mean "could not read it AND have nothing to show" — not merely
     * "errored". Under `persistentLocalCache` a refused listen keeps serving
     * the document from IndexedDB, so an author mid-edit would otherwise
     * watch their canvas become "Not found" about two seconds into a stale
     * session.
     */
    it('reports hasError only when the failed read left nothing to show', () => {
      const { result: byError } = setup({
        nodes: undefined,
        error: { message: 'boom' },
      })
      expect(byError.current.hasError).toBe(true)

      const { result: byStatus } = setup({ nodes: undefined, status: 'error' })
      expect(byStatus.current.hasError).toBe(true)

      // The case the flip creates: errored, but the cache is still serving
      // the document. Keep rendering it, and say so through `staleContent`.
      const { result: cached } = setup({ status: 'error' })
      expect(cached.current.hasError).toBe(false)
      expect(cached.current.staleContent).toBe(true)
      expect(cached.current.notFound).toBe(false)

      // …and a healthy document is neither.
      const { result: healthy } = setup()
      expect(healthy.current.hasError).toBe(false)
      expect(healthy.current.staleContent).toBe(false)
    })
  })

  /**
   * The canvas root is guaranteed here rather than per editor (AGL-931).
   * Without it the hierarchy renders 'Invalid node' with Add Element
   * disabled, and the document can never be repaired from the UI. Only the
   * two definition-shaped editors passed a `toCanvasNodes` that repaired it,
   * so screens and layouts were one bad document away from the same dead end.
   */
  describe('canvas root guarantee', () => {
    const rootOf = () =>
      mockCanvas.setNodes.mock.calls.at(-1)?.[0]?.[Aglyn.CANVAS_ROOT_ELEMENT_ID]

    it('roots a rootless document with no toCanvasNodes of its own', () => {
      setup({ nodes: { hero: { $id: 'hero', componentId: 'box' } } })
      expect(rootOf()).toBeDefined()
      expect(rootOf().nodes).toEqual(['hero'])
    })

    it('roots an empty document', () => {
      setup({ nodes: {} as never, status: 'success' })
      expect(rootOf()).toBeDefined()
    })

    it('still roots when a toCanvasNodes returns something rootless', () => {
      setup({
        nodes: { hero: { $id: 'hero', componentId: 'box' } },
        toCanvasNodes: () => ({}) as never,
      })
      expect(rootOf()).toBeDefined()
    })

    it('leaves an already-rooted document alone', () => {
      const rooted = {
        [Aglyn.CANVAS_ROOT_ELEMENT_ID]: {
          $id: Aglyn.CANVAS_ROOT_ELEMENT_ID,
          componentId: 'div',
          nodes: ['hero'],
        },
        hero: {
          $id: 'hero',
          componentId: 'box',
          parentId: Aglyn.CANVAS_ROOT_ELEMENT_ID,
        },
      }
      setup({ nodes: rooted as never })
      expect(mockCanvas.setNodes).toHaveBeenLastCalledWith(rooted)
    })
  })

  /**
   * Local drafts (AGL-1256) are a crash net, and the line between a crash net
   * and a free stand-in for the paid `versioning` feature is exactly this: a
   * draft may only ever hold work that was never saved. The moment it can
   * outlive a save, it becomes "put this document back how it was" — which is
   * rollback, which is what the Pro entitlement sells.
   */
  describe('drafts vs the paid versioning feature', () => {
    const DRAFT = {
      scope: 'host-1',
      kind: 'screen',
      docId: 'screen-1',
      versionId: 'v1',
    } as const

    beforeEach(() => window.localStorage.clear())

    it('destroys the draft when a save succeeds', async () => {
      writeBesignerDraft(DRAFT, { nodes: NODES, baseStamp: null })
      expect(window.localStorage.getItem(besignerDraftKey(DRAFT))).not.toBeNull()

      setCanvasDirty(true)
      const { result, save } = setup({ draft: DRAFT })
      await act(async () => {
        await result.current.handleSave()
      })

      expect(save).toHaveBeenCalled()
      expect(window.localStorage.getItem(besignerDraftKey(DRAFT))).toBeNull()
    })

    // The other half of the rule: a *refused* save must leave the draft
    // standing, because the unsaved work it is protecting is exactly what
    // the refusal has stranded (AGL-674).
    it('leaves the draft alone when a concurrent edit refuses the save', async () => {
      writeBesignerDraft(DRAFT, { nodes: NODES, baseStamp: 'ms:1' })
      setCanvasDirty(true)

      const { result, save, rerender } = setup({
        draft: DRAFT,
        updatedAt: stamp(1),
      })
      // A real concurrent write: their node is stored and is not on this
      // canvas, which is what a refusal now requires (AGL-2486).
      act(() => {
        rerender({
          updatedAt: stamp(2),
          nodes: {
            root: { $id: 'root', componentId: 'div', nodes: ['theirs'] },
            theirs: {
              $id: 'theirs',
              componentId: 'muiTypography',
              parentId: 'root',
            },
          },
        } as never)
      })
      expect(result.current.remoteChanged).toBe(true)

      await act(async () => {
        await result.current.handleSave()
      })

      expect(save).not.toHaveBeenCalled()
      expect(
        window.localStorage.getItem(besignerDraftKey(DRAFT)),
      ).not.toBeNull()
    })

    // …and it says so, rather than offering a silent overwrite.
    it('flags a draft the document has moved past', () => {
      writeBesignerDraft(DRAFT, { nodes: NODES, baseStamp: 'ms:1' })
      mockCanvas.didSetInitial = true

      const { result } = setup({ draft: DRAFT, updatedAt: stamp(2) })

      expect(result.current.draft.available).toBe(true)
      expect(result.current.draft.staleAgainstDocument).toBe(true)
    })

    it('does not touch storage when no draft identity is given', async () => {
      setCanvasDirty(true)
      const { result } = setup()
      await act(async () => {
        await result.current.handleSave()
      })
      expect(Object.keys(window.localStorage)).toHaveLength(0)
    })

    it('reports no offer when there is no draft on disk', () => {
      const { result } = setup({ draft: DRAFT })
      expect(result.current.draft.available).toBe(false)
    })
  })
})
