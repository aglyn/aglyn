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
import { bindingTokenNeedsDeep, rewriteBindingTokensDeep } from '@aglyn/aglyn'

/**
 * The site's variables and functions, as typed-name normalization reads them:
 * keyed by NAME, each carrying its document id as `$id` (id keys beside them
 * are harmless — an id-form token is already what normalization writes).
 */
export interface CanvasBindingLookups {
  variables?: Record<string, Aglyn.BindingDocRef>
  functions?: Record<string, Aglyn.BindingDocRef>
}

/** The part of a canvas this pass reads and writes. */
type NormalizableCanvas = Pick<
  Aglyn.CanvasManager,
  'toJSON' | 'getNode' | 'batch' | 'updateNodeProps'
>

/**
 * Rewrites every typed `{{name}}` and `{{fn:name(…)}}` on the canvas to its
 * rename-safe id form (AGL-3481), as ONE undoable step, and answers how many
 * elements it rewrote.
 *
 * A published page resolves only the id form, so a name token that reaches
 * the store as typed draws on the live page as `{{phone}}`. The Attributes
 * panel converts a field as it commits, but text reaches the canvas by other
 * routes too — Raw JSON, Edit JSON, typing on the canvas, a paste, an AI edit
 * — and none of them did. Running this where the document is saved covers
 * every one of them, and any added later.
 *
 * The CANVAS is rewritten, not the map about to be written. The editor
 * decides "saved" by comparing the two, so writing a rewritten copy would
 * leave the canvas holding the name forms, reading dirty against a document
 * that never contains them, and offering Save forever.
 *
 * Unknown names stay as typed: the variable may be created later. Only
 * `props` is walked — that is where a binding is resolved on the published
 * page — and `bindingTokenNeedsDeep` keeps the common save, whose tokens are
 * all id-form already, from walking anything twice.
 */
export function normalizeCanvasBindingTokens(
  target: NormalizableCanvas,
  lookups: CanvasBindingLookups | null | undefined,
): number {
  if (!lookups) return 0
  const nodes = target.toJSON().nodes as Record<
    string,
    { props?: Record<string, unknown> } | undefined
  >
  const needs = bindingTokenNeedsDeep(nodes)
  if (!needs.variables && !needs.functions) return 0
  const rewrites: Array<[string, Record<string, unknown>]> = []
  for (const [id, node] of Object.entries(nodes)) {
    if (!node?.props) continue
    const { value, changed } = rewriteBindingTokensDeep(
      node.props,
      lookups.variables,
      lookups.functions,
    )
    if (changed) rewrites.push([id, value])
  }
  if (!rewrites.length) return 0
  target.batch(() => {
    for (const [id, props] of rewrites) {
      const live = target.getNode(id)
      if (live) target.updateNodeProps(live, props)
    }
  })
  return rewrites.length
}

export default normalizeCanvasBindingTokens
