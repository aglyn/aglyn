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
  reset: jest.fn(),
  setNodes: jest.fn(),
  processNodesToDenormalized: jest.fn((value: unknown) => value),
  updateInitialNodes: jest.fn(() => {
    mockCanvas.didSetInitial = true
  }),
  applyNodes: jest.fn(),
  toJSON: jest.fn(() => ({ nodes: { root: {} } })),
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
      // A snapshot from somebody else's write arrives.
      act(() => {
        rerender({ updatedAt: stamp(2) } as never)
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
    it('reports notFound only once loading has succeeded with no nodes', () => {
      const { result: loading } = setup({ nodes: undefined, status: 'loading' })
      expect(loading.current.notFound).toBe(false)

      const { result: missing } = setup({ nodes: undefined, status: 'success' })
      expect(missing.current.notFound).toBe(true)
    })

    it('reports an error from either the flag or the status', () => {
      const { result: byError } = setup({ error: { message: 'boom' } })
      expect(byError.current.hasError).toBe(true)

      const { result: byStatus } = setup({ status: 'error' })
      expect(byStatus.current.hasError).toBe(true)
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
      act(() => {
        rerender({ updatedAt: stamp(2) } as never)
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
