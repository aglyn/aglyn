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

/**
 * The repeater whose children are cloned once per published entry
 * (`collectionEntries`). It is named here because it is what turns ONE
 * authored node into a finding the reader meets ten times (AGL-2366).
 */
export const ENTRIES_COMPONENT_ID = 'collectionEntries'

/**
 * The nearest Container ANCESTOR of `nodeId`, walking `parentId` up, or
 * `null` (AGL-2366).
 *
 * A Container inside a Container takes a second set of 24px gutters, so its
 * content starts 24px right of every other section on the page. That is not
 * a width the width census could see: both nodes are stock `xl`, both pass
 * every rule this file had, and the page is still misaligned — the defect is
 * the RELATIONSHIP, not either node's attribute.
 *
 * Walks parents rather than recursing down like {@link containerDepth},
 * because the question is "does an ancestor already gutter me?" and the
 * answer has to name the ancestor. `seen` guards a `parentId` cycle: this
 * reads authored data, and a corrupt map must not hang the audit.
 */
export function containerAncestor(nodeId, nodes) {
  const seen = new Set([nodeId])
  const through = []
  let parentId = nodes[nodeId]?.parentId
  while (parentId && nodes[parentId] && !seen.has(parentId)) {
    seen.add(parentId)
    const parent = nodes[parentId]
    if (parent.componentId === CONTAINER_COMPONENT_ID) {
      return { ancestorId: parentId, through: through.reverse() }
    }
    through.push(parent.componentId)
    parentId = parent.parentId
  }
  return null
}

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
 * `nested` is the third, and it is invisible to the other two (AGL-2366). Both
 * nodes are stock `xl`; the misalignment comes from one sitting INSIDE the
 * other and taking a second set of gutters. A census that only ever looked at
 * one node at a time reported the changelog and newsroom lists clean while
 * every entry on them rendered 24px right of the heading above it.
 *
 * @param {Record<string, any>} nodes decoded node map
 * @param {Record<string, unknown>} where context merged into every finding
 */
export function auditContainerNodes(nodes, where = {}) {
  const widths = {}
  const bespoke = []
  const nonStock = []
  const nested = []
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
    // Double gutters (AGL-2366). Reported with the path between the two, so
    // the finding says WHERE to unwrap — and with `repeats` when a
    // `collectionEntries` is on that path, because then the one authored node
    // is rendered once per published entry and the inset walks down the page.
    const outer = containerAncestor(nodeId, nodes)
    if (outer) {
      nested.push({
        ...where,
        nodeId,
        ancestorId: outer.ancestorId,
        through: outer.through,
        repeats: outer.through.includes(ENTRIES_COMPONENT_ID),
      })
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

  return { widths, bespoke, nonStock, nested, uncontained, sections }
}
