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
 * An attribute's `resolveProps` is handed the element it edits (AGL-2886).
 *
 * The Link Container's Accessible label warns while nothing inside the box
 * names its link, and what is inside the box is not in the form's values: they
 * are the element's own props. The Attributes panel passes the node and a
 * canvas lookup as a fourth argument. The rule itself is proved beside the
 * element in the mui plugin; what is proved here is the part that plugin's
 * spec cannot see — that the real form supplies the context, reads children
 * from the live canvas, and draws the helper text that comes back, both for
 * the stored value and as the author types.
 */

import * as Aglyn from '@aglyn/aglyn'
import { fireEvent, render, screen } from '@testing-library/react'
import ElementPropsForm, {
  withAttributeFieldContext,
} from './element-props-form.component'

const DESCRIPTION = 'Names this link for screen readers.'

/** Stands in for the Link Container rule: says what the box holds, until labeled. */
const labelAttribute = {
  name: 'ariaLabel',
  label: 'Accessible label',
  component: Aglyn.FieldComponentType.TEXT_FIELD,
  description: DESCRIPTION,
  resolveProps: ((_props, field, _options, context) => {
    if (!context || field?.input?.value) return {}
    const inside = (context.node.nodes ?? []).map(
      (id) => context.getNode(id)?.componentId ?? 'nothing',
    )
    return { helperText: `${context.node.$id} holds ${inside.join(', ')}` }
  }) as Aglyn.AttributeResolveProps,
}

const glyph = { $id: 'glyph', type: 'node', componentId: 'icon', props: {} }

const mount = (ariaLabel: string) =>
  render(
    <ElementPropsForm
      node={
        {
          $id: 'card-arrow',
          type: 'node',
          componentId: 'muiLinkBox',
          props: { ariaLabel },
          componentSchema: { attributes: [labelAttribute] },
          nodes: ['glyph'],
        } as never
      }
    />,
  )

describe("an attribute's resolveProps sees the element (AGL-2886)", () => {
  let updateNodeProps: jest.SpyInstance
  let getNode: jest.SpyInstance

  beforeEach(() => {
    // The debounced commit flushes on unmount; the node is not in the store.
    updateNodeProps = jest
      .spyOn(Aglyn.canvas, 'updateNodeProps')
      .mockImplementation((() => undefined) as never)
    getNode = jest
      .spyOn(Aglyn.canvas, 'getNode')
      .mockImplementation(((id: string) =>
        id === glyph.$id ? glyph : undefined) as never)
  })
  afterEach(() => {
    updateNodeProps.mockRestore()
    getNode.mockRestore()
  })

  it('hands it the node, and reads the children from the canvas', async () => {
    mount('')
    expect(await screen.findByText('card-arrow holds icon')).toBeTruthy()
    expect(getNode).toHaveBeenCalledWith('glyph')
    expect(screen.queryByText(DESCRIPTION)).toBeNull()
  })

  it("keeps the field's own description when the rule has nothing to say", async () => {
    mount('Datasets product page')
    expect(await screen.findByText(DESCRIPTION)).toBeTruthy()
  })

  it('follows the value as it is typed, with the element still in hand', async () => {
    mount('')
    expect(await screen.findByText('card-arrow holds icon')).toBeTruthy()
    const surface = await screen.findByTestId('token-text-field')
    surface.appendChild(document.createTextNode('Datasets'))
    fireEvent.input(surface)
    expect(await screen.findByText(DESCRIPTION)).toBeTruthy()
    expect(screen.queryByText('card-arrow holds icon')).toBeNull()
  })
})

describe('withAttributeFieldContext (AGL-2886)', () => {
  const context: Aglyn.AttributeFieldContext = {
    node: { $id: 'card-arrow', type: 'node', nodes: [] } as never,
    getNode: () => undefined,
  }

  it('returns a field that declares no resolveProps untouched', () => {
    const field = { name: 'href', component: 'text-field' }
    expect(withAttributeFieldContext(field, context)).toBe(field)
  })

  it('returns the field untouched when there is no element to hand over', () => {
    expect(withAttributeFieldContext(labelAttribute, undefined)).toBe(
      labelAttribute,
    )
  })

  it("passes data-driven-forms' three arguments through, then the context", () => {
    const resolveProps = jest.fn(() => ({ helperText: 'x' }))
    const wrapped = withAttributeFieldContext(
      { name: 'ariaLabel', resolveProps },
      context,
    )
    const call = wrapped.resolveProps as unknown as (
      ...args: unknown[]
    ) => unknown
    expect(call('props', 'field', 'options')).toEqual({ helperText: 'x' })
    expect(resolveProps).toHaveBeenCalledWith(
      'props',
      'field',
      'options',
      context,
    )
  })
})
