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
import ElementPropsForm, {
  instanceFormattedProps,
  resolveAttributeField,
  withoutFormatting,
} from './element-props-form.component'
import {
  RICH_TEXT_FIELD_COMPONENT,
  readRichTextSurface,
} from './rich-text-field.component'

describe('the Text field of an element that takes formatted text (AGL-2486)', () => {
  let updateNodeProps: jest.SpyInstance
  beforeEach(() => {
    updateNodeProps = jest
      .spyOn(Aglyn.canvas, 'updateNodeProps')
      .mockImplementation((() => undefined) as any)
  })
  afterEach(() => {
    updateNodeProps.mockRestore()
  })

  const formProps = (props: Record<string, unknown>) =>
    ({
      node: {
        $id: 'rich-node',
        type: 'node',
        componentId: 'unregistered-typography',
        props,
        componentSchema: {
          flags: {
            textEditable: Aglyn.FEATURE_FLAG.ENABLED,
            richTextEditable: Aglyn.FEATURE_FLAG.ENABLED,
          },
          attributes: [
            {
              name: 'children',
              label: 'Text',
              component: Aglyn.FieldComponentType.TEXTAREA,
            },
          ],
        },
        nodes: [],
      },
    }) as any

  const surface = async () =>
    (await screen.findByRole('textbox', { name: '' })) as HTMLElement

  const lastCommit = (): Record<string, unknown> => {
    const call = updateNodeProps.mock.calls[
      updateNodeProps.mock.calls.length - 1
    ] as unknown[]
    return (call?.[1] ?? {}) as Record<string, unknown>
  }

  it('shows the text WITH its formatting, editable, with no read-only note', async () => {
    const { unmount } = render(
      <ElementPropsForm
        {...formProps({
          children: 'the console and the email',
          html: 'the <b>console</b> and the email',
        })}
      />,
    )
    const field = await surface()
    expect(field.innerHTML).toBe('the <b>console</b> and the email')
    expect(field.getAttribute('contenteditable')).toBe('true')
    expect(screen.queryByText(/This text is formatted — double-click/)).toBeNull()
    unmount()
  })

  it('offers the formatting tools while it is in use', async () => {
    const { unmount } = render(
      <ElementPropsForm {...formProps({ children: 'Plain words' })} />,
    )
    const field = await surface()
    expect(screen.queryByRole('button', { name: 'Bold' })).toBeNull()
    act(() => {
      fireEvent.focus(field)
    })
    for (const tool of ['Bold', 'Italic', 'Underline', 'Insert link']) {
      expect(screen.getByRole('button', { name: tool })).toBeTruthy()
    }
    unmount()
  })

  it('writes the words and the markup together, as the canvas editor does', async () => {
    const { unmount } = render(
      <ElementPropsForm {...formProps({ children: 'Plain words' })} />,
    )
    const field = await surface()
    act(() => {
      field.innerHTML = 'Plain <i>words</i>'
      fireEvent.input(field)
    })
    // Leaving the field forces the debounced commit out (AGL-567).
    act(() => {
      fireEvent.blur(field)
    })
    unmount()
    expect(lastCommit()).toMatchObject({
      children: 'Plain words',
      html: 'Plain <i>words</i>',
    })
  })

  it('stores plain text plain — the markup key absent, not empty', async () => {
    const { unmount } = render(
      <ElementPropsForm
        {...formProps({ children: 'Was bold', html: '<b>Was bold</b>' })}
      />,
    )
    const field = await surface()
    act(() => {
      field.innerHTML = 'Was bold'
      fireEvent.input(field)
      fireEvent.blur(field)
    })
    unmount()
    expect(lastCommit().children).toBe('Was bold')
    expect('html' in lastCommit()).toBe(false)
  })
})

describe('readRichTextSurface', () => {
  it('turns pills back into their tokens before reading', () => {
    const surface = document.createElement('div')
    surface.innerHTML =
      'Hi <span data-token="{{item.name}}" contenteditable="false">Name</span>, <b>welcome</b>'
    expect(readRichTextSurface(surface, { phrasingOnly: false })).toEqual({
      plain: 'Hi {{item.name}}, welcome',
      markup: 'Hi {{item.name}}, <b>welcome</b>',
    })
  })
})

describe('which text fields are formatted', () => {
  it('rewrites a named text field to the rich field, with its markup path', () => {
    const field = resolveAttributeField(
      {
        name: 'propValues.headline',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
      },
      {
        richTextFields: {
          'propValues.headline': {
            markupName: 'propHtml.headline',
            commands: [Aglyn.RICH_TEXT_COMMANDS.EMPHASIS],
          },
        },
      },
    )
    expect(field).toMatchObject({
      component: RICH_TEXT_FIELD_COMPONENT,
      markupName: 'propHtml.headline',
      richCommands: [Aglyn.RICH_TEXT_COMMANDS.EMPHASIS],
    })
  })

  it('keeps an instance prop read-only when its markup cannot be drawn any more', () => {
    const field = resolveAttributeField(
      {
        name: 'propValues.headline',
        component: Aglyn.FieldComponentType.TEXT_FIELD,
      },
      { values: { propHtml: { headline: '<b>Hi</b>' } } },
    )
    expect(field['isReadOnly']).toBe(true)
  })

  it('reads an instance’s formatted props, and Remove formatting drops them all', () => {
    const props = {
      refId: 'hero',
      propValues: { headline: 'Hi' },
      propHtml: { headline: '<b>Hi</b>', body: '' },
    }
    expect(instanceFormattedProps(props)).toEqual({ headline: '<b>Hi</b>' })
    expect(withoutFormatting(props)).toEqual({
      refId: 'hero',
      propValues: { headline: 'Hi' },
    })
  })
})
