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
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'

import ComponentPromotionContext from '../contexts/component-promotion-context'
import ElementPropsForm from './element-props-form.component'

/**
 * What a page sets for a component's properties, in the Attributes panel of
 * the instance that places it (AGL-2871).
 *
 * The field builders are pinned as pure functions in
 * `element-props-form.component.spec.tsx`. This drives the rendered panel,
 * because what those builders cannot show is the round trip through the
 * form renderer: that a choice lands in `propValues` as the value the graft
 * reads, and that clearing it leaves nothing behind for the default to lose
 * to.
 */

const definitionWith = (props: Aglyn.ReusableComponentProp[]) => ({
  heroFilm: { rootId: 'root', nodes: {}, props } as never,
})

describe("an instance's property fields (AGL-2871)", () => {
  let updateNodeProps: jest.SpyInstance

  beforeEach(() => {
    updateNodeProps = jest
      .spyOn(Aglyn.canvas, 'updateNodeProps')
      .mockImplementation((() => undefined) as never)
  })
  afterEach(() => {
    updateNodeProps.mockRestore()
  })

  const mount = (
    props: Aglyn.ReusableComponentProp[],
    propValues?: Record<string, unknown>,
  ) =>
    render(
      <ComponentPromotionContext.Provider
        value={{ definitions: definitionWith(props) }}
      >
        <ElementPropsForm
          node={
            {
              $id: 'agl2871-instance',
              type: 'node',
              componentId: Aglyn.REUSABLE_INSTANCE_COMPONENT_ID,
              props: { refId: 'heroFilm', ...(propValues && { propValues }) },
              componentSchema: { attributes: [] },
              nodes: [],
            } as never
          }
        />
      </ComponentPromotionContext.Provider>,
    )

  /** The instance's `propValues` as the LAST commit wrote them. */
  const committedValues = (): Record<string, unknown> => {
    const calls = updateNodeProps.mock.calls
    const props = (calls[calls.length - 1]?.[1] ?? {}) as Record<string, any>
    return props[Aglyn.REUSABLE_INSTANCE_PROP_VALUES_KEY] ?? {}
  }

  /** Opens a dropdown field by its label and returns the options it offers. */
  const openDropdown = async (label: string) => {
    const input = await screen.findByRole(
      'combobox',
      { name: label },
      { timeout: 10000 },
    )
    const field = input.closest('.MuiAutocomplete-root') as HTMLElement
    fireEvent.click(within(field).getByTitle('Open'))
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeTruthy())
    return input
  }

  describe('a Yes / no property', () => {
    const PROPS: Aglyn.ReusableComponentProp[] = [
      {
        name: 'playInLightbox',
        type: 'boolean',
        label: 'Play in a lightbox',
        defaultValue: 'true',
      },
    ]

    it('names the default it falls back to while the page sets nothing', async () => {
      mount(PROPS)
      const input = await screen.findByRole(
        'combobox',
        { name: 'Play in a lightbox' },
        { timeout: 10000 },
      )
      expect(input.getAttribute('placeholder')).toBe(
        'Use the component default (Yes)',
      )
    })

    it('stores the choice as a real boolean', async () => {
      const { unmount } = mount(PROPS)
      await openDropdown('Play in a lightbox')
      expect(
        screen.getAllByRole('option').map((option) => option.textContent),
      ).toEqual(['Yes', 'No'])

      fireEvent.click(screen.getByRole('option', { name: 'No' }))
      unmount()
      expect(committedValues()['playInLightbox']).toBe(false)
    })

    it('shows a stored no as No, even one stored as text', async () => {
      mount(PROPS, { playInLightbox: 'false' })
      const input = await screen.findByRole(
        'combobox',
        { name: 'Play in a lightbox' },
        { timeout: 10000 },
      )
      expect((input as HTMLInputElement).value).toBe('No')
    })

    it('hands the choice back to the default with the clear button', async () => {
      const { unmount } = mount(PROPS, { playInLightbox: false })
      fireEvent.click(
        await screen.findByRole(
          'button',
          { name: 'Clear Play in a lightbox' },
          { timeout: 10000 },
        ),
      )
      unmount()
      // A commit happened — an absent value is not merely an absent save.
      expect(updateNodeProps).toHaveBeenCalled()
      expect(committedValues()).not.toHaveProperty('playInLightbox')
    })
  })
})
