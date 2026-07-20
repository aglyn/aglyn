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
import { fireEvent, render, screen } from '@testing-library/react'

import ElementPropsForm from './element-props-form.component'

// TokenTextField (AGL-586): token-capable attributes render their stored
// `{{...}}` tokens as named, colored, clickable pills while the committed
// value keeps the raw id-based grammar. Exercised through the real
// attributes form so the react-final-form + debounced-commit path
// (AGL-567) is the one under test.
describe('TokenTextField (AGL-586)', () => {
  let updateNodeProps: jest.SpyInstance

  beforeEach(() => {
    // Debounced form commits (AGL-567) fire on unmount flush — keep them
    // away from the real canvas store, the node under test isn't in it.
    updateNodeProps = jest
      .spyOn(Aglyn.canvas, 'updateNodeProps')
      .mockImplementation((() => undefined) as any)
  })
  afterEach(() => {
    updateNodeProps.mockRestore()
  })

  const formProps = (href: string) =>
    ({
      node: {
        $id: 'agl586-node',
        type: 'node',
        componentId: 'unregistered-link',
        props: { href },
        componentSchema: {
          attributes: [
            {
              name: 'href',
              label: 'Link',
              component: Aglyn.FieldComponentType.TEXT_FIELD,
            },
          ],
        },
        nodes: [],
      },
    }) as any

  const findSurface = async () => {
    const surface = (await screen.findByTestId(
      'token-text-field',
    )) as HTMLElement
    return surface
  }

  /** The committed value for `href` on the LAST updateNodeProps call. */
  const lastCommittedHref = (): unknown => {
    const call = updateNodeProps.mock.calls[
      updateNodeProps.mock.calls.length - 1
    ] as unknown[]
    return (call?.[1] as Record<string, unknown>)?.['href']
  }

  it('renders stored tokens as named pills, raw grammar hidden', async () => {
    const { unmount } = render(
      <ElementPropsForm {...formProps('Read {{entry.title}} now')} />,
    )
    const surface = await findSurface()
    const pill = surface.querySelector('[data-token]') as HTMLElement
    expect(pill).toBeTruthy()
    expect(pill.getAttribute('data-token')).toBe('{{entry.title}}')
    expect(pill.getAttribute('data-token-group')).toBe('entry')
    expect(pill.getAttribute('contenteditable')).toBe('false')
    expect(pill.textContent).toBe('Title')
    // The visible text around the pill stays plain.
    expect(surface.textContent).toBe('Read Title now')
    unmount()
  })

  it('colors unresolvable tokens as unknown', async () => {
    const { unmount } = render(
      <ElementPropsForm {...formProps('{{var:deleted}}')} />,
    )
    const surface = await findSurface()
    const pill = surface.querySelector('[data-token]') as HTMLElement
    expect(pill.getAttribute('data-token-group')).toBe('unknown')
    expect(pill.getAttribute('title')).toBe('{{var:deleted}}')
    unmount()
  })

  it('typing updates the committed value around the pills', async () => {
    const { unmount } = render(
      <ElementPropsForm {...formProps('Read {{entry.title}}')} />,
    )
    const surface = await findSurface()
    // jsdom has no typing engine — mutate the DOM like the browser would,
    // then fire the input event the surface listens to.
    surface.appendChild(document.createTextNode(' today'))
    fireEvent.input(surface)
    unmount() // flushes the debounced commit (AGL-567)
    expect(lastCommittedHref()).toBe('Read {{entry.title}} today')
  })

  it('materializes raw typed {{...}} into a pill on blur', async () => {
    const { unmount } = render(<ElementPropsForm {...formProps('')} />)
    const surface = await findSurface()
    surface.appendChild(document.createTextNode('go {{entry.slug}} now'))
    fireEvent.input(surface)
    // Still plain text while typing — no re-render under the caret.
    expect(surface.querySelector('[data-token]')).toBeNull()
    fireEvent.blur(surface)
    // Structural edits remount the surface (key bump) — re-query it.
    const fresh = screen.getByTestId('token-text-field')
    const pill = fresh.querySelector('[data-token]') as HTMLElement
    expect(pill).toBeTruthy()
    expect(pill.getAttribute('data-token')).toBe('{{entry.slug}}')
    expect(pill.textContent).toBe('Slug')
    unmount()
    expect(lastCommittedHref()).toBe('go {{entry.slug}} now')
  })

  it('inserts the picked token at the captured caret', async () => {
    const { unmount } = render(<ElementPropsForm {...formProps('https://a/b')} />)
    const surface = await findSurface()
    // Caret inside the existing text: https://|a/b
    const textNode = surface.firstChild as Text
    const range = document.createRange()
    range.setStart(textNode, 8)
    range.collapse(true)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    const button = await screen.findByRole('button', {
      name: 'Insert data token',
    })
    fireEvent.mouseDown(button)
    fireEvent.click(button)
    // Entry tokens stay browsable out of context, with a resolve hint.
    expect(
      await screen.findByText(
        'Resolves in Collection entries blocks and on entry pages',
      ),
    ).toBeTruthy()
    fireEvent.click(screen.getByText('Title'))
    // Structural edits remount the surface (key bump) — re-query it.
    const fresh = screen.getByTestId('token-text-field')
    const pill = fresh.querySelector('[data-token]') as HTMLElement
    expect(pill.getAttribute('data-token')).toBe('{{entry.title}}')
    expect(fresh.textContent).toBe('https://Titlea/b')
    unmount()
    expect(lastCommittedHref()).toBe('https://{{entry.title}}a/b')
  })

  it('appends at the end when no caret was captured', async () => {
    const { unmount } = render(<ElementPropsForm {...formProps('https://a/b')} />)
    await findSurface()
    window.getSelection()?.removeAllRanges()
    const button = await screen.findByRole('button', {
      name: 'Insert data token',
    })
    fireEvent.mouseDown(button)
    fireEvent.click(button)
    fireEvent.click(await screen.findByText('Link URL'))
    unmount()
    expect(lastCommittedHref()).toBe('https://a/b{{entry.url}}')
  })

  it('removes a pill (and its token) via the pill popover', async () => {
    const { unmount } = render(
      <ElementPropsForm {...formProps('Read {{entry.title}} now')} />,
    )
    const surface = await findSurface()
    const pill = surface.querySelector('[data-token]') as HTMLElement
    fireEvent.click(pill)
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    expect(
      screen.getByTestId('token-text-field').querySelector('[data-token]'),
    ).toBeNull()
    unmount()
    expect(lastCommittedHref()).toBe('Read  now')
  })

  it('replaces a pill in place via the pill popover', async () => {
    const { unmount } = render(
      <ElementPropsForm {...formProps('Read {{entry.title}} now')} />,
    )
    const surface = await findSurface()
    const pill = surface.querySelector('[data-token]') as HTMLElement
    fireEvent.click(pill)
    fireEvent.click(await screen.findByRole('button', { name: 'Replace' }))
    // The insert picker opens anchored at the pill; pick a different token.
    fireEvent.click(await screen.findByText('Link URL'))
    const fresh = screen.getByTestId('token-text-field')
    const replaced = fresh.querySelector('[data-token]') as HTMLElement
    expect(replaced.getAttribute('data-token')).toBe('{{entry.url}}')
    expect(fresh.textContent).toBe('Read Link URL now')
    unmount()
    expect(lastCommittedHref()).toBe('Read {{entry.url}} now')
  })
})
