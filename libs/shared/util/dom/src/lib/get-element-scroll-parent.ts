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


import {getElementNodeName} from './get-element-node-name'
import {getElementParentNode} from './get-element-parent-node'
import {isElementHTMLElement} from './guards/is-element-html-element'
import {isElementScrollParentElement} from './guards/is-element-scroll-parent-element'


export function getElementScrollParent(node: Node): HTMLElement {
  if (['html', 'body', '#document'].indexOf(getElementNodeName(node)) >= 0) {
    // $FlowFixMe[incompatible-return]: assume body is always available
    return node.ownerDocument.body
  }

  if (isElementHTMLElement(node) && isElementScrollParentElement(node as HTMLElement)) {
    return node as HTMLElement
  }

  return getElementScrollParent(getElementParentNode(node))
}

export default getElementScrollParent
