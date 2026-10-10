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
  expandRepeatables,
  hasRepeatableNodes,
  repeatKeys,
} from './expand-repeatables'

const baseNodes = () =>
  ({
    root: { $id: 'root', componentId: 'div', nodes: ['list'] },
    list: {
      $id: 'list',
      componentId: 'muiStack',
      props: { repeatDataset: 'Team' },
      nodes: ['row'],
    },
    row: {
      $id: 'row',
      componentId: 'muiStack',
      parentId: 'list',
      props: { direction: 'row' },
      nodes: ['label'],
    },
    label: {
      $id: 'label',
      componentId: 'muiTypography',
      parentId: 'row',
      props: { children: '{{item.name}} — {{item.role}}' },
    },
  }) as any

const team = {
  records: [
    { name: 'Ada', role: 'Engineer' },
    { name: 'Grace', role: 'Admiral' },
  ],
}

describe('expandRepeatables reference hops (AGL-180)', () => {
  it('resolves {{item.ref.field}} through the target dataset', () => {
    const nodes = baseNodes()
    nodes['label'].props.children = '{{item.name}} by {{item.author.name}}'
    const posts = {
      records: [{ $id: 'p1', name: 'Hello', author: 'a1' }],
      // The rows' references, as the plugin keeping them states them: the
      // `author` field points into the rows answered under `authors`.
      model: { references: { author: 'authors' } },
    } as any
    const authors = {
      records: [{ $id: 'a1', name: 'Ada' }],
    } as any
    const result = expandRepeatables(nodes, { Team: posts, authors })
    const list = result['list'] as any
    const label = (result[(result[list.nodes[0]] as any).$id] as any).nodes[0]
    expect((result[label] as any).props.children).toBe('Hello by Ada')
  })

  it('resolves multi-reference arrays and prints nothing for an unknown hop', () => {
    const nodes = baseNodes()
    nodes['label'].props.children = '{{item.tags.name}} / {{item.ghost.name}}'
    const posts = {
      records: [{ $id: 'p1', tags: ['t1', 't2'] }],
      model: { references: { tags: 'tags' } },
    } as any
    const tags = {
      records: [
        { $id: 't1', name: 'red' },
        { $id: 't2', name: 'blue' },
      ],
    } as any
    const result = expandRepeatables(nodes, { Team: posts, tags })
    const list = result['list'] as any
    const label = (result[list.nodes[0]] as any).nodes[0]
    expect((result[label] as any).props.children).toBe(
      'red, blue / ',
    )
  })
})

