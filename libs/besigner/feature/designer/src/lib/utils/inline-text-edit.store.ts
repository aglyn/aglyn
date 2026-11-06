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
import { makeAutoObservable, observableRef } from 'mobx'

export interface InlineTextEditRect {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Prop-override edit target (AGL-1304): the editor is anchored on a grafted
 * text leaf INSIDE a component instance, and the commit writes the
 * instance's `propValues[propName]` instead of the node's `children`. The
 * `node` held by the store stays the INSTANCE — the grafted leaf is not a
 * canvas node, only the anchor rect came from it.
 */
export interface InlinePropEditTarget {
  /** Declared prop name the edit commits to. */
  propName: string
  /**
   * The text the leaf currently renders (override unless unset, else the
   * declared default — `getInstanceEffectivePropText`). Captured at open
   * because the editor cannot re-derive it without the definition.
   */
  initialText: string
  /**
   * The schema of the element the prop fills — what decides which
   * formatting commands are offered, as a node's own schema does for it.
   */
  schema?: Aglyn.ComponentSchema<any>
  /**
   * Whether the edit is formatted text: every element the prop fills draws
   * markup. One that cannot would show the author bold that never renders.
   */
  rich?: boolean
  /**
   * The prop's formatted text as the instance stores it, or `''` — the
   * markup the editor opens with in place of the plain `initialText`.
   */
  initialHtml?: string
}

/**
 * Table-cell edit target: the editor is anchored on one rendered cell of a
 * Table element, and the commit rewrites that cell inside the node's grid
 * attribute instead of its `children` (see `table-cell-edit.ts`). A
 * formatting surface limited to inline formatting and links (AGL-4203): a
 * cell is one line of a pipe grid, so it holds no blocks.
 */
export interface InlineCellEditTarget {
  /** The attribute holding the grid string. */
  attribute: string
  /** Row in the parsed grid, header row included. */
  row: number
  column: number
  /** The cell's words when the edit opened. */
  initialText: string
  /** The cell's markup when it was formatted, or `''`. */
  initialHtml?: string
}

/**
 * State for the inline canvas text editor: which node is being edited and
 * where its element sits in viewport coordinates (the editor renders as a
 * fixed overlay OUTSIDE the closed canvas shadow root, so screen coordinates
 * are the only shared frame of reference).
 *
 * `anchor` is the element the rect was measured from, kept so the editor can
 * re-measure rather than drift when the canvas scrolls (AGL-1644). It is the
 * anchor RATHER than the node's `Besigner.refs` entry because a prop-override
 * edit measures a grafted preview leaf, which is not a canvas node and has no
 * ref — the case a ref lookup would have missed silently.
 *
 * An `observableRef`: a DOM node is a foreign object graph, and mobx has no
 * business walking into it.
 */
class InlineTextEditStore {
  node?: Aglyn.NodeSchema<any> = undefined
  rect?: InlineTextEditRect = undefined
  anchor?: Element = undefined
  propTarget?: InlinePropEditTarget = undefined
  cellTarget?: InlineCellEditTarget = undefined

  constructor() {
    makeAutoObservable(this, { anchor: observableRef })
  }

  open(
    node: Aglyn.NodeSchema<any>,
    rect: InlineTextEditRect,
    propTarget?: InlinePropEditTarget,
    anchor?: Element,
  ) {
    this.node = node
    this.rect = rect
    this.propTarget = propTarget
    this.cellTarget = undefined
    this.anchor = anchor
  }

  /** Opens the editor on one Table cell — see {@link InlineCellEditTarget}. */
  openCell(
    node: Aglyn.NodeSchema<any>,
    rect: InlineTextEditRect,
    cellTarget: InlineCellEditTarget,
    anchor: Element,
  ) {
    this.node = node
    this.rect = rect
    this.propTarget = undefined
    this.cellTarget = cellTarget
    this.anchor = anchor
  }

  close() {
    this.node = undefined
    this.rect = undefined
    this.anchor = undefined
    this.propTarget = undefined
    this.cellTarget = undefined
  }
}

export const inlineTextEdit = new InlineTextEditStore()

/**
 * Whether an inline text edit is open ON or INSIDE `element` (AGL-2486).
 *
 * The one place the "stand down, someone is typing in here" rule is
 * expressed. Every canvas leaf registers its own pointer handlers, and those
 * handlers begin by preventing the default — which is the default the
 * browser uses to place a caret. Asking only "is this leaf the node being
 * edited?" is not enough, and worse than not enough: a nested run stands its
 * own leaf down, the event then BUBBLES to the ancestor leaf, and the
 * ancestor prevents the default instead. The author sees an editor that is
 * open, styled and completely uninteractive — no caret, no drag-select, no
 * double-click-to-select-a-word.
 *
 * Containment, not identity, and by DOM rather than by node tree: the anchor
 * is the element that was measured, which is the one thing that is true for
 * a grafted instance leaf as well as a canvas node, and `contains` answers
 * for any nesting depth including the element itself.
 */
export function isInlineEditWithin(
  element: Element | null | undefined,
): boolean {
  const anchor = inlineTextEdit.anchor
  return Boolean(anchor && element && element.contains(anchor))
}

export default inlineTextEdit
