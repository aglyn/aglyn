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
 * A SITE'S MENUS, CHANGED BY CODE (AGL-3728).
 *
 * A site's header and footer menus are not a separate document: they are the
 * Besigner's own elements in the layout's node tree — Page Links
 * (`muiScreenLink`) in a list in the header, the same list again in the phone
 * menu's Drawer, Dropdown Menus (`muiNavMenu`, `muiMegaMenu`) holding more
 * Page Links, and the footer's list of Page Links. That is what a person
 * edits in the Besigner, and what this edits, so a menu the AI changed opens
 * in the editor exactly as one a person changed.
 *
 * A change is planned as words — add "About", take "Blog" out, call
 * "Services" "What we do", link "Shop" to a page, put "Contact" last — and
 * applied here, in code, to every list of the menu it names:
 *
 *  - THE HEADER's lists are the lists of links inside its App Bar (or an
 *    element that renders `header`): the bar's own row and the phone menu's.
 *    Where it has lists that render `nav`, only those are its menu, so the
 *    brand and an account link beside it never are. Failing any list, a
 *    Toolbar holding a link (the brand's counts), else the first Toolbar.
 *    The brand (a link the compiler named `brand`) is never a menu item, and
 *    an item added beside nothing but the brand goes after it.
 *  - THE FOOTER's list is the longest list of links inside the element that
 *    renders `footer`.
 *
 * Recognized the way a store's links are added to a layout
 * (`aiLayoutWithStoreLinks`, AGL-3676). A layout with no list for a menu is
 * left as it is, and the change says what to do by hand.
 *
 * A new link copies a link already in the list it joins — its look, and in
 * the phone menu the interaction that closes it — so it looks like its
 * neighbours. A link added under a parent ("Services > Roofing") goes into the
 * Dropdown Menu of that name in a bar's row, made where there is none (the
 * link of that name, if any, becoming its first entry); a phone menu and a
 * footer have no dropdowns, so there it joins the list after its parent.
 *
 * ONE implementation for every menu change the AI makes (AGL-3747): the
 * `navigation` op's (`ai-job-navigation-step.ts`), and the header entries a
 * guided site start adds to its layout when it publishes
 * (`aiLayoutWithNavigation` in `ai-site-publish.ts`), including the /blog
 * entry a retried posts part puts back.
 *
 * Pure: nodes in, nodes out.
 */

import { aiLayoutRepairFrameHollows } from '../layout-language/ai-layout-frame-hollows'

/** A menu of a site's layout. */
export type AiMenuName = 'header' | 'footer'

export const AI_MENU_NAMES: readonly AiMenuName[] = ['header', 'footer']

/** Where a menu item goes: one of the site's pages, by id, or an address. */
export type AiMenuTarget = { screenId: string } | { href: string }

/** One entry a change names: a top-level item, or one under a parent dropdown. */
export interface AiMenuEntryRef {
  /** The dropdown it is under, by its label; `null` for a top-level item. */
  parent: string | null
  label: string
}

/** An entry to add, and where it goes. */
export type AiMenuAddition = AiMenuEntryRef & {
  to: AiMenuTarget
  /**
   * A top-level entry goes right after the first item linking one of these
   * (a page by id, an address), where the menu has one, instead of last. Set
   * by code, never read off a planner's words: the blog's entry, put back
   * second after Home (AGL-3747).
   */
  after?: readonly AiMenuTarget[]
}

/** What a navigation change does to a menu. */
export interface AiMenuChanges {
  add: AiMenuAddition[]
  remove: AiMenuEntryRef[]
  rename: Array<AiMenuEntryRef & { name: string }>
  relink: Array<AiMenuEntryRef & { to: AiMenuTarget }>
  /** Top-level labels, in the order wanted; the rest keep theirs, after them. */
  order: string[]
}

/** What applying a change came to. */
export interface AiMenusResult {
  /** The layout's nodes with the change made, or `null` where nothing changed. */
  nodes: Record<string, unknown> | null
  /** Whether the layout has a list for each menu asked about. */
  found: Partial<Record<AiMenuName, boolean>>
  /** What was done, as sentences. */
  done: string[]
  /** What could not be done, and why, as sentences. */
  notDone: string[]
}

