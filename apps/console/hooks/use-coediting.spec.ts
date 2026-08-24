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
import {
  COEDIT_MIRROR_MAX_AGE_MS,
  applyRemoteNode,
  flushRemoteReconcile,
  isMirrorEntryLive,
  mirrorFloorMillis,
  reapableMirrorEntryIds,
} from './use-coediting'

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

/**
 * AGL-1958 — the second half of AGL-677 constraint 3.
 *
 * The first half (asserted at the top of this file) keeps a colleague's edit
 * OUT of your undo stack. That is necessary and it is not sufficient, and the
 * gap was live in production: every snapshot already on the stack was taken
 * before one of your edits, therefore before their edit arrived, so restoring
 * one wholesale reverted their node too. Worse, the restored map is diffed
 * against the co-editing shadow like any other local change, so the revert
 * was published back to its author under YOUR session id — their work gone on
 * their own screen, with no signal and nothing to restore it from.
 *
 * The fix is an epoch stamp per snapshot plus a per-node mark of when a peer
 * last touched it, so a restore keeps anything the snapshot predates. These
 * tests are written against the REAL canvas: the rule is about what the
 * canvas ends up holding, not about which method was called.
 */
describe('undo against a co-editor (AGL-1958)', () => {
  const ROOT = Aglyn.CANVAS_ROOT_ELEMENT_ID

  const TREE = {
    [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['mine', 'theirs'] },
    mine: {
      $id: 'mine',
      componentId: 'muiTypography',
      parentId: ROOT,
      props: { children: 'mine v0' },
    },
    theirs: {
      $id: 'theirs',
      componentId: 'muiTypography',
      parentId: ROOT,
      props: { children: 'theirs v0' },
    },
  }

  const children = (nodeId: string): string | undefined =>
    (Aglyn.canvas.nodes.get(nodeId) as { props?: { children?: string } })?.props
      ?.children

  /** A peer's change to one node, through the real apply path. */
  const remote = (nodeId: string, node: Record<string, unknown>) =>
    applyRemoteNode(nodeId, {
      by: 'peer-tab',
      at: Date.now(),
      json: JSON.stringify(node),
    })

  /** A local edit that records exactly one undo step. */
  const localEdit = (nodeId: string, text: string) =>
    Aglyn.canvas.transact(() => {
      const node = Aglyn.canvas.nodes.get(nodeId) as {
        props: { children?: string }
      }
      node.props.children = text
    })

  beforeEach(() => {
    flushRemoteReconcile()
    Aglyn.canvas.reset()
    Aglyn.canvas.setNodes(TREE as never)
    Aglyn.canvas.updateInitialNodes()
  })

  afterAll(() => {
    Aglyn.canvas.reset()
  })

  it('rewinds my node and keeps the edit a peer made after my snapshot', () => {
    localEdit('mine', 'mine v1')
    expect(Aglyn.canvas.canUndo).toBe(true)

    remote('theirs', {
      $id: 'theirs',
      componentId: 'muiTypography',
      parentId: ROOT,
      props: { children: 'theirs v1' },
    })
    flushRemoteReconcile()
    expect(children('theirs')).toBe('theirs v1')

    Aglyn.canvas.undo()

    // Mine rewinds — undo still does its job.
    expect(children('mine')).toBe('mine v0')
    // Theirs survives. Before AGL-1958 this read 'theirs v0', and the diff
    // against the co-editing shadow then published that revert back to them.
    expect(children('theirs')).toBe('theirs v1')
  })

  it('keeps a node the peer CREATED after my snapshot', () => {
    localEdit('mine', 'mine v1')

    remote('fresh', {
      $id: 'fresh',
      componentId: 'muiTypography',
      parentId: ROOT,
      props: { children: 'brand new' },
    })
    // The peer republishes the parent's child list in the same update.
    remote(ROOT, {
      $id: ROOT,
      componentId: 'div',
      nodes: ['mine', 'theirs', 'fresh'],
    })
    flushRemoteReconcile()

    Aglyn.canvas.undo()

    // Before AGL-1958 the snapshot had no 'fresh' key, so the wholesale
    // replace deleted it outright.
    expect(Aglyn.canvas.nodes.has('fresh')).toBe(true)
    expect(children('fresh')).toBe('brand new')
    // And it is still reachable: the parent's list came in the same batch,
    // so the parent is marked too and its list survives with the child.
    expect(Aglyn.canvas.nodes.get(ROOT)?.nodes).toContain('fresh')
  })

  it('keeps a node the peer DELETED after my snapshot deleted', () => {
    localEdit('mine', 'mine v1')

    applyRemoteNode('theirs', { by: 'peer-tab', at: Date.now(), deleted: true })
    flushRemoteReconcile()
    expect(Aglyn.canvas.nodes.has('theirs')).toBe(false)

    Aglyn.canvas.undo()

    // An absence is a remote state as much as a value is: restoring the
    // snapshot must not resurrect what they removed.
    expect(Aglyn.canvas.nodes.has('theirs')).toBe(false)
    expect(children('mine')).toBe('mine v0')
  })

  it('still rewinds a node the peer touched BEFORE my snapshot', () => {
    // The ordering that must NOT be preserved: their change is already in
    // the snapshot, so undo has to restore it like any other node — or undo
    // would quietly stop working on every node anyone has ever co-edited.
    remote('theirs', {
      $id: 'theirs',
      componentId: 'muiTypography',
      parentId: ROOT,
      props: { children: 'theirs v1' },
    })
    flushRemoteReconcile()

    // My snapshot is taken AFTER their edit, so it contains 'theirs v1'.
    localEdit('theirs', 'i changed it too')
    expect(children('theirs')).toBe('i changed it too')

    Aglyn.canvas.undo()

    expect(children('theirs')).toBe('theirs v1')
  })

  it('walks back SEVERAL of my own edits to a node the peer touched before them', () => {
    // Hardens the case above, which was the only assertion standing between
    // an over-protective overlay and an undo that silently stops working.
    // One step proves undo moves; it does not prove undo keeps moving. If the
    // overlay ever pins a peer-touched node to its LIVE value regardless of
    // epoch, the first undo still appears to work and every later one is a
    // no-op on that node.
    remote('theirs', {
      $id: 'theirs',
      componentId: 'muiTypography',
      parentId: ROOT,
      props: { children: 'theirs v1' },
    })
    flushRemoteReconcile()

    // Both snapshots are taken after their edit, so both already contain it.
    localEdit('theirs', 'my first')
    localEdit('theirs', 'my second')

    Aglyn.canvas.undo()
    expect(children('theirs')).toBe('my first')

    Aglyn.canvas.undo()
    expect(children('theirs')).toBe('theirs v1')
  })

  it('a peer edit elsewhere does not stall undo through my own history', () => {
    // The two-session proof in both directions at once, across more than one
    // step: their node survives every undo, mine rewinds on every undo.
    localEdit('mine', 'mine v1')
    localEdit('mine', 'mine v2')

    remote('theirs', {
      $id: 'theirs',
      componentId: 'muiTypography',
      parentId: ROOT,
      props: { children: 'theirs v1' },
    })
    flushRemoteReconcile()

    Aglyn.canvas.undo()
    expect(children('mine')).toBe('mine v1')
    expect(children('theirs')).toBe('theirs v1')

    Aglyn.canvas.undo()
    expect(children('mine')).toBe('mine v0')
    expect(children('theirs')).toBe('theirs v1')
  })

  it('resolves a node we both changed to the peer, per-node last-writer-wins', () => {
    localEdit('theirs', 'my take')

    remote('theirs', {
      $id: 'theirs',
      componentId: 'muiTypography',
      parentId: ROOT,
      props: { children: 'their take' },
    })
    flushRemoteReconcile()

    Aglyn.canvas.undo()

    // Same rule the per-node mirror applies everywhere else (AGL-677), not
    // a new one: the later writer holds the node.
    expect(children('theirs')).toBe('their take')
  })

  it('redo replays my edit and still leaves the peer alone', () => {
    localEdit('mine', 'mine v1')

    remote('theirs', {
      $id: 'theirs',
      componentId: 'muiTypography',
      parentId: ROOT,
      props: { children: 'theirs v1' },
    })
    flushRemoteReconcile()

    Aglyn.canvas.undo()
    expect(Aglyn.canvas.canRedo).toBe(true)
    Aglyn.canvas.redo()

    expect(children('mine')).toBe('mine v1')
    expect(children('theirs')).toBe('theirs v1')
  })

  // Negative control: the preservation is scoped to co-editing, not a blanket
  // "undo never removes nodes". A node the LOCAL user added is still undone.
  it('undo still removes a node I added myself', () => {
    Aglyn.canvas.transact(() => {
      Aglyn.canvas.setNode(
        {
          $id: 'localKid',
          componentId: 'muiTypography',
          props: { children: 'local' },
        } as never,
        ROOT,
      )
    })
    expect(Aglyn.canvas.nodes.has('localKid')).toBe(true)

    Aglyn.canvas.undo()

    expect(Aglyn.canvas.nodes.has('localKid')).toBe(false)
  })

  // Negative control: a fresh document must not inherit the previous one's
  // marks, or an undo there would preserve node ids that mean something else.
  it('reset drops the marks, so undo is wholesale again', () => {
    localEdit('mine', 'mine v1')
    remote('theirs', {
      $id: 'theirs',
      componentId: 'muiTypography',
      parentId: ROOT,
      props: { children: 'theirs v1' },
    })
    flushRemoteReconcile()

    Aglyn.canvas.reset()
    Aglyn.canvas.setNodes(TREE as never)
    Aglyn.canvas.updateInitialNodes()
    expect(Aglyn.canvas.canUndo).toBe(false)

    // Edit the very node the PREVIOUS document had marked, then rewind it.
    // Asserting on an untouched node would pass either way — the re-seeded
    // value and the snapshot value are the same string, so preserving and
    // restoring are indistinguishable. Only a local edit separates them.
    localEdit('theirs', 'edited after the reset')
    Aglyn.canvas.undo()

    // No marks carried over, so 'theirs' rewinds like any other local node.
    // With a stale mark it would have been preserved at the edited value.
    expect(children('theirs')).toBe('theirs v0')
  })
})

