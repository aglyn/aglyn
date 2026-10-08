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

import * as Aglyn from '@aglyn/aglyn'
import { act, render, screen } from '@testing-library/react'
import { observable, runInAction } from 'mobx'
import {
  Children,
  createContext,
  forwardRef,
  type ReactNode,
  useContext,
} from 'react'
import Leaf, { type LeafProps } from './leaf'
import TreeRoot from './tree-root'

/**
 * Positional children (AGL-1237).
 *
 * `Leaf` normally hands a component ONE child — the `<Branch>` element that
 * renders the whole subtree. A component that splits its children by index
 * (MUI's Accordion is `[summary, ...rest]`) therefore saw a single child,
 * gave the first slot the entire subtree, and left every later slot empty.
 * Live, that meant an accordion whose panel was always empty while its
 * content rendered unconditionally inside the summary.
 */

/** Stand-in for MUI's Accordion: keeps the first child, collapses the rest. */
const Splitter = ({ children, ...rest }: { children?: ReactNode }) => {
  const [first, ...others] = Children.toArray(children)
  return (
    <div {...rest}>
      <div data-testid="first-slot">{first}</div>
      <div data-testid="rest-slot">{others}</div>
    </div>
  )
}

const Plain = ({ children, ...rest }: { children?: ReactNode }) => (
  <div {...rest}>{children}</div>
)

const node = (id: string, componentId: string, children: any[] = [], props = {}) => {
  const n: any = { $id: id, componentId, pluginId: 'test', props, children }
  return n
}

/** Register for real — `getFactory` is a computedFn and cannot be spied on. */
const registerSchemas = (positional: boolean) => {
  Aglyn.components.registerComponent(Splitter as any, {
    $id: 'splitter',
    pluginId: 'test',
    ...(positional
      ? { flags: { positionalChildren: Aglyn.FEATURE_FLAG.ENABLED } }
      : {}),
  } as any)
  Aglyn.components.registerComponent(Plain as any, {
    $id: 'plain',
    pluginId: 'test',
  } as any)
}

// Marker attributes rather than text. This dates from when a node's
// `children` string rendered into an `<aglyn-text>` SHADOW ROOT, which
// `textContent` could not see; the shadow root is gone (AGL-2011) and the
// attributes are kept only because these cases assert PLACEMENT, not content.
// The readability that replaced it is pinned below.
const tree = () =>
  node('root', 'splitter', [
    node('head', 'plain', [], { 'data-testid': 'head' }),
    node('body', 'plain', [], { 'data-testid': 'body' }),
  ])

afterEach(() => {
  Aglyn.components.unregisterComponent('splitter')
  Aglyn.components.unregisterComponent('plain')
})

describe('Leaf positional children (AGL-1237)', () => {
  it('NEGATIVE CONTROL: without the flag both children land in the first slot', () => {
    registerSchemas(false)
    render(<TreeRoot node={tree() as any} />)
    const first = screen.getByTestId('first-slot')
    const rest = screen.getByTestId('rest-slot')
    // This is the shipped bug, reproduced: one wrapper element means one child.
    expect(first.contains(screen.getByTestId('head'))).toBe(true)
    expect(first.contains(screen.getByTestId('body'))).toBe(true)
    expect(rest.children.length).toBe(0)
  })

  it('with the flag, each node child is its own React child', () => {
    registerSchemas(true)
    render(<TreeRoot node={tree() as any} />)
    const first = screen.getByTestId('first-slot')
    const rest = screen.getByTestId('rest-slot')
    expect(first.contains(screen.getByTestId('head'))).toBe(true)
    expect(first.contains(screen.getByTestId('body'))).toBe(false)
    expect(rest.contains(screen.getByTestId('body'))).toBe(true)
  })

  it('leaves components without the flag on the wrapped path', () => {
    // The wrapper is what keeps the Branch/Stem/Leaf seam swappable, so only
    // components that opt in may lose it.
    registerSchemas(false)
    const { container } = render(
      <TreeRoot node={node('root', 'plain', [node('kid', 'plain', [], { 'data-testid': 'kid' })]) as any} />,
    )
    expect(container.querySelector('[data-testid="kid"]')).toBeTruthy()
  })
})

