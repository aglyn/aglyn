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
 * ELEMENTS THAT COUNT THEIR CHILDREN GET ONE PER NODE (AGL-3660).
 *
 * MUI's Stack inserts its divider between `Children.toArray(children)`;
 * Breadcrumbs wraps each of them in an `<li>` with a separator between; the
 * Collection Entries search divides them into one group per entry. The
 * renderer used to hand every component ONE child — the `<Branch>` element
 * that renders the subtree — so a Stack of three drew no divider, a trail of
 * three crumbs was one item with no separator, and a searching entries block
 * never divided evenly and dropped its search field. Every owner who set
 * one of these in the Besigner got a page without it, and a canvas without
 * it too.
 *
 * Both surfaces, through the real elements: `TreeRoot` with the plain `Leaf`
 * is the published page's renderer, and `TreeRoot` with the designer's
 * `NodeLeaf` is the canvas. Each published case has a control registered
 * WITHOUT the opt-in, which reproduces the shipped bug, so an element that
 * stops opting in and a renderer that stops honouring it both fail here.
 *
 * Here rather than beside either side because it needs the mui plugin and
 * the designer at once, reached through the generated manifest so neither
 * imports the other.
 */

import * as Aglyn from '@aglyn/aglyn'
import { TreeRoot } from '@aglyn/aglyn-node-renderer'
import NodeLeaf from '@aglyn/besigner-ui/components/node-leaf'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { Suspense } from 'react'
import { CONSOLE_PLUGIN_MANIFEST } from '../constants/plugins.client.generated'

const STACK = 'muiStack'
const BREADCRUMBS = 'muiBreadcrumbs'
const ENTRIES = Aglyn.COLLECTION_ENTRIES_COMPONENT_ID

type Entry = { component: unknown; schema: Aglyn.ComponentSchema }
const bundle = new Map<string, Entry>()

beforeAll(async () => {
  const mui = CONSOLE_PLUGIN_MANIFEST.find((entry) => entry.id === 'mui')
  if (!mui) throw new Error('no manifest entry for "mui"')
  const loadMuiBundle = ((await mui.load()) as Record<string, unknown>)[
    'loadMuiBundle'
  ] as (ids: readonly string[]) => Promise<Entry[]>
  // What a published page about to hydrate a searching block carries: its
  // server HTML marks the block, so the bundle fetches the search box as the
  // element registers rather than suspending the first render on it.
  const marker = document.createElement('div')
  marker.setAttribute('data-aglyn-entries-search', '')
  document.body.appendChild(marker)
  try {
    for (const entry of await loadMuiBundle([STACK, BREADCRUMBS, ENTRIES])) {
      bundle.set(entry.schema.$id as string, entry)
    }
  } finally {
    marker.remove()
  }
})

/** Registers the real element, or — `optIn: false` — the renderer as shipped. */
const register = (id: string, optIn = true) => {
  const entry = bundle.get(id)
  if (!entry) throw new Error(`the mui bundle registers no "${id}"`)
  const schema = optIn
    ? entry.schema
    : {
        ...entry.schema,
        flags: { ...entry.schema.flags, positionalChildren: undefined },
      }
  Aglyn.components.registerComponent(entry.component as never, schema as never)
}

afterEach(() => {
  for (const id of [STACK, BREADCRUMBS, ENTRIES]) {
    Aglyn.components.unregisterComponent(id)
  }
})

const node = (
  id: string,
  componentId: string,
  props: Record<string, unknown>,
  children: unknown[] = [],
) => ({ $id: id, type: 'node', componentId, props, children, nodes: [] })

/** A child no element registers: `Leaf`'s default `div`. */
const leafChild = (id: string, props: Record<string, unknown> = {}) =>
  node(id, 'plain-child', { 'data-testid': id, ...props })

const rootOf = (container: HTMLElement) =>
  container.querySelector('[data-aglyn="leaf:root"]') as HTMLElement