/**
 * AGL-2486 — an ECHO is not a peer edit, and marking it killed undo.
 *
 * Regression, found on Zach's own screen the night same-account sessions
 * started counting as co-editors. Symptom: undo consumed its entry and
 * changed nothing. Read live off the failing tab —
 *
 *     _epoch: 3   past: 0   future: 1   canUndo: false
 *     _foreignAt: { C3rodYc1Gd: 3, … }
 *
 * — where `C3rodYc1Gd` is the node HE had just edited, stamped foreign.
 *
 * The mirror is per node and every session republishes what it holds, so a
 * value you wrote comes back to you from another session — your own second
 * tab most of all. The room drops your own TAB's echoes by session id, but
 * not another session's echo of your value. `applyRemoteNode` marked it
 * anyway, with a fresh epoch, therefore newer than every snapshot on your
 * stack, so `withForeignNodes` laid the live value back over each one.
 *
 * The fix is not "ignore my own account". A different value from your other
 * tab IS a real concurrent edit with its own undo stack and stays protected.
 * The fix is that an apply which changed nothing records nothing.
 */
describe('an echo is not a peer edit (AGL-2486)', () => {
  const ROOT = Aglyn.CANVAS_ROOT_ELEMENT_ID

  const TREE = {
    [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['mine'] },
    mine: {
      $id: 'mine',
      componentId: 'muiTypography',
      parentId: ROOT,
      props: { children: 'v0' },
    },
  }

  const children = (nodeId: string): string | undefined =>
    (Aglyn.canvas.nodes.get(nodeId) as { props?: { children?: string } })?.props
      ?.children

  /** A session OTHER than this tab publishing `node`. */
  const remote = (nodeId: string, node: Record<string, unknown>) =>
    applyRemoteNode(nodeId, {
      by: 'my-other-tab',
      at: Date.now(),
      json: JSON.stringify(node),
    })

  const localEdit = (nodeId: string, text: string) =>
    Aglyn.canvas.transact(() => {
      const node = Aglyn.canvas.nodes.get(nodeId) as {
        props: { children?: string }
      }
      node.props.children = text
    })

  /** What the peer sends back: exactly what this canvas already holds. */
  const echoOf = (nodeId: string) =>
    JSON.parse(
      JSON.stringify(Aglyn.canvas.nodes.get(nodeId)?.toJSON()),
    ) as Record<string, unknown>

  beforeEach(() => {
    flushRemoteReconcile()
    Aglyn.canvas.reset()
    Aglyn.canvas.setNodes(TREE as never)
    Aglyn.canvas.updateInitialNodes()
  })

  afterAll(() => {
    Aglyn.canvas.reset()
  })

  it('still undoes my edit after another session echoes it back to me', () => {
    localEdit('mine', 'my edit')

    // My other tab applied my edit and republished it. Same value, so this
    // apply moves nothing — but it used to stamp the node foreign at a fresh
    // epoch, newer than the snapshot my undo is about to restore.
    remote('mine', echoOf('mine'))
    flushRemoteReconcile()

    Aglyn.canvas.undo()

    // Before the fix this read 'my edit': the entry was consumed and the
    // overlay put the live value straight back.
    expect(children('mine')).toBe('v0')
  })

  it('records no mark at all for an apply that changes nothing', () => {
    expect(Aglyn.canvas.hasRemoteEdits).toBe(false)

    remote('mine', echoOf('mine'))
    flushRemoteReconcile()

    // `hasRemoteEdits` is the flag the draft prompt reads to stop offering
    // Restore. An echo must not trip it either, or a pure round-trip of your
    // own work retires your crash net.
    expect(Aglyn.canvas.hasRemoteEdits).toBe(false)
  })

  it('still protects a genuinely different value from another session', () => {
    localEdit('mine', 'my edit')

    // Not an echo — my other tab really did change it. This is a concurrent
    // edit with its own undo stack, and it stays protected.
    remote('mine', {
      $id: 'mine',
      componentId: 'muiTypography',
      parentId: ROOT,
      props: { children: 'their edit' },
    })
    flushRemoteReconcile()

    Aglyn.canvas.undo()

    expect(children('mine')).toBe('their edit')
    expect(Aglyn.canvas.hasRemoteEdits).toBe(true)
  })

  it('undoes a structural step after an echo of the parent list', () => {
    // The most damaging shape: the parent's child list echoes back, and
    // every insert and delete on the document is undone through it.
    Aglyn.canvas.transact(() => {
      Aglyn.canvas.setNode(
        {
          $id: 'added',
          componentId: 'muiTypography',
          props: { children: 'added' },
        } as never,
        ROOT,
      )
    })
    expect(Aglyn.canvas.nodes.get(ROOT)?.nodes).toContain('added')

    remote(ROOT, echoOf(ROOT))
    flushRemoteReconcile()

    Aglyn.canvas.undo()

    expect(Aglyn.canvas.nodes.has('added')).toBe(false)
    expect(Aglyn.canvas.nodes.get(ROOT)?.nodes).not.toContain('added')
  })

  it('redo survives an echo too', () => {
    localEdit('mine', 'my edit')
    Aglyn.canvas.undo()
    expect(children('mine')).toBe('v0')

    remote('mine', echoOf('mine'))
    flushRemoteReconcile()

    Aglyn.canvas.redo()

    expect(children('mine')).toBe('my edit')
  })
})

