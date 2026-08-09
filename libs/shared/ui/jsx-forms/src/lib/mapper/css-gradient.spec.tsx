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
  buildCssGradient,
  describeCssColorProblem,
  isCssGradientValue,
  paletteTokenToCssVar,
  parseCssGradient,
  parsePaletteTokenCssVar,
} from '@aglyn/shared-data-enums'
import { fireEvent, render, screen } from '@testing-library/react'

import { FormRenderer, useFormApi } from '../vendor/data-driven-forms'
import CssGradientField, {
  seedGradientDraft,
  serializeGradientDraft,
} from './css-gradient'

/** The marketing CTA default this issue exists to make authorable. */
const CTA = 'linear-gradient(242deg, #00B0FF 0%, #7A5CF0 55%, #E040FB 100%)'
/** The slim-band recipe (about/demo/solutions/use-cases/blog/press). */
const SLIM = 'linear-gradient(243deg, #00B0FF 0%, #E040FB 100%)'

describe('parseCssGradient / buildCssGradient (AGL-1331)', () => {
  it('splits the CTA gradient into an angle and three stops', () => {
    expect(parseCssGradient(CTA)).toEqual({
      type: 'linear',
      angle: 242,
      stops: [
        { color: '#00B0FF', position: 0 },
        { color: '#7A5CF0', position: 55 },
        { color: '#E040FB', position: 100 },
      ],
    })
  })

  it.each([CTA, SLIM, 'radial-gradient(#000 0%, #fff 100%)'])(
    'round-trips %s untouched',
    (value) => {
      expect(buildCssGradient(parseCssGradient(value))).toBe(value)
    },
  )

  it('keeps a token stop whole — its var() carries a comma', () => {
    // The naive split is on every comma, which would cut
    // `var(--mui-palette-primary-main, #00B0FF)` in half and turn a
    // three-stop gradient into five nonsense ones.
    const tokenised =
      'linear-gradient(242deg, var(--mui-palette-primary-main, #00B0FF) 0%, ' +
      '#7A5CF0 55%, var(--mui-palette-secondary-main, #E040FB) 100%)'
    const parsed = parseCssGradient(tokenised)
    expect(parsed?.stops).toHaveLength(3)
    expect(parsed?.stops[0].color).toBe(
      'var(--mui-palette-primary-main, #00B0FF)',
    )
    expect(parsed?.stops[1].color).toBe('#7A5CF0')
    expect(buildCssGradient(parsed)).toBe(tokenised)
  })

  it('keeps an rgba() stop whole too', () => {
    const value = 'linear-gradient(90deg, rgba(0, 0, 0, 0.5) 0%, #fff 100%)'
    expect(parseCssGradient(value)?.stops).toEqual([
      { color: 'rgba(0, 0, 0, 0.5)', position: 0 },
      { color: '#fff', position: 100 },
    ])
    expect(buildCssGradient(parseCssGradient(value))).toBe(value)
  })

  it.each([
    'conic-gradient(#000, #fff)',
    'repeating-linear-gradient(45deg, #000 0 10px)',
    'linear-gradient(to bottom right, #000, #fff)',
    'linear-gradient(90deg, red 0% 40%, blue 100%)',
  ])('passes %s through as raw rather than mangling it', (value) => {
    const parsed = parseCssGradient(value)
    expect(parsed?.raw).toBe(value)
    expect(buildCssGradient(parsed)).toBe(value)
  })

  it('is not a gradient at all when there is no gradient function', () => {
    expect(parseCssGradient('url(/hero.png)')).toBeUndefined()
    expect(parseCssGradient('')).toBeUndefined()
    expect(parseCssGradient(undefined)).toBeUndefined()
    expect(isCssGradientValue('url(/hero.png)')).toBe(false)
    expect(isCssGradientValue(CTA)).toBe(true)
  })

  it('will not serialize a half-written gradient', () => {
    // One stop is not a ramp; emitting `linear-gradient(#000)` would be a
    // declaration the CSS parser drops — the bug this issue is about.
    expect(
      buildCssGradient({ type: 'linear', stops: [{ color: '#000' }] }),
    ).toBe('')
    expect(buildCssGradient({ type: 'linear', stops: [] })).toBe('')
    expect(buildCssGradient(undefined)).toBe('')
  })

  it('omits the angle when there is none, rather than inventing one', () => {
    expect(
      buildCssGradient({
        type: 'linear',
        stops: [{ color: '#000' }, { color: '#fff' }],
      }),
    ).toBe('linear-gradient(#000, #fff)')
  })
})

