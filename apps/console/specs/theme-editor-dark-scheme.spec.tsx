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
 * THE THEME EDITOR CAN SWITCH DARK OFF FOR A SITE (AGL-2676).
 *
 * Dark follows the visitor by default on the platform's dark palette. A site
 * whose content only reads well in light opts out with the Dark scheme
 * control; only that opt-out is written, so an untouched theme stays empty.
 */

import { fireEvent, render, screen } from '@testing-library/react'
import { ThemeEditor } from '../components/theme-editor/theme-editor.component'

jest.mock('next/dynamic', () => ({ __esModule: true, default: () => () => null }))
jest.mock('next/head', () => ({
  __esModule: true,
  default: ({ children }: { children?: React.ReactNode }) => children ?? null,
}))

describe('ThemeEditor dark scheme control', () => {
  it('defaults to following the visitor and saves only the opt-out', () => {
    const onSave = jest.fn()
    render(<ThemeEditor theme={{}} onSave={onSave} />)
    const control = screen.getByRole('combobox', { name: 'Dark scheme' })
    expect(control.textContent).toBe('Follows the visitor')
    expect(
      (screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled,
    ).toBe(true)

    fireEvent.mouseDown(control)
    fireEvent.click(screen.getByRole('option', { name: 'Off — always light' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0][0]).toEqual({ darkScheme: 'off' })
  })

  it('reads an existing opt-out and drops it when set back to follow', () => {
    const onSave = jest.fn()
    render(<ThemeEditor theme={{ darkScheme: 'off' }} onSave={onSave} />)
    const control = screen.getByRole('combobox', { name: 'Dark scheme' })
    expect(control.textContent).toBe('Off — always light')

    fireEvent.mouseDown(control)
    fireEvent.click(screen.getByRole('option', { name: 'Follows the visitor' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(onSave.mock.calls[0][0]).toEqual({})
  })
})
