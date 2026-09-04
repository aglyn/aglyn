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

// A number-typed attribute persists a NUMBER. The panel's controls can only
// hand back a string, and the renderer reads these props as numbers — MUI
// draws `size: 24` as 24px and passes `'24'` through as CSS that does not
// parse, so the icon silently fell back to its default size the moment the
// box was retyped. Exercised through the real form so the parse and the
// debounced commit (AGL-567) are the ones under test.
describe('number-typed attributes commit numbers', () => {
  let updateNodeProps: jest.SpyInstance

  beforeEach(() => {
    // Debounced commits flush on unmount — keep them off the real canvas
    // store, the node under test is not in it.
    updateNodeProps = jest
      .spyOn(Aglyn.canvas, 'updateNodeProps')
      .mockImplementation((() => undefined) as any)
  })
  afterEach(() => updateNodeProps.mockRestore())

  /** Icon-shaped node: a number-typed `size` beside a free-text `label`. */
  const formProps = (props: Record<string, unknown>) =>
    ({
      node: {
        $id: 'icon-node',
        type: 'node',
        componentId: 'icon',
        props,
        componentSchema: {
          attributes: [
            {
              name: 'size',
              label: 'Size (px)',
              component: Aglyn.FieldComponentType.TEXT_FIELD,
              type: 'number',
            },
            {
              name: 'label',
              label: 'Label',
              component: Aglyn.FieldComponentType.TEXT_FIELD,
            },
          ],
        },
        nodes: [],
      },
    }) as any

  /** The committed value for `name` on the LAST updateNodeProps call. */
  const committed = (name: string): unknown => {
    const call = updateNodeProps.mock.calls[
      updateNodeProps.mock.calls.length - 1
    ] as unknown[]
    return (call?.[1] as Record<string, unknown>)?.[name]
  }

  const SIZE = 0
  const LABEL = 1

  /** Types `text` into the nth token surface, as the browser would. */
  const type = async (field: number, text: string) => {
    const surfaces = await screen.findAllByTestId('token-text-field')
    const surface = surfaces[field] as HTMLElement
    surface.textContent = text
    fireEvent.input(surface)
  }

  it('stores a typed number as a number', async () => {
    const { unmount } = render(<ElementPropsForm {...formProps({ size: 24 })} />)
    await type(SIZE, '22')
    unmount() // flushes the debounced commit
    expect(committed('size')).toBe(22)
  })

  it('leaves a free-text attribute holding digits as a string', async () => {
    const { unmount } = render(
      <ElementPropsForm {...formProps({ size: 24, label: '2025' })} />,
    )
    await type(LABEL, '2026')
    unmount()
    expect(committed('label')).toBe('2026')
  })

  it('keeps a binding in a number field, and still commits', async () => {
    const { unmount } = render(<ElementPropsForm {...formProps({ size: 24 })} />)
    await type(SIZE, '{{var:iconSize}}')
    unmount()
    // A pattern validator on the field would make the form invalid, and the
    // panel's autosave only commits while it is valid — every attribute on
    // the element would stop saving with nothing on screen to say so.
    expect(updateNodeProps).toHaveBeenCalled()
    expect(committed('size')).toBe('{{var:iconSize}}')
  })

  it('heals a value already stored as text on the next commit', async () => {
    const { unmount } = render(
      <ElementPropsForm {...formProps({ size: '24', label: 'a' })} />,
    )
    await type(LABEL, 'b')
    unmount()
    expect(committed('size')).toBe(24)
  })
})
