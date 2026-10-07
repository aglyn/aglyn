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

import { normalizeScreenSlug, SCREEN_ROOT_PATH } from '@aglyn/aglyn/app-utils/screen-route'
import type { AiBuildPlanScreen } from '../model/ai-build-plan'

/**
 * The navigation of a layout a site scaffold builds before its pages (AGL-3596).
 *
 * A scaffold builds its layout FIRST, because every page renders inside it,
 * so when the layout is generated none of the site's pages exists yet: the
 * model cannot link them, and the layout instructions forbid inventing a page
 * id. A plan that gave the layout a nav region then left the model one way to
 * keep the promise — a nav element with nothing in it — which rule 16 refuses
 * as an empty container, twice, and the guided start stopped there.
 *
 * The scaffold does know the pages: their ids are minted when the plan is
 * kept (`AiBuildPlanScreen.id`), and each page unit writes its draft under
 * that id. So the layout unit is handed them (`sitePages`), and the header's
 * navigation is written by the platform rather than asked of the model: one
 * Page Link per planned page, inside the nav element the model left (filled,
 * never left empty) or a nav row the platform adds to the Toolbar Content.
 * The completed tree is what the doctrine checks and what is written, so rule
 * 16 holds unchanged — nothing it sees is empty — and the publish step, which
 * adds only the entries a header does not already carry, adds nothing twice.
 */

/** The unit input a site layout's planned pages travel under. */
export const AI_LAYOUT_SITE_PAGES_INPUT = 'sitePages'

/** The most pages the header links, as the layout instructions cap it. */
export const AI_LAYOUT_SITE_PAGES_MAX = 7

/** A page the scaffold builds after the layout, as the layout links it. */
export interface AiLayoutSitePage {
  id: string
  label: string
  slug: string
}

/** Whether a slug is the site's root, the home page. */
export function aiLayoutIsHomeSlug(slug: string): boolean {
  return slug.replace(/^\/+|\/+$/g, '') === ''
}

/**
 * The pages a scaffold's plan puts in the navigation: every page it builds
 * with a minted id, record templates aside, the home page first and the rest
 * in plan order (AGL-3660). A plan's `nav` flag does not drop one: a guided
 * start's plan marked its Home `nav: false`, and the header linked only
 * Contact, so a published site had no way back to its home page.
 */
export function aiLayoutSitePagesOfPlan(screens: readonly AiBuildPlanScreen[]): AiLayoutSitePage[] {
  const pages = screens
    .filter((screen) => !screen.record && typeof screen.id === 'string' && screen.id)
    .map((screen) => ({ id: screen.id as string, label: screen.title.trim(), slug: screen.slug }))
    .filter((page) => page.label)
  return [...pages.filter((page) => aiLayoutIsHomeSlug(page.slug)), ...pages.filter((page) => !aiLayoutIsHomeSlug(page.slug))].slice(
    0,
    AI_LAYOUT_SITE_PAGES_MAX,
  )
}

/** The planned pages a layout unit's inputs carry; none for any other layout. */
export function aiLayoutSitePages(inputs: Readonly<Record<string, unknown>> | null | undefined): AiLayoutSitePage[] {
  const raw = inputs?.[AI_LAYOUT_SITE_PAGES_INPUT]
  if (!Array.isArray(raw)) return []
  const pages: AiLayoutSitePage[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const { id, label, slug } = entry as Record<string, unknown>
    if (typeof id !== 'string' || !id || typeof label !== 'string' || !label.trim()) continue
    if (pages.some((page) => page.id === id)) continue
    pages.push({ id, label: label.trim(), slug: typeof slug === 'string' ? slug : '' })
  }
  return pages.slice(0, AI_LAYOUT_SITE_PAGES_MAX)
}

/**
 * What the layout's user turn says about those pages: that the platform
 * writes the navigation, so the model builds none and leaves no empty element
 * for it. The same promise the completion below keeps.
 */
export function aiLayoutSitePagesLines(pages: readonly AiLayoutSitePage[]): string[] {
  if (!pages.length) return []
  return [
    `This site’s pages are built after this layout: ${pages
      .map((page) => `${page.label} (${screenPath(page.slug)})`)
      .join(', ')}.`,
    'The platform writes the header’s navigation to those pages itself, as a nav row of Page Links inside the Toolbar Content. Build no navigation links to them and no nav element for them: leave no empty element where the links will go.',
  ]
}

function screenPath(slug: string): string {
  const normalized = normalizeScreenSlug(slug)
  if (!normalized || normalized === SCREEN_ROOT_PATH) return '/'
  return `/${normalized.replace(/^\/+/, '')}`
}

type RawNode = { componentId?: unknown; props?: Record<string, unknown>; nodes?: unknown; [key: string]: unknown }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const childrenOf = (node: RawNode | undefined): string[] =>
  Array.isArray(node?.nodes) ? (node.nodes as unknown[]).filter((id): id is string => typeof id === 'string') : []

