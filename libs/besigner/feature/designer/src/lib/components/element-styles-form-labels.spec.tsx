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

import { componentMapper, FormRenderer } from '@aglyn/shared-ui-jsx-forms'
import { act, render, screen } from '@testing-library/react'

import {
  buildStyleFieldGroups,
  styleGroupFieldNames,
} from '../utils/style-field-groups'
import ElementStylesFormTemplate from './element-styles-form-template.component'

/**
 * A floating label must not be printed ON TOP of what the box already
 * shows (AGL-2486).
 *
 * MUI hides a real `placeholder` attribute behind CSS while the label is
 * un-shrunk, so the plain text fields are safe by construction. What is
 * NOT a placeholder — and therefore not hidden — is what a `Select` with
 * `displayEmpty` renders for an empty value: that is a real rendered
 * MenuItem, drawn inside the box, under a label MUI still believes has
 * nothing to float above. The two collide and both become unreadable.
 * Background Fill is where it was reported; the same pair of props is the
 * shape to look for.
 *
 * The assertion is `data-shrink` on the label element, which is the state
 * the collision is made of — jsdom computes no layout, so an overlap
 * cannot be measured, but the label's own answer to "is there content
 * under me?" can be.
 */
const groups = buildStyleFieldGroups(['#123456'])
const group = (id: string) => groups.find((entry) => entry.$id === id)!

/**
 * The MUI InputLabel element for a field, by its text. An outlined field
 * prints its label TWICE — once in the InputLabel, once in the notch
 * legend — and the InputLabel is a `<div>` on a select and a `<label>` on
 * a text box, so the class is what picks the one carrying the state.
 */
const label = (text: string) =>
  screen
    .getAllByText(text)
    .find((element) =>
      element.classList.contains('MuiInputLabel-root'),
    ) as HTMLElement

const renderGroup = async (
  groupId: string,
  initialValues: Record<string, unknown> = {},
) => {
  const fields = group(groupId)
  render(
    <FormRenderer
      FormTemplate={ElementStylesFormTemplate}
      componentMapper={componentMapper}
      onSubmit={() => undefined}
      initialValues={initialValues}
      schema={{ fields: fields.fields }}
    />,
  )
  // The field editors are code-split (next/dynamic).
  await act(async () => undefined)
  expect(styleGroupFieldNames(fields).length).toBeGreaterThan(0)
}

describe('styles panel field labels (AGL-2486)', () => {
  it('shrinks the Background Fill label over its rendered empty option', async () => {
    await renderGroup('colors')
    // The box is not empty: `displayEmpty` draws the unset choice by name.
    expect(screen.getByText('Default')).toBeTruthy()
    expect(label('Background Fill').getAttribute('data-shrink')).toBe('true')
  })

  it('keeps the label shrunk once a fill is chosen', async () => {
    // The fix must not be "shrink only while empty" — that would flip the
    // label on every change of the value.
    await renderGroup('colors', { backgroundImage: 'none' })
    expect(label('Background Fill').getAttribute('data-shrink')).toBe('true')
  })

  it('leaves a plain text field alone', async () => {
    // The negative control. MUI hides a real placeholder itself, so an
    // empty text box keeps its label centred — shrinking every label in
    // the panel would be a different change, not this fix.
    //
    // Retargeted from Border (AGL-2486, Zach 2026-08-22): Border is a
    // thickness box plus a line-style picker now, and its label is pinned
    // ON PURPOSE — see the test below. Line Height is a plain text box and
    // is what this control was always checking.
    await renderGroup('typography')
    expect(label('Line Height').getAttribute('data-shrink')).toBe('false')
  })

  it('pins a composed editor’s label above its adornments', async () => {
    // The other half of the same overlap (Zach 2026-08-22). `Border
    // Bottom` is thirteen characters in a half-width column with a
    // line-style picker parked in the box's right-hand end, so a floating
    // label has nowhere to go and prints straight over the picker. The
    // border editors therefore pin their label, which also settles the
    // group's rhythm: Border Color, Corner Radius and Shadow already sat
    // under a pinned one.
    await renderGroup('borders')
    for (const name of ['Border', 'Border Bottom', 'Outline']) {
      expect(label(name).getAttribute('data-shrink')).toBe('true')
    }
  })

  it('pins a preset picker’s label over its rendered empty option', async () => {
    // Same shape as Background Fill above: `displayEmpty` draws "Not set"
    // in the box, and MUI only floats a label once it thinks there is a
    // value — so the label sat on the placeholder.
    await renderGroup('borders')
    expect(screen.getAllByText('Not set').length).toBeGreaterThan(0)
    expect(label('Corner Radius').getAttribute('data-shrink')).toBe('true')
    expect(label('Shadow').getAttribute('data-shrink')).toBe('true')
  })

  it('shrinks a length label when a keyword unit is its whole value', async () => {
    // `auto` is shown through the PLACEHOLDER (there is no quantity to
    // type), and MUI hides a placeholder under an un-shrunk label — so the
    // field read as empty on a node that has a value.
    await renderGroup('sizing', { width: 'auto' })
    expect(label('Width').getAttribute('data-shrink')).toBe('true')
  })

  it('leaves a length label alone when it has a quantity to show', async () => {
    await renderGroup('sizing')
    expect(label('Height').getAttribute('data-shrink')).toBe('false')
  })
})
