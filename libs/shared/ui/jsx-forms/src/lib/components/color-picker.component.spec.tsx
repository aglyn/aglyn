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

import { fireEvent, render, screen } from '@testing-library/react'

import { FormRenderer } from '../vendor/data-driven-forms'
import {
  buildColorTokenOptions,
  COLOR_PICKER_TOKEN_PATHS,
  ColorPickerTokensContext,
} from './color-picker-tokens'
import ColorPickerComponent from './color-picker.component'

const tokens = [
  {
    value: 'primary.main',
    label: 'Primary',
    light: '#111111',
    dark: '#eeeeee',
  },
  {
    value: 'background.paper',
    label: 'Surface',
    light: '#ffffff',
    dark: '#121212',
  },
]

const FormTemplate = ({ formFields }: any) => <form>{formFields}</form>

const renderField = (
  initialValue?: string,
  options: typeof tokens | undefined = tokens,
) =>
  render(
    <ColorPickerTokensContext.Provider value={options}>
      <FormRenderer
        FormTemplate={FormTemplate}
        componentMapper={{ 'color-picker': ColorPickerComponent }}
        onSubmit={jest.fn()}
        initialValues={
          initialValue !== undefined ? { fill: initialValue } : {}
        }
        schema={{
          fields: [
            { component: 'color-picker', name: 'fill', label: 'Fill' },
          ],
        }}
      />
    </ColorPickerTokensContext.Provider>,
  )

const input = () => screen.getByLabelText('Fill') as HTMLInputElement
const sketchPicker = () => document.querySelector('.sketch-picker')

// Two-stage color picking (AGL-588): theme color REFERENCES first —
// stored as palette token paths that adapt per scheme — with the raw
// picker behind an explicit "Custom color" step.
describe('ColorPickerComponent two-stage picking (AGL-588)', () => {
  it('opens on the theme-token stage and stores the token PATH', () => {
    renderField()
    fireEvent.focus(input())

    // Token stage first: labeled swatches, no raw picker yet.
    const primary = screen.getByRole('button', { name: 'Primary' })
    expect(sketchPicker()).toBeNull()

    fireEvent.click(primary)
    expect(input().value).toBe('primary.main')
  })

  it('re-opens a stored token path with its swatch selected', () => {
    renderField('background.paper')
    fireEvent.focus(input())
    expect(
      screen.getByRole('button', { name: 'Surface' }).getAttribute(
        'aria-pressed',
      ),
    ).toBe('true')
    expect(
      screen.getByRole('button', { name: 'Primary' }).getAttribute(
        'aria-pressed',
      ),
    ).toBe('false')
  })

  it('reveals the raw picker behind the Custom color step', () => {
    renderField()
    fireEvent.focus(input())
    fireEvent.click(screen.getByRole('button', { name: 'Custom color…' }))
    expect(sketchPicker()).not.toBeNull()

    // And the way back to the token stage.
    fireEvent.click(screen.getByRole('button', { name: '‹ Theme colors' }))
    expect(sketchPicker()).toBeNull()
    expect(screen.getByRole('button', { name: 'Primary' })).toBeTruthy()
  })

  it('re-opens an existing hex value on the custom stage (backward compat)', () => {
    renderField('#ff0000')
    fireEvent.focus(input())
    expect(sketchPicker()).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Primary' })).toBeNull()
  })

  it('keeps free-typed custom values stored as-is', () => {
    renderField()
    fireEvent.change(input(), { target: { value: '#123456' } })
    expect(input().value).toBe('#123456')
  })

  it('offers ambient-theme tokens when no provider supplies site ones', () => {
    // Forms outside the designer (no ColorPickerTokensContext value)
    // still get the default token paths, resolved against the ambient
    // MUI theme — the enhancement lives inside the shared field.
    renderField(undefined, [])
    fireEvent.focus(input())
    // `background.paper` is labelled Paper since AGL-1206 — the palette has a
    // real `surface` entry, and calling paper "Surface" shadowed it.
    fireEvent.click(screen.getByRole('button', { name: 'Paper' }))
    expect(input().value).toBe('background.paper')
  })
})

/**
 * Contextual help (AGL-601/1220). Every other field forwards `help` to
 * `FormFieldGrid`, which renders the tip. The colour picker used to swallow
 * it into `...rest`, so a colour field given a help tip rendered nothing at
 * all — and gave no clue why. Found while putting tips on the styles panel:
 * Border Color sat bare beside a tipped Border.
 */
describe('ColorPickerComponent help tip (AGL-1220)', () => {
  const renderWithHelp = (help?: Record<string, string>) =>
    render(
      <ColorPickerTokensContext.Provider value={tokens}>
        <FormRenderer
          FormTemplate={FormTemplate}
          componentMapper={{ 'color-picker': ColorPickerComponent }}
          onSubmit={jest.fn()}
          initialValues={{}}
          schema={{
            fields: [
              { component: 'color-picker', name: 'fill', label: 'Fill', help },
            ],
          }}
        />
      </ColorPickerTokensContext.Provider>,
    )

  it('renders the tip a colour field was given', () => {
    renderWithHelp({
      title: 'Border Color',
      excerpt: 'Colour for the border shorthand above.',
    })
    // getByRole throws when absent, so finding it is the assertion.
    expect(screen.getByRole('button', { name: /border color/i })).toBeTruthy()
  })

  it('renders no tip affordance when the field has no help', () => {
    // The negative control: without it, a test that only asserts presence
    // would pass against a component that renders a tip unconditionally.
    renderWithHelp(undefined)
    expect(screen.queryByRole('button', { name: /border color/i })).toBeNull()
  })
})

