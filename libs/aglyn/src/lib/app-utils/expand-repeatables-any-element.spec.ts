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

/**
 * Any element repeats, not only a Stack (AGL-3111).
 *
 * The first describe is the one that may never go green by being rewritten:
 * it is the shape a published page is storing today, read out of production
 * Firestore, and it has to render exactly what it rendered before a repeat
 * was a generic capability.
 */

import {
  expandRepeatables,
  REPEAT_SELF_PROP,
  repeatScope,
  repeatedRecords,
} from './expand-repeatables'

const team = {
  records: [
    { $id: 'r1', name: 'Ada', role: 'Engineer' },
    { $id: 'r2', name: 'Grace', role: 'Admiral' },
    { $id: 'r3', name: 'Katherine', role: 'Mathematician' },
  ],
}

/**
 * The one repeat stored across production hosts, on the demo site's screen
 * `TyE-9na1Ku` (`hosts/-MtN17_cpfPPLwWjE6z4`): a `muiStack` carrying only
 * `repeatDataset`, naming the dataset by its DISPLAY NAME rather than its id,
 * with four children and no limit, filter or sort. Trimmed to the fields the
 * expansion reads; the ids are the stored ones.
 */
const storedStackRepeat = () =>
  ({
    kw8GEY3zyB: {
      $id: 'kw8GEY3zyB',
      parentId: '_@_',
      componentId: 'muiContainer',
      nodes: ['sample-element-1', 'sample-element-3', 'sample-element-2'],
    },
    'sample-element-1': {
      $id: 'sample-element-1',
      parentId: 'kw8GEY3zyB',
      componentId: 'muiTypography',
      props: { children: 'before' },
    },
    'sample-element-3': {
      $id: 'sample-element-3',
      parentId: 'kw8GEY3zyB',
      componentId: 'muiStack',
      props: {
        spacing: '100',
        justifyContent: 'space-around',
        direction: 'row',
        repeatDataset: 'Team',
      },
      sx: { textAlign: 'right' },
      nodes: ['sample-element-14', 'HHaXO-eO_7'],
    },
    'sample-element-14': {
      $id: 'sample-element-14',
      parentId: 'sample-element-3',
      componentId: 'muiTypography',
      props: { children: '{{item.name}} — {{item.role}}' },
    },
    'HHaXO-eO_7': {
      $id: 'HHaXO-eO_7',
      parentId: 'sample-element-3',
      componentId: 'muiTypography',
      props: { children: 'hello' },
    },
    'sample-element-2': {
      $id: 'sample-element-2',
      parentId: 'kw8GEY3zyB',
      componentId: 'muiTypography',
      props: { children: 'after' },
    },
  }) as any

describe('a stored Stack repeat renders unchanged (AGL-3111)', () => {
  it('names neither scope and still repeats its children', () => {
    const stored = storedStackRepeat()
    expect(repeatScope(stored['sample-element-3'])).toBe('children')

    const result = expandRepeatables(stored, { Team: team })
    const stack = result['sample-element-3']

    // The Stack itself stays one element, in its own place in the container.
    expect(result['kw8GEY3zyB'].nodes).toEqual([
      'sample-element-1',
      'sample-element-3',
      'sample-element-2',
    ])
    // Two children per record, in record order.
    expect(stack.nodes).toEqual([
      'rep__sample-element-3__0__sample-element-14',
      'rep__sample-element-3__0__HHaXO-eO_7',
      'rep__sample-element-3__1__sample-element-14',
      'rep__sample-element-3__1__HHaXO-eO_7',
      'rep__sample-element-3__2__sample-element-14',
      'rep__sample-element-3__2__HHaXO-eO_7',
    ])
    expect(
      result['rep__sample-element-3__0__sample-element-14'].props.children,
    ).toBe('Ada — Engineer')
    expect(
      result['rep__sample-element-3__2__sample-element-14'].props.children,
    ).toBe('Katherine — Mathematician')
    // A copied child that names no record value is copied verbatim.
    expect(result['rep__sample-element-3__1__HHaXO-eO_7'].props.children).toBe(
      'hello',
    )
    // Every copy is parented on the Stack, as it was before.
    expect(result['rep__sample-element-3__1__HHaXO-eO_7'].parentId).toBe(
      'sample-element-3',
    )
  })

  it('keeps every prop it repeats with except the directives it consumed', () => {
    const result = expandRepeatables(storedStackRepeat(), { Team: team })
    const stack = result['sample-element-3']
    expect(stack.props).toEqual({
      spacing: '100',
      justifyContent: 'space-around',
      direction: 'row',
    })
    // Not just the props: the element is otherwise the stored one.
    expect(stack.componentId).toBe('muiStack')
    expect(stack.sx).toEqual({ textAlign: 'right' })
    expect(stack.parentId).toBe('kw8GEY3zyB')
  })

  it('leaves the templates in the map, unreferenced, and mutates nothing', () => {
    const stored = storedStackRepeat()
    const before = JSON.stringify(stored)
    const result = expandRepeatables(stored, { Team: team })
    expect(JSON.stringify(stored)).toBe(before)
    expect(result['sample-element-14']).toBeDefined()
    expect(result['sample-element-3'].nodes).not.toContain('sample-element-14')
  })

  it('renders once, as written, when the dataset it names is gone', () => {
    const result = expandRepeatables(storedStackRepeat(), {})
    expect(result['sample-element-3'].nodes).toEqual([
      'sample-element-14',
      'HHaXO-eO_7',
    ])
  })
})

