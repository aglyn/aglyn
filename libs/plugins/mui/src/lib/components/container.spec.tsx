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

import MuiContainer from '@mui/material/Container'
import { render } from '@testing-library/react'
import Container, { presets, schema } from './container'

/**
 * The rendered breakpoint, read off MUI's own utility class rather than off
 * computed style: the `max-width` rule lives inside a `@media (min-width: …)`
 * block that jsdom never evaluates, but the class is emitted by the same
 * `ownerState.maxWidth && …` branch that emits the rule, so it is the exact
 * signal under test. `null` means MUI applied NO width cap — full-bleed.
 */
const renderedMaxWidth = (ui: React.ReactElement): string | null => {
  const { container } = render(ui)
  const root = container.querySelector('.MuiContainer-root') as HTMLElement
  expect(root).not.toBeNull()
  const cls = [...root.classList].find((c) =>
    c.startsWith('MuiContainer-maxWidth'),
  )
  return cls ? cls.replace('MuiContainer-maxWidth', '') : null
}

/**
 * AGL-1435: the Max Width select offered `{ value: '', label: 'Default' }` and
 * this module exported the raw MUI Container with no `dropClearedProps`
 * wrapper — unlike `stack.ts`, `button.tsx`, `pagination.tsx` and
 * `screen-link.tsx`. `''`/`null` satisfies NEITHER branch of MUI's logic: not
 * `undefined`, so the `maxWidth = 'lg'` destructuring default never fires;
 * still falsy, so the branch that emits the cap is skipped. The option that
 * sounds like the safe choice produced a section with no width constraint at
 * all, silently.
 */
describe('Container premise — why a falsy maxWidth is the bug (AGL-1435)', () => {
  it('raw MUI caps an ABSENT maxWidth at lg, its own default', () => {
    expect(renderedMaxWidth(<MuiContainer />)).toBe('Lg')
  })

  it('raw MUI caps nothing at all for `""` — the full-bleed defect', () => {
    // This is the bug reproduced against real MUI. If this ever starts
    // returning 'Lg', MUI began coercing falsy values and the wrapper below
    // can be revisited.
    expect(renderedMaxWidth(<MuiContainer maxWidth={'' as any} />)).toBeNull()
  })

  it('raw MUI caps nothing at all for `null` either', () => {
    expect(renderedMaxWidth(<MuiContainer maxWidth={null as any} />)).toBeNull()
  })
})

describe('Container drops cleared widths before MUI sees them (AGL-1435)', () => {
  // ---- explicit widths: the authored corpus must keep rendering ----

  it.each([
    ['xs', 'Xs'],
    ['sm', 'Sm'],
    ['md', 'Md'],
    ['lg', 'Lg'],
    ['xl', 'Xl'],
  ])('passes an explicit %s straight through', (value, expected) => {
    expect(renderedMaxWidth(<Container maxWidth={value as any} />)).toBe(
      expected,
    )
  })

  // ---- the cleared value: what "Default" used to produce ----

  it('a cleared (null) width falls back to MUI lg instead of full-bleed', () => {
    expect(renderedMaxWidth(<Container maxWidth={null as any} />)).toBe('Lg')
  })

  it('an already-authored `""` width now renders capped at lg, not full-bleed', () => {
    // BEHAVIOUR CHANGE, stated deliberately: before this fix such a node
    // rendered edge-to-edge (the premise block above). No node in the corpus
    // carries `''` or `null` for maxWidth — the attributes form strips `''`
    // before save (AGL-1191), which is why the defect stayed latent — so this
    // changes nothing that is live today, and closes the path for anything
    // pasted, imported, or cleared with the field's ✕ tomorrow.
    expect(renderedMaxWidth(<Container maxWidth={'' as any} />)).toBe('Lg')
  })

  // ---- the nodes that exist today: key absent ----

  it('a node with NO maxWidth key is untouched — still MUI lg', () => {
    // 7 containers on the Demo and Test Site hosts carry no `maxWidth` key.
    // The wrapper must not start injecting one: their rendered width is
    // exactly what it was before this change.
    expect(renderedMaxWidth(<Container />)).toBe('Lg')
  })

  // ---- positive control: the guard must not shred real falsy values ----

  it('keeps `false` — "Fluid Responsive" is a real author choice', () => {
    expect(renderedMaxWidth(<Container maxWidth={false} />)).toBeNull()
  })

  it('keeps other legitimate props, cleared or not', () => {
    const { container } = render(
      <Container disableGutters fixed maxWidth="xl" id="hero" />,
    )
    const root = container.querySelector('.MuiContainer-root') as HTMLElement
    expect(root.id).toBe('hero')
    expect(root.className).toContain('MuiContainer-disableGutters')
    expect(root.className).toContain('MuiContainer-fixed')
  })

  it('renders its children', () => {
    const { getByText } = render(<Container>{'Section body'}</Container>)
    expect(getByText('Section body')).toBeTruthy()
  })
})

/**
 * The schema half of the fix. An `''` option value is unpersistable by
 * construction in the attributes form stack (AGL-1191), so an option list that
 * offers one is offering a choice that cannot survive a save — and here it was
 * also the choice that rendered full-bleed on any path that DID land it.
 */
