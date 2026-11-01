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
import { canvas } from '@aglyn/aglyn'
import { REPEAT_NODE_ID_PREFIX } from '@aglyn/aglyn/app-utils/expand-repeatables'
import * as Besigner from '@aglyn/besigner'
import { makeAutoObservable, observableRef, reaction } from 'mobx'

const LEAF_STAMP = '[data-aglyn^="leaf:"]'

/** `rep__<repeating id>__<record>__<original id>`, as the expansion names a copy. */
const REPEAT_COPY_ID = new RegExp(`^${REPEAT_NODE_ID_PREFIX}.+?__\\d+__(.+)$`)

/** The attribute the canvas puts on each repeat copy's root, for its outline. */
export const REPEAT_COPY_ATTR = 'data-aglyn-repeat-copy'

/**
 * The id of the node a repeat copy draws: the copy's id with every repeat
 * prefix taken off, so a copy inside a copy names the original too. An id
 * that is not a copy comes back as it is.
 */
export function repeatTemplateIdOf(id: string): string {
  let current = id
  for (let match = REPEAT_COPY_ID.exec(current); match; ) {
    current = match[1]
    match = REPEAT_COPY_ID.exec(current)
  }
  return current
}

/** A repeat copy the pointer is on, and the real element it is a picture of. */
export interface RepeatCopyHit {
  /** The element the copy draws: the one an edit changes. */
  original: Aglyn.NodeSchema<any>
  /** The copy's own id, `rep__…`, as its rendered stamp carries it. */
  copyId: string
}

/**
 * The repeat copy under the pointer and the real element it is a picture of,
 * or null when the pointer is not on a copy.
 *
 * The copies (Sam, Jordan beside the real Avery) are inert drawings: nothing
 * in them is a document, so none of them can be selected. A click on one
 * still means something — the element it draws, the one an author edits to
 * change every copy at once — and the repeating element's own handlers,
 * which the copies are drawn inside, send it there.
 */
export function repeatCopyAt(target: EventTarget | null): RepeatCopyHit | null {
  const leaf = target instanceof Element ? target.closest(LEAF_STAMP) : null
  const copyId = leaf?.getAttribute('data-aglyn')?.slice('leaf:'.length)
  if (!copyId?.startsWith(REPEAT_NODE_ID_PREFIX)) return null
  const original = canvas.getNode(repeatTemplateIdOf(copyId))
  return original ? { original, copyId } : null
}

/** A copy the canvas outlines in place of the element it draws. */
export interface RepeatCopyStandIn {
  /** The element hovered or selected. */
  nodeId: string
  /** The copy of it the pointer is on, or was on when it was clicked. */
  copyId: string
}

/**
 * Which copy the canvas outlines for the hovered and the selected element
 * (AGL-3111).
 *
 * Pointing at or clicking a copy hovers or selects the element it draws, so
 * an edit changes the element and every copy with it — but the outline goes
 * where the pointer is: round that copy, exactly, and nothing else. It used
 * to go round the element, or round the element and all its copies at once,
 * and either way the box was somewhere other than the thing just clicked.
 *
 * Kept by the copy's id rather than its element, since the copies are drawn
 * again whenever what they repeat is edited; and by the element's id with it.
 * A stand-in is dropped the moment the hover or the selection moves to
 * another element, however it moves — the hierarchy, the breadcrumbs, a
 * shortcut — so coming back to the element later outlines the element, not
 * a copy clicked some time before.
 */
class RepeatCopyStandIns {
  hovered?: RepeatCopyStandIn = undefined
  selected?: RepeatCopyStandIn = undefined

  constructor() {
    makeAutoObservable(this, {
      hovered: observableRef,
      selected: observableRef,
    })
    reaction(
      () => Besigner.focus.getHovered()?.$id,
      (id) => this.forgetUnless('hovered', id),
    )
    reaction(
      () => Besigner.focus.getLastSelected()?.$id,
      (id) => this.forgetUnless('selected', id),
    )
  }

  private forgetUnless(variant: 'hovered' | 'selected', nodeId?: string) {
    if (this[variant] && this[variant]?.nodeId !== nodeId) {
      this[variant] = undefined
    }
  }

  /** Records the copy a hover or a selection was made on, or clears it. */
  set(variant: 'hovered' | 'selected', hit: RepeatCopyHit | null) {
    const current = this[variant]
    // Every mouseover lands here; one that changes nothing must not
    // re-render the overlay reading it.
    if (
      current?.nodeId === hit?.original.$id &&
      current?.copyId === hit?.copyId
    ) {
      return
    }
    this[variant] = hit
      ? { nodeId: hit.original.$id, copyId: hit.copyId }
      : undefined
  }

  /** The copy to outline for `nodeId`, if the hover or selection was made on one. */
  copyIdFor(variant: 'hovered' | 'selected', nodeId: string | undefined) {
    const standIn = this[variant]
    return nodeId && standIn?.nodeId === nodeId ? standIn.copyId : undefined
  }
}

export const repeatCopyStandIns = new RepeatCopyStandIns()

/** The drawn copy `copyId`, in the canvas `element` lives in, or null. */
export function repeatCopyElementIn(
  element: Element,
  copyId: string,
): Element | null {
  const root = element.getRootNode() as ParentNode | null
  if (!root?.querySelector) return null
  const escaped =
    typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(copyId) : copyId
  return root.querySelector(`[data-aglyn="leaf:${escaped}"]`)
}
