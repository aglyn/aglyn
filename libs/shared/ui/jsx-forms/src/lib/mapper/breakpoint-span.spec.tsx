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
  buildBreakpointSpan,
  parseBreakpointSpan,
} from '@aglyn/shared-data-enums'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

import { FIELD_MAP_BREAKPOINT_SPAN } from '../constants/field-configurations'
import { FormRenderer, useFormApi } from '../vendor/data-driven-forms'
import {
  BreakpointSpanField,
  seedSpanDraft,
  serializeSpanDraft,
} from './breakpoint-span'

/**
 * Every stored shape the Span/Offset fields have ever been able to hold. The
 * editor replacing the text box (AGL-2486) is only safe if seeding and
 * re-serializing each of these hands back the SAME STRING — a published page
 * must not change because its element was opened in the panel.
 */
const STORED = [
  '',
  '6',
  '12',
  '0',
  'auto',
  'grow',
  'xs:12 md:6',
  'xs:12 md:4',
  'xs:12 sm:6 md:4 lg:3 xl:2',
  'xs:12 md:auto',
  'xs:grow md:2',
  'md:2',
  // Values the row cannot model: they must survive VERBATIM rather than
  // being flattened to whatever a lenient read salvaged.
  'xs:12 md:',
  'xs:12 nonsense',
  'xxl:12',
  'twelve',
  '{{var:span}}',
]

describe('parseBreakpointSpan / buildBreakpointSpan (AGL-2486)', () => {
  it('reads a breakpoint-less value as `base`, not as xs', () => {
    // The two are different STORED strings and MUI's prop is a scalar or an
    // object, never both — collapsing one into the other would rewrite the
    // document the first time a cell was opened.
    expect(parseBreakpointSpan('6')).toEqual({ base: 6 })
    expect(parseBreakpointSpan('xs:6')).toEqual({ values: { xs: 6 } })
  })

  it('reads the keywords, both separators, and any case', () => {
    expect(parseBreakpointSpan('auto')).toEqual({ base: 'auto' })
    expect(parseBreakpointSpan('grow')).toEqual({ base: 'grow' })
    expect(parseBreakpointSpan('xs=12, md=6')).toEqual({
      values: { xs: 12, md: 6 },
    })
    expect(parseBreakpointSpan('SM:6')).toEqual({ values: { sm: 6 } })
  })

  it('normalizes pair order so the serialized string is stable', () => {
    expect(buildBreakpointSpan(parseBreakpointSpan('md:6 xs:12'))).toBe(
      'xs:12 md:6',
    )
  })

  it('hands back an unmodellable string under `raw`, untouched', () => {
    expect(parseBreakpointSpan('xs:12 md:')).toEqual({ raw: 'xs:12 md:' })
    expect(parseBreakpointSpan('xxl:12')).toEqual({ raw: 'xxl:12' })
    expect(parseBreakpointSpan('{{var:span}}')).toEqual({
      raw: '{{var:span}}',
    })
  })

  it('treats a blank as unset rather than as a zero-width column', () => {
    expect(parseBreakpointSpan('')).toEqual({})
    expect(parseBreakpointSpan(null)).toEqual({})
    expect(parseBreakpointSpan(undefined)).toEqual({})
    expect(buildBreakpointSpan({})).toBe('')
    expect(buildBreakpointSpan(undefined)).toBe('')
  })

  it('keeps `0`, which is a real offset and not "unset"', () => {
    // strictNullChecks is off repo-wide and `!value` would swallow it.
    expect(parseBreakpointSpan('0')).toEqual({ base: 0 })
    expect(buildBreakpointSpan({ base: 0 })).toBe('0')
    expect(buildBreakpointSpan({ values: { xs: 0, md: 2 } })).toBe('xs:0 md:2')
  })
})

describe('the draft round-trips every stored value (AGL-2486)', () => {
  it.each(STORED)('%p is unchanged by seed -> serialize', (stored) => {
    expect(serializeSpanDraft(seedSpanDraft(stored))).toBe(stored)
  })

  it('is measured over a corpus that carries every shape', () => {
    // A corpus that quietly lost its unmodellable or keyword entries would
    // make the round-trip above pass by having nothing hard to round-trip.
    expect(STORED.filter((v) => v.includes(':')).length).toBeGreaterThan(4)
    expect(
      STORED.filter((v) => parseBreakpointSpan(v).raw !== undefined).length,
    ).toBeGreaterThan(3)
    expect(
      STORED.filter((v) => parseBreakpointSpan(v).base !== undefined).length,
    ).toBeGreaterThan(3)
  })

  it('reads a value persisted as a NUMBER, not just as a string', () => {
    // `props: { size: 6 }` is legal in a stored document; a string-only read
    // would blank the row and then overwrite the number on the first edit.
    expect(seedSpanDraft(6).base).toBe('6')
    expect(serializeSpanDraft(seedSpanDraft(6))).toBe('6')
  })
})