describe('a stored Stack with a divider (AGL-3660)', () => {
  const stack = (props: Record<string, unknown>) =>
    node('root', STACK, props, [leafChild('a'), leafChild('b'), leafChild('c')])

  const dividers = (container: HTMLElement) =>
    rootOf(container).querySelectorAll(':scope > .MuiDivider-root')

  /** Children and dividers in DOM order, a divider as `|`. */
  const order = (container: HTMLElement) =>
    Array.from(rootOf(container).children).map((el) =>
      el.classList.contains('MuiDivider-root')
        ? '|'
        : el.getAttribute('data-testid'),
    )

  it('CONTROL: without the opt-in, three children draw no divider', () => {
    register(STACK, false)
    const { container } = render(
      <TreeRoot node={stack({ direction: 'column', divider: 'line' }) as never} />,
    )
    expect(dividers(container)).toHaveLength(0)
  })

  it('draws one divider between each pair of its three children', () => {
    register(STACK)
    const { container } = render(
      <TreeRoot node={stack({ direction: 'column', divider: 'line' }) as never} />,
    )
    expect(dividers(container)).toHaveLength(2)
    expect(order(container)).toEqual(['a', '|', 'b', '|', 'c'])
  })

  it("runs a row's dividers vertically", () => {
    register(STACK)
    const { container } = render(
      <TreeRoot node={stack({ direction: 'row', divider: 'dashed' }) as never} />,
    )
    const found = dividers(container)
    expect(found).toHaveLength(2)
    for (const rule of Array.from(found)) {
      expect(rule.classList.contains('MuiDivider-vertical')).toBe(true)
    }
  })

  it('draws none when no divider is set, and every child renders', () => {
    register(STACK)
    const { container } = render(
      <TreeRoot node={stack({ direction: 'column' }) as never} />,
    )
    expect(dividers(container)).toHaveLength(0)
    expect(order(container)).toEqual(['a', 'b', 'c'])
  })

  it('draws the same dividers on the besigner canvas', () => {
    // The canvas's own leaf, which hands `Leaf` a render copy of the node
    // and its own extras beside the children. The author has to see the
    // rule they picked where they picked it.
    register(STACK)
    const { container } = render(
      <TreeRoot
        node={stack({ direction: 'column', divider: 'line' }) as never}
        LeafComponent={NodeLeaf as never}
      />,
    )
    expect(order(container)).toEqual(['a', '|', 'b', '|', 'c'])
  })
})

describe('a stored Breadcrumbs trail (AGL-3660)', () => {
  const trail = () =>
    node('root', BREADCRUMBS, { separator: '›' }, [
      leafChild('home', { children: 'Home' }),
      leafChild('blog', { children: 'Blog' }),
      leafChild('post', { children: 'Post' }),
    ])

  const separators = (container: HTMLElement) =>
    Array.from(container.querySelectorAll('.MuiBreadcrumbs-separator')).map(
      (el) => el.textContent,
    )

  it('CONTROL: without the opt-in, three crumbs are one item', () => {
    register(BREADCRUMBS, false)
    const { container } = render(<TreeRoot node={trail() as never} />)
    expect(container.querySelectorAll('.MuiBreadcrumbs-li')).toHaveLength(1)
    expect(separators(container)).toEqual([])
  })

  it('puts each crumb in its own item with a separator between', () => {
    register(BREADCRUMBS)
    const { container } = render(<TreeRoot node={trail() as never} />)
    expect(container.querySelectorAll('.MuiBreadcrumbs-li')).toHaveLength(3)
    expect(separators(container)).toEqual(['›', '›'])
  })

  it('separates them on the besigner canvas too', () => {
    register(BREADCRUMBS)
    const { container } = render(
      <TreeRoot node={trail() as never} LeafComponent={NodeLeaf as never} />,
    )
    expect(separators(container)).toEqual(['›', '›'])
  })
})

describe('a stored searching Collection Entries block (AGL-3660)', () => {
  const index = [
    { title: 'Design it live', excerpt: 'how besigner renders', url: '/blog/a' },
    { title: 'One platform', excerpt: 'commerce forms media', url: '/blog/b' },
  ]
  /** What the tenant's expansion stamps: one clone of the template per entry. */
  const block = () =>
    node('root', ENTRIES, { search: true, searchIndex: index }, [
      leafChild('first', { children: 'First card' }),
      leafChild('second', { children: 'Second card' }),
    ])

  /** Renders the block; its search module is already here (see `beforeAll`). */
  const mount = async () => {
    render(
      <Suspense fallback={null}>
        <TreeRoot node={block() as never} />
      </Suspense>,
    )
    await screen.findByText('First card')
  }

  it('CONTROL: without the opt-in, the field is missing from the page', async () => {
    register(ENTRIES, false)
    await mount()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('shows the field, and a keystroke filters the entries', async () => {
    register(ENTRIES)
    await mount()
    await act(async () => {
      fireEvent.change(screen.getByRole('textbox'), {
        target: { value: 'besigner' },
      })
    })
    expect(screen.getByText('First card')).toBeTruthy()
    expect(screen.queryByText('Second card')).toBeNull()
  })
})
