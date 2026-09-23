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

/**
 * "Always light" / "Always dark" on an element (AGL-3284).
 *
 * The canvas, Preview and the tenant page all mount this one `Leaf`, each
 * under a provider of the site's per-scheme themes, so what it does with a
 * pinned node under a provided getter is what every surface does.
 */

import * as Aglyn from '@aglyn/aglyn'
import {
  createSiteSchemeThemes,
  createTheme,
  SiteSchemeThemesContext,
  ThemeProvider,
  useTheme,
} from '@aglyn/shared-ui-theme'
import Box from '@mui/material/Box'
import { render, screen } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import TreeRoot from './tree-root'

/** The marketing site's dark page background. */
const DARK_BG = '#161c21'
const LIGHT_BG = '#fafafa'

const siteTheme = (mode: 'light' | 'dark') =>
  createTheme({
    palette: {
      mode,
      background: { default: mode === 'dark' ? DARK_BG : LIGHT_BG },
    },
  })

/** A layout wrapper that honors sx, like Section/Box/Stack do. */
const Wrapper = (props: any) => <Box {...props} />

/** Reports the scheme it renders under, and styles itself from sx. */
const ModeProbe = ({ children: _children, ...props }: any) => {
  const theme = useTheme()
  return (
    <Box {...props} data-mode={theme.palette.mode}>
      {theme.palette.mode}
    </Box>
  )
}

beforeAll(() => {
  Aglyn.components.registerComponent(Wrapper as any, {
    $id: 'scheme-wrapper',
    pluginId: 'test',
  } as any)
  Aglyn.components.registerComponent(ModeProbe as any, {
    $id: 'scheme-probe',
    pluginId: 'test',
  } as any)
})

const tree = (
  wrapperProps: Record<string, unknown>,
  wrapperSx?: Record<string, unknown>,
) =>
  ({
    $id: 'band',
    componentId: 'scheme-wrapper',
    pluginId: 'test',
    props: { 'data-testid': 'band', ...wrapperProps },
    ...(wrapperSx ? { sx: wrapperSx } : {}),
    children: [
      {
        $id: 'plate',
        componentId: 'scheme-probe',
        pluginId: 'test',
        props: { 'data-testid': 'plate' },
        // The motivating card plate: a light color with a dark override.
        sx: {
          bgcolor: 'rgb(255, 255, 255)',
          '@scheme dark': { bgcolor: 'rgb(36, 43, 51)' },
        },
        children: [],
      },
    ],
  }) as any

const renderBand = (
  page: 'light' | 'dark',
  wrapperProps: Record<string, unknown>,
  options: {
    provide?: boolean
    getter?: Parameters<typeof SiteSchemeThemesContext.Provider>[0]['value']
    wrapperSx?: Record<string, unknown>
  } = {},
) => {
  const { provide = true, wrapperSx } = options
  const getter =
    options.getter ?? createSiteSchemeThemes((scheme) => siteTheme(scheme))
  const content = (
    <ThemeProvider theme={siteTheme(page)}>
      <TreeRoot node={tree(wrapperProps, wrapperSx)} />
    </ThemeProvider>
  )
  render(
    provide ? (
      <SiteSchemeThemesContext.Provider value={getter}>
        {content}
      </SiteSchemeThemesContext.Provider>
    ) : (
      content
    ),
  )
  return {
    band: screen.getByTestId('band'),
    plate: screen.getByTestId('plate'),
  }
}

const bg = (el: HTMLElement) => window.getComputedStyle(el).backgroundColor
/** What jsdom reports for an element that sets no background. */
const TRANSPARENT = 'rgba(0, 0, 0, 0)'

describe('Leaf color scheme (AGL-3284)', () => {
  it('renders an "Always dark" band dark inside a light page', () => {
    const { band, plate } = renderBand('light', { colorScheme: 'dark' })
    // Descendants resolve against the forced theme…
    expect(plate.getAttribute('data-mode')).toBe('dark')
    // …and so do their `@scheme dark` slices.
    expect(bg(plate)).toBe('rgb(36, 43, 51)')
    // The band itself paints the site's dark page background.
    expect(bg(band)).toBe('rgb(22, 28, 33)')
  })

  it('renders an "Always light" band light inside a dark page', () => {
    const { band, plate } = renderBand('dark', { colorScheme: 'light' })
    expect(plate.getAttribute('data-mode')).toBe('light')
    expect(bg(plate)).toBe('rgb(255, 255, 255)')
    expect(bg(band)).toBe('rgb(250, 250, 250)')
  })

  it("resolves the band's OWN sx against the forced scheme", () => {
    const { band } = renderBand(
      'light',
      { colorScheme: 'dark' },
      {
        wrapperSx: {
          bgcolor: 'rgb(1, 1, 1)',
          '@scheme dark': { bgcolor: 'rgb(9, 9, 9)' },
        },
      },
    )
    // And the author's own background beats the painted default.
    expect(bg(band)).toBe('rgb(9, 9, 9)')
  })

  it('is dark in the server render, not after hydration', () => {
    // The tenant renders on the server with no effects run, so the swap has to
    // happen in render itself — a band that settled dark later would flash
    // light on every published page and mismatch at hydration.
    const html = renderToStaticMarkup(
      <SiteSchemeThemesContext.Provider
        value={createSiteSchemeThemes((scheme) => siteTheme(scheme))}
      >
        <ThemeProvider theme={siteTheme('light')}>
          <TreeRoot node={tree({ colorScheme: 'dark' })} />
        </ThemeProvider>
      </SiteSchemeThemesContext.Provider>,
    )
    expect(html).toContain('data-mode="dark"')
  })

  it('never hands the prop to the component or the DOM', () => {
    const { band } = renderBand('light', { colorScheme: 'dark' })
    expect(band.getAttributeNames().join(' ').toLowerCase()).not.toContain(
      'colorscheme',
    )
  })

  it.each([
    ['unset', {}],
    ['"Match the site"', { colorScheme: 'site' }],
  ])('changes nothing when %s', (_label, props) => {
    const { band, plate } = renderBand('light', props)
    expect(plate.getAttribute('data-mode')).toBe('light')
    expect(bg(plate)).toBe('rgb(255, 255, 255)')
    // No painted background: the band is as transparent as it always was.
    expect(bg(band)).toBe(TRANSPARENT)
    expect(band.getAttributeNames().join(' ').toLowerCase()).not.toContain(
      'colorscheme',
    )
  })

  it('does not rebuild the matching scheme', () => {
    const build = jest.fn((scheme: 'light' | 'dark') => siteTheme(scheme))
    renderBand(
      'light',
      { colorScheme: 'light' },
      { getter: createSiteSchemeThemes(build) },
    )
    expect(build).not.toHaveBeenCalled()
  })

  it('renders unchanged where no site themes are provided', () => {
    const { band, plate } = renderBand(
      'light',
      { colorScheme: 'dark' },
      { provide: false },
    )
    expect(plate.getAttribute('data-mode')).toBe('light')
    expect(bg(band)).toBe(TRANSPARENT)
  })

  it('terminates when the site has one theme for both schemes', () => {
    // A host with no customization and a single `fallback` answers the same
    // light theme for "dark"; re-wrapping would recurse forever.
    const light = siteTheme('light')
    const { plate } = renderBand(
      'light',
      { colorScheme: 'dark' },
      { getter: () => light },
    )
    expect(plate.getAttribute('data-mode')).toBe('light')
  })
})
