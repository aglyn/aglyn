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
import { act, fireEvent, render, screen } from '@testing-library/react'

import {
  applyStylePartialToSx,
  buildStyleFieldGroups,
  computeEffectiveStyleValues,
  computeStylePartial,
  pickStyleValues,
  styleGroupFieldNames,
} from '../utils/style-field-groups'
import { ATTRIBUTE_COMMIT_DEBOUNCE_MS } from './element-props-form.component'
import ElementStylesFormTemplate from './element-styles-form-template.component'

/**
 * Every style field can be put BACK to unset (AGL-2486).
 *
 * The panel could only ever add: a colour picked once stayed on the node
 * for good (there is no empty swatch), a length re-adopted its unit the
 * moment a number came back into the emptied box, and a select had a
 * "Default" option only where someone had hand-authored one. "Unset" is a
 * real authoring choice — it is what "let the theme decide" looks like —
 * so it needs a control of its own.
 *
 * Driven through the REAL wiring (shared mapper, auto-applying template,
 * the panel's own responsive-sx merge) rather than the field declarations,
 * because the affordance lives on the shared field wrapper and the thing
 * worth asserting is that clicking it REMOVES the sx key — not that a prop
 * was passed.
 */
const groups = buildStyleFieldGroups(['#123456'])
const group = (id: string) => groups.find((entry) => entry.$id === id)!

interface Harness {
  sx: Record<string, any>
}

const renderGroup = async (
  groupId: string,
  initialSx: Record<string, any>,
): Promise<Harness> => {
  const fields = group(groupId)
  const names = styleGroupFieldNames(fields)
  const harness: Harness = { sx: initialSx }
  render(
    <FormRenderer
      FormTemplate={ElementStylesFormTemplate}
      componentMapper={componentMapper}
      onSubmit={(values: Record<string, unknown>) => {
        harness.sx = applyStylePartialToSx(
          harness.sx,
          computeStylePartial(names, values),
          null,
          null,
        )
      }}
      initialValues={pickStyleValues(
        names,
        computeEffectiveStyleValues(initialSx, null, null),
      )}
      schema={{ fields: fields.fields }}
    />,
  )
  // The field editors are code-split (next/dynamic).
  await act(async () => undefined)
  return harness
}

const clickClear = (label: string) => {
  act(() => {
    fireEvent.click(screen.getByRole('button', { name: `Clear ${label}` }))
  })
  act(() => jest.advanceTimersByTime(ATTRIBUTE_COMMIT_DEBOUNCE_MS))
}

describe('styles panel clear affordance (AGL-2486)', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
  })

  it('clears a colour field back to unset', async () => {
    const harness = await renderGroup('colors', { color: '#ff0000' })
    clickClear('Text Color')
    expect(harness.sx).toEqual({})
  })

  it('clears a length field, unit and all', async () => {
    // Emptying the number box alone left `px` selected and the next
    // keystroke re-adopted it, which is why deleting the digits was never
    // a way back to unset.
    const harness = await renderGroup('sizing', { width: '320px' })
    clickClear('Width')
    expect(harness.sx).toEqual({})
  })

  it('clears a free-text length field', async () => {
    const harness = await renderGroup('borders', { borderRadius: 2 })
    clickClear('Corner Radius')
    expect(harness.sx).toEqual({})
  })

  it('clears a select field', async () => {
    const harness = await renderGroup('position', { overflow: 'hidden' })
    clickClear('Overflow')
    expect(harness.sx).toEqual({})
  })

  it('clears the gradient field out of its raw-CSS fallback', async () => {
    // The fill-type select is DISABLED while a raw value is held, so this
    // is the only control that can leave that state.
    const harness = await renderGroup('colors', {
      backgroundImage: 'conic-gradient(red, blue)',
    })
    clickClear('Background Fill')
    expect(harness.sx).toEqual({})
  })

  it('offers nothing to clear on a field that has no value', async () => {
    await renderGroup('colors', {})
    expect(
      screen.queryByRole('button', { name: 'Clear Text Color' }),
    ).toBeNull()
  })

  it('leaves the other fields of the group alone', async () => {
    // The clear goes through the same scoped group save as every other
    // edit, so it must never take a neighbour with it.
    const harness = await renderGroup('sizing', {
      width: '320px',
      height: '240px',
    })
    clickClear('Width')
    expect(harness.sx).toEqual({ height: '240px' })
  })
})
