/**
 * @license
 * Copyright 2026 Aglyn LLC
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

import type * as Aglyn from '@aglyn/aglyn'
import { makeAutoObservable } from 'mobx'

export interface InlineTextEditRect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * State for the inline canvas text editor: which node is being edited and
 * where its element sits in viewport coordinates (the editor renders as a
 * fixed overlay OUTSIDE the closed canvas shadow root, so screen coordinates
 * are the only shared frame of reference).
 */
class InlineTextEditStore {
  node?: Aglyn.NodeSchema<any> = undefined
  rect?: InlineTextEditRect = undefined

  constructor() {
    makeAutoObservable(this)
  }

  open(node: Aglyn.NodeSchema<any>, rect: InlineTextEditRect) {
    this.node = node
    this.rect = rect
  }

  close() {
    this.node = undefined
    this.rect = undefined
  }
}

export const inlineTextEdit = new InlineTextEditStore()
export default inlineTextEdit
