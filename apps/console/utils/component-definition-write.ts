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
  canvasTreeToDefinition,
  decodeStoredNodes,
  definitionToCanvasTree,
  type ReusableComponentProp,
} from '@aglyn/aglyn'

/** What publishing a component writes onto its parent document. */
export interface ComponentDefinitionWrite {
  /** The definition's tree, with the besigner's synthetic canvas root removed. */
  nodes: Record<string, unknown>
  rootId?: string
  props: ReusableComponentProp[]
}

/** A publish that must not happen, and the sentence that says why. */
export interface ComponentDefinitionRefusal {
  refusal: string
}

/**
 * Whether this answer is the refusal. A guard rather than a literal `ok`
 * field: the console compiles without `strictNullChecks`, where a truthiness
 * test on a boolean discriminant does not narrow the union.
 */
export function isComponentDefinitionRefusal(
  result: ComponentDefinitionWrite | ComponentDefinitionRefusal,
): result is ComponentDefinitionRefusal {
  return typeof (result as ComponentDefinitionRefusal).refusal === 'string'
}

/**
 * WHAT A COMPONENT PUBLISH WRITES, OR WHY IT MUST NOT (AGL-2878).
 *
 * A reusable component renders from its PARENT document: `getComponents`
 * reads `components/{id}` — `nodes`, `rootId`, `props` — for every component
 * in one query and never opens a version. So publishing a component is not
 * moving a pointer, it is writing the definition every page grafts. There are
 * two ways to do it, the besigner's Save & publish and Publish on a row of
 * the Versions dialog, and they resolve the definition here so that neither
 * can write a shape the other would not.
 *
 * Takes the tree in any form it is found in: the canvas (wrapped in the
 * synthetic `_@_` root), a version the besigner saved (the same, compressed),
 * or a version minted straight from a promoted definition (unwrapped). The
 * wrapper never reaches the parent — the tenant grafts from `rootId`, and a
 * published wrapper would put an empty container inside every instance
 * (AGL-680).
 */
export function resolveComponentDefinition(input: {
  /** The tree, in any stored or canvas form. */
  nodes: unknown
  /** The root recorded beside it, used when the tree does not name its own. */
  rootId?: string | null
  /** Declared properties; they publish with the tree (AGL-1247). */
  props?: ReusableComponentProp[] | null
}): ComponentDefinitionWrite | ComponentDefinitionRefusal {
  const decoded = decodeStoredNodes<Record<string, unknown>>(input.nodes)
  if (!decoded || !Object.keys(decoded).length) {
    return {
      refusal:
        'That version holds no design. Open it in the besigner and save ' +
        'once before publishing it.',
    }
  }
  const definition = canvasTreeToDefinition(
    definitionToCanvasTree({
      rootId: input.rootId ?? undefined,
      nodes: decoded,
    }),
  )
  if (definition.ambiguousRoot) {
    return {
      refusal:
        'A component needs a single top-level element. Wrap what you have ' +
        'in one container, then publish.',
    }
  }
  const rootId = definition.rootId ?? input.rootId ?? undefined
  return {
    nodes: definition.nodes,
    ...(rootId ? { rootId } : {}),
    // An empty list, never absent: props left behind from an earlier publish
    // would resolve `{{prop.*}}` tokens this tree no longer declares.
    props: input.props ?? [],
  }
}

export default resolveComponentDefinition
