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

import { type HostTokenSource, resolveNodesHostTokens } from '@aglyn/aglyn'
import { useContext, useMemo } from 'react'
import CanvasHostTokensContext from '../contexts/canvas-host-tokens-context'

/**
 * One node's render copy with its `{{host.*}}` tokens filled in from `host`
 * (AGL-2881).
 *
 * Through `resolveNodesHostTokens`, handed this node alone: the function the
 * published page composes its whole tree with, so a token draws on the canvas
 * as exactly what a visitor reads — a field the site has not set included,
 * which both draw as nothing.
 *
 * Answers `node` itself when there is no site, and when no prop holds a token.
 * A copy only: the node the canvas selects, edits and saves keeps its tokens.
 */
export function resolveNodeHostTokens<N>(
  node: N,
  host: HostTokenSource | null | undefined,
): N {
  if (!host || !node) return node
  const resolved = resolveNodesHostTokens(
    { node: node as Record<string, unknown> },
    host,
  )
  return (resolved.node ?? node) as N
}

/**
 * {@link resolveNodeHostTokens} for a leaf, against the site the canvas decided
 * on ({@link CanvasHostTokensContext}).
 *
 * The copy is keyed by the node and by `revision`. A canvas node is a MobX
 * observable whose props change in place, so a leaf drawing one passes
 * something that changes with those props; the nodes drawn from a component
 * definition or the layout chrome are rebuilt whole when they change and need
 * nothing more.
 */
export function useNodeWithHostTokens<N>(node: N, revision?: unknown): N {
  const host = useContext(CanvasHostTokensContext)
  return useMemo(
    () => resolveNodeHostTokens(node, host),
    // `revision` carries the in-place prop changes identity cannot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [node, host, revision],
  )
}

export default useNodeWithHostTokens
