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
 * A gradient authored in the Styles panel reaching the render (AGL-1331).
 *
 * There is exactly ONE node renderer — this `Leaf` — and canvas, preview
 * and the tenant page all mount it (the besigner's `NodeLeaf` wraps it;
 * `AglynNodeRenderer` -> `TreeRoot` defaults to it). So asserting the sx
 * this component hands a leaf component is the same assertion on all three
 * surfaces.
 *
 * The value under test is the marketing CTA's: two token-bound endpoints
 * and a literal mid stop with no token at all.
 */
const CTA =
  'linear-gradient(242deg, var(--mui-palette-primary-main, #00B0FF) 0%, ' +
  '#7A5CF0 55%, var(--mui-palette-secondary-main, #E040FB) 100%)'

/** Echoes the sx the ONE renderer composed, so the test can read it. */
const SxProbe = ({ sx, ...rest }: any) => (
  <div {...rest} data-sx={JSON.stringify(sx)} />
)

const siteTheme = (mode: 'light' | 'dark') =>
  createTheme({
    palette:
      mode === 'dark'
        ? {
            mode,
            primary: { main: '#66D3FF' },
            secondary: { main: '#F07BFF' },
          }
        : {
            mode,
            primary: { main: '#00B0FF' },
            secondary: { main: '#E040FB' },
          },
  })

const renderNode = (sx: Record<string, unknown>, mode: 'light' | 'dark') => {
  Aglyn.components.registerComponent(SxProbe as any, {
    $id: 'sx-probe',
    pluginId: 'test',
  } as any)
  render(
    <ThemeProvider theme={siteTheme(mode)}>
      <TreeRoot
        node={
          {
            $id: 'root',
            componentId: 'sx-probe',
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
  // MUI array composition: the node-level sx is the last entry.
  const composed = JSON.parse(raw)
  return Object.assign(
    {},
    ...(Array.isArray(composed) ? composed : [composed]).filter(Boolean),
  ) as Record<string, any>
}

afterEach(() => {
  Aglyn.components.unregisterComponent('sx-probe')
})

describe('Leaf background gradients (AGL-1331)', () => {
  it('renders an authored gradient as backgroundImage', () => {
    const sx = renderNode({ backgroundImage: CTA }, 'light')
    expect(sx['backgroundImage']).toBe(
      'linear-gradient(242deg, #00B0FF 0%, #7A5CF0 55%, #E040FB 100%)',
    )
  })

  it('resolves token stops through the theme, keeping literal stops literal', () => {
    // NEGATIVE CONTROL for the console-CSS-vars hazard: nothing shaped like
    // a custom property may survive into the rendered value, or an ancestor
    // provider (the console's) would supply its own colours.
    const sx = renderNode({ backgroundImage: CTA }, 'light')
    expect(sx['backgroundImage']).not.toContain('var(')
    expect(sx['backgroundImage']).toContain('#7A5CF0')
  })

  it('follows the active scheme without a dark slice', () => {
    const sx = renderNode({ backgroundImage: CTA }, 'dark')
    expect(sx['backgroundImage']).toBe(
      'linear-gradient(242deg, #66D3FF 0%, #7A5CF0 55%, #F07BFF 100%)',
    )
  })

  it('honours a dark-slice gradient over the base one', () => {
    const sx = renderNode(
      {
        backgroundImage: CTA,
        '@scheme dark': {
          backgroundImage: 'linear-gradient(90deg, #000 0%, #111 100%)',
        },
      },
      'dark',
    )
    expect(sx['backgroundImage']).toBe(
      'linear-gradient(90deg, #000 0%, #111 100%)',
    )
  })

  it('leaves a solid background exactly as it was', () => {
    // The panel's Solid fill writes no backgroundImage at all; the palette
    // pass must not touch a plain colour or a token path MUI resolves.
    const sx = renderNode({ backgroundColor: 'primary.main' }, 'light')
    expect(sx['backgroundColor']).toBe('primary.main')
    expect(sx['backgroundImage']).toBeUndefined()
  })
})
