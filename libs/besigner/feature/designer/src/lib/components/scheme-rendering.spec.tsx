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
  mergeSchemeValue,
  resolveSchemeSx,
  SX_SCHEME_DARK_KEY,
} from '@aglyn/aglyn-node-renderer'
import { createTheme, ThemeProvider } from '@aglyn/shared-ui-theme'
import { render } from '@testing-library/react'

import { resolveSxForDeviceWidth } from '../utils/device-preview-styles'
import ElementLeafComponent from './node-leaf'

/**
 * Collects the emotion-generated CSS rules scoped to the element's classes,
 * whitespace-stripped so assertions are formatting-agnostic. Emotion inserts
 * rules via insertRule (speedy), so they only exist in the CSSOM.
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

// Scheme resolution targets the mechanism that is live on real sites:
// both the tenant (HostThemeProvider) and the canvas (useAglynSiteTheme)
// SWAP a single-mode theme between schemes, so '@scheme dark' sx slices
// resolve in JS against theme.palette.mode — never via a
// prefers-color-scheme media query (which would ignore the tenant's
// cookie override and never fire on the canvas).
describe('resolveSchemeSx (AGL-588)', () => {
  const sx = {
    color: '#111',
    width: '320px',
    [SX_SCHEME_DARK_KEY]: { color: '#eee', backgroundColor: '#000' },
  }

  it('drops the dark slice in the light scheme', () => {
    expect(resolveSchemeSx(sx, 'light')).toEqual({
      color: '#111',
      width: '320px',
    })
  })

  it('merges the dark slice over the base in the dark scheme', () => {
    expect(resolveSchemeSx(sx, 'dark')).toEqual({
      color: '#eee',
      backgroundColor: '#000',
      width: '320px',
    })
  })

  it('resolves per array entry and inside nested selectors', () => {
    const nested = [
      { '&:hover': { color: '#111', [SX_SCHEME_DARK_KEY]: { color: '#eee' } } },
      false,
    ]
    expect(resolveSchemeSx(nested, 'dark')).toEqual([
      { '&:hover': { color: '#eee' } },
      false,
    ])
    expect(resolveSchemeSx(nested, 'light')).toEqual([
      { '&:hover': { color: '#111' } },
      false,
    ])
  })

  it('wraps theme callbacks so late-resolved sx still resolves', () => {
    const resolved = resolveSchemeSx(
      () => ({ color: '#111', [SX_SCHEME_DARK_KEY]: { color: '#eee' } }),
      'dark',
    ) as () => unknown
    expect(resolved()).toEqual({ color: '#eee' })
  })

  it('never mutates the input', () => {
    const input = {
      color: '#111',
      [SX_SCHEME_DARK_KEY]: { color: '#eee' },
    }
    resolveSchemeSx(input, 'dark')
    expect(input).toEqual({
      color: '#111',
      [SX_SCHEME_DARK_KEY]: { color: '#eee' },
    })
  })
})

describe('mergeSchemeValue cascade semantics (AGL-588)', () => {
  it('plain overrides replace the property at every width', () => {
    expect(mergeSchemeValue({ xs: '#111', md: '#222' }, '#eee')).toBe('#eee')
  })

  it('responsive overrides keep base slices below their first breakpoint', () => {
    expect(
      mergeSchemeValue({ xs: '#111', md: '#222' }, { md: '#eee' }),
    ).toEqual({ xs: '#111', md: '#eee' })
  })

  it('base slices above an all-width override never resurface', () => {
    // A plain dark value is written later than the base md slice, so it
    // wins everywhere — the md base value must not leak back in.
    expect(mergeSchemeValue({ md: '#222' }, '#eee')).toBe('#eee')
  })

  it('keeps a gap below both values as a gap', () => {
    expect(mergeSchemeValue({ md: '#222' }, { md: '#eee' })).toEqual({
      md: '#eee',
    })
  })
})

describe('Leaf scheme rendering (AGL-588)', () => {
  const schemeNode = (id: string) => ({
    $id: id,
    type: 'node',
    componentId: 'unregistered-box',
    props: {},
    sx: {
      color: '#111111',
      width: '320px',
      [SX_SCHEME_DARK_KEY]: { color: '#eeeeee' },
    },
    nodes: [],
  })

  const renderWithMode = (node: any, mode: 'light' | 'dark') =>
    render(
      <ThemeProvider theme={createTheme({ palette: { mode } })}>
        <Leaf node={node} />
      </ThemeProvider>,
    )

  it('emits the base color under a light theme — no dark bleed', () => {
    renderWithMode(schemeNode('light-node'), 'light')
    const leaf = document.querySelector(
      '[data-aglyn="leaf:light-node"]',
    ) as HTMLElement
    const css = emotionCssFor(leaf)
    expect(css).toContain('color:#111111')
    expect(css).not.toContain('#eeeeee')
    // The reserved key must never reach the CSSOM as a bogus at-rule.
    expect(css).not.toContain('@scheme')
  })

  it('emits the dark override under a dark theme', () => {
    renderWithMode(schemeNode('dark-node'), 'dark')
    const leaf = document.querySelector(
      '[data-aglyn="leaf:dark-node"]',
    ) as HTMLElement
    const css = emotionCssFor(leaf)
    expect(css).toContain('color:#eeeeee')
    expect(css).not.toContain('color:#111111')
    // Scheme-agnostic styles render in both schemes.
    expect(css).toContain('width:320px')
    expect(css).not.toContain('@scheme')
  })

  it('resolves palette token paths against the active theme', () => {
    // Theme color references (the picker's token stage) store palette
    // PATHS — sx resolves them per active theme, so they adapt when the
    // site swaps schemes.
    const theme = createTheme({ palette: { mode: 'dark' } })
    render(
      <ThemeProvider theme={theme}>
        <Leaf
          node={{
            $id: 'token-node',
            type: 'node',
            componentId: 'unregistered-box',
            props: {},
            sx: { backgroundColor: 'background.paper' },
            nodes: [],
          }}
        />
      </ThemeProvider>,
    )
    const leaf = document.querySelector(
      '[data-aglyn="leaf:token-node"]',
    ) as HTMLElement
    const css = emotionCssFor(leaf)
    expect(css).toContain(
      `background-color:${theme.palette.background.paper}`,
    )
  })

  it('renders scheme slices through the besigner canvas NodeLeaf in dark', () => {
    render(
      <ThemeProvider theme={createTheme({ palette: { mode: 'dark' } })}>
        <ElementLeafComponent node={schemeNode('canvas-dark-node') as any} />
      </ThemeProvider>,
    )
    const leaf = document.querySelector(
      '[data-aglyn="leaf:canvas-dark-node"]',
    ) as HTMLElement
    const css = emotionCssFor(leaf)
    expect(css).toContain('color:#eeeeee')
    expect(css).not.toContain('color:#111111')
  })

  it('composes with the artboard device-width pinning (AGL-581)', () => {
    // Dark canvas + pinned phone width: the scheme slice resolves first
    // (theme mode), then the width transform sees plain properties.
    const node = {
      $id: 'pinned-dark-node',
      type: 'node',
      componentId: 'unregistered-box',
      props: {},
      sx: {
        color: '#111111',
        '@media (max-width:599.95px)': { display: 'none' },
        [SX_SCHEME_DARK_KEY]: { color: '#eeeeee' },
      },
      nodes: [],
    }
    render(
      <ThemeProvider theme={createTheme({ palette: { mode: 'dark' } })}>
        <LeafSxTransformContext.Provider
          value={(sx) => resolveSxForDeviceWidth(sx, 390)}
        >
          <ElementLeafComponent node={node as any} />
        </LeafSxTransformContext.Provider>
      </ThemeProvider>,
    )
    const leaf = document.querySelector(
      '[data-aglyn="leaf:pinned-dark-node"]',
    ) as HTMLElement
    const css = emotionCssFor(leaf)
    expect(css).toContain('color:#eeeeee')
    expect(css).toContain('display:none')
    expect(css).not.toContain('@scheme')
  })
})
