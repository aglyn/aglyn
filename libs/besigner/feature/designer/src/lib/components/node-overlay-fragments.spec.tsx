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

import { readFileSync } from 'fs'
import { join } from 'path'

import * as Aglyn from '@aglyn/aglyn'
import * as Besigner from '@aglyn/besigner'
import { consoleThemeCssVar, ThemeProvider } from '@aglyn/shared-ui-theme'
import { cleanup, render } from '@testing-library/react'
import { createRef } from 'react'

import NodeOverlay from './node-overlay'

/**
 * The quick-action strip's "add element" button opens a drawer that lives in
 * a provider well above this component. Nothing here clicks it; stubbing the
 * callback keeps the spec about geometry rather than about assembling the
 * whole editor shell.
 */
jest.mock('../hooks/use-add-element-drawer-callback', () => ({
  __esModule: true,
  useAddElementDrawerCallback: () => () => undefined,
  default: () => () => undefined,
}))

/**
 * AGL-2486 — the selection and hover chrome is drawn per LINE FRAGMENT.
 *
 * `getBoundingClientRect()`, which cannot describe an inline run that has
 * wrapped.
 *
 * jsdom does no layout, so the elements below state their own boxes. That is
 * the honest level for this file: what is under test is whether the overlay
 * draws what the geometry says, and where it hangs the label chip — not
 * whether a layout engine wraps text. The wrap itself was watched happen in
 * the running besigner.
 *
 * Colours are deliberately NOT asserted here. Emotion injects its rules via
 * `insertRule` under jest, so a class name in the markup proves nothing about
 * what it paints; `canvas-chrome-palette.spec.ts` already pins the palette
 * at the declaration.
 */
