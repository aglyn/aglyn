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

import * as Aglyn from '@aglyn/aglyn'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import Form, { FormField, formFieldSchema, parseFieldOptions } from './form'

/** Renders children inside a Form with a live site context + fetch mock. */
const renderForm = (children: React.ReactNode) => {
  const utils = render(
    <Aglyn.SiteContext.Provider value={{ hostId: 'host-1' }}>
      <Form formName="Survey">{children}</Form>
    </Aglyn.SiteContext.Provider>,
  )
  const form = utils.container.querySelector('form') as HTMLFormElement
  return { ...utils, form }
}

/** Fields payload of the (single) mocked submit call. */
const submittedFields = (fetchMock: jest.Mock): Record<string, string> => {
  const [, init] = fetchMock.mock.calls[0]
  return JSON.parse(init.body).fields
}

describe('form survey fields (AGL-544)', () => {
  let fetchMock: jest.Mock

  beforeEach(() => {
    fetchMock = jest
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({}) })
    global.fetch = fetchMock as unknown as typeof fetch
  })

  describe('parseFieldOptions', () => {
    it('splits newline- and comma-separated lists', () => {
      expect(parseFieldOptions('Red\nGreen\nBlue')).toEqual([
        'Red',
        'Green',
        'Blue',
      ])
      expect(parseFieldOptions('Red, Green, Blue')).toEqual([
        'Red',
        'Green',
        'Blue',
      ])
      expect(parseFieldOptions('Red\nGreen, Blue')).toEqual([
        'Red',
        'Green',
        'Blue',
      ])
    })

    it('trims entries and drops empties', () => {
      expect(parseFieldOptions('  Red \r\n\n , ,Blue  ')).toEqual([
        'Red',
        'Blue',
      ])
      expect(parseFieldOptions('')).toEqual([])
      expect(parseFieldOptions(undefined)).toEqual([])
    })
  })

  describe('FormField rendering', () => {
    it('keeps the legacy default text input behavior', () => {
      const { container } = render(<FormField fieldName="name" />)
      const input = container.querySelector(
        'input[name="name"]',
      ) as HTMLInputElement
      expect(input.type).toBe('text')
      expect(input.required).toBe(false)
    })

    it('renders a required select with the parsed choices', () => {
      const { container } = render(
        <FormField
          fieldName="color"
          label="Color"
          fieldType="select"
          options={'Red\nGreen\nBlue'}
          required
        />,
      )
      const nativeInput = container.querySelector(
        'input[name="color"]',
      ) as HTMLInputElement
      expect(nativeInput.required).toBe(true)
      fireEvent.mouseDown(screen.getByRole('combobox'))
      const options = screen.getAllByRole('option')
      expect(options.map((option) => option.textContent)).toEqual([
        'Red',
        'Green',
        'Blue',
      ])
    })

    it('renders a required radio group with one radio per choice', () => {
      render(
        <FormField
          fieldName="size"
          label="Size"
          fieldType="radio"
          options="Small, Medium, Large"
          required
        />,
      )
      const radios = screen.getAllByRole('radio') as HTMLInputElement[]
      expect(radios).toHaveLength(3)
      expect(radios.map((radio) => radio.value)).toEqual([
        'Small',
        'Medium',
        'Large',
      ])
      for (const radio of radios) {
        expect(radio.name).toBe('size')
        expect(radio.required).toBe(true)
      }
    })

    it('requires a checkbox group only until one box is ticked', () => {
      render(
        <FormField
          fieldName="toppings"
          fieldType="checkbox"
          options="Cheese, Olives"
          required
        />,
      )
      const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
      expect(boxes.map((box) => box.required)).toEqual([true, true])
      fireEvent.click(boxes[0])
      expect(boxes.map((box) => box.required)).toEqual([false, false])
      fireEvent.click(boxes[0])
      expect(boxes.map((box) => box.required)).toEqual([true, true])
    })
  })

  describe('Form submission', () => {
    it('joins multiple checkbox values under one field name', async () => {
      const { form } = renderForm(
        <FormField
          fieldName="toppings"
          fieldType="checkbox"
          options={'Cheese\nOlives\nPeppers'}
        />,
      )
      const boxes = screen.getAllByRole('checkbox')
      fireEvent.click(boxes[0])
      fireEvent.click(boxes[2])
      fireEvent.submit(form)
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
      expect(submittedFields(fetchMock)).toEqual({
        toppings: 'Cheese, Peppers',
      })
    })

    it('serializes the rating as a number and hides the star radios', async () => {
      const { form } = renderForm(
        <FormField fieldName="satisfaction" fieldType="rating" />,
      )
      fireEvent.click(screen.getByRole('radio', { name: '4 Stars' }))
      fireEvent.submit(form)
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
      // Only the hidden input submits; the `__`-prefixed radios do not.
      expect(submittedFields(fetchMock)).toEqual({ satisfaction: '4' })
    })
  })

  describe('formFieldSchema', () => {
    it('offers every survey field type in the editor', () => {
      const fieldType = formFieldSchema.attributes?.find(
        (attribute) => attribute.name === 'fieldType',
      )
      const values = (fieldType?.options ?? []).map(
        (option: { value: string }) => option.value,
      )
      for (const expected of ['select', 'radio', 'checkbox', 'rating']) {
        expect(values).toContain(expected)
      }
    })

    it('exposes an options textarea for the choice lists', () => {
      const options = formFieldSchema.attributes?.find(
        (attribute) => attribute.name === 'options',
      )
      expect(options?.component).toBe(Aglyn.FieldComponentType.TEXTAREA)
    })
  })
})
