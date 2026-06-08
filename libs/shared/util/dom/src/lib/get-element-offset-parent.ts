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


import {getElementComputedStyle} from './get-element-computed-style'
import {getElementNodeName} from './get-element-node-name'
import {getElementParentNode} from './get-element-parent-node'
import {getNodeWindow} from './get-node-window'
import {isElementHTMLElement} from './guards/is-element-html-element'
import {isNodeTableElement} from './guards/is-node-table-element'


function getTrueOffsetParent(element: Element): Element {
  if (
    !isElementHTMLElement(element) ||
    // https://github.com/popperjs/popper-core/issues/837
    getElementComputedStyle(element).position === 'fixed'
  ) {
    return null
  }

  return element['offsetParent']
}

// `.offsetParent` reports `null` for fixed elements, while absolute elements
// return the containing block
function getContainingBlock(element: Element) {
  const isFirefox = navigator.userAgent.toLowerCase().indexOf('firefox') !== -1
  const isIE = navigator.userAgent.indexOf('Trident') !== -1

  if (isIE && isElementHTMLElement(element)) {
    // In IE 9, 10 and 11 fixed elements containing block is always established by the viewport
    const elementCss = getElementComputedStyle(element)
    if (elementCss.position === 'fixed') {
      return null
    }
  }

  let currentNode = getElementParentNode(element)

  while (
    isElementHTMLElement(currentNode) &&
    ['html', 'body'].indexOf(getElementNodeName(currentNode)) < 0
    ) {
    const css = getElementComputedStyle(currentNode as Element)

    // This is non-exhaustive but covers the most common CSS properties that
    // create a containing block.
    // https://developer.mozilla.org/en-US/docs/Web/CSS/Containing_block#identifying_the_containing_block
    if (
      css.transform !== 'none' ||
      css.perspective !== 'none' ||
      css.contain === 'paint' ||
      ['transform', 'perspective'].indexOf(css.willChange) !== -1 ||
      (isFirefox && css.willChange === 'filter') ||
      (isFirefox && css.filter && css.filter !== 'none')
    ) {
      return currentNode
    }
    else {
      currentNode = currentNode.parentNode
    }
  }

  return null
}

function getElementPosition(element: Element): string {
  return getElementComputedStyle(element).position
}

// Gets the closest ancestor positioned element. Handles some edge cases,
// such as table ancestors and cross browser bugs.
export function getElementOffsetParent(element: Element) {
  const window = getNodeWindow(element)
  const isStaticPos = (el) => getElementPosition(el) === 'static'


  let offsetParent = getTrueOffsetParent(element)
  while (
    offsetParent &&
    isNodeTableElement(offsetParent) &&
    isStaticPos(offsetParent)
    ) {
    offsetParent = getTrueOffsetParent(offsetParent)
  }

  const nodeName = getElementNodeName(offsetParent),
    isHtmlEl = nodeName === 'html',
    isBodyElem = nodeName === 'body'

  if (offsetParent && isHtmlEl || (isBodyElem && isStaticPos(offsetParent))) {
    return window
  }

  return offsetParent || getContainingBlock(element) || window
}

export default getElementOffsetParent