/**
 * Alpha on a theme token (AGL-2486, item 6).
 *
 * `alpha()` was used all over the product's own chrome and nowhere an author
 * could reach it: there was no way to say "primary.main at 12%" in the styles
 * panel at all. The interesting half is not the slider, it is the STORED
 * shape — `rgba(var(--mui-palette-primary-mainChannel, 17 17 17) / 0.12)`,
 * a palette reference with a literal fallback, resolved against the host
 * palette at render by `resolvePaletteVarsSx`. Flattening to
 * `rgba(17, 17, 17, 0.12)` here would look identical on the canvas and quietly
 * stop following the palette for ever, so these tests assert the reference.
 */
describe('ColorPickerComponent token alpha (AGL-2486)', () => {
  const opacitySlider = () =>
    screen.getByRole('slider', { name: 'Opacity 100%' }) as HTMLInputElement

  it('offers no opacity control until a token is picked', () => {
    // The negative control: without it a test that finds the slider proves
    // nothing about when it appears.
    renderField()
    fireEvent.focus(input())
    expect(screen.queryByRole('slider')).toBeNull()
  })

  it('stores the bare token path while the colour is fully opaque', () => {
    // Nothing about the shipped format changes for the common case.
    renderField('primary.main')
    fireEvent.focus(input())
    expect(opacitySlider()).toBeTruthy()
    expect(input().value).toBe('primary.main')
  })

  it('stores a REFERENCE plus alpha, not a flattened rgba', () => {
    renderField('primary.main')
    fireEvent.focus(input())
    fireEvent.change(opacitySlider(), { target: { value: '0.12' } })
    expect(input().value).toBe(
      'rgba(var(--mui-palette-primary-mainChannel, 17 17 17) / 0.12)',
    )
    // The fallback is the token's colour TODAY, so a render path that skips
    // substitution still paints the right colour at the right opacity — but
    // the reference is what the palette drives.
    expect(input().value).toContain('--mui-palette-primary-mainChannel')
  })

  it('round-trips: a stored alpha token re-opens on its own swatch', () => {
    // The value must not read as an opaque literal on the way back in —
    // that is what would strand an author on the custom stage unable to see
    // which token they had chosen.
    renderField('rgba(var(--mui-palette-primary-mainChannel, 17 17 17) / 0.4)')
    fireEvent.focus(input())
    expect(sketchPicker()).toBeNull()
    expect(
      screen
        .getByRole('button', { name: 'Primary' })
        .getAttribute('aria-pressed'),
    ).toBe('true')
    expect(screen.getByRole('slider', { name: 'Opacity 40%' })).toBeTruthy()
  })

  it('carries the opacity across a change of token', () => {
    renderField('rgba(var(--mui-palette-primary-mainChannel, 17 17 17) / 0.4)')
    fireEvent.focus(input())
    fireEvent.click(screen.getByRole('button', { name: 'Surface' }))
    expect(input().value).toBe(
      'rgba(var(--mui-palette-background-paperChannel, 255 255 255) / 0.4)',
    )
  })

  it('drops back to the bare path when the opacity returns to 100%', () => {
    renderField('rgba(var(--mui-palette-primary-mainChannel, 17 17 17) / 0.4)')
    fireEvent.focus(input())
    fireEvent.change(screen.getByRole('slider', { name: 'Opacity 40%' }), {
      target: { value: '1' },
    })
    expect(input().value).toBe('primary.main')
  })
})

/**
 * The tertiary shades the theme has derived all along (AGL-2486, item 6).
 * `createResponsiveTheme` runs `addShadeVariants` over `tertiary`; the picker
 * offered `Primary light`/`Primary dark` but stopped at plain `Tertiary`, so
 * an author who wanted the accent's dark step had to hardcode a hex.
 */
describe('ColorPickerComponent tertiary shades (AGL-2486)', () => {
  /** A site palette shaped the way `createResponsiveTheme` leaves one. */
  const palette = {
    primary: { main: '#00B0FF', light: '#66D3FF', dark: '#0077B3' },
    // `tertiary` is a FOREGROUND family, so `dark` is the AA-checked accent
    // text shade rather than a naive darken of `main`.
    tertiary: { main: '#334155', light: '#64748B', dark: '#0F172A' },
  }

  it('offers the tertiary shades the theme already derives', () => {
    expect(COLOR_PICKER_TOKEN_PATHS.map((entry) => entry.path)).toEqual(
      expect.arrayContaining(['tertiary.light', 'tertiary.dark']),
    )
  })

  it('previews what the palette actually resolves them to', () => {
    // Not a shade derived here: the swatch has to show the accessible
    // colour the theme computed, or it advertises a colour nothing paints.
    const options = buildColorTokenOptions(palette, undefined)
    const dark = options.find((option) => option.value === 'tertiary.dark')
    expect(dark?.label).toBe('Tertiary dark')
    expect(dark?.light).toBe('#0F172A')
    expect(
      options.find((option) => option.value === 'tertiary.light')?.light,
    ).toBe('#64748B')
  })

  it('drops them on a palette that has no tertiary at all', () => {
    // The negative control, and the reason listing brand-only slots is free.
    const options = buildColorTokenOptions({ primary: palette.primary }, undefined)
    expect(
      options.some((option) => option.value.startsWith('tertiary.')),
    ).toBe(false)
  })

  it('stores tertiary.dark as a token path like any other shade', () => {
    renderField(undefined, buildColorTokenOptions(palette, undefined) as any)
    fireEvent.focus(input())
    fireEvent.click(screen.getByRole('button', { name: 'Tertiary dark' }))
    expect(input().value).toBe('tertiary.dark')
  })
})