const LINK = 'muiScreenLink'
/** The Besigner's Dropdown Menu and Mega Menu: a labelled item holding links. Persisted ids. */
export const AI_MENU_DROPDOWNS: readonly string[] = ['muiNavMenu', 'muiMegaMenu']
const NAV_MENU = 'muiNavMenu'
const DRAWER = 'muiDrawer'
/** The most items a menu may be asked to change in one go. */
export const AI_MENU_CHANGES_MAX = 12
/** The longest label a menu item takes. */
export const AI_MENU_LABEL_MAX = 40

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

const renders = (node: Node, element: string) =>
  node.props?.['element'] === element || node.props?.['component'] === element || node.componentId === element

const said = (value: unknown): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '')
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** Where a menu change says an entry lives, in words: `Roofing`, `Services › Roofing`. */
export function aiMenuEntryName(entry: AiMenuEntryRef): string {
  return entry.parent ? `${entry.parent} › ${entry.label}` : entry.label
}

/**
 * The layout's nodes with a navigation change made to the menus named
 * (AGL-3728). Each menu's lists all take the same change, so the bar and the
 * phone menu never disagree. `newId` mints a node id; the default is a
 * counter under `ai_nav_`.
 */
export function aiLayoutWithMenuChanges(
  nodes: Readonly<Record<string, unknown>>,
  menus: readonly AiMenuName[],
  changes: AiMenuChanges,
  options: { newId?: () => string } = {},
): AiMenusResult {
  const map: Record<string, Node> = {}
  for (const [id, raw] of Object.entries(nodes as Record<string, Node>)) {
    if (!raw || typeof raw !== 'object') continue
    map[id] = {
      ...raw,
      $id: typeof raw.$id === 'string' && raw.$id ? raw.$id : id,
      ...(raw.props ? { props: { ...raw.props } } : {}),
      ...(raw.nodes ? { nodes: [...raw.nodes] } : {}),
    }
  }
  let counter = 0
  const newId =
    options.newId ??
    (() => {
      counter += 1
      while (map[`ai_nav_${counter}`]) counter += 1
      return `ai_nav_${counter}`
    })
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
  const isBrand = (id: string) => /brand/i.test(id)
  const isLink = (id: string) => map[id]?.componentId === LINK && !isBrand(id)
  const isDropdown = (id: string) => AI_MENU_DROPDOWNS.includes(String(map[id]?.componentId))
  const isItem = (id: string) => isLink(id) || isDropdown(id)
  const itemsOf = (list: Node) => (list.nodes ?? []).filter(isItem)
  const labelOf = (id: string) => said(isDropdown(id) ? map[id]?.props?.['label'] : map[id]?.props?.['children'])

  // ── The lists each menu is ───────────────────────────────────────────
  const listsOf = (menu: AiMenuName): Node[] => {
    if (menu === 'footer') {
      const ids = under(all.filter((node) => renders(node, 'footer')))
      const longest = [...ids]
        .map((id) => map[id])
        .filter((node) => (node.nodes ?? []).filter(isLink).length >= 2)
        .sort((a, b) => (b.nodes ?? []).filter(isLink).length - (a.nodes ?? []).filter(isLink).length)[0]
      return longest ? [longest] : []
    }
    const ids = under(all.filter((node) => node.componentId === 'muiAppBar' || renders(node, 'header')))
    const lists = [...ids].map((id) => map[id]).filter((node) => itemsOf(node).length >= 2)
    const landmarks = lists.filter((node) => renders(node, 'nav'))
    if (landmarks.length) return landmarks
    if (lists.length) return lists
    // A bar's Toolbar holding a link, the brand's included (a starter's
    // header is a brand and a search), else its first Toolbar.
    const toolbars = all.filter((node) => node.componentId === 'muiToolbar')
    const toolbar = toolbars.find((node) => (node.nodes ?? []).some((id) => map[id]?.componentId === LINK)) ?? toolbars[0]
    return toolbar ? [toolbar] : []
  }
  // A phone menu (in a Drawer) and a footer hold no dropdowns: their entries stay flat.
  const drawerIds = under(all.filter((node) => node.componentId === DRAWER))
  const flat = (menu: AiMenuName, list: Node) => menu === 'footer' || drawerIds.has(list.$id)

  const found: Partial<Record<AiMenuName, boolean>> = {}
  const notDone = new Set<string>()
  // What each entry came to across a menu's lists: done where any list did it.
  const outcomes = new Map<string, { ok: boolean; done: string; failed: string }>()
  const mark = (key: string, ok: boolean, done: string, failed: string) => {
    const was = outcomes.get(key)
    outcomes.set(key, { ok: ok || (was?.ok ?? false), done, failed: was && !was.ok && !ok ? was.failed : failed })
  }
  let changed = false

  const removeTree = (id: string) => {
    for (const child of [...(map[id]?.nodes ?? [])]) removeTree(child)
    delete map[id]
  }
  const detach = (id: string) => {
    for (const node of Object.values(map)) {
      if (node.nodes?.includes(id)) node.nodes = node.nodes.filter((child) => child !== id)
    }
  }
  const setTarget = (node: Node, to: AiMenuTarget) => {
    const props = { ...(node.props ?? {}) }
    delete props['screenId']
    delete props['href']
    node.props = { ...props, ...to }
  }
  /** A new link like the list's own, else a plain one. */
  const linkLike = (template: Node | undefined, parentId: string, label: string, to: AiMenuTarget): string => {
    const id = newId()
    const props: Record<string, unknown> = template?.props
      ? { ...template.props }
      : { renderAs: 'link', color: 'inherit' }
    delete props['screenId']
    delete props['href']
    map[id] = {
      ...(template ?? { sx: { textDecoration: 'none', whiteSpace: 'nowrap' } }),
      $id: id,
      componentId: LINK,
      pluginId: template?.pluginId ?? 'mui',
      parentId,
      props: { ...props, children: label.slice(0, AI_MENU_LABEL_MAX), ...to },
      nodes: [],
    }
    return id
  }
  /** Whether a link opens a destination: the same page, or the same address. */
  const opens = (node: Node | undefined, to: AiMenuTarget) =>
    'screenId' in to ? node?.props?.['screenId'] === to.screenId : node?.props?.['href'] === to.href
  /** Every link in a dropdown, at any depth (a Mega Menu's columns). */
  const linksIn = (dropdown: string) => [...under([map[dropdown]])].filter((id) => id !== dropdown && isLink(id))
  /** An entry in one list: a top-level item, or a link in a dropdown (or, in a flat list, the item itself). */
  const find = (list: Node, entry: AiMenuEntryRef, isFlat: boolean): string | null => {
    const top = itemsOf(list)
    if (!entry.parent) return top.find((id) => same(labelOf(id), entry.label)) ?? null
    const parent = top.find((id) => isDropdown(id) && same(labelOf(id), entry.parent as string))
    if (parent) return linksIn(parent).find((id) => same(labelOf(id), entry.label)) ?? null
    return isFlat ? (top.find((id) => isLink(id) && same(labelOf(id), entry.label)) ?? null) : null
  }

  for (const menu of menus) {
    const lists = listsOf(menu)
    found[menu] = lists.length > 0
    if (!lists.length) {
      notDone.add(`The ${menu} has no list of links to change: add them in the layout by hand.`)
      continue
    }
    for (const list of lists) {
      const isFlat = flat(menu, list)
      for (const entry of changes.remove) {
        const id = find(list, entry, isFlat)
        const key = `remove:${menu}:${aiMenuEntryName(entry).toLowerCase()}`
        mark(key, !!id, `Took “${aiMenuEntryName(entry)}” out of the ${menu}.`, `No “${aiMenuEntryName(entry)}” in the ${menu} to take out.`)
        if (!id) continue
        detach(id)
        removeTree(id)
        changed = true
      }
      for (const entry of changes.rename) {
        const id = find(list, entry, isFlat)
        const name = entry.name.slice(0, AI_MENU_LABEL_MAX)
        const key = `rename:${menu}:${aiMenuEntryName(entry).toLowerCase()}`
        mark(key, !!id, `Renamed “${aiMenuEntryName(entry)}” to “${name}” in the ${menu}.`, `No “${aiMenuEntryName(entry)}” in the ${menu} to rename.`)
        if (!id) continue
        map[id].props = { ...(map[id].props ?? {}), [isDropdown(id) ? 'label' : 'children']: name }
        changed = true
      }
      for (const entry of changes.relink) {
        const id = find(list, entry, isFlat)
        const key = `relink:${menu}:${aiMenuEntryName(entry).toLowerCase()}`
        mark(
          key,
          !!id && isLink(id),
          `Pointed “${aiMenuEntryName(entry)}” in the ${menu} somewhere new.`,
          id ? `“${aiMenuEntryName(entry)}” opens a dropdown, which links nowhere itself.` : `No “${aiMenuEntryName(entry)}” in the ${menu} to relink.`,
        )
        if (!id || !isLink(id)) continue
        setTarget(map[id], entry.to)
        changed = true
      }
      for (const entry of changes.add) {
        const key = `add:${menu}:${aiMenuEntryName(entry).toLowerCase()}`
        if (find(list, entry, isFlat)) {
          mark(key, true, `“${aiMenuEntryName(entry)}” was already in the ${menu}.`, '')
          continue
        }
        const children = list.nodes ?? []
        const template = map[children.filter(isLink).slice(-1)[0]]
        // After the list's last item, else after its brand: before a search,
        // a mode switch or a call to action that follows them.
        const lastOf = (test: (id: string) => boolean) => children.reduce((at, id, index) => (test(id) ? index : at), -1)
        const lastItem = lastOf(isItem) !== -1 ? lastOf(isItem) : lastOf((id) => map[id]?.componentId === LINK)
        if (!entry.parent || isFlat) {
          // After its parent in a flat list, else after the item it is to
          // follow, else after the list's last item.
          const parentAt = entry.parent ? children.findIndex((id) => isItem(id) && same(labelOf(id), entry.parent as string)) : -1
          const afterAt = !entry.parent && entry.after?.length ? children.findIndex((id) => isLink(id) && (entry.after ?? []).some((to) => opens(map[id], to))) : -1
          let at = parentAt !== -1 ? parentAt : afterAt !== -1 ? afterAt : lastItem
          if (parentAt !== -1) {
            // After the entries already following the parent from an earlier add.
            while (at + 1 < children.length && isLink(children[at + 1]) && String(children[at + 1]).startsWith('ai_nav_')) at += 1
          }
          const id = linkLike(template, list.$id, entry.label, entry.to)
          list.nodes = [...children.slice(0, at + 1), id, ...children.slice(at + 1)]
        } else {
          let dropdown = children.find((id) => isDropdown(id) && same(labelOf(id), entry.parent as string))
          if (!dropdown) {
            // A Dropdown Menu of that name, where its link of that name was, else last.
            dropdown = newId()
            const own = children.find((id) => isLink(id) && same(labelOf(id), entry.parent as string))
            map[dropdown] = {
              $id: dropdown,
              componentId: NAV_MENU,
              pluginId: 'mui',
              parentId: list.$id,
              props: { label: (entry.parent as string).slice(0, AI_MENU_LABEL_MAX) },
              nodes: own ? [own] : [],
            }
            if (own) {
              map[own].parentId = dropdown
              list.nodes = children.map((id) => (id === own ? (dropdown as string) : id))
            } else {
              list.nodes = [...children.slice(0, lastItem + 1), dropdown, ...children.slice(lastItem + 1)]
            }
          }
          const inside = map[dropdown]
          const id = linkLike(map[linksIn(dropdown)[0]] ?? template, dropdown, entry.label, entry.to)
          inside.nodes = [...(inside.nodes ?? []), id]
        }
        changed = true
        mark(key, true, `Added “${aiMenuEntryName(entry)}” to the ${menu}.`, '')
      }
      if (changes.order.length) {
        const children = list.nodes ?? []
        const slots = children.map((id, index) => (isItem(id) ? index : -1)).filter((index) => index !== -1)
        const items = slots.map((index) => children[index])
        const named = changes.order.flatMap((label) => items.filter((id) => same(labelOf(id), label)).slice(0, 1))
        const ordered = [...new Set([...named, ...items])]
        if (ordered.some((id, index) => id !== items[index])) {
          const next = [...children]
          slots.forEach((slot, index) => {
            next[slot] = ordered[index]
          })
          list.nodes = next
          changed = true
        }
        for (const label of changes.order) {
          mark(
            `order:${menu}:${label.toLowerCase()}`,
            items.some((id) => same(labelOf(id), label)),
            `Put “${label}” in its place in the ${menu}.`,
            `No “${label}” in the ${menu} to put in order.`,
          )
        }
      }
    }
  }
  // A link taken out leaves no dropdown with no link in it, and no footer
  // heading or column with nothing under it (AGL-3735).
  if (changed && changes.remove.length) aiLayoutRepairFrameHollows(map as unknown as Record<string, unknown>)
  const entries = [...outcomes.values()]
  return {
    nodes: changed ? (map as Record<string, unknown>) : null,
    found,
    done: [...new Set(entries.filter((entry) => entry.ok).map((entry) => entry.done))],
    notDone: [...notDone, ...new Set(entries.filter((entry) => !entry.ok).map((entry) => entry.failed))],
  }
}

