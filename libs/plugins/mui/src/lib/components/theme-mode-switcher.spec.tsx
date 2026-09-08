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
 * THE SWITCHER IS ONLY OFFERED WHERE IT CAN DO SOMETHING (AGL-2676).
 *
 * A site whose theme has its dark scheme switched off renders light whatever
 * the visitor picks. The host theme provider says so through the fourth
 * element of the mode tuple; on a published page the switcher then renders
 * nothing, while the static besigner canvas keeps it so it can be placed.
 */

import * as Aglyn from '@aglyn/aglyn'
import { ThemeContextDispatch, type UseThemeMode } from '@aglyn/shared-ui-theme'
import { fireEvent, render, screen } from '@testing-library/react'
import ThemeModeSwitcher from './theme-mode-switcher'

const modeState = (canGoDark: boolean | undefined, toggle = jest.fn()) =>
  [['system', 'light'], toggle, null, canGoDark] as unknown as UseThemeMode

const renderUnder = (value: UseThemeMode, ui: React.ReactElement) =>
  render(
    <ThemeContextDispatch.Provider value={value}>{ui}</ThemeContextDispatch.Provider>,
  )

describe('ThemeModeSwitcher on a site that cannot go dark', () => {
  it('renders nothing on a published page', () => {
    const { container } = renderUnder(modeState(false), <ThemeModeSwitcher />)
    expect(screen.queryByRole('button')).toBeNull()
    expect(container.innerHTML).toBe('')
  })

  it('renders nothing for the toggle variant either', () => {
    renderUnder(modeState(false), <ThemeModeSwitcher variant="toggle" />)
    expect(screen.queryByRole('group', { name: 'Color theme' })).toBeNull()
  })

  it('stays on the static besigner canvas so the author can place it', () => {
    renderUnder(
      modeState(false),
      <Aglyn.ScreenLinkContext.Provider
        value={{ suppressNavigation: true, editorInert: true }}
      >
        <ThemeModeSwitcher />
      </Aglyn.ScreenLinkContext.Provider>,
    )
    expect(
      screen.queryByRole('button', { name: 'Toggle color theme' }),
    ).not.toBeNull()
  })
})

describe('ThemeModeSwitcher where dark is available', () => {
  it('renders and toggles when the provider can go dark', () => {
    const toggle = jest.fn()
    renderUnder(modeState(true, toggle), <ThemeModeSwitcher />)
    fireEvent.click(screen.getByRole('button', { name: 'Toggle color theme' }))
    expect(toggle).toHaveBeenCalledTimes(1)
  })

  it('renders under a provider that does not say (the console)', () => {
    renderUnder(modeState(undefined), <ThemeModeSwitcher />)
    expect(
      screen.queryByRole('button', { name: 'Toggle color theme' }),
    ).not.toBeNull()
  })

  it('renders with no provider at all', () => {
    render(<ThemeModeSwitcher />)
    expect(
      screen.queryByRole('button', { name: 'Toggle color theme' }),
    ).not.toBeNull()
  })
})
