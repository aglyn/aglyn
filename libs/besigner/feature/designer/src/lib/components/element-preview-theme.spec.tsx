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
  consoleThemeCssVar,
  HostThemeDocumentContext,
  ThemeProvider,
} from '@aglyn/shared-ui-theme'
import { useTheme } from '@mui/material'
import { cleanup, render } from '@testing-library/react'

import { publishActiveHostTheme } from '../utils/active-host-theme'
import ElementDetailOverlay from './element-detail-overlay.component'
import ElementPreview from './element-preview.component'

const theme = consoleThemeCssVar

/** Nothing like the console's brand, so "themed" and "not themed" differ. */
const SITE_PRIMARY = '#6f4e37'

const HOST_THEME: any = {
  colorSchemes: { light: { primary: { main: SITE_PRIMARY } } },
}

const BAR_ID = 'theme-spec-bar'

const PRESET = {
  $id: 'theme-spec-preset',
  type: Aglyn.NodeType.PRESET,
  displayName: 'Themed Bar',
  category: Aglyn.ComponentCategory.NAVIGATION,
  data: { $id: null, componentId: BAR_ID, props: { children: 'Your Brand' } },
}

/** Reads the colour the preview actually painted, from the shadow root. */
function previewPrimary(): string {
  const host = document.querySelector('[data-preview-root]') as HTMLElement
  const painted = host?.shadowRoot?.querySelector(
    '[data-themed-bar]',
  ) as HTMLElement
  return painted?.getAttribute('data-painted') ?? ''
}

describe('the element preview is themed to the SITE, wherever it is mounted (AGL-2486)', () => {
  beforeAll(() => {
    // Reads the resolved palette and reports it, so the assertion reads the
    // theme the subtree actually received rather than a class name.
    const ThemedBar = (props: any) => {
      const active = useTheme()
      return (
        <div data-themed-bar data-painted={active?.palette?.primary?.main}>
          {props?.children}
        </div>
      )
    }
    Aglyn.components.registerComponent(ThemedBar as any,
      {
        $id: BAR_ID,
        pluginId: 'mui',
        displayName: 'Themed Bar',
        category: Aglyn.ComponentCategory.NAVIGATION,
      } as Aglyn.ComponentSchema,
    )
  })
  afterEach(cleanup)

  it('paints the site palette when mounted in the tree', () => {
    render(
      <ThemeProvider theme={theme}>
        <HostThemeDocumentContext.Provider value={HOST_THEME}>
          <ElementPreview node={PRESET} />
        </HostThemeDocumentContext.Provider>
      </ThemeProvider>,
    )
    expect(previewPrimary()).toBe(SITE_PRIMARY)
  })

  it('paints the site palette when PORTALLED out of the tree', () => {
    // The floating panel and the dialog's pane both portal. A preview whose
    // brand depends on where it is mounted is worse than no preview: it
    // sends an author to a component they believe matches their site.
    const anchor = document.createElement('div')
    document.body.appendChild(anchor)
    render(
      <ThemeProvider theme={theme}>
        <HostThemeDocumentContext.Provider value={HOST_THEME}>
          <ElementDetailOverlay item={PRESET} anchor={anchor} />
        </HostThemeDocumentContext.Provider>
      </ThemeProvider>,
    )
    expect(previewPrimary()).toBe(SITE_PRIMARY)
  })

  it('paints the site palette with NO host-theme ancestry at all', () => {
    // The Choose-element dialog's real situation: `withBesignerContext`
    // wraps the besigner page, so the dialog it renders is an ANCESTOR of
    // `HostThemeDocumentContext.Provider`, not a descendant. It therefore
    // saw no host theme and fell back to the console's own brand — an
    // Aglyn-cyan header on a brown site.
    publishActiveHostTheme(HOST_THEME)
    try {
      render(
        <ThemeProvider theme={theme}>
          <ElementPreview node={PRESET} />
        </ThemeProvider>,
      )
      expect(previewPrimary()).toBe(SITE_PRIMARY)
    } finally {
      publishActiveHostTheme(undefined)
    }
  })

  it('still prefers real context over the register', () => {
    publishActiveHostTheme({
      colorSchemes: { light: { primary: { main: '#ff0000' } } },
    })
    try {
      render(
        <ThemeProvider theme={theme}>
          <HostThemeDocumentContext.Provider value={HOST_THEME}>
            <ElementPreview node={PRESET} />
          </HostThemeDocumentContext.Provider>
        </ThemeProvider>,
      )
      expect(previewPrimary()).toBe(SITE_PRIMARY)
    } finally {
      publishActiveHostTheme(undefined)
    }
  })
})