/**
 * Stacked layers (AGL-1336). `background-image` is a comma-separated LAYER
 * LIST; this model holds one layer. Before the layer split, a tint over a
 * photo parsed as a SINGLE two-stop gradient whose second stop carried the
 * rest of the string — and because `buildCssGradient` re-joined the same
 * pieces it round-tripped byte-identical, so the value looked fine right up
 * until the author's first stop edit silently deleted the `url()` layer.
 */
describe('stacked background layers (AGL-1336)', () => {
  /** A tint over a photo — the shape the docs pass caught. */
  const STACKED = `${SLIM}, url(/hero.jpg)`

  it.each([
    STACKED,
    'url(/hero.jpg), linear-gradient(#000 0%, #fff 100%)',
    `${CTA}, ${SLIM}`,
    'linear-gradient(#000, #fff), linear-gradient(#fff, #000), url(/a.png)',
  ])('refuses the stop editor for %s and holds it raw', (value) => {
    const parsed = parseCssGradient(value)
    expect(parsed?.raw).toBe(value)
    // No modelled stops at all: a partial model is what let the later
    // layers be dropped by a re-serialize.
    expect(parsed?.stops).toEqual([])
    expect(buildCssGradient(parsed)).toBe(value)
  })

  it('refuses a single layer whose gradient is only part of it', () => {
    // One layer (no top-level comma) but the trailing `)` closes `url(`,
    // not the gradient — the greedy pattern captured `#000, #fff) url(/x`.
    const value = 'linear-gradient(#000, #fff) url(/x.png)'
    const parsed = parseCssGradient(value)
    expect(parsed?.raw).toBe(value)
    expect(parsed?.stops).toEqual([])
  })

  it('refuses an unbalanced value rather than guessing at it', () => {
    const value = 'linear-gradient(#000, #fff))'
    expect(parseCssGradient(value)?.raw).toBe(value)
  })

  it('still parses a lone gradient normally', () => {
    // The layer split must not cost the ordinary case: the CTA's stops each
    // hold commas of their own inside `var()`/`rgba()`.
    expect(parseCssGradient(CTA)?.raw).toBeUndefined()
    expect(parseCssGradient(CTA)?.stops).toHaveLength(3)
    expect(
      parseCssGradient('radial-gradient(rgba(0, 0, 0, .5) 0%, #fff 100%)')
        ?.stops,
    ).toHaveLength(2)
  })

  it('seeds the raw box, so no stop control exists to drop a layer', () => {
    expect(seedGradientDraft(STACKED)).toEqual({
      fill: 'linear',
      angle: '',
      stops: [],
      raw: STACKED,
    })
    expect(serializeGradientDraft(seedGradientDraft(STACKED))).toBe(STACKED)
  })

  it('survives load and save byte-identical, with the layers named', () => {
    const onSubmit = renderField(STACKED)
    expect(
      (screen.getByLabelText('Background image CSS') as HTMLInputElement).value,
    ).toBe(STACKED)
    // The structured controls the old parse offered — and drops layers
    // through — are simply not on screen.
    expect(screen.queryByLabelText('Angle')).toBeNull()
    expect(screen.queryByLabelText('Stop 1 color')).toBeNull()
    expect(screen.getByText(/stacked layers/i)).toBeTruthy()
    expect(persisted(onSubmit).backgroundImage).toBe(STACKED)
  })
})

