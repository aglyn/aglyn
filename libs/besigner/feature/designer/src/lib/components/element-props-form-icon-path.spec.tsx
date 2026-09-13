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

// The catalog never arrives: this is the window between the panel opening
// and the ~2.9 MB icon catalog finishing its lazy load.
jest.mock('@aglyn/shared-ui-jsx/hooks/mdi-icon/use-mdi-icons-fuzzy', () => ({
  useMdiIconsFuzzy: () => [[], [], jest.fn(), jest.fn()],
}))

import * as Aglyn from '@aglyn/aglyn'
import { MdiIcons } from '@aglyn/shared-data-mdi'
import { act, fireEvent, render, screen } from '@testing-library/react'

import ElementPropsForm, { iconPathsForSave } from './element-props-form.component'

const ROCKET_PATH = 'M13,22L11,18'

/**
 * An icon's path is stored beside its id because a published page cannot look
 * the id up (AGL-1212) — and the panel re-derives it on every save, including
 * saves of OTHER attributes made before the icon catalog has loaded
 * (AGL-2879). A lookup against a catalog that has not arrived answered
 * "no path", and that answer was saved: the canvas went on drawing the icon,
 * and the live page drew the empty placeholder.
 */
describe("an icon's stored path survives an edit made before the catalog loads (AGL-2879)", () => {
  let updateNodeProps: jest.SpyInstance

  beforeEach(() => {
    updateNodeProps = jest
      .spyOn(Aglyn.canvas, 'updateNodeProps')
      .mockImplementation((() => undefined) as never)
  })
  afterEach(() => {
    updateNodeProps.mockRestore()
  })

  it('keeps iconPath when another attribute is what changed', async () => {
    const { unmount } = render(
      <ElementPropsForm
        node={
          {
            $id: 'icon-before-catalog',
            type: 'node',
            componentId: 'icon',
            props: { iconId: 'mdiRocket', iconPath: ROCKET_PATH, size: 24 },
            componentSchema: {
              attributes: [
                {
                  name: 'iconId',
                  label: 'Icon',
                  component: Aglyn.FieldComponentType.ICON_PICKER,
                },
                {
                  name: 'title',
                  label: 'Title',
                  component: Aglyn.FieldComponentType.TEXT_FIELD,
                },
              ],
            },
            nodes: [],
          } as never
        }
      />,
    )
    const surface = (await screen.findByTestId('token-text-field', undefined, {
      timeout: 10000,
    })) as HTMLElement
    act(() => {
      surface.textContent = 'Launch'
      fireEvent.input(surface)
    })
    unmount()

    const calls = updateNodeProps.mock.calls
    const committed = calls[calls.length - 1]?.[1] as Record<string, unknown>
    expect(committed['title']).toBe('Launch')
    // The published page draws this, and cannot look the id up itself.
    expect(committed['iconPath']).toBe(ROCKET_PATH)
  })
})

describe('iconPathsForSave', () => {
  const ATTRIBUTES = [
    { name: 'startIconId', component: Aglyn.FieldComponentType.ICON_PICKER },
    { name: 'title', component: Aglyn.FieldComponentType.TEXT_FIELD },
  ] as never

  const stored = { startIconId: 'mdiRocket', startIconPath: ROCKET_PATH }

  afterEach(() => {
    MdiIcons.clear()
  })

  const loadCatalog = () => {
    MdiIcons.set('mdiRocket' as never, { id: 'mdiRocket', path: ROCKET_PATH } as never)
    MdiIcons.set('mdiHome' as never, { id: 'mdiHome', path: 'M10,20V14' } as never)
  }

  it('keeps the stored path for an unchanged id the catalog cannot answer yet', () => {
    expect(iconPathsForSave(ATTRIBUTES, { ...stored }, stored)).toEqual({
      startIconPath: ROCKET_PATH,
    })
  })

  it('takes the fresh path whenever the catalog has one', () => {
    loadCatalog()
    expect(
      iconPathsForSave(ATTRIBUTES, { startIconId: 'mdiHome' }, stored),
    ).toEqual({ startIconPath: 'M10,20V14' })
  })

  it("never draws the old icon's path for a new icon", () => {
    // A changed id with no answer yet: no path at all, rather than the
    // rocket's path under the new id.
    expect(
      iconPathsForSave(ATTRIBUTES, { startIconId: 'mdiHome' }, stored),
    ).toEqual({ startIconPath: undefined })
  })

  it('clears the path along with the icon', () => {
    expect(iconPathsForSave(ATTRIBUTES, { startIconId: '' }, stored)).toEqual({
      startIconPath: undefined,
    })
    // A binding is not an icon either — the page's pick brings its own path.
    expect(
      iconPathsForSave(ATTRIBUTES, { startIconId: '{{prop.icon}}' }, stored),
    ).toEqual({ startIconPath: undefined })
  })
})
