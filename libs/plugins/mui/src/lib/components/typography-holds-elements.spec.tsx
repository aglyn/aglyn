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

import { AglynText } from '@aglyn/shared-ui-jsx'
import { act, type ReactNode } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import AglynTypography from './typography'

/**
 * A Typography that holds elements (AGL-3672), handed its children the way
 * the renderer's positional path hands them over: one element per child
 * node, each carrying `node`, then the node's own text in `<aglyn-text>`.
 */
function ChildNode(props: { node: { $id: string }; children: ReactNode }) {
  return <>{props.children}</>
}
const child = (id: string, element: ReactNode) => (
  <ChildNode key={id} node={{ $id: id }}>
    {element}
  </ChildNode>
)
const text = (value: string) => <AglynText key="text">{value}</AglynText>

/**
 * Server markup as the browser's parser would leave it. A `<p>` or heading
 * that the parser closes early moves its would-be children out beside it,
 * which is the hydration mismatch this guards against — so the assertions
 * read the PARSED tree, not the string React produced.
 */
function parsed(element: ReactNode): HTMLElement {
  const container = document.createElement('div')
  container.innerHTML = renderToString(<>{element}</>)
  for (const style of Array.from(container.querySelectorAll('style'))) {
    style.remove()
  }
  return container
}

describe('a Typography with no elements renders as it always has', () => {
  it('keeps its paragraph and its text', () => {
    const root = parsed(<AglynTypography>{[text('Plain')]}</AglynTypography>)
    expect(root.firstElementChild?.tagName).toBe('P')
    expect(root.querySelector('p > aglyn-text')?.textContent).toBe('Plain')
  })

  it('keeps rich text over the whole element', () => {
    const root = parsed(
      <AglynTypography html="<strong>Bold</strong> claim">
        {[text('Bold claim')]}
      </AglynTypography>,
    )
    expect(root.querySelector('p > strong')?.textContent).toBe('Bold')
    expect(root.querySelector('aglyn-text')).toBeNull()
  })
})

describe('a Typography that holds elements (AGL-3672)', () => {
  it('renders its text first, then the elements', () => {
    const root = parsed(
      <AglynTypography variant="h2">
        {[child('badge', <span data-test="badge">New</span>), text('Plans')]}
      </AglynTypography>,
    )
    const heading = root.querySelector('h2')!
    expect(heading.firstElementChild?.tagName).toBe('AGLYN-TEXT')
    expect(heading.lastElementChild?.getAttribute('data-test')).toBe('badge')
  })

  it('is a div rather than a paragraph, so a block inside survives the parser', () => {
    const root = parsed(
      <AglynTypography>
        {[child('box', <div data-test="box">Block</div>), text('Intro')]}
      </AglynTypography>,
    )
    expect(root.children).toHaveLength(1)
    expect(root.firstElementChild?.tagName).toBe('DIV')
    expect(root.querySelector('[data-test="box"]')?.parentElement).toBe(
      root.firstElementChild,
    )
  })

  it('renders a nested Typography as a span, so neither element is split', () => {
    const root = parsed(
      <AglynTypography variant="h1">
        {[
          child(
            'inner',
            <AglynTypography variant="h2">{[text('how we did')]}</AglynTypography>,
          ),
          text('Tell us'),
        ]}
      </AglynTypography>,
    )
    expect(root.children).toHaveLength(1)
    const outer = root.querySelector('h1')!
    expect(outer.querySelector('h2')).toBeNull()
    expect(outer.querySelector('span')?.textContent).toBe('how we did')
    expect(outer.textContent).toBe('Tell ushow we did')
  })

  it('keeps a paragraph nested in a paragraph inside it', () => {
    const root = parsed(
      <AglynTypography>
        {[child('inner', <AglynTypography>{[text('two')]}</AglynTypography>), text('one')]}
      </AglynTypography>,
    )
    expect(root.children).toHaveLength(1)
    expect(root.querySelectorAll('p')).toHaveLength(0)
    expect(root.firstElementChild?.textContent).toBe('onetwo')
  })

  it('puts rich text in its own aglyn-text, beside the elements', () => {
    const root = parsed(
      <AglynTypography html="<em>Fresh</em> bread" variant="h2">
        {[child('icon', <i data-test="icon" />), text('Fresh bread')]}
      </AglynTypography>,
    )
    const own = root.querySelector('h2 > aglyn-text')!
    expect(own.innerHTML).toBe('<em>Fresh</em> bread')
    expect(own.querySelector('[data-test="icon"]')).toBeNull()
    expect(root.querySelector('h2 > [data-test="icon"]')).toBeTruthy()
  })

  it('hydrates without a mismatch', async () => {
    const errors: unknown[][] = []
    const spy = jest
      .spyOn(console, 'error')
      .mockImplementation((...args: unknown[]) => void errors.push(args))
    const element = (
      <AglynTypography html="<strong>Tell</strong> us" variant="h1">
        {[
          child(
            'inner',
            <AglynTypography variant="h2">{[text('how we did')]}</AglynTypography>,
          ),
          child('box', <div>Block</div>),
          text('Tell us'),
        ]}
      </AglynTypography>
    )
    const container = document.createElement('div')
    container.innerHTML = renderToString(element)
    // Emotion inlines styles on the server and inserts through CSSOM on the
    // client; production hoists them, and so does this.
    for (const style of Array.from(
      container.querySelectorAll('style[data-emotion]'),
    )) {
      document.head.appendChild(style)
    }
    document.body.appendChild(container)
    await act(async () => {
      hydrateRoot(container, element)
    })
    spy.mockRestore()
    const complaints = errors
      .map((entry) => entry.map(String).join(' '))
      .filter((line) =>
        /hydrat|did not match|server (?:rendered )?HTML|#418|#423|#425/i.test(line),
      )
    expect(complaints).toEqual([])
    container.remove()
  })
})