// ── The change as an item's arguments carry it ───────────────────────────

/** How an entry names a parent, a label and a destination: `Services > Roofing => /roofing`. */
const ARROW = /\s*=>\s*/
const PARENT = /\s*>\s*/

/** What reading an item's arguments came to: the change, and what could not be read. */
export interface AiMenuChangesRead {
  changes: AiMenuChanges
  problems: string[]
}

/** An entry's parent and label: `Services > Roofing`, or `Roofing`. */
function entryRefOf(text: string): AiMenuEntryRef | null {
  const parts = text.split(PARENT).map((part) => said(part)).filter(Boolean)
  if (!parts.length || parts.length > 2) return null
  const label = parts[parts.length - 1].slice(0, AI_MENU_LABEL_MAX)
  return { parent: parts.length === 2 ? parts[0].slice(0, AI_MENU_LABEL_MAX) : null, label }
}

const list = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string').map(said).filter(Boolean).slice(0, AI_MENU_CHANGES_MAX) : []

/**
 * A navigation item's change, read off its arguments (AGL-3728). Each entry
 * is words: `add` and `relink` take `Label => destination` (a parent first
 * as `Parent > Label`), `remove` the label, `rename` `Old => New`, `order`
 * labels. `target` turns a destination into a page or an address, or `null`
 * for one this site cannot link, which leaves that entry out with a sentence.
 */
