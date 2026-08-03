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

import {
  buildCssDimension,
  CssUnit,
  parseCssDimension,
  parseCssMeasurement,
} from '@aglyn/shared-data-enums'
import { fireEvent, render, screen } from '@testing-library/react'

import { FormRenderer, useFormApi } from '../vendor/data-driven-forms'
import CssDimensionField, {
  seedDimensionDraft,
  serializeDimensionDraft,
} from './css-dimension'

// AGL-1219: the number+unit editor is an input affordance only — the value
// on the node is still one CSS string, so every shape already in a
// published document has to survive a round trip through the control.
describe('parseCssDimension / buildCssDimension (AGL-1219)', () => {
  it.each([
    ['920px', 920, CssUnit.PIXELS],
    ['100%', 100, CssUnit.PERCENT],
    ['1.5rem', 1.5, CssUnit.REM],
    ['20em', 20, CssUnit.EM],
    ['100vh', 100, CssUnit.VIEWPORT_HEIGHT],
    ['50vw', 50, CssUnit.VIEWPORT_WIDTH],
    ['-4px', -4, CssUnit.PIXELS],
    ['.75rem', 0.75, CssUnit.REM],
  ])('splits %s into a number and a unit', (raw, value, unit) => {
    expect(parseCssDimension(raw)).toEqual({ value, unit })
    expect(buildCssDimension({ value, unit })).toBe(raw === '.75rem' ? '0.75rem' : raw)
  })

  it('treats keyword units as the whole value', () => {
    expect(parseCssDimension('auto')).toEqual({ unit: CssUnit.AUTO })
    expect(buildCssDimension({ unit: CssUnit.AUTO })).toBe('auto')
    expect(parseCssDimension('inherit')).toEqual({ unit: CssUnit.INHERIT })
    expect(buildCssDimension({ unit: CssUnit.INHERIT })).toBe('inherit')
  })

  it('keeps an empty value empty', () => {
    // The image `height` attribute documents "leave empty for auto" — an
    // editor that turns that into `0px` or `auto` changes the render.
    expect(parseCssDimension('')).toEqual({})
    expect(parseCssDimension(undefined)).toEqual({})
    expect(parseCssDimension(null)).toEqual({})
    expect(buildCssDimension({})).toBe('')
    expect(buildCssDimension(undefined)).toBe('')
    // A unit with no quantity is not a value either.
    expect(buildCssDimension({ unit: CssUnit.PIXELS })).toBe('')
  })

  it.each([
    'calc(100% - 2rem)',
    'clamp(320px, 50%, 960px)',
    'min-content',
    '{{var:heroWidth}}',
    '10q',
  ])('passes %s through untouched instead of clobbering it', (raw) => {
    expect(parseCssDimension(raw)).toEqual({ raw })
    expect(buildCssDimension(parseCssDimension(raw))).toBe(raw)
  })

  it('round-trips a unitless legacy number without inventing a unit', () => {
    expect(parseCssDimension('12')).toEqual({ value: 12, unit: undefined })
    expect(buildCssDimension({ value: 12 })).toBe('12')
  })

  it('reads decimals for the box styler too (parseCssMeasurement)', () => {
    // The hand-rolled parser this now delegates to split only the leading
    // integer off, so `1.5rem` came back as 1 + ".5rem" — and as a STRING
    // quantity, which the serializer's numeric guard then dropped.
    expect(parseCssMeasurement('1.5rem')).toEqual({
      value: 1.5,
      unit: CssUnit.REM,
    })
    expect(parseCssMeasurement('auto')).toEqual({
      value: undefined,
      unit: CssUnit.AUTO,
    })
  })
})