/**
 * A Stack's divider (AGL-3660). MUI's Stack places its divider between
 * `Children.toArray(children)`, exactly as the Accordion splits its slots, so
 * a Stack of three handed one `<Branch>` drew no divider anywhere.
 */
describe('positional children reach a component that counts them (AGL-3660)', () => {
  /** Stand-in for MUI's Stack: a rule between each pair of children. */
  const Divided = ({ children, ...rest }: { children?: ReactNode }) => {
    const kids = Children.toArray(children)
    return (
      <div {...rest}>
        {kids.flatMap((kid, index) =>
          index ? [<hr key={`rule-${index}`} />, kid] : [kid],
        )}
      </div>
    )
  }

  const register = (positional: boolean) =>
    Aglyn.components.registerComponent(Divided as any, {
      $id: 'divided',
      pluginId: 'test',
      ...(positional
        ? { flags: { positionalChildren: Aglyn.FEATURE_FLAG.ENABLED } }
        : {}),
    } as any)

  const three = () =>
    node('root', 'divided', [
      node('a', 'plain', [], { 'data-testid': 'a' }),
      node('b', 'plain', [], { 'data-testid': 'b' }),
      node('c', 'plain', [], { 'data-testid': 'c' }),
    ])

  const rules = (container: HTMLElement) =>
    container.querySelectorAll('[data-aglyn="leaf:root"] > hr').length

  beforeEach(() => registerSchemas(false))
  afterEach(() => Aglyn.components.unregisterComponent('divided'))

  it('NEGATIVE CONTROL: without the flag three children read as one', () => {
    register(false)
    const { container } = render(<TreeRoot node={three() as any} />)
    expect(rules(container)).toBe(0)
  })

  it('with the flag, three children draw two rules, without a key warning', () => {
    register(true)
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { container } = render(<TreeRoot node={three() as any} />)
      expect(rules(container)).toBe(2)
      expect(
        errors.mock.calls.filter((call) => /key/i.test(String(call[0]))),
      ).toEqual([])
    } finally {
      errors.mockRestore()
    }
  })

  it('keeps each child mounted across a re-render (stable keys)', () => {
    register(true)
    const tree = three()
    const { container, rerender } = render(<TreeRoot node={tree as any} />)
    const before = container.querySelector('[data-testid="b"]')
    rerender(<TreeRoot node={tree as any} />)
    expect(container.querySelector('[data-testid="b"]')).toBe(before)
  })

  /**
   * The besigner's leaf shape: a render COPY of the node, the Branch inside
   * a provider (a repeat's first record), and its own extras beside it (a
   * repeat's preview copies and badge). Each child must still arrive alone,
   * inside the provider, with the extras kept.
   */
  const RecordContext = createContext<string | undefined>(undefined)
  const ReadsRecord = ({ children, ...rest }: { children?: ReactNode }) => (
    <div {...rest} data-record={useContext(RecordContext) ?? ''}>
      {children}
    </div>
  )
  const CanvasLikeLeaf = forwardRef<any, LeafProps>(
    ({ node: original, children, ...rest }, ref) => {
      // The besigner's render copy is a SPREAD of a canvas node, whose
      // `children` is a class getter the spread drops — so the copy has none.
      const { children: _dropped, ...copy } = {
        ...original,
        props: { ...(original as any).props },
      } as any
      const isRoot = original.$id === 'root'
      return (
        <Leaf ref={ref} node={copy as any} {...rest}>
          {isRoot ? (
            <RecordContext.Provider value="first">{children}</RecordContext.Provider>
          ) : (
            children
          )}
          {null}
          {isRoot ? <i data-testid="extra" /> : null}
        </Leaf>
      )
    },
  )

  it('re-renders when a child is added to the node it renders', () => {
    // The canvas adds a child by mutating an observable node; the element
    // has to see it without anything above it re-rendering.
    register(true)
    const kids = observable([
      node('a', 'plain', [], { 'data-testid': 'a' }),
      node('b', 'plain', [], { 'data-testid': 'b' }),
    ])
    const tree = {
      ...node('root', 'divided'),
      get children() {
        return kids
      },
    }
    const { container } = render(<TreeRoot node={tree as any} />)
    expect(rules(container)).toBe(1)
    act(() => {
      runInAction(() => {
        kids.push(node('c', 'plain', [], { 'data-testid': 'c' }))
      })
    })
    expect(rules(container)).toBe(2)
    expect(container.querySelector('[data-testid="c"]')).toBeTruthy()
  })

  it('on a canvas-shaped leaf, splits the wrapped Branch and keeps the extras', () => {
    register(true)
    Aglyn.components.registerComponent(ReadsRecord as any, {
      $id: 'reads',
      pluginId: 'test',
    } as any)
    try {
      const tree = node('root', 'divided', [
        node('a', 'reads', [], { 'data-testid': 'a' }),
        node('b', 'reads', [], { 'data-testid': 'b' }),
      ])
      const { container } = render(
        <TreeRoot node={tree as any} LeafComponent={CanvasLikeLeaf as any} />,
      )
      // a | b | extra — the extra follows the children, as it did.
      expect(rules(container)).toBe(2)
      const root = container.querySelector('[data-aglyn="leaf:root"]')!
      expect(
        Array.from(root.children)
          .filter((el) => el.tagName !== 'HR')
          .map((el) => el.getAttribute('data-testid')),
      ).toEqual(['a', 'b', 'extra'])
      // The provider reached each child, applied per child.
      expect(screen.getByTestId('a').getAttribute('data-record')).toBe('first')
      expect(screen.getByTestId('b').getAttribute('data-record')).toBe('first')
    } finally {
      Aglyn.components.unregisterComponent('reads')
    }
  })
})

