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

import { AI_LAYOUT_FRAMES, aiLayoutSpans } from './ai-layout-tree'

/**
 * A FRAME WITH NOTHING HOLLOW IN IT (AGL-3735).
 *
 * The live Tidewater Soap Works footer (job S0vnUzhGar, 10/11) had four
 * columns: the brand, "Shop" over the site's pages, "Our shop" over NOTHING,
 * and the store's account and policy links under no heading — the list the
 * design put under "Our shop" was left out, its heading and column stayed,
 * and the grid centered the columns so each sat at its own height.
 *
 * A heading with nothing under it, and a column with nothing but headings,
 * is never published. So, wherever the frame's links change — the compiler,
 * a publish taking out links to pages that were never written, a menu change
 * taking a link out — and once more on what a publish writes:
 *
 *  - in the footer, a column of only a heading followed by a column of only
 *    links with no heading (the Tidewater shape) becomes one column: the
 *    heading over those links;
 *  - then a heading with no content under it is taken out, then a column
 *    holding nothing (or nothing but headings) is, and the columns left
 *    reflow across the row's twelve;
 *  - the footer's rows are top-aligned;
 *  - in the header, a Dropdown Menu left holding no link is taken out.
 *
 * `aiLayoutFrameHollows` is the check: what is still hollow.
 *
 * Pure over a node map (`{ id: { componentId, props, sx, nodes } }`) — the
 * compiler's, a stored version's, or a publish's working copy.
 */

interface HollowNode {
  componentId?: string
  props?: Record<string, unknown>
  sx?: Record<string, unknown>
  nodes?: string[]
  [key: string]: unknown
}

type NodeMap = Record<string, HollowNode>

/** A Typography variant that heads what follows it, never content of its own. */
const HEADING_VARIANTS: ReadonlySet<string> = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'subtitle1', 'subtitle2', 'overline'])
/** The Besigner's Dropdown Menu and Mega Menu. */
const DROPDOWNS: ReadonlySet<string> = new Set(['muiNavMenu', 'muiMegaMenu'])
const LINK = 'muiScreenLink'
/** What a menu's entry may be: a Page Link, or a Link Container holding a name and the line under it (AGL-4108). */
const MENU_LINKS: ReadonlySet<string> = new Set([LINK, 'muiLinkBox'])
/** Frames that hold content without being it: the language's, and a plain element. */
const HOLDERS: ReadonlySet<string> = new Set([...AI_LAYOUT_FRAMES, 'div', 'span', 'muiGrid'])

const renders = (node: HollowNode, element: string) =>
  node.props?.['element'] === element || node.props?.['component'] === element || node.componentId === element

const isHeading = (node: HollowNode | undefined) =>
  !!node && node.componentId === 'muiTypography' && HEADING_VARIANTS.has(String(node.props?.['variant'] ?? ''))

/** What is still hollow in a frame: the node ids, by kind. */
export interface AiLayoutFrameHollows {
  /** Footer grid columns holding nothing, or nothing but headings. */
  footerColumns: string[]
  /** Footer headings with nothing under them. */
  footerHeadings: string[]
  /** Footer rows whose columns are centered against each other rather than top-aligned. */
  footerCenteredRows: string[]
  /** Header Dropdown Menus holding no link. */
  headerMenus: string[]
}

/** A heading-only footer column and the heading-less column of links right after it, which it heads. */
interface HeadingOverLinks {
  heading: string
  links: string
}

