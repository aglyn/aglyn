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
 * Lazy mounting (AGL-1283) already stops a Tabs container rendering anything
 * but the selected panel. The document did not follow: every panel's nodes were
 * still serialized into the page. On `/pricing` that is 1,489 of 2,523 nodes —
 * eight copies of a 50-row table — and the RSC payload is 63% of the page's
 * gzipped weight, so the render knowing they are unneeded was worth nothing.
 *
 * This prunes them server-side. The panel node stays (its tab, its aria wiring
 * and its `label` are all still needed); only its subtree is withheld, and the
 * panel is marked so the client can fetch the rest when the reader first opens
 * one.
 *
 * Lazy is the DEFAULT (AGL-1283 option 3), so this prunes every multi-panel
 * Tabs unless the author set `ssrPanels` — the same predicate the client
 * mount uses (`tabs.tsx`), and the two MUST agree: a panel this function
 * withholds that the client would render arrives empty, and a panel it ships
 * that the client defers is payload for nothing. The legacy `lazyPanels`
 * opt-in is subsumed by the default and no longer consulted.
 *
 * SEO note: withheld content is not in the HTML. Where a panel holds content
 * that appears nowhere else on the page and must reach crawlers, `ssrPanels`
 * is the escape hatch — it keeps the panels in the payload AND in the markup.
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

/**
 * The label the strip opens on, which is NOT always the first one: a tab
 * carrying a screen link navigates instead of revealing a panel, so a
 * navigation row lands on the first tab WITHOUT a link (AGL-1312 — the row
 * is placed on each screen it names, and there the tab for that screen is
 * the unlinked one). Every tab linked means no panel is really open, and
 * the client falls back to the first label; this must too, or it withholds
 * the one panel the reader is looking at.
 *
 * Duplicated from the mui plugin's prop names for the same reason
 * `parseLabels` is: tenant-runtime must not depend on a plugin bundle.
 */
function landingLabel(props: Record<string, any>): string | undefined {
  const labels = parseLabels(props?.labels)
  const index = labels.findIndex(
    (_label, position) => !props?.[`tabLink${position + 1}`],
  )
  return labels[index < 0 ? 0 : index]
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
    // Defer by default; `ssrPanels` is the author's SEO escape hatch
    // (AGL-1283 option 3). Must match the client-side mount predicate.
    if (node?.props?.ssrPanels) continue

    const labels = parseLabels(node.props.labels)
    const panelIds: string[] = (node.nodes ?? []).filter(
      (childId: string) => nodes[childId]?.componentId === TAB_PANEL_ID,
    )
    if (!labels.length || panelIds.length < 2) continue

    // The landing panel is the one matching the landing LABEL, not the first
    // child: panels can be reordered in the hierarchy independently of the
    // label list, and pruning the panel that is actually open would leave the
    // reader looking at an empty tab. If no panel matches, defer NOTHING —
    // a mislabelled set is exactly when guessing is most expensive.
    const landing = panelIds.find((panelId) =>
      labelsMatch(nodes[panelId]?.props?.label, landingLabel(node.props)),
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
