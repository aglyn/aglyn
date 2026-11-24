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
import * as Besigner from '@aglyn/besigner'
import { consoleThemeCssVar, ThemeProvider } from '@aglyn/shared-ui-theme'
import { act, render } from '@testing-library/react'

import NodeTreeView from './node-tree-view'
import WorkspacePanelComponent, {
  WorkspacePanelDragContext,
} from './workspace-panel.component'

/**
 * A closed Hierarchy panel paints nothing (AGL-4243).
 *
 * Below `md` the panel is a temporary drawer, a bottom sheet on a phone.
 * MUI keeps a closed swipeable drawer MOUNTED and hides it with
 * `visibility: hidden` on the modal and the paper; while a drag is in flight
 * the open sheet is hidden the same way. `visibility` is inherited, but a
 * descendant that sets `visibility: visible` is drawn anyway. The tree
 * revealed its row controls that way (the expand chevron always, and the
 * drag grip and ⋮ on a touch screen), so once a canvas selection had
 * expanded the path to it, a column of grips, chevrons and ⋮ was drawn over
 * the canvas wherever the closed sheet happened to sit. The rows' labels,
 * which only inherit, stayed hidden: the stray marks were the controls
 * alone.
 *
 * Revealed controls take their ancestor's visibility (`inherit`), so the
 * tree can never show more than the panel holding it. Why the closed sheet
 * was on the screen at all is the second half, at the end of this file.
 */

const noopFactory = (() => null) as any
const theme = consoleThemeCssVar

function seedCanvas() {
  Aglyn.components.registerComponent(noopFactory, {
    $id: 'div',
    displayName: 'Div',
  })
  Aglyn.components.registerComponent(noopFactory, {
    $id: 'stack',
    displayName: 'Stack',
  })
  Aglyn.canvas.reset()
  Aglyn.canvas.setNodes({
    [Aglyn.NODE_ROOT_ID]: {
      $id: Aglyn.NODE_ROOT_ID,
      componentId: 'div',
      nodes: ['section'],
    },
    section: {
      $id: 'section',
      componentId: 'stack',
      parentId: Aglyn.NODE_ROOT_ID,
      nodes: ['container'],
    },
    container: {
      $id: 'container',
      componentId: 'stack',
      parentId: 'section',
      nodes: ['heading'],
    },
    heading: {
      $id: 'heading',
      componentId: 'stack',
      parentId: 'container',
      nodes: [],
    },
  } as any)
}

const rowFor = ($id: string) =>
  document.querySelector(`[data-aglyn-node="${$id}"]`) as HTMLElement | null

/**
 * The used `visibility` of an element. jsdom inherits an undeclared value,
 * but hands a declared `inherit` back as the keyword itself; a browser
 * resolves it to the parent's value, so this does the same.
 */
const visibilityOf = (element: Element | null): string => {
  if (!element) return 'visible'
  const value = window.getComputedStyle(element).visibility
  return value === 'inherit' ? visibilityOf(element.parentElement) : value
}

/** Every element under the tree that would be drawn. */
const drawn = () =>
  Array.from(
    document.querySelectorAll(
      '#aglyn\\:node-tree-view, #aglyn\\:node-tree-view *',
    ),
  ).filter((element) => visibilityOf(element) !== 'hidden')

const describeElement = (element: Element) =>
  [
    element.tagName.toLowerCase(),
    element.getAttribute('aria-label'),
    element.getAttribute('class')?.split(' ').slice(0, 2).join('.'),
  ]
    .filter(Boolean)
    .join(' ')

function renderSheet(open: boolean, dragging = false) {
  return render(
    <ThemeProvider theme={theme}>
      <WorkspacePanelDragContext.Provider value={dragging}>
        <WorkspacePanelComponent
          id="aglyn:panel-left"
          anchor="left"
          open={open}
          temporary
          temporaryAnchor="bottom"
          component="aside"
          aria-label="left toolbox panel"
        >
          <NodeTreeView />
        </WorkspacePanelComponent>
      </WorkspacePanelDragContext.Provider>
    </ThemeProvider>,
  )
}

