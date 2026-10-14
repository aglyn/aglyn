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
 * A STORE'S LINKS IN A LAYOUT THE SITE ALREADY HAS (AGL-3676).
 *
 * A build that makes a site a store and builds no layout of its own adds its
 * account, cart and policy pages to a site whose header and footer were made
 * before them. So code — never the model — adds the links to that layout:
 * Account (and Cart, where the header has no cart) to the header's links,
 * and the account and policies to the footer's list of links, each a copy of
 * a link already in that list so it looks like its neighbours.
 *
 * Only where the layout has a list to add to: a header (an App Bar, or an
 * element that renders `header`) holding links, or a Toolbar holding one; a
 * footer (an element that renders `footer`) holding a list of two or more
 * links. A layout with neither is left as it is, and the build says what to
 * add by hand. A link already there — by its address, or to the page that
 * holds that address — is never added twice.
 *
 * Pure: nodes in, nodes out.
 */

/** One link a store adds to a layout. */
export interface AiStoreLayoutLink {
  label: string
  href: string
}

/** What a store adds to a layout: the header's links (Account, Cart) and the footer's (account, policies). */
export interface AiStoreLayoutLinks {
  header: AiStoreLayoutLink[]
  /** The cart's page, linked from the header only where the layout has no cart of its own. */
  cart: AiStoreLayoutLink | null
  footer: AiStoreLayoutLink[]
}

/** What adding a store's links to a layout came to. */
export interface AiLayoutStoreLinksResult {
  /** The layout's nodes with the links added, or `null` where nothing was added. */
  nodes: Record<string, unknown> | null
  /** Whether the layout has a header list and a footer list to add to. */
  header: boolean
  footer: boolean
  /** The addresses added, in order. */
  added: string[]
}

/** The commerce plugin's Cart element, which a header may already place (`AI_LAYOUT_CART_ELEMENT`). */
const CART_ELEMENT = 'cart'
const LINK = 'muiScreenLink'

interface Node {
  $id: string
  componentId?: string
  pluginId?: string
  parentId?: string | null
  nodes?: string[]
  props?: Record<string, unknown>
  sx?: Record<string, unknown>
  [key: string]: unknown
}

const renders = (node: Node, element: 'header' | 'footer') =>
  node.props?.['element'] === element || node.props?.['component'] === element || node.componentId === element

/**
 * The layout's nodes with a store's links added (AGL-3676), and whether it
 * had a header list and a footer list to add them to. `screenPaths` names
 * the address of each of the site's pages, so a link to a page counts as a
 * link to its address.
 */
export function aiLayoutWithStoreLinks(
  nodes: Readonly<Record<string, unknown>>,
  links: AiStoreLayoutLinks,
  screenPaths: Readonly<Record<string, string>> = {},
): AiLayoutStoreLinksResult {
  const map: Record<string, Node> = {}
  for (const [id, raw] of Object.entries(nodes as Record<string, Node>)) {
    if (!raw || typeof raw !== 'object') continue
    map[id] = { ...raw, ...(raw.props ? { props: { ...raw.props } } : {}), ...(raw.nodes ? { nodes: [...raw.nodes] } : {}) }
  }
  const all = Object.values(map)
  const under = (roots: readonly Node[]): Set<string> => {
    const seen = new Set<string>()
    const queue = roots.map((root) => root.$id)
    while (queue.length) {
      const id = queue.shift() as string
      if (seen.has(id) || !map[id]) continue
      seen.add(id)
      queue.push(...(map[id].nodes ?? []))
    }
    return seen
  }
  const linkChildren = (node: Node) => (node.nodes ?? []).filter((id) => map[id]?.componentId === LINK)
  const pathOf = (node: Node): string | null => {
    const href = node.props?.['href']
    if (typeof href === 'string' && href) return href.replace(/\/+$/, '') || '/'
    const screenId = node.props?.['screenId']
    const path = typeof screenId === 'string' ? screenPaths[screenId] : undefined
    return path ? `/${path.replace(/^\/+/, '').replace(/\/+$/, '')}` : null
  }
  const pathsIn = (ids: Set<string>) =>
    new Set([...ids].map((id) => map[id]).filter((node) => node?.componentId === LINK).map(pathOf).filter(Boolean))

  // The header: its lists of links (the bar's and the phone menu's), else a Toolbar holding one.
  const headerRoots = all.filter((node) => node.componentId === 'muiAppBar' || renders(node, 'header'))
  const headerIds = under(headerRoots)
  let headerLists = [...headerIds].map((id) => map[id]).filter((node) => linkChildren(node).length >= 2)
  if (!headerLists.length) {
    const toolbar = all.find((node) => node.componentId === 'muiToolbar' && linkChildren(node).length >= 1)
    headerLists = toolbar ? [toolbar] : []
  }
  // The footer: its longest list of links.
  const footerIds = under(all.filter((node) => renders(node, 'footer')))
  const footerList =
    [...footerIds]
      .map((id) => map[id])
      .filter((node) => linkChildren(node).length >= 2)
      .sort((a, b) => linkChildren(b).length - linkChildren(a).length)[0] ?? null

  const added: string[] = []
  const append = (list: Node, wanted: readonly AiStoreLayoutLink[], present: Set<unknown>, region: string) => {
    const children = list.nodes ?? []
    const siblings = linkChildren(list)
    const template = map[siblings[siblings.length - 1]]
    const lastLink = children.reduce((at, id, index) => (map[id]?.componentId === LINK ? index : at), -1)
    const ids: string[] = []
    for (const link of wanted) {
      if (present.has(link.href)) continue
      const id = `ai_store_${region}_${link.href.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '')}`
      if (map[id]) continue
      const props = { ...(template?.props ?? {}), children: link.label, href: link.href }
      delete props['screenId']
      map[id] = {
        ...(template ?? {}),
        $id: id,
        componentId: LINK,
        pluginId: template?.pluginId ?? 'mui',
        parentId: list.$id,
        props,
        nodes: [],
      }
      ids.push(id)
      if (!added.includes(link.href)) added.push(link.href)
    }
    if (ids.length) list.nodes = [...children.slice(0, lastLink + 1), ...ids, ...children.slice(lastLink + 1)]
  }

  if (headerLists.length) {
    const hasCart = all.some((node) => node.componentId === CART_ELEMENT)
    const wanted = [...links.header, ...(links.cart && !hasCart ? [links.cart] : [])]
    const present = pathsIn(headerIds.size ? headerIds : under(headerLists))
    headerLists.forEach((list, index) => append(list, wanted, present, `header${index}`))
  }
  if (footerList) append(footerList, links.footer, pathsIn(footerIds), 'footer')
  return {
    nodes: added.length ? (map as Record<string, unknown>) : null,
    header: headerLists.length > 0,
    footer: Boolean(footerList),
    added,
  }
}
