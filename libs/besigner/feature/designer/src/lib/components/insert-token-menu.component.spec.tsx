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
import { act, fireEvent, render, screen } from '@testing-library/react'

import ElementPropsForm from './element-props-form.component'
import {
  InsertTokenAdornment,
  InsertTokenMenu,
  insertTokenIntoText,
  type TokenFieldCapture,
} from './insert-token-menu.component'

// The insert-data picker (AGL-583): editors browse and INSERT placeholders
// ({{entry.*}}, {{collection.*}}, {{item.*}}, variables, functions) at the
// caret of token-capable attribute inputs — composing with existing text —
// instead of hand-typing the {{...}} grammar. Raw typing stays supported.
describe('insertTokenIntoText (AGL-583)', () => {
  it('splices the token at the caret, preserving text on both sides', () => {
    expect(insertTokenIntoText('Hello world', '{{entry.title}}', 6, 6)).toEqual(
      {
        value: 'Hello {{entry.title}}world',
        caret: 6 + '{{entry.title}}'.length,
      },
    )
  })

  it('replaces a selected range', () => {
    expect(insertTokenIntoText('Hello world', '{{entry.title}}', 6, 11)).toEqual({
      value: 'Hello {{entry.title}}',
      caret: 6 + '{{entry.title}}'.length,
    })
  })

  it('appends at the end when no caret was captured', () => {
    expect(insertTokenIntoText('Hello', '{{entry.title}}', null, null)).toEqual({
      value: 'Hello{{entry.title}}',
      caret: 'Hello{{entry.title}}'.length,
    })
  })

  it('clamps out-of-range positions instead of throwing', () => {
    expect(insertTokenIntoText('ab', '{{x}}', 99, 120).value).toBe('ab{{x}}')
    expect(insertTokenIntoText('ab', '{{x}}', -4, -1).value).toBe('{{x}}ab')
  })

  it('handles an empty field', () => {
    expect(insertTokenIntoText('', '{{entry.url}}', null, null).value).toBe(
      '{{entry.url}}',
    )
  })
})

describe('InsertTokenAdornment (AGL-583)', () => {
  const renderAdornment = (onOpen: jest.Mock) =>
    render(
      <div className="MuiInputBase-root">
        <input aria-label="Field" defaultValue="hello world" />
        <InsertTokenAdornment onOpen={onOpen} />
      </div>,
    )

  it('captures the sibling input and its caret while focused', () => {
    const onOpen = jest.fn()
    renderAdornment(onOpen)
    const input = screen.getByLabelText('Field') as HTMLInputElement
    input.focus()
    input.setSelectionRange(5, 5)
    const button = screen.getByRole('button', { name: 'Insert data token' })
    fireEvent.mouseDown(button)
    fireEvent.click(button)
    expect(onOpen).toHaveBeenCalledTimes(1)
    const [anchor, capture] = onOpen.mock.calls[0] as [
      HTMLElement,
      TokenFieldCapture,
    ]
    expect(anchor).toBe(button)
    expect(capture.input).toBe(input)
    expect(capture.start).toBe(5)
    expect(capture.end).toBe(5)
  })

  it('reports no caret when the input is not focused (append at end)', () => {
    const onOpen = jest.fn()
    renderAdornment(onOpen)
    const button = screen.getByRole('button', { name: 'Insert data token' })
    fireEvent.mouseDown(button)
    fireEvent.click(button)
    const [, capture] = onOpen.mock.calls[0] as [HTMLElement, TokenFieldCapture]
    expect(capture.start).toBeNull()
    expect(capture.end).toBeNull()
  })
})

describe('InsertTokenMenu (AGL-583)', () => {
  const options = [
    { group: 'Variables', label: 'Message', token: '{{var:v1}}' },
    {
      group: 'Entry',
      label: 'Title',
      token: '{{entry.title}}',
      preview: 'The entry headline.',
      groupHint: 'Resolves in Collection entries blocks and on entry pages',
    },
    {
      group: 'Entry',
      label: 'Link URL',
      token: '{{entry.url}}',
    },
  ]

  const renderMenu = (onInsert = jest.fn(), onClose = jest.fn()) => {
    const anchor = document.createElement('button')
    document.body.appendChild(anchor)
    render(
      <InsertTokenMenu
        anchorEl={anchor}
        open
        onClose={onClose}
        options={options}
        onInsert={onInsert}
      />,
    )
    return { onInsert, onClose }
  }

  it('renders group subheaders with their context hints', () => {
    renderMenu()
    expect(screen.getByText('Variables')).toBeTruthy()
    expect(screen.getByText('Entry')).toBeTruthy()
    expect(
      screen.getByText(
        'Resolves in Collection entries blocks and on entry pages',
      ),
    ).toBeTruthy()
  })

  it('filters options as you type', () => {
    renderMenu()
    fireEvent.change(screen.getByPlaceholderText('Search data…'), {
      target: { value: 'link' },
    })
    expect(screen.queryByText('Message')).toBeNull()
    expect(screen.getByText('Link URL')).toBeTruthy()
  })

  it('reports the picked token', () => {
    const { onInsert } = renderMenu()
    fireEvent.click(screen.getByText('Title'))
    expect(onInsert).toHaveBeenCalledWith('{{entry.title}}')
  })
})

describe('ElementPropsForm insert affordance (AGL-583)', () => {
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

  // ElementPropsFormProps inherits schema/componentMapper from
  // FormRendererProps, but the component supplies both internally —
  // passing them from a test would shadow the real ones via {...rest}.
  const formProps = () =>
    ({
      node: {
        $id: 'agl583-node',
        type: 'node',
        componentId: 'unregistered-link',
        props: { href: 'https://a/b' },
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

  // The attribute editors resolve through next/dynamic loadables, so the
  // fields (and their adornments) appear ASYNC on the suite's first mount
  // — always await them.
  it('renders the {x} adornment on token-capable text attributes', async () => {
    const { unmount } = render(<ElementPropsForm {...formProps()} />)
    expect(
      await screen.findByRole('button', { name: 'Insert data token' }),
    ).toBeTruthy()
    unmount()
  })

  it('inserts the picked token at the caret, concatenating with the value', async () => {
    const { unmount } = render(<ElementPropsForm {...formProps()} />)
    const input = (await screen.findByLabelText('Link')) as HTMLInputElement
    act(() => input.focus())
    // Caret inside the existing text: https://|a/b
    input.setSelectionRange(8, 8)
    const button = await screen.findByRole('button', {
      name: 'Insert data token',
    })
    fireEvent.mouseDown(button)
    fireEvent.click(button)
    // Entry tokens are browsable even out of a Collection entries block —
    // with a hint on where they resolve (this node is not on the canvas).
    expect(
      await screen.findByText(
        'Resolves in Collection entries blocks and on entry pages',
      ),
    ).toBeTruthy()
    fireEvent.click(screen.getByText('Title'))
    expect(input.value).toBe('https://{{entry.title}}a/b')
    unmount()
  })

  it('appends at the end when the field was never focused', async () => {
    const { unmount } = render(<ElementPropsForm {...formProps()} />)
    const input = (await screen.findByLabelText('Link')) as HTMLInputElement
    const button = await screen.findByRole('button', {
      name: 'Insert data token',
    })
    fireEvent.mouseDown(button)
    fireEvent.click(button)
    fireEvent.click(await screen.findByText('Link URL'))
    expect(input.value).toBe('https://a/b{{entry.url}}')
    unmount()
  })
})
