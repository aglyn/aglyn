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

import { FormRenderer, useFormApi } from '../vendor/data-driven-forms'
import CssBorderField, {
  seedBorderDraft,
  serializeBorderDraft,
} from './css-border'

/**
 * AGL-2486 (Zach 2026-08-22): the thickness + line-style pair is an INPUT
 * affordance only — the value on the node is still one CSS shorthand
 * string, so every shape already sitting in a published document has to
 * survive a round trip through the control untouched.
 */
describe('border draft round trip (AGL-2486)', () => {
  it.each(['1px solid', '2px dashed', '3px dotted', '4px double', 'none', ''])(
    'serializes %s back to itself untouched',
    (value) => {
      expect(serializeBorderDraft(seedBorderDraft(value))).toBe(value)
    },
  )

  it('opens an existing shorthand on its two controls', () => {
    expect(seedBorderDraft('2px dashed')).toEqual({
      width: '2',
      style: 'dashed',
      custom: false,
    })
    // CSS allows the parts in any order, and hand-authored values use both.
    expect(seedBorderDraft('dashed 2px')).toEqual({
      width: '2',
      style: 'dashed',
      custom: false,
    })
    // A unitless width is what MUI's own `borderTransform` emits from a
    // bare number, so it has to read as a thickness rather than as raw text.
    expect(seedBorderDraft('1 solid')).toEqual({
      width: '1',
      style: 'solid',
      custom: false,
    })
    expect(seedBorderDraft('')).toEqual({
      width: '',
      style: '',
      custom: false,
    })
  })

  it('reads a bare NUMBER the way MUI does — n px, solid', () => {
    // `border: 2` renders `2px solid` through MUI's borderTransform. Read
    // as nothing, the control would blank a field that demonstrably paints
    // a border and then overwrite it on the first edit.
    expect(seedBorderDraft(2)).toEqual({
      width: '2',
      style: 'solid',
      custom: false,
    })
  })

  it('reads a stored 0 rather than blanking the field', () => {
    // `border: 0` is how a component's own border is removed, and 0 is
    // falsy while `strictNullChecks` is off repo-wide — so a `if (value)`
    // guard on the number branch loses exactly this value and then
    // overwrites it on the first edit. The string cases below cannot catch
    // that: `'0'` is truthy.
    expect(seedBorderDraft(0)).toEqual({
      width: '0',
      style: 'solid',
      custom: false,
    })
    expect(serializeBorderDraft(seedBorderDraft(0))).toBe('0px solid')
  })

  it('keeps 0 as a thickness — it is a value, not an empty field', () => {
    // `strictNullChecks` is off repo-wide and 0 is falsy, so this is the
    // exact shape a lazy emptiness test loses.
    expect(seedBorderDraft('0px solid')).toEqual({
      width: '0',
      style: 'solid',
      custom: false,
    })
    expect(serializeBorderDraft(seedBorderDraft('0px solid'))).toBe('0px solid')
  })

  it.each([
    // A colour in the shorthand: the commonest hand-authored value there
    // is, and the one the structured pair deliberately does not model.
    '1px solid #ff0000',
    '1px solid var(--mui-palette-primary-main, #00B0FF)',
    // Keyword widths and non-px units.
    'thin solid',
    '0.125rem solid',
    // Bevels the picker does not offer.
    '2px groove',
    // A binding token.
    '{{var:heroBorder}}',
  ])('passes %s through untouched instead of clobbering it', (raw) => {
    expect(seedBorderDraft(raw).custom).toBe(true)
    expect(serializeBorderDraft(seedBorderDraft(raw))).toBe(raw)
  })

  it('drops the thickness when there is no line to draw', () => {
    // `2px none` is meaningless CSS and shows a thickness whose effect the
    // author cannot see.
    expect(
      serializeBorderDraft({ width: '2', style: 'none', custom: false }),
    ).toBe('none')
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
      componentMapper={{ 'css-border': CssBorderField }}
      onSubmit={onSubmit}
      initialValues={initialValue !== undefined ? { border: initialValue } : {}}
      schema={{
        fields: [{ component: 'css-border', name: 'border', label: 'Border' }],
      }}
    />,
  )
  return onSubmit
}

const widthInput = () =>
  screen.getByLabelText('Border thickness') as HTMLInputElement
const styleButton = () =>
  screen.getByLabelText('Line style').parentElement as HTMLElement
/** What the form would persist — the node's sx still holds one CSS string. */
const persisted = (onSubmit: jest.Mock) => {
  fireEvent.click(screen.getByText('Save'))
  return onSubmit.mock.calls[onSubmit.mock.calls.length - 1][0]
}

describe('CssBorderField (AGL-2486)', () => {
  it('opens 2px dashed on its thickness and its line style', () => {
    renderField('2px dashed')
    expect(widthInput().value).toBe('2')
    expect(styleButton().textContent).toContain('Dashed')
  })

  it('writes back one CSS shorthand when the thickness changes', () => {
    const onSubmit = renderField('2px dashed')
    fireEvent.change(widthInput(), { target: { value: '4' } })
    expect(persisted(onSubmit).border).toBe('4px dashed')
  })

  it('draws a solid line when a thickness is typed with no style yet', () => {
    // A bare `1px` is not a border — it paints nothing at all, which is the
    // silent no-op that made the free-text field feel broken.
    const onSubmit = renderField('')
    fireEvent.change(widthInput(), { target: { value: '1' } })
    expect(persisted(onSubmit).border).toBe('1px solid')
  })

  it('leaves an untouched empty value empty', () => {
    const onSubmit = renderField('')
    expect(persisted(onSubmit).border).toBe('')
  })

  it('never asks the author to type shorthand grammar', () => {
    // The whole complaint: the field used to be a text box you typed
    // `1px solid` into. The thickness box is a NUMBER input and the style
    // is a menu — neither can accept a shorthand.
    renderField('1px solid')
    expect(widthInput().type).toBe('number')
    expect(screen.getByLabelText('Line style')).toBeTruthy()
  })

  it('keeps the empty picker one em-dash wide, off the field label', () => {
    // The label/adornment collision (AGL-2486 item 8, and Zach saw it again
    // on the new control): this picker is an endAdornment inside a
    // half-width field, so anything wide in its EMPTY state is subtracted
    // from the room the field's own label has and the two print on top of
    // each other. "line style" collided with `Border Bottom`; "—" does not.
    renderField('')
    expect(styleButton().textContent).toBe('—')
    // …and the unit is not stated until there is a number to state it for,
    // for the same reason: on an empty field it is pure width.
    expect(screen.queryByText('px')).toBeNull()
  })

  it('pins the label above the box so it cannot meet the picker', () => {
    // `Border Bottom` is thirteen characters in a half-width column with a
    // picker in its right-hand end. A floating label has nowhere to go.
    renderField('')
    // The fieldset legend carries the same text, so query the LABEL.
    const label = document.querySelector('label.MuiInputLabel-root')!
    expect(label.textContent).toBe('Border')
    expect(label.getAttribute('data-shrink')).toBe('true')
  })

  it('shows the line style in short form once one is chosen', () => {
    // Short in the box, the full sentence in the menu — the menu has the
    // whole popover to itself.
    renderField('2px dashed')
    expect(styleButton().textContent).toBe('Dashed')
    expect(screen.getByText('px')).toBeTruthy()
  })

  it('holds a hand-authored value the pair cannot model, and keeps it', () => {
    // The escape hatch. A colour in the shorthand is the commonest one, and
    // an author who wrote it must not find it gone.
    const onSubmit = renderField('1px solid #ff0000')
    expect(persisted(onSubmit).border).toBe('1px solid #ff0000')
    // …and the raw text stays editable rather than being locked or blanked.
    const raw = screen.getByLabelText('Border') as HTMLInputElement
    expect(raw.value).toBe('1px solid #ff0000')
  })

  it('takes the structured controls back when the raw text becomes plain', () => {
    // The mode is DERIVED from the value, so the escape hatch is never a
    // one-way door into a text box.
    const onSubmit = renderField('1px solid #ff0000')
    const raw = screen.getByLabelText('Border') as HTMLInputElement
    fireEvent.change(raw, { target: { value: '3px dotted' } })
    expect(persisted(onSubmit).border).toBe('3px dotted')
    expect(widthInput().value).toBe('3')
    expect(styleButton().textContent).toContain('Dotted')
  })
})