describe('an element with a child list keeps repeating its children', () => {
  /**
   * The empty container is the case that decides it. A repeat stored before
   * the scope existed carries no flag, so the default is what renders it —
   * and an author who named the dataset before filling the container in must
   * come back to their one empty container, not a hundred of them.
   */
  it('repeats its children even when it has none yet', () => {
    const nodes = {
      root: { $id: 'root', componentId: 'div', nodes: ['empty'] },
      empty: {
        $id: 'empty',
        parentId: 'root',
        componentId: 'muiStack',
        props: { repeatDataset: 'Team' },
        nodes: [],
      },
    } as any
    expect(repeatScope(nodes['empty'])).toBe('children')
    const result = expandRepeatables(nodes, { Team: team })
    expect(result['root'].nodes).toEqual(['empty'])
    expect(result['empty'].nodes).toEqual([])
  })
})

describe('a leaf repeats itself (AGL-3111)', () => {
  const leafNodes = () =>
    ({
      root: { $id: 'root', componentId: 'div', nodes: ['before', 'leaf'] },
      before: {
        $id: 'before',
        parentId: 'root',
        componentId: 'muiTypography',
        props: { children: 'heading' },
      },
      leaf: {
        $id: 'leaf',
        parentId: 'root',
        componentId: 'muiTypography',
        props: { children: '{{item.name}}', repeatDataset: 'Team' },
      },
    }) as any

  it('takes its own place in its parent, once per record', () => {
    const nodes = leafNodes()
    expect(repeatScope(nodes['leaf'])).toBe('self')

    const result = expandRepeatables(nodes, { Team: team })
    expect(result['root'].nodes).toEqual([
      'before',
      'rep__leaf__0__leaf',
      'rep__leaf__1__leaf',
      'rep__leaf__2__leaf',
    ])
    expect(result['rep__leaf__0__leaf'].props.children).toBe('Ada')
    expect(result['rep__leaf__2__leaf'].props.children).toBe('Katherine')
    expect(result['rep__leaf__1__leaf'].parentId).toBe('root')
  })

  it('substitutes its OWN props, which a container scope never does', () => {
    const nodes = leafNodes()
    const result = expandRepeatables(nodes, { Team: team })
    // No copy carries a directive: the published element is an element.
    for (const index of [0, 1, 2]) {
      expect(result[`rep__leaf__${index}__leaf`].props).not.toHaveProperty(
        'repeatDataset',
      )
    }
  })

  it('carries everything inside it into each copy', () => {
    const nodes = {
      root: { $id: 'root', componentId: 'div', nodes: ['card'] },
      card: {
        $id: 'card',
        parentId: 'root',
        componentId: 'muiCard',
        props: { repeatDataset: 'Team', [REPEAT_SELF_PROP]: true },
        nodes: ['title'],
      },
      title: {
        $id: 'title',
        parentId: 'card',
        componentId: 'muiTypography',
        props: { children: '{{item.role}}' },
      },
    } as any
    const result = expandRepeatables(nodes, { Team: team })
    expect(result['root'].nodes).toEqual([
      'rep__card__0__card',
      'rep__card__1__card',
      'rep__card__2__card',
    ])
    expect(result['rep__card__1__card'].nodes).toEqual([
      'rep__card__1__title',
    ])
    expect(result['rep__card__1__title'].props.children).toBe('Admiral')
    expect(result['rep__card__1__title'].parentId).toBe('rep__card__1__card')
  })

  it('leaves two self-scoped siblings both in the list the other left', () => {
    const nodes = {
      root: { $id: 'root', componentId: 'div', nodes: ['a', 'b'] },
      a: {
        $id: 'a',
        parentId: 'root',
        componentId: 'muiTypography',
        props: { children: '{{item.name}}', repeatDataset: 'Team' },
      },
      b: {
        $id: 'b',
        parentId: 'root',
        componentId: 'muiTypography',
        props: { children: '{{item.role}}', repeatDataset: 'Team' },
      },
    } as any
    const result = expandRepeatables(nodes, { Team: team })
    expect(result['root'].nodes).toEqual([
      'rep__a__0__a',
      'rep__a__1__a',
      'rep__a__2__a',
      'rep__b__0__b',
      'rep__b__1__b',
      'rep__b__2__b',
    ])
  })

  it('renders once, as written, when its parent does not list it', () => {
    const nodes = {
      orphan: {
        $id: 'orphan',
        parentId: 'gone',
        componentId: 'muiTypography',
        props: { children: '{{item.name}}', repeatDataset: 'Team' },
      },
    } as any
    const result = expandRepeatables(nodes, { Team: team })
    expect(Object.keys(result)).toEqual(['orphan'])
    // Still stripped of its directive: an element is never published with one.
    expect(result['orphan'].props).toEqual({ children: '{{item.name}}' })
  })
})

