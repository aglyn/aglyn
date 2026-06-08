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

import {viewport} from '../constants/enums'
import type {Boundary, ClientRectObject, RootBoundary} from '../dom'
import {getElementClientRectBoundingInner} from './get-element-client-rect-bounding-inner'
import {getElementDocumentElement} from './get-element-document-element'
import {getElementDocumentElementRect} from './get-element-document-element-rect'
import {getElementListScrollParents} from './get-element-list-scroll-parents'
import {getElementNodeName} from './get-element-node-name'
import {getElementOffsetParent} from './get-element-offset-parent'
import {getElementParentNode} from './get-element-parent-node'
import {getElementRectAsClientRect} from './get-element-rect-as-client-rect'
import {getElementViewportRect} from './get-element-viewport-rect'
import {elementContainsChildElement} from './guards/element-contains-child-element'
import {isElementHTMLElement} from './guards/is-element-html-element'
import {isNodeElement} from './guards/is-node-element'


function getClientRectFromMixedType(
  element: Element,
  clippingParent: Element | RootBoundary,
): ClientRectObject {
  return clippingParent === viewport
    ? getElementRectAsClientRect(getElementViewportRect(element))
    : isElementHTMLElement(clippingParent as Element)
      ? getElementClientRectBoundingInner(clippingParent as Element)
      : getElementRectAsClientRect(getElementDocumentElementRect(getElementDocumentElement(element)))
}
// A "clipping parent" is an overflowable container with the characteristic of
// clipping (or hiding) overflowing elements with a position different from
// `initial`
function getElementClippingParents(element: Element): Array<Element> {
  const clippingParents = getElementListScrollParents(getElementParentNode(element))
  const canEscapeClipping =
    ['absolute', 'fixed'].indexOf(getComputedStyle(element).position) >= 0
  const clipperElement =
    canEscapeClipping && isElementHTMLElement(element)
      ? getElementOffsetParent(element)
      : element

  if (!isNodeElement(clipperElement)) {
    return []
  }

  // $FlowFixMe[incompatible-return]: https://github.com/facebook/flow/issues/1414
  return clippingParents.filter(
    (clippingParent) =>
      isNodeElement(clippingParent) &&
      elementContainsChildElement(clippingParent as Element, clipperElement as Element) &&
      getElementNodeName(clippingParent as Element) !== 'body',
  ) as Element[]
}


/**
 * Gets the maximum area that the element is visible in due to any number of
 * clipping parents
 * @param element
 * @param boundary
 * @param rootBoundary
 */
export function getElementClippingRect(
  element: Element,
  boundary: Boundary,
  rootBoundary: RootBoundary,
): ClientRectObject {
  const mainClippingParents =
    boundary === 'clippingParents'
      ? getElementClippingParents(element)
      : [].concat(boundary)
  const clippingParents = [...mainClippingParents, rootBoundary]
  const firstClippingParent = clippingParents[0]

  const clippingRect = clippingParents.reduce((accRect, clippingParent) => {
    const rect = getClientRectFromMixedType(element, clippingParent)

    accRect.top = Math.max(rect.top, accRect.top)
    accRect.right = Math.min(rect.right, accRect.right)
    accRect.bottom = Math.min(rect.bottom, accRect.bottom)
    accRect.left = Math.max(rect.left, accRect.left)

    return accRect
  }, getClientRectFromMixedType(element, firstClippingParent))

  clippingRect.width = clippingRect.right - clippingRect.left
  clippingRect.height = clippingRect.bottom - clippingRect.top
  clippingRect.x = clippingRect.left
  clippingRect.y = clippingRect.top

  return clippingRect
}
export default getElementClippingRect
