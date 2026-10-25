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

import { Typography } from '@mui/material'
import { ThemeProvider } from '@mui/material/styles'
import { render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { consoleThemeLight } from '../console.theme'
import type { Theme } from '../../vendor/mui'
import createResponsiveTheme, { createResponsiveCssVarTheme } from './create-responsive-theme'
import { palettePathColors } from './palette-path-colors'

function colorOf(theme: Theme, element: ReactElement): string {
  const { getByText, unmount } = render(<ThemeProvider theme={theme}>{element}</ThemeProvider>)
  const color = getComputedStyle(getByText('Words')).color
  unmount()
  return color
}

const rgb = (color: string) => {
  const probe = document.createElement('span')
  probe.style.color = color
  return probe.style.color
}

describe('palette path colors on Typography', () => {
  it('paints color="text.secondary" with the palette value, not the parent color (MUI 9 drops the path)', () => {
    expect(colorOf(consoleThemeLight, <Typography color="text.secondary">Words</Typography>)).toBe(
      rgb(consoleThemeLight.palette.text.secondary),
    )
  })

  it('paints a palette color shade such as warning.main and text.disabled', () => {
    expect(colorOf(consoleThemeLight, <Typography color="warning.main">Words</Typography>)).toBe(
      rgb(consoleThemeLight.palette.warning.main),
    )
    expect(colorOf(consoleThemeLight, <Typography color="text.disabled">Words</Typography>)).toBe(
      rgb(consoleThemeLight.palette.text.disabled),
    )
  })

  it('leaves the declared colors to MUI (primary, textSecondary)', () => {
    expect(colorOf(consoleThemeLight, <Typography color="primary">Words</Typography>)).toBe(
      rgb(consoleThemeLight.palette.primary.main),
    )
    expect(colorOf(consoleThemeLight, <Typography color="textSecondary">Words</Typography>)).toBe(
      rgb(consoleThemeLight.palette.text.secondary),
    )
  })

  it('reads the CSS variable in a CSS-variable theme, so the dark scheme follows', () => {
    const light = createResponsiveTheme({ themeOptions: { palette: { mode: 'light' } } })
    const dark = createResponsiveTheme({ themeOptions: { palette: { mode: 'dark' } } })
    const theme = createResponsiveCssVarTheme(light, dark) as unknown as Theme
    const { getByText } = render(
      <ThemeProvider theme={theme}>
        <Typography color="text.secondary">Words</Typography>
      </ThemeProvider>,
    )
    expect(getComputedStyle(getByText('Words')).color).not.toBe(getComputedStyle(document.body).color)
    expect(theme.components?.MuiTypography?.variants?.some((v) => (v.props as { color?: string }).color === 'text.secondary')).toBe(true)
  })

  it('keeps a variant the options already give for a path', () => {
    const theme = createResponsiveTheme({
      themeOptions: {
        components: { MuiTypography: { variants: [{ props: { color: 'text.secondary' as never }, style: { color: 'rgb(1, 2, 3)' } }] } },
      },
    })
    expect(colorOf(theme, <Typography color="text.secondary">Words</Typography>)).toBe('rgb(1, 2, 3)')
  })

  it('covers the shades the shade passes add to tertiary', () => {
    const theme = createResponsiveTheme({ themeOptions: { palette: { tertiary: { main: '#7b1fa2' } } as never } })
    expect(palettePathColors(theme.palette)).toEqual(expect.arrayContaining(['tertiary.main', 'tertiary.light', 'tertiary.dark', 'text.secondary', 'grey.500']))
  })
})
