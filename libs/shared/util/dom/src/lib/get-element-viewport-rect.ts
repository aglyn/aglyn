/**
 * @license
 * Copyright 2021 Aglyn LLC
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


import {getElementDocumentElement} from './get-element-document-element'
import {getElementWindowScrollBarX} from './get-element-window-scroll-bar-x'
import {getNodeWindow} from './get-node-window'


export function getElementViewportRect(element: Element) {
  const win = getNodeWindow(element)
  const html = getElementDocumentElement(element)
  const visualViewport = win.visualViewport


  let width = html.clientWidth
  let height = html.clientHeight
  let x = 0
  let y = 0

  // NB: This isn't supported on iOS <= 12. If the keyboard is open, the popper
  // can be obscured underneath it.
  // Also, `html.clientHeight` adds the bottom bar height in Safari iOS, even
  // if it isn't open, so if this isn't available, the popper will be detected
  // to overflow the bottom of the screen too early.
  if (visualViewport) {
    width = visualViewport.width
    height = visualViewport.height

    // Uses Layout Viewport (like Chrome; Safari does not currently)
    // In Chrome, it returns a value very close to 0 (+/-) but contains rounding
    // errors due to floating point numbers, so we need to check precision.
    // Safari returns a number <= 0, usually < -1 when pinch-zoomed

    // Feature detection fails in mobile emulation mode in Chrome.
    // Math.abs(win.innerWidth / visualViewport.scale - visualViewport.width) <
    // 0.001
    // Fallback here: "Not Safari" userAgent
    if (!/^((?!chrome|android).)*safari/i.test(navigator.userAgent)) {
      x = visualViewport.offsetLeft
      y = visualViewport.offsetTop
    }
  }

  return {
    width,
    height,
    x: x + getElementWindowScrollBarX(element),
    y,
  }
}
export default getElementViewportRect
