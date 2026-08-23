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
  Leaf,
  LeafSxTransformContext,
  SX_SCHEME_DARK_KEY,
} from '@aglyn/aglyn-node-renderer'
import { createTheme, ThemeProvider } from '@aglyn/shared-ui-theme'
import { render } from '@testing-library/react'

import { resolveSxForDeviceWidth } from '../utils/device-preview-styles'
import {
  applyStylePartialToSx,
  computeEffectiveStyleValues,
} from '../utils/style-field-groups'
import {
  customCssDeclarations,
  applyCustomCssEdits,
} from './custom-css-form.component'
import {
  deriveStateSlice,
  hoistStateSx,
  readStateSlice,
  stripStateSlices,
  stateAdvisory,
  stateScopedSx,
  sxHasStateSlice,
  sxStateSliceLabel,
  sxStatesWithSlices,
  SX_STATE_LABELS,
  SX_STATE_SELECTORS,
  SX_STATES,
  writeStateSlice,
} from '../utils/state-sx'
import ElementLeafComponent from './node-leaf'

/**
 * Emotion inserts rules via insertRule (speedy), so they exist only in the
 * CSSOM — reading `container.innerHTML` would go green against a build that
 * emits no styles at all.
 */
const emotionCssFor = (element: HTMLElement): string => {
  const classes = Array.from(element.classList)
  return Array.from(document.styleSheets)
    .flatMap((sheet) => {
      try {
        return Array.from(sheet.cssRules)
      } catch {
        return []
      }
    })
    .map((rule) => rule.cssText)
    .filter((text) => classes.some((name) => text.includes(name)))
    .join('\n')
    .replace(/\s/g, '')
}

const leafFor = (id: string): HTMLElement =>
  document.querySelector(`[data-aglyn="leaf:${id}"]`) as HTMLElement

const nodeWith = (id: string, sx: Record<string, any>) => ({
  $id: id,
  type: 'node',
  componentId: 'unregistered-box',
  props: {},
  sx,
  nodes: [],
})

