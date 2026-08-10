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
import { Bytes } from 'firebase/firestore'

/**
 * Publish-time binding-token normalization over a version's stored `nodes`,
 * in whichever storage form they arrived in (AGL-1397).
 *
 * `rewriteBindingTokensDeep` needs a node TREE. A version's `nodes` is stored
 * in two live forms — a plain Firestore map, and msgpack bytes, which the
 * client SDK materialises as a `Bytes` — and the compressed one is what the
 * besigner writes, so it is the majority. Handed a `Bytes` the rewrite finds
 * no `{{` strings anywhere inside it and reports `changed: false`: no
 * corruption, but AGL-188's normalization silently never ran for any
 * besigner-saved screen or layout. That was the whole point of the block.
 *
 * The write shape is the other half, and the more dangerous one. Writing the
 * decoded map straight back through `updateDoc` bypasses the converter and
 * would quietly convert the document to the plain form — a working document,
 * but one that no longer matches what the besigner writes, several times
 * larger at rest, and a silent migration nobody asked for. So the value comes
 * back in the form it went out in.
 *
 * Identity is what tells the two apart: `decodeStoredNodes` returns the SAME
 * object for a plain map and a NEW one for anything it had to decode.
 *
 * Returns `null` when there is nothing to rewrite — absent nodes, or nodes
 * that would not decode (which is already logged, and must not read as "no
 * tokens to fix" and then be written back).
 */
export function rewriteStoredBindingTokens(
  raw: unknown,
  variables: Record<string, Aglyn.BindingDocRef>,
  functions: Record<string, Aglyn.BindingDocRef>,
): { value: unknown; changed: boolean } | null {
  const nodes = Aglyn.decodeStoredNodes(raw)
  if (!nodes) return null
  const { value, changed } = Aglyn.rewriteBindingTokensDeep(
    nodes,
    variables,
    functions,
  )
  if (!changed) return { value: raw, changed: false }
  return {
    value:
      nodes === raw ? value : Bytes.fromUint8Array(Aglyn.compress(value)),
    changed: true,
  }
}

export default rewriteStoredBindingTokens
