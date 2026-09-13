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

// A stand-in icon catalog, mocked at the subpath the picker imports: the real
// one loads ~6,600 icons asynchronously, and nothing here is about it.
jest.mock('@aglyn/shared-ui-jsx/hooks/mdi-icon/use-mdi-icons-fuzzy', () => {
  const catalog = [
    { id: 'mdiRocket', name: 'Rocket', path: 'M13,22L11,18', tags: [] },
  ]
  return { useMdiIconsFuzzy: () => [catalog, catalog, jest.fn(), jest.fn()] }
})
// The grid is virtualized, which renders nothing in a zero-height jsdom box.
// Only the windowing is replaced; the cards it is handed are the real ones.
jest.mock('@aglyn/shared-ui-jsx/components/grid-list', () => ({
  GridList: ({ items, renderItemContent }: any) => (
    <div>{items.map((item: any, i: number) => renderItemContent(item, i))}</div>
  ),
}))

import * as Aglyn from '@aglyn/aglyn'
import { MdiIcons } from '@aglyn/shared-data-mdi'
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

    it('hands the choice back to the default with the clear button (Yes / no)', async () => {
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

  describe('a Choice property', () => {
    const PROPS: Aglyn.ReusableComponentProp[] = [
      {
        name: 'tint',
        type: 'choice',
        label: 'Chip tint',
        options: [
          { value: 'primary', label: 'Blue' },
          { value: 'secondary', label: 'Magenta' },
          { value: 'default' },
        ],
        defaultValue: 'secondary',
      },
    ]

    it("offers the component's answers by label, and names the default", async () => {
      mount(PROPS)
      const input = await openDropdown('Chip tint')
      expect(input.getAttribute('placeholder')).toBe(
        'Use the component default (Magenta)',
      )
      // An answer with no label is offered by its value.
      expect(
        screen.getAllByRole('option').map((option) => option.textContent),
      ).toEqual(['Blue', 'Magenta', 'default'])
    })

    it('stores the VALUE the bound field receives, not the label', async () => {
      const { unmount } = mount(PROPS)
      await openDropdown('Chip tint')
      fireEvent.click(screen.getByRole('option', { name: 'Blue' }))
      unmount()
      expect(committedValues()['tint']).toBe('primary')
    })

    it('hands the choice back to the default with the clear button', async () => {
      const { unmount } = mount(PROPS, { tint: 'primary' })
      fireEvent.click(
        await screen.findByRole(
          'button',
          { name: 'Clear Chip tint' },
          { timeout: 10000 },
        ),
      )
      unmount()
      expect(updateNodeProps).toHaveBeenCalled()
      expect(committedValues()).not.toHaveProperty('tint')
    })
  })

  describe('an Icon property', () => {
    const ROCKET = { iconId: 'mdiRocket', iconPath: 'M13,22L11,18' }
    const PROPS: Aglyn.ReusableComponentProp[] = [
      {
        name: 'productIcon',
        type: 'icon',
        label: 'Product icon',
        defaultValue: 'mdiDatabase',
        defaultIconPath: 'M12,3C7.58,3',
      },
    ]

    beforeAll(() => {
      // What the picker loads before it can offer an icon at all.
      MdiIcons.set('mdiRocket' as never, { id: 'mdiRocket', path: ROCKET.iconPath } as never)
    })
    afterAll(() => {
      MdiIcons.delete('mdiRocket' as never)
    })

    it('stores the pick with its path, which is what a published page draws', async () => {
      const { unmount } = mount(PROPS)
      const caption = await screen.findByText('Product icon', undefined, {
        timeout: 10000,
      })
      const picker = caption.closest('.MuiGrid-container')
        ?.parentElement as HTMLElement
      // The current-icon link opens the grid; picking is two steps.
      fireEvent.click(picker.querySelector('.MuiLink-root') as HTMLElement)
      fireEvent.click(
        within(picker).getByRole('button', { pressed: false, name: /Rocket/ }),
      )
      fireEvent.click(within(picker).getByRole('button', { name: 'Choose' }))
      unmount()
      expect(committedValues()['productIcon']).toEqual(ROCKET)
    })

    it("says what an unset icon shows, and clears back to it", async () => {
      const { unmount } = mount(PROPS, { productIcon: ROCKET })
      expect(
        await screen.findByRole(
          'button',
          { name: 'Help: Product icon' },
          { timeout: 10000 },
        ),
      ).toBeTruthy()
      fireEvent.click(
        await screen.findByRole('button', { name: 'Clear Product icon' }),
      )
      unmount()
      expect(updateNodeProps).toHaveBeenCalled()
      expect(committedValues()).not.toHaveProperty('productIcon')
    })
  })
})
