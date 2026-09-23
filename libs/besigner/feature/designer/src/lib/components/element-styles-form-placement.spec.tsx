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
import { act, fireEvent, render, screen } from '@testing-library/react'
import ComponentPromotionContext from '../contexts/component-promotion-context'
import ElementStylesForm from './element-styles-form.component'

/**
 * The Styles tab's "Change it on this page only" section (AGL-3288): the same
 * plain words as the Attributes tab, and a changed setting named by its
 * field label — never by the key it is stored under.
 */
describe('styles panel on a component placement (AGL-3288)', () => {
  const definition = {
    rootId: 'top',
    nodes: {
      top: { $id: 'top', componentId: 'muiCard', nodes: ['title'] },
      title: {
        $id: 'title',
        parentId: 'top',
        componentId: 'muiTypography',
        props: { children: 'Besigner' },
      },
    },
  } as any

  const seed = (styleOverrides?: Record<string, any>) => {
    Aglyn.canvas.reset()
    Aglyn.canvas.setNodes({
      root: { $id: 'root', componentId: 'muiStack', nodes: ['inst'] },
      inst: {
        $id: 'inst',
        parentId: 'root',
        componentId: Aglyn.REUSABLE_INSTANCE_COMPONENT_ID,
        props: { refId: 'widget' },
        ...(styleOverrides ? { styleOverrides } : {}),
      },
    } as any)
    return Aglyn.canvas.getNode('inst') as Aglyn.NodeSchema
  }
  const live = () => Aglyn.canvas.getNode('inst') as any

  const renderPanel = async (node: Aglyn.NodeSchema) => {
    render(
      <ThemeProvider theme={consoleThemeCssVar}>
        <ComponentPromotionContext.Provider
          value={{ definitions: { widget: definition } } as any}
        >
          <ElementStylesForm node={node} />
        </ComponentPromotionContext.Provider>
      </ThemeProvider>,
    )
    await act(async () => undefined)
  }

  afterEach(() => Aglyn.canvas.reset())

  it('says what the section does, in plain words', async () => {
    await renderPanel(seed())
    expect(screen.getByText('Change it on this page only')).toBeTruthy()
    expect(screen.getByLabelText('Which part?')).toBeTruthy()
    expect(screen.getByText('Whole component')).toBeTruthy()
    expect(screen.getByText('No changes on this page yet')).toBeTruthy()
    expect(screen.queryByText(/Style target|Instance overrides/)).toBeNull()
  })

  it('lists a change by its field label, and resets all in one step', async () => {
    await renderPanel(
      seed({ root: { borderRadius: 4, mt: 2 }, title: { color: 'red' } }),
    )
    expect(screen.getByText('3 changes on this page')).toBeTruthy()
    // The chip is the reset control, named for the field it resets.
    expect(
      screen.getByRole('button', {
        name: "Reset Corner Radius to the component's value",
      }),
    ).toBeTruthy()
    expect(
      screen.getByRole('button', {
        name: "Reset Top margin to the component's value",
      }),
    ).toBeTruthy()
    expect(screen.queryByText('borderRadius')).toBeNull()
    const transact = jest.spyOn(Aglyn.canvas, 'transact')
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /^Reset every/ }))
    })
    await act(async () => undefined)
    expect(transact).toHaveBeenCalledTimes(1)
    expect(live().styleOverrides).toBeUndefined()
    transact.mockRestore()
  })
})
