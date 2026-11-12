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
import { FormRenderer, FormSpy, useFormApi } from '../vendor/data-driven-forms'
import Select from './select'
import TextField from './text-field'
import Textarea from './textarea'

/**
 * A field cleared and saved reads as saved (AGL-4047).
 *
 * Clearing a box hands final-form `undefined` (react-final-form's default
 * parse turns `''` into it, and the renderer writes the field's clearedValue
 * for an emptied one), while the stored copy seeds the form back as `''`.
 * Compared with `===` the two differ, so after the save landed the card kept
 * saying "Update" over a form that held exactly what was stored. These pin
 * the round trip through the real mappers, the way a settings card reseeds
 * after its save: same form, new `initialValues`, `keepDirtyOnReinitialize`.
 */
const FormTemplate = ({ formFields }: any) => {
  const { handleSubmit } = useFormApi()
  return (
    <form onSubmit={handleSubmit}>
      {formFields}
      <FormSpy subscription={{ pristine: true }}>
        {({ pristine }) => <span>{pristine ? 'Up to date' : 'Update'}</span>}
      </FormSpy>
    </form>
  )
}

const mapper = {
  'text-field': TextField,
  textarea: Textarea,
  select: { ...FIELD_MAP_SELECT, component: Select },
}

const fields = [
  { component: 'text-field', name: 'whatYouDo', label: 'What the business does' },
  { component: 'textarea', name: 'services', label: 'Services' },
  {
    component: 'select',
    name: 'tone',
    label: 'Tone',
    options: [
      { value: 'warm', label: 'Warm' },
      { value: 'formal', label: 'Formal' },
    ],
  },
]

const renderCard = (initialValues: Record<string, unknown>) => {
  const view = (values: Record<string, unknown>) => (
    <FormRenderer
      FormTemplate={FormTemplate}
      componentMapper={mapper}
      onSubmit={jest.fn()}
      schema={{ fields }}
      initialValues={values}
      keepDirtyOnReinitialize
    />
  )
  const { rerender } = render(view(initialValues))
  return { reseed: (values: Record<string, unknown>) => rerender(view(values)) }
}

const stored = { whatYouDo: 'Dog grooming', services: 'Baths\nTrims', tone: 'warm' }
const cleared = { whatYouDo: '', services: '', tone: '' }

describe('a cleared field after its save (AGL-4047)', () => {
  it.each([
    ['a text field', 'What the business does'],
    ['a text area', 'Services'],
  ])('%s reads Up to date once the stored copy is empty too', (_kind, label) => {
    const card = renderCard(stored)
    expect(screen.getByText('Up to date')).toBeTruthy()
    fireEvent.change(screen.getByLabelText(label), { target: { value: '' } })
    expect(screen.getByText('Update')).toBeTruthy()
    const name = label === 'Services' ? 'services' : 'whatYouDo'
    card.reseed({ ...stored, [name]: '' })
    expect(screen.getByText('Up to date')).toBeTruthy()
  })

  it('a cleared select reads Up to date once the stored copy is empty too', () => {
    const card = renderCard(stored)
    fireEvent.mouseDown(screen.getByLabelText(/Tone/))
    const clear = screen.getByTitle('Clear')
    fireEvent.click(clear)
    expect(screen.getByText('Update')).toBeTruthy()
    card.reseed({ ...stored, tone: '' })
    expect(screen.getByText('Up to date')).toBeTruthy()
  })

  it('an empty field typed into and emptied again is unchanged', () => {
    renderCard(cleared)
    const box = screen.getByLabelText('What the business does')
    fireEvent.change(box, { target: { value: 'G' } })
    expect(screen.getByText('Update')).toBeTruthy()
    fireEvent.change(box, { target: { value: '' } })
    expect(screen.getByText('Up to date')).toBeTruthy()
  })

  it('a real change still reads Update', () => {
    const card = renderCard(stored)
    fireEvent.change(screen.getByLabelText('What the business does'), { target: { value: 'Cat grooming' } })
    card.reseed(stored)
    expect(screen.getByText('Update')).toBeTruthy()
  })
})