describe('repeats do not nest', () => {
  it('renders an inner repeat once inside each copy of the outer one', () => {
    const nodes = {
      root: { $id: 'root', componentId: 'div', nodes: ['outer'] },
      outer: {
        $id: 'outer',
        parentId: 'root',
        componentId: 'muiStack',
        props: { repeatDataset: 'Team' },
        nodes: ['inner'],
      },
      inner: {
        $id: 'inner',
        parentId: 'outer',
        componentId: 'muiTypography',
        props: { children: '{{item.name}}', repeatDataset: 'Team' },
      },
    } as any
    const result = expandRepeatables(nodes, { Team: team })
    expect(result['outer'].nodes).toEqual([
      'rep__outer__0__inner',
      'rep__outer__1__inner',
      'rep__outer__2__inner',
    ])
    // One copy per outer record, each already carrying that record's value,
    // and none of them still asking to repeat.
    expect(result['rep__outer__0__inner'].props).toEqual({ children: 'Ada' })
  })
})

describe('repeatedRecords is the one set of rows (AGL-3111)', () => {
  const rowsFor = (props: Record<string, unknown>) =>
    repeatedRecords({ props }, team).map((record) => record['name'])

  it('applies the filter, the sort and the limit the node stores', () => {
    expect(rowsFor({})).toEqual(['Ada', 'Grace', 'Katherine'])
    expect(rowsFor({ repeatLimit: 2 })).toEqual(['Ada', 'Grace'])
    expect(rowsFor({ repeatSort: 'name desc' })).toEqual([
      'Katherine',
      'Grace',
      'Ada',
    ])
    expect(rowsFor({ repeatFilter: 'role == Admiral' })).toEqual(['Grace'])
    expect(
      rowsFor({ repeatSort: 'name desc', repeatLimit: 1 }),
    ).toEqual(['Katherine'])
  })

  it('never returns more than REPEAT_MAX_RECORDS, whatever the limit says', () => {
    const many = {
      records: Array.from({ length: 150 }, (_value, index) => ({
        $id: `r${index}`,
        name: `row ${index}`,
      })),
    }
    expect(repeatedRecords({ props: {} }, many)).toHaveLength(100)
    expect(repeatedRecords({ props: { repeatLimit: 500 } }, many)).toHaveLength(
      100,
    )
  })

  it('fails open on an unparseable filter or sort, and on no dataset', () => {
    expect(rowsFor({ repeatFilter: 'nonsense' })).toEqual([
      'Ada',
      'Grace',
      'Katherine',
    ])
    expect(rowsFor({ repeatSort: '???' })).toEqual([
      'Ada',
      'Grace',
      'Katherine',
    ])
    expect(repeatedRecords({ props: {} }, undefined)).toEqual([])
  })

  it('agrees with what expandRepeatables renders', () => {
    const nodes = {
      root: { $id: 'root', componentId: 'div', nodes: ['leaf'] },
      leaf: {
        $id: 'leaf',
        parentId: 'root',
        componentId: 'muiTypography',
        props: {
          children: '{{item.name}}',
          repeatDataset: 'Team',
          repeatSort: 'name desc',
          repeatLimit: 2,
        },
      },
    } as any
    const expected = repeatedRecords(nodes['leaf'], team)
    const result = expandRepeatables(nodes, { Team: team })
    expect(result['root'].nodes).toHaveLength(expected.length)
    expect(
      (result['root'].nodes as string[]).map(
        (id: string) => result[id].props.children,
      ),
    ).toEqual(expected.map((record) => record['name']))
  })
})
