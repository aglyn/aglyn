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
import { ColorPickerTokensContext } from './color-picker-tokens'
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
    fireEvent.click(screen.getByRole('button', { name: 'Surface' }))
    expect(input().value).toBe('background.paper')
  })
})