const elementOf = (node: RawNode | undefined): string => {
  const value = node?.props?.['component'] ?? node?.props?.['element']
  return typeof value === 'string' ? value : ''
}

const LINK_COMPONENTS = new Set(['muiScreenLink', 'muiButton'])

/**
 * The model's layout with the header's navigation written in: a Page Link to
 * every planned page the header does not already link, placed in the first
 * nav element above the Layout Slot, else in a nav row the platform appends
 * to the Toolbar Content; and every OTHER nav element the model left empty
 * given the same links, so no nav is ever empty. A link to the site's current
 * home page is pointed at the planned home, which replaces it when the site
 * is published. Anything that is not a node map, or has no planned pages, is
 * returned as it came, for the doctrine to judge.
 */
export function aiLayoutWithSitePages(
  tree: unknown,
  pages: readonly AiLayoutSitePage[],
  options: { homeScreenIds?: readonly string[] } = {},
): unknown {
  if (!pages.length || !isRecord(tree) || !isRecord(tree['nodes'])) return tree
  const rootId = typeof tree['rootId'] === 'string' ? tree['rootId'] : null
  const source = tree['nodes'] as Record<string, unknown>
  if (!rootId || !isRecord(source[rootId])) return tree
  const nodes: Record<string, RawNode> = {}
  for (const [id, node] of Object.entries(source)) {
    if (!isRecord(node)) continue
    nodes[id] = {
      ...(node as RawNode),
      ...(isRecord(node['props']) ? { props: { ...(node['props'] as Record<string, unknown>) } } : {}),
      ...(Array.isArray(node['nodes']) ? { nodes: [...(node['nodes'] as unknown[])] } : {}),
    }
  }

  // Document order, and where the header ends: the Layout Slot.
  const order: string[] = []
  const seen = new Set<string>()
  const visit = (id: string) => {
    if (seen.has(id) || !nodes[id]) return
    seen.add(id)
    order.push(id)
    for (const child of childrenOf(nodes[id])) visit(child)
  }
  visit(rootId)
  const slotAt = order.findIndex((id) => nodes[id].componentId === 'layoutSlot')
  const header = slotAt === -1 ? order : order.slice(0, slotAt)

  // The site's current home is replaced by the planned one at publish.
  const plannedHome = pages.find((page) => screenPath(page.slug) === '/')
  const oldHomes = new Set(options.homeScreenIds ?? [])
  let changed = false
  if (plannedHome) {
    for (const id of order) {
      const node = nodes[id]
      const screenId = node.props?.['screenId']
      if (LINK_COMPONENTS.has(String(node.componentId)) && typeof screenId === 'string' && oldHomes.has(screenId)) {
        node.props = { ...node.props, screenId: plannedHome.id }
        changed = true
      }
    }
  }

  const used = new Set(Object.keys(nodes))
  const freshId = (base: string): string => {
    let id = base
    for (let n = 2; used.has(id); n += 1) id = `${base}${n}`
    used.add(id)
    return id
  }
  const linkNodes = (entries: readonly AiLayoutSitePage[]): string[] =>
    entries.map((page) => {
      const id = freshId(`aiNavLink_${page.id.replace(/[^A-Za-z0-9_]/g, '')}`)
      nodes[id] = {
        componentId: 'muiScreenLink',
        props: { children: page.label.slice(0, 40), screenId: page.id, renderAs: 'link', color: 'inherit' },
      }
      return id
    })

  const linkedInHeader = new Set(
    header
      .map((id) => nodes[id])
      .filter((node) => LINK_COMPONENTS.has(String(node.componentId)))
      .map((node) => node.props?.['screenId'])
      .filter((value): value is string => typeof value === 'string'),
  )
  const missing = pages.filter((page) => !linkedInHeader.has(page.id))
  const navs = order.filter((id) => elementOf(nodes[id]) === 'nav')
  const headerNav = navs.find((id) => header.includes(id)) ?? null

  if (missing.length) {
    if (headerNav) {
      nodes[headerNav].nodes = [...childrenOf(nodes[headerNav]), ...linkNodes(missing)]
      changed = true
    } else {
      const toolbar = header.find((id) => nodes[id].componentId === 'muiToolbar')
      if (toolbar) {
        const navId = freshId('aiSiteNav')
        nodes[navId] = {
          componentId: 'muiStack',
          props: { component: 'nav', direction: 'row', alignItems: 'center' },
          sx: { gap: 2 },
          nodes: linkNodes(missing),
        }
        nodes[toolbar].nodes = [...childrenOf(nodes[toolbar]), navId]
        changed = true
      }
    }
  }
  // A nav element the model left empty anywhere else — a footer's, say — links the same pages.
  for (const id of navs) {
    if (id === headerNav && missing.length) continue
    if (childrenOf(nodes[id]).some((child) => nodes[child])) continue
    nodes[id].nodes = linkNodes(pages)
    changed = true
  }
  return changed ? { ...tree, nodes } : tree
}