function inspect(map: NodeMap): AiLayoutFrameHollows & { rows: string[]; merges: HeadingOverLinks[] } {
  const subtree = (id: string): string[] => {
    const out: string[] = []
    const visit = (at: string) => {
      if (!map[at] || out.includes(at)) return
      out.push(at)
      for (const child of map[at].nodes ?? []) visit(child)
    }
    visit(id)
    return out
  }
  /** The leaves under a node, in document order: what a visitor reads. */
  const leaves = (id: string) =>
    subtree(id).filter((at) => {
      const node = map[at]
      return !(node.nodes ?? []).some((child) => map[child]) && !HOLDERS.has(String(node.componentId))
    })
  const footers = Object.keys(map).filter((id) => renders(map[id], 'footer'))
  const headers = Object.keys(map).filter((id) => map[id].componentId === 'muiAppBar' || renders(map[id], 'header'))

  const footerIds = new Set(footers.flatMap(subtree))
  const rows = [...footerIds].filter((id) => map[id].componentId === 'muiGrid' && map[id].props?.['container'])
  const columns = rows.flatMap((row) => (map[row].nodes ?? []).filter((id) => map[id]?.componentId === 'muiGrid'))
  const footerColumns = columns.filter((id) => leaves(id).every((leaf) => isHeading(map[leaf])))
  // The Tidewater shape: a column of only a heading, then a column of only
  // links with no heading. The links are what the heading heads.
  const merges: HeadingOverLinks[] = []
  for (const row of rows) {
    const inRow = (map[row].nodes ?? []).filter((id) => map[id]?.componentId === 'muiGrid')
    inRow.forEach((id, at) => {
      const next = inRow[at + 1]
      if (!next || !footerColumns.includes(id) || !leaves(id).length) return
      const read = leaves(next)
      if (read.length && read.every((leaf) => map[leaf].componentId === LINK)) merges.push({ heading: id, links: next })
    })
  }
  // A heading is hollow when nothing but headings follow it before the next
  // heading of its own (an overline labels the heading after it, so it
  // reaches one heading further).
  const footerHeadings: string[] = []
  const flows = columns.length ? columns : footers
  for (const flow of flows) {
    if (footerColumns.includes(flow)) continue
    const read = leaves(flow)
    read.forEach((id, at) => {
      if (!isHeading(map[id])) return
      let headingsLeft = map[id].props?.['variant'] === 'overline' ? 2 : 1
      for (const next of read.slice(at + 1)) {
        if (!isHeading(map[next])) return
        if (map[next].props?.['variant'] !== 'overline') headingsLeft -= 1
        if (headingsLeft <= 0) break
      }
      footerHeadings.push(id)
    })
  }
  const footerCenteredRows = rows.filter((id) => map[id].sx?.['alignItems'] === 'center')
  const headerIds = new Set(headers.flatMap(subtree))
  const headerMenus = [...headerIds].filter(
    (id) => DROPDOWNS.has(String(map[id].componentId)) && !subtree(id).some((at) => at !== id && MENU_LINKS.has(String(map[at].componentId))),
  )
  return { footerColumns, footerHeadings, footerCenteredRows, headerMenus, rows, merges }
}

/** What is still hollow in a frame (AGL-3735); every list empty when nothing is. */
export function aiLayoutFrameHollows(nodes: Readonly<Record<string, unknown>>): AiLayoutFrameHollows {
  const { footerColumns, footerHeadings, footerCenteredRows, headerMenus } = inspect(nodes as NodeMap)
  return { footerColumns, footerHeadings, footerCenteredRows, headerMenus }
}

/** Whether a frame has anything hollow in it. */
export function aiLayoutFrameIsHollow(hollows: AiLayoutFrameHollows): boolean {
  return [hollows.footerColumns, hollows.footerHeadings, hollows.footerCenteredRows, hollows.headerMenus].some((ids) => ids.length > 0)
}

/** The sentences a check reports for what is hollow. */
export function aiLayoutFrameHollowsSaid(hollows: AiLayoutFrameHollows): string[] {
  return [
    ...(hollows.footerColumns.length ? [`${hollows.footerColumns.length} footer column(s) hold only a heading or nothing`] : []),
    ...(hollows.footerHeadings.length ? [`${hollows.footerHeadings.length} footer heading(s) have nothing under them`] : []),
    ...(hollows.footerCenteredRows.length ? ['the footer’s columns are centered, not top-aligned'] : []),
    ...(hollows.headerMenus.length ? [`${hollows.headerMenus.length} header dropdown(s) hold no link`] : []),
  ]
}

/**
 * Takes what is hollow out of a frame, IN PLACE (AGL-3735): see the file's
 * comment. Returns whether anything changed. A frame left holding nothing is
 * taken out after it, up to the row, the footer's or the header's own element.
 */
