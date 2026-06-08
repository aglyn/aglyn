/**
 * @license
 * Copyright 2022 Aglyn LLC
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
import type { VirtualElement } from '../dom'

export type BoundingClientRect = {
  width: number
  height: number
  top: number
  right: number
  bottom: number
  left: number
  x: number
  y: number
}

export const DEFAULT_ELEMENT_CLIENT_RECT_BOUNDING = {
  width: 0,
  height: 0,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  x: 0,
  y: 0,
}

export function getElementClientRectBounding(
  element: Element | VirtualElement,
): BoundingClientRect {
  const { width, height, left, top, right, bottom } =
    element?.getBoundingClientRect?.() || {
      ...DEFAULT_ELEMENT_CLIENT_RECT_BOUNDING,
    }
  const scaleX = 1
  const scaleY = 1

  return {
    width: width / scaleX,
    height: height / scaleY,
    top: top / scaleY,
    right: right / scaleX,
    bottom: bottom / scaleY,
    left: left / scaleX,
    x: left / scaleX,
    y: top / scaleY,
  }
}
export default getElementClientRectBounding
