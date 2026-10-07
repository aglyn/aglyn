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

/**
 * The node map the layout language compiler writes (AGL-3660), in the shape a
 * model's answer arrives in — `{ rootId, nodes: { id: { componentId, props,
 * sx, nodes } } }` — so the palette validator and the doctrine read it exactly
 * as they read any other tree, and nothing downstream knows code wrote it.
 */

export interface AiLayoutRawNode {
  componentId: string
  props?: Record<string, unknown>
  sx?: Record<string, unknown>
  nodes?: string[]
  /**
   * The platform's interactions, written by code: a link to a section of its
   * page scrolls there (AGL-3097). The palette validator strips every
   * interaction from what it stores, so the page step carries these over
   * onto the stored nodes after it.
   */
  interactions?: unknown[]
}

export interface AiLayoutRawTree {
  rootId: string
  nodes: Record<string, AiLayoutRawNode>
}

/** A node map built in document order, with ids that read in a review: `ll3-heading`. */
export class AiLayoutTreeBuilder {
  readonly nodes: Record<string, AiLayoutRawNode> = {}
  private count = 0

  constructor(private readonly prefix = 'll') {}

  /** A node, with only the props, styles and children it was given; returns its id. */
  add(
    componentId: string,
    props?: Record<string, unknown> | null,
    sx?: Record<string, unknown> | null,
    children?: readonly (string | null | undefined)[] | null,
    role = componentId,
    fixedId?: string,
  ): string {
    this.count += 1
    const id = fixedId ?? `${this.prefix}${this.count}-${role.replace(/[^A-Za-z0-9]/g, '').slice(0, 16)}`
    const node: AiLayoutRawNode = { componentId }
    const kept = props ? Object.fromEntries(Object.entries(props).filter(([, value]) => value !== undefined)) : {}
    if (Object.keys(kept).length) node.props = kept
    if (sx && Object.keys(sx).length) node.sx = { ...sx }
    const list = (children ?? []).filter((child): child is string => typeof child === 'string')
    if (list.length) node.nodes = list
    this.nodes[id] = node
    return id
  }

  /** The tree rooted at `rootId`. */
  tree(rootId: string): AiLayoutRawTree {
    return { rootId, nodes: this.nodes }
  }
}
