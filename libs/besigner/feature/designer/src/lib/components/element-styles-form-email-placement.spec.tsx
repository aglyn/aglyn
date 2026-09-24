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
import ElementStylesForm from './element-styles-form.component'

/**
 * The canvas's view lives on the besigner app, which this suite does not
 * mount; every other flag the panel reads stays unset, as it is by default.
 */
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
 * The Styles tab on a reusable block placed in an EMAIL (AGL-3287).
 *
 * An email is built from each block's own settings and never reads a style,
 * so a per-email restyle would show on the canvas and reach no inbox. The tab
 * offers none, and says in one line where a block's look is changed instead.
 */
describe('styles panel on a block placed in an email (AGL-3287)', () => {
  const definition = {
    rootId: 'band',
    nodes: {
      band: { $id: 'band', componentId: 'emailSection', nodes: ['name'] },
      name: {
        $id: 'name',
        parentId: 'band',
        componentId: 'emailText',
        props: { children: 'Your company' },
      },
    },
  } as any

  const seed = (placed: boolean) => {
    Aglyn.canvas.reset()
    Aglyn.canvas.setNodes({
      root: { $id: 'root', componentId: 'div', nodes: ['el'] },
      el: placed
        ? {
            $id: 'el',
            parentId: 'root',
            componentId: Aglyn.REUSABLE_INSTANCE_COMPONENT_ID,
            props: { refId: 'header' },
          }
        : {
            $id: 'el',
            parentId: 'root',
            componentId: 'emailText',
            props: { children: 'Hello' },
          },
    } as any)
    return Aglyn.canvas.getNode('el') as Aglyn.NodeSchema
  }

  const renderPanel = async (node: Aglyn.NodeSchema) => {
    render(
      <ThemeProvider theme={consoleThemeCssVar}>
        <ComponentPromotionContext.Provider
          value={{ definitions: { header: definition } } as any}
        >
          <ElementStylesForm node={node} />
        </ComponentPromotionContext.Provider>
      </ThemeProvider>,
    )
    await act(async () => undefined)
  }

  afterEach(() => {
    mockViewType = undefined
    Aglyn.canvas.reset()
  })

  it('offers no style change on a placed block, and says where its look is changed', async () => {
    mockViewType = Aglyn.HostViewType.EMAIL
    await renderPanel(seed(true))
    expect(
      screen.getByText(
        "In emails, change a block's look with its settings in the Attributes tab.",
      ),
    ).toBeTruthy()
    // None of the panel's editors, and no "change it here" section to fill.
    expect(screen.queryByLabelText('Search styles')).toBeNull()
    expect(screen.queryByLabelText('Which part?')).toBeNull()
    expect(screen.queryByText(/Change it (on this page|in this email) only/)).toBeNull()
  })

  it('CONTROL — the same placement on a page keeps its section', async () => {
    // Without this, the case above passes against a panel that dropped the
    // placement section everywhere.
    mockViewType = Aglyn.HostViewType.SCREEN
    await renderPanel(seed(true))
    expect(screen.getByText('Change it on this page only')).toBeTruthy()
    expect(
      screen.queryByText(
        "In emails, change a block's look with its settings in the Attributes tab.",
      ),
    ).toBeNull()
  })

  it("leaves an email's own blocks with the panel they always had", async () => {
    // Only a PLACEMENT is refused here; a block that is not one keeps the
    // panel exactly as before this change.
    mockViewType = Aglyn.HostViewType.EMAIL
    await renderPanel(seed(false))
    expect(screen.getByLabelText('Search styles')).toBeTruthy()
    expect(
      screen.queryByText(
        "In emails, change a block's look with its settings in the Attributes tab.",
      ),
    ).toBeNull()
  })
})