describe('the draft is the shape the row of controls needs', () => {
  it('puts each pair in its own breakpoint cell', () => {
    const draft = seedSpanDraft('xs:12 md:4')
    expect(draft.custom).toBe(false)
    expect(draft.base).toBe('')
    expect(draft.values).toEqual({
      xs: '12',
      sm: '',
      md: '4',
      lg: '',
      xl: '',
    })
  })

  it('puts a breakpoint-less value in the All cell', () => {
    const draft = seedSpanDraft('auto')
    expect(draft.base).toBe('auto')
    expect(Object.values(draft.values).every((v) => v === '')).toBe(true)
  })

  it('falls back to the text box for what it cannot model', () => {
    const draft = seedSpanDraft('xs:12 nonsense')
    expect(draft.custom).toBe(true)
    expect(draft.text).toBe('xs:12 nonsense')
  })

  it('serializes the All cell as a scalar and ignores empty cells', () => {
    expect(
      serializeSpanDraft({
        custom: false,
        text: '',
        base: '6',
        values: { xs: '', sm: '', md: '', lg: '', xl: '' },
      }),
    ).toBe('6')
    expect(
      serializeSpanDraft({
        custom: false,
        text: '',
        base: '',
        values: { xs: '12', sm: '', md: 'auto', lg: '', xl: '' },
      }),
    ).toBe('xs:12 md:auto')
  })

  it('emits an empty string when nothing is set, which CLEARS the prop', () => {
    expect(
      serializeSpanDraft({
        custom: false,
        text: '',
        base: '',
        values: { xs: '', sm: '', md: '', lg: '', xl: '' },
      }),
    ).toBe('')
  })
})

/**
 * The rendered field. `next/dynamic` is not resolvable in this harness, so
 * the production mapper entry is used with its component swapped for the same
 * module the dynamic import loads — the arrangement `select.spec.tsx` uses.
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
        'breakpoint-span': {
          ...FIELD_MAP_BREAKPOINT_SPAN,
          component: BreakpointSpanField,
        },
      }}
      onSubmit={onSubmit}
      initialValues={initialValues}
      schema={{
        fields: [
          {
            component: 'breakpoint-span',
            name: 'size',
            label: 'Span',
            ...field,
          },
        ],
      }}
    />,
  )
  return onSubmit
}

const cell = (name: string) =>
  screen.getByLabelText(`Span ${name}`, { selector: '[role="combobox"]' })

const persisted = (onSubmit: jest.Mock) => {
  fireEvent.click(screen.getByText('Save'))
  return onSubmit.mock.calls[onSubmit.mock.calls.length - 1][0]
}

describe('BreakpointSpanField (AGL-2486)', () => {
  it('shows one control per breakpoint, plus All', () => {
    renderField({})
    for (const name of ['All', 'xs', 'sm', 'md', 'lg', 'xl']) {
      expect(cell(name)).toBeTruthy()
    }
  })

  it('opens a stored responsive value into its breakpoint cells', () => {
    renderField({}, { size: 'xs:12 md:4' })
    expect(cell('xs').textContent).toBe('12')
    expect(cell('md').textContent).toBe('4')
    expect(cell('All').textContent).toBe('—')
  })

  it('does not rewrite the stored value just by rendering it', () => {
    // The whole backward-compatibility claim: opening the panel on a page
    // built before this change must persist the same string back.
    const onSubmit = renderField({}, { size: 'xs:12 md:4' })
    expect(persisted(onSubmit).size).toBe('xs:12 md:4')
  })

  it('writes the same syntax the text box wrote', () => {
    const onSubmit = renderField({})
    fireEvent.mouseDown(cell('md'))
    fireEvent.click(screen.getByRole('option', { name: '6' }))
    expect(persisted(onSubmit).size).toBe('md:6')
  })

  it('offers `grow` for a span and withholds it from an offset', () => {
    renderField({})
    fireEvent.mouseDown(cell('All'))
    expect(screen.queryByRole('option', { name: 'grow' })).toBeTruthy()
    expect(screen.queryByRole('option', { name: 'auto' })).toBeTruthy()
    cleanup()

    renderField({ label: 'Span', allowGrow: false, minSpan: 0 })
    fireEvent.mouseDown(cell('All'))
    expect(screen.queryByRole('option', { name: 'grow' })).toBeNull()
    // 0 is a real offset; the span list starts at 1.
    expect(screen.queryByRole('option', { name: '0' })).toBeTruthy()
  })

  it('keeps a stored span the option list does not carry', () => {
    // A container that overrode `columns` can hold a span above 12; the
    // list appending it is what stops the next edit from silently losing it.
    const onSubmit = renderField({}, { size: 'md:16' })
    expect(cell('md').textContent).toBe('16')
    expect(persisted(onSubmit).size).toBe('md:16')
  })

  it('falls back to a text box for a value it cannot model', () => {
    const onSubmit = renderField({}, { size: '{{var:span}}' })
    expect(screen.queryByLabelText('Span xs')).toBeNull()
    expect(
      (screen.getByDisplayValue('{{var:span}}') as HTMLInputElement).value,
    ).toBe('{{var:span}}')
    expect(persisted(onSubmit).size).toBe('{{var:span}}')
  })

  it('lets an author reach the raw syntax on purpose', () => {
    renderField({})
    fireEvent.click(screen.getByText('Edit as text'))
    expect(screen.getByPlaceholderText('xs:12 md:6')).toBeTruthy()
  })
})
