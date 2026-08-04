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
import { act, fireEvent, render, screen, within } from '@testing-library/react'

import {
  applyStylePartialToSx,
  buildFlexGapGroup,
  buildStyleFieldGroups,
  computeEffectiveStyleValues,
  computeStylePartial,
  pickStyleValues,
  styleGroupFieldNames,
} from '../utils/style-field-groups'
import type { SxBreakpoint } from '../utils/responsive-sx'
import { ATTRIBUTE_COMMIT_DEBOUNCE_MS } from './element-props-form.component'
import ElementStylesFormTemplate from './element-styles-form-template.component'

/**
 * The Sizing group driven through the REAL styles-panel wiring (AGL-1219):
 * the shared component mapper, the auto-applying form template, and the
 * responsive-sx merge the panel performs on submit. Asserting on the field
 * declarations alone would pass even if the editor type were unregistered —
 * an unregistered type makes the form renderer throw and blanks the panel.
 */
const groups = buildStyleFieldGroups(['#123456'])
const sizing = groups.find((group) => group.$id === 'sizing')!
const sizingNames = styleGroupFieldNames(sizing)

/** Live sx the harness mutates exactly the way the panel does. */
interface Harness {
  sx: Record<string, any>
}

const renderSizing = async (
  initialSx: Record<string, any>,
  breakpoint: SxBreakpoint | null = null,
): Promise<Harness> => {
  const harness: Harness = { sx: initialSx }
  render(
    <FormRenderer
      FormTemplate={ElementStylesFormTemplate}
      componentMapper={componentMapper}
      onSubmit={(values: Record<string, unknown>) => {
        harness.sx = applyStylePartialToSx(
          harness.sx,
          computeStylePartial(sizingNames, values),
          breakpoint,
          null,
        )
      }}
      initialValues={pickStyleValues(
        sizingNames,
        computeEffectiveStyleValues(initialSx, breakpoint, null),
      )}
      schema={{ fields: sizing.fields }}
    />,
  )
  // The field editors are code-split (next/dynamic), so the first render
  // in a file paints an empty grid until the chunk resolves.
  await act(async () => undefined)
  return harness
}

const box = (label: string) => screen.getByLabelText(label) as HTMLInputElement

/** The unit picker belonging to one field (each row has its own). */
const unitText = (label: string) => {
  const root = box(label).closest('.MuiInputBase-root') as HTMLElement
  return within(root).getByLabelText('Unit').parentElement?.textContent ?? ''
}

const type = (label: string, value: string) => {
  fireEvent.change(box(label), { target: { value } })
  act(() => jest.advanceTimersByTime(ATTRIBUTE_COMMIT_DEBOUNCE_MS))
}

describe('styles panel length fields (AGL-1219)', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
  })

  it('registers every editor the style groups declare', () => {
    // An unregistered component type makes the form renderer throw, which
    // blanks the whole panel rather than one field (AGL-584's failure).
    const declared = new Set(
      [...groups, buildFlexGapGroup()]
        .flatMap((group) => group.fields)
        .map((field) => field['component'] as string),
    )
    for (const component of declared) {
      expect(componentMapper[component]).toBeDefined()
    }
  })

  it('opens a length on its number with the unit in the picker', async () => {
    await renderSizing({ width: '320px', maxWidth: '60%' })
    expect(box('Width').value).toBe('320')
    expect(unitText('Width')).toContain('px')
    expect(box('Max Width').value).toBe('60')
    expect(unitText('Max Width')).toContain('%')
  })

  it('persists one CSS string, unchanged in shape, when the number changes', async () => {
    const harness = await renderSizing({ width: '320px' })
    type('Width', '640')
    expect(harness.sx).toEqual({ width: '640px' })
  })

  it('assumes pixels for a bare number — typing 320 used to render nothing', async () => {
    const harness = await renderSizing({})
    type('Height', '240')
    expect(harness.sx).toEqual({ height: '240px' })
  })

  it('clears the property when the box is emptied', async () => {
    const harness = await renderSizing({ width: '320px' })
    type('Width', '')
    expect(harness.sx).toEqual({})
  })

  // Breakpoint scoping (AGL-333): the panel writes into the previewed
  // breakpoint's slice, and reading a slice back must not pin it.
  describe('responsive-sx round trip', () => {
    it('writes into the active breakpoint and leaves the base alone', async () => {
      const harness = await renderSizing({ width: '100%' }, 'md')
      // Changing the number keeps the unit the value already had.
      type('Width', '50')
      expect(harness.sx).toEqual({ width: { xs: '100%', md: '50%' } })
    })

    it('opens the value inherited at that breakpoint', async () => {
      await renderSizing({ width: { xs: '100%', md: '320px' } }, 'lg')
      // lg has no slice of its own — mobile-first, it shows md's value.
      expect(box('Width').value).toBe('320')
      expect(unitText('Width')).toContain('px')
    })

    it('never pins an inherited value by editing a sibling field', async () => {
      // Width shows 100% at md because it inherits the base. Editing
      // Height must not write that reading into the md slice.
      const harness = await renderSizing({ width: '100%' }, 'md')
      type('Height', '240')
      expect(harness.sx['width']).toBe('100%')
      expect(harness.sx['height']).toEqual({ md: '240px' })
    })
  })

  /**
   * MUI reads a bare number in an sx sizing key through `sizingTransform`:
   * a number in (0, 1] is a FRACTION of the parent, everything else is
   * pixels. The control has to agree, and above all must not rewrite a
   * number the author never touched.
   */
  describe('values stored as a NUMBER', () => {
    it('opens a fractional number as the percentage it renders as', async () => {
      await renderSizing({ width: 0.5, height: 240 })
      expect(box('Width').value).toBe('50')
      expect(unitText('Width')).toContain('%')
      expect(box('Height').value).toBe('240')
      expect(unitText('Height')).toContain('px')
    })

    it('leaves an untouched number exactly as it was stored', async () => {
      const harness = await renderSizing({ width: 0.5, minHeight: 320 })
      type('Height', '240')
      // Still numbers, not "50%"/"320px" strings: the panel skips values
      // it did not change, so nothing rewrites the document behind the
      // author's back.
      expect(harness.sx['width']).toBe(0.5)
      expect(harness.sx['minHeight']).toBe(320)
    })

    it('replaces the number with an explicit CSS string once edited', async () => {
      const harness = await renderSizing({ width: 0.5 })
      type('Width', '60')
      expect(harness.sx).toEqual({ width: '60%' })
    })
  })

  /** Values the control cannot model must survive it untouched. */
  describe('values the number+unit control cannot model', () => {
    it.each([
      ['calc(100% - 2rem)', 'maxWidth', 'Max Width'],
      // MUI resolves a breakpoint KEY here: maxWidth: 'sm' is 600px.
      ['sm', 'maxWidth', 'Max Width'],
      ['min-content', 'minWidth', 'Min Width'],
      ['{{var:heroWidth}}', 'width', 'Width'],
    ])('holds %s verbatim in a text box', async (value, field, label) => {
      const harness = await renderSizing({ [field]: value })
      expect(box(label).value).toBe(value)
      expect(box(label).getAttribute('type')).toBe('text')
      expect(unitText(label)).toContain('custom')

      // …and a sibling edit does not clobber it.
      type('Height', '240')
      expect(harness.sx[field]).toBe(value)
    })
  })
})
