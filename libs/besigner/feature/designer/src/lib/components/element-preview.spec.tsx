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

import * as Aglyn from '@aglyn/aglyn'
import { consoleThemeCssVar, ThemeProvider } from '@aglyn/shared-ui-theme'
import { cleanup, render } from '@testing-library/react'

import ElementPreview from './element-preview.component'

const theme = consoleThemeCssVar

const PREVIEW_COMPONENT_ID = 'preview-spec-box'

/** A preset shaped like the drawer's own entries: nested `data`, no root id. */
const PRESET = {
  $id: 'preview-spec-preset',
  type: Aglyn.NodeType.PRESET,
  displayName: 'Preview Box',
  category: Aglyn.ComponentCategory.LAYOUT,
  data: {
    $id: null,
    componentId: PREVIEW_COMPONENT_ID,
    props: {},
    nodes: [],
  },
}

const renderPreview = (node: any = PRESET) =>
  render(
    <ThemeProvider theme={theme}>
      <ElementPreview node={node} />
    </ThemeProvider>,
  )

describe('ElementPreview (AGL-2486)', () => {
  beforeAll(() => {
    Aglyn.components.registerComponent((() => null) as any, {
      $id: PREVIEW_COMPONENT_ID,
      pluginId: 'mui',
      displayName: 'Preview Box',
      category: Aglyn.ComponentCategory.LAYOUT,
    } as Aglyn.ComponentSchema)
  })
  afterEach(cleanup)

  it('never touches the global canvas', () => {
    // The one hazard that would cost a user their work: `Aglyn.canvas` holds
    // the document being edited, and Preview's own route calls setNodes on
    // it. Drawing a thumbnail must not go anywhere near it.
    const before = Aglyn.canvas.nodes
    const setNodes = jest.spyOn(Aglyn.canvas, 'setNodes')

    renderPreview()

    expect(setNodes).not.toHaveBeenCalled()
    expect(Aglyn.canvas.nodes).toBe(before)
    setNodes.mockRestore()
  })

  it('composes into its own store, so two previews cannot collide', () => {
    const { container } = renderPreview()
    expect(container.querySelector('[data-testid="element-preview"]')).toBeTruthy()
  })

  it('is inert and cannot be pointed at', () => {
    const { container } = renderPreview()
    const box = container.querySelector(
      '[data-testid="element-preview"]',
    ) as HTMLElement

    // Read the emotion-generated rule rather than the inline markup: under
    // jest, emotion inserts via `insertRule`, so `container.innerHTML` shows
    // a class name and would go green against a preview that is fully
    // clickable.
    expect(cssFor(box.className)).toContain('pointer-events:none')

    // `inert` is set through the DOM property, so it is invisible to a
    // markup assertion and has to be read off the element.
    const stage = box.querySelector('div')
    expect((stage as any)?.inert).toBe(true)

    // Nothing in a preview should be reachable by keyboard either.
    expect(box.getAttribute('aria-hidden')).toBe('true')
  })

  it('is bounded, so a Footer cannot grow the panel that shows it', () => {
    const { container } = renderPreview()
    const box = container.querySelector(
      '[data-testid="element-preview"]',
    ) as HTMLElement
    const css = cssFor(box.className)
    expect(css).toContain('overflow:hidden')
    expect(css).toMatch(/height:\s*160px/)
  })

  it('renders nothing at all for an item with no nodes to draw', () => {
    const { container } = renderPreview({ $id: 'no-data', displayName: 'X' })
    expect(container.querySelector('[data-testid="element-preview"]')).toBeNull()
  })
})

/**
 * The emotion rules for a class list, read out of the live stylesheets.
 * Mirrors the `cssFor` helper in member-avatar.component.spec.tsx.
 */
function cssFor(className: string): string {
  const classes = String(className || '')
    .split(/\s+/)
    .filter(Boolean)
  const rules: string[] = []
  for (const sheet of Array.from(document.styleSheets)) {
    let cssRules: CSSRuleList
    try {
      cssRules = (sheet as CSSStyleSheet).cssRules
    } catch {
      continue
    }
    for (const rule of Array.from(cssRules ?? [])) {
      const text = (rule as CSSStyleRule).cssText ?? ''
      if (classes.some((c) => text.includes(`.${c}`))) rules.push(text)
    }
  }
  return rules.join('\n').replace(/\s*:\s*/g, ':')
}
