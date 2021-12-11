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


import { getElementComputedStyle } from '../get-element-computed-style'
import { getElementNodeName } from '../get-element-node-name'
import { getNodeWindow } from '../get-node-window'


export function isNodeElement(node): node is Element {
  const OwnElement = getNodeWindow(node)['Element']
  return node instanceof OwnElement || node instanceof Element
}

export function isNodeShadowRoot(node): node is ShadowRoot {
  // IE 11 has no ShadowRoot
  if (typeof ShadowRoot === 'undefined') {
    return false
  }
  const OwnElement = getNodeWindow(node)['ShadowRoot']
  return node instanceof OwnElement || node instanceof ShadowRoot
}

export function isNodeTableElement(node): node is HTMLTableElement | HTMLTableCellElement {
  return ['table', 'td', 'th'].indexOf(getElementNodeName(node)) >= 0
}

export function isElementScrollParentElement(element: Element): boolean {
  // Firefox wants us to check `-x` and `-y` variations as well
  const {overflow, overflowX, overflowY} = getElementComputedStyle(element)
  return /auto|scroll|overlay|hidden/.test(overflow + overflowY + overflowX)
}

export function isElementWindow(element: Object): element is typeof window {
  return Object.prototype.toString.call(element) === '[object Window]'
}

export function isNodeObject(node: Object): node is Node {
  return 'nodeType' in node
}

export function isSVGElement(node: Node): node is SVGElement {
  return node instanceof getNodeWindow(node).SVGElement
}

export function isElementHTMLElement(node: Node | Window): node is HTMLElement {
  if (isElementWindow(node)) {
    return false
  }

  return node instanceof getNodeWindow(node).HTMLElement
}

export function isNodeDocument(node: Node): node is Document {
  const {Document} = getNodeWindow(node)

  return node instanceof Document
}
