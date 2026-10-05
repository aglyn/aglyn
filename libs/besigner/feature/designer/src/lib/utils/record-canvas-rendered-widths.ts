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
import {
  mergeRenderedWidths,
  RENDERED_WIDTHS_PROP,
  recordedRenderedWidthNodeIds,
  recordedRenderedWidths,
  type RenderedWidths,
} from '@aglyn/aglyn'

/** The part of a canvas this pass reads and writes. */
type RecordableCanvas = Pick<
  Aglyn.CanvasManager,
  'toJSON' | 'getNode' | 'batch' | 'updateNodeProps'
>

/** Where the measurements come from; the registry unless a test says otherwise. */
export interface RenderedWidthSource {
  nodeIds(): string[]
  widthsFor(nodeId: string): RenderedWidths
}

const registrySource: RenderedWidthSource = {
  nodeIds: recordedRenderedWidthNodeIds,
  widthsFor: recordedRenderedWidths,
}

/**
 * Writes what the canvas measured onto the nodes that measured it (AGL-3485),
 * as ONE undoable step, and answers how many it rewrote.
 *
 * An element that wants its rendered width remembered — the Image element, so
 * a published page can say how big each picture will be — records its width
 * per breakpoint band while it is on the canvas (`rendered-widths.ts`). This
 * is where that becomes part of the document: run where the document is
 * saved, beside `normalizeCanvasBindingTokens` and for the same reason — the
 * CANVAS is rewritten, not the map about to be written, so the editor reads
 * clean against what it stored.
 *
 * Only a band that moved by more than the tolerance is rewritten, and a node
 * whose measurements did not move is not touched at all, so a save on an
 * untouched page writes nothing it did not write last time. Bands this
 * session did not see keep what an earlier one measured.
 *
 * A recording for a node the canvas does not hold — a layout's logo seen
 * from the screen editor, an element inside a reusable component — is
 * ignored: it belongs to a document this editor is not saving.
 */
export function recordCanvasRenderedWidths(
  target: RecordableCanvas,
  source: RenderedWidthSource = registrySource,
): number {
  const ids = source.nodeIds()
  if (!ids.length) return 0
  // Plain copies to build the new props from; the live node is what is
  // written to, as `normalizeCanvasBindingTokens` does.
  const nodes = target.toJSON().nodes as Record<
    string,
    { props?: Record<string, unknown> } | undefined
  >
  const rewrites: Array<[Aglyn.NodeSchema, Record<string, unknown>]> = []
  for (const nodeId of ids) {
    const node = target.getNode(nodeId)
    if (!node) continue
    const props = nodes[nodeId]?.props ?? {}
    const merged = mergeRenderedWidths(
      props[RENDERED_WIDTHS_PROP],
      source.widthsFor(nodeId),
    )
    if (!merged) continue
    rewrites.push([node, { ...props, [RENDERED_WIDTHS_PROP]: merged }])
  }
  if (!rewrites.length) return 0
  target.batch(() => {
    for (const [node, props] of rewrites) target.updateNodeProps(node, props)
  })
  return rewrites.length
}

export default recordCanvasRenderedWidths
