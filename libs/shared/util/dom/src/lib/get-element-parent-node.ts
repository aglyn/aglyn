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

import {getElementDocumentElement} from './get-element-document-element'
import {getElementNodeName} from './get-element-node-name'
import {isNodeShadowRoot} from './guards/is-node-shadow-root'


export function getElementParentNode(element: Node | ShadowRoot): Node {
  if (getElementNodeName(element) === 'html') {
    return element
  }

  return (
    // this is a quicker (but less type safe) way to save quite some bytes from the bundle
    element['assignedSlot'] || // step into the shadow DOM of the parent of a slotted node
    element.parentNode || // DOM Element
    (
      isNodeShadowRoot(element) ? element.host : null) // ShadowDom
    || getElementDocumentElement(element as Element, // fallback
    )
  )
}

export default getElementParentNode
