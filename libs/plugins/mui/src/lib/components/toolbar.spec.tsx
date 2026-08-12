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

import MuiToolbar from '@mui/material/Toolbar'
import { render } from '@testing-library/react'
import Toolbar, { schema } from './toolbar'

/**
 * The rendered variant, read off MUI's own utility class rather than off
 * computed style: the `min-height` comes from `theme.mixins.toolbar`, which
 * is a set of `@media` blocks jsdom never evaluates. The class is emitted by
 * the same `ownerState.variant` the height branch reads, so it is the exact
 * signal under test. `null` means MUI applied NEITHER variant — a toolbar
 * with no height of its own.
 */
const renderedVariant = (ui: React.ReactElement): string | null => {
  const { container } = render(ui)
  const root = container.querySelector('.MuiToolbar-root') as HTMLElement
  expect(root).not.toBeNull()
  const cls = [...root.classList].find(
    (c) => c === 'MuiToolbar-regular' || c === 'MuiToolbar-dense',
  )
  return cls ? cls.replace('MuiToolbar-', '') : null
}

/**
 * AGL-1451: the Variant select opened with `{ value: '', label: 'Default' }`
 * and this module exported the raw MUI Toolbar with no `dropClearedProps`
 * wrapper. It was the one component in that set where the empty value
 * reached MUI untouched, so it carried the AGL-1435 defect exactly.
 */
describe('Toolbar premise — why a falsy variant is the bug (AGL-1451)', () => {
  it('raw MUI gives an ABSENT variant its own `regular` height', () => {
    expect(renderedVariant(<MuiToolbar />)).toBe('regular')
  })

  it('raw MUI gives `""` neither variant — the heightless defect', () => {
    // The bug reproduced against real MUI. If this ever returns 'regular',
    // MUI began coercing falsy values and the guard can be revisited.
    expect(renderedVariant(<MuiToolbar variant={'' as any} />)).toBeNull()
  })

  it('raw MUI gives `null` neither variant either', () => {
    expect(renderedVariant(<MuiToolbar variant={null as any} />)).toBeNull()
  })
})

describe('Toolbar drops cleared props before MUI sees them (AGL-1451)', () => {
  it('a cleared (null) variant falls back to MUI regular', () => {
    expect(renderedVariant(<Toolbar variant={null as any} />)).toBe('regular')
  })

  it('an already-authored `""` variant renders regular too', () => {
    // BEHAVIOUR CHANGE, stated deliberately: before this fix such a node
    // rendered with no toolbar height at all. No node in the corpus carries
    // `''` or `null` here — the attributes form strips `''` before save
    // (AGL-1191), which is why the defect stayed latent — so nothing live
    // changes, and the path is closed for anything pasted, imported, or
    // cleared with the field's ✕.
    expect(renderedVariant(<Toolbar variant={'' as any} />)).toBe('regular')
  })

  it('a node with NO variant key is untouched — still MUI regular', () => {
    expect(renderedVariant(<Toolbar />)).toBe('regular')
  })

  it.each([
    ['dense', 'dense'],
    ['regular', 'regular'],
  ])('passes an explicit %s straight through', (value, expected) => {
    expect(renderedVariant(<Toolbar variant={value as any} />)).toBe(expected)
  })

  // ---- positive controls: the guard must not shred real values ----

  it('keeps `disableGutters` when it is really set', () => {
    const { container } = render(<Toolbar disableGutters />)
    const root = container.querySelector('.MuiToolbar-root') as HTMLElement
    expect(root.className).not.toMatch(/MuiToolbar-gutters/)
  })

  it('keeps `disableGutters={false}` — a real falsy author choice', () => {
    const { container } = render(<Toolbar disableGutters={false} />)
    const root = container.querySelector('.MuiToolbar-root') as HTMLElement
    expect(root.className).toMatch(/MuiToolbar-gutters/)
  })

  it('renders its children', () => {
    const { getByText } = render(<Toolbar>{'Brand'}</Toolbar>)
    expect(getByText('Brand')).toBeTruthy()
  })
})

describe('Toolbar "Variant" options (AGL-1451)', () => {
  const field = (schema.attributes ?? []).find(
    (a: any) => a.name === 'variant',
  ) as any

  it('never offers a value the attributes form cannot persist', () => {
    for (const option of field.options) {
      expect(option.value).not.toBe('')
      expect(option.value).not.toBeNull()
      expect(option.value).not.toBeUndefined()
    }
  })

  it('offers no "Default" option — MUI has exactly two toolbar heights', () => {
    // Deleted rather than given a sentinel, unlike Paper and Card: `regular`
    // IS the default, so "Default" was a second name for an option already
    // in the list.
    expect(field.options.map((o: any) => o.value)).toEqual([
      'dense',
      'regular',
    ])
    expect(
      field.options.map((o: any) => String(o.label).toLowerCase()),
    ).not.toContain('default')
  })

  it('says what an unset variant means, since the option is gone', () => {
    expect(field.description).toContain('Regular')
  })
})