describe('dimension draft round trip (AGL-1219)', () => {
  it.each(['920px', '100%', 'auto', '1.5rem', 'calc(100% - 2rem)', ''])(
    'serializes %s back to itself untouched',
    (value) => {
      expect(serializeDimensionDraft(seedDimensionDraft(value))).toBe(value)
    },
  )

  it('opens an existing value on its number and unit', () => {
    expect(seedDimensionDraft('920px')).toEqual({
      text: '920',
      unit: CssUnit.PIXELS,
      custom: false,
    })
    expect(seedDimensionDraft('auto')).toEqual({
      text: '',
      unit: CssUnit.AUTO,
      custom: false,
    })
    expect(seedDimensionDraft('')).toEqual({ text: '', unit: '', custom: false })
    expect(seedDimensionDraft('calc(100% - 2rem)')).toEqual({
      text: 'calc(100% - 2rem)',
      unit: '',
      custom: true,
    })
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

const renderField = (initialValue?: string) => {
  const onSubmit = jest.fn()
  render(
    <FormRenderer
      FormTemplate={FormTemplate}
      componentMapper={{ 'css-dimension': CssDimensionField }}
      onSubmit={onSubmit}
      initialValues={initialValue !== undefined ? { width: initialValue } : {}}
      schema={{
        fields: [
          { component: 'css-dimension', name: 'width', label: 'Width' },
        ],
      }}
    />,
  )
  return onSubmit
}

const numberInput = () => screen.getByLabelText('Width') as HTMLInputElement
const unitButton = () =>
  screen.getByLabelText('Unit').parentElement as HTMLElement
/** What the form would persist — the node prop is still one CSS string. */
const persisted = (onSubmit: jest.Mock) => {
  fireEvent.click(screen.getByText('Save'))
  return onSubmit.mock.calls[onSubmit.mock.calls.length - 1][0]
}

describe('CssDimensionField (AGL-1219)', () => {
  it('opens 920px as 920 with px selected', () => {
    renderField('920px')
    expect(numberInput().value).toBe('920')
    expect(unitButton().textContent).toContain('px')
  })

  it('writes back one CSS string when the number changes', () => {
    const onSubmit = renderField('920px')
    fireEvent.change(numberInput(), { target: { value: '640' } })
    expect(numberInput().value).toBe('640')
    expect(persisted(onSubmit).width).toBe('640px')
  })

  it('defaults a bare number to pixels — `320` alone renders nothing', () => {
    const onSubmit = renderField('')
    fireEvent.change(numberInput(), { target: { value: '320' } })
    expect(persisted(onSubmit).width).toBe('320px')
  })

  it('leaves an untouched empty value empty', () => {
    const onSubmit = renderField('')
    expect(persisted(onSubmit).width).toBe('')
  })

  it('keeps the quantity when only the unit changes', () => {
    const onSubmit = renderField('920px')
    fireEvent.mouseDown(
      document.querySelector('.MuiSelect-select') as Element,
    )
    fireEvent.click(screen.getByRole('option', { name: 'rem' }))
    expect(persisted(onSubmit).width).toBe('920rem')
  })

  it('stores a keyword unit as the whole value', () => {
    const onSubmit = renderField('920px')
    fireEvent.mouseDown(
      document.querySelector('.MuiSelect-select') as Element,
    )
    fireEvent.click(screen.getByRole('option', { name: 'auto' }))
    expect(persisted(onSubmit).width).toBe('auto')
  })

  it('shows a legacy numeric prop instead of blanking it', () => {
    render(
      <FormRenderer
        FormTemplate={FormTemplate}
        componentMapper={{ 'css-dimension': CssDimensionField }}
        onSubmit={jest.fn()}
        initialValues={{ width: 320 }}
        schema={{
          fields: [
            { component: 'css-dimension', name: 'width', label: 'Width' },
          ],
        }}
      />,
    )
    expect(numberInput().value).toBe('320')
  })

  it('shows a custom expression as free text rather than destroying it', () => {
    renderField('calc(100% - 2rem)')
    expect(numberInput().value).toBe('calc(100% - 2rem)')
    expect(numberInput().getAttribute('type')).toBe('text')
    expect(unitButton().textContent).toContain('custom')
  })
})
