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
 * A placed component repeats once per record (AGL-3111).
 *
 * The two functions in order, which is the order every surface runs them in —
 * the graft first, then the expansion (`compose-screen-nodes.ts`). Neither
 * half is the feature on its own: the graft has to move the placement's repeat
 * onto the element it becomes, and the expansion has to read that element as
 * repeating ITSELF rather than the component's own children.
 */

import {
  composeReusableComponentNodes,
  REUSABLE_INSTANCE_COMPONENT_ID,
} from './compose-reusable-components'
import {
  expandRepeatables,
  REPEAT_SELF_PROP,
  repeatScope,
} from './expand-repeatables'

const team = {
  records: [
    { $id: 'r1', name: 'Ada', role: 'Engineer' },
    { $id: 'r2', name: 'Grace', role: 'Admiral' },
  ],
}

/** A two-element card: a title bound to a property, and a fixed subtitle. */
const CARD = {
  rootId: 'card',
  nodes: {
    card: {
      $id: 'card',
      componentId: 'muiCard',
      nodes: ['title', 'subtitle'],
    },
    title: {
      $id: 'title',
      componentId: 'muiTypography',
      parentId: 'card',
      props: { children: '{{prop.headline}}' },
    },
    subtitle: {
      $id: 'subtitle',
      componentId: 'muiTypography',
      parentId: 'card',
      props: { children: 'member' },
    },
  },
  props: [{ name: 'headline', label: 'Headline', kind: 'text' }],
} as any

const screenWith = (instanceProps: Record<string, unknown>) =>
  ({
    _root_: { $id: '_root_', componentId: 'div', nodes: ['lead', 'placed'] },
    lead: {
      $id: 'lead',
      parentId: '_root_',
      componentId: 'muiTypography',
      props: { children: 'The team' },
    },
    placed: {
      $id: 'placed',
      parentId: '_root_',
      componentId: REUSABLE_INSTANCE_COMPONENT_ID,
      props: {
        refId: 'cardComponent',
        name: 'Team card',
        propValues: { headline: '{{item.name}}' },
        ...instanceProps,
      },
      nodes: [] as string[],
    },
  }) as any

const compose = (instanceProps: Record<string, unknown>) =>
  composeReusableComponentNodes(screenWith(instanceProps), {
    cardComponent: CARD,
  } as any)

describe('a placed component set to repeat (AGL-3111)', () => {
  it('becomes an element that repeats ITSELF, not the component’s children', () => {
    const grafted = compose({ repeatDataset: 'Team' })
    const root = grafted['placed'] as any
    // The graft puts the component's root in the placement's own id.
    expect(root.componentId).toBe('muiCard')
    expect(root.props[REPEAT_SELF_PROP]).toBe(true)
    expect(root.props.repeatDataset).toBe('Team')
    // Left to the child list, this would have read as a container whose two
    // children are the item template — the component torn in half.
    expect(repeatScope(root)).toBe('self')
  })

  it('expands to one copy of the whole component per record', () => {
    const expanded = expandRepeatables(compose({ repeatDataset: 'Team' }), {
      Team: team,
    })
    expect(expanded['_root_'].nodes).toEqual([
      'lead',
      'rep__placed__0__placed',
      'rep__placed__1__placed',
    ])
    const first = expanded['rep__placed__0__placed'] as any
    expect(first.componentId).toBe('muiCard')
    expect(first.parentId).toBe('_root_')
    expect(first.nodes).toHaveLength(2)
    // Each copy carries the whole component, with the record's own value
    // already substituted through the property the placement bound.
    expect(
      expanded[(first.nodes as string[])[0]].props.children,
    ).toBe('Ada')
    expect(
      expanded[
        (expanded['rep__placed__1__placed'].nodes as string[])[0]
      ].props.children,
    ).toBe('Grace')
    expect(
      expanded[(first.nodes as string[])[1]].props.children,
    ).toBe('member')
  })

  it('carries the placement’s limit, filter and sort across', () => {
    const grafted = compose({
      repeatDataset: 'Team',
      repeatLimit: 1,
      repeatFilter: 'role == Admiral',
      repeatSort: 'name desc',
    })
    const root = grafted['placed'] as any
    expect(root.props.repeatLimit).toBe(1)
    expect(root.props.repeatFilter).toBe('role == Admiral')
    expect(root.props.repeatSort).toBe('name desc')
    const expanded = expandRepeatables(grafted, { Team: team })
    expect(expanded['_root_'].nodes).toEqual(['lead', 'rep__placed__0__placed'])
    expect(
      expanded[
        (expanded['rep__placed__0__placed'].nodes as string[])[0]
      ].props.children,
    ).toBe('Grace')
  })

  it('publishes no copy still carrying a repeat directive', () => {
    const expanded = expandRepeatables(compose({ repeatDataset: 'Team' }), {
      Team: team,
    })
    for (const node of Object.values(expanded) as any[]) {
      if (!String(node.$id).startsWith('rep__')) continue
      expect(node.props ?? {}).not.toHaveProperty('repeatDataset')
      expect(node.props ?? {}).not.toHaveProperty(REPEAT_SELF_PROP)
    }
  })

  it('leaves a placement that repeats over nothing exactly as it was', () => {
    const plain = compose({})
    const root = plain['placed'] as any
    // Absent rather than empty: the card declares no props of its own and the
    // placement carried none across, so the element is authored with none.
    expect(root.props).toBeUndefined()
    // And the component's own children are still its children.
    expect(root.nodes).toHaveLength(2)
    const expanded = expandRepeatables(plain, { Team: team })
    expect(expanded['_root_'].nodes).toEqual(['lead', 'placed'])
  })

  /**
   * The component's OWN root may already repeat — a shared "Team list" whose
   * Stack repeats over the same dataset. A placement that also repeats replaces
   * that rather than mixing with it: the two authors' filters and limits are
   * not one query, and repeats do not nest.
   */
  it('replaces a repeat the component’s own root declared', () => {
    const repeatingComponent = {
      ...CARD,
      nodes: {
        ...CARD.nodes,
        card: {
          ...CARD.nodes.card,
          props: { repeatDataset: 'Roles', repeatLimit: 9 },
        },
      },
    }
    const grafted = composeReusableComponentNodes(
      screenWith({ repeatDataset: 'Team' }),
      { cardComponent: repeatingComponent } as any,
    )
    const root = grafted['placed'] as any
    expect(root.props.repeatDataset).toBe('Team')
    expect(root.props).not.toHaveProperty('repeatLimit')
    expect(root.props[REPEAT_SELF_PROP]).toBe(true)
  })

  it('keeps the component’s own repeat when the placement declares none', () => {
    const repeatingComponent = {
      ...CARD,
      nodes: {
        ...CARD.nodes,
        card: {
          ...CARD.nodes.card,
          props: { repeatDataset: 'Roles' },
        },
      },
    }
    const grafted = composeReusableComponentNodes(screenWith({}), {
      cardComponent: repeatingComponent,
    } as any)
    const root = grafted['placed'] as any
    expect(root.props.repeatDataset).toBe('Roles')
    // Its own children ARE the template it was designed with.
    expect(root.props).not.toHaveProperty(REPEAT_SELF_PROP)
    expect(repeatScope(root)).toBe('children')
  })
})