describe('expandRepeatables', () => {
  it('clones the template per record with item tokens substituted', () => {
    const result = expandRepeatables(baseNodes(), { Team: team })
    const list = result['list'] as any
    expect(list.nodes).toHaveLength(2)
    const [first, second] = list.nodes
    expect((result[first] as any).parentId).toBe('list')
    const firstLabel = (result[first] as any).nodes[0]
    expect((result[firstLabel] as any).props.children).toBe('Ada — Engineer')
    const secondLabel = (result[second] as any).nodes[0]
    expect((result[secondLabel] as any).props.children).toBe(
      'Grace — Admiral',
    )
    // Non-repeated props survive the clone.
    expect((result[first] as any).props.direction).toBe('row')
  })

  it('honors repeatLimit and prints nothing for a field the record lacks (AGL-3616)', () => {
    const nodes = baseNodes()
    nodes.list.props.repeatLimit = 1
    nodes.label.props.children = '{{item.name}} ({{item.missing}})'
    const result = expandRepeatables(nodes, { Team: team })
    const list = result['list'] as any
    expect(list.nodes).toHaveLength(1)
    const label = (result[(result[list.nodes[0]] as any).nodes[0]] as any)
    expect(label.props.children).toBe('Ada ()')
  })

  /**
   * AGL-3616: low-tide-hollow.aglyn.app's tour dates drew `{{ITEM.VENUE}}`
   * as each card's eyebrow — its records name no venue yet. An element that
   * is only a binding its record leaves empty is left out of that copy; a
   * record that fills the field still draws it.
   */
  it('leaves out an element whose whole text is a binding the record leaves empty', () => {
    const nodes = baseNodes()
    nodes.row.nodes = ['kicker', 'label']
    nodes.kicker = {
      $id: 'kicker',
      componentId: 'muiTypography',
      parentId: 'row',
      props: { children: ' {{item.venue}} ', variant: 'overline' },
    }
    nodes.label.props.children = '{{item.name}}'
    const shows = {
      records: [
        { name: 'Asheville show', venue: '' },
        { name: 'Durham show' },
        { name: 'Boone show', venue: 'The Hollow' },
      ],
    }
    const result = expandRepeatables(nodes, { Team: shows }) as any
    const rows = result.list.nodes.map((id: string) => result[id])
    const texts = rows.map((row: any) =>
      row.nodes.map((id: string) => result[id].props.children),
    )
    expect(texts).toEqual([
      // An empty string is a value the record holds: printed as nothing, and
      // the element left out all the same.
      ['Asheville show'],
      ['Durham show'],
      [' The Hollow ', 'Boone show'],
    ])
    expect(JSON.stringify(rows.map((row: any) => row.nodes.map((id: string) => result[id])))).not.toContain('{{')
    expect(result['rep__list__0__kicker']).toBeUndefined()
    expect(result['rep__list__2__kicker'].parentId).toBe('rep__list__2__row')
  })

  it('leaves out a self-scoped copy whose whole text is an empty binding', () => {
    const nodes = {
      root: { $id: 'root', componentId: 'div', nodes: ['tag'] },
      tag: {
        $id: 'tag',
        componentId: 'muiTypography',
        parentId: 'root',
        props: { repeatDataset: 'Team', children: '{{item.role}}' },
      },
    } as any
    const result = expandRepeatables(nodes, {
      Team: { records: [{ name: 'Ada' }, { name: 'Grace', role: 'Admiral' }] },
    }) as any
    expect(result.root.nodes).toEqual(['rep__tag__1__tag'])
    expect(result['rep__tag__1__tag'].props.children).toBe('Admiral')
  })

  /**
   * AGL-3496: a repeat with nothing to render publishes NOTHING. Drawn as
   * written, its template is `{{item.name}} — {{item.role}}` on a customer's
   * live page — the broken card edr-construction.aglyn.app/services showed.
   */
  it('renders zero copies for an unknown dataset, no records, or no rows map', () => {
    for (const rows of [{ Other: team }, { Team: { records: [] } }, {}, undefined]) {
      const result = expandRepeatables(baseNodes(), rows)
      const list = result['list'] as any
      expect(list.nodes).toEqual([])
      // The element stays — the frame the author placed — minus its directive.
      expect(list.props).toEqual({})
      expect(result['root']).toEqual(baseNodes()['root'])
    }
  })

  it('renders zero copies when the filter matches nothing', () => {
    const nodes = baseNodes()
    nodes.list.props.repeatFilter = 'role == Pilot'
    const result = expandRepeatables(nodes, { Team: team })
    expect((result['list'] as any).nodes).toEqual([])
    const printed = JSON.stringify(
      (result['list'] as any).nodes.map((id: string) => result[id]),
    )
    expect(printed).not.toContain('{{item.')
  })
})

/**
 * AGL-1440: the predicate that decides whether the datasets read is worth
 * paying for.
 *
 * The tenant compose pipeline fetched every dataset and up to 100 records EACH
 * on every render of every path — up to 5,050 reads — and then handed them to
 * `expandRepeatables`, which returns its input untouched when no node carries
 * `repeatDataset`. So the gate has to be the SAME question `expandRepeatables`
 * asks, or the saving is bought with a page that silently loses its rows.
 *
 * It is exported and used by `expandRepeatables` itself for exactly that
 * reason: two copies of "is this node a repeatable" is how a `.trim()` on one
 * side and not the other becomes an empty list on a customer's page.
 */