describe('palette token references (AGL-1331)', () => {
  it('maps a token path to MUI’s own custom-property name', () => {
    expect(paletteTokenToCssVar('primary.main', '#00B0FF')).toBe(
      'var(--mui-palette-primary-main, #00B0FF)',
    )
    expect(paletteTokenToCssVar('divider')).toBe('var(--mui-palette-divider)')
  })

  it.each(['primary.main', 'grey.300', 'common.white', 'divider'])(
    'round-trips %s',
    (path) => {
      expect(parsePaletteTokenCssVar(paletteTokenToCssVar(path, '#fff'))).toEqual(
        { path, fallback: '#fff' },
      )
    },
  )

  it('is undefined for a literal or a non-palette variable', () => {
    expect(parsePaletteTokenCssVar('#7A5CF0')).toBeUndefined()
    expect(parsePaletteTokenCssVar('var(--aglyn-ink, #000)')).toBeUndefined()
    expect(parsePaletteTokenCssVar('')).toBeUndefined()
  })
})

/**
 * The silent-accept bug (AGL-1331). Background Color accepted a gradient,
 * stored it as `background-color: linear-gradient(…)`, and the CSS parser
 * dropped the declaration — transparent element, no error anywhere. The
 * panel's colour fields now run this guard, and the styles form only
 * commits while it is valid, so the value is refused with a message
 * instead of vanishing.
 */
describe('describeCssColorProblem (AGL-1331)', () => {
  it('names the field that CAN hold a gradient', () => {
    const message = describeCssColorProblem(CTA)
    expect(message).toContain('not a color')
    expect(message).toContain('Background Fill')
  })

  it.each([
    '',
    '#161C21',
    '#fff',
    '#ffffffcc',
    'rgb(0, 176, 255)',
    'rgba(0, 0, 0, .5)',
    'hsl(200 100% 50%)',
    'transparent',
    'currentColor',
    'inherit',
    'primary.main',
    'background.paper',
    'grey.300',
    'color-mix(in srgb, #fff 50%, #000)',
    'oklch(0.7 0.1 200)',
    'light-dark(#fff, #000)',
  ])('accepts %s', (value) => {
    expect(describeCssColorProblem(value)).toBeUndefined()
  })

  it.each(['url(/hero.png)', 'not a color at all', '#nothex'])(
    'rejects %s',
    (value) => {
      expect(describeCssColorProblem(value)).toBeTruthy()
    },
  )
})

