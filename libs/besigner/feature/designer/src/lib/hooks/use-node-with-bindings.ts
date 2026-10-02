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
  displayBindingTokens,
  hasBindings,
  type HostFunction,
  type HostVariable,
  resolveBindings,
} from '@aglyn/aglyn'
import { useContext, useMemo } from 'react'
import BindingPickerContext from '../contexts/binding-picker-context'
import useAglynBesignerFlag from './use-aglyn-besigner-flag'

/**
 * One node's render copy with its `{{var:…}}` and `{{fn:…}}` tokens filled in
 * from the site's variables and functions (AGL-3480).
 *
 * Every string prop goes through `resolveBindings`, the function the published
 * page composes its whole tree with (`resolveNodesBindings`), so a token draws
 * here as exactly what a visitor reads. `showTokens` is the raw-token view:
 * id tokens draw as the referent's current name instead, through
 * `displayBindingTokens`, as the editable canvas draws them.
 *
 * Answers `node` itself when the site has no variables or functions to read,
 * and when no prop holds a token. A copy only: the node keeps its tokens.
 */
export function resolveNodeBindings<N>(
  node: N,
  variables: Record<string, HostVariable> | undefined,
  functions: Record<string, HostFunction> | undefined,
  showTokens = false,
): N {
  const props = (node as { props?: Record<string, unknown> } | undefined)
    ?.props
  if (!props) return node
  if (
    !Object.keys(variables ?? {}).length &&
    !Object.keys(functions ?? {}).length
  ) {
    return node
  }
  let resolved: Record<string, unknown> | undefined
  for (const [key, value] of Object.entries(props)) {
    if (typeof value !== 'string' || !hasBindings(value)) continue
    resolved ??= { ...props }
    resolved[key] = showTokens
      ? displayBindingTokens(value, variables as never, functions as never)
      : resolveBindings(value, variables ?? {}, functions ?? {})
  }
  return resolved ? ({ ...node, props: resolved } as N) : node
}

/**
 * {@link resolveNodeBindings} for a leaf the canvas draws but does not edit —
 * the layout chrome around a page, a component instance's definition, a
 * placed form's design — against the variables and functions the console
 * hands the binding picker, and the WYSIWYG bindings toggle.
 *
 * The editable canvas's `NodeLeaf` resolves the same tokens from the same
 * context. Without this, a page's Besigner drew its layout's phone number as
 * `{{var:…}}` while the layout's own Besigner, and the published page, drew
 * the number.
 */
export function useNodeWithBindings<N>(node: N): N {
  const [resolveFlag] = useAglynBesignerFlag('resolveBindings')
  const { variables, functions } = useContext(BindingPickerContext)
  const showTokens = resolveFlag === false
  return useMemo(
    () => resolveNodeBindings(node, variables, functions, showTokens),
    [node, variables, functions, showTokens],
  )
}

export default useNodeWithBindings
