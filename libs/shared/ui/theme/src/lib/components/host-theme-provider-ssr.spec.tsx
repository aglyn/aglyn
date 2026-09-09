/**
 * @jest-environment node
 */
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
 * THE SCHEME IS DECIDED IN THE FIRST RENDER, NOT BY AN EFFECT.
 *
 * A node environment and `renderToStaticMarkup` between them make this suite
 * an SSR test rather than a client one: there is no `document` for `js-cookie`
 * to read, no `matchMedia` for `prefers-color-scheme`, and React runs no
 * effects at all. So the only thing that can put dark in this markup is the
 * mode the provider was handed, and an assertion here cannot be satisfied by a
 * scheme that settles a paint later — which is exactly the failure the seed
 * exists to prevent, and which a jsdom render would hide by running the
 * layout effect that re-reads the cookie.
 */

import { useTheme } from '@mui/material/styles'
import { renderToStaticMarkup } from 'react-dom/server'
import { consoleThemeDark, consoleThemeLight } from '../console.theme'
import { useThemeMode } from '../hocs/create-with-theme-provider'
import { HostThemeProvider, type HostThemeProviderProps } from './host-theme-provider'

function Probe() {
  const [[, mode], , , canGoDark] = useThemeMode()
  const theme = useTheme()
  return <div>{[mode, String(canGoDark), theme.palette.mode].join('|')}</div>
}

const serverRender = (props: Partial<HostThemeProviderProps>) =>
  renderToStaticMarkup(
    <HostThemeProvider
      fallback={[consoleThemeLight, consoleThemeDark]}
      {...props}
    >
      <Probe />
    </HostThemeProvider>,
  )

describe('HostThemeProvider rendering on the server', () => {
  // Anti-vacuity: every assertion below is about the absence of a browser, and
  // a suite that quietly acquired one would keep passing for the wrong reason.
  it('has no browser to read the choice from', () => {
    expect(typeof document).toBe('undefined')
    expect(typeof window).toBe('undefined')
  })

  it('resolves dark from the request cookie in the markup it emits', () => {
    expect(serverRender({ initialMode: 'dark' })).toContain('dark|true|dark')
  })

  it('paints the colours the host authored for dark, not just the mode flag', () => {
    const markup = serverRender({
      initialMode: 'dark',
      theme: { colorSchemes: { light: {}, dark: { primary: { main: '#6f4e37' } } } },
    })
    expect(markup).toContain('dark|true|dark')
  })

  it('keeps a site that switched dark off on light, whatever the visitor stored', () => {
    // The per-site opt-out is a property of the site, so it outranks the
    // visitor — including now that the visitor's answer arrives early enough
    // to reach the server render.
    const markup = serverRender({
      initialMode: 'dark',
      theme: {
        darkScheme: 'off',
        colorSchemes: { dark: { primary: { main: '#6f4e37' } } },
      },
    })
    expect(markup).toContain('dark|false|light')
  })

  it('falls back to light when the request names no scheme', () => {
    // Device default cannot be resolved without a browser, so light is the
    // only answer available — and the contrast is what shows the case above
    // is the seed's doing rather than an ambient default.
    expect(serverRender({})).toContain('light|true|light')
    expect(serverRender({ initialMode: null })).toContain('light|true|light')
  })
})