export function aiLayoutRepairFrameHollows(nodes: Record<string, unknown>): boolean {
  const map = nodes as NodeMap
  let changed = false
  const parentOf = (id: string) => Object.keys(map).find((at) => map[at].nodes?.includes(id)) ?? null
  const remove = (id: string) => {
    const tree = (at: string): string[] => [at, ...(map[at]?.nodes ?? []).flatMap(tree)]
    let parent = parentOf(id)
    for (const at of tree(id)) delete map[at]
    // Up the tree: a frame that held only what went is gone with it.
    let child = id
    while (parent && map[parent]) {
      const node = map[parent]
      node.nodes = (node.nodes ?? []).filter((at) => at !== child)
      const empty = !node.nodes.some((at) => map[at])
      const stops = renders(node, 'footer') || renders(node, 'header') || node.componentId === 'muiAppBar' || (node.componentId === 'muiGrid' && node.props?.['container'])
      if (!empty || stops || !HOLDERS.has(String(node.componentId))) break
      child = parent
      parent = parentOf(parent)
      delete map[child]
    }
    changed = true
  }
  for (let pass = 0; pass < 4; pass += 1) {
    const hollows = inspect(map)
    if (!aiLayoutFrameIsHollow(hollows)) break
    for (const id of hollows.footerCenteredRows) {
      map[id].sx = { ...(map[id].sx ?? {}), alignItems: 'flex-start' }
      changed = true
    }
    for (const id of hollows.headerMenus) if (map[id]) remove(id)
    const headed = new Set<string>()
    for (const merge of hollows.merges) {
      if (map[merge.heading] && map[merge.links] && headOver(map, merge)) {
        headed.add(merge.heading)
        changed = true
      }
    }
    for (const id of hollows.footerHeadings) if (map[id]) remove(id)
    for (const id of hollows.footerColumns) if (map[id] && !headed.has(id)) remove(id)
    // Every row that lost a column, however it lost it, reflows.
    for (const row of hollows.rows) if (map[row] && reflow(map, row)) changed = true
  }
  return changed
}

/**
 * A heading-only column takes in the heading-less column of links after it,
 * as one flow (heading, then links), and the links' column goes; whether it
 * changed. The row it leaves one column short reflows after.
 */
function headOver(map: NodeMap, { heading, links }: HeadingOverLinks): boolean {
  const moved = (map[links].nodes ?? []).filter((id) => map[id])
  if (!moved.length) return false
  const own = (map[heading].nodes ?? []).filter((id) => map[id])
  const flow = own.length === 1 && map[own[0]].componentId === 'muiStack' ? own[0] : null
  if (flow) {
    map[flow].nodes = [...(map[flow].nodes ?? []), ...moved]
  } else {
    let id = `${heading}-flow`
    for (let n = 2; map[id]; n += 1) id = `${heading}-flow${n}`
    // The compiler's flow of a column (`compileFlow`): a stack, 2.5 apart.
    map[id] = { componentId: 'muiStack', props: { spacing: '2.5' }, nodes: [...own, ...moved] }
    map[heading].nodes = [id]
  }
  delete map[links]
  for (const node of Object.values(map)) {
    if (node.nodes?.includes(links)) node.nodes = node.nodes.filter((at) => at !== links)
  }
  return true
}

/** The columns a row has left, spread across its twelve as their widths were; whether it changed. */
function reflow(map: NodeMap, row: string): boolean {
  const columns = (map[row].nodes ?? []).filter((id) => map[id]?.componentId === 'muiGrid')
  const md = columns.map((id) => /(?:^|\s)md:(\d+)/.exec(String(map[id].props?.['size'] ?? ''))?.[1])
  if (!columns.length || md.some((span) => !span)) return false
  // A row whose columns fill it, as many as it was drawn for, is as it was drawn.
  const drawnFor = /sm:6/.test(String(map[columns[0]].props?.['size'] ?? '')) ? 4 : 3
  if (md.reduce((sum, span) => sum + Number(span), 0) === 12 && (columns.length >= 4) === (drawnFor === 4)) return false
  const spans = columns.length === 1 ? [12] : aiLayoutSpans(md.map(Number))
  columns.forEach((id, at) => {
    map[id].props = { ...(map[id].props ?? {}), size: `${columns.length >= 4 ? 'xs:12 sm:6' : 'xs:12'} md:${spans[at]}` }
  })
  // The compiler's row spacing for that many columns (`compileRow`).
  if (map[row].props?.['spacing'] === '4' || map[row].props?.['spacing'] === '6') {
    map[row].props = { ...map[row].props, spacing: columns.length >= 3 ? '4' : '6' }
  }
  return true
}

/** A frame with what is hollow taken out (AGL-3735), as a copy; `null` when nothing was. */
export function aiLayoutWithoutFrameHollows<T extends Readonly<Record<string, unknown>>>(nodes: T): T | null {
  const copy: Record<string, unknown> = {}
  for (const [id, raw] of Object.entries(nodes)) {
    const node = raw as HollowNode
    copy[id] =
      node && typeof node === 'object'
        ? { ...node, ...(node.props ? { props: { ...node.props } } : {}), ...(node.sx ? { sx: { ...node.sx } } : {}), ...(node.nodes ? { nodes: [...node.nodes] } : {}) }
        : node
  }
  return aiLayoutRepairFrameHollows(copy) ? (copy as T) : null
}