describe('interaction-state slices (AGL-2486 item 39)', () => {
  describe('the flat case is untouched', () => {
    const flat = { color: '#111111', padding: 8 }

    it('returns the record BY IDENTITY at base scope', () => {
      expect(stateScopedSx(flat, null)).toBe(flat)
      expect(hoistStateSx(flat, null)).toBe(flat)
    })

    it('returns the record BY IDENTITY when it has no slice for the state', () => {
      expect(stateScopedSx(flat, 'hover')).toBe(flat)
      expect(hoistStateSx(flat, 'hover')).toBe(flat)
    })

    it('serialises byte-identically to today', () => {
      const before = JSON.stringify(flat)
      stateScopedSx(flat, 'hover')
      hoistStateSx(flat, 'active')
      readStateSlice(flat, 'disabled')
      expect(JSON.stringify(flat)).toBe(before)
      expect(sxStatesWithSlices(flat)).toEqual([])
    })
  })

  describe('reading a state scope', () => {
    const sx = {
      color: '#111111',
      width: '320px',
      '&:hover': { color: '#0000ff' },
      '&:active': { color: '#00ff00' },
    }

    it('merges the slice over the base — what the browser actually paints', () => {
      expect(stateScopedSx(sx, 'hover')).toEqual({
        color: '#0000ff',
        width: '320px',
      })
    })

    it('does not leak a SIBLING state into the reading', () => {
      const scoped = stateScopedSx(sx, 'hover') as Record<string, any>
      expect(scoped['&:active']).toBeUndefined()
      expect(scoped['&:hover']).toBeUndefined()
    })

    it('reports which states carry slices, in chip order', () => {
      expect(sxStatesWithSlices(sx)).toEqual(['hover', 'active'])
      expect(sxHasStateSlice(sx, 'focusVisible')).toBe(false)
    })
  })

  describe('clearing a slice', () => {
    it('REMOVES the key rather than leaving an empty object', () => {
      const sx = { color: '#111111', '&:hover': { color: '#0000ff' } }
      const next = writeStateSlice(sx, 'hover', {})
      expect('&:hover' in next).toBe(false)
      expect(next).toEqual({ color: '#111111' })
    })

    it('removes the key when the slice goes undefined', () => {
      const sx = { color: '#111111', '&:hover': { color: '#0000ff' } }
      expect(writeStateSlice(sx, 'hover', undefined)).toEqual({
        color: '#111111',
      })
    })

    it('never mutates the input', () => {
      const sx = { '&:hover': { color: '#0000ff' } }
      writeStateSlice(sx, 'hover', {})
      expect(sx['&:hover']).toEqual({ color: '#0000ff' })
    })
  })

  describe('splitting an edit back into a slice', () => {
    const base = { color: '#111111', width: '320px' }

    it('keeps only what differs from the base', () => {
      expect(
        deriveStateSlice(base, { color: '#0000ff', width: '320px' }),
      ).toEqual({ color: '#0000ff' })
    })

    it('DROPS a property set back to the base value', () => {
      // A `:hover` block restating the base paints nothing and would show as
      // a permanent override in the chip's dot.
      expect(deriveStateSlice(base, { color: '#111111', width: '320px' })).toEqual(
        {},
      )
    })

    it('DROPS a cleared property so the state inherits the base', () => {
      // CSS has no way to un-declare inside a pseudo-class block, so falling
      // back to the base is the only thing the slice can express.
      expect(deriveStateSlice(base, { width: '320px' })).toEqual({})
    })

    it('never copies a sibling state block into the slice', () => {
      expect(
        deriveStateSlice(base, {
          color: '#0000ff',
          '&:active': { color: '#00ff00' },
        } as any),
      ).toEqual({ color: '#0000ff' })
    })

    it('strips state selectors from the baseline, by identity when there are none', () => {
      expect(stripStateSlices(base)).toBe(base)
      expect(
        stripStateSlices({ ...base, '&:hover': { color: '#0000ff' } }),
      ).toEqual(base)
    })

    it('round-trips an edit through the scope and back to the same slice', () => {
      const sx = { ...base, '&:hover': { color: '#0000ff' } }
      const scoped = stateScopedSx(sx, 'hover')
      const slice = deriveStateSlice(stripStateSlices(sx), scoped)
      expect(writeStateSlice(sx, 'hover', slice)).toEqual(sx)
    })
  })

  describe('plain :focus is not offered', () => {
    it('offers focus-visible and NOT :focus', () => {
      const selectors = Object.values(SX_STATE_SELECTORS)
      expect(selectors).toContain('&:focus-visible')
      // Array containment, so this is an exact-element check — '&:focus' is a
      // SUBSTRING of '&:focus-visible' and a text search would pass either way.
      expect(selectors).not.toContain('&:focus')
      expect(SX_STATES).toEqual(['hover', 'active', 'focusVisible', 'disabled'])
    })

    it('WRITES &:focus-visible into node.sx — the label is not the contract', () => {
      // The chip says "Focus (keyboard)"; what matters is the key that lands
      // in the document, because that is what the browser matches on.
      const written = writeStateSlice({ color: '#111111' }, 'focusVisible', {
        outlineColor: '#0000ff',
      })
      expect(Object.keys(written)).toEqual(['color', '&:focus-visible'])
      expect(written['&:focus']).toBeUndefined()
      expect(written['&:focus-visible']).toEqual({ outlineColor: '#0000ff' })
    })

    it('renders as :focus-visible and never as bare :focus', () => {
      render(
        <ThemeProvider theme={createTheme({})}>
          <Leaf
            node={
              nodeWith('focus-visible-node', {
                '&:focus-visible': { outlineColor: '#0000ff' },
              }) as any
            }
          />
        </ThemeProvider>,
      )
      const css = emotionCssFor(leafFor('focus-visible-node'))
      expect(css).toContain(':focus-visible')
      // A bare `:focus` rule would mean the ring is being restyled for mouse
      // users too, which is the outcome the whole state list is shaped to
      // avoid. Matches `:focus` NOT followed by `-visible`.
      expect(css).not.toMatch(/:focus(?!-visible)/)
    })

    it('says "keyboard" on the chip so nobody reads it as mouse focus', () => {
      expect(SX_STATE_LABELS.focusVisible).toMatch(/keyboard/i)
    })
  })

  describe('Default is the flat sx, not a slice', () => {
    const flat = { color: '#111111', paddingTop: 8 }

    it('a base-scope edit introduces NO state key', () => {
      const next = applyStylePartialToSx(flat, { color: '#222222' }, null, null)
      expect(Object.keys(next).some((key) => key.startsWith('&:'))).toBe(false)
      expect(next).toEqual({ color: '#222222', paddingTop: 8 })
    })

    it('round-trips byte-identically through the state helpers', () => {
      // The non-negotiable: an element with no state styles must serialise
      // exactly as it did before this feature existed.
      const before = JSON.stringify(flat)
      const scoped = stateScopedSx(flat, null) as Record<string, any>
      expect(scoped).toBe(flat)
      const roundTripped = applyStylePartialToSx(
        scoped,
        { color: '#111111' },
        null,
        null,
      )
      expect(JSON.stringify(roundTripped)).toBe(before)
      expect(JSON.stringify(flat)).toBe(before)
    })

    it('reads and renders identically with the panel at Default', () => {
      expect(computeEffectiveStyleValues(flat, null, null)).toEqual(flat)
      expect(hoistStateSx(flat, null)).toBe(flat)
    })

    // The flat cases above cannot catch a base scope that quietly started
    // merging, because there is no slice to merge — these use an element that
    // HAS one, which is where "Default is not a slice" can actually break.
    describe('on an element that already has state styles', () => {
      const withHover = {
        color: '#111111',
        '&:hover': { color: '#0000ff' },
      }

      it('Default reads the BASE value, not the hover one', () => {
        expect(stateScopedSx(withHover, null)).toBe(withHover)
        expect(
          computeEffectiveStyleValues(
            stateScopedSx(withHover, null) as Record<string, any>,
            null,
            null,
          ),
        ).toEqual({ color: '#111111' })
      })

      it('a Default edit leaves the hover slice byte-identical', () => {
        const sliceBefore = JSON.stringify(withHover['&:hover'])
        const next = applyStylePartialToSx(
          stateScopedSx(withHover, null) as Record<string, any>,
          { color: '#222222' },
          null,
          null,
        )
        expect(next['color']).toBe('#222222')
        expect(JSON.stringify(next['&:hover'])).toBe(sliceBefore)
      })
    })
  })

  describe('the panel surfaces that skip objects (the SILENT failures)', () => {
    const sx = { color: '#111111', '&:hover': { color: '#0000ff' } }

    it('does not bleed a state value into the BASE scope reading', () => {
      // computeEffectiveStyleValues drops object values, so the raw slice is
      // skipped rather than shown — which is right at base scope, and is why
      // the panel must pass a state-SCOPED record to read the slice at all.
      expect(computeEffectiveStyleValues(sx, null, null)).toEqual({
        color: '#111111',
      })
    })

    it('reads the slice once the record is state-scoped', () => {
      expect(
        computeEffectiveStyleValues(
          stateScopedSx(sx, 'hover') as Record<string, any>,
          null,
          null,
        ),
      ).toEqual({ color: '#0000ff' })
    })

    it('the Custom CSS builder lists no selector row for a state slice', () => {
      expect(customCssDeclarations(sx, null)).toEqual([
        { property: 'color', value: '#111111' },
      ])
    })

    it('applying the Custom CSS tab does NOT drop the state slice', () => {
      // The list skips the slice, so the clear half of the edit map cannot
      // name it — a merge, not a replace. This is the data-loss check.
      const next = applyCustomCssEdits(sx, { color: '#222222' }, null)
      expect(next['&:hover']).toEqual({ color: '#0000ff' })
      expect(next['color']).toBe('#222222')
    })

    it('names a state slice in the override chips instead of printing the selector', () => {
      expect(sxStateSliceLabel('&:hover')).toBe('hover state')
      expect(sxStateSliceLabel('&:focus-visible')).toBe('keyboard focus state')
      expect(sxStateSliceLabel('color')).toBeNull()
    })
  })

  describe('where a state will never fire, it says so', () => {
    it('warns for focus on an element with no tab stop', () => {
      expect(stateAdvisory('focusVisible', { componentId: 'box' })).toMatch(
        /keyboard focus/,
      )
    })

    it('stays quiet for focus on a link or a button', () => {
      expect(stateAdvisory('focusVisible', { componentId: 'mui-button' })).toBeNull()
      expect(stateAdvisory('focusVisible', { componentId: 'box', hasHref: true })).toBeNull()
    })

    it('warns for disabled on a non-control', () => {
      expect(stateAdvisory('disabled', { componentId: 'section' })).toMatch(
        /form controls/,
      )
    })

    it('never blocks hover or active — states are not constrained by element', () => {
      expect(stateAdvisory('hover', { componentId: 'section' })).toBeNull()
      expect(stateAdvisory('active', { componentId: 'section' })).toBeNull()
    })
  })

  describe('rendering — the SAME Leaf the tenant, Preview and canvas mount', () => {
    it('emits a real :hover rule on the published path, with NO renderer change', () => {
      render(
        <ThemeProvider theme={createTheme({})}>
          <Leaf
            node={
              nodeWith('published-hover', {
                color: '#111111',
                '&:hover': { backgroundColor: '#0000ff' },
              }) as any
            }
          />
        </ThemeProvider>,
      )
      const css = emotionCssFor(leafFor('published-hover'))
      // The state slice reaches CSS as a real pseudo-class rule — this is
      // the whole reason the stored value is the selector itself.
      expect(css).toContain(':hover')
      expect(css).toContain('background-color:#0000ff')
      expect(css).toContain('color:#111111')
    })

    it('resolves palette tokens and system aliases INSIDE a state slice', () => {
      const theme = createTheme({})
      render(
        <ThemeProvider theme={theme}>
          <Leaf
            node={
              nodeWith('token-hover', {
                '&:hover': { bgcolor: 'background.paper' },
              }) as any
            }
          />
        </ThemeProvider>,
      )
      const css = emotionCssFor(leafFor('token-hover'))
      // `bgcolor` is a system-prop alias and `background.paper` a palette
      // path: both only resolve because styleFunctionSx recurses into the
      // slice rather than passing it through verbatim.
      expect(css).toContain(
        `background-color:${theme.palette.background.paper}`.toLowerCase(),
      )
      expect(css).not.toContain('bgcolor')
    })

    it('composes a state slice with a responsive object', () => {
      render(
        <ThemeProvider theme={createTheme({})}>
          <Leaf
            node={
              nodeWith('responsive-hover', {
                '&:hover': { color: { xs: '#111111', md: '#222222' } },
              }) as any
            }
          />
        </ThemeProvider>,
      )
      const css = emotionCssFor(leafFor('responsive-hover'))
      expect(css).toContain(':hover')
      expect(css).toContain('color:#111111')
      expect(css).toContain('color:#222222')
      expect(css).toContain('@media')
    })

    it('resolves a scheme slice nested INSIDE a state slice (state outer)', () => {
      render(
        <ThemeProvider theme={createTheme({ palette: { mode: 'dark' } })}>
          <Leaf
            node={
              nodeWith('dark-hover', {
                '&:hover': {
                  color: '#111111',
                  [SX_SCHEME_DARK_KEY]: { color: '#eeeeee' },
                },
              }) as any
            }
          />
        </ThemeProvider>,
      )
      const css = emotionCssFor(leafFor('dark-hover'))
      expect(css).toContain('color:#eeeeee')
      expect(css).not.toContain('color:#111111')
      expect(css).not.toContain('@scheme')
    })
  })

  describe('holding a state on the canvas', () => {
    it('hoists the slice over the base and removes the selector', () => {
      expect(
        hoistStateSx(
          { color: '#111111', width: '10px', '&:hover': { color: '#0000ff' } },
          'hover',
        ),
      ).toEqual({ color: '#0000ff', width: '10px' })
    })

    it('leaves SIBLING state slices untouched', () => {
      const held = hoistStateSx(
        { '&:hover': { color: '#0000ff' }, '&:active': { color: '#00ff00' } },
        'hover',
      ) as Record<string, any>
      expect(held['&:active']).toEqual({ color: '#00ff00' })
    })

    it('resolves per entry of MUI array-composed sx', () => {
      expect(
        hoistStateSx([{ color: '#111111', '&:hover': { color: '#0000ff' } }, false], 'hover'),
      ).toEqual([{ color: '#0000ff' }, false])
    })

    it('renders the held state as base declarations on the canvas leaf', () => {
      render(
        <ThemeProvider theme={createTheme({})}>
          <LeafSxTransformContext.Provider value={(sx) => hoistStateSx(sx, 'hover')}>
            <ElementLeafComponent
              node={
                nodeWith('held-hover', {
                  color: '#111111',
                  '&:hover': { color: '#0000ff' },
                }) as any
              }
            />
          </LeafSxTransformContext.Provider>
        </ThemeProvider>,
      )
      const css = emotionCssFor(leafFor('held-hover'))
      // The hover colour paints WITHOUT the pointer being over the element,
      // which is the whole point — you cannot hover from a side panel.
      expect(css).toContain('color:#0000ff')
      // Asserted as "not behind a :hover selector" rather than ":hover is
      // absent": the canvas NodeLeaf adds its own `cursor` rule targeting
      // `:hover`/`:focus` as selection chrome, which is unrelated to the
      // author's slice and must not make this test pass or fail.
      expect(css).not.toMatch(/:hover[^{]*\{[^}]*color:#0000ff/)
      expect(css).toMatch(/\.css-[a-z0-9]+\{[^}]*color:#0000ff/)
    })

    it('composes with the artboard device-width pinning', () => {
      render(
        <ThemeProvider theme={createTheme({})}>
          <LeafSxTransformContext.Provider
            value={(sx) => resolveSxForDeviceWidth(hoistStateSx(sx, 'hover'), 390)}
          >
            <ElementLeafComponent
              node={
                nodeWith('held-pinned', {
                  color: '#111111',
                  '&:hover': {
                    color: '#0000ff',
                    '@media (max-width:599.95px)': { display: 'none' },
                  },
                }) as any
              }
            />
          </LeafSxTransformContext.Provider>
        </ThemeProvider>,
      )
      const css = emotionCssFor(leafFor('held-pinned'))
      expect(css).toContain('color:#0000ff')
      // Hoisted FIRST, so the width transform sees the media key at the top
      // level and statically resolves it for the 390px artboard.
      expect(css).toContain('display:none')
    })

    it('is a no-op with no held state — the tenant never mounts the provider', () => {
      render(
        <ThemeProvider theme={createTheme({})}>
          <Leaf
            node={
              nodeWith('unheld', {
                color: '#111111',
                '&:hover': { color: '#0000ff' },
              }) as any
            }
          />
        </ThemeProvider>,
      )
      const css = emotionCssFor(leafFor('unheld'))
      expect(css).toContain(':hover')
      expect(css).toContain('color:#111111')
    })
  })
})
