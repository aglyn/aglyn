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
import { consoleThemeCssVar, ThemeProvider } from '@aglyn/shared-ui-theme'
import { act, render, screen } from '@testing-library/react'
import ComponentPromotionContext from '../contexts/component-promotion-context'
import { elementPropsComponentMapper } from './element-props-form.component'
import { InstanceAttrOverrides } from './instance-attr-overrides.component'
import { resetPlacementPartPick } from '../utils/placement-part-pick'

/** The canvas's view, which lives on the besigner app this suite does not mount. */
let mockViewType: unknown = undefined
jest.mock('../hooks/use-aglyn-besigner-flag', () => {
  const hook = (flag: string) => [
    flag === 'viewType' ? mockViewType : undefined,
    () => undefined,
  ]
  return {
    __esModule: true,
    default: hook,
    useAglynBesignerFlag: hook,
    useAglynBesignerSetFlag: () => () => undefined,
  }
})

/**
 * A reusable block placed in an email (AGL-3287): the same "change it here"
 * section a page's placement gets — the email is built from these settings —
 * worded for the email the author has open.
 */
describe('the attribute section on a block placed in an email (AGL-3287)', () => {
  const SECTION = 'specEmailSection'
  const TEXT = 'specEmailText'

  const definition = {
    rootId: 'band',
    nodes: {
      band: { $id: 'band', componentId: SECTION, nodes: ['name'] },
      name: {
        $id: 'name',
        parentId: 'band',
        componentId: TEXT,
        props: { children: 'Your company', color: '#1a1a1a' },
      },
    },
  } as any

  beforeAll(() => {
    ;(Aglyn.components.schemas as Record<string, any>)[SECTION] = {
      $id: SECTION,
      displayName: 'Email section',
      attributes: [
        { name: 'backgroundColor', label: 'Background color', component: 'text-field' },
      ],
    }
    ;(Aglyn.components.schemas as Record<string, any>)[TEXT] = {
      $id: TEXT,
      displayName: 'Email text',
      attributes: [
        { name: 'children', label: 'Text', component: 'textarea' },
        { name: 'color', label: 'Color', component: 'text-field' },
      ],
    }
  })
  afterAll(() => {
    delete (Aglyn.components.schemas as Record<string, any>)[SECTION]
    delete (Aglyn.components.schemas as Record<string, any>)[TEXT]
  })
  afterEach(() => {
    mockViewType = undefined
    Aglyn.canvas.reset()
    resetPlacementPartPick()
  })

  const renderSection = async () => {
    Aglyn.canvas.reset()
    Aglyn.canvas.setNodes({
      root: { $id: 'root', componentId: 'div', nodes: ['inst'] },
      inst: {
        $id: 'inst',
        parentId: 'root',
        componentId: Aglyn.REUSABLE_INSTANCE_COMPONENT_ID,
        props: { refId: 'header' },
      },
    } as any)
    render(
      <ThemeProvider theme={consoleThemeCssVar}>
        <ComponentPromotionContext.Provider
          value={{ definitions: { header: definition } } as any}
        >
          <InstanceAttrOverrides
            node={Aglyn.canvas.getNode('inst') as Aglyn.NodeSchema}
            componentMapper={elementPropsComponentMapper}
          />
        </ComponentPromotionContext.Provider>
      </ThemeProvider>,
    )
    await act(async () => undefined)
  }

  it('says the change stays in this email, and calls the block a block', async () => {
    mockViewType = Aglyn.HostViewType.EMAIL
    await renderSection()
    expect(screen.getByText('Change it in this email only')).toBeTruthy()
    expect(
      screen.getByText(
        'Changes here affect this email only. The block itself, and every ' +
          'other email using it, stay the same.',
      ),
    ).toBeTruthy()
    expect(screen.getByText('Whole block')).toBeTruthy()
    expect(screen.getByText('No changes in this email yet')).toBeTruthy()
    // The settings stay on offer — they are what the email is built from.
    expect(screen.getByLabelText('Background color')).toBeTruthy()
    expect(screen.queryByText(/on this page/)).toBeNull()
  })

  it('CONTROL — the same placement on a page keeps the page wording', async () => {
    mockViewType = Aglyn.HostViewType.SCREEN
    await renderSection()
    expect(screen.getByText('Change it on this page only')).toBeTruthy()
    expect(screen.getByText('Whole component')).toBeTruthy()
  })
})
