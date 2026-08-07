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
 * Withholds the node definitions inside lazy tab panels that will not mount on
 * first render (AGL-1285).
 *
 * `lazyPanels` (AGL-1283) already stops a Tabs container rendering anything but
 * the selected panel. The document did not follow: every panel's nodes were
 * still serialized into the page. On `/pricing` that is 1,489 of 2,523 nodes —
 * eight copies of a 50-row table — and the RSC payload is 63% of the page's
 * gzipped weight, so the render knowing they are unneeded was worth nothing.
 *
 * This prunes them server-side. The panel node stays (its tab, its aria wiring
 * and its `label` are all still needed); only its subtree is withheld, and the
 * panel is marked so the client can fetch the rest when the reader first opens
 * one.
 *
 * SEO note: withheld content is not in the HTML. That is only safe where the
 * same information is reachable another way — on `/pricing`, the wide compare
 * table that desktop renders carries the same figures. The `lazyPanels` prop
 * carries the same warning; this function is the half that makes it bite.
 */

/** Marks a panel whose children were withheld. */
export const DEFERRED_PANEL_PROP = 'aglynDeferred'

const TABS_ID = 'muiTabs'
const TAB_PANEL_ID = 'muiTabPanel'

export interface DeferLazyPanelsResult {
  /** A NEW node map; the input is never mutated. */
  nodes: Record<string, any>
  /** Panel node ids whose children were withheld. */
  deferredPanelIds: string[]
  /** Node definitions removed. */
  removed: number
}

/**
 * Label parsing is duplicated from the mui plugin's `parseLabels` rather than
 * imported: tenant-runtime must not depend on a plugin bundle (module
 * boundaries), and this needs to agree with it exactly or the wrong panel gets
 * pruned. `defer-lazy-panels.spec.ts` pins the cases that matter.
 */
function parseLabels(value: unknown): string[] {
  if (value == null) return []
  return String(value)
    .split(/[\n,]/)
    .map((label) => label.trim())
    .filter(Boolean)
}

const labelsMatch = (a: unknown, b: unknown): boolean =>
  String(a ?? '')
    .trim()
    .toLowerCase() ===
  String(b ?? '')
    .trim()
    .toLowerCase()

/** Every descendant id of `id`, excluding `id` itself. */
function descendantsOf(nodes: Record<string, any>, id: string): string[] {
  const out: string[] = []
  const stack = [...(nodes[id]?.nodes ?? [])]
  while (stack.length) {
    const next = stack.pop()
    if (typeof next !== 'string' || !nodes[next]) continue
    out.push(next)
    stack.push(...(nodes[next].nodes ?? []))
  }
  return out
}

export function deferLazyPanelNodes(
  nodes: Record<string, any> | null | undefined,
): DeferLazyPanelsResult {
  if (!nodes) return { nodes: nodes as any, deferredPanelIds: [], removed: 0 }

  const drop = new Set<string>()
  const deferredPanelIds: string[] = []

  for (const [id, node] of Object.entries(nodes)) {
    if (node?.componentId !== TABS_ID) continue
    if (!node?.props?.lazyPanels) continue

    const labels = parseLabels(node.props.labels)
    const panelIds: string[] = (node.nodes ?? []).filter(
      (childId: string) => nodes[childId]?.componentId === TAB_PANEL_ID,
    )
    if (!labels.length || panelIds.length < 2) continue

    // The landing panel is the one matching the FIRST label, not the first
    // child: panels can be reordered in the hierarchy independently of the
    // label list, and pruning the panel that is actually open would leave the
    // reader looking at an empty tab. If no panel matches, defer NOTHING —
    // a mislabelled set is exactly when guessing is most expensive.
    const landing = panelIds.find((panelId) =>
      labelsMatch(nodes[panelId]?.props?.label, labels[0]),
    )
    if (!landing) continue

    for (const panelId of panelIds) {
      if (panelId === landing) continue
      const kids = descendantsOf(nodes, panelId)
      if (!kids.length) continue
      kids.forEach((kid) => drop.add(kid))
      deferredPanelIds.push(panelId)
    }
  }

  if (!drop.size) return { nodes, deferredPanelIds: [], removed: 0 }

  // Rebuild rather than mutate: the composed document is CACHED
  // (`loadPageDataCached`), so mutating it would poison every later request
  // for this screen with a permanently half-empty page.
  const deferred = new Set(deferredPanelIds)
  const out: Record<string, any> = {}
  for (const [id, node] of Object.entries(nodes)) {
    if (drop.has(id)) continue
    out[id] = deferred.has(id)
      ? {
          ...node,
          nodes: [],
          props: { ...(node.props ?? {}), [DEFERRED_PANEL_PROP]: true },
        }
      : node
  }
  return { nodes: out, deferredPanelIds, removed: drop.size }
}
