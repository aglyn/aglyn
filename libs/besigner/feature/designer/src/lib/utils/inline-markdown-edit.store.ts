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

import * as Aglyn from '@aglyn/aglyn'
import { makeAutoObservable } from 'mobx'

export interface InlineMarkdownEditRect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * The attribute a double-click edits in place, or `undefined` when the
 * component declares none.
 *
 * The trigger is the component schema's OWN declaration — the same
 * `FieldComponentType.MARKDOWN` that already makes the attributes panel render
 * the WYSIWYG (AGL-1616) — not a component id and not a bespoke DOM attribute.
 * The canvas exposes no per-leaf marker to hang one on, and a hardcoded
 * `componentId === 'markdown'` would leave the next component that declares a
 * document attribute (an email block, a plugin's own) editable in the panel and
 * not on the canvas. One declaration, both surfaces.
 */
export function findMarkdownAttributeName(
  node: Aglyn.NodeSchema<any> | undefined,
): string | undefined {
  for (const attribute of node?.componentSchema?.attributes ?? []) {
    if (attribute?.component === Aglyn.FieldComponentType.MARKDOWN) {
      return attribute.name
    }
  }
  return undefined
}

/**
 * State for the in-place canvas markdown editor (AGL-1624): which node is
 * being edited, which of its attributes holds the document, the value the
 * editor opened on, and where the element sits in viewport coordinates.
 *
 * Screen coordinates because the editor renders as a fixed overlay OUTSIDE the
 * closed canvas shadow root — the same frame of reference `inlineTextEdit`
 * uses, and the only one the two sides share.
 *
 * `initialValue` is captured at open and never re-read. The editor re-parses
 * its row model whenever the incoming value differs from the string it last
 * emitted, which resets the undo history and drops the caret; feeding the
 * node's live props back in would do that on every commit, and again whenever
 * a co-editing peer touched the same node.
 */
class InlineMarkdownEditStore {
  node?: Aglyn.NodeSchema<any> = undefined
  rect?: InlineMarkdownEditRect = undefined
  attributeName?: string = undefined
  initialValue = ''

  constructor() {
    makeAutoObservable(this)
  }

  open(
    node: Aglyn.NodeSchema<any>,
    rect: InlineMarkdownEditRect,
    attributeName: string,
    initialValue: string,
  ) {
    this.node = node
    this.rect = rect
    this.attributeName = attributeName
    this.initialValue = initialValue
  }

  close() {
    this.node = undefined
    this.rect = undefined
    this.attributeName = undefined
    this.initialValue = ''
  }
}

export const inlineMarkdownEdit = new InlineMarkdownEditStore()
export default inlineMarkdownEdit
