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
  applyRemoteNode,
  flushRemoteReconcile,
  isMirrorEntryLive,
  mirrorFloorMillis,
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
 * The join-time admission rule (AGL-1870 R4).
 *
 * These cases are the PRODUCTION rooms, measured 2026-08-20, not invented
 * fixtures: every number below came off `coedit/` on `aglyn-main`. They pin
 * what the mirror does today so that whichever way the R4 product call goes —
 * reap on disconnect, reap on a timer, or leave it — the change shows up here
 * as a red rather than as a silent shift in which unsaved work survives.
 */
describe('isMirrorEntryLive (AGL-1870 R4: what a joiner replays)', () => {
  const at = (iso: string) => new Date(iso).getTime()
  /** What a live client-SDK `Timestamp` looks like to `versionStamp`. */
  const stamp = (iso: string) => ({ toMillis: () => at(iso) })

  it('refuses an entry older than the last save', () => {
    // Production: 2 rooms, 353 of the 383 entries, 136 KiB — published a
    // minute BEFORE the save that folded them in. Downloaded on every join
    // and then discarded, for ever, because nothing reaps them.
    const floor = mirrorFloorMillis(stamp('2026-08-05T05:43:00Z'))
    expect(
      isMirrorEntryLive({ at: at('2026-08-05T05:42:00Z') }, floor),
    ).toBe(false)
  })

  it('admits genuinely unsaved work three weeks after the last save', () => {
    // Production: saved 2026-07-13, two entries from 2026-08-05 (+22.8 days)
    // from a tab that closed without saving. The next person to open that
    // version has them applied. This is the case the R4 call is about.
    const floor = mirrorFloorMillis(stamp('2026-07-13T06:09:00Z'))
    expect(
      isMirrorEntryLive({ at: at('2026-08-05T01:57:04Z') }, floor),
    ).toBe(true)
  })

  it('admits the leftover every save leaves behind, at the floor exactly', () => {
    // Production: 12 rooms holding exactly one entry stamped at or just after
    // the save meant to clear them. The boundary is inclusive — an entry
    // written in the same millisecond as the save is live, not stale.
    const floor = mirrorFloorMillis(stamp('2026-08-12T22:57:17Z'))
    expect(isMirrorEntryLive({ at: floor }, floor)).toBe(true)
    expect(isMirrorEntryLive({ at: floor - 1 }, floor)).toBe(false)
  })

  it('admits everything when the document has never been saved', () => {
    // No stamp means no floor, so a never-saved document replays its whole
    // room. Correct today — there is no saved state to be older than — but it
    // is also the widest the rule ever gets.
    expect(mirrorFloorMillis(undefined)).toBe(0)
    expect(isMirrorEntryLive({ at: at('2020-01-01T00:00:00Z') }, 0)).toBe(true)
  })

  it('treats a missing `at` as the oldest possible entry', () => {
    const floor = mirrorFloorMillis(stamp('2026-08-12T22:57:17Z'))
    expect(isMirrorEntryLive({}, floor)).toBe(false)
  })

  /**
   * The filter is disabled — silently — by any stamp shape that is not
   * `ms:`. A `{seconds, nanoseconds}` object is what a Firestore timestamp
   * becomes once it crosses an RSC boundary, and it yields floor 0, which
   * admits the whole room including the 353 entries the `ms:` form refuses.
   * All five call sites pass a live `Timestamp` today; this is the guard on
   * that staying true.
   */
  it('yields NO floor for the serialized timestamp shape', () => {
    expect(mirrorFloorMillis({ seconds: 1_754_365_380, nanoseconds: 0 })).toBe(0)
    expect(mirrorFloorMillis('2026-08-05T05:43:00Z')).toBe(0)
    // The live shape, by contrast, does produce one.
    expect(mirrorFloorMillis(stamp('2026-08-05T05:43:00Z'))).toBeGreaterThan(0)
  })
})