export function aiMenuChangesOf(
  args: Readonly<Record<string, unknown>>,
  target: (destination: string) => AiMenuTarget | null,
): AiMenuChangesRead {
  const problems: string[] = []
  const changes = aiNoMenuChanges()
  const linked = (entry: string, verb: 'add' | 'relink') => {
    const [name, destination, ...rest] = entry.split(ARROW)
    const ref = entryRefOf(name ?? '')
    if (!ref || !said(destination) || rest.length) {
      problems.push(`“${entry}” is not “Label => page or address”, so it was left out.`)
      return
    }
    const to = target(said(destination))
    if (!to) {
      problems.push(`“${aiMenuEntryName(ref)}” links “${said(destination)}”, which is no page or address on this site, so it was left out.`)
      return
    }
    changes[verb].push({ ...ref, to })
  }
  for (const entry of list(args['add'])) linked(entry, 'add')
  for (const entry of list(args['relink'])) linked(entry, 'relink')
  for (const entry of list(args['remove'])) {
    const ref = entryRefOf(entry)
    if (ref) changes.remove.push(ref)
    else problems.push(`“${entry}” names no menu item, so it was left out.`)
  }
  for (const entry of list(args['rename'])) {
    const [from, to, ...rest] = entry.split(ARROW)
    const ref = entryRefOf(from ?? '')
    const name = said(to)
    if (!ref || !name || rest.length) problems.push(`“${entry}” is not “Old name => New name”, so it was left out.`)
    else changes.rename.push({ ...ref, name: name.slice(0, AI_MENU_LABEL_MAX) })
  }
  changes.order = list(args['order']).map((label) => label.slice(0, AI_MENU_LABEL_MAX))
  return { changes, problems }
}

/** A change that does nothing, to build one from. */
export function aiNoMenuChanges(): AiMenuChanges {
  return { add: [], remove: [], rename: [], relink: [], order: [] }
}

/** Whether a change does anything at all. */
export function aiMenuChangesEmpty(changes: AiMenuChanges): boolean {
  return !changes.add.length && !changes.remove.length && !changes.rename.length && !changes.relink.length && !changes.order.length
}

/** The menus an item's `menu` names: the header, the footer, or both. */
export function aiMenusOf(value: unknown): AiMenuName[] {
  if (value === 'footer') return ['footer']
  if (value === 'both') return ['header', 'footer']
  return ['header']
}

/** The `new:` references an entry's destination makes: what the item must be built after. */
export function aiMenuNewRefs(args: Readonly<Record<string, unknown>>): string[] {
  const refs: string[] = []
  for (const key of ['add', 'relink'] as const) {
    for (const entry of list(args[key])) {
      const destination = said(entry.split(ARROW)[1])
      if (/^new:/i.test(destination) && !refs.includes(destination)) refs.push(destination)
    }
  }
  return refs
}