/**
 * AGL-2486 — the same rule, for the OTHER direction of the history stack.
 *
 * The AGL-1958 block above asserts undo, and its one redo case has a peer
 * edit landing BEFORE the undo. That case cannot fail: `HistoryManager.undo`
 * pushes a live capture of the present onto `future`, so a peer change that
 * predates the undo is already inside the snapshot redo replays, and the
 * epoch overlay is a no-op on it. Every ordering that actually EXERCISES the
 * overlay on the redo path — a peer change landing between the undo and the
 * redo, which no snapshot on `future` has ever seen — was untested.
 *
 * That mattered because the design note in `use-coediting.ts` read as though
 * redo were the unprotected direction, and nothing in the suite said
 * otherwise. It is in fact protected, by the same mechanism and for the same
 * reason: `undo` stamps the entry it pushes onto `future` with the epoch AT
 * THE TIME OF THE UNDO, so anything a peer touches afterwards is strictly
 * newer than that stamp and `withForeignNodes` keeps it.
 *
 * Verified on the running editor, two browser sessions on one screen
 * (2026-08-23): across an interleaved run of two undos and two redos, the
 * only node id the undoing tab ever wrote to RTDB was its OWN — no value
 * revert, no tombstone, and the peer's canvas never moved. These cases pin
 * that, because the property is one live capture away from being lost to a
 * refactor of `HistoryManager.undo` that nothing would catch.
 */
