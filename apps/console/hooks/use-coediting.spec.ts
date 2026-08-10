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
 *
 * @jest-environment jsdom
 */

import * as Aglyn from '@aglyn/aglyn'
import { applyRemoteNode, flushRemoteReconcile } from './use-coediting'

/**
 * The AGL-677 application rules, asserted against the REAL canvas singleton
 * — no stub, because the rules are about what the canvas records, not about
 * what the hook calls:
 *
 * 1. A remote change is applied with `setNodes(partial, merge)` and never
 *    enters local undo — undo must rewind YOUR edits and leave a
 *    colleague's alone (`canUndo` stays false on the receiving side).
 * 2. A remote delete is a raw map delete, never `canvas.deleteNode` — that
 *    one recurses into the subtree and saves history; the peer already
 *    announces every node it removed, individually.
 *
 * Pinned now because AGL-1301 adopts co-editing beyond the screen editor,
 * multiplying the surfaces that depend on these rules holding.
 */
describe('applyRemoteNode (AGL-677 rules, adopted by AGL-1301)', () => {
  const ROOT = Aglyn.CANVAS_ROOT_ELEMENT_ID

  const TREE = {
    [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['hero'] },
    hero: {
      $id: 'hero',
      componentId: 'muiStack',
      parentId: ROOT,
      nodes: ['headline'],
    },
    headline: {
      $id: 'headline',
      componentId: 'muiTypography',
      parentId: 'hero',
      props: { children: 'hello' },
    },
  }

  beforeEach(() => {
    // Drain any batch a previous test left pending, so its reconcile cannot
    // run against this one's canvas.
    flushRemoteReconcile()
    Aglyn.canvas.reset()
    Aglyn.canvas.setNodes(TREE as never)
    Aglyn.canvas.updateInitialNodes()
  })

  afterAll(() => {
    Aglyn.canvas.reset()
  })

  it('applies a remote node change without entering local undo', () => {
    expect(Aglyn.canvas.canUndo).toBe(false)

    const applied = applyRemoteNode('headline', {
      by: 'peer-tab',
      at: Date.now(),
      json: JSON.stringify({
        $id: 'headline',
        componentId: 'muiTypography',
        parentId: 'hero',
        props: { children: 'from a colleague' },
      }),
    })

    expect(applied).toBe(true)
    expect(
      (Aglyn.canvas.nodes.get('headline') as { props?: { children?: string } })
        ?.props?.children,
    ).toBe('from a colleague')
    // Rule 2 of AGL-677: a local undo must never erase a colleague's work.
    expect(Aglyn.canvas.canUndo).toBe(false)
  })

  it('deletes only the named node, keeps the subtree, records no history', () => {
    const applied = applyRemoteNode('hero', {
      by: 'peer-tab',
      at: Date.now(),
      deleted: true,
    })

    expect(applied).toBe(true)
    expect(Aglyn.canvas.nodes.has('hero')).toBe(false)
    // NOT `canvas.deleteNode`: the peer announces every removed node
    // individually, so the child must survive until its own tombstone.
    expect(Aglyn.canvas.nodes.has('headline')).toBe(true)
    expect(Aglyn.canvas.canUndo).toBe(false)
  })

  it('reports false for a delete of a node it never had', () => {
    expect(
      applyRemoteNode('ghost', { by: 'peer-tab', at: Date.now(), deleted: true }),
    ).toBe(false)
  })

  it('reports false for unparseable payloads', () => {
    expect(
      applyRemoteNode('headline', { by: 'peer-tab', at: Date.now(), json: '{' }),
    ).toBe(false)
  })

  // Negative control: `canUndo` is not trivially false — a LOCAL wholesale
  // edit does record history, which is what makes the assertions above mean
  // something.
  it('local applyNodes DOES record history, unlike a remote apply', () => {
    Aglyn.canvas.applyNodes({
      ...TREE,
      headline: {
        ...TREE.headline,
        props: { children: 'a local edit' },
      },
    } as never)

    expect(Aglyn.canvas.canUndo).toBe(true)
  })
})

