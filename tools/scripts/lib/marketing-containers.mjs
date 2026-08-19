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
 * The container-width detector, split out of `audit-marketing-containers.mjs`
 * so it can be tested without Firestore (AGL-1296).
 *
 * The audit's whole input is authored node data on host `DXnRbPH4CQ`, and it
 * printed a census and exited 0 — so nothing it found could ever fail a run,
 * and the claim that `/pricing` is on stock breakpoints lived in a COMMENT
 * (`container.spec.tsx`) rather than in an assertion. That is the same shape
 * as the issue it was auditing: AGL-1296's "fix" was a one-shot Firestore
 * mutation script, since deleted, whose bespoke `sx` 1328px cap AGL-1298 then
 * banned outright. The standard is `props.maxWidth` on prebuilt breakpoints,
 * never a pixel cap — and until this, nothing measured whether that held.
 *
 * Pure over a decoded node map on purpose: the corpus needs credentials, the
 * DETECTOR does not, and a detector whose failure path has never run is not
 * evidence (AGL-2021).
 */

/** MUI's prebuilt Container widths, plus `false` for "do not constrain". */
export const STOCK_MAX_WIDTHS = new Set(['xs', 'sm', 'md', 'lg', 'xl', false])

export const CONTAINER_COMPONENT_ID = 'muiContainer'

/**
 * Bands that are components in their own right rather than page sections.
 * A `layoutSlot` is where the screen's own content lands, and the ecommerce
 * and email blocks render their own layout — none of them is a section an
 * author wraps.
 */
export const NOT_A_SECTION = new Set([
  'layoutSlot',
  'emailSection',
  'cart',
  'customer-account',
  'product-grid',
])

/** The nearest Container in a band's subtree, by depth, or `null`. */
export function containerDepth(node, nodes, depth = 0) {
  if (!node) return null
  if (node.componentId === CONTAINER_COMPONENT_ID) return depth
  for (const childId of node.nodes ?? []) {
    const found = containerDepth(nodes[childId], nodes, depth + 1)
    if (found !== null) return found
  }
  return null
}

/**
 * Censuses one decoded node map.
 *
 * `bespoke` and `nonStock` are the two ways the AGL-1298 standard gets broken,
 * and they are reported separately because they arrive by different routes: an
 * `sx` cap is something an author writes into the style field, while a
 * non-stock `props.maxWidth` cannot come from the attribute dropdown at all —
 * it means an import, an API write or a pasted node map got there instead.
 *
 * @param {Record<string, any>} nodes decoded node map
 * @param {Record<string, unknown>} where context merged into every finding
 */
export function auditContainerNodes(nodes, where = {}) {
  const widths = {}
  const bespoke = []
  const nonStock = []
  const uncontained = []
  let sections = 0

  for (const [nodeId, node] of Object.entries(nodes)) {
    if (node?.componentId !== CONTAINER_COMPONENT_ID) continue
    const width = node.props?.maxWidth
    const key = width === undefined ? '(missing)' : JSON.stringify(width)
    widths[key] = (widths[key] ?? 0) + 1
    // A Container's width belongs in its attribute. An `sx` cap is a bespoke
    // number by construction — it cannot be one of MUI's stock widths.
    const sxWidth = node.sx?.maxWidth ?? node.props?.sx?.maxWidth
    if (sxWidth !== undefined) {
      bespoke.push({ ...where, nodeId, sx: sxWidth, props: width ?? null })
    }
    // `undefined` is not a violation: an unset attribute renders at MUI's own
    // default, which is a prebuilt width like any other. A VALUE that is not
    // one of the six is.
    if (width !== undefined && !STOCK_MAX_WIDTHS.has(width)) {
      nonStock.push({ ...where, nodeId, props: width })
    }
  }

  const root = Object.values(nodes).find((node) => !node?.parentId)
  for (const bandId of root?.nodes ?? []) {
    const band = nodes[bandId]
    if (!band) continue
    // A reusable instance delegates its structure to a component document,
    // which this same sweep audits directly.
    if (band.componentId === 'reusableInstance') continue
    if (NOT_A_SECTION.has(band.componentId)) continue
    sections += 1
    if (containerDepth(band, nodes) === null) {
      uncontained.push({
        ...where,
        nodeId: bandId,
        componentId: band.componentId,
        label: band.props?.ariaLabel ?? band.props?.element ?? null,
        blocks: (band.nodes ?? []).length,
      })
    }
  }

  return { widths, bespoke, nonStock, uncontained, sections }
}
