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

import {
  collectNodeInteractions,
  walkInteractionNodes,
  NODE_MAX_INTERACTIONS,
  nodeIdFromInteractionSelector,
  nodeInteractionId,
  nodeInteractionSelector,
  parseNodeInteractionId,
  removeNodeInteraction,
  upsertNodeInteraction,
  type InteractionNode,
  type NodeInteraction,
} from './node-interactions'

const hover = (id: string): NodeInteraction => ({
  id,
  name: 'Open on hover',
  trigger: { event: 'elementHoverEnter', everyTime: true },
  steps: [{ type: 'openMenu' } as never],
})

describe('collectNodeInteractions', () => {
  it('stamps the selector from the node that owns the interaction', () => {
    const nodes: InteractionNode[] = [
      { $id: 'trigger', interactions: [hover('a')] },
    ]
    const [collected] = collectNodeInteractions(nodes)
    expect(collected.action.trigger.selector).toBe(
      nodeInteractionSelector('trigger'),
    )
  })

  /**
   * The whole reason the storage moved. A stored selector is a second name
   * for the element that can disagree with the first — a duplicated node
   * would carry one still naming the original, and drive someone else's
   * button.
   */
  it('ignores a selector that somehow got persisted, and derives its own', () => {
    const nodes: InteractionNode[] = [
      {
        $id: 'copy',
        interactions: [
          {
            ...hover('a'),
            trigger: {
              ...hover('a').trigger,
              selector: '[data-aglyn="leaf:original"]',
            } as never,
          },
        ],
      },
    ]
    const [collected] = collectNodeInteractions(nodes)
    expect(collected.action.trigger.selector).toBe(
      nodeInteractionSelector('copy'),
    )
  })

  it('namespaces the id, so two copies of one preset do not collide', () => {
    const nodes: InteractionNode[] = [
      { $id: 'one', interactions: [hover('open')] },
      { $id: 'two', interactions: [hover('open')] },
    ]
    const ids = collectNodeInteractions(nodes).map((entry) => entry.id)
    expect(ids).toEqual(['node:one:open', 'node:two:open'])
    expect(new Set(ids).size).toBe(2)
  })

  it('keeps document order, the only order an author can predict', () => {
    const nodes: InteractionNode[] = [
      { $id: 'first', interactions: [hover('a')] },
      { $id: 'second', interactions: [hover('b'), hover('c')] },
    ]
    expect(collectNodeInteractions(nodes).map((e) => e.id)).toEqual([
      'node:first:a',
      'node:second:b',
      'node:second:c',
    ])
  })

  /**
   * The compiler downstream is the one place that decides what runs, because
   * it is also where the plan trims happen. Two places deciding is how a step
   * gets dropped for a reason nobody can find.
   */
  it('keeps a disabled interaction for the compiler to judge', () => {
    const nodes: InteractionNode[] = [
      { $id: 'n', interactions: [{ ...hover('a'), enabled: false }] },
    ]
    expect(collectNodeInteractions(nodes)).toHaveLength(1)
    expect(collectNodeInteractions(nodes)[0].action.enabled).toBe(false)
  })

  it('skips nodes with nothing to contribute rather than throwing', () => {
    const nodes = [
      null,
      undefined,
      {},
      { $id: 'n' },
      { $id: 'n', interactions: null },
      { $id: '', interactions: [hover('a')] },
      // An entry with no trigger event has nothing to enrol on.
      { $id: 'n2', interactions: [{ ...hover('a'), trigger: {} } as never] },
    ] as InteractionNode[]
    expect(collectNodeInteractions(nodes)).toEqual([])
  })

  it('caps what one element can carry', () => {
    const many = Array.from({ length: NODE_MAX_INTERACTIONS + 5 }, (_, i) =>
      hover(`i${i}`),
    )
    expect(
      collectNodeInteractions([{ $id: 'n', interactions: many }]),
    ).toHaveLength(NODE_MAX_INTERACTIONS)
  })
})