describe('redo against a co-editor (AGL-2486)', () => {
  const ROOT = Aglyn.CANVAS_ROOT_ELEMENT_ID

  const TREE = {
    [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['mine', 'theirs'] },
    mine: {
      $id: 'mine',
      componentId: 'muiTypography',
      parentId: ROOT,
      props: { children: 'mine v0' },
    },
    theirs: {
      $id: 'theirs',
      componentId: 'muiTypography',
      parentId: ROOT,
      props: { children: 'theirs v0' },
    },
  }

  const children = (nodeId: string): string | undefined =>
    (Aglyn.canvas.nodes.get(nodeId) as { props?: { children?: string } })?.props
      ?.children

  const remote = (nodeId: string, node: Record<string, unknown>) =>
    applyRemoteNode(nodeId, {
      by: 'peer-tab',
      at: Date.now(),
      json: JSON.stringify(node),
    })

  const localEdit = (nodeId: string, text: string) =>
    Aglyn.canvas.transact(() => {
      const node = Aglyn.canvas.nodes.get(nodeId) as {
        props: { children?: string }
      }
      node.props.children = text
    })

  beforeEach(() => {
    flushRemoteReconcile()
    Aglyn.canvas.reset()
    Aglyn.canvas.setNodes(TREE as never)
    Aglyn.canvas.updateInitialNodes()
  })

  afterAll(() => {
    Aglyn.canvas.reset()
  })

  it('keeps an edit the peer made BETWEEN my undo and my redo', () => {
    localEdit('mine', 'mine v1')
    Aglyn.canvas.undo()

    // The snapshot now sitting on `future` was captured before this landed,
    // so replaying it wholesale is exactly the AGL-1958 failure mode — and
    // the revert would be diffed against the co-editing shadow and published
    // back to its author under this tab's session id.
    remote('theirs', {
      $id: 'theirs',
      componentId: 'muiTypography',
      parentId: ROOT,
      props: { children: 'theirs v1' },
    })
    flushRemoteReconcile()

    Aglyn.canvas.redo()

    expect(children('mine')).toBe('mine v1')
    expect(children('theirs')).toBe('theirs v1')
  })

  it('keeps a node the peer CREATED between my undo and my redo', () => {
    localEdit('mine', 'mine v1')
    Aglyn.canvas.undo()

    remote('fresh', {
      $id: 'fresh',
      componentId: 'muiTypography',
      parentId: ROOT,
      props: { children: 'brand new' },
    })
    // One peer `update()`, so the parent's new child list rides along.
    remote(ROOT, {
      $id: ROOT,
      componentId: 'div',
      nodes: ['mine', 'theirs', 'fresh'],
    })
    flushRemoteReconcile()

    Aglyn.canvas.redo()

    // The `future` snapshot has no 'fresh' key at all — the sharpest shape,
    // because a wholesale replace turns a missing key into a DELETE
    // broadcast under this session's id.
    expect(Aglyn.canvas.nodes.has('fresh')).toBe(true)
    expect(children('fresh')).toBe('brand new')
    expect(Aglyn.canvas.nodes.get(ROOT)?.nodes).toContain('fresh')
    // …and my own edit is still replayed.
    expect(children('mine')).toBe('mine v1')
  })

  it('does not resurrect a node the peer DELETED between my undo and my redo', () => {
    localEdit('mine', 'mine v1')
    Aglyn.canvas.undo()

    applyRemoteNode('theirs', { by: 'peer-tab', at: Date.now(), deleted: true })
    flushRemoteReconcile()
    expect(Aglyn.canvas.nodes.has('theirs')).toBe(false)

    Aglyn.canvas.redo()

    // An absence is a remote state as much as a value is, in this direction
    // too: redo must not bring their removal back.
    expect(Aglyn.canvas.nodes.has('theirs')).toBe(false)
    expect(children('mine')).toBe('mine v1')
  })

  it('walks several of my own steps with the peer editing between them', () => {
    localEdit('mine', 'mine v1')
    remote('theirs', {
      $id: 'theirs',
      componentId: 'muiTypography',
      parentId: ROOT,
      props: { children: 'theirs v1' },
    })
    flushRemoteReconcile()
    localEdit('mine', 'mine v2')

    Aglyn.canvas.undo()
    Aglyn.canvas.undo()
    expect(children('mine')).toBe('mine v0')

    // Their SECOND edit lands while both of my steps are on `future`.
    remote('theirs', {
      $id: 'theirs',
      componentId: 'muiTypography',
      parentId: ROOT,
      props: { children: 'theirs v2' },
    })
    flushRemoteReconcile()

    Aglyn.canvas.redo()
    expect(children('mine')).toBe('mine v1')
    expect(children('theirs')).toBe('theirs v2')

    Aglyn.canvas.redo()
    expect(children('mine')).toBe('mine v2')
    // Still theirs, after BOTH redos — the overlay has to hold for every
    // step on the stack, not just the first one popped.
    expect(children('theirs')).toBe('theirs v2')
  })

  // The stated limit, pinned so it stays a decision rather than a surprise.
  it('leaves a node the peer changed between my undo and my redo to the peer', () => {
    localEdit('theirs', 'my take')
    Aglyn.canvas.undo()

    remote('theirs', {
      $id: 'theirs',
      componentId: 'muiTypography',
      parentId: ROOT,
      props: { children: 'their take' },
    })
    flushRemoteReconcile()

    expect(Aglyn.canvas.canRedo).toBe(true)
    Aglyn.canvas.redo()

    // Same-node last-writer-wins toward the peer (AGL-677), so this redo is
    // a NO-OP on the canvas: the step is consumed and their value stands.
    // Measured on the running editor — the tab publishes nothing at all, so
    // nothing of theirs is destroyed. Redoing your own edit onto a node
    // someone else has since taken over is what operation-based
    // collaborative undo would buy, and is still future work.
    expect(children('theirs')).toBe('their take')
    expect(Aglyn.canvas.canRedo).toBe(false)
  })
})

