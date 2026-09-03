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

import { CANVAS_ROOT_ELEMENT_ID as ROOT } from '../foundation/constants/canvas'
import { clearCanvasNodes, repairCanvasNodes } from './repair-canvas-nodes'

function doc(extra: Record<string, any> = {}, rootChildren: string[] = []) {
  return {
    [ROOT]: { $id: ROOT, componentId: 'div', parentId: null, nodes: rootChildren },
    ...extra,
  }
}

const node = (id: string, parentId: string, nodes: string[] = []) => ({
  $id: id,
  componentId: 'muiTypography',
  parentId,
  nodes,
})

describe('repairCanvasNodes', () => {
  it('leaves a sound document alone and says so', () => {
    const source = doc({ a: node('a', ROOT) }, ['a'])

    const result = repairCanvasNodes(source)

    expect(result.healthy).toBe(true)
    expect(result.findings).toEqual([])
    expect(result.removed).toEqual([])
    expect(result.kept).toBe(1)
    expect(Object.keys(result.nodes).sort()).toEqual([ROOT, 'a'].sort())
  })

  /**
   * The reported symptom: `node-tree-view` prints the literal string
   * `'Invalid node'` for every child id that resolves to nothing. The PARENT
   * is fine, so only the stale id goes.
   */
  it("drops the child ids that render as 'Invalid node', keeping the parent", () => {
    const source = doc({ a: node('a', ROOT, ['ghost', 'b']), b: node('b', 'a') }, ['a'])

    const result = repairCanvasNodes(source)

    expect(result.nodes['a'].nodes).toEqual(['b'])
    expect(result.nodes['b']).toBeDefined()
    expect(result.removed).toEqual([])
    expect(result.findings).toContainEqual(
      expect.objectContaining({ nodeId: 'ghost', kind: 'dangling-child', action: 'unlinked' }),
    )
  })

  it('removes an entry that is not a node at all', () => {
    const source = doc({ a: null as any, b: node('b', ROOT) }, ['a', 'b'])

    const result = repairCanvasNodes(source)

    expect(result.removed).toContain('a')
    expect(result.nodes['b']).toBeDefined()
    expect(result.nodes[ROOT].nodes).toEqual(['b'])
  })

  it('removes a node with no element type', () => {
    const source = doc({ a: { $id: 'a', parentId: ROOT, nodes: [] } as any }, ['a'])

    expect(repairCanvasNodes(source).removed).toEqual(['a'])
  })

  it('takes the subtree of anything it removes', () => {
    const source = doc(
      { a: { $id: 'a', parentId: ROOT, nodes: ['b'] } as any, b: node('b', 'a', ['c']), c: node('c', 'b') },
      ['a'],
    )

    const result = repairCanvasNodes(source)

    expect(result.removed.sort()).toEqual(['a', 'b', 'c'])
    expect(result.kept).toBe(0)
  })

  /**
   * Only when the caller supplies a resolver it trusts — a registry that has
   * not finished loading answers "no" for everything, and a repair that
   * believed it would delete the document.
   */
  it('removes an unresolvable component only when asked to check', () => {
    const source = doc({ a: { ...node('a', ROOT), componentId: 'ghostPlugin' } }, ['a'])

    expect(repairCanvasNodes(source).removed).toEqual([])
    expect(
      repairCanvasNodes(source, { isKnownComponent: (id) => id !== 'ghostPlugin' }).removed,
    ).toEqual(['a'])
  })

  it('adopts an orphan rather than dropping its subtree', () => {
    const source = doc({ a: node('a', 'gone', ['b']), b: node('b', 'a') }, [])

    const result = repairCanvasNodes(source)

    expect(result.removed).toEqual([])
    expect(result.nodes['a'].parentId).toBe(ROOT)
    expect(result.nodes[ROOT].nodes).toContain('a')
    expect(result.nodes['b'].parentId).toBe('a')
    expect(result.reparented).toContain('a')
  })

  /** A loop hangs the tab rather than degrading the UI — see the docblock. */
  it('breaks a parent cycle', () => {
    const source = doc({ a: node('a', 'b', ['b']), b: node('b', 'a', ['a']) }, [])

    const result = repairCanvasNodes(source)

    expect(result.findings.some((f) => f.kind === 'cycle')).toBe(true)
    expect(result.nodes[ROOT].nodes.length).toBeGreaterThan(0)
    // Every node can now walk to the root in finite steps.
    for (const id of Object.keys(result.nodes)) {
      let cursor = id
      let steps = 0
      while (cursor !== ROOT && steps++ < 10) cursor = result.nodes[cursor].parentId
      expect(cursor).toBe(ROOT)
    }
  })

  /**
   * AGL-1363 found 61 of these on `/product`, 26 carrying the only copy of
   * two Hero sections' text. Invisible and still shipped, so they are shown
   * rather than deleted.
   */
  it('surfaces an unreachable node instead of dropping it', () => {
    const source = doc({ a: node('a', ROOT), lost: node('lost', ROOT) }, ['a'])

    const result = repairCanvasNodes(source)

    expect(result.removed).toEqual([])
    expect(result.nodes[ROOT].nodes).toContain('lost')
    expect(result.findings.some((f) => f.nodeId === 'lost')).toBe(true)
  })

  it('relists a node its parent forgot', () => {
    const source = doc({ a: node('a', ROOT, []), b: node('b', 'a') }, ['a'])

    const result = repairCanvasNodes(source)

    expect(result.nodes['a'].nodes).toEqual(['b'])
    expect(result.findings).toContainEqual(
      expect.objectContaining({ nodeId: 'b', kind: 'unlisted', action: 'relisted' }),
    )
  })

  it('gives a rootless map a root, as ensureCanvasRoot does', () => {
    const result = repairCanvasNodes({ a: node('a', 'nope') })

    expect(result.nodes[ROOT]).toBeDefined()
    expect(result.nodes['a'].parentId).toBe(ROOT)
  })

  it('does not mutate the map it was given', () => {
    const source = doc({ a: node('a', ROOT, ['ghost']) }, ['a'])

    repairCanvasNodes(source)

    expect(source['a'].nodes).toEqual(['ghost'])
  })
})

describe('clearCanvasNodes', () => {
  it('empties the document and keeps the root as it was', () => {
    const source = doc(
      { [ROOT]: { $id: ROOT, componentId: 'div', parentId: null, nodes: ['a'], sx: { p: 4 } }, a: node('a', ROOT) },
      [],
    )

    const cleared = clearCanvasNodes(source)

    expect(Object.keys(cleared)).toEqual([ROOT])
    expect(cleared[ROOT].nodes).toEqual([])
    expect(cleared[ROOT].sx).toEqual({ p: 4 })
  })

  /** The case that needs it most: a tree the hierarchy cannot render. */
  it('clears a document that has no usable root', () => {
    const cleared = clearCanvasNodes({ a: null as any, b: { junk: true } as any })

    expect(Object.keys(cleared)).toEqual([ROOT])
    expect(cleared[ROOT].nodes).toEqual([])
  })

  it('clears an empty map', () => {
    expect(Object.keys(clearCanvasNodes(undefined))).toEqual([ROOT])
  })
})
