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
import { createTheme, ThemeProvider } from '@aglyn/shared-ui-theme'
import { render, screen } from '@testing-library/react'
import TreeRoot from './tree-root'

/**
 * An ALPHA'd theme colour reaching the render (AGL-2486, item 6).
 *
 * There is exactly ONE node renderer — this `Leaf` — and canvas, preview and
 * the tenant page all mount it, so asserting the sx it composes is the same
 * assertion on all three surfaces. That matters more here than it did for
 * gradients: the whole argument for storing a REFERENCE rather than a
 * flattened `rgba(0, 176, 255, 0.12)` is that the reference keeps resolving
 * against whatever palette the published site is built with, and this is the
 * only place that claim can be checked end to end.
 *
 * The stored value is MUI's own channel form:
 * `rgba(var(--mui-palette-primary-mainChannel, 0 176 255) / 0.12)`.
 */
const WASH = 'rgba(var(--mui-palette-primary-mainChannel, 0 176 255) / 0.12)'

/** Echoes the sx the ONE renderer composed, so the test can read it. */
const SxProbe = ({ sx, ...rest }: any) => (
  <div {...rest} data-sx={JSON.stringify(sx)} />
)

const siteTheme = (primary: string, mode: 'light' | 'dark' = 'light') =>
  createTheme({ palette: { mode, primary: { main: primary } } })

const renderNode = (sx: Record<string, unknown>, theme: any) => {
  Aglyn.components.registerComponent(SxProbe as any, {
    $id: 'alpha-probe',
    pluginId: 'test',
  } as any)
  render(
    <ThemeProvider theme={theme}>
      <TreeRoot
        node={
          {
            $id: 'root',
            componentId: 'alpha-probe',
            pluginId: 'test',
            props: { 'data-testid': 'probe' },
            sx,
            children: [],
          } as any
        }
      />
    </ThemeProvider>,
  )
  const raw = screen.getByTestId('probe').getAttribute('data-sx') ?? '[]'
  const composed = JSON.parse(raw)
  return Object.assign(
    {},
    ...(Array.isArray(composed) ? composed : [composed]).filter(Boolean),
  ) as Record<string, any>
}

afterEach(() => {
  Aglyn.components.unregisterComponent('alpha-probe')
})

describe('Leaf alpha on a palette token (AGL-2486)', () => {
  it('renders the token at the authored opacity', () => {
    const sx = renderNode(
      { backgroundColor: WASH },
      siteTheme('#00B0FF'),
    )
    expect(sx['backgroundColor']).toBe('rgba(0 176 255 / 0.12)')
  })

  it('follows a WHITE-LABEL palette instead of the authored colour', () => {
    // The reason the value is not flattened at author time. The same stored
    // string, a different host palette, a different rendered colour — a
    // literal `rgba(0, 176, 255, 0.12)` would have kept the old brand blue
    // for ever and reported nothing.
    const sx = renderNode(
      { backgroundColor: WASH },
      siteTheme('#7A1FA2'),
    )
    expect(sx['backgroundColor']).toBe('rgba(122 31 162 / 0.12)')
  })

  it('follows the active scheme, like any other token', () => {
    const sx = renderNode({ color: WASH }, siteTheme('#66D3FF', 'dark'))
    expect(sx['color']).toBe('rgba(102 211 255 / 0.12)')
  })

  it('leaves no custom property behind for an ancestor to hijack', () => {
    // NEGATIVE CONTROL for the console-CSS-vars hazard: the besigner canvas
    // runs inside the console's own CssVarsProvider, which defines
    // `--mui-palette-*` with the CONSOLE's brand colours.
    const sx = renderNode({ borderColor: WASH }, siteTheme('#00B0FF'))
    expect(sx['borderColor']).not.toContain('var(')
  })

  it('resolves inside a breakpoint slice too', () => {
    // Colour fields are breakpoint- and scheme-scoped in the styles panel,
    // so the value can be stored anywhere in the sx tree.
    const sx = renderNode(
      { md: { backgroundColor: WASH } },
      siteTheme('#00B0FF'),
    )
    expect(sx['md']['backgroundColor']).toBe('rgba(0 176 255 / 0.12)')
  })
})
