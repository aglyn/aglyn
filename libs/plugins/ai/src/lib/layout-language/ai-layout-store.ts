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

import type { NodesMap } from '@aglyn/aglyn/types/nodes'
import {
  validateAiNodeTree,
  type AiNodeTreeContext,
} from '../runtime/ai-node-tree'
import type { AiSurface } from '../runtime/ai-palette'
import type { AiLayoutRawTree } from './ai-layout-tree'

/**
 * A compiled tree as a document stores it (AGL-3660): read by the same
 * palette validator every generated tree passes, as a code-built tree, so
 * what is stored is exactly what any other generated document would store.
 * The validator mints fresh ids; the ids a caller names (a page's section
 * roots, which its plan minted) keep their own, and the interactions code
 * wrote — which the validator strips from anything it stores — are carried
 * over onto the stored nodes.
 */

export type AiLayoutStored =
  | {
      ok: true
      nodes: NodesMap
      rootId: string
      repairs: string[]
      /** Each compiled id → the id its node is stored under, for a node the validator kept. */
      storedIds: Record<string, string>
    }
  | { ok: false; error: string }

type StoredNode = Record<string, unknown> & {
  $id: string
  parentId: string | null
  nodes?: string[]
}

export function aiLayoutStoredTree(
  compiled: AiLayoutRawTree,
  surface: AiSurface,
  context: AiNodeTreeContext,
  keepIds: readonly string[] = [],
): AiLayoutStored {
  // The interactions are code's, carried over below; the validator is shown the rest.
  const bare = {
    rootId: compiled.rootId,
    nodes: Object.fromEntries(
      Object.entries(compiled.nodes).map(
        ([id, { interactions: _interactions, ...node }]) => [id, node],
      ),
    ),
  }
  const validated = validateAiNodeTree(bare, surface, {
    ...context,
    codeBuilt: true,
  })
  if (validated.ok === false) return { ok: false, error: validated.error }
  const keep = new Set(keepIds)
  // Minted → the id it is stored under: its own, or the one the caller keeps.
  const storedId = (minted: string): string => {
    const source = validated.sourceIds[minted]
    return source && keep.has(source) ? source : minted
  }
  const nodes: Record<string, StoredNode> = {}
  for (const [minted, raw] of Object.entries(
    validated.nodes as unknown as Record<string, StoredNode>,
  )) {
    const id = storedId(minted)
    const source = compiled.nodes[validated.sourceIds[minted] ?? '']
    nodes[id] = {
      ...raw,
      $id: id,
      parentId: raw.parentId === null ? null : storedId(raw.parentId),
      ...(Array.isArray(raw.nodes) ? { nodes: raw.nodes.map(storedId) } : {}),
      ...(source?.interactions?.length
        ? { interactions: source.interactions }
        : {}),
    }
  }
  const storedIds: Record<string, string> = {}
  for (const minted of Object.keys(validated.nodes)) {
    const source = validated.sourceIds[minted]
    if (source) storedIds[source] = storedId(minted)
  }
  return {
    ok: true,
    nodes: nodes as unknown as NodesMap,
    rootId: storedId(validated.rootId),
    repairs: validated.repairs,
    storedIds,
  }
}
