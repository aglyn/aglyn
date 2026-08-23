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
import {
  type BoundingClientRect,
  getElementClientRectBounding,
} from './get-element-client-rect-bounding'

export interface ElementFragmentRects {
  /**
   * One box per LINE FRAGMENT, in viewport pixels, in content order.
   *
   * A block has exactly one. An inline run that has wrapped has one per line
   * it occupies, and no single rectangle describes it.
   */
  fragments: BoundingClientRect[]
  /**
   * The union of `fragments` — by definition identical to
   * `getBoundingClientRect()`, which the CSSOM spec defines as the union of
   * `getClientRects()`.
   */
  union: BoundingClientRect
  /**
   * The fragment the run STARTS on, i.e. `fragments[0]`.
   *
   * This is the anchor for anything that must sit at "the element", because
   * the union's top-left can be a point the element does not occupy: an
   * inline run that begins mid-line and wraps has a union whose left edge
   * comes from the SECOND line, so chrome placed there floats over a sibling
   * rather than over the element it names.
   */
  first: BoundingClientRect
}

/**
 * Where an element actually is, as the set of boxes it really occupies
 * (AGL-2486).
 *
 * ## The defect this exists for
 *
 * Zach: *"the element outline doesn't wrap the text on the new line unless
 * you are editing it"*. The besigner drew selection, hover, the drag
 * affordance and the collaborator selection boxes from ONE
 * `getBoundingClientRect()`. For a block that is right. For an inline run
 * that has wrapped it is not merely imprecise — it is a different shape.
 * An inline element is a set of line fragments; its bounding rect is their
 * union, which covers the empty space to the right of a short last line, and
 * — when the run starts mid-line — the whole left gutter of the first line,
 * where a *sibling's* text is. So the outline both fails to wrap what the
 * element is and claims pixels that belong to something else.
 *
 * ## Why per-fragment rather than the union
 *
 * A union box is one element and cheap, and for HOVER it is arguably honest.
 * But selection is a persistent statement about what the panels on the right
 * are editing, and a union box makes that statement about pixels the element
 * does not own. That is the same lie in a smaller form. Per-fragment is what
 * a browser's own selection highlight does, and it is the only shape that is
 * true at every wrap.
 *
 * ## Blocks are not routed through a fragment path
 *
 * The overwhelming majority of canvas nodes are blocks, and their geometry is
 * correct today. When the element yields at most one client rect this returns
 * the union OBJECT ITSELF for `fragments[0]`, `first` and `union` — the same
 * value the old single-rect code produced, from the same call. Blocks do not
 * take a different code path that merely happens to agree; there is nothing
 * for them to disagree with. `get-element-fragment-rects.spec.ts` pins that.
 *
 * ## The shadow boundary and the device preview
 *
 * `getClientRects()` is a LAYOUT query on `Element`, not a tree lookup, so it
 * reads identically for an element inside the canvas's CLOSED shadow root —
 * verified in the running besigner on 2026-08-23, where a wrapped
 * `<aglyn-text>` inside the closed root returned 3 fragments while its
 * `getBoundingClientRect()` returned their union. This is unlike
 * `elementFromPoint`, which retargets to the host because it returns a node
 * from the light tree.
 *
 * Both calls return coordinates in the same viewport space with every
 * ancestor transform already applied, so the artboard's device preview — and
 * any future pan/zoom transform — needs no handling here, exactly as it
 * needed none for the single rect.
 */
export function getElementFragmentRects(
  element: Element | null | undefined,
): ElementFragmentRects {
  const union = getElementClientRectBounding(element as Element)

  const list =
    element && typeof (element as Element).getClientRects === 'function'
      ? (element as Element).getClientRects()
      : null

  // No layout, or a single fragment: the union IS the answer, and it is the
  // very same value the pre-AGL-2486 code drew from. Blocks land here.
  if (!list || list.length <= 1) {
    return { fragments: [union], union, first: union }
  }

  const fragments: BoundingClientRect[] = []
  for (let index = 0; index < list.length; index += 1) {
    const rect = list[index]
    // A wrapped run can report degenerate boxes — a zero-width rect at a soft
    // break, or a zero-height one for a collapsed line. Drawing chrome on
    // those produces a stray hairline next to the real outline, which reads
    // as a second selected thing.
    if (!(rect.width > 0) || !(rect.height > 0)) continue
    fragments.push({
      width: rect.width,
      height: rect.height,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
      x: rect.left,
      y: rect.top,
    })
  }

  if (!fragments.length) return { fragments: [union], union, first: union }

  return { fragments, union, first: fragments[0] }
}

export default getElementFragmentRects