/**
 * AGL-2486 — the same rule, for the OTHER wholesale replace.
 *
 * `applyNodes` is what the raw-JSON editor and the local crash-recovery
 * draft (AGL-1256) push a whole map through. It had no epoch overlay, so it
 * carried the entire AGL-1958 failure mode intact: the map was composed
 * without any knowledge of a peer's later changes, and the result is diffed
 * against the co-editing shadow and published, which turns a node the map
 * happens to lack into a DELETE broadcast under this session's id.
 *
 * Reproduced on the running editor before this fix, two browser sessions on
 * one screen: the peer created a node, the other session pressed Restore,
 * and the node was gone from the peer's own canvas — with the tombstone
 * `{deleted: true}` sitting in RTDB under the restorer's session id to say
 * how.
 *
 * The draft's own map is the fixture here: a snapshot of the document as it
 * was BEFORE the peer joined, which is exactly what a crash net holds.
 */
describe('applyNodes against a co-editor (AGL-2486)', () => {
  const ROOT = Aglyn.CANVAS_ROOT_ELEMENT_ID

  /** What the draft holds: the document before any peer touched it. */
  const DRAFT = {
    [ROOT]: { $id: ROOT, componentId: 'div', nodes: ['mine', 'theirs'] },
    mine: {
      $id: 'mine',
      componentId: 'muiTypography',
      parentId: ROOT,
      props: { children: 'mine, unsaved' },
    },
    theirs: {
      $id: 'theirs',
      componentId: 'muiTypography',
      parentId: ROOT,
      props: { children: 'theirs v0' },
    },
  }

  const children = (nodeId: string): string | undefined =>
    (Aglyn.canvas.nodes.get(nodeId) as { props?: { children?: string } })?.props
      ?.children

  const remote = (nodeId: string, node: Record<string, unknown>) =>
    applyRemoteNode(nodeId, {
      by: 'peer-tab',
      at: Date.now(),
      json: JSON.stringify(node),
    })

  beforeEach(() => {
    flushRemoteReconcile()
    Aglyn.canvas.reset()
    Aglyn.canvas.setNodes(DRAFT as never)
    Aglyn.canvas.updateInitialNodes()
  })

  afterAll(() => {
    Aglyn.canvas.reset()
  })

  it('reports whether a peer has touched the canvas', () => {
    expect(Aglyn.canvas.hasRemoteEdits).toBe(false)

    remote('theirs', {
      $id: 'theirs',
      componentId: 'muiTypography',
      parentId: ROOT,
      props: { children: 'theirs v1' },
    })

    // This is the flag the draft prompt reads to stop offering Restore.
    expect(Aglyn.canvas.hasRemoteEdits).toBe(true)
    Aglyn.canvas.reset()
    expect(Aglyn.canvas.hasRemoteEdits).toBe(false)
  })

  it('keeps a node the peer CREATED, and its place in the tree', () => {
    remote('fresh', {
      $id: 'fresh',
      componentId: 'muiTypography',
      parentId: ROOT,
      props: { children: 'peer node, unsaved' },
    })
    // One peer `update()`, so the parent's new child list rides along.
    remote(ROOT, {
      $id: ROOT,
      componentId: 'div',
      nodes: ['mine', 'theirs', 'fresh'],
    })
    flushRemoteReconcile()

    Aglyn.canvas.applyNodes(DRAFT as never)

    // The draft map has no 'fresh' key at all. Before AGL-2486 the replace
    // deleted it, and the publish that follows sent {deleted: true} to the
    // person who had just created it.
    expect(Aglyn.canvas.nodes.has('fresh')).toBe(true)
    expect(children('fresh')).toBe('peer node, unsaved')
    expect(Aglyn.canvas.nodes.get(ROOT)?.nodes).toContain('fresh')
    // …and the author's own work is still restored.
    expect(children('mine')).toBe('mine, unsaved')
  })

  it('keeps a peer CHANGE to a node the draft also carries', () => {
    remote('theirs', {
      $id: 'theirs',
      componentId: 'muiTypography',
      parentId: ROOT,
      props: { children: 'theirs v1' },
    })
    flushRemoteReconcile()

    Aglyn.canvas.applyNodes(DRAFT as never)

    // Last writer wins toward the peer, the same resolution AGL-1958 chose
    // for undo rather than a second rule invented here.
    expect(children('theirs')).toBe('theirs v1')
  })

  it('does not resurrect a node the peer DELETED', () => {
    applyRemoteNode('theirs', { by: 'peer-tab', at: Date.now(), deleted: true })
    flushRemoteReconcile()
    expect(Aglyn.canvas.nodes.has('theirs')).toBe(false)

    Aglyn.canvas.applyNodes(DRAFT as never)

    // An absence is a remote state as much as a value is.
    expect(Aglyn.canvas.nodes.has('theirs')).toBe(false)
  })

  it('replaces normally when no peer has touched the canvas', () => {
    Aglyn.canvas.setNodes({
      ...DRAFT,
      extra: {
        $id: 'extra',
        componentId: 'muiTypography',
        parentId: ROOT,
        props: { children: 'added since' },
      },
    } as never)

    Aglyn.canvas.applyNodes(DRAFT as never)

    // Nothing is preserved for its own sake — a solo restore is still a
    // whole-map replace, which is what makes it a restore at all.
    expect(Aglyn.canvas.nodes.has('extra')).toBe(false)
  })
})

