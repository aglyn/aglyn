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
 * An External URL holding only `#fragment` warns in its own helper text
 * (AGL-2867).
 *
 * The link elements declare the warning on the attribute as `resolveProps`,
 * which the attributes form hands to data-driven-forms unchanged. What is
 * proved here is the part a unit test of the function cannot see: that the
 * real form, with the token field every link attribute renders through, puts
 * the returned helper text on screen — for a value that was already stored,
 * and for one typed into the field.
 */

import * as Aglyn from '@aglyn/aglyn'
import { fireEvent, render, screen } from '@testing-library/react'
import ElementPropsForm from './element-props-form.component'

const DESCRIPTION = 'Where the button goes when it points off this site.'
const WARNING = /so #watch goes nowhere on the published page/

const hrefAttribute = {
  name: 'href',
  label: 'External URL',
  component: Aglyn.FieldComponentType.TEXT_FIELD,
  description: DESCRIPTION,
  resolveProps: Aglyn.bareFragmentLinkFieldProps,
}

const mount = (href: string) =>
  render(
    <ElementPropsForm
      node={
        {
          $id: 'cta',
          type: 'node',
          componentId: 'muiButton',
          props: { href },
          componentSchema: { attributes: [hrefAttribute] },
          nodes: [],
        } as never
      }
    />,
  )

describe('an External URL that is only a fragment (AGL-2867)', () => {
  let updateNodeProps: jest.SpyInstance

  beforeEach(() => {
    // The debounced commit flushes on unmount; the node is not in the store.
    updateNodeProps = jest
      .spyOn(Aglyn.canvas, 'updateNodeProps')
      .mockImplementation((() => undefined) as never)
  })
  afterEach(() => updateNodeProps.mockRestore())

  it('warns for a stored #fragment and names the interaction to use', async () => {
    mount('#watch')
    const warning = await screen.findByText(WARNING)
    expect(warning.textContent).toContain('Scroll to element')
    expect(screen.queryByText(DESCRIPTION)).toBeNull()
  })

  it('keeps its own description for an ordinary link', async () => {
    mount('/pricing')
    expect(await screen.findByText(DESCRIPTION)).toBeTruthy()
    expect(screen.queryByText(WARNING)).toBeNull()
  })

  it('warns as the fragment is typed', async () => {
    mount('')
    expect(await screen.findByText(DESCRIPTION)).toBeTruthy()
    const surface = await screen.findByTestId('token-text-field')
    surface.appendChild(document.createTextNode('#watch'))
    fireEvent.input(surface)
    expect(await screen.findByText(WARNING)).toBeTruthy()
  })
})