describe('gradient draft round trip (AGL-1331)', () => {
  it.each([CTA, SLIM, '', 'conic-gradient(#000, #fff)', 'url(/hero.png)'])(
    'serializes %s back to itself',
    (value) => {
      expect(serializeGradientDraft(seedGradientDraft(value))).toBe(value)
    },
  )

  it('opens an empty value on Solid — no background image', () => {
    expect(seedGradientDraft('')).toEqual({ fill: 'solid', angle: '', stops: [] })
    expect(seedGradientDraft(undefined)).toEqual({
      fill: 'solid',
      angle: '',
      stops: [],
    })
  })

  it('opens a value it cannot model in the raw box, not in Solid', () => {
    // Reading it as Solid would blank a real background on the next edit.
    expect(seedGradientDraft('url(/hero.png)')).toEqual({
      fill: 'linear',
      angle: '',
      stops: [],
      raw: 'url(/hero.png)',
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
      componentMapper={{ 'css-gradient': CssGradientField }}
      onSubmit={onSubmit}
      initialValues={
        initialValue !== undefined ? { backgroundImage: initialValue } : {}
      }
      schema={{
        fields: [
          {
            component: 'css-gradient',
            name: 'backgroundImage',
            label: 'Background Fill',
          },
        ],
      }}
    />,
  )
  return onSubmit
}

/** What the form would persist — still ONE CSS string on the node. */
const persisted = (onSubmit: jest.Mock) => {
  fireEvent.click(screen.getByText('Save'))
  return onSubmit.mock.calls[onSubmit.mock.calls.length - 1][0]
}

const pickFill = (label: string) => {
  fireEvent.mouseDown(document.querySelector('.MuiSelect-select') as Element)
  fireEvent.click(screen.getByRole('option', { name: label }))
}

describe('CssGradientField (AGL-1331)', () => {
  it('opens an existing gradient on its angle and stops', () => {
    renderField(CTA)
    expect((screen.getByLabelText('Angle') as HTMLInputElement).value).toBe('242')
    expect(
      (screen.getByLabelText('Stop 2 position') as HTMLInputElement).value,
    ).toBe('55')
    expect(screen.getByLabelText('Stop 3 color')).toBeTruthy()
  })

  it('writes one CSS string back when a stop moves', () => {
    const onSubmit = renderField(CTA)
    fireEvent.change(screen.getByLabelText('Stop 2 position'), {
      target: { value: '60' },
    })
    expect(persisted(onSubmit).backgroundImage).toBe(
      'linear-gradient(242deg, #00B0FF 0%, #7A5CF0 60%, #E040FB 100%)',
    )
  })

  it('writes one CSS string back when the angle changes', () => {
    const onSubmit = renderField(SLIM)
    fireEvent.change(screen.getByLabelText('Angle'), { target: { value: '90' } })
    expect(persisted(onSubmit).backgroundImage).toBe(
      'linear-gradient(90deg, #00B0FF 0%, #E040FB 100%)',
    )
  })

  it('starts a fresh gradient from two stops so it renders immediately', () => {
    const onSubmit = renderField('')
    expect(screen.queryByLabelText('Angle')).toBeNull()
    pickFill('Linear gradient')
    const value = persisted(onSubmit).backgroundImage as string
    expect(value.startsWith('linear-gradient(180deg,')).toBe(true)
    expect(parseCssGradient(value)?.stops).toHaveLength(2)
  })

  it('adds a stop between the last two, where the CTA mid stop sits', () => {
    const onSubmit = renderField(SLIM)
    fireEvent.click(screen.getByText('Add stop'))
    const parsed = parseCssGradient(persisted(onSubmit).backgroundImage)
    expect(parsed?.stops.map((stop) => stop.position)).toEqual([0, 50, 100])
  })

  it('will not let the author delete below two stops', () => {
    // Two ends are what makes it a gradient; below that the control would
    // serialize to '' and the background would disappear on them again.
    renderField(SLIM)
    expect(
      (screen.getByLabelText('Remove stop 1') as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('allows removing a middle stop once there are three', () => {
    const onSubmit = renderField(CTA)
    expect(
      (screen.getByLabelText('Remove stop 2') as HTMLButtonElement).disabled,
    ).toBe(false)
    fireEvent.click(screen.getByLabelText('Remove stop 2'))
    expect(persisted(onSubmit).backgroundImage).toBe(
      'linear-gradient(242deg, #00B0FF 0%, #E040FB 100%)',
    )
  })

  it('clears the background image when the fill goes back to Solid', () => {
    // Solid means "let Background Color do it" — the two fields are
    // different CSS properties and must never fight over one. The control
    // emits '', which final-form's default parse turns into undefined;
    // both clear the sx key (see style-field-groups.spec).
    const onSubmit = renderField(CTA)
    pickFill('Solid color')
    expect(persisted(onSubmit).backgroundImage).toBeUndefined()
  })

  it('shows a value it cannot model as text rather than destroying it', () => {
    const onSubmit = renderField('conic-gradient(#000, #fff)')
    expect(
      (screen.getByLabelText('Background image CSS') as HTMLInputElement).value,
    ).toBe('conic-gradient(#000, #fff)')
    expect(screen.queryByLabelText('Angle')).toBeNull()
    expect(persisted(onSubmit).backgroundImage).toBe(
      'conic-gradient(#000, #fff)',
    )
  })

  it('takes the structured controls back when the raw text becomes a plain gradient', () => {
    renderField('conic-gradient(#000, #fff)')
    fireEvent.change(screen.getByLabelText('Background image CSS'), {
      target: { value: SLIM },
    })
    expect((screen.getByLabelText('Angle') as HTMLInputElement).value).toBe('243')
  })

  it('leaves an untouched empty value empty', () => {
    const onSubmit = renderField('')
    expect(persisted(onSubmit).backgroundImage).toBe('')
  })
})
