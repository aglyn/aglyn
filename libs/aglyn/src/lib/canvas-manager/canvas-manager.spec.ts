/**
 * @license
 * Copyright 2024 Aglyn LLC
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

import { NodeId, NodeSchema, NodeSchemaNested, NodeType } from '../types/nodes'
import { FEATURE_FLAG } from '../foundation'
import { compress } from '../app-utils/compress'
import { decompress } from '../app-utils/decompress'
import { canvasTreeToDefinition } from '../app-utils/definition-canvas-tree'
import { CanvasManager, NODE_ROOT_ID } from './canvas-manager'

describe('Aglyn: Screen Manager', () => {
  const nodes: Record<NodeId, NodeSchema> = {
    [NODE_ROOT_ID]: {
      $id: NODE_ROOT_ID,
      type: NodeType.NODE,
      parentId: NODE_ROOT_ID,
      componentId: 'div',
      props: {},
      sx: {},
      nodes: ['child1', 'child2'],
    },
    child1: {
      $id: 'child1',
      type: NodeType.NODE,
      parentId: NODE_ROOT_ID,
      componentId: 'div',
      props: {},
      sx: {},
      nodes: ['child1-1', 'child1-2'],
    },
    child2: {
      $id: 'child2',
      type: NodeType.NODE,
      parentId: NODE_ROOT_ID,
      componentId: 'div',
      props: {},
      sx: {},
      nodes: [],
    },
    'child1-1': {
      $id: 'child1-1',
      type: NodeType.NODE,
      parentId: 'child1',
      componentId: 'div',
      props: {},
      sx: {},
      nodes: [],
    },
    'child1-2': {
      $id: 'child1-2',
      type: NodeType.NODE,
      parentId: 'child1',
      componentId: 'div',
      props: {},
      sx: {},
      nodes: [],
    },
  }

  const denormalized: NodeSchemaNested[] = [
    {
      $id: NODE_ROOT_ID,
      type: NodeType.NODE,
      parentId: NODE_ROOT_ID,
      componentId: 'div',
      props: {},
      sx: {},
      nodes: [
        {
          $id: 'child1',
          type: NodeType.NODE,
          parentId: NODE_ROOT_ID,
          componentId: 'div',
          props: {},
          sx: {},
          nodes: [
            {
              $id: 'child1-1',
              type: NodeType.NODE,
              parentId: 'child1',
              componentId: 'div',
              props: {},
              sx: {},
              nodes: [],
            },
            {
              $id: 'child1-2',
              type: NodeType.NODE,
              parentId: 'child1',
              componentId: 'div',
              props: {},
              sx: {},
              nodes: [],
            },
          ],
        },
        {
          $id: 'child2',
          type: NodeType.NODE,
          parentId: NODE_ROOT_ID,
          componentId: 'div',
          props: {},
          sx: {},
          nodes: [],
        },
      ],
    },
  ]

  it('Denormalize Nodes', () => {
    const denormal = CanvasManager.nestDenormalizedNodes(nodes, NODE_ROOT_ID)
    expect(denormal).toEqual(denormalized[0])
  })

  it('Normalize Nodes', () => {
    const normal = CanvasManager.denormalizeNodes(denormalized, NODE_ROOT_ID)
    expect(normal).toEqual(nodes)
  })

  it('Normalize Nodes then Denormalize', () => {
    const normal = CanvasManager.denormalizeNodes(denormalized, NODE_ROOT_ID)
    const denormal = CanvasManager.nestDenormalizedNodes(normal, NODE_ROOT_ID)
    expect(denormal).toEqual(denormalized[0])
  })

  it('Denormalize Nodes then Normalize', () => {
    const denormal = CanvasManager.nestDenormalizedNodes(nodes, NODE_ROOT_ID)
    const normal = CanvasManager.denormalizeNodes([denormal], NODE_ROOT_ID)
    expect(normal).toEqual(nodes)
  })

  it('Denormalize Nodes then Normalize then Denormalize again', () => {
    const denormal = CanvasManager.nestDenormalizedNodes(nodes, NODE_ROOT_ID)
    const normal = CanvasManager.denormalizeNodes([denormal], NODE_ROOT_ID)
    const denormal2 = CanvasManager.nestDenormalizedNodes(normal, NODE_ROOT_ID)
    expect(denormal2).toEqual(denormalized[0])
  })

  it('Normalize Nodes then Denormalize then Normalize again', () => {
    const normal = CanvasManager.denormalizeNodes(denormalized, NODE_ROOT_ID)
    const denormal = CanvasManager.nestDenormalizedNodes(normal, NODE_ROOT_ID)
    const normal2 = CanvasManager.denormalizeNodes([denormal], NODE_ROOT_ID)
    expect(normal2).toEqual(nodes)
  })

  describe('setNodes id coercion', () => {
    it('trusts the map key for missing ids and pins the root to the canonical id', () => {
      const canvas = new CanvasManager(undefined as any)
      canvas.setNodes({
        [NODE_ROOT_ID]: { nodes: ['child'] },
        child: { parentId: NODE_ROOT_ID },
        stale: { $id: 'stale', parentId: NODE_ROOT_ID },
      } as any)
      expect(canvas.getNode(NODE_ROOT_ID)?.$id).toBe(NODE_ROOT_ID)
      expect(canvas.getNode('child')?.$id).toBe('child')
      expect(canvas.getNode('stale')?.$id).toBe('stale')
    })

    it('pins a root whose persisted id drifted from the key', () => {
      const canvas = new CanvasManager(undefined as any)
      canvas.setNodes({
        [NODE_ROOT_ID]: { $id: 'ke5jYbh8mw', nodes: [] },
      } as any)
      expect(canvas.getNode(NODE_ROOT_ID)?.$id).toBe(NODE_ROOT_ID)
    })
  })

  describe('initial-state tracking', () => {
    const makeCanvas = () => {
      const canvas = new CanvasManager(undefined as any)
      canvas.setNodes(nodes)
      return canvas
    }

    it('reports the state as current before any remote snapshot is recorded', () => {
      const canvas = new CanvasManager(undefined as any)
      expect(canvas.isInitialSame).toBe(true)
      canvas.setNodes(nodes)
      expect(canvas.isInitialSame).toBe(true)
      expect(canvas.didSetInitial).toBe(false)
    })

    it('detects divergence from the recorded snapshot and recovery on undo', () => {
      const canvas = makeCanvas()
      canvas.updateInitialNodes()
      expect(canvas.isInitialSame).toBe(true)

      const child = canvas.nodes.get('child1')
      canvas.updateNodeProps(child, { title: 'changed' })
      expect(canvas.isInitialSame).toBe(false)

      canvas.undo()
      expect(canvas.isInitialSame).toBe(true)
    })

    it('treats the state as current after recording the serialized form used for saving', () => {
      const canvas = makeCanvas()
      canvas.updateInitialNodes()
      const child = canvas.nodes.get('child2')
      canvas.updateNodeProps(child, { title: 'saved' })
      expect(canvas.isInitialSame).toBe(false)

      canvas.updateInitialNodes(canvas.toJSON().nodes)
      expect(canvas.isInitialSame).toBe(true)
    })

    /**
     * The baseline answers one question — "is there anything the store does
     * not have?" — and a baseline the store never confirmed cannot answer
     * it. AGL-1262: the besigner recorded a Firestore snapshot that still
     * carried the client's own queued write as the saved state, went clean,
     * and disabled Save. The work was on the canvas, absent from the
     * document, and there was no longer any way to write it.
     */
    describe('an unconfirmed baseline', () => {
      it('never reads as saved, however exactly the canvas matches it', () => {
        const canvas = makeCanvas()
        canvas.updateInitialNodes(undefined, { confirmed: false })

        // The canvas IS the recorded baseline — and still not saved.
        expect(canvas.didSetInitial).toBe(true)
        expect(canvas.isInitialConfirmed).toBe(false)
        expect(canvas.isInitialSame).toBe(false)
      })

      it('stays unsaved after an edit and its exact undo', () => {
        const canvas = makeCanvas()
        canvas.updateInitialNodes(undefined, { confirmed: false })

        const child = canvas.nodes.get('child1')
        canvas.updateNodeProps(child, { title: 'changed' })
        expect(canvas.isInitialSame).toBe(false)
        // Undo puts the canvas back exactly; a confirmed baseline would now
        // read as clean, and that is precisely the trap — re-applying a
        // value is not a mutation, so the author could never get back to
        // "dirty" by hand.
        canvas.undo()
        expect(canvas.isInitialSame).toBe(false)
      })

      it('is cleared by the save that finally confirms one', () => {
        const canvas = makeCanvas()
        canvas.updateInitialNodes(undefined, { confirmed: false })
        expect(canvas.isInitialSame).toBe(false)

        canvas.updateInitialNodes(canvas.toJSON().nodes)
        expect(canvas.isInitialConfirmed).toBe(true)
        expect(canvas.isInitialSame).toBe(true)
      })

      it('does not survive a reset onto the next document', () => {
        const canvas = makeCanvas()
        canvas.updateInitialNodes(undefined, { confirmed: false })
        canvas.reset()

        expect(canvas.isInitialConfirmed).toBe(true)
        expect(canvas.didSetInitial).toBe(false)
      })

      it('defaults to confirmed, so every existing caller is unaffected', () => {
        const canvas = makeCanvas()
        canvas.updateInitialNodes()
        expect(canvas.isInitialSame).toBe(true)
      })
    })
  })

  describe('nestedNodes raw json', () => {
    it('embeds full children through JSON.stringify instead of id refs', () => {
      const canvas = new CanvasManager(undefined as any)
      canvas.setNodes(nodes)

      const raw = JSON.parse(JSON.stringify(canvas.nestedNodes))

      expect(raw.$id).toBe(NODE_ROOT_ID)
      expect(raw.nodes).toHaveLength(2)
      expect(raw.nodes[0].$id).toBe('child1')
      expect(raw.nodes[1].$id).toBe('child2')
      expect(raw.nodes[0].nodes[0].$id).toBe('child1-1')
      expect(raw.nodes[0].nodes[1].$id).toBe('child1-2')
    })

    it('round-trips the nested raw json back into the flat node map', () => {
      const canvas = new CanvasManager(undefined as any)
      canvas.setNodes(nodes)

      const raw = JSON.parse(JSON.stringify(canvas.nestedNodes))
      const denormalized = canvas.processNodesToDenormalized(raw)

      expect(Object.keys(denormalized).sort()).toEqual(
        Object.keys(nodes).sort(),
      )
      expect(denormalized['child1'].nodes).toEqual(['child1-1', 'child1-2'])
    })
  })

  describe('addNodeFromPreset (AGL-537)', () => {
    const makeCanvas = () => {
      const canvas = new CanvasManager(undefined as any)
      canvas.setNodes(nodes)
      return canvas
    }

    const makePreset = (componentId: string, children: string[] = []) =>
      ({
        $id: `preset-${componentId}`,
        type: NodeType.PRESET,
        data: {
          $id: 'seed',
          type: NodeType.NODE,
          componentId,
          pluginId: 'test-plugin',
          props: {},
          sx: {},
          nodes: children.map((childComponentId, i) => ({
            $id: `seed-child-${i}`,
            type: NodeType.NODE,
            componentId: childComponentId,
            pluginId: 'test-plugin',
            props: {},
            sx: {},
            nodes: [] as NodeSchemaNested[],
          })),
        },
      }) as any

    /** Node ids present in the map but referenced by no parent's `nodes`. */
    const collectOrphans = (canvas: CanvasManager): NodeId[] => {
      const referenced = new Set<NodeId>([NODE_ROOT_ID])
      for (const node of canvas.nodes.values()) {
        for (const id of node.nodes ?? []) referenced.add(id)
      }
      return [...canvas.nodes.keys()].filter((id) => !referenced.has(id))
    }

    it('creates the node and appends it to the root in the same update', () => {
      const canvas = makeCanvas()
      const root = canvas.getNode(NODE_ROOT_ID)!

      const node = canvas.addNodeFromPreset(makePreset('appbar'), root)

      expect(node).toBeTruthy()
      expect(node.parentId).toBe(NODE_ROOT_ID)
      expect(canvas.getNode(NODE_ROOT_ID)!.nodes).toContain(node.$id)
      expect(collectOrphans(canvas)).toEqual([])
    })

    it('inserts into a selected container and registers preset children', () => {
      const canvas = makeCanvas()
      const container = canvas.getNode('child2')!

      const node = canvas.addNodeFromPreset(
        makePreset('appbar', ['toolbar']),
        container,
      )

      expect(node.parentId).toBe('child2')
      expect(canvas.getNode('child2')!.nodes).toContain(node.$id)
      // The preset's default child is grafted and attached too.
      expect(node.nodes).toHaveLength(1)
      expect(canvas.getNode(node.nodes![0])?.parentId).toBe(node.$id)
      // The root only ever gained its original children.
      expect(canvas.getNode(NODE_ROOT_ID)!.nodes).toEqual([
        'child1',
        'child2',
      ])
      expect(collectOrphans(canvas)).toEqual([])
    })

    it('resolves a stale parent reference to the live canvas node', () => {
      const canvas = makeCanvas()
      // A detached copy that only shares the id with the live node — e.g. a
      // node object retained across a canvas reload.
      const stale = { $id: 'child2' } as any

      const node = canvas.addNodeFromPreset(makePreset('appbar'), stale)

      expect(canvas.getNode('child2')!.nodes).toContain(node.$id)
      expect(stale.nodes).toBeUndefined()
      expect(collectOrphans(canvas)).toEqual([])
    })

    it('refuses a parent that is not a live canvas node instead of orphaning', () => {
      const canvas = makeCanvas()
      const before = canvas.nodes.size
      // The shape of the historical bug: a menu click event handed in as
      // the parent (truthy, but not a node).
      const clickEvent = { type: 'click', currentTarget: {} } as any

      expect(() =>
        canvas.addNodeFromPreset(makePreset('appbar'), clickEvent),
      ).toThrow('Invalid parent node')

      expect(canvas.nodes.size).toBe(before)
      expect('nodes' in clickEvent).toBe(false)
      expect(collectOrphans(canvas)).toEqual([])
    })

    describe('addNodeFromNested (AGL-1202)', () => {
      /** A detached subtree, as the clipboard stores one — no ids at all. */
      const clipping = (): NodeSchemaNested =>
        ({
          type: NodeType.NODE,
          componentId: 'stack',
          props: {},
          sx: {},
          nodes: [
            {
              type: NodeType.NODE,
              componentId: 'screenlink',
              props: { children: 'Besigner' },
              sx: {},
              nodes: [],
            },
          ],
        }) as any

      it('grafts a detached subtree under the target and mints fresh ids', () => {
        const canvas = makeCanvas()
        const container = canvas.getNode('child2')!

        const node = canvas.addNodeFromNested(clipping(), container)

        expect(node.parentId).toBe('child2')
        expect(canvas.getNode('child2')!.nodes).toContain(node.$id)
        expect(node.$id).toBeTruthy()
        expect(node.nodes).toHaveLength(1)
        const child = canvas.getNode(node.nodes![0])!
        expect(child.parentId).toBe(node.$id)
        expect(child.props).toEqual({ children: 'Besigner' })
        expect(collectOrphans(canvas)).toEqual([])
      })

      it('mints new ids rather than colliding with the live node it came from', () => {
        const canvas = makeCanvas()
        // The shape that matters for paste-into-the-same-document: the
        // subtree still carries the ids of nodes already on this canvas.
        const carriesLiveIds = {
          $id: 'child1',
          type: NodeType.NODE,
          componentId: 'div',
          props: {},
          sx: {},
          nodes: [
            {
              $id: 'child1-1',
              type: NodeType.NODE,
              componentId: 'div',
              props: {},
              sx: {},
              nodes: [],
            },
          ],
        } as any

        const node = canvas.addNodeFromNested(
          carriesLiveIds,
          canvas.getNode('child2')!,
        )

        expect(node.$id).not.toBe('child1')
        expect(node.nodes![0]).not.toBe('child1-1')
        // The originals are untouched and still hang off their own parent.
        expect(canvas.getNode('child1')!.nodes).toEqual([
          'child1-1',
          'child1-2',
        ])
        expect(canvas.getNode('child1-1')!.parentId).toBe('child1')
        expect(collectOrphans(canvas)).toEqual([])
      })

      it('honours an explicit index instead of appending', () => {
        const canvas = makeCanvas()
        const root = canvas.getNode(NODE_ROOT_ID)!

        const node = canvas.addNodeFromNested(clipping(), root, 1)

        expect(canvas.getNode(NODE_ROOT_ID)!.nodes).toEqual([
          'child1',
          node.$id,
          'child2',
        ])
      })

      it('refuses a parent that is not a live canvas node', () => {
        const canvas = makeCanvas()
        const before = canvas.nodes.size

        expect(() =>
          canvas.addNodeFromNested(clipping(), { $id: 'nope' } as any),
        ).toThrow('Invalid parent node')

        expect(canvas.nodes.size).toBe(before)
        expect(collectOrphans(canvas)).toEqual([])
      })
    })
  })

  // AGL-763: the AGL-759 MobX defect — `const x = (observable.field ||= []);
  // x.push(...)` mutates a detached copy — recurs textually at the
  // reparent/duplicate/preset call sites (`(parent.nodes ||= []).push(id)`).
  // These prove it does NOT bite here: `AglynNode`'s constructor always seeds
  // `this.nodes` to an array, so a live node never has `nodes` undefined and
  // `||=` short-circuits onto the real observable array rather than assigning
  // a fresh one. The guard is that a move/duplicate into a genuinely childless
  // container lands, and leaves no node in the map unreferenced by any parent.
  describe('mutating a childless parent lands the child (AGL-763)', () => {
    const makeCanvas = () => {
      const canvas = new CanvasManager(undefined as any)
      canvas.setNodes(nodes)
      return canvas
    }
    const orphans = (canvas: CanvasManager): NodeId[] => {
      const referenced = new Set<NodeId>([NODE_ROOT_ID])
      for (const node of canvas.nodes.values())
        for (const id of node.nodes ?? []) referenced.add(id)
      return [...canvas.nodes.keys()].filter((id) => !referenced.has(id))
    }

    it('reparentNode into an empty container', () => {
      const canvas = makeCanvas()
      // child2 starts with nodes: [] — the case that would expose the defect.
      expect(canvas.getNode('child2')!.nodes).toEqual([])

      canvas.reparentNode(canvas.getNode('child1-1')!, canvas.getNode('child2')!)

      expect(canvas.getNode('child2')!.nodes).toContain('child1-1')
      expect(canvas.getNode('child1-1')!.parentId).toBe('child2')
      expect(orphans(canvas)).toEqual([])
    })

    it('duplicateNode whose parent chain reaches a fresh node', () => {
      const canvas = makeCanvas()
      // Seed a brand-new empty container, then duplicate a node into it.
      const box = canvas.setNode(
        canvas.createNode({ componentId: 'div', parentId: NODE_ROOT_ID }),
        NODE_ROOT_ID,
      )!
      canvas.reparentNode(canvas.getNode('child1-1')!, box)

      const copy = canvas.duplicateNode(canvas.getNode('child1-1')!)

      expect(canvas.getNode(box.$id!)!.nodes).toContain(copy.$id)
      expect(orphans(canvas)).toEqual([])
    })

    it('a node built without a nodes field still gets an array', () => {
      const canvas = makeCanvas()
      // Exercises the constructor default (schema.nodes undefined). If the
      // seed came through with `nodes: undefined`, the `||=` sites would be
      // live — but the constructor forecloses that.
      const bare = canvas.setNode(
        canvas.createNode({
          $id: 'bare',
          componentId: 'div',
          parentId: NODE_ROOT_ID,
          nodes: undefined as never,
        }),
        NODE_ROOT_ID,
      )!
      expect(Array.isArray(bare.nodes)).toBe(true)

      canvas.reparentNode(canvas.getNode('child1-2')!, canvas.getNode('bare')!)

      expect(canvas.getNode('bare')!.nodes).toContain('child1-2')
      expect(orphans(canvas)).toEqual([])
    })
  })

  /**
   * AGL-1204: the Styles and custom-CSS panels assign `node.sx` directly,
   * bypassing every mutator that records history. Undo after a style change
   * therefore restored the last *recorded* snapshot — so the style edit
   * vanished AND everything else done since went with it.
   *
   * The fix cannot be an unconditional snapshot: those panels apply live, one
   * call per character typed and one per drag tick, so recording every call
   * trades "undo steps back too far" for "undo steps back one character".
   * Hence the coalescing, and hence the controls below — a `transact` that
   * never recorded would satisfy the burst test on its own.
   *
   * `Date.now` is stubbed rather than using fake timers because the window is
   * evaluated on call; there is no timer to advance.
   */
  describe('transact — style edits are undoable, and coalesced (AGL-1204)', () => {
    let now = 1_000_000

    beforeEach(() => {
      now = 1_000_000
      jest.spyOn(Date, 'now').mockImplementation(() => now)
    })
    afterEach(() => jest.restoreAllMocks())

    const styled = () => {
      const canvas = new CanvasManager(undefined as any)
      canvas.setNodes(nodes)
      return canvas
    }
    /** The panels' write, verbatim in shape: assign straight to the node. */
    const setGap = (canvas: CanvasManager, value: number, key?: string) =>
      canvas.transact(() => {
        canvas.getNode('child1')!.sx = { gap: value } as any
      }, key)

    it('REGRESSION — one undo steps back one adjustment, not to the last recorded edit', () => {
      const canvas = styled()
      // A props edit records itself; before the fix this was the only
      // snapshot on the stack, so the undo below landed here instead.
      canvas.updateNodeProps(canvas.getNode('child1')!, { title: 'kept' })

      setGap(canvas, 8, 'sx:child1:base:light:gap')
      now += 5_000
      setGap(canvas, 16, 'sx:child1:base:light:gap')

      canvas.undo()

      expect(canvas.getNode('child1')!.sx).toEqual({ gap: 8 })
      // The load-bearing half: the props edit made BEFORE the style changes
      // survives. Losing it is the part of this bug that destroys work.
      expect(canvas.getNode('child1')!.props).toEqual({ title: 'kept' })
    })

    it('collapses a burst of same-key calls into ONE undo step', () => {
      const canvas = styled()
      // Typing "16" into Gap: three change events inside the window.
      now += 40
      setGap(canvas, 1, 'sx:child1:base:light:gap')
      now += 40
      setGap(canvas, 16, 'sx:child1:base:light:gap')
      now += 40
      setGap(canvas, 160, 'sx:child1:base:light:gap')

      canvas.undo()

      // Back to before the adjustment began, in one step — not back one
      // keystroke, and not (as before the fix) not at all.
      expect(canvas.getNode('child1')!.sx).toEqual({})
      expect(canvas.canUndo).toBe(false)
    })

    it('CONTROL — a pause longer than the window starts a new step', () => {
      const canvas = styled()
      setGap(canvas, 8, 'sx:child1:base:light:gap')
      now += CanvasManager.COALESCE_WINDOW_MS + 1
      setGap(canvas, 16, 'sx:child1:base:light:gap')

      canvas.undo()
      expect(canvas.getNode('child1')!.sx).toEqual({ gap: 8 })
    })

    it('CONTROL — a different key inside the window is its own step', () => {
      const canvas = styled()
      setGap(canvas, 8, 'sx:child1:base:light:gap')
      now += 10
      // Moving from Gap to Padding is a second adjustment even mid-burst,
      // which is why the key carries the field names and not just the node.
      canvas.transact(() => {
        canvas.getNode('child1')!.sx = { gap: 8, padding: 2 } as any
      }, 'sx:child1:base:light:padding')

      canvas.undo()
      expect(canvas.getNode('child1')!.sx).toEqual({ gap: 8 })
    })

    it('CONTROL — no key records every call, however fast', () => {
      const canvas = styled()
      // Two visibility toggles flipped in the same tick: two decisions.
      canvas.transact(() => {
        canvas.getNode('child1')!.sx = { display: 'none' } as any
      })
      canvas.transact(() => {
        canvas.getNode('child1')!.sx = { display: 'block' } as any
      })

      canvas.undo()
      expect(canvas.getNode('child1')!.sx).toEqual({ display: 'none' })
    })

    it('closes an open burst on reset, so the next document records its first edit', () => {
      const canvas = styled()
      setGap(canvas, 8, 'sx:child1:base:light:gap')

      canvas.reset()
      canvas.setNodes(nodes)
      // Same key, same tick — but a different editing session. Swallowing
      // this into the previous document's burst would leave the new
      // document's first style edit unrecorded.
      setGap(canvas, 16, 'sx:child1:base:light:gap')

      expect(canvas.canUndo).toBe(true)
      canvas.undo()
      expect(canvas.getNode('child1')!.sx).toEqual({})
    })

    it('returns what the mutation returns', () => {
      const canvas = styled()
      expect(canvas.transact(() => 'value')).toBe('value')
    })

    /**
     * The second place a style edit can land (AGL-1306): on a reusable
     * component INSTANCE the Styles panel writes `node.styleOverrides`, not
     * `node.sx`. Undoability is not inherited from the sx case — the
     * snapshot is `toJS` of the node map, so a field the snapshot or the
     * restore dropped would leave exactly this path still eating work,
     * silently, for the most common way an instance gets styled.
     */
    describe('the instance override layer is undoable too (AGL-1306)', () => {
      const instanced = () => {
        const canvas = new CanvasManager(undefined as any)
        canvas.setNodes({
          ...nodes,
          inst: {
            $id: 'inst',
            type: NodeType.NODE,
            parentId: NODE_ROOT_ID,
            componentId: 'reusableInstance',
            props: { refId: 'cta' },
            nodes: [],
          },
        } as any)
        return canvas
      }
      /** The panel's write on an instance: through the override slice. */
      const setOverride = (
        canvas: CanvasManager,
        root: Record<string, any> | undefined,
        key?: string,
      ) =>
        canvas.transact(() => {
          canvas.getNode('inst')!.styleOverrides = root
            ? { root }
            : (undefined as any)
        }, key)

      it('REGRESSION — undo restores the previous override, not the last recorded edit', () => {
        const canvas = instanced()
        canvas.updateNodeProps(canvas.getNode('child1')!, { title: 'kept' })

        setOverride(canvas, { backgroundColor: '#0b4a6f' }, 'sx:inst:bg')
        now += 5_000
        setOverride(canvas, { backgroundColor: '#101828' }, 'sx:inst:bg')

        canvas.undo()

        expect(canvas.getNode('inst')!.styleOverrides).toEqual({
          root: { backgroundColor: '#0b4a6f' },
        })
        // Same load-bearing half as the sx case: unrelated work survives.
        expect(canvas.getNode('child1')!.props).toEqual({ title: 'kept' })
      })

      it('undo brings back an override cleared by its chip', () => {
        const canvas = instanced()
        setOverride(canvas, { backgroundColor: '#0b4a6f' }, 'sx:inst:bg')
        now += 5_000
        // Clearing the last property removes the field entirely — the most
        // destructive thing the override UI offers, and the one that most
        // needs a way back.
        setOverride(canvas, undefined)

        expect(canvas.getNode('inst')!.styleOverrides).toBeUndefined()
        canvas.undo()
        expect(canvas.getNode('inst')!.styleOverrides).toEqual({
          root: { backgroundColor: '#0b4a6f' },
        })
      })

      it('collapses an override burst into ONE undo step', () => {
        const canvas = instanced()
        now += 40
        setOverride(canvas, { py: 1 }, 'sx:inst:py')
        now += 40
        setOverride(canvas, { py: 12 }, 'sx:inst:py')

        canvas.undo()

        expect(canvas.getNode('inst')!.styleOverrides).toBeUndefined()
        expect(canvas.canUndo).toBe(false)
      })
    })

    /**
     * Co-editing (AGL-1301/AGL-677) applies a collaborator's change through
     * `setNodes`, which records no history — someone else's edit must never
     * become a step on THIS author's undo stack. Asserted here because
     * `transact` is the newest writer near that boundary.
     */
    describe('a remote application stays off the local undo stack', () => {
      // A collaborator's map, distinguishable from the local one by a props
      // value nothing local ever writes.
      const remote = {
        ...nodes,
        child1: { ...nodes['child1'], props: { title: 'from a co-editor' } },
      } as any

      it('setNodes records nothing', () => {
        const canvas = styled()
        canvas.setNodes(remote)
        expect(canvas.canUndo).toBe(false)
      })

      it('and it closes an open burst, so the next local edit records', () => {
        const canvas = styled()
        setGap(canvas, 8, 'sx:child1:base:light:gap')
        // The collaborator's change lands mid-burst.
        canvas.setNodes(remote)
        now += 10
        // Same key, same window — but the state this adjustment started
        // from is gone. Folding into that snapshot would make ONE undo of a
        // local style tweak revert the collaborator's edit as well.
        setGap(canvas, 16, 'sx:child1:base:light:gap')

        canvas.undo()
        expect(canvas.getNode('child1')!.sx).toEqual({})
        expect(canvas.getNode('child1')!.props).toEqual({
          title: 'from a co-editor',
        })
      })
    })
  })

  describe('applyNodes history', () => {
    it('makes a raw-json replacement undoable and redoable', () => {
      const canvas = new CanvasManager(undefined as any)
      canvas.setNodes(nodes)
      expect(canvas.canUndo).toBe(false)

      const edited = JSON.parse(JSON.stringify(canvas.nestedNodes))
      edited.nodes[0].props = { title: 'edited via raw json' }
      canvas.applyNodes(edited)

      expect(canvas.canUndo).toBe(true)
      expect(canvas.nodes.get('child1').props).toEqual({
        title: 'edited via raw json',
      })

      canvas.undo()
      expect(canvas.nodes.get('child1').props).toEqual({})
      expect(canvas.canRedo).toBe(true)

      canvas.redo()
      expect(canvas.nodes.get('child1').props).toEqual({
        title: 'edited via raw json',
      })
    })

    it('clears the redo stack when a new raw-json edit is applied', () => {
      const canvas = new CanvasManager(undefined as any)
      canvas.setNodes(nodes)

      const first = JSON.parse(JSON.stringify(canvas.nestedNodes))
      first.nodes[0].props = { title: 'first' }
      canvas.applyNodes(first)
      canvas.undo()
      expect(canvas.canRedo).toBe(true)

      const second = JSON.parse(JSON.stringify(canvas.nestedNodes))
      second.nodes[1].props = { title: 'second' }
      canvas.applyNodes(second)
      expect(canvas.canRedo).toBe(false)
      expect(canvas.canUndo).toBe(true)
    })
  })

  // Insert-target resolution (AGL-575): the Insert menu hands the current
  // selection in as the target. Containers accept the node as a child; a
  // leaf (no children slot) redirects to its container as the next sibling.
  describe('resolveInsertTarget / nodeAcceptsChildren (AGL-575)', () => {
    const CONTAINER = 'testContainer575'
    const LEAF_TEXT = 'testLeafText575'
    const LEAF_SELF = 'testLeafSelf575'
    const UNKNOWN = 'testUnregistered575'
    // A component that is neither self-closing nor a text leaf, but still has
    // no canvas child slot — Markdown, a Reusable Component instance, a
    // Layout Slot (AGL-1388).
    const NO_DROP = 'testNoDrop1388'
    const schemas: Record<string, any> = {
      div: {},
      [CONTAINER]: {},
      [LEAF_TEXT]: { flags: { textEditable: FEATURE_FLAG.ENABLED } },
      [LEAF_SELF]: { flags: { selfClosing: FEATURE_FLAG.ENABLED } },
      [NO_DROP]: { flags: { dropping: FEATURE_FLAG.DISABLED } },
    }
    const fakeAglyn = {
      components: { getSchema: (id: string) => schemas[id] },
    } as any

    const makeCanvas = () => {
      const canvas = new CanvasManager(fakeAglyn)
      canvas.setNodes({
        [NODE_ROOT_ID]: {
          $id: NODE_ROOT_ID,
          type: NodeType.NODE,
          parentId: NODE_ROOT_ID,
          componentId: 'div',
          props: {},
          sx: {},
          nodes: ['stack'],
        },
        stack: {
          $id: 'stack',
          type: NodeType.NODE,
          parentId: NODE_ROOT_ID,
          componentId: CONTAINER,
          props: {},
          sx: {},
          nodes: ['a', 'b', 'c', 'd'],
        },
        a: {
          $id: 'a',
          type: NodeType.NODE,
          parentId: 'stack',
          componentId: LEAF_TEXT,
          props: {},
          sx: {},
          nodes: [],
        },
        b: {
          $id: 'b',
          type: NodeType.NODE,
          parentId: 'stack',
          componentId: LEAF_SELF,
          props: {},
          sx: {},
          nodes: [],
        },
        c: {
          $id: 'c',
          type: NodeType.NODE,
          parentId: 'stack',
          componentId: UNKNOWN,
          props: {},
          sx: {},
          nodes: [],
        },
        d: {
          $id: 'd',
          type: NodeType.NODE,
          parentId: 'stack',
          componentId: NO_DROP,
          props: {},
          sx: {},
          nodes: [],
        },
      })
      return canvas
    }

    it('nodeAcceptsChildren: root and containers do, leaves do not', () => {
      const canvas = makeCanvas()
      expect(canvas.nodeAcceptsChildren(canvas.getNode(NODE_ROOT_ID)!)).toBe(
        true,
      )
      expect(canvas.nodeAcceptsChildren(canvas.getNode('stack')!)).toBe(true)
      expect(canvas.nodeAcceptsChildren(canvas.getNode('a')!)).toBe(false)
      expect(canvas.nodeAcceptsChildren(canvas.getNode('b')!)).toBe(false)
      // Unregistered components default to accepting children.
      expect(canvas.nodeAcceptsChildren(canvas.getNode('c')!)).toBe(true)
    })

    /**
     * `flags.dropping: DISABLED` (AGL-1388). It was declared on Markdown,
     * Reusable Component and Layout Slot, and NOTHING read it — so a
     * Markdown node advertised a children slot it does not have, and three
     * /press screenshots were dropped inside, saved, shipped in the page
     * payload and never drawn.
     */
    it('nodeAcceptsChildren: `dropping: DISABLED` has no children slot', () => {
      const canvas = makeCanvas()
      expect(canvas.nodeAcceptsChildren(canvas.getNode('d')!)).toBe(false)
    })

    it('resolveInsertTarget: a dropping-disabled target redirects to its container', () => {
      const canvas = makeCanvas()
      expect(canvas.resolveInsertTarget(canvas.getNode('d'))).toMatchObject({
        index: 4,
      })
      expect(canvas.resolveInsertTarget(canvas.getNode('d')).parent.$id).toBe(
        'stack',
      )
    })

    it('resolveInsertTarget: a container appends as a child (NaN index)', () => {
      const canvas = makeCanvas()
      const { parent, index } = canvas.resolveInsertTarget(
        canvas.getNode('stack'),
      )
      expect(parent.$id).toBe('stack')
      expect(Number.isNaN(index)).toBe(true)
    })

    it('resolveInsertTarget: a leaf redirects to its container as next sibling', () => {
      const canvas = makeCanvas()
      expect(canvas.resolveInsertTarget(canvas.getNode('a'))).toMatchObject({
        index: 1,
      })
      expect(canvas.resolveInsertTarget(canvas.getNode('a')).parent.$id).toBe(
        'stack',
      )
      // Self-closing leaf, second position → next sibling at index 2.
      expect(canvas.resolveInsertTarget(canvas.getNode('b')).index).toBe(2)
    })

    it('resolveInsertTarget: falls back to the root for a missing/non-node target', () => {
      const canvas = makeCanvas()
      const fallback = canvas.resolveInsertTarget(undefined)
      expect(fallback.parent.$id).toBe(NODE_ROOT_ID)
      expect(Number.isNaN(fallback.index)).toBe(true)

      const stale = canvas.resolveInsertTarget({ $id: 'ghost' } as any)
      expect(stale.parent.$id).toBe(NODE_ROOT_ID)
    })
  })

  describe('instance styleOverrides round-trip (AGL-1306)', () => {
    // The constructor assigns fields BY NAME, so an unlisted key dies on
    // the first setNodes — this is the save→reload survival proof for the
    // override layer: load (setNodes) → serialize (toJSON) → both storage
    // forms persist that serialization wholesale (the plain map as-is, the
    // version converter as msgpack of the same map).
    const instanceMap = {
      [NODE_ROOT_ID]: {
        $id: NODE_ROOT_ID,
        type: NodeType.NODE,
        componentId: 'div',
        nodes: ['inst'],
      },
      inst: {
        $id: 'inst',
        type: NodeType.NODE,
        parentId: NODE_ROOT_ID,
        componentId: 'reusableInstance',
        props: { refId: 'cta' },
        styleOverrides: {
          root: {
            backgroundColor: '#0b4a6f',
            '@scheme dark': { backgroundColor: '#101828' },
          },
        },
        nodes: [],
      },
    } as unknown as Record<NodeId, NodeSchema>

    it('survives setNodes → toJSON unchanged', () => {
      const canvas = new CanvasManager(undefined as any)
      canvas.setNodes(instanceMap as any)
      const serialized = canvas.toJSON().nodes as Record<string, any>
      expect(serialized['inst'].styleOverrides).toEqual(
        (instanceMap['inst'] as any).styleOverrides,
      )
      // And a second load of the serialization keeps it again — reload of
      // a saved document, not just the first save.
      const reloaded = new CanvasManager(undefined as any)
      reloaded.setNodes(serialized as any)
      expect(
        (reloaded.toJSON().nodes as Record<string, any>)['inst']
          .styleOverrides,
      ).toEqual((instanceMap['inst'] as any).styleOverrides)
    })

    it('survives the msgpack storage form (compress → decompress)', () => {
      const canvas = new CanvasManager(undefined as any)
      canvas.setNodes(instanceMap as any)
      const serialized = canvas.toJSON().nodes as Record<string, any>
      const decoded = decompress<Record<string, any>>(compress(serialized))
      expect(decoded['inst'].styleOverrides).toEqual(
        (instanceMap['inst'] as any).styleOverrides,
      )
    })

    it('omits the field when absent or empty, like sx', () => {
      const canvas = new CanvasManager(undefined as any)
      canvas.setNodes({
        plain: {
          $id: 'plain',
          type: NodeType.NODE,
          componentId: 'div',
          props: {},
          nodes: [],
        },
        empty: {
          $id: 'empty',
          type: NodeType.NODE,
          componentId: 'div',
          props: {},
          styleOverrides: {},
          nodes: [],
        },
      } as any)
      const serialized = canvas.toJSON().nodes as Record<string, any>
      expect('styleOverrides' in serialized['plain']).toBe(false)
      expect('styleOverrides' in serialized['empty']).toBe(false)
    })
  })

  /**
   * A cleared optional prop is an ABSENT key, in both write paths (AGL-1334).
   *
   * The Button repro: `Start icon = (NONE)`, so the props form writes an own
   * `startIconPath` key holding `undefined` on the next edit of that element.
   * A save survived it (msgpack encodes an undefined member as nil, so the
   * document quietly gained `startIconPath: null`); the very next publish, a
   * plain-map `updateDoc`, threw `Unsupported field value: undefined`.
   */
  describe('undefined props never reach a write path (AGL-1334)', () => {
    const buttonMap = {
      [NODE_ROOT_ID]: {
        $id: NODE_ROOT_ID,
        type: NodeType.NODE,
        componentId: 'div',
        nodes: ['btn'],
      },
      btn: {
        $id: 'btn',
        type: NodeType.NODE,
        parentId: NODE_ROOT_ID,
        componentId: 'button',
        props: { children: 'Get started' },
        nodes: [],
      },
    } as unknown as Record<NodeId, NodeSchema>

    const editedCanvas = () => {
      const canvas = new CanvasManager(undefined as any)
      canvas.setNodes(buttonMap as any)
      // Exactly what the props form submits: every field it renders, with
      // `undefined` for the ones the author left empty.
      canvas.updateNodeProps(canvas.getNode('btn')!, {
        children: 'Get started today',
        startIconId: undefined,
        startIconPath: undefined,
        href: '',
      })
      return canvas
    }

    const findUndefined = (value: unknown, path = ''): string[] => {
      if (value === undefined) return [path]
      if (Array.isArray(value)) {
        return value.flatMap((item, at) => findUndefined(item, `${path}[${at}]`))
      }
      if (value && typeof value === 'object') {
        return Object.entries(value).flatMap(([key, item]) =>
          findUndefined(item, path ? `${path}.${key}` : key),
        )
      }
      return []
    }

    it('drops the key instead of serializing undefined', () => {
      const props = (editedCanvas().toJSON().nodes as Record<string, any>)['btn']
        .props
      expect('startIconPath' in props).toBe(false)
      expect('startIconId' in props).toBe(false)
      // `''` is a value an author can mean, and it stores fine.
      expect(props).toEqual({ children: 'Get started today', href: '' })
    })

    it('leaves nothing undefined anywhere in the published map', () => {
      const canvas = editedCanvas()
      canvas.updateNodeProps(canvas.getNode('btn')!, {
        children: 'Get started today',
        propValues: { label: undefined, link: 'https://example.com' },
        sx: undefined,
      })
      const published = canvasTreeToDefinition(
        canvas.toJSON().nodes as Record<string, any>,
      )
      expect(findUndefined(published.nodes)).toEqual([])
      expect(
        'label' in (published.nodes['btn'] as any).props.propValues,
      ).toBe(false)
    })

    it('agrees with the save path on the shape for one in-memory tree', () => {
      const serialized = editedCanvas().toJSON().nodes as Record<string, any>
      // The publish write: the plain map, minus the synthetic canvas root.
      const published = canvasTreeToDefinition(serialized).nodes
      // The save write: the same serialization through the version-doc
      // converter's msgpack. It used to be here that `undefined` became
      // `null`, so the two documents disagreed about a cleared prop.
      const saved = decompress<Record<string, any>>(compress(serialized))
      expect(saved['btn'].props).toEqual(published['btn'].props)
      expect('startIconPath' in saved['btn'].props).toBe(false)
    })

    it('keeps a cleared prop cleared across a reload', () => {
      const canvas = new CanvasManager(undefined as any)
      canvas.setNodes({
        ...buttonMap,
        btn: {
          ...(buttonMap['btn'] as any),
          props: { children: 'Get started', startIconPath: 'M1 2h3' },
        },
      } as any)
      // Clearing the icon: the form resubmits without a path for it, and
      // `updateNodeProps` REPLACES the bag — so absent is how cleared travels.
      canvas.updateNodeProps(canvas.getNode('btn')!, {
        children: 'Get started',
        startIconPath: undefined,
      })
      const serialized = canvas.toJSON().nodes as Record<string, any>
      expect('startIconPath' in serialized['btn'].props).toBe(false)

      const reloaded = new CanvasManager(undefined as any)
      reloaded.setNodes(serialized as any)
      expect(
        'startIconPath' in
          (reloaded.toJSON().nodes as Record<string, any>)['btn'].props,
      ).toBe(false)
    })

    it('omits props entirely when every key was cleared', () => {
      const canvas = new CanvasManager(undefined as any)
      canvas.setNodes(buttonMap as any)
      canvas.updateNodeProps(canvas.getNode('btn')!, {
        children: undefined,
        startIconPath: undefined,
      })
      const node = (canvas.toJSON().nodes as Record<string, any>)['btn']
      expect('props' in node).toBe(false)
    })

    it('strips at the serialization boundary, not only in updateNodeProps', () => {
      // Live co-editing and the inline text editor assign onto `node.props`
      // directly, so the boundary has to hold on its own.
      const canvas = new CanvasManager(undefined as any)
      canvas.setNodes(buttonMap as any)
      const node = canvas.getNode('btn') as any
      node.props.startIconPath = undefined
      const props = (canvas.toJSON().nodes as Record<string, any>)['btn'].props
      expect('startIconPath' in props).toBe(false)
    })

    it('still reads as saved when the baseline was recorded from toJSON', () => {
      // The stripping happens on the serialization BOTH sides of the dirty
      // check use, so it cannot leave the editor permanently dirty.
      const canvas = editedCanvas()
      canvas.updateInitialNodes(canvas.toJSON().nodes as any)
      expect(canvas.isInitialSame).toBe(true)
    })
  })

  /**
   * AGL-1363 — a node that leaves its parent's child list without leaving
   * the node map is PERMANENT: `serializeNodes` dumps the whole map, the
   * renderer walks the tree from the root, and nothing reconciles the two.
   * It is saved on every save, shipped in every payload, and never drawn.
   *
   * `reparentNode` splices the node out of the LIVE old parent, then pushes
   * the id onto whatever object the caller handed it — so a `newParent` that
   * is not the live map entry detaches the node and keeps it. This is the
   * same defect `addNodeFromNested` was given a guard for in AGL-537; that
   * one resolves the target through `getNode($id)` and throws on a miss.
   */
  describe('reparentNode resolves both ends through the live map (AGL-1363)', () => {
    const makeCanvas = () => {
      const canvas = new CanvasManager(undefined as any)
      canvas.setNodes(nodes)
      return canvas
    }

    /**
     * Ids in the map that the renderer can never reach — the walk the
     * renderer actually does (`branch.tsx`), from the root down child lists.
     * Distinct from "referenced by nobody": a node hanging off an already
     * detached parent is referenced and still invisible.
     */
    const collectUnreachable = (canvas: CanvasManager): NodeId[] => {
      const seen = new Set<NodeId>()
      const walk = (id: NodeId) => {
        if (seen.has(id)) return
        seen.add(id)
        for (const childId of canvas.getNode(id)?.nodes ?? []) walk(childId)
      }
      walk(NODE_ROOT_ID)
      return [...canvas.nodes.keys()].filter((id) => !seen.has(id))
    }

    it('reparents onto the live parent when handed a stale instance of it', () => {
      const canvas = makeCanvas()
      // Every `setNodes` mints a FRESH `AglynNode` per id, so a co-editor's
      // merge silently replaces the instance a panel closure is holding.
      // The stale object keeps the right id and a now-detached `nodes` array.
      const staleRoot = canvas.getNode(NODE_ROOT_ID)!
      canvas.setNodes({ [NODE_ROOT_ID]: staleRoot.toJSON!() } as any, true)
      expect(canvas.getNode(NODE_ROOT_ID)).not.toBe(staleRoot)

      const moved = canvas.reparentNode(canvas.getNode('child1-1')!, staleRoot)

      expect(canvas.getNode(NODE_ROOT_ID)!.nodes).toContain('child1-1')
      expect(moved.parentId).toBe(NODE_ROOT_ID)
      expect(canvas.getNode('child1')!.nodes).toEqual(['child1-2'])
      expect(collectUnreachable(canvas)).toEqual([])
    })

    it('refuses a parent that is not in the map instead of detaching the node', () => {
      const canvas = makeCanvas()
      const before = canvas.toJSON().nodes
      // A parent a co-editor deleted out from under this session — truthy,
      // shaped like a node, absent from the map.
      const ghost = { $id: 'gone', nodes: [] } as any

      expect(() =>
        canvas.reparentNode(canvas.getNode('child1')!, ghost),
      ).toThrow('Invalid parent node')

      expect(ghost.nodes).toEqual([])
      expect(collectUnreachable(canvas)).toEqual([])
      // Refused outright: the tree is byte-identical and nothing was
      // pushed onto the undo stack for a move that never happened.
      expect(canvas.toJSON().nodes).toEqual(before)
      expect(canvas.canUndo).toBe(false)
    })

    it('refuses a node that is not in the map', () => {
      const canvas = makeCanvas()
      const before = canvas.toJSON().nodes

      expect(() =>
        canvas.reparentNode(
          { $id: 'gone', parentId: 'child1' } as any,
          canvas.getNode('child2')!,
        ),
      ).toThrow('Invalid node')

      expect(canvas.toJSON().nodes).toEqual(before)
      expect(canvas.canUndo).toBe(false)
    })

    it('reorders through the live node when handed a stale instance', () => {
      const canvas = makeCanvas()
      const staleChild = canvas.getNode('child1')!
      canvas.setNodes({ child1: staleChild.toJSON!() } as any, true)
      expect(canvas.getNode('child1')).not.toBe(staleChild)

      canvas.reorderNode(staleChild, 1)

      expect(canvas.getNode(NODE_ROOT_ID)!.nodes).toEqual(['child2', 'child1'])
      expect(collectUnreachable(canvas)).toEqual([])
    })

    // The whole point of the guard: an unreachable node is not a rendering
    // glitch, it is a permanent passenger in the saved document.
    it('never lets a detached node into the serialized payload', () => {
      const canvas = makeCanvas()
      const staleRoot = canvas.getNode(NODE_ROOT_ID)!
      canvas.setNodes({ [NODE_ROOT_ID]: staleRoot.toJSON!() } as any, true)

      canvas.reparentNode(canvas.getNode('child1')!, staleRoot)

      const saved = canvas.toJSON().nodes as Record<string, any>
      const reachable = new Set<string>()
      const walk = (id: string) => {
        if (reachable.has(id) || !saved[id]) return
        reachable.add(id)
        for (const childId of saved[id].nodes ?? []) walk(childId)
      }
      walk(NODE_ROOT_ID)
      expect(Object.keys(saved).filter((id) => !reachable.has(id))).toEqual([])
    })
  })

  /**
   * AGL-1366 — `setNode` was the last public way to put an entry in the node
   * map with no parent linkage at all, which is the whole orphan class of
   * AGL-1363 in one call: the map is serialized wholesale, the tree is walked
   * from the root, and a node in the first but not the second is saved every
   * save and drawn never.
   *
   * It was not a live defect — `duplicateNode` linked afterwards and the
   * `NODE_SET` event has no emitter — so these tests do not reproduce a
   * shipped bug. They pin the SHAPE, because the alternative is a comment,
   * and a comment is exactly what let the link-element invariant be
   * re-broken a day after its fix landed (AGL-1268 → AGL-1357).
   */
  describe('setNode requires and links a live parent (AGL-1366)', () => {
    const makeCanvas = () => {
      const canvas = new CanvasManager(undefined as any)
      canvas.setNodes(nodes)
      return canvas
    }

    /** Ids the renderer can never reach — the walk it actually does. */
    const collectUnreachable = (canvas: CanvasManager): NodeId[] => {
      const seen = new Set<NodeId>()
      const walk = (id: NodeId) => {
        if (seen.has(id)) return
        seen.add(id)
        for (const childId of canvas.getNode(id)?.nodes ?? []) walk(childId)
      }
      walk(NODE_ROOT_ID)
      return [...canvas.nodes.keys()].filter((id) => !seen.has(id))
    }

    // The reproduction. This is the call the old signature accepted happily:
    // a node lands in the map, no parent lists it, and it is now permanent.
    it('refuses a parent that is not in the map instead of stranding the node', () => {
      const canvas = makeCanvas()
      const before = canvas.toJSON().nodes
      // A parent a co-editor deleted out from under this session — truthy,
      // shaped like a node, absent from the map.
      const ghost = { $id: 'gone', nodes: [] } as any

      expect(() =>
        canvas.setNode(
          canvas.createNode({ $id: 'stray', componentId: 'div' }),
          ghost,
        ),
      ).toThrow('Invalid parent node')

      // Refused BEFORE the insert: the node never entered the map at all,
      // so there is nothing for the next save to carry.
      expect(canvas.nodes.has('stray')).toBe(false)
      expect(ghost.nodes).toEqual([])
      expect(collectUnreachable(canvas)).toEqual([])
      expect(canvas.toJSON().nodes).toEqual(before)
    })

    it('refuses a bare parent id that resolves to nothing', () => {
      const canvas = makeCanvas()

      expect(() =>
        canvas.setNode(
          canvas.createNode({ $id: 'stray', componentId: 'div' }),
          'nope',
        ),
      ).toThrow('Invalid parent node')

      expect(canvas.nodes.has('stray')).toBe(false)
      expect(collectUnreachable(canvas)).toEqual([])
    })

    it('links the node onto its parent, so a set node is always reachable', () => {
      const canvas = makeCanvas()

      const added = canvas.setNode(
        canvas.createNode({ $id: 'fresh', componentId: 'div' }),
        canvas.getNode('child2')!,
      )

      expect(added.$id).toBe('fresh')
      expect(canvas.getNode('child2')!.nodes).toEqual(['fresh'])
      // Both directions, or a later `getNodeParent` walks off the tree.
      expect(canvas.getNode('fresh')!.parentId).toBe('child2')
      expect(collectUnreachable(canvas)).toEqual([])
    })

    it('links onto the LIVE parent when handed a stale instance of it', () => {
      const canvas = makeCanvas()
      // Every `setNodes` mints a fresh `AglynNode` per id, so a co-editor's
      // merge silently replaces the instance a panel closure is holding.
      const staleChild2 = canvas.getNode('child2')!
      canvas.setNodes({ child2: staleChild2.toJSON!() } as any, true)
      expect(canvas.getNode('child2')).not.toBe(staleChild2)

      canvas.setNode(
        canvas.createNode({ $id: 'fresh', componentId: 'div' }),
        staleChild2,
      )

      // On the live entry, not the detached array the caller passed.
      expect(canvas.getNode('child2')!.nodes).toEqual(['fresh'])
      expect(collectUnreachable(canvas)).toEqual([])
    })

    it('honours an index, and appends without one', () => {
      const canvas = makeCanvas()

      canvas.setNode(
        canvas.createNode({ $id: 'first', componentId: 'div' }),
        'child1',
        0,
      )
      canvas.setNode(
        canvas.createNode({ $id: 'last', componentId: 'div' }),
        'child1',
      )

      expect(canvas.getNode('child1')!.nodes).toEqual([
        'first',
        'child1-1',
        'child1-2',
        'last',
      ])
      expect(collectUnreachable(canvas)).toEqual([])
    })

    // It still has to work as an update, or callers route around it.
    it('does not list a node twice when it is set again', () => {
      const canvas = makeCanvas()

      canvas.setNode(
        canvas.createNode({ $id: 'child1-1', componentId: 'span' }),
        'child1',
      )

      expect(canvas.getNode('child1')!.nodes).toEqual(['child1-1', 'child1-2'])
      expect(canvas.getNode('child1-1')!.componentId).toBe('span')
      expect(collectUnreachable(canvas)).toEqual([])
    })

    it('refuses the root, which has no parent to be listed on', () => {
      const canvas = makeCanvas()

      expect(() =>
        canvas.setNode(canvas.getNode(NODE_ROOT_ID)!, NODE_ROOT_ID),
      ).toThrow('Cannot set root node')
    })

    // `duplicateNode` is the one live caller, and it linked correctly on its
    // own. Its behaviour must be unchanged now that `setNode` does the work.
    it('leaves duplicateNode placing the copy right after the original', () => {
      const canvas = makeCanvas()

      const copy = canvas.duplicateNode(canvas.getNode('child1-1')!)

      expect(canvas.getNode('child1')!.nodes).toEqual([
        'child1-1',
        copy.$id,
        'child1-2',
      ])
      expect(collectUnreachable(canvas)).toEqual([])
    })

    it('duplicates a subtree with every copy reachable', () => {
      const canvas = makeCanvas()

      const copy = canvas.duplicateNode(canvas.getNode('child1')!)

      expect(canvas.getNode(NODE_ROOT_ID)!.nodes).toEqual([
        'child1',
        copy.$id,
        'child2',
      ])
      expect(copy.nodes).toHaveLength(2)
      for (const childId of copy.nodes!) {
        expect(canvas.getNode(childId)!.parentId).toBe(copy.$id)
      }
      expect(collectUnreachable(canvas)).toEqual([])
    })

    // The point of all of it: unreachable is not a glitch, it is a permanent
    // passenger in every saved payload.
    it('never lets a node set through it into the payload unreachable', () => {
      const canvas = makeCanvas()

      canvas.setNode(
        canvas.createNode({ $id: 'fresh', componentId: 'div' }),
        'child2',
      )
      canvas.duplicateNode(canvas.getNode('child1')!)

      const saved = canvas.toJSON().nodes as Record<string, any>
      const reachable = new Set<string>()
      const walk = (id: string) => {
        if (reachable.has(id) || !saved[id]) return
        reachable.add(id)
        for (const childId of saved[id].nodes ?? []) walk(childId)
      }
      walk(NODE_ROOT_ID)
      expect(Object.keys(saved).filter((id) => !reachable.has(id))).toEqual([])
    })
  })

  /**
   * `reparentNode` is the one primitive every move goes through — drag and
   * drop today, the hierarchy's Move in/out actions since AGL-1405. It was
   * the only editor write that could put a node somewhere it can never
   * render: `nodeAcceptsChildren` gated the Insert menu, paste and the drop
   * indicator (AGL-1388), but not the move itself. That is how three /press
   * screenshots ended up under a `markdown` node with no way back out.
   */
  describe('reparentNode guards the move (AGL-1405)', () => {
    const CONTAINER = 'testContainer1405'
    const NO_DROP = 'testNoDrop1405'
    const LEAF_SELF = 'testLeafSelf1405'
    const LEAF_TEXT = 'testLeafText1405'
    const schemas: Record<string, any> = {
      div: {},
      [CONTAINER]: {},
      [NO_DROP]: { flags: { dropping: FEATURE_FLAG.DISABLED } },
      [LEAF_SELF]: { flags: { selfClosing: FEATURE_FLAG.ENABLED } },
      [LEAF_TEXT]: { flags: { textEditable: FEATURE_FLAG.ENABLED } },
    }
    const fakeAglyn = {
      components: { getSchema: (id: string) => schemas[id] },
    } as any

    /**
     * The /press shape, minus the noise: a section holding a `markdown`
     * block, and a stack of images already trapped inside that block.
     *
     *   root
     *     section
     *       markdown        <- rejects children
     *         stack
     *           img1, img2
     *       tail
     */
    const makeCanvas = () => {
      const canvas = new CanvasManager(fakeAglyn)
      canvas.setNodes({
        [NODE_ROOT_ID]: {
          $id: NODE_ROOT_ID,
          type: NodeType.NODE,
          parentId: NODE_ROOT_ID,
          componentId: 'div',
          props: {},
          sx: {},
          nodes: ['section'],
        },
        section: {
          $id: 'section',
          type: NodeType.NODE,
          parentId: NODE_ROOT_ID,
          componentId: CONTAINER,
          props: {},
          sx: {},
          nodes: ['markdown', 'tail'],
        },
        markdown: {
          $id: 'markdown',
          type: NodeType.NODE,
          parentId: 'section',
          componentId: NO_DROP,
          props: {},
          sx: {},
          nodes: ['stack'],
        },
        stack: {
          $id: 'stack',
          type: NodeType.NODE,
          parentId: 'markdown',
          componentId: CONTAINER,
          props: {},
          sx: {},
          nodes: ['img1', 'img2'],
        },
        img1: {
          $id: 'img1',
          type: NodeType.NODE,
          parentId: 'stack',
          componentId: LEAF_SELF,
          props: {},
          sx: {},
          nodes: [],
        },
        img2: {
          $id: 'img2',
          type: NodeType.NODE,
          parentId: 'stack',
          componentId: LEAF_SELF,
          props: {},
          sx: {},
          nodes: [],
        },
        tail: {
          $id: 'tail',
          type: NodeType.NODE,
          parentId: 'section',
          componentId: LEAF_TEXT,
          props: {},
          sx: {},
          nodes: [],
        },
      })
      return canvas
    }

    it('accepts a move into a container that takes children', () => {
      const canvas = makeCanvas()
      canvas.reparentNode(canvas.getNode('stack')!, canvas.getNode('section')!, 1)

      expect(canvas.getNode('section')!.nodes).toEqual([
        'markdown',
        'stack',
        'tail',
      ])
      expect(canvas.getNode('stack')!.parentId).toBe('section')
      expect(canvas.getNode('markdown')!.nodes).toEqual([])
    })

    /**
     * The whole reason the /press images are stuck. A move that lands
     * somewhere the renderer will never walk is worse than a refused one:
     * the author sees the node in the tree and the page never shows it.
     */
    it('REFUSES a move into a node that rejects children', () => {
      const canvas = makeCanvas()
      expect(() =>
        canvas.reparentNode(canvas.getNode('tail')!, canvas.getNode('markdown')!),
      ).toThrow(/cannot hold/i)

      // Nothing moved, and nothing was written to the undo stack for it.
      expect(canvas.getNode('markdown')!.nodes).toEqual(['stack'])
      expect(canvas.getNode('section')!.nodes).toEqual(['markdown', 'tail'])
      expect(canvas.canUndo).toBe(false)
    })

    it('REFUSES a move into a self-closing or text-editable leaf', () => {
      const canvas = makeCanvas()
      // `tail` is text-editable, `img1` is self-closing — neither has a slot
      // a child could ever render into.
      expect(() =>
        canvas.reparentNode(canvas.getNode('stack')!, canvas.getNode('tail')!),
      ).toThrow(/cannot hold/i)
      expect(() =>
        canvas.reparentNode(canvas.getNode('tail')!, canvas.getNode('img1')!),
      ).toThrow(/cannot hold/i)
      expect(canvas.canUndo).toBe(false)
    })

    /**
     * A reorder inside a parent that rejects children is still allowed —
     * otherwise the nodes already trapped by AGL-1388 could not even be
     * shuffled, and `reorderNode` (Shift up / Shift down) would throw on
     * exactly the nodes that need rescuing.
     */
    it('allows a reorder within a parent that rejects children', () => {
      const canvas = makeCanvas()
      canvas.setNode(
        canvas.createNode({ $id: 'stack2', componentId: CONTAINER }),
        'markdown',
      )
      expect(canvas.getNode('markdown')!.nodes).toEqual(['stack', 'stack2'])

      canvas.reorderNode(canvas.getNode('stack2')!, 0)
      expect(canvas.getNode('markdown')!.nodes).toEqual(['stack2', 'stack'])
    })

    it('REFUSES a move into the node itself or its own descendant', () => {
      const canvas = makeCanvas()
      expect(() =>
        canvas.reparentNode(canvas.getNode('stack')!, canvas.getNode('stack')!),
      ).toThrow(/inside itself/i)
      expect(() =>
        canvas.reparentNode(canvas.getNode('stack')!, canvas.getNode('img1')!),
      ).toThrow()
      expect(canvas.getNode('stack')!.parentId).toBe('markdown')
      expect(canvas.canUndo).toBe(false)
    })

    /** A move, not a delete-and-recreate: ids and the subtree survive. */
    it('moves the subtree intact, keeping every id', () => {
      const canvas = makeCanvas()
      canvas.reparentNode(canvas.getNode('stack')!, canvas.getNode('section')!, 1)

      const stack = canvas.getNode('stack')!
      expect(stack.nodes).toEqual(['img1', 'img2'])
      expect(canvas.getNode('img1')!.parentId).toBe('stack')
      expect(canvas.getNode('img2')!.parentId).toBe('stack')
      // Every id in the document is still the id it was.
      expect(Object.keys(canvas.toJSON().nodes).sort()).toEqual(
        [
          NODE_ROOT_ID,
          'img1',
          'img2',
          'markdown',
          'section',
          'stack',
          'tail',
        ].sort(),
      )
    })

    it('undo puts the moved subtree back where it was', () => {
      const canvas = makeCanvas()
      canvas.reparentNode(canvas.getNode('stack')!, canvas.getNode('section')!, 1)
      expect(canvas.canUndo).toBe(true)

      canvas.undo()
      expect(canvas.getNode('markdown')!.nodes).toEqual(['stack'])
      expect(canvas.getNode('stack')!.parentId).toBe('markdown')
      expect(canvas.getNode('stack')!.nodes).toEqual(['img1', 'img2'])
      expect(canvas.getNode('section')!.nodes).toEqual(['markdown', 'tail'])
    })

    /**
     * AGL-1405's tell: the hierarchy drag "records an undo entry without
     * moving anything". `saveHistory` ran before the splice pair, so a move
     * that resolved back to the node's own slot still cost an undo step —
     * and the next Undo silently threw away the author's PREVIOUS edit.
     */
    it('records no undo entry when the move resolves to where the node is', () => {
      const canvas = makeCanvas()
      const before = JSON.stringify(canvas.toJSON())

      canvas.reparentNode(canvas.getNode('img2')!, canvas.getNode('stack')!, 1)

      expect(JSON.stringify(canvas.toJSON())).toBe(before)
      expect(canvas.canUndo).toBe(false)
    })

    /**
     * `splice(-1, 0, id)` inserts before the LAST element, so a Shift-up on
     * the first child used to move it DOWN. The menu hid that by disabling
     * the item; the primitive should not depend on the menu.
     */
    it('clamps an out-of-range index instead of splicing from the end', () => {
      const canvas = makeCanvas()
      canvas.reorderNode(canvas.getNode('img1')!, -1)
      expect(canvas.getNode('stack')!.nodes).toEqual(['img1', 'img2'])

      canvas.reorderNode(canvas.getNode('img1')!, 99)
      expect(canvas.getNode('stack')!.nodes).toEqual(['img2', 'img1'])
    })
  })
})
