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
import {isElementHTMLElement} from './guards/is-element-html-element'
import {isElementWindow} from './guards/is-element-window'
import {isNodeObject} from './guards/is-node-object'
import isNodeDocument from './guards/is-node-window-document'


export function getOwnerDocument(target: Event['target']): Document {
  if (!target) {
    return document
  }

  if (isElementWindow(target)) {
    return target.document
  }

  if (!isNodeObject(target)) {
    return document
  }

  if (isNodeDocument(target)) {
    return target
  }

  if (isElementHTMLElement(target)) {
    return target.ownerDocument
  }

  return document
}
export default getOwnerDocument
