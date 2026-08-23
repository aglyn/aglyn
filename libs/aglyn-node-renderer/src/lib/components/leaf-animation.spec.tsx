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
 * Element animation as the renderer emits it (AGL-2486).
 *
 * There is exactly ONE node renderer, and the canvas, the console preview and
 * the tenant page all mount it — so asserting what `Leaf` puts on the element
 * is the same assertion on all three surfaces (the AGL-1331/AGL-1725 argument,
 * same probe).
 */

import * as Aglyn from '@aglyn/aglyn'
import { createTheme, ThemeProvider } from '@aglyn/shared-ui-theme'
import { render, screen } from '@testing-library/react'
import TreeRoot from './tree-root'

const Probe = (props: any) => <div {...props} />

const renderNode = (props: Record<string, unknown>) => {
  Aglyn.components.registerComponent(Probe as any, {
    $id: 'animation-probe',
    pluginId: 'test',
  } as any)
  render(
    <ThemeProvider theme={createTheme({ palette: { mode: 'light' } })}>
      <TreeRoot
        node={
          {
            $id: 'root',
            componentId: 'animation-probe',
            pluginId: 'test',
            props: { 'data-testid': 'probe', ...props },
            children: [],
          } as any
        }
      />
    </ThemeProvider>,
  )
  return screen.getByTestId('probe')
}

describe('Leaf element animation (AGL-2486)', () => {
  it('emits nothing at all for a node that does not animate', () => {
    const el = renderNode({})
    expect(el.className).not.toContain('aglyn-anim')
    expect(el.getAttribute('data-aglyn-anim-trigger')).toBeNull()
    expect(el.getAttribute('style')).toBeNull()
  })

  it('emits the class, trigger attribute and custom properties', () => {
    const el = renderNode({
      aglynAnimation: 'slide-up',
      aglynAnimationTrigger: 'scroll',
      aglynAnimationDuration: 400,
      aglynAnimationDelay: 150,
    })
    expect(el.className).toContain('aglyn-anim')
    expect(el.className).toContain('aglyn-anim--slide-up')
    expect(el.getAttribute('data-aglyn-anim-trigger')).toBe('scroll')
    expect(el.style.getPropertyValue('--aglyn-anim-duration')).toBe('400ms')
    expect(el.style.getPropertyValue('--aglyn-anim-delay')).toBe('150ms')
  })

  it('keeps a class the author already set', () => {
    const el = renderNode({ className: 'hero', aglynAnimation: 'fade' })
    expect(el.className).toContain('hero')
    expect(el.className).toContain('aglyn-anim--fade')
  })

  describe('the reserved props never reach the DOM', () => {
    // React lowercases unknown props onto the element, so a leaked directive
    // shows up as `aglynanimation="slide-up"` on every animated element on
    // every published page — the exact shape AGL-1314 hit with `hideIf`.
    it('strips them when the node animates', () => {
      const el = renderNode({
        aglynAnimation: 'zoom-in',
        aglynAnimationTrigger: 'hover',
        aglynAnimationDuration: 300,
        aglynAnimationDelay: 0,
        aglynAnimationRepeat: true,
      })
      const attrs = el.getAttributeNames().join(' ').toLowerCase()
      expect(attrs).not.toContain('aglynanimation')
    })

    it('strips them for the "none" sentinel too', () => {
      // `none` resolves to no animation but is still a real stored value, so
      // a strip that only runs on the animating path would leak it.
      const el = renderNode({ aglynAnimation: 'none' })
      const attrs = el.getAttributeNames().join(' ').toLowerCase()
      expect(attrs).not.toContain('aglynanimation')
      expect(el.className).not.toContain('aglyn-anim')
    })
  })

  it('honours a deliberate zero delay rather than dropping the property', () => {
    const el = renderNode({ aglynAnimation: 'fade', aglynAnimationDelay: 0 })
    expect(el.style.getPropertyValue('--aglyn-anim-delay')).toBe('0ms')
  })

  it('marks a replay element for the runtime', () => {
    const el = renderNode({
      aglynAnimation: 'fade',
      aglynAnimationTrigger: 'scroll',
      aglynAnimationRepeat: true,
    })
    expect(el.getAttribute('data-aglyn-anim-repeat')).toBe('1')
  })

  it('renders the element with its content, never hidden by the server', () => {
    // The server must never emit a hidden element: that is what keeps the
    // no-JS and crawler experience whole. Hiding is a CSS rule scoped under a
    // class the client adds, and nothing here may pre-empt it.
    const el = renderNode({
      aglynAnimation: 'slide-up',
      children: 'Findable copy',
    })
    expect(el.textContent).toBe('Findable copy')
    expect(el.style.opacity).toBe('')
    expect(el.style.display).toBe('')
    expect(el.hidden).toBe(false)
  })
})