/**
 * AGL-1363 — the two co-editing paths that leave a node in the map but out
 * of the tree.
 *
 * The canvas saves a flat map (`serializeNodes` dumps every entry) and
 * renders a tree (the renderer walks child lists from the root). A node that
 * is in the map and reachable from neither is not a glitch — it is saved on
 * every save, shipped in every payload, and never drawn again. `/product`
 * served 61 of them, 26 carrying the only copy of two Hero sections' text.
 *
 * Both paths are the same shape: an entry lands, the entry that would have
 * kept the tree consistent does not (dropped by the `at < floorMillis`
 * floor, an unsubscribed window, a parse failure). So the reconcile runs
 * once per BATCH, not per node — a peer's `update()` publishes the node and
 * its parent's new child list together, and judging either alone would fight
 * a change that is about to arrive.
 */
describe('remote batch reconciliation (AGL-1363)', () => {
  const ROOT = Aglyn.CANVAS_ROOT_ELEMENT_ID

  /** root › sectionA › a1 › a1x, plus root › sectionB. */
  const TREE = {
    [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['sectionA', 'sectionB'] },
    sectionA: {
      $id: 'sectionA',
      componentId: 'muiStack',
      parentId: ROOT,
      nodes: ['a1'],
    },
    a1: {
      $id: 'a1',
      componentId: 'muiStack',
      parentId: 'sectionA',
      nodes: ['a1x'],
    },
    a1x: {
      $id: 'a1x',
      componentId: 'muiTypography',
      parentId: 'a1',
      props: { children: 'Design your whole site on a living canvas.' },
    },
    sectionB: {
      $id: 'sectionB',
      componentId: 'muiStack',
      parentId: ROOT,
      nodes: [],
    },
  }

  const seed = (tree: Record<string, unknown> = TREE) => {
    flushRemoteReconcile()
    Aglyn.canvas.reset()
    Aglyn.canvas.setNodes(tree as never)
    Aglyn.canvas.updateInitialNodes()
  }

  /** Ids the renderer can never reach — the walk `branch.tsx` actually does. */
  const unreachable = (): string[] => {
    const seen = new Set<string>()
    const walk = (id: string) => {
      if (seen.has(id)) return
      seen.add(id)
      for (const childId of Aglyn.canvas.nodes.get(id)?.nodes ?? []) walk(childId)
    }
    walk(ROOT)
    return [...Aglyn.canvas.nodes.keys()].filter((id) => !seen.has(id))
  }

  /** Child ids that resolve to nothing — the other half of a consistent tree. */
  const dangling = (): string[] => {
    const missing: string[] = []
    for (const node of Aglyn.canvas.nodes.values()) {
      for (const id of node.nodes ?? []) {
        if (!Aglyn.canvas.nodes.has(id)) missing.push(id)
      }
    }
    return missing
  }

  const remote = (nodeId: string, node: Record<string, unknown>) =>
    applyRemoteNode(nodeId, {
      by: 'peer-tab',
      at: Date.now(),
      json: JSON.stringify(node),
    })

  const remoteDelete = (nodeId: string) =>
    applyRemoteNode(nodeId, { by: 'peer-tab', at: Date.now(), deleted: true })

  beforeEach(() => seed())
  afterAll(() => {
    flushRemoteReconcile()
    Aglyn.canvas.reset()
  })

  // Path 2 of the diagnosis: `newKid(parent=sectionB exists=true lists=false)`.
  it('links back a merged node whose parent never learned about it', () => {
    remote('newKid', {
      $id: 'newKid',
      componentId: 'muiTypography',
      parentId: 'sectionB',
      props: { children: 'Start free' },
    })
    // Before the reconcile this is exactly the bug: in the map, in the save,
    // in no parent's child list.
    expect(Aglyn.canvas.nodes.has('newKid')).toBe(true)
    expect(Aglyn.canvas.nodes.get('sectionB')?.nodes).not.toContain('newKid')

    flushRemoteReconcile()

    expect(Aglyn.canvas.nodes.get('sectionB')?.nodes).toEqual(['newKid'])
    expect(unreachable()).toEqual([])
    expect(dangling()).toEqual([])
    // Still a REMOTE apply: it must not become a local undo step (AGL-677).
    expect(Aglyn.canvas.canUndo).toBe(false)
  })

  it('puts back a child the batch dropped from a parent list it did announce', () => {
    // sectionA's new list arrives without `a1`; `a1`'s own tombstone does not.
    remote('sectionA', {
      $id: 'sectionA',
      componentId: 'muiStack',
      parentId: ROOT,
      nodes: [],
    })
    expect(Aglyn.canvas.nodes.has('a1')).toBe(true)

    flushRemoteReconcile()

    // Back at its recorded index, with its own subtree intact.
    expect(Aglyn.canvas.nodes.get('sectionA')?.nodes).toEqual(['a1'])
    expect(Aglyn.canvas.nodes.get('a1')?.nodes).toEqual(['a1x'])
    expect(unreachable()).toEqual([])
  })

  // Path 3: the remote delete is a raw single-id map delete (it must not
  // recurse — AGL-677), so a lost per-child tombstone strands the children.
  it('re-homes children stranded by a remote delete of their parent', () => {
    remoteDelete('sectionA')

    expect(Aglyn.canvas.nodes.has('a1')).toBe(true)
    expect(Aglyn.canvas.nodes.get('a1')?.parentId).toBe('sectionA')

    flushRemoteReconcile()

    // Lossless: the subtree is re-homed onto the deleted parent's own parent,
    // at the position the parent held, so the copy stays visible and an
    // author can decide its fate. Never pruned — that text may exist nowhere
    // else, which is exactly what `/product` proved.
    expect(Aglyn.canvas.nodes.get('a1')?.parentId).toBe(ROOT)
    expect(Aglyn.canvas.nodes.get(ROOT)?.nodes).toEqual(['a1', 'sectionB'])
    expect(
      (Aglyn.canvas.nodes.get('a1x') as { props?: { children?: string } })
        ?.props?.children,
    ).toBe('Design your whole site on a living canvas.')
    expect(unreachable()).toEqual([])
    // The deleted id is gone from its parent's list too, or the saved
    // document would carry a child reference that resolves to nothing.
    expect(dangling()).toEqual([])
    expect(Aglyn.canvas.canUndo).toBe(false)
  })

  // The reason it is a BATCH: a peer's real delete publishes the whole
  // subtree's tombstones in one `update()`, and reconciling per node would
  // resurrect each child in the gap before its own tombstone was applied.
  it('resurrects nothing when the peer announced the whole subtree', () => {
    remoteDelete('a1x')
    remoteDelete('a1')
    remoteDelete('sectionA')
    remote(ROOT, { $id: ROOT, componentId: 'div', nodes: ['sectionB'] })

    flushRemoteReconcile()

    expect([...Aglyn.canvas.nodes.keys()].sort()).toEqual([ROOT, 'sectionB'])
    expect(Aglyn.canvas.nodes.get(ROOT)?.nodes).toEqual(['sectionB'])
    expect(unreachable()).toEqual([])
    expect(dangling()).toEqual([])
  })

  // The guard repairs what the BATCH broke. It must not go looking for
  // orphans it did not create: `/product` carries 61 of them, and re-homing
  // those onto the root the moment two people co-edit would rewrite a live
  // page nobody touched.
  it('leaves an orphan that predates the batch exactly where it is', () => {
    seed({
      ...TREE,
      // The `/product` shape: in the map, parented to the root, unlisted.
      [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['sectionB'] },
      ghostHero: {
        $id: 'ghostHero',
        componentId: 'muiStack',
        parentId: ROOT,
        nodes: [],
      },
    })
    expect(unreachable().sort()).toEqual(['a1', 'a1x', 'ghostHero', 'sectionA'])

    // An unrelated edit lands, and one that touches the orphan itself.
    remote('sectionB', {
      $id: 'sectionB',
      componentId: 'muiStack',
      parentId: ROOT,
      nodes: [],
      props: { spacing: 2 },
    })
    remote('ghostHero', {
      $id: 'ghostHero',
      componentId: 'muiStack',
      parentId: ROOT,
      nodes: [],
      props: { spacing: 3 },
    })
    flushRemoteReconcile()

    expect(Aglyn.canvas.nodes.get(ROOT)?.nodes).toEqual(['sectionB'])
    expect(unreachable().sort()).toEqual(['a1', 'a1x', 'ghostHero', 'sectionA'])
  })

  it('reports the ids it repaired, and nothing when the batch was consistent', () => {
    expect(flushRemoteReconcile()).toEqual([])

    remote('sectionB', {
      $id: 'sectionB',
      componentId: 'muiStack',
      parentId: ROOT,
      nodes: ['newKid'],
    })
    remote('newKid', {
      $id: 'newKid',
      componentId: 'muiTypography',
      parentId: 'sectionB',
    })

    // A complete, self-consistent batch needs no repair at all.
    expect(flushRemoteReconcile()).toEqual([])
    expect(unreachable()).toEqual([])
  })
})
