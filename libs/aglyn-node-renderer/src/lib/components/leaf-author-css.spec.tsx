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
 * The Styles panel's `url()` reaching a visitor's document (AGL-1725).
 *
 * The second of the two AGL-1725 sinks that no source-level control can
 * see. There is exactly ONE node renderer — this `Leaf` — and canvas,
 * preview and the tenant page all mount it, so asserting the sx it composes
 * is the same assertion on all three surfaces (the AGL-1331 argument, same
 * probe).
 *
 * What is asserted here is narrow ON PURPOSE: the scheme, never the host.
 * A site owner hotlinking an https image on their own site is an advertised
 * feature and stays working; the http case is refused because mixed passive
 * content is already blocked or upgraded by every current browser, so it
 * buys the author nothing while disclosing the visitor's reading to every
 * observer on the path.
 */
const SxProbe = ({ sx, ...rest }: any) => (
  <div {...rest} data-sx={JSON.stringify(sx)} />
)

const renderNode = (sx: Record<string, unknown>) => {
  Aglyn.components.registerComponent(SxProbe as any, {
    $id: 'author-css-probe',
    pluginId: 'test',
  } as any)
  render(
    <ThemeProvider theme={createTheme({ palette: { mode: 'light' } })}>
      <TreeRoot
        node={
          {
            $id: 'root',
            componentId: 'author-css-probe',
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
  Aglyn.components.unregisterComponent('author-css-probe')
})

describe('Leaf author-CSS url() scrub (AGL-1725)', () => {
  it('refuses an http backgroundImage typed into the Styles panel', () => {
    const sx = renderNode({
      backgroundImage: 'url(http://attacker.example/beacon.png)',
    })
    expect(sx['backgroundImage']).toBe('url(about:invalid)')
    expect(sx['backgroundImage']).not.toContain('attacker.example')
  })

  it('leaves an https hotlink alone — the site owner chose that host', () => {
    // The deliberate NON-decision. If this ever starts failing, someone has
    // restricted a live authoring feature; read the module header first.
    const sx = renderNode({
      backgroundImage: 'url(https://images.example/hero.jpg)',
    })
    expect(sx['backgroundImage']).toBe('url(https://images.example/hero.jpg)')
  })

  it('reaches the shorthand and a nested selector slice', () => {
    const sx = renderNode({
      background: 'url(http://attacker.example/a.png) no-repeat',
      '&:hover': { backgroundImage: 'url(http://attacker.example/h.png)' },
    })
    expect(sx['background']).toBe('url(about:invalid) no-repeat')
    expect(sx['&:hover'].backgroundImage).toBe('url(about:invalid)')
  })

  it('does not disturb a node with no url() at all', () => {
    const sx = renderNode({ backgroundColor: 'primary.main', p: 3 })
    expect(sx['backgroundColor']).toBe('primary.main')
    expect(sx['p']).toBe(3)
  })

  it('leaves an authored gradient intact (AGL-1331 regression guard)', () => {
    const gradient = 'linear-gradient(90deg, #000 0%, #fff 100%)'
    expect(renderNode({ backgroundImage: gradient })['backgroundImage']).toBe(
      gradient,
    )
  })
})
