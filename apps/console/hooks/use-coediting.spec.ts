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
import { applyRemoteNode } from './use-coediting'

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