describe('Container "Max Width" options (AGL-1435)', () => {
  const field = schema.attributes?.find((a: any) => a.name === 'maxWidth') as any

  it('exposes the Max Width attribute', () => {
    expect(field).toBeDefined()
  })

  it('never offers a value the attributes form cannot persist', () => {
    for (const option of field.options) {
      expect(option.value).not.toBe('')
      expect(option.value).not.toBeNull()
      expect(option.value).not.toBeUndefined()
    }
  })

  it('offers no "Default" option at all — every choice is an explicit width', () => {
    expect(
      field.options.map((o: any) => String(o.label).toLowerCase()),
    ).not.toContain('default')
  })

  it('documents what an unset width means, since the option is gone', () => {
    // The decision this issue asked to be made deliberately, pinned so it
    // cannot drift out of the help text: unset means MUI's lg, and the ONLY
    // uncapped choice is the explicit one.
    expect(field.description).toContain('1200px')
    expect(field.description).toContain('Fluid Responsive')
  })

  it('names XL as the section standard', () => {
    const xl = field.options.find((o: any) => o.value === 'xl')
    expect(xl.label).toContain('1536px')
  })
})

describe('Container preset (AGL-1435)', () => {
  it('starts a new container at the section standard rather than implicitly', () => {
    expect(presets[0].data.props).toEqual({ maxWidth: 'xl' })
  })

  it('and that preset actually renders at xl', () => {
    expect(
      renderedMaxWidth(<Container {...(presets[0].data.props as any)} />),
    ).toBe('Xl')
  })
})

/**
 * MUI's stock breakpoint scale. Nothing else may reach a Container's
 * `maxWidth` — that is the whole of AGL-1298. `1328` is a CONTENT width
 * (1280 plus the Container's own 24px gutters), never a breakpoint, and it
 * is the number this standard exists to keep out.
 */
const STOCK_BREAKPOINTS = ['xs', 'sm', 'md', 'lg', 'xl']

/** True for a stock breakpoint key, or the explicit full-bleed opt-out. */
const isStockWidth = (value: unknown) =>
  value === false ||
  (typeof value === 'string' && STOCK_BREAKPOINTS.includes(value))

describe('the three width cases the standard now has (AGL-1298)', () => {
  const field = schema.attributes?.find((a: any) => a.name === 'maxWidth') as any
  const prose = presets.find((p) => p.$id.endsWith('.prose'))

  it('every offered width is a STOCK breakpoint, never a bespoke number', () => {
    for (const option of field.options) {
      expect(isStockWidth(option.value)).toBe(true)
    }
  })

  it('RED on purpose: the same predicate REJECTS the values this ban targets', () => {
    // A guard that only ever sees passing input proves nothing. These are
    // the exact shapes the corpus carried before the sweep — 144 containers
    // at `1328px`, and the mega-menu Stacks still at `1392px`.
    expect(isStockWidth('1328px')).toBe(false)
    expect(isStockWidth(1328)).toBe(false)
    expect(isStockWidth('1392px')).toBe(false)
    expect(isStockWidth('')).toBe(false)
    expect(isStockWidth(null)).toBe(false)
  })

  it('SECTION: the default preset is XL — Zach confirmed it 2026-08-18', () => {
    // "XL is fine for the default page width on the marketing site, I like
    // that." The /pricing audit measured 8/8 sections on `maxWidthXl`, so
    // the earlier premise that the site was "designed with LG" was off by
    // one step and the default does NOT move.
    expect(presets[0].data.props).toEqual({ maxWidth: 'xl' })
  })

  it('PROSE: a distinct preset at MD, which actually renders at md', () => {
    expect(prose?.displayName).toBe('Prose Container')
    expect(prose?.data.props).toEqual({ maxWidth: 'md' })
    expect(renderedMaxWidth(<Container {...(prose?.data.props as any)} />)).toBe(
      'Md',
    )
  })

  it('no preset ships a hardcoded pixel width or an sx cap', () => {
    for (const preset of presets) {
      const props = preset.data.props as Record<string, unknown> | undefined
      expect(isStockWidth(props?.['maxWidth'])).toBe(true)
      expect(props?.['sx']).toBeUndefined()
    }
  })

  it('MIDDLE: LG stays available and is claimed by no preset', () => {
    // The deliberate middle case for a wide-but-text-led section. If it ever
    // becomes a preset default, that should be a decision, not a drift.
    expect(field.options.map((o: any) => o.value)).toContain('lg')
    expect(
      presets.map((preset) => (preset.data.props as any)?.maxWidth),
    ).not.toContain('lg')
  })

  it('records the measure in the help text, so nobody "corrects" MD to LG', () => {
    expect(field.description).toContain('900px')
    expect(field.description).toContain('65–75')
    // Stated honestly rather than rounded to fit the decision. Content width
    // is the breakpoint minus 24px of gutter either side; characters per
    // line estimated at the usual 0.5em average advance:
    //
    //          content   @16px   @18px
    //   sm       552      ~69     ~61
    //   md       852     ~106     ~95
    //   lg      1152     ~144    ~128
    //   xl      1488     ~186    ~165
    //
    // MD is the narrowest SECTION-scale stock width — it is not a width
    // that hits 65–75 characters on its own. The reading band is reached
    // with an inner measure inside the prose container (AGL-1307 uses 760px
    // on the article body), which is a typography decision rather than a
    // container width. LG at ~128–144 characters is not a prose width by
    // any reading of it, which is why the ruling is MD and not "one step
    // down from XL".
    expect(900 - 48).toBeLessThan(1200 - 48)
  })
})