/**
 * Visibility directives (AGL-1314) are compose-time instructions. The graft
 * consumes and strips them, so a published page never carries one — but the
 * component EDITOR renders definition nodes ungrafted on purpose, and there
 * the raw directive would spread straight onto the element.
 */
describe('Leaf visibility directives (AGL-1314)', () => {
  it('keeps the directives out of the DOM while everything else passes through', () => {
    registerSchemas(false)
    render(
      <TreeRoot
        node={
          node('root', 'plain', [], {
            'data-testid': 'lone',
            title: 'kept',
            [Aglyn.NODE_HIDE_IF_PROP]: '{{prop.hideMedia}}',
            [Aglyn.NODE_HIDE_UNLESS_PROP]: '{{prop.ctaLink}}',
          }) as any
        }
      />,
    )
    const el = screen.getByTestId('lone')
    expect(el.getAttribute('title')).toBe('kept')
    expect(el.hasAttribute(Aglyn.NODE_HIDE_IF_PROP.toLowerCase())).toBe(false)
    expect(el.hasAttribute(Aglyn.NODE_HIDE_UNLESS_PROP.toLowerCase())).toBe(
      false,
    )
    // Nothing else named like them either — a renamed spelling would be the
    // same leak wearing a different attribute.
    expect(el.outerHTML.toLowerCase()).not.toContain('hide')
  })
})

describe('authored text is readable from the DOM (AGL-2011)', () => {
  it('renders the authored string where textContent can read it', () => {
    registerSchemas(false)
    render(
      <TreeRoot
        node={
          node('root', 'plain', [], {
            'data-testid': 'host',
            children: 'Terms of Service',
          }) as any
        }
      />,
    )
    // The whole point of dropping the shadow root. Before AGL-2011 this read
    // back as an empty string, which is what shipped the AGL-2349 accordion
    // bug and what forced every external checker to write a shadow-piercing
    // DOM walk.
    expect(screen.getByTestId('host').textContent).toBe('Terms of Service')
  })

  it('attaches NO shadow root to the text element', () => {
    registerSchemas(false)
    const { container } = render(
      <TreeRoot
        node={
          node('root', 'plain', [], { children: 'Privacy Policy' }) as any
        }
      />,
    )
    const el = container.querySelector('aglyn-text')
    // The tag is deliberately UNCHANGED, so every querySelectorAll and every
    // editor ref target still resolves. Only the boundary is gone.
    expect(el).not.toBeNull()
    expect(el!.shadowRoot).toBeNull()
    expect(el!.textContent).toBe('Privacy Policy')
  })
})
