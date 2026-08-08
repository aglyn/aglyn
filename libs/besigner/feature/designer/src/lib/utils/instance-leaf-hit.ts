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
 * The `data-aglyn="leaf:<nodeId>"` stamp the node renderer's `Leaf` puts on
 * every element it renders — the only identity the INERT instance preview
 * carries, since its nodes are never in the canvas (AGL-1251).
 */
const LEAF_STAMP_PREFIX = 'leaf:'

/** A grafted preview leaf under the double-clicked point (AGL-1304). */
export interface InstanceLeafElementHit {
  /** Grafted node id (`cmp__{instanceId}__{defId}`) parsed off the stamp. */
  graftedId: string
  /** The rendered element, for anchoring the inline editor's overlay. */
  element: Element
}

/**
 * Geometric hit-test into an instance's rendered component preview
 * (AGL-1304): the deepest grafted leaf whose bounding rect contains the
 * viewport point `(x, y)`, or `null` when the point misses the preview.
 *
 * Geometry, not `elementFromPoint`, out of necessity: `NodeLeaf` renders
 * the preview under `pointer-events: none` so every click selects the
 * instance, and hit-testing APIs skip such elements entirely — the
 * double-click's coordinates are all that ever reaches us.
 *
 * "Deepest" among overlapping candidates: a descendant beats its ancestors,
 * and between unrelated overlapping leaves the later one in document order
 * wins (paint order, near enough for a double-click).
 */
export function findInstanceLeafAtPoint(
  container: Element,
  x: number,
  y: number,
): InstanceLeafElementHit | null {
  const candidates = container.querySelectorAll(
    `[data-aglyn-component-preview] [data-aglyn^="${LEAF_STAMP_PREFIX}"]`,
  )
  let best: Element | null = null
  for (const candidate of Array.from(candidates)) {
    const rect = candidate.getBoundingClientRect()
    const contains =
      rect.width > 0 &&
      rect.height > 0 &&
      x >= rect.left &&
      x <= rect.right &&
      y >= rect.top &&
      y <= rect.bottom
    if (!contains) continue
    // Keep the candidate unless it is an ANCESTOR of the current best —
    // descendants refine the hit, later unrelated leaves paint on top.
    if (!best || !candidate.contains(best)) best = candidate
  }
  if (!best) return null
  const stamp = best.getAttribute('data-aglyn') ?? ''
  const graftedId = stamp.slice(LEAF_STAMP_PREFIX.length)
  return graftedId ? { graftedId, element: best } : null
}

export default findInstanceLeafAtPoint
