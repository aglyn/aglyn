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
 * The theme editor renders exactly its field catalog (AGL-2938).
 *
 * The catalog in `@aglyn/shared-ui-theme` is what anything else that proposes
 * a theme change offers — the AI plugin's theme tool holds parity with it in
 * its own spec. This is the other half: every catalog control is on the
 * screen, labeled as the catalog labels it, and nothing on the screen holds a
 * value the catalog does not have. Together they are how "the AI can do
 * everything the editor can" is checked rather than promised.
 *
 * It also pins how the editor adopts a draft handed to it from the Theme
 * section's plugin zone: once per key, saved through `onSave` like any edit,
 * and adoptable again once it has settled.
 */

import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'

jest.mock('@aglyn/shared-ui-jsx', () => ({
  CardDisplay: ({ header, children }: { header?: ReactNode; children: ReactNode }) => (
    <section aria-label={typeof header === 'string' ? header : undefined}>{children}</section>
  ),
}))

jest.mock('@aglyn/shared-ui-color-picker', () => ({ ColorPicker: () => null }))

jest.mock('../../constants/docs-links', () => ({ docsHelp: () => undefined }))

jest.mock('next/dynamic', () => ({ __esModule: true, default: () => () => null }))

jest.mock('next/head', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

jest.mock('./theme-preview.component', () => ({ __esModule: true, default: () => null }))

import ThemeEditor from './theme-editor.component'
import {
  INHERITED_SPACING,
  THEME_COLOR_FIELDS,
  THEME_EDITOR_CONTROLS,
} from './theme-editor.constants'

const COLOR_BUTTON = /^pick (.+) color$/

const startsWith = (label: string) => (name: string) => name.startsWith(label)

describe('the editor renders exactly the catalog (AGL-2938)', () => {
  it('renders every catalog control, labeled as the catalog labels it', () => {
    render(<ThemeEditor theme={{}} onSave={jest.fn()} />)
    const colorLabels = screen
      .getAllByRole('button', { name: COLOR_BUTTON })
      .map((button) => String(button.getAttribute('aria-label')).replace(COLOR_BUTTON, '$1'))
    expect(colorLabels).toEqual(THEME_COLOR_FIELDS.map((field) => field.label))

    for (const control of THEME_EDITOR_CONTROLS) {
      switch (control.kind) {
        case 'select':
          expect(screen.getByRole('combobox', { name: startsWith(control.label) })).toBeTruthy()
          break
        case 'number':
          if (control.id === 'borderRadius') {
            expect(screen.getByRole('slider', { name: control.label })).toBeTruthy()
          } else {
            expect(screen.getByRole('spinbutton', { name: control.label })).toBeTruthy()
          }
          break
        case 'json':
          expect(
            within(screen.getByRole('region', { name: control.label })).getByRole('button', {
              name: 'Edit overrides',
            }),
          ).toBeTruthy()
          break
        default:
          break
      }
    }
  })

  it('renders no value-bearing control the catalog does not have', () => {
    render(<ThemeEditor theme={{}} onSave={jest.fn()} />)
    const rendered =
      screen.getAllByRole('button', { name: COLOR_BUTTON }).length +
      screen.getAllByRole('combobox').length +
      screen.getAllByRole('spinbutton').length +
      screen.getAllByRole('slider').length +
      screen.getAllByRole('button', { name: 'Edit overrides' }).length
    expect(rendered).toBe(THEME_EDITOR_CONTROLS.length)
  })

  it('writes what it renders the way the catalog writes it', () => {
    const onSave = jest.fn()
    render(<ThemeEditor theme={{}} onSave={onSave} />)
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Nav height, mobile (px)' }), {
      target: { value: '60' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledWith({
      mixins: {
        toolbar: {
          minHeight: '60px',
          '@media (min-width:0px)': { '@media (orientation: landscape)': { minHeight: 48 } },
          '@media (min-width:600px)': { minHeight: '64px' },
        },
      },
    })
  })
})

describe('a draft handed to the editor (AGL-2938)', () => {
  const spacing = () =>
    (screen.getByRole('spinbutton', { name: 'Spacing unit (px)' }) as HTMLInputElement).value

  it('adopts a proposal once per key, saves it through onSave, and adopts it again once settled', () => {
    const onSave = jest.fn()
    const onSettled = jest.fn()
    const proposal = { key: 'job-1', theme: { spacing: 6 } }
    const editor = (proposedDraft: typeof proposal | null) => (
      <ThemeEditor
        theme={{}}
        onSave={onSave}
        proposedDraft={proposedDraft}
        onProposedDraftSettled={onSettled}
      />
    )
    const { rerender } = render(editor(proposal))
    expect(spacing()).toBe('6')

    // An edit on top of the proposal survives the parent re-rendering with it.
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Spacing unit (px)' }), {
      target: { value: '7' },
    })
    rerender(editor({ ...proposal }))
    expect(spacing()).toBe('7')

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(onSave).toHaveBeenCalledWith({ spacing: 7 })
    expect(onSettled).toHaveBeenCalledTimes(1)

    // Discarded, the editor goes back to the saved theme…
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    expect(spacing()).toBe(String(INHERITED_SPACING))

    // …and once the scope has let it go, the same proposal can be put back.
    rerender(editor(null))
    rerender(editor(proposal))
    expect(spacing()).toBe('6')
  })
})
