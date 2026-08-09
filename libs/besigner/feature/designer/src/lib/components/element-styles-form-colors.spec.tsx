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
 * The Colors group driven through the REAL styles-panel wiring (AGL-1331):
 * the shared component mapper, the auto-applying form template, and the
 * responsive-sx merge the panel performs on submit.
 *
 * Two things are under test, and they are two halves of one bug. The panel
 * could not express a gradient at all — so an author typed one into
 * *Background Color*, where it was accepted, stored as
 * `background-color: linear-gradient(…)`, and dropped by the CSS parser:
 * the band went transparent with no error anywhere. The Background Fill
 * control is the way to say it; the validator is what stops the value that
 * would vanish.
 */
const colorsGroup = (options?: { isInstanceOverride?: boolean }) =>
  buildStyleFieldGroups(['#123456'], options).find(
    (group) => group.$id === 'colors',
  )!
const colors = colorsGroup()
const colorNames = styleGroupFieldNames(colors)

const CTA = 'linear-gradient(242deg, #00B0FF 0%, #7A5CF0 55%, #E040FB 100%)'

interface Harness {
  sx: Record<string, any>
}

const renderColors = async (
  initialSx: Record<string, any> = {},
  group = colors,
): Promise<Harness> => {
  const harness: Harness = { sx: initialSx }
  render(
    <FormRenderer
      FormTemplate={ElementStylesFormTemplate}
      componentMapper={componentMapper}
      onSubmit={(values: Record<string, unknown>) => {
        harness.sx = applyStylePartialToSx(
          harness.sx,
          computeStylePartial(colorNames, values),
          null,
          null,
        )
      }}
      initialValues={pickStyleValues(
        colorNames,
        computeEffectiveStyleValues(initialSx, null, null),
      )}
      schema={{ fields: group.fields }}
    />,
  )
  // The field editors are code-split (next/dynamic).
  await act(async () => undefined)
  return harness
}

const type = (label: string, value: string) => {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
  act(() => jest.advanceTimersByTime(ATTRIBUTE_COMMIT_DEBOUNCE_MS))
}

const pickFill = (label: string) => {
  act(() => {
    fireEvent.mouseDown(document.querySelector('.MuiSelect-select') as Element)
  })
  act(() => {
    fireEvent.click(screen.getByRole('option', { name: label }))
  })
  act(() => jest.advanceTimersByTime(ATTRIBUTE_COMMIT_DEBOUNCE_MS))
}

/** What the fill select currently reads. */
const fillValue = () =>
  (document.querySelector('.MuiSelect-select') as HTMLElement).textContent

describe('styles panel Colors group (AGL-1331)', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
  })

  it('offers a Background Fill control beside the two colour fields', () => {
    // The gap: Colors offered exactly Text Color and Background Color, and
    // there was no background-image or multi-stop control anywhere.
    expect(colors.fields.map((field) => field.label)).toEqual([
      'Text Color',
      'Background Color',
      'Background Fill',
    ])
  })

  it('refuses a gradient in Background Color instead of storing it silently', async () => {
    const harness = await renderColors()
    type('Background Color', CTA)
    // Not stored: the form template only schedules its commit while the
    // form is valid, so the value never reaches sx.
    expect(harness.sx['backgroundColor']).toBeUndefined()
    // And it SAYS so, which is the whole point — the shipped behaviour was
    // a value that disappeared with no error anywhere.
    const message = screen.getByText(/not a color/i)
    // The message points at the field that CAN hold a gradient.
    expect(message.textContent).toContain('Background Fill')
    expect(message.className).toContain('Mui-error')
  })

  it('still stores a solid colour exactly as before', async () => {
    const harness = await renderColors()
    type('Background Color', '#161C21')
    expect(harness.sx['backgroundColor']).toBe('#161C21')
    expect(screen.queryByText(/not a color/i)).toBeNull()
  })

  it('recovers once the offending value is corrected', async () => {
    // A rejected value must not wedge the group: the other fields commit
    // again the moment it is valid.
    const harness = await renderColors()
    type('Background Color', CTA)
    expect(harness.sx['backgroundColor']).toBeUndefined()
    type('Background Color', 'primary.main')
    expect(harness.sx['backgroundColor']).toBe('primary.main')
  })

  it('writes a gradient to backgroundImage through the same pipeline', async () => {
    const harness = await renderColors({ backgroundImage: CTA })
    fireEvent.change(screen.getByLabelText('Angle'), {
      target: { value: '243' },
    })
    act(() => jest.advanceTimersByTime(ATTRIBUTE_COMMIT_DEBOUNCE_MS))
    expect(harness.sx['backgroundImage']).toBe(
      'linear-gradient(243deg, #00B0FF 0%, #7A5CF0 55%, #E040FB 100%)',
    )
    // And never onto the colour key, which CSS would drop.
    expect(harness.sx['backgroundColor']).toBeUndefined()
  })

  it('round-trips a saved gradient back into the control', async () => {
    // Reload: the panel re-seeds from the stored sx, and the stop editor
    // has to open on the same angle and stops it wrote.
    await renderColors({ backgroundImage: CTA })
    expect((screen.getByLabelText('Angle') as HTMLInputElement).value).toBe(
      '242',
    )
    expect(
      (screen.getByLabelText('Stop 2 position') as HTMLInputElement).value,
    ).toBe('55')
  })
})

/**
 * Background Fill on a component INSTANCE (AGL-1338) — the same panel
 * wiring, but the sx it edits is the instance's override slice rather than
 * a node's own styles (AGL-1332), so it starts EMPTY however the component
 * is painted.
 *
 * That is what broke: the Marketing CTA's default became the brand
 * gradient, `/developers-home` needed its designed `#161C21` terminal band
 * back, and picking *Solid color* on that instance did nothing at all —
 * the control already read as Solid (empty slice), so no change event
 * fired, and the value it would have written (`''`) matched the empty
 * slice anyway and was skipped. `background-image` paints over
 * `background-color`, so the instance's stored `#161C21` never showed.
 */
describe('Background Fill on a component instance (AGL-1338)', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => {
    jest.runOnlyPendingTimers()
    jest.useRealTimers()
  })

  const instanceColors = colorsGroup({ isInstanceOverride: true })

  it('opens an unoverridden instance on Inherited, not on Solid', async () => {
    await renderColors({}, instanceColors)
    // Naming the empty state is what makes Solid a change the control can
    // report at all.
    expect(fillValue()).toBe('Inherited')
  })

  it('records Solid as an override that clears the component gradient', async () => {
    // The instance already carries the dark colour; only the fill is
    // missing, and until it lands the component's gradient paints over it.
    const harness = await renderColors(
      { backgroundColor: '#161C21' },
      instanceColors,
    )
    pickFill('Solid color')
    expect(harness.sx['backgroundImage']).toBe('none')
    expect(harness.sx['backgroundColor']).toBe('#161C21')
  })

  it('can override to a DIFFERENT gradient instead', async () => {
    const harness = await renderColors({}, instanceColors)
    pickFill('Linear gradient')
    expect(harness.sx['backgroundImage']).toMatch(/^linear-gradient\(180deg,/)
  })

  it('goes back to the component fill on Inherited', async () => {
    const harness = await renderColors(
      { backgroundImage: 'none' },
      instanceColors,
    )
    expect(fillValue()).toBe('Solid color')
    pickFill('Inherited')
    // No key at all — which is exactly how "this instance does not
    // override the fill" is stored, so the graft leaves the component's
    // gradient alone.
    expect(harness.sx).not.toHaveProperty('backgroundImage')
  })
})
