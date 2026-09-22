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
 * A section heading is bound to its own fields, and a nested one reads as
 * nested (AGL-3253).
 *
 * jsdom computes no layout, so the pixel rhythm itself is not assertable here
 * — it was measured in a browser against the real card, and the numbers are
 * recorded in `sub-form.tsx`. What IS assertable, and what actually regresses,
 * is the two structural facts those numbers rest on:
 *
 *  - the row gap under a heading is declared on the sub-form and the gap
 *    between its fields on the items grid, so the two differ. Delete either
 *    `rowSpacing` and both silently become whatever an ancestor's `spacing`
 *    happens to be — MUI v7 spaces with `gap` through INHERITED custom
 *    properties, which is how they came to be equal in the first place.
 *  - depth comes from the tree. A nested sub-form that rendered its title the
 *    same way as its parent's is the defect, and nothing in a schema
 *    distinguishes the two.
 */
import { render, screen } from '@testing-library/react'

import {
  FIELD_MAP_TEXT_FIELD,
  FIELD_SUB_FORM,
} from '../constants/field-configurations'
import { FieldComponentType } from '../constants/flags'
import { FormRenderer } from '../vendor/data-driven-forms'
import SubForm from './sub-form'
import TextField from './text-field'

/*
 * The real components, wired directly.
 *
 * `simpleComponentMapper` reaches both through `next/dynamic`, so a render
 * under jsdom resolves them a tick later and every query below would race the
 * import — which is not the property this file is about.
 */
const componentMapper = {
  [FieldComponentType.SUB_FORM]: { ...FIELD_SUB_FORM, component: SubForm },
  [FieldComponentType.TEXT_FIELD]: {
    ...FIELD_MAP_TEXT_FIELD,
    component: TextField,
  },
}

const FormTemplate = ({ formFields }: { formFields: React.ReactNode }) => (
  <div>{formFields}</div>
)

const renderSchema = () =>
  render(
    <FormRenderer
      FormTemplate={FormTemplate as never}
      componentMapper={componentMapper as never}
      onSubmit={() => undefined}
      schema={{
        fields: [
          {
            component: FieldComponentType.SUB_FORM,
            name: 'entity',
            title: 'Entity',
            fields: [
              {
                component: FieldComponentType.TEXT_FIELD,
                name: 'entity.name',
                label: 'Name',
              },
              {
                component: FieldComponentType.SUB_FORM,
                name: 'entity.address',
                title: 'Address',
                fields: [
                  {
                    component: FieldComponentType.TEXT_FIELD,
                    name: 'entity.address.city',
                    label: 'City',
                  },
                ],
              },
            ],
          },
        ],
      }}
    />,
  )

describe('a sub-form has a rhythm of its own (AGL-3253)', () => {
  it('THE CONTROL: both sections render, one inside the other', () => {
    renderSchema()
    const entity = screen.getByText('Entity')
    const address = screen.getByText('Address')
    expect(entity).toBeTruthy()
    expect(entity.contains(address)).toBe(false)
    // The nesting the depth context reads; without it the test below proves
    // nothing about a SUBsection.
    expect(
      entity.closest('.MuiGrid-container')?.contains(address),
    ).toBe(true)
  })

  it('spaces a heading from its fields differently from field to field', () => {
    renderSchema()
    const section = screen
      .getByText('Entity')
      .closest('.MuiGrid-container') as HTMLElement
    const items = section.querySelector(
      ':scope > .MuiGrid-container',
    ) as HTMLElement
    /*
     * The numbers, not merely "different". `--Grid-rowSpacing` is `0px` on a
     * container that declares none, and `0px` is a truthy string — so a test
     * that asked only for a value passed against the pre-AGL-3253 component,
     * where the heading's gap came from an ancestor and could be anything.
     */
    const gap = (element: HTMLElement) =>
      parseFloat(
        getComputedStyle(element).getPropertyValue('--Grid-rowSpacing') || '0',
      )
    expect(gap(section)).toBe(8)
    expect(gap(items)).toBe(16)
    // The property the numbers serve: a heading is closer to the fields it
    // names than those fields are to each other.
    expect(gap(section)).toBeLessThan(gap(items))
  })

  it('spans the full row, rather than whatever its contents resolve to', () => {
    renderSchema()
    const section = screen
      .getByText('Entity')
      .closest('.MuiGrid-container') as HTMLElement
    // `fieldSharedOptions` used to spread `size: 'small'` — MUI input density
    // — onto a Grid, where `size` means COLUMN SPAN, and it landed after the
    // component's own `size={{ xs: 12 }}`. The result was a class with no
    // width rule (AGL-3253).
    expect(section.className).toContain('MuiGrid-grid-xs-12')
    expect(section.className).not.toContain('xs-small')
  })

  it('reads a nested section as nested, without being told', () => {
    renderSchema()
    // Neither schema field says how deep it is; the depth context is what
    // separates them, and the heading LEVEL is the part a screen reader uses.
    expect(screen.getByText('Entity').tagName).toBe('H4')
    expect(screen.getByText('Address').tagName).toBe('H5')
    expect(screen.getByText('Entity').className).not.toBe(
      screen.getByText('Address').className,
    )
  })

  it('never outranks the card it sits in, which renders its title at h6', () => {
    // `CardDisplay` uses `variant="h6"`. This mapper asked for `h5`, which is
    // LARGER — a section heading bigger than the card containing it.
    renderSchema()
    expect(screen.getByText('Entity').className).toContain('subtitle1')
    expect(screen.getByText('Entity').className).not.toContain('MuiTypography-h5')
  })
})