describe('a closed Hierarchy sheet paints nothing (AGL-4243)', () => {
  beforeEach(() => {
    seedCanvas()
    Besigner.focus.clearFocusStatus()
  })

  it('draws none of the rows a canvas selection expanded', () => {
    renderSheet(false)
    // The canvas selection: it expands every row on the path to the node.
    act(() => {
      Besigner.focus.setSelectedNode(Aglyn.canvas.getNode('heading')!)
    })
    // The rows ARE mounted (the sheet is kept mounted), which is what makes
    // this a painting question rather than a mounting one.
    expect(rowFor('container')).toBeTruthy()
    expect(rowFor('heading')).toBeTruthy()

    expect(drawn().map(describeElement)).toEqual([])
  })

  it('draws none of them after any number of selections', () => {
    renderSheet(false)
    for (const $id of ['section', 'heading', 'container', 'heading']) {
      act(() => {
        Besigner.focus.setSelectedNode(Aglyn.canvas.getNode($id)!)
      })
    }
    expect(rowFor('heading')).toBeTruthy()
    expect(drawn().map(describeElement)).toEqual([])
  })

  it('draws none of them while a drag hides the open sheet', () => {
    act(() => {
      Besigner.focus.setSelectedNode(Aglyn.canvas.getNode('heading')!)
    })
    renderSheet(true, true)
    expect(rowFor('heading')).toBeTruthy()
    expect(drawn().map(describeElement)).toEqual([])
  })

  it('opens on the selection made while it was closed, rows and chevrons drawn', () => {
    const view = renderSheet(false)
    act(() => {
      Besigner.focus.setSelectedNode(Aglyn.canvas.getNode('heading')!)
    })
    view.rerender(
      <ThemeProvider theme={theme}>
        <WorkspacePanelDragContext.Provider value={false}>
          <WorkspacePanelComponent
            id="aglyn:panel-left"
            anchor="left"
            open
            temporary
            temporaryAnchor="bottom"
            component="aside"
            aria-label="left toolbox panel"
          >
            <NodeTreeView />
          </WorkspacePanelComponent>
        </WorkspacePanelDragContext.Provider>
      </ThemeProvider>,
    )
    const heading = rowFor('heading')!
    expect(visibilityOf(heading)).not.toBe('hidden')
    // The selection made while closed is the one shown selected on opening.
    expect(heading.className).toMatch(/itemSelected/i)
    // A row with children keeps its chevron; a leaf hides its own.
    const chevron = (id: string) =>
      rowFor(id)!.querySelector('button[title$="children"]') as HTMLElement
    expect(visibilityOf(chevron('container'))).not.toBe('hidden')
    expect(visibilityOf(chevron('heading'))).toBe('hidden')
  })
})

/**
 * The closed sheet's off-screen offset is measured from its height when it
 * closes, and measured again only on a window resize. `75dvh` alone was
 * dropped by WebViews older than `dvh` (Chromium before 108), so the sheet
 * took its content's height and a selection that expanded the hierarchy
 * grew it upward onto the screen. Every engine gets a fixed height.
 */
describe('the phone sheet has a height every engine keeps (AGL-4243)', () => {
  beforeEach(() => {
    seedCanvas()
    Besigner.focus.clearFocusStatus()
  })

  /**
   * The heights the style sheets give the paper outside any at-rule: what
   * an engine that understands no `@supports` or `@media` still applies.
   */
  const matches = (element: Element, selector: string) => {
    try {
      return element.matches(selector)
    } catch {
      // A vendor pseudo-element jsdom cannot parse; never the paper's rule.
      return false
    }
  }
  const topLevelHeightsOf = (element: Element) =>
    Array.from(document.styleSheets)
      .flatMap((sheet) => Array.from(sheet.cssRules))
      .filter(
        (rule): rule is CSSStyleRule =>
          rule instanceof CSSStyleRule && matches(element, rule.selectorText),
      )
      .map((rule) => rule.style.getPropertyValue('height'))
      .filter(Boolean)

  it('declares a vh height outside @supports, so no engine falls back to content height', () => {
    renderSheet(false)
    const paper = document.getElementById('aglyn:panel-left')!
    expect(paper).toBeTruthy()
    const heights = topLevelHeightsOf(paper)
    expect(heights).toContain('75vh')
    expect(heights.filter((height) => height.includes('dvh'))).toEqual([])
  })
})
