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


import type { VisualViewport } from '../types'
import { getElementParentNode } from './get-element-parent-node'
import { getElementScrollParent } from './get-element-scroll-parent'
import { getNodeWindow } from './get-node-window'
import { isElementScrollParentElement } from './guards/node-is'

/*
 given a DOM element, return the list of all scroll parents, up the list of ancesors
 until we get to the top window object. This list is what we attach scroll listeners
 to, because if any of these parent elements scroll, we'll need to re-calculate the
 reference element's position.
 */
export function getElementListScrollParents(
  element: Node,
  list: Array<Element | Window> = [],
): Array<Element | Window | VisualViewport> {
  const scrollParent = getElementScrollParent(element)
  const isBody = scrollParent === element.ownerDocument?.body
  const win = getNodeWindow(scrollParent)
  const target = isBody
    ? [win].concat(
      win.visualViewport || [] as any,
      isElementScrollParentElement(scrollParent) ? scrollParent : [] as any,
    )
    : scrollParent
  const updatedList = list.concat(target)

  return isBody
    ? updatedList
    : // $FlowFixMe[incompatible-call]: isBody tells us target will be an HTMLElement here
    updatedList.concat(getElementListScrollParents(getElementParentNode(target as Element)) as any)
}

export default getElementListScrollParents
