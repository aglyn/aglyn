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

import { act, cleanup, render } from '@testing-library/react'

import CollaboratorOverlays from './collaborator-overlays.component'

const REGISTRY: Record<string, { $id: string; node: Element }> = {}

jest.mock('@aglyn/besigner-ui', () => ({
  __esModule: true,
  useRenderedCanvasElements: () => ({
    elements: { current: REGISTRY },
    setElementRef: () => undefined,
    deleteElementRef: () => undefined,
  }),
}))

/**
 * AGL-2486 — a colleague's selection box is drawn on YOUR screen.
 *
 * That is what makes this the half nobody checks: the person whose selection
 * is wrong never sees it be wrong. It was measured with a single
 * `getBoundingClientRect()`, the same call that could not describe a wrapped
 * inline run for the besigner's own outline — so the same defect existed
 * here, silently, on every collaborator's heading.
 *
 * Geometry here rides `sx`, and emotion injects those rules via `insertRule`
 * under jest — a spec reading `container.innerHTML` would find the class name
 * and go green against a build that painted nothing. Every position below is
 * read out of `document.styleSheets`.
 */
describe('collaborator selection boxes follow the element (AGL-2486)', () => {
  const rect = (left: number, top: number, width: number, height: number) =>
    ({
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
      toJSON: () => undefined,
    }) as DOMRect

  const registerReporting = ($id: string, rects: DOMRect[]) => {
    const element = document.createElement('span')
    const union = rect(
      Math.min(...rects.map((r) => r.left)),
      Math.min(...rects.map((r) => r.top)),
      Math.max(...rects.map((r) => r.right)) -
        Math.min(...rects.map((r) => r.left)),
      Math.max(...rects.map((r) => r.bottom)) -
        Math.min(...rects.map((r) => r.top)),
    )
    element.getBoundingClientRect = () => union
    element.getClientRects = () =>
      Object.assign([...rects], {
        item: (index: number) => rects[index] ?? null,
      }) as unknown as DOMRectList
    REGISTRY[$id] = { $id, node: element }
    return element
  }

  const entry = (selectedNodeId: string) =>
    ({
      key: 'uid-1:session-a',
      uid: 'uid-1',
      displayName: 'Ada Lovelace',
      colour: '#c2185b',
      selectedNodeId,
    }) as any

  /** The rules emotion actually injected for one element. */
  const cssFor = (element: Element): string => {
    const classes = [...element.classList]
    const rules: string[] = []
    for (const sheet of [...document.styleSheets]) {
      let list: CSSRuleList
      try {
        list = sheet.cssRules
      } catch {
        continue
      }
      for (const rule of [...(list as any)] as CSSStyleRule[]) {
        if (classes.some((c) => rule.selectorText?.includes(`.${c}`))) {
          rules.push(rule.cssText)
        }
      }
    }
    return rules.join(' ')
  }

  const boxOf = (element: Element) => {
    const css = cssFor(element)
    const px = (property: string) => {
      const match = new RegExp(
        `[;{\\s]${property}:\\s*(-?\\d+(?:\\.\\d+)?)px`,
      ).exec(css)
      return match ? Number(match[1]) : null
    }
    return [px('left'), px('top'), px('width'), px('height')]
  }

  const selectionBoxes = () =>
    Array.from(
      document.querySelectorAll('[data-aglyn-collaborator-selection]'),
    ).sort(
      (a, b) =>
        Number(a.getAttribute('data-aglyn-collaborator-fragment')) -
        Number(b.getAttribute('data-aglyn-collaborator-fragment')),
    )

  /**
   * The overlay measures inside `requestAnimationFrame`, so the first commit
   * lands a frame after mount. Drive that frame rather than waiting on it.
   */
  const mountAnd = async (selectedNodeId: string) => {
    const frames: FrameRequestCallback[] = []
    const raf = jest
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        frames.push(callback)
        return frames.length
      })
    jest
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation(() => undefined)
    const result = render(<CollaboratorOverlays entries={[entry(selectedNodeId)]} />)
    // The effect queued the first measure; run exactly one.
    await act(async () => {
      frames.shift()?.(0)
    })
    raf.mockRestore()
    return result
  }

  afterEach(() => {
    cleanup()
    jest.restoreAllMocks()
    for (const key of Object.keys(REGISTRY)) delete REGISTRY[key]
    document.body.innerHTML = ''
  })

  it('draws a block selection as ONE box, unchanged', async () => {
    registerReporting('block-node', [rect(110, 291, 656, 56)])

    await mountAnd('block-node')

    const boxes = selectionBoxes()
    expect(boxes).toHaveLength(1)
    expect(boxOf(boxes[0])).toEqual([110, 291, 656, 56])
  })

  it('draws one box per line when the collaborator selected a wrapped run', async () => {
    registerReporting('wrapped-node', [
      rect(110, 619, 269, 20),
      rect(110, 639, 246, 20),
      rect(110, 659, 130, 20),
    ])

    await mountAnd('wrapped-node')

    expect(selectionBoxes().map(boxOf)).toEqual([
      [110, 619, 269, 20],
      [110, 639, 246, 20],
      [110, 659, 130, 20],
    ])
  })

  it('names the collaborator once, on the first line only', async () => {
    registerReporting('wrapped-node', [
      rect(110, 619, 269, 20),
      rect(110, 639, 130, 20),
    ])

    const { container } = await mountAnd('wrapped-node')

    expect(selectionBoxes()).toHaveLength(2)
    // Two names over one selection reads as two collaborators.
    expect(
      Array.from(container.querySelectorAll('*')).filter(
        (element) =>
          !element.children.length && element.textContent === 'Ada Lovelace',
      ),
    ).toHaveLength(1)
  })
})
