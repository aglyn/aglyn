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

import { fireEvent, render, screen, within } from '@testing-library/react'

import { FormRenderer, useFormApi } from '../vendor/data-driven-forms'
import PresetChoiceField, {
  findPresetChoice,
  presetChoiceValueToText,
  type PresetChoiceOption,
} from './preset-choice'

const RADIUS_CHOICES: PresetChoiceOption[] = [
  { value: 0, label: 'Square', hint: '0px' },
  { value: 2, label: 'Rounded', hint: '8px' },
  { value: '9999px', label: 'Pill' },
  { value: '50%', label: 'Circle' },
]

describe('findPresetChoice (AGL-2486)', () => {
  it('matches a stored NUMBER against a numeric preset', () => {
    // `borderRadius: 2` is stored as a number so MUI multiplies it by
    // `shape.borderRadius`. The control's own select can only hand back a
    // string, so an identity comparison would show "Custom" for a value the
    // author picked from this very menu one render ago.
    expect(findPresetChoice(RADIUS_CHOICES, 2)?.label).toBe('Rounded')
    expect(findPresetChoice(RADIUS_CHOICES, '2')?.label).toBe('Rounded')
  })

  it('matches 0 — a real preset, not an empty field', () => {
    // `strictNullChecks` is off repo-wide and 0 is falsy; a lazy emptiness
    // test loses the one preset an author picks to REMOVE rounding.
    expect(findPresetChoice(RADIUS_CHOICES, 0)?.label).toBe('Square')
    expect(findPresetChoice(RADIUS_CHOICES, '0')?.label).toBe('Square')
  })

  it('has no match for a hand-authored value', () => {
    expect(findPresetChoice(RADIUS_CHOICES, '7px')).toBeUndefined()
    expect(findPresetChoice(RADIUS_CHOICES, '')).toBeUndefined()
    expect(findPresetChoice(RADIUS_CHOICES, undefined)).toBeUndefined()
  })

  it('reads a stored value as the text the raw box shows', () => {
    expect(presetChoiceValueToText(2)).toBe('2')
    expect(presetChoiceValueToText('50%')).toBe('50%')
    expect(presetChoiceValueToText(undefined)).toBe('')
    expect(presetChoiceValueToText(null)).toBe('')
    expect(presetChoiceValueToText(Number.NaN)).toBe('')
  })
})

const FormTemplate = ({ formFields }: any) => {
  const { handleSubmit } = useFormApi()
  return (
    <form onSubmit={handleSubmit}>
      {formFields}
      <button type="submit">{'Save'}</button>
    </form>
  )
}

const renderField = (
  initialValue?: string | number,
  choices: PresetChoiceOption[] = RADIUS_CHOICES,
) => {
  const onSubmit = jest.fn()
  render(
    <FormRenderer
      FormTemplate={FormTemplate}
      componentMapper={{ 'preset-choice': PresetChoiceField }}
      onSubmit={onSubmit}
      initialValues={
        initialValue !== undefined ? { borderRadius: initialValue } : {}
      }
      schema={{
        fields: [
          {
            component: 'preset-choice',
            name: 'borderRadius',
            label: 'Corner Radius',
            choices,
          },
        ],
      }}
    />,
  )
  return onSubmit
}

/**
 * The raw escape-hatch box, or null when the control is on a preset.
 *
 * Deliberately NOT `getByDisplayValue`: MUI's Select renders an
 * `aria-hidden` native `<input>` holding the same value, so a value query
 * matches in BOTH modes and an assertion built on it cannot tell a preset
 * from a custom value — it passes whatever the control does.
 */
const rawBox = () =>
  (screen.queryByRole('textbox') as HTMLInputElement | null) ?? null

const openMenu = () => {
  fireEvent.mouseDown(screen.getByLabelText('Corner Radius'))
  return screen.getByRole('listbox')
}
const persisted = (onSubmit: jest.Mock) => {
  fireEvent.click(screen.getByText('Save'))
  return onSubmit.mock.calls[onSubmit.mock.calls.length - 1][0]
}

