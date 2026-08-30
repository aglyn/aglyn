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
 * A DATE FIELD'S LABEL DOES NOT SIT ON TOP OF ITS PLACEHOLDER.
 *
 * A `date` input paints `mm/dd/yyyy` whether or not it is focused and whether
 * or not it holds a value, so a label left to float rests ON the placeholder
 * and both become unreadable — the campaign drawer read `Snamt/dd/yyyy` where
 * it meant `Starts`.
 *
 * The decision belongs to this component rather than to each schema. A caller
 * that forgets it does not get a warning, it gets two strings drawn over each
 * other, and the field it declared LOOKS like a typo. The same is true of
 * every other input type the browser paints for: time, datetime-local, month,
 * week and colour.
 *
 * `MuiTextField` renders the label with `data-shrink`, which is the state
 * being asserted — not a pixel position, which would hold whatever the theme
 * happened to do on the day it was written.
 */
import { render, screen } from '@testing-library/react'

import { FIELD_MAP_TEXT_FIELD } from '../constants/field-configurations'
import { FormRenderer, useFormApi } from '../vendor/data-driven-forms'
import TextField from './text-field.component'

const FormTemplate = ({ formFields }: any) => {
  const { handleSubmit } = useFormApi()
  return <form onSubmit={handleSubmit}>{formFields}</form>
}

const renderField = (field: Record<string, unknown>) =>
  render(
    <FormRenderer
      FormTemplate={FormTemplate}
      componentMapper={{
        'text-field': { ...FIELD_MAP_TEXT_FIELD, component: TextField },
      }}
      onSubmit={jest.fn()}
      schema={{ fields: [{ component: 'text-field', ...field }] }}
    />,
  )

/**
 * The label element MUI stamps its shrink state onto.
 *
 * The outlined variant draws the text TWICE — once in the `<label>` and once
 * in the notch's legend — so a plain text query is ambiguous. Only the label
 * carries `data-shrink`, and the legend has no `<label>` ancestor.
 */
const labelFor = (text: string) =>
  screen
    .getAllByText(text)
    .map((node) => node.closest('label'))
    .find(Boolean) as HTMLLabelElement

describe('a field the browser paints a placeholder into', () => {
  it.each([
    ['date', 'Starts'],
    ['time', 'Opens at'],
    ['datetime-local', 'Runs from'],
    ['month', 'Billing month'],
    ['week', 'Reporting week'],
    ['color', 'Accent'],
  ])('shrinks the label of a %s field with no value', (type, label) => {
    renderField({ name: `f_${type}`, label, type })
    expect(labelFor(label).getAttribute('data-shrink')).toBe('true')
  })

  it('THE CONTROL: an ordinary text field still floats its label', () => {
    // Without this, a component that shrank EVERY label would pass every case
    // above while destroying the floating label the rest of the console uses.
    renderField({ name: 'plain', label: 'Display name', type: 'text' })
    expect(labelFor('Display name').getAttribute('data-shrink')).toBe('false')
  })

  it('lets a caller override the shrink it would otherwise force', () => {
    renderField({
      name: 'override',
      label: 'Starts',
      type: 'date',
      slotProps: { inputLabel: { shrink: false } },
    })
    expect(labelFor('Starts').getAttribute('data-shrink')).toBe('false')
  })

  it('keeps read-only when a caller passes slotProps of its own', () => {
    // The merge, not a replacement: a caller reaching for one slot must not
    // silently drop the read-only flag this component puts on another.
    renderField({
      name: 'readonly',
      label: 'Starts',
      type: 'date',
      isReadOnly: true,
      slotProps: { inputLabel: { shrink: true } },
    })
    expect(
      (screen.getByLabelText('Starts') as HTMLInputElement).readOnly,
    ).toBe(true)
  })
})
