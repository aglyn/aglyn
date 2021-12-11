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


import type { Rect } from '../types'
import { getElementComputedStyle } from './get-element-computed-style'
import { getElementDocumentElement } from './get-element-document-element'
import { getElementWindowScrollBarX } from './get-element-window-scroll-bar-x'
import { getNodeWindowScroll } from './get-node-window-scroll'

// Gets the entire size of the scrollable document area, even extending outside
// of the `<html>` and `<body>` rect bounds if horizontally scrollable
export function getElementDocumentElementRect(element: HTMLElement): Rect {
  const html = getElementDocumentElement(element)
  const winScroll = getNodeWindowScroll(element)
  const body = element.ownerDocument?.body

  const width = Math.max(
    html.scrollWidth,
    html.clientWidth,
    body ? body.scrollWidth : 0,
    body ? body.clientWidth : 0,
  )
  const height = Math.max(
    html.scrollHeight,
    html.clientHeight,
    body ? body.scrollHeight : 0,
    body ? body.clientHeight : 0,
  )

  let x = -winScroll.scrollLeft + getElementWindowScrollBarX(element)
  const y = -winScroll.scrollTop

  if (getElementComputedStyle(body || html).direction === 'rtl') {
    x += Math.max(html.clientWidth, body ? body.clientWidth : 0) - width
  }

  return {width, height, x, y}
}
export default getElementDocumentElementRect