describe('upsertNodeInteraction / removeNodeInteraction', () => {
  it('appends a new one and never mutates the list it was given', () => {
    const start: NodeInteraction[] = [hover('a')]
    const next = upsertNodeInteraction(start, hover('b'))
    expect(next.map((e) => e.id)).toEqual(['a', 'b'])
    expect(start).toHaveLength(1)
  })

  it('replaces in place, so an edit does not append a duplicate', () => {
    const start = [hover('a'), hover('b')]
    const edited = { ...hover('a'), name: 'Renamed' }
    const next = upsertNodeInteraction(start, edited)
    expect(next.map((e) => e.id)).toEqual(['a', 'b'])
    expect(next[0].name).toBe('Renamed')
  })

  it('will not append past the cap', () => {
    const full = Array.from({ length: NODE_MAX_INTERACTIONS }, (_, i) =>
      hover(`i${i}`),
    )
    expect(upsertNodeInteraction(full, hover('extra'))).toHaveLength(
      NODE_MAX_INTERACTIONS,
    )
    // An EDIT to one already there still lands, cap or no cap.
    const edited = { ...hover('i0'), name: 'Renamed' }
    expect(upsertNodeInteraction(full, edited)[0].name).toBe('Renamed')
  })

  it('removes by id and starts from empty when there is nothing', () => {
    expect(removeNodeInteraction([hover('a'), hover('b')], 'a')).toHaveLength(1)
    expect(removeNodeInteraction(undefined, 'a')).toEqual([])
  })
})

describe('walkInteractionNodes', () => {
  const tree = {
    $id: 'root',
    nodes: [
      { $id: 'a', interactions: [hover('x')], nodes: [{ $id: 'a1' }] },
      { $id: 'b', nodes: [] },
      null,
      'not-a-node',
    ],
  } as never

  it('yields parents before children, depth first', () => {
    expect([...walkInteractionNodes(tree)].map((n) => n.$id)).toEqual([
      'root',
      'a',
      'a1',
      'b',
    ])
  })

  it('answers nothing for a missing tree rather than throwing', () => {
    expect([...walkInteractionNodes(null)]).toEqual([])
    expect([...walkInteractionNodes(undefined)]).toEqual([])
  })

  /**
   * A normalized tree holds child IDs, not children. There is nothing to
   * follow, and guessing at a lookup table this module does not have would be
   * worse than answering honestly.
   */
  it('yields only the root of a normalized tree', () => {
    const normalized = { $id: 'root', nodes: ['a', 'b'] } as never
    expect([...walkInteractionNodes(normalized)].map((n) => n.$id)).toEqual([
      'root',
    ])
  })

  it('feeds the collector, which is the whole point', () => {
    const collected = collectNodeInteractions(walkInteractionNodes(tree))
    expect(collected.map((entry) => entry.id)).toEqual(['node:a:x'])
  })
})

describe('the id says where the interaction lives', () => {
  it('round-trips a node and an interaction id', () => {
    const id = nodeInteractionId('leaf-1', 'open')
    expect(parseNodeInteractionId(id)).toEqual({
      nodeId: 'leaf-1',
      interactionId: 'open',
    })
  })

  it('keeps a colon inside the interaction id', () => {
    expect(parseNodeInteractionId(nodeInteractionId('n', 'a:b'))).toEqual({
      nodeId: 'n',
      interactionId: 'a:b',
    })
  })

  /**
   * Every surface that toggles, edits or deletes is handed an id and nothing
   * else, and there are two stores now. A host action id must never parse as
   * a node one, or the migration writes into the wrong place.
   */
  it('answers null for a host action id, however it is shaped', () => {
    for (const id of ['abc123', '', 'node:', 'node:n', 'node:n:', 'node::x']) {
      expect(parseNodeInteractionId(id)).toBeNull()
    }
    expect(parseNodeInteractionId(undefined)).toBeNull()
  })

  it('reads the node back out of a derived selector', () => {
    expect(
      nodeIdFromInteractionSelector(nodeInteractionSelector('leaf-1')),
    ).toBe('leaf-1')
    for (const selector of ['', '.promo', '[data-aglyn="leaf:"]', undefined]) {
      expect(nodeIdFromInteractionSelector(selector)).toBeUndefined()
    }
  })
})