describe('hasRepeatableNodes (AGL-1440)', () => {
  it('is true for the tree expandRepeatables would expand', () => {
    expect(hasRepeatableNodes(baseNodes())).toBe(true)
  })

  it('is false for a tree with no repeatDataset anywhere', () => {
    const nodes = baseNodes()
    delete nodes.list.props.repeatDataset
    expect(hasRepeatableNodes(nodes)).toBe(false)
  })

  it('agrees with expandRepeatables on every shape it refuses', () => {
    // The property that makes the gate safe: whenever the predicate says no,
    // expanding with the full dataset map is a no-op. A `repeatDataset` that is
    // blank, whitespace, or not a string is one of those shapes — and each is a
    // way for the two sides to drift apart.
    for (const repeatDataset of ['', '   ', 42, null, undefined, {}]) {
      const nodes = baseNodes()
      nodes.list.props.repeatDataset = repeatDataset
      expect(hasRepeatableNodes(nodes)).toBe(false)
      expect(expandRepeatables(nodes, { Team: team })).toEqual(nodes)
    }
  })

  it('says yes to every repeat the expansion would EMPTY, too (AGL-3496)', () => {
    // A padded key with no rows behind it: the gate must still send it to the
    // expansion, which renders it zero times. Refused here, it would be
    // published as its template, `{{item.*}}` tokens and all.
    const nodes = baseNodes()
    nodes.list.props.repeatDataset = '  Team  '
    expect(hasRepeatableNodes(nodes)).toBe(true)
    expect(repeatKeys(nodes)).toEqual(['Team'])
    expect((expandRepeatables(nodes, {})['list'] as any).nodes).toEqual([])
  })

  it('finds a repeatable grafted in from a reusable component or layout', () => {
    // The gate runs over the COMPOSED tree, not the screen document, because a
    // repeatable can arrive from a layout or a reusable component. A predicate
    // that only looked at the screen would drop those pages' rows.
    const grafted = {
      root: { $id: 'root', componentId: 'div', nodes: ['graft'] },
      graft: {
        $id: 'graft',
        componentId: 'muiStack',
        props: { repeatDataset: 'Team' },
        nodes: [],
      },
    } as any
    expect(hasRepeatableNodes(grafted)).toBe(true)
  })

  it('tolerates an empty or malformed node map', () => {
    expect(hasRepeatableNodes({})).toBe(false)
    expect(hasRepeatableNodes({ a: null } as any)).toBe(false)
    expect(hasRepeatableNodes(undefined as any)).toBe(false)
  })
})

/**
 * The keys the tenant compose reads (AGL-2773): a page loads the datasets it
 * repeats over, by the key each repeat names, so this must return exactly the
 * keys `expandRepeatables` will look up — no more, which costs a read, and no
 * fewer, which renders a template row where the author put a list.
 */
describe('repeatKeys', () => {
  it('names each repeated dataset once, trimmed and sorted', () => {
    const nodes = {
      root: { $id: 'root', componentId: 'div', nodes: ['a', 'b', 'c'] },
      a: { $id: 'a', componentId: 'muiStack', props: { repeatDataset: 'Team' } },
      b: { $id: 'b', componentId: 'muiStack', props: { repeatDataset: ' Menu ' } },
      c: { $id: 'c', componentId: 'muiStack', props: { repeatDataset: 'Team' } },
    } as any
    expect(repeatKeys(nodes)).toEqual(['Menu', 'Team'])
  })

  it('names nothing for every shape expandRepeatables refuses', () => {
    for (const repeatDataset of ['', '   ', 42, null, undefined, {}]) {
      const nodes = baseNodes()
      nodes.list.props.repeatDataset = repeatDataset
      expect(repeatKeys(nodes)).toEqual([])
    }
  })

  it('agrees with hasRepeatableNodes on the tree it is given', () => {
    expect(repeatKeys(baseNodes()).length > 0).toBe(
      hasRepeatableNodes(baseNodes()),
    )
  })

  it('tolerates an empty or malformed node map', () => {
    expect(repeatKeys({})).toEqual([])
    expect(repeatKeys({ a: null } as any)).toEqual([])
    expect(repeatKeys(undefined)).toEqual([])
  })
})
