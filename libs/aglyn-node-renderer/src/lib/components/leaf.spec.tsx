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
import { render, screen } from '@testing-library/react'
import { Children, type ReactNode } from 'react'
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

// Marker attributes, not text: a node's `children` string renders inside an
// <aglyn-text> shadow root, which `textContent` cannot see.
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
