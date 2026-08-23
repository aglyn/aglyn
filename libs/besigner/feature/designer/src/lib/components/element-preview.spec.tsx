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
import { cleanup, render, waitFor } from '@testing-library/react'

import ElementPreview, { subtreeHasInk } from './element-preview.component'

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

/** A component that renders REAL dom, so "did it draw" is answerable. */
const CONTENTFUL_COMPONENT_ID = 'preview-spec-banner'

const CONTENTFUL_PRESET = {
  $id: 'preview-spec-contentful',
  type: Aglyn.NodeType.PRESET,
  displayName: 'Banner',
  category: Aglyn.ComponentCategory.LAYOUT,
  data: {
    $id: null,
    componentId: CONTENTFUL_COMPONENT_ID,
    props: { children: 'Northwind Coffee' },
  },
}

/** Renders a real but EMPTY element — the shape of `Toolbar Content`. */
const HOLLOW_COMPONENT_ID = 'preview-spec-hollow'

const HOLLOW_PRESET = {
  $id: 'preview-spec-hollow-preset',
  type: Aglyn.NodeType.PRESET,
  displayName: 'Hollow',
  category: Aglyn.ComponentCategory.NAVIGATION,
  data: { $id: null, componentId: HOLLOW_COMPONENT_ID, props: {} },
}

const renderPreview = (node: any = PRESET) =>
  render(
    <ThemeProvider theme={theme}>
      <ElementPreview node={node} />
    </ThemeProvider>,
  )

describe('ElementPreview (AGL-2486)', () => {
  beforeAll(() => {
    Aglyn.components.registerComponent(
      ((props: any) => <div>{props?.children}</div>) as any,
      {
        $id: CONTENTFUL_COMPONENT_ID,
        pluginId: 'mui',
        displayName: 'Banner',
        category: Aglyn.ComponentCategory.LAYOUT,
      } as Aglyn.ComponentSchema,
    )
    Aglyn.components.registerComponent(
      (() => <div style={{ minHeight: 64 }} />) as any,
      {
        $id: HOLLOW_COMPONENT_ID,
        pluginId: 'mui',
        displayName: 'Hollow',
        category: Aglyn.ComponentCategory.NAVIGATION,
      } as Aglyn.ComponentSchema,
    )
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

  it('actually draws the element, not just an empty frame', () => {
    // The assertion the other four were missing. Isolation, inertness and
    // bounding all pass just as well against a preview that renders nothing
    // at all — which is exactly what the first version shipped as.
    const { container } = renderPreview(CONTENTFUL_PRESET)
    const box = container.querySelector(
      '[data-testid="element-preview"]',
    ) as HTMLElement
    const host = box.querySelector('[data-preview-root]') as HTMLElement
    const shadow = host?.shadowRoot
    expect(shadow).toBeTruthy()
    expect(shadow.textContent).toContain('Northwind')
  })

  it('renders nothing at all for an item with no nodes to draw', () => {
    const { container } = renderPreview({ $id: 'no-data', displayName: 'X' })
    expect(container.querySelector('[data-testid="element-preview"]')).toBeNull()
  })

  it('says so when the element renders but draws nothing visible', async () => {
    // `Toolbar Content` composes a real 64px transparent row with no
    // children. It renders CORRECTLY and looks exactly like the bug where
    // nothing rendered — so the frame has to say which it is.
    const { container } = renderPreview(HOLLOW_PRESET)
    await waitFor(() => {
      expect(
        container.querySelector('[data-testid="element-preview-empty"]'),
      ).toBeTruthy()
    })
    const note = container.querySelector(
      '[data-testid="element-preview-empty"]',
    )
    expect(note.textContent.toLowerCase()).toContain(
      'nothing to show on its own',
    )
  })

  describe('the ink rule itself', () => {
    const withShadow = (fill: (root: ShadowRoot) => void) => {
      const host = document.createElement('div')
      document.body.appendChild(host)
      fill(host.attachShadow({ mode: 'open' }))
      return host
    }

    it('does not count the shadow cache CSS as content', () => {
      // Emotion inserts through `insertRule` under jest, so its style tags
      // are EMPTY here while carrying real CSS in a browser. Driven directly
      // rather than through a render, because a render cannot reproduce the
      // browser's style text — which is precisely how the first version of
      // this check shipped green and then failed in the app.
      const host = withShadow((root) => {
        const style = document.createElement('style')
        style.textContent = '@media (min-width:600px){.x{color:red}}'
        root.appendChild(style)
        root.appendChild(document.createElement('div'))
      })
      expect((host.shadowRoot.textContent || '').trim()).not.toBe('')
      expect(subtreeHasInk(host)).toBe(false)
    })

    it('counts real text, and media, as content', () => {
      expect(
        subtreeHasInk(
          withShadow((root) => {
            const el = document.createElement('div')
            el.textContent = 'Your Brand'
            root.appendChild(el)
          }),
        ),
      ).toBe(true)
      expect(
        subtreeHasInk(
          withShadow((root) => root.appendChild(document.createElement('img'))),
        ),
      ).toBe(true)
    })
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
