/**
 * @license
 * Copyright 2023 Aglyn LLC
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

import { Leaf, LeafSxTransformContext } from '@aglyn/aglyn-node-renderer'
import * as Besigner from '@aglyn/besigner'
import { createTheme, ThemeProvider } from '@aglyn/shared-ui-theme'
import { act, render } from '@testing-library/react'

import {
  createDevicePinnedTheme,
  resolveSxForDeviceWidth,
} from '../utils/device-preview-styles'
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

describe('NodeLeaf', () => {
  it('should render successfully', () => {
    const node = {
      $id: 'test-node',
      type: 'node',
      componentId: 'div',
      props: {},
      sx: {},
      nodes: [],
    }
    const { baseElement } = render(<ElementLeafComponent node={node} />)
    expect(baseElement).toBeTruthy()
  })
})

describe('canvas selection stamping (AGL-571)', () => {
  afterEach(() => {
    act(() => Besigner.focus.clearFocusStatus())
  })

  const menuNode = () =>
    ({
      $id: 'menu-node',
      type: 'node',
      componentId: 'unregistered-menu',
      props: {},
      nodes: ['child-node'],
    }) as any

  const leaf = () =>
    document.querySelector('[data-aglyn="leaf:menu-node"]') as HTMLElement

  it('omits data-aglyn-selected-within while selection is elsewhere', () => {
    render(<ElementLeafComponent node={menuNode()} />)
    expect(leaf().hasAttribute('data-aglyn-selected-within')).toBe(false)
  })

  it('stamps data-aglyn-selected-within when the node itself is selected', () => {
    const node = menuNode()
    act(() => Besigner.focus.setSelectedNode(node))
    render(<ElementLeafComponent node={node} />)
    expect(leaf().hasAttribute('data-aglyn-selected-within')).toBe(true)
  })

  it('stamps it for a selected descendant and clears it on deselect', () => {
    const node = menuNode()
    const child = {
      $id: 'child-node',
      type: 'node',
      componentId: 'unregistered-link',
      props: {},
      // Canvas breadcrumbPath shape: [root, ...ancestors, self].
      breadcrumbPath: ['node-root', 'menu-node', 'child-node'],
      nodes: [],
    } as any
    act(() => Besigner.focus.setSelectedNode(child))
    render(<ElementLeafComponent node={node} />)
    // Selection inside the subtree marks the ancestor leaf …
    expect(leaf().hasAttribute('data-aglyn-selected-within')).toBe(true)
    // … but never as the selected node itself.
    expect(leaf().getAttribute('data-aglyn-selected')).toBe('false')
    // Deselecting collapses the mark again (observer re-render).
    act(() => Besigner.focus.clearSelection())
    expect(leaf().hasAttribute('data-aglyn-selected-within')).toBe(false)
  })

  it('never marks an unrelated leaf', () => {
    const stranger = {
      $id: 'stranger-node',
      type: 'node',
      componentId: 'unregistered-box',
      props: {},
      breadcrumbPath: ['node-root', 'stranger-node'],
      nodes: [],
    } as any
    act(() => Besigner.focus.setSelectedNode(stranger))
    render(<ElementLeafComponent node={menuNode()} />)
    expect(leaf().hasAttribute('data-aglyn-selected-within')).toBe(false)
  })
})

describe('canvas element-picker capture (AGL-574)', () => {
  const pickable = () =>
    ({
      $id: 'pickable-node',
      type: 'node',
      componentId: 'unregistered-box',
      props: {},
      nodes: [],
    }) as any

  const leaf = () =>
    document.querySelector('[data-aglyn="leaf:pickable-node"]') as HTMLElement

  const mousedown = () =>
    act(() => {
      leaf().dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, cancelable: true }),
      )
    })

  afterEach(() => {
    Besigner.pick.cancelPick()
    act(() => Besigner.focus.clearFocusStatus())
  })

  it('routes a picking click to the picker and skips normal selection', () => {
    const onPicked = jest.fn()
    render(<ElementLeafComponent node={pickable()} />)
    act(() => Besigner.pick.startPick(onPicked))

    mousedown()

    // The picker receives the raw canvas id …
    expect(onPicked).toHaveBeenCalledWith('pickable-node', expect.any(String))
    // … the click never becomes a selection, and pick mode exits.
    expect(Besigner.focus.getSelected()).toHaveLength(0)
    expect(Besigner.pick.isPicking()).toBe(false)
  })

  it('selects normally when not picking', () => {
    render(<ElementLeafComponent node={pickable()} />)
    mousedown()
    expect(Besigner.focus.getSelected().map((selected) => selected.$id)).toEqual(
      ['pickable-node'],
    )
  })
})

describe('Leaf sx composition (AGL-569)', () => {
  it('applies node-level sx alongside props.sx on the shared Leaf', () => {
    // Repro shape from the live bug: props.sx colors the link while the
    // node-level sx carries the AGL-562 "Hide on mobile" visibility band.
    const node = {
      $id: 'nav-home',
      type: 'node',
      componentId: 'unregistered-link',
      props: { variant: 'text', sx: { color: 'inherit' } },
      sx: { '@media (max-width:599.95px)': { display: 'none' } },
      nodes: [],
    }
    render(<Leaf node={node} />)
    const leaf = document.querySelector(
      '[data-aglyn="leaf:nav-home"]',
    ) as HTMLElement
    expect(leaf).toBeTruthy()
    const css = emotionCssFor(leaf)
    // The props.sx styling survives...
    expect(css).toContain('color:inherit')
    // ...and so does the node-level visibility band media query, with the
    // display rule nested inside the media band.
    expect(css).toMatch(/@media\(max-width:599\.95px\)\{[^}]*\{display:none/)
  })

  it('lets node-level sx win over props.sx on key conflicts', () => {
    const node = {
      $id: 'conflict-node',
      type: 'node',
      componentId: 'unregistered-box',
      props: { sx: { color: 'red' } },
      sx: { color: 'blue' },
      nodes: [],
    }
    render(<Leaf node={node} />)
    const leaf = document.querySelector(
      '[data-aglyn="leaf:conflict-node"]',
    ) as HTMLElement
    const css = emotionCssFor(leaf)
    // Node-level sx (Styles panel) is authored later and must win: its
    // declaration is present and cascades after any props.sx declaration.
    expect(css).toContain('color:blue')
    expect(css.lastIndexOf('color:blue')).toBeGreaterThan(
      css.lastIndexOf('color:red'),
    )
  })

  it('merges className from props, node and caller instead of clobbering', () => {
    const node = {
      $id: 'classy-node',
      type: 'node',
      componentId: 'unregistered-box',
      props: { className: 'from-props' },
      className: 'from-node',
      nodes: [],
    }
    render(<Leaf node={node} className="from-caller" />)
    const leaf = document.querySelector(
      '[data-aglyn="leaf:classy-node"]',
    ) as HTMLElement
    expect(leaf.classList.contains('from-props')).toBe(true)
    expect(leaf.classList.contains('from-node')).toBe(true)
    expect(leaf.classList.contains('from-caller')).toBe(true)
  })

  it('applies both sx sources through the besigner canvas NodeLeaf', () => {
    const node = {
      $id: 'canvas-node',
      type: 'node',
      componentId: 'unregistered-link',
      props: { sx: { color: 'inherit' } },
      sx: { '@media (max-width:599.95px)': { display: 'none' } },
      nodes: [],
    }
    render(<ElementLeafComponent node={node} />)
    const leaf = document.querySelector(
      '[data-aglyn="leaf:canvas-node"]',
    ) as HTMLElement
    expect(leaf).toBeTruthy()
    const css = emotionCssFor(leaf)
    expect(css).toContain('color:inherit')
    expect(css).toMatch(/@media\(max-width:599\.95px\)\{[^}]*\{display:none/)
  })
})

describe('artboard device preview pinning (AGL-581)', () => {
  const bandNode = (id: string) => ({
    $id: id,
    type: 'node',
    componentId: 'unregistered-box',
    props: {},
    sx: {
      color: 'red',
      // AGL-562 visibility bands: hide on mobile, letter-space desktop.
      '@media (max-width:599.95px)': { display: 'none' },
      '@media (min-width:900px)': { letterSpacing: '3px' },
    },
    nodes: [],
  })

  const renderPinned = (node: any, width: number) =>
    render(
      <LeafSxTransformContext.Provider
        value={(sx) => resolveSxForDeviceWidth(sx, width)}
      >
        <ElementLeafComponent node={node} />
      </LeafSxTransformContext.Provider>,
    )

  it('applies the mobile band inline on a phone-width artboard', () => {
    renderPinned(bandNode('phone-node'), 390)
    const leaf = document.querySelector(
      '[data-aglyn="leaf:phone-node"]',
    ) as HTMLElement
    const css = emotionCssFor(leaf)
    // The hide-on-mobile band applies as plain CSS — no media gate — so
    // the artboard shows it regardless of the real window width...
    expect(css).toContain('display:none')
    expect(css).not.toContain('@media(max-width:599.95px)')
    // ...and the desktop-only slice is gone entirely.
    expect(css).not.toContain('letter-spacing')
    expect(css).toContain('color:red')
  })

  it('applies the desktop band and drops the mobile one at LG width', () => {
    renderPinned(bandNode('desktop-node'), 1200)
    const leaf = document.querySelector(
      '[data-aglyn="leaf:desktop-node"]',
    ) as HTMLElement
    const css = emotionCssFor(leaf)
    expect(css).toContain('letter-spacing:3px')
    expect(css).not.toContain('display:none')
  })

  it('resolves responsive sx objects at the pinned device breakpoint', () => {
    const node = {
      $id: 'responsive-node',
      type: 'node',
      componentId: 'unregistered-box',
      props: {},
      // Mobile Nav shape: hidden on phones, flex row from md up.
      sx: { display: { xs: 'none', md: 'flex' } },
      nodes: [],
    }
    const theme = createDevicePinnedTheme(createTheme(), 900)
    render(
      <ThemeProvider theme={theme}>
        <ElementLeafComponent node={node} />
      </ThemeProvider>,
    )
    const leaf = document.querySelector(
      '[data-aglyn="leaf:responsive-node"]',
    ) as HTMLElement
    const css = emotionCssFor(leaf)
    // Both slices land under forced always-true queries, in mobile-first
    // order, so the md value wins at the pinned laptop width.
    expect(css).toContain('display:none')
    expect(css).toContain('display:flex')
    expect(css.lastIndexOf('display:flex')).toBeGreaterThan(
      css.lastIndexOf('display:none'),
    )
  })

  it('parks off-device responsive slices under unreachable queries', () => {
    const node = {
      $id: 'phone-responsive-node',
      type: 'node',
      componentId: 'unregistered-box',
      props: {},
      sx: { display: { xs: 'none', md: 'flex' } },
      nodes: [],
    }
    const theme = createDevicePinnedTheme(createTheme(), 390)
    render(
      <ThemeProvider theme={theme}>
        <ElementLeafComponent node={node} />
      </ThemeProvider>,
    )
    const leaf = document.querySelector(
      '[data-aglyn="leaf:phone-responsive-node"]',
    ) as HTMLElement
    const css = emotionCssFor(leaf)
    // The md slice is gated behind a >=100000px query no window reaches.
    expect(css).toMatch(/@media\(min-width:100\d{3}px\)\{[^}]*display:flex/)
  })
})
