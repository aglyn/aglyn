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

import { FIELD_MAP_SELECT } from '../constants/field-configurations'
import { FormRenderer, useFormApi } from '../vendor/data-driven-forms'
import Select from './select'

const FormTemplate = ({ formFields }: any) => {
  const { handleSubmit } = useFormApi()
  return (
    <form onSubmit={handleSubmit}>
      {formFields}
      <button type="submit">{'Save'}</button>
    </form>
  )
}

// The App Bar's theme-color list, post-AGL-1191: every value is a non-empty
// string, and "Default" carries MUI's real `'default'` sentinel.
const themeColorOptions = [
  { value: 'default', label: 'Default' },
  { value: 'inherit', label: 'Inherit' },
  { value: 'transparent', label: 'Transparent' },
  { value: 'primary', label: 'Primary' },
  { value: 'secondary', label: 'Secondary' },
]

const renderSelect = (
  options: Array<{ value: string; label: string }>,
  initialValues: Record<string, unknown> = {},
) => {
  const onSubmit = jest.fn()
  render(
    <FormRenderer
      FormTemplate={FormTemplate}
      // The production mapper config, minus the next/dynamic wrapper jest
      // cannot resolve — the component under it is this same Select.
      componentMapper={{ select: { ...FIELD_MAP_SELECT, component: Select } }}
      onSubmit={onSubmit}
      initialValues={initialValues}
      schema={{
        fields: [
          { component: 'select', name: 'color', label: 'Theme color', options },
        ],
      }}
    />,
  )
  return onSubmit
}

const input = () => screen.getByLabelText(/Theme color/) as HTMLInputElement
const pick = (label: string) => {
  fireEvent.keyDown(input(), { key: 'ArrowDown' })
  fireEvent.click(screen.getByRole('option', { name: label }))
}
/** The values object the attributes panel would persist onto the node. */
const persisted = (onSubmit: jest.Mock) => {
  fireEvent.click(screen.getByText('Save'))
  return onSubmit.mock.calls[onSubmit.mock.calls.length - 1][0]
}

/**
 * AGL-1191: "Theme color → Default" on the App Bar marked the document dirty
 * but never round-tripped — after save + reload the field was empty and the
 * canvas rendered the implicit `primary` again. The option's value was `''`,
 * which this form stack strips on change (ddf's enhancedOnChange writes the
 * field's clearedValue for an emptied value; react-final-form's default parse
 * turns `''` into `undefined`), so the submitted values never contained the
 * key. These specs pin the round trip through the REAL select mapper.
 */
describe('Select round trip (AGL-1191)', () => {
  it('a picked color reaches the submitted values', () => {
    const onSubmit = renderSelect(themeColorOptions)
    pick('Secondary')
    expect(persisted(onSubmit).color).toBe('secondary')
  })

  it('picking Default persists the explicit `default` sentinel', () => {
    // Start from the repro: the bar already carried a color.
    const onSubmit = renderSelect(themeColorOptions, { color: 'primary' })
    pick('Default')
    expect(persisted(onSubmit).color).toBe('default')
  })

  it('a persisted `default` reads back as Default after reload', () => {
    renderSelect(themeColorOptions, { color: 'default' })
    expect(input().value).toBe('Default')
  })

  it('mechanism guard: an empty-string option value can never persist', () => {
    // This is the bug itself, reproduced: the legacy `''`-valued Default is
    // stripped before submit, so the key vanishes and the pick reverts on
    // reload. If this ever starts passing a value through, the stack's
    // clear semantics changed and the sentinel workaround can be revisited.
    const onSubmit = renderSelect(
      [{ value: '', label: 'Default' }, ...themeColorOptions.slice(1)],
      { color: 'primary' },
    )
    pick('Default')
    expect(persisted(onSubmit)).not.toHaveProperty('color')
  })
})
