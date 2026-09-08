/**
 * @jest-environment jsdom
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
 * DARK FOLLOWS THE VISITOR UNLESS THE SITE SWITCHED IT OFF (AGL-2676).
 *
 * A site needs no dark design of its own: the default dark palette renders
 * under whatever it authored. The provider publishes whether dark is
 * available as the fourth element of the mode tuple so a visitor-facing
 * control can hide rather than lie.
 */

import { useTheme } from '@mui/material/styles'
import { render, screen } from '@testing-library/react'
import { consoleThemeDark, consoleThemeLight } from '../console.theme'
import { useThemeMode } from '../hocs/create-with-theme-provider'
import { HostThemeProvider } from './host-theme-provider'

function Probe() {
  const [[, mode], , , canGoDark] = useThemeMode()
  const theme = useTheme()
  return (
    <div data-testid="probe">
      {[mode, String(canGoDark), theme.palette.mode].join('|')}
    </div>
  )
}

const renderHost = (theme: Parameters<typeof HostThemeProvider>[0]['theme']) =>
  render(
    <HostThemeProvider
      theme={theme}
      fallback={[consoleThemeLight, consoleThemeDark]}
    >
      <Probe />
    </HostThemeProvider>,
  )

const probe = () => screen.getByTestId('probe').textContent

describe('HostThemeProvider with the visitor asking for dark', () => {
  beforeEach(() => {
    document.cookie = 'theme-color-mode=dark'
  })

  it('goes dark on the fallback when the host has no theme', () => {
    renderHost(undefined)
    expect(probe()).toBe('dark|true|dark')
  })

  it('goes dark on the default dark palette when the host authored none', () => {
    renderHost({ colorSchemes: { light: { primary: { main: '#6f4e37' } } } })
    expect(probe()).toBe('dark|true|dark')
  })

  it('goes dark under the colours the host authored', () => {
    renderHost({
      colorSchemes: { light: {}, dark: { primary: { main: '#6f4e37' } } },
    })
    expect(probe()).toBe('dark|true|dark')
  })

  it('stays light and says so when the site switched dark off', () => {
    renderHost({ darkScheme: 'off', colorSchemes: { dark: { primary: { main: '#6f4e37' } } } })
    expect(probe()).toBe('dark|false|light')
  })
})
