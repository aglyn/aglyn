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

import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import ToggleButtonComponent from '../components/toggle-button.component'
import { FormRenderer, useFormApi } from '../vendor/data-driven-forms'
import Checkbox from './checkbox'
import Radio from './radio'
import Slider from './slider'
import Switch from './switch'

/**
 * The switch, checkbox, radio, slider and toggle buttons, as the Attributes
 * panel draws a component or layout property with them (AGL-2893).
 *
 * A property left unset on a page takes the component's default, so each of
 * these needs a way BACK to unset — which none of them had, because none of
 * their controls can be driven to "nothing". And each has to store the value
 * it shows: a slider at 0, a toggle pressed again.
 */

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
  field: Record<string, unknown>,
  initialValues: Record<string, unknown> = {},
) => {
  const onSubmit = jest.fn()
  render(
    <FormRenderer
      FormTemplate={FormTemplate}
      componentMapper={{
        switch: Switch,
        checkbox: Checkbox,
        radio: Radio,
        slider: Slider,
        'toggle-button': ToggleButtonComponent,
      }}
      onSubmit={onSubmit}
      initialValues={initialValues}
      schema={{ fields: [{ name: 'value', label: 'Value', ...field }] }}
    />,
  )
  const submitted = async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalled())
    return onSubmit.mock.calls[onSubmit.mock.calls.length - 1][0]
  }
  return { submitted }
}

describe.each([
  ['switch', { component: 'switch' }, false],
  ['single checkbox', { component: 'checkbox' }, false],
  ['radio group', { component: 'radio', options: [{ value: 'a', label: 'A' }] }, 'a'],
  ['slider', { component: 'slider', min: 0, max: 10 }, 0],
  [
    'toggle buttons',
    { component: 'toggle-button', options: [{ value: 'a', label: 'A' }] },
    'a',
  ],
] as const)('a clearable %s (AGL-2893)', (_label, field, stored) => {
  it('offers the clear button while it holds a value, and clears to unset', async () => {
    const { submitted } = renderField(
      { ...field, clearable: true },
      { value: stored },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Clear Value' }))
    expect(await submitted()).not.toHaveProperty('value')
  })

  it('offers no clear button while nothing is stored', () => {
    renderField({ ...field, clearable: true })
    expect(screen.queryByRole('button', { name: 'Clear Value' })).toBeNull()
  })

  it('offers no clear button unless the field asks for one', () => {
    renderField(field, { value: stored })
    expect(screen.queryByRole('button', { name: 'Clear Value' })).toBeNull()
  })
})

describe('the slider shows the value it stores (AGL-2893)', () => {
  it('draws a stored 0 at the start of the track, not the middle', () => {
    renderField({ component: 'slider', min: 0, max: 10 }, { value: 0 })
    expect(screen.getByRole('slider').getAttribute('aria-valuenow')).toBe('0')
  })
})

describe('toggle buttons store the answer the group gives (AGL-2893)', () => {
  const OPTIONS = [
    { value: 'sm', label: 'Small' },
    { value: 'lg', label: 'Large' },
  ]

  it('stores the pressed answer', async () => {
    const { submitted } = renderField({ component: 'toggle-button', options: OPTIONS })
    fireEvent.click(screen.getByRole('button', { name: 'Large' }))
    expect((await submitted()).value).toBe('lg')
  })

  it('unsets when the chosen answer is pressed again', async () => {
    const { submitted } = renderField(
      { component: 'toggle-button', options: OPTIONS },
      { value: 'lg' },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Large' }))
    expect(await submitted()).not.toHaveProperty('value')
  })
})