describe('the node overlay follows the element it outlines (AGL-2486)', () => {
  const NODE_ID = 'agl2486-overlay-node'

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

  /** A canvas leaf that reports exactly the line boxes it is given. */
  const leafReporting = (rects: DOMRect[]) => {
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
    document.body.appendChild(element)
    return element
  }

  const node = { $id: NODE_ID, componentId: 'muiTypography', parent: null }

  let getNode: jest.SpyInstance
  let getLastSelected: jest.SpyInstance

  const mount = (rects: DOMRect[]) => {
    const element = leafReporting(rects)
    const ref = createRef<HTMLElement>()
    ;(ref as any).current = element
    Besigner.refs.set(NODE_ID as any, ref as any)
    return render(
      <ThemeProvider theme={consoleThemeCssVar}>
        <NodeOverlay variant="selected" />
      </ThemeProvider>,
    )
  }

  /** Every outline the overlay drew, in the order it drew them. */
  const outlines = () =>
    Array.from(
      document.querySelectorAll<HTMLElement>(`[data-aglyn="outline:${NODE_ID}"]`),
    )

  const boxOf = (element: HTMLElement) => [
    element.style.left,
    element.style.top,
    element.style.width,
    element.style.height,
  ]

  beforeEach(() => {
    getNode = jest
      .spyOn(Aglyn.canvas, 'getNode')
      .mockImplementation((($id: any) =>
        $id === NODE_ID ? (node as any) : undefined) as any)
    getLastSelected = jest
      .spyOn(Besigner.focus, 'getLastSelected')
      .mockImplementation((() => ({ $id: NODE_ID })) as any)
  })

  afterEach(() => {
    cleanup()
    Besigner.refs.delete(NODE_ID as any)
    getNode.mockRestore()
    getLastSelected.mockRestore()
    document.body.innerHTML = ''
  })

  /**
   * The regression that would hurt most. Blocks are the overwhelming majority
   * of canvas nodes and their outline is correct today: one box, at the
   * popper's own origin, the size of the bounding rect.
   */
  it('draws a block as ONE box at the anchor origin, unchanged', () => {
    mount([rect(110, 291, 656, 56)])

    const drawn = outlines()
    expect(drawn).toHaveLength(1)
    expect(boxOf(drawn[0])).toEqual(['0px', '0px', '656px', '56px'])
  })

  it('draws one box per line for a wrapped inline run', () => {
    mount([
      rect(110, 619, 269, 20),
      rect(110, 639, 246, 20),
      rect(110, 659, 130, 20),
    ])

    // Offsets are relative to the union the popper is anchored on, which
    // starts at 110,619 — so line two sits 20px down and line three 40px.
    expect(outlines().map(boxOf)).toEqual([
      ['0px', '0px', '269px', '20px'],
      ['0px', '20px', '246px', '20px'],
      ['0px', '40px', '130px', '20px'],
    ])
  })

  /**
   * The union box's specific lie: it covers the empty space to the right of a
   * short last line. No fragment may.
   */
  it('leaves the empty space beside a short last line unclaimed', () => {
    mount([rect(110, 619, 269, 20), rect(110, 639, 130, 20)])

    const widths = outlines().map((element) => element.style.width)
    expect(widths).toEqual(['269px', '130px'])
    expect(widths).not.toContain('269px269px')
  })

  /**
   * A run that BEGINS mid-line. The union's left edge comes from the second
   * line, so a union-anchored chip would float over the sibling text the run
   * follows. The chip must sit at the start of the run.
   */
  it('anchors the label chip on the fragment the run starts on', () => {
    mount([rect(420, 619, 180, 20), rect(110, 639, 240, 20)])

    const chip = document.querySelector<HTMLElement>(
      `[data-aglyn-node="${NODE_ID}"]`,
    )
    expect(chip).toBeTruthy()
    // The chip's popper is positioned from the anchor's own rect, so the
    // anchor is what this asserts: `first`, at x=420, not the union at 110.
    const anchored = chip?.closest('[data-popper-placement]') as HTMLElement
    expect(anchored?.style.transform ?? '').toContain('420')
    expect(anchored?.style.transform ?? '').not.toContain('110')
  })

  it('draws exactly one label chip however many lines the run occupies', () => {
    mount([
      rect(110, 619, 269, 20),
      rect(110, 639, 246, 20),
      rect(110, 659, 130, 20),
    ])

    expect(
      document.querySelectorAll(`[data-aglyn-node="${NODE_ID}"]`),
    ).toHaveLength(1)
  })

  /**
   * Paint order is what keeps the action strip usable. Nothing in this
   * chrome declares a `z-index`, so positioned siblings paint in document
   * order and whatever is drawn LAST sits on top. The strip is the only
   * interactive part of the overlay, and an outline drawn after it would
   * cover its buttons.
   */
  it('paints its interactive chrome last, after every outline it draws', () => {
    mount([rect(110, 291, 656, 56), rect(110, 347, 400, 56)])

    const strip = document.querySelector(`[data-aglyn-node="${NODE_ID}"]`)
    expect(strip).toBeTruthy()
    const drawn = outlines()
    expect(drawn.length).toBeGreaterThan(0)
    for (const box of drawn) {
      const position = box.compareDocumentPosition(strip as Node)
      expect(Boolean(position & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true)
    }
  })
})

/**
 * The same question one level up, where the canvas mounts BOTH overlays.
 *
 * Each overlay root is a fixed-position popper, so it is its own stacking
 * context and a `z-index` declared inside one cannot lift it past the other:
 * the two roots order by document position alone. The overlay carrying the
 * action strip therefore has to be the last one rendered, or the other
 * overlay's outline paints across the strip's buttons — and it draws the
 * SELECTED treatment whenever the pointer is on the selected node, which is
 * exactly when someone is reaching for them.
 */
describe('the canvas mounts the overlay with controls last (AGL-2486)', () => {
  const sourceOf = (file: string) => readFileSync(join(__dirname, file), 'utf8')

  it('renders the decoration overlay before the one carrying controls', () => {
    const source = sourceOf('viewport-frame.component.tsx')
    expect(source.indexOf('variant="hovered"')).toBeLessThan(
      source.indexOf('variant="selected"'),
    )
  })

  it('leaves the outline no z-index to climb back over them with', () => {
    // Document order only decides this while the decoration stays out of the
    // stacking game. A `z-index` here would beat the order above silently.
    expect(sourceOf('node-outline.tsx')).not.toContain('zIndex')
  })
})