/**
 * The join-time admission rule and the join-time reap (AGL-1870 R4).
 *
 * These cases are the PRODUCTION rooms, measured 2026-08-20, not invented
 * fixtures: every number below came off `coedit/` on `aglyn-main`. `NOW` is
 * the moment of that measurement, so the ages here are the real ones and the
 * suite does not drift as the calendar moves.
 *
 * Zach's call, 2026-08-20: option C, reap on join by age. Option A
 * (`onDisconnect().remove()`) was rejected because a network blip would
 * silently and permanently destroy unsaved work.
 */
describe('the co-edit mirror cutoff (AGL-1870 R4: reap on join by age)', () => {
  const at = (iso: string) => new Date(iso).getTime()
  /** What a live client-SDK `Timestamp` looks like to `versionStamp`. */
  const stamp = (iso: string) => ({ toMillis: () => at(iso) })
  /** When production was measured. Every age below is relative to this. */
  const NOW = at('2026-08-20T16:04:00Z')

  describe('what a joiner replays', () => {
    it('refuses an entry older than the last save', () => {
      // Production: 2 rooms, 353 of the 383 entries, 136 KiB — published a
      // minute BEFORE the save that folded them in. Downloaded on every join
      // and then discarded.
      const floor = mirrorFloorMillis(stamp('2026-08-05T05:43:00Z'))
      expect(
        isMirrorEntryLive({ at: at('2026-08-05T05:42:00Z') }, floor, NOW),
      ).toBe(false)
    })

    it('still replays unsaved work from a tab that closed days ago', () => {
      // Production: saved 2026-08-13, one entry from 2026-08-18 (+4.7 days),
      // 2.5 days old at measurement. THIS is the room the cutoff is chosen to
      // keep — a tab closed on Friday still replays on Monday. Reaping it is
      // what option A would have done, and is a different product.
      const floor = mirrorFloorMillis(stamp('2026-08-13T09:00:00Z'))
      expect(
        isMirrorEntryLive({ at: at('2026-08-18T00:00:00Z') }, floor, NOW),
      ).toBe(true)
    })

    it('no longer replays work abandoned three weeks ago', () => {
      // Production: saved 2026-07-13, two entries from 2026-08-05 (+22.8 days
      // after the save, 15.4 days old at measurement). Before R4 the next
      // person to open that version had this applied to their canvas. It is
      // now refused on the way in, and reaped.
      const floor = mirrorFloorMillis(stamp('2026-07-13T06:09:00Z'))
      expect(
        isMirrorEntryLive({ at: at('2026-08-05T01:57:04Z') }, floor, NOW),
      ).toBe(false)
    })

    it('admits the leftover every save leaves behind, at the floor exactly', () => {
      // Production: 12 rooms holding exactly one entry stamped at or just
      // after the save meant to clear them. The lower boundary is inclusive —
      // an entry written in the same millisecond as the save is live.
      const floor = mirrorFloorMillis(stamp('2026-08-20T12:00:00Z'))
      expect(isMirrorEntryLive({ at: floor }, floor, NOW)).toBe(true)
      expect(isMirrorEntryLive({ at: floor - 1 }, floor, NOW)).toBe(false)
    })

    it('holds the upper boundary to the millisecond', () => {
      // Both sides of seven days, with no floor in the way, so this asserts
      // the age bound alone. Exactly the cutoff is refused; one millisecond
      // inside it is admitted.
      const old = NOW - COEDIT_MIRROR_MAX_AGE_MS
      expect(isMirrorEntryLive({ at: old }, 0, NOW)).toBe(false)
      expect(isMirrorEntryLive({ at: old + 1 }, 0, NOW)).toBe(true)
    })

    it('bounds a never-saved document by age even with no floor', () => {
      // No stamp means no floor, so the lower bound admits everything. Before
      // R4 that meant a never-saved document replayed its whole room however
      // old; the age bound is now the only thing standing there.
      expect(mirrorFloorMillis(undefined)).toBe(0)
      expect(isMirrorEntryLive({ at: NOW - 1000 }, 0, NOW)).toBe(true)
      expect(isMirrorEntryLive({ at: at('2020-01-01T00:00:00Z') }, 0, NOW)).toBe(
        false,
      )
    })

    it('treats a missing `at` as the oldest possible entry', () => {
      const floor = mirrorFloorMillis(stamp('2026-08-12T22:57:17Z'))
      expect(isMirrorEntryLive({}, floor, NOW)).toBe(false)
      // And with no floor either, the age bound still refuses it.
      expect(isMirrorEntryLive({}, 0, NOW)).toBe(false)
    })

    /**
     * The lower bound is disabled — silently — by any stamp shape that is not
     * `ms:`. A `{seconds, nanoseconds}` object is what a Firestore timestamp
     * becomes once it crosses an RSC boundary, and it yields floor 0, which
     * admits the whole room including the 353 entries the `ms:` form refuses.
     * All five call sites pass a live `Timestamp` today; this is the guard on
     * that staying true. R4 does not fix it — but note that the reaper reads
     * age only, so it keeps working on a room whose floor has collapsed.
     */
    it('yields NO floor for the serialized timestamp shape', () => {
      expect(mirrorFloorMillis({ seconds: 1_754_365_380, nanoseconds: 0 })).toBe(
        0,
      )
      expect(mirrorFloorMillis('2026-08-05T05:43:00Z')).toBe(0)
      // The live shape, by contrast, does produce one.
      expect(mirrorFloorMillis(stamp('2026-08-05T05:43:00Z'))).toBeGreaterThan(0)
    })
  })

  describe('what a joiner reaps', () => {
    it('reaps the pre-AGL-1262 residue and leaves the recent room alone', () => {
      // The whole production corpus in miniature, by entry age at measurement:
      // the 353-entry residue and the two multi-week abandoned rooms are 15.3
      // to 15.4 days old; the one recent abandoned edit is 2.5 days; the
      // save-time leftovers are minutes.
      const room = {
        residue: { at: at('2026-08-05T05:42:00Z') },
        abandonedJuly: { at: at('2026-08-05T01:57:04Z') },
        abandonedAugust: { at: at('2026-08-18T00:00:00Z') },
        saveLeftover: { at: at('2026-08-20T12:00:00Z') },
      }
      expect(reapableMirrorEntryIds(room, NOW).sort()).toEqual([
        'abandonedJuly',
        'residue',
      ])
    })

    it('holds the same boundary the admission rule does, to the millisecond', () => {
      const old = NOW - COEDIT_MIRROR_MAX_AGE_MS
      expect(
        reapableMirrorEntryIds({ a: { at: old }, b: { at: old + 1 } }, NOW),
      ).toEqual(['a'])
    })

    it('reaps exactly what the admission rule refuses on age, never more', () => {
      // The safety property: nothing a joiner would still apply is deleted.
      // If these two ever disagree, a joiner applies an entry and then deletes
      // it, laundering abandoned work into the next save.
      const room: Record<string, { at?: number }> = {}
      for (let days = 0; days <= 20; days += 1) {
        room[`d${days}`] = { at: NOW - days * 24 * 60 * 60 * 1000 }
      }
      room.noStamp = {}
      const reaped = new Set(reapableMirrorEntryIds(room, NOW))
      for (const [id, entry] of Object.entries(room)) {
        // Floor 0, so admission turns on age alone.
        expect(reaped.has(id)).toBe(!isMirrorEntryLive(entry, 0, NOW))
      }
      expect(reaped.size).toBe(15)
    })

    it('reaps nothing from an empty or absent room', () => {
      expect(reapableMirrorEntryIds({}, NOW)).toEqual([])
      expect(reapableMirrorEntryIds(null, NOW)).toEqual([])
      expect(reapableMirrorEntryIds(undefined, NOW)).toEqual([])
    })
  })
})
