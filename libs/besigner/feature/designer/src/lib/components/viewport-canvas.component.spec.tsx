/**
 * @license
 * Copyright 2021 Aglyn LLC
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

import { deleteBesignerApp, initializeBesignerApp } from '@aglyn/besigner'
import { consoleOptions, createResponsiveTheme } from '@aglyn/shared-ui-theme'
import { ThemeProvider } from '@mui/material/styles'
import { render } from '@testing-library/react'

import { BesignerRootProviderComponent } from './besigner-root-provider.component'
import ViewportCanvasComponent from './viewport-canvas.component'

const theme = createResponsiveTheme({ themeOptions: consoleOptions })

describe('ViewportCanvasComponent', () => {
  const appName = 'viewport-canvas-test'

  beforeEach(() => {
    initializeBesignerApp({ appName })
  })
  afterEach(() => {
    deleteBesignerApp(appName)
  })

  it('should render successfully', () => {
    const { baseElement } = render(
      <ThemeProvider theme={theme}>
        <BesignerRootProviderComponent appName={appName}>
          <ViewportCanvasComponent />
        </BesignerRootProviderComponent>
      </ThemeProvider>,
    )
    expect(baseElement).toBeTruthy()
  })
})
