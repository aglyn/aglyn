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
import { unstable_styleFunctionSx as styleFunctionSx } from '@mui/system'
import { render, screen } from '@testing-library/react'
import TreeRoot from './tree-root'

/**
 * A LIVE document keeps rendering after the alias sweep (AGL-2207/2208).
 *
 * The panel now resolves MUI's system-prop aliases so a stored `bgcolor` or
 * `py` reaches its field, and every in-repo preset was rewritten to the
 * longhands. Neither touches the documents already in Firestore: sites
 * published from the old presets still carry `p: 2`, `py: 10`,
 * `bgcolor: 'primary.main'`, and an author can type any of them into the
 * Custom CSS builder tomorrow.
 *
 * So the load-bearing claim is not "the panel can read it" — it is that
 * NOTHING was taken away. This file drives the renderer every surface
 * mounts (canvas, Preview, tenant SSR) with the old spelling, and then
 * settles the question at the layer that actually paints: MUI's own
 * `styleFunctionSx`, asked whether the stored record and the record the
 * expansion produces compile to the same CSS.
 */
const SxProbe = ({ sx, ...rest }: any) => (
  <div {...rest} data-sx={JSON.stringify(sx)} />
)

const renderNode = (sx: Record<string, unknown>) => {
  Aglyn.components.registerComponent(SxProbe as any, {
    $id: 'legacy-alias-probe',
    pluginId: 'test',
  } as any)
  render(
    <ThemeProvider theme={createTheme({ palette: { mode: 'light' } })}>
      <TreeRoot
        node={
          {
            $id: 'root',
            componentId: 'legacy-alias-probe',
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
  Aglyn.components.unregisterComponent('legacy-alias-probe')
})

/** The CSS MUI actually emits for one sx record against the site theme. */
const css = (sx: Record<string, unknown>) =>
  styleFunctionSx({
    sx,
    theme: createTheme({ palette: { mode: 'light' } }),
  } as any)

describe('a stored document keeps its alias spelling and its styling (AGL-2207)', () => {
  /** The Announcement Bar block as every site published before the sweep. */
  const STORED = {
    py: 1,
    px: 2,
    alignItems: 'center',
    bgcolor: 'primary.main',
    color: 'primary.contrastText',
  }
  /** What the same band is authored as now. */
  const CANONICAL = {
    paddingTop: 1,
    paddingBottom: 1,
    paddingLeft: 2,
    paddingRight: 2,
    alignItems: 'center',
    backgroundColor: 'primary.main',
    color: 'primary.contrastText',
  }

  it('reaches the leaf untouched — nothing rewrites the stored record', () => {
    const sx = renderNode(STORED)
    expect(sx['bgcolor']).toBe('primary.main')
    expect(sx['py']).toBe(1)
    expect(sx['px']).toBe(2)
  })

  it('compiles to exactly the CSS the new spelling compiles to', () => {
    // The claim the whole read-path-alias approach rests on: expanding is a
    // RENAMING of what already renders. If this ever fails, a stored value
    // and its expansion have parted company and the panel is showing an
    // author something the browser is not painting.
    expect(css(STORED)).toEqual(css(CANONICAL))
    // …and it is real CSS, not two matching empties.
    expect(css(STORED)).toMatchObject({
      paddingTop: '8px',
      paddingBottom: '8px',
      paddingLeft: '16px',
      paddingRight: '16px',
    })
    expect(css(STORED)['backgroundColor']).toMatch(/^#|rgb/)
  })

  it('holds for the Box preset shorthand, per side', () => {
    // `p` is the one alias MUI compiles to the CSS SHORTHAND rather than to
    // longhands, so the emitted objects differ in shape by design — a
    // `padding` declaration against four `padding-*` ones. What has to
    // match is what the browser computes, and for padding/margin the
    // shorthand covers exactly the four sides and nothing else.
    expect(css({ p: 2 })).toEqual({ padding: '16px' })
    expect(
      css({
        paddingTop: 2,
        paddingRight: 2,
        paddingBottom: 2,
        paddingLeft: 2,
      }),
    ).toEqual({
      paddingTop: '16px',
      paddingRight: '16px',
      paddingBottom: '16px',
      paddingLeft: '16px',
    })
  })

  it('keeps MUI later-key-wins order, which is why expansion is in place', () => {
    // A stored record may shadow its own alias. `{p: 2, paddingTop: 8}`
    // paints 64px on top and 16px elsewhere; the reverse order paints 16px
    // everywhere. The expansion reproduces both because it rewrites each
    // alias WHERE IT STANDS instead of appending the longhands.
    expect(css({ p: 2, paddingTop: 8 })).toEqual({
      padding: '16px',
      paddingTop: '64px',
    })
    expect(
      css({
        paddingTop: 2,
        paddingRight: 2,
        paddingBottom: 2,
        paddingLeft: 2,
        // the expansion's output for the same record
        ...{ paddingTop: 8 },
      }),
    ).toMatchObject({ paddingTop: '64px', paddingRight: '16px' })
  })

  it('holds per breakpoint and for a negative margin', () => {
    expect(css({ py: { xs: 2, md: 6 } })).toEqual(
      css({
        paddingTop: { xs: 2, md: 6 },
        paddingBottom: { xs: 2, md: 6 },
      }),
    )
    expect(css({ mx: -1 })).toEqual(css({ marginLeft: -1, marginRight: -1 }))
  })

  it('is why a multi-side shorthand VALUE is refused, not expanded', () => {
    // `p: '10px 20px'` compiles to a two-value `padding`. Copied onto the
    // longhands it would compile to four DIFFERENT declarations, so the
    // expansion declines it and the value keeps rendering as stored.
    expect(css({ p: '10px 20px' })).not.toEqual(
      css({
        paddingTop: '10px 20px',
        paddingRight: '10px 20px',
        paddingBottom: '10px 20px',
        paddingLeft: '10px 20px',
      }),
    )
  })
})
