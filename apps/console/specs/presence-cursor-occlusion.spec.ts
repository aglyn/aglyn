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
 * @jest-environment jsdom
 */

import { pointerIsOnCanvas } from '../hooks/use-presence'

/**
 * A cursor is only broadcast when the pointer is really ON the canvas
 * (AGL-2486).
 *
 * Zach: "even though the canvas does not have focus because of the
 * drawer/dialog for aglyn assist the presence does still report cursor" — a
 * session typing into the Assist panel was publishing a canvas position, so a
 * colleague saw a cursor implying attention that was not there.
 *
 * The DOM here is built to the real shape rather than mocked, because the real
 * shape is the whole difficulty: the besigner canvas lives in a CLOSED shadow
 * root, so `document.elementFromPoint` retargets to the shadow HOST and the
 * obvious `canvasRoot.contains(top)` check is false even when the pointer is
 * squarely on the canvas. Measured in the browser, that host is
 * `AglynViewportShadowDom-root`. A naive containment test would have suppressed
 * every cursor in the product, and it would have looked completely reasonable
 * in review.
 */
describe('the canvas is in a closed shadow root, which is the trap', () => {
  function buildCanvas() {
    const host = document.createElement('div')
    document.body.append(host)
    const shadow = host.attachShadow({ mode: 'closed' })
    const canvasRoot = document.createElement('div')
    const child = document.createElement('span')
    canvasRoot.append(child)
    shadow.append(canvasRoot)
    return { host, canvasRoot, child }
  }

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('treats a hit on the shadow HOST as being on the canvas', () => {
    // This is what `elementFromPoint` actually returns for a pointer over the
    // canvas. `canvasRoot.contains(host)` is false — `contains` does not cross
    // a shadow boundary — so the naive check fails exactly here.
    const { host, canvasRoot } = buildCanvas()
    expect(canvasRoot.contains(host)).toBe(false)
    expect(pointerIsOnCanvas(canvasRoot, host)).toBe(true)
  })

  it('still accepts a hit on something genuinely inside the canvas', () => {
    const { canvasRoot, child } = buildCanvas()
    expect(pointerIsOnCanvas(canvasRoot, child)).toBe(true)
  })

  it('accepts a hit on an OUTER host when the canvas is nested deeper', () => {
    // `elementFromPoint` retargets to the OUTERMOST host, so one lookup is not
    // enough if the canvas ever sits inside two shadow roots.
    const outerHost = document.createElement('div')
    document.body.append(outerHost)
    const outer = outerHost.attachShadow({ mode: 'closed' })
    const innerHost = document.createElement('div')
    outer.append(innerHost)
    const inner = innerHost.attachShadow({ mode: 'closed' })
    const canvasRoot = document.createElement('div')
    inner.append(canvasRoot)
    expect(pointerIsOnCanvas(canvasRoot, outerHost)).toBe(true)
  })
})

describe('anything drawn OVER the canvas suppresses the cursor', () => {
  function buildCanvas() {
    const host = document.createElement('div')
    document.body.append(host)
    const shadow = host.attachShadow({ mode: 'closed' })
    const canvasRoot = document.createElement('div')
    shadow.append(canvasRoot)
    return { host, canvasRoot }
  }

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('suppresses for the Assist drawer’s modal backdrop', () => {
    // The measured case. With Assist open, a point over the visibly exposed
    // canvas hit-tests to `MuiBackdrop-root` while the canvas's bounding box
    // still covers it — which is why the old geometric test kept publishing.
    const { canvasRoot } = buildCanvas()
    const backdrop = document.createElement('div')
    backdrop.className = 'MuiBackdrop-root MuiModal-backdrop'
    document.body.append(backdrop)
    expect(pointerIsOnCanvas(canvasRoot, backdrop)).toBe(false)
  })

  it('suppresses for a portalled panel that is a SIBLING of the canvas', () => {
    // MUI renders drawers and dialogs into a portal at body level, so the
    // panel is neither inside the canvas nor a host of it.
    const { canvasRoot } = buildCanvas()
    const drawer = document.createElement('div')
    drawer.className = 'MuiDrawer-paper'
    document.body.append(drawer)
    expect(pointerIsOnCanvas(canvasRoot, drawer)).toBe(false)
  })

  it('suppresses when the hit test can see nothing at all', () => {
    // Off-viewport, or between frames. Not a position worth asserting to
    // anyone.
    const { canvasRoot } = buildCanvas()
    expect(pointerIsOnCanvas(canvasRoot, null)).toBe(false)
  })

  it('suppresses when the canvas has not been registered yet', () => {
    expect(pointerIsOnCanvas(null, document.body)).toBe(false)
  })
})

describe('what is NOT suppressed, which matters just as much', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('keeps publishing while a side panel merely holds FOCUS', () => {
    // Reading the Attributes panel with the mouse still resting on the canvas
    // has not stopped anyone pointing at the canvas. The decision is what sits
    // UNDER the pointer, never what holds focus — conflating the two would
    // blank a cursor that is telling the truth.
    const host = document.createElement('div')
    document.body.append(host)
    const shadow = host.attachShadow({ mode: 'closed' })
    const canvasRoot = document.createElement('div')
    shadow.append(canvasRoot)

    const panel = document.createElement('input')
    document.body.append(panel)
    panel.focus()
    expect(document.activeElement).toBe(panel)

    // Focus is in the panel; the pointer is still over the canvas.
    expect(pointerIsOnCanvas(canvasRoot, host)).toBe(true)
  })
})