describe('PresetChoiceField (AGL-2486)', () => {
  it('offers the presets by name, not by CSS', () => {
    renderField(2)
    const listbox = openMenu()
    for (const label of ['Square', 'Rounded', 'Pill', 'Circle']) {
      expect(within(listbox).getByText(label)).toBeTruthy()
    }
  })

  it('stores a numeric preset as a NUMBER so it keeps following the theme', () => {
    // The string '2' would reach CSS as `border-radius: 2` and be dropped
    // by the parser — the exact silent loss AGL-2486 item 10 is about.
    const onSubmit = renderField('')
    fireEvent.click(within(openMenu()).getByText('Rounded'))
    expect(persisted(onSubmit).borderRadius).toBe(2)
  })

  it('stores a string preset verbatim', () => {
    const onSubmit = renderField('')
    fireEvent.click(within(openMenu()).getByText('Circle'))
    expect(persisted(onSubmit).borderRadius).toBe('50%')
  })

  it('always offers a way out to raw CSS', () => {
    renderField(2)
    expect(within(openMenu()).getByText('Custom…')).toBeTruthy()
  })

  it('opens a hand-authored value in its custom state, showing that value', () => {
    // The round-trip promise: a value saved as raw CSS before this control
    // existed must still be visible and still render, never silently
    // replaced by the nearest preset.
    const onSubmit = renderField('7px')
    expect(rawBox()?.value).toBe('7px')
    expect(persisted(onSubmit).borderRadius).toBe('7px')
  })

  it('keeps editing a custom value as raw text', () => {
    const onSubmit = renderField('7px')
    fireEvent.change(rawBox()!, { target: { value: 'clamp(4px, 2vw, 24px)' } })
    expect(persisted(onSubmit).borderRadius).toBe('clamp(4px, 2vw, 24px)')
  })

  it('does not wipe the value when Custom… is picked', () => {
    // The commonest reason to open the raw box is to tweak a preset by
    // hand; clearing it would make the escape hatch destructive.
    const onSubmit = renderField(2)
    fireEvent.click(within(openMenu()).getByText('Custom…'))
    expect(persisted(onSubmit).borderRadius).toBe(2)
    expect(rawBox()?.value).toBe('2')
  })

  it('goes back to a preset from the raw box', () => {
    const onSubmit = renderField('7px')
    fireEvent.click(within(openMenu()).getByText('Pill'))
    expect(persisted(onSubmit).borderRadius).toBe('9999px')
    expect(rawBox()).toBeNull()
  })

  it('names what the chosen preset resolves to', () => {
    // "Rounded" means nothing until it says 8px — the hint is what makes
    // the choice checkable against a design.
    renderField(2)
    expect(screen.getByText('Rounded — 8px')).toBeTruthy()
  })

  it('takes the preset menu back when the theme arrives late', () => {
    // The site theme resolves ASYNCHRONOUSLY, so the panel's first render
    // has an EMPTY preset list and every stored value "matches no preset".
    // A remembered custom flag latches that: the field spends the rest of
    // the session showing a raw `2` with the real menu one render away and
    // unreachable. Found by a mutation that should have gone red and did
    // not — the flag was doing nothing the derivation was not already
    // doing, which is exactly why the stale case was invisible.
    const onSubmit = jest.fn()
    const schemaWith = (choices: PresetChoiceOption[]) => ({
      fields: [
        {
          component: 'preset-choice',
          name: 'borderRadius',
          label: 'Corner Radius',
          choices,
        },
      ],
    })
    const { rerender } = render(
      <FormRenderer
        FormTemplate={FormTemplate}
        componentMapper={{ 'preset-choice': PresetChoiceField }}
        onSubmit={onSubmit}
        initialValues={{ borderRadius: 2 }}
        schema={schemaWith([])}
      />,
    )
    // Theme still loading: nothing to match, so the raw value is shown.
    expect(rawBox()?.value).toBe('2')

    rerender(
      <FormRenderer
        FormTemplate={FormTemplate}
        componentMapper={{ 'preset-choice': PresetChoiceField }}
        onSubmit={onSubmit}
        initialValues={{ borderRadius: 2 }}
        schema={schemaWith(RADIUS_CHOICES)}
      />,
    )
    // Theme in: the control heals itself onto the preset it always meant.
    expect(rawBox()).toBeNull()
    expect(screen.getByText('Rounded — 8px')).toBeTruthy()
    // …and the stored value is untouched throughout.
    expect(persisted(onSubmit).borderRadius).toBe(2)
  })

  it('still works when the theme offers no presets at all', () => {
    // A theme still loading yields an empty list. The escape hatch is
    // unconditional, so the control must not become unusable.
    const onSubmit = renderField('', [])
    expect(within(openMenu()).getByText('Custom…')).toBeTruthy()
    expect(persisted(onSubmit).borderRadius).toBe('')
  })
})
