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
 * One stored theme resolves to one height, whichever reader handed it back
 * (AGL-3146).
 *
 * `mixins.toolbar` holds three min-heights that all match a landscape desktop
 * — a base, a short-landscape rule, and the site's own `sm` height — and they
 * land in ONE CSS rule at equal specificity, so the last one emitted wins.
 * Firestore does not preserve a map's key order: the server reader and the
 * browser reader returned the same saved document in different orders, and
 * aglyn.com's nav drew 48px live while the besigner canvas drew 72px. The
 * editor and the page disagreed about a value neither of them had changed,
 * which is the whole defect — an author correcting a nav that only exists in
 * the editor ships the correction.
 *
 * The three orders below are the measured ones, from 2026-09-10 and again on
 * 2026-09-20 against the same production document.
 */

import type { HostTheme } from '@aglyn/shared-data-types'
import { hostThemeToThemeOptions, orderMediaWidths } from './host-theme'
import {
  buildToolbarMixin,
  TOOLBAR_LANDSCAPE_QUERY,
  TOOLBAR_LANDSCAPE_RULE,
  TOOLBAR_SM_QUERY,
} from './theme-editor-fields'

/** What the theme editor writes: base, short-landscape, then the sm height. */
const AS_WRITTEN = {
  minHeight: '56px',
  [TOOLBAR_LANDSCAPE_QUERY]: TOOLBAR_LANDSCAPE_RULE,
  [TOOLBAR_SM_QUERY]: { minHeight: '72px' },
}

/** What the Admin SDK hands the tenant back — landscape last, so 48px won. */
const AS_READ_ON_THE_SERVER = {
  [TOOLBAR_SM_QUERY]: { minHeight: '72px' },
  [TOOLBAR_LANDSCAPE_QUERY]: TOOLBAR_LANDSCAPE_RULE,
  minHeight: '56px',
}

/** What the browser SDK hands the console back — sm last, so 72px won. */
const AS_READ_IN_THE_CONSOLE = {
  [TOOLBAR_LANDSCAPE_QUERY]: TOOLBAR_LANDSCAPE_RULE,
  minHeight: '56px',
  [TOOLBAR_SM_QUERY]: { minHeight: '72px' },
}

const READERS = [
  ['as the editor wrote it', AS_WRITTEN],
  ['as the server read it', AS_READ_ON_THE_SERVER],
  ['as the console read it', AS_READ_IN_THE_CONSOLE],
] as const

const toolbarOf = (toolbar: Record<string, unknown>) =>
  hostThemeToThemeOptions({ mixins: { toolbar } } as HostTheme, 'light').mixins
    ?.toolbar as Record<string, unknown>

describe('a stored toolbar height resolves the same for every reader (AGL-3146)', () => {
  it.each(READERS)('%s: the sm rule wins on a wide window', (_name, toolbar) => {
    const keys = Object.keys(toolbarOf({ ...toolbar }))
    // Both queries match a landscape desktop and they carry equal
    // specificity, so the one emitted later is the height the nav gets.
    expect(keys.indexOf(TOOLBAR_LANDSCAPE_QUERY)).toBeLessThan(
      keys.indexOf(TOOLBAR_SM_QUERY),
    )
    expect(keys.indexOf(TOOLBAR_SM_QUERY)).toBe(keys.length - 1)
  })

  it('resolves all three reader orders to one order', () => {
    const [first, ...rest] = READERS.map(([, toolbar]) =>
      Object.keys(toolbarOf({ ...toolbar })),
    )
    for (const keys of rest) expect(keys).toEqual(first)
  })

  it('keeps every declaration it re-orders', () => {
    expect(toolbarOf({ ...AS_READ_IN_THE_CONSOLE })).toEqual(
      expect.objectContaining({
        minHeight: '56px',
        [TOOLBAR_LANDSCAPE_QUERY]: TOOLBAR_LANDSCAPE_RULE,
        [TOOLBAR_SM_QUERY]: { minHeight: '72px' },
      }),
    )
  })

  it('leaves what the editor writes untouched', () => {
    const written = buildToolbarMixin(56, 72)
    expect(Object.keys(toolbarOf(written))).toEqual(Object.keys(written))
  })
})

describe('orderMediaWidths', () => {
  it('sorts breakpoint rules ascending, wherever they are stored', () => {
    // A second, unrelated surface: a component override, not a nav, not a
    // mixin. Order-sensitivity is a property of stored CSS, not of the nav.
    const overrides = {
      MuiContainer: {
        styleOverrides: {
          root: {
            '@media (min-width:900px)': { paddingTop: 48 },
            paddingTop: 16,
            '@media (min-width:600px)': { paddingTop: 32 },
          },
        },
      },
    }
    const ordered = orderMediaWidths(overrides)
    expect(
      Object.keys(ordered.MuiContainer.styleOverrides.root),
    ).toEqual([
      'paddingTop',
      '@media (min-width:600px)',
      '@media (min-width:900px)',
    ])
  })

  it('leaves blocks that name no width in the order they were stored', () => {
    const styles = {
      color: 'red',
      '@supports (display: grid)': { display: 'grid' },
      '@media print': { color: 'black' },
      '&:hover': { color: 'blue' },
    }
    expect(Object.keys(orderMediaWidths(styles))).toEqual(Object.keys(styles))
  })

  it('returns its input by identity when nothing moves', () => {
    const styles = { minHeight: 56, '@media (min-width:600px)': { minHeight: 72 } }
    expect(orderMediaWidths(styles)).toBe(styles)
  })

  it('orders a nested rule without disturbing its parent', () => {
    const styles = {
      '@media (min-width:600px)': {
        '@media (min-width:1200px)': { gap: 24 },
        gap: 8,
        '@media (min-width:900px)': { gap: 16 },
      },
    }
    const ordered = orderMediaWidths(styles) as typeof styles
    expect(Object.keys(ordered['@media (min-width:600px)'])).toEqual([
      'gap',
      '@media (min-width:900px)',
      '@media (min-width:1200px)',
    ])
  })
})
