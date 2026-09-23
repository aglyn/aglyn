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

import { components } from '@aglyn/aglyn'

/**
 * Every word the Styles and Attributes tabs show about changing ONE placement
 * of a shared definition — a reusable component, a form placed from the Forms
 * page, and (by the same API) a shared layout (AGL-3288).
 *
 * The people reading these words have never built a website. The storage
 * layer's vocabulary — override, instance, target, root, attribute — is
 * accurate and means nothing to them, so it stays in identifiers and never
 * reaches the screen. Both tabs read their strings from here, which is what
 * keeps them saying the same thing, and what lets one spec prove none of that
 * vocabulary leaks (`placement-override-copy.spec.ts`).
 */

/** What kind of shared thing the selected node is one placement of. */
export type PlacementKind = 'component' | 'form' | 'layout'

/** The noun an author knows each kind by. */
const PLACEMENT_NOUN: Record<PlacementKind, string> = {
  component: 'component',
  form: 'form',
  layout: 'layout',
}

/** The strings one placement's "change it here" section shows. */
export interface PlacementCopy {
  /** Section heading, in both tabs. */
  sectionTitle: string
  /** The one line under the heading. */
  intro: string
  /** The help tip's body, in the Attributes tab. */
  helpExcerpt: string
  /** The help tip's body, in the Styles tab. */
  styleHelpExcerpt: string
  /** The part picker's label. */
  partPickerLabel: string
  /** The picker's first choice: the placement as a whole. */
  wholePart: string
  /** Helper text under the picker while the whole placement is picked. */
  wholePartHelper: string
  /** Helper text under the picker while one part is picked. */
  onePartHelper: string
  /** Helper text under the picker, Styles tab, whole placement picked. */
  styleWholePartHelper: string
  /** Helper text under the picker, Styles tab, one part picked. */
  styleOnePartHelper: string
  /** Marks a part in the picker that already carries a change. */
  changedMark: string
  /** Badge on a field changed on this page. */
  changedBadge: string
  /** Label before the Styles tab's list of changed settings. */
  changedListLabel: string
  /** The summary line: how many changes this page makes. */
  summary: (count: number) => string
  /** The summary line's action. */
  resetAll: string
  /** Accessible name of the "reset all" action. */
  resetAllAria: string
  /** Accessible name (and tooltip) of one field's reset button. */
  resetField: (fieldLabel: string) => string
  /** Said when the picked part offers nothing to change. */
  nothingToChange: string
}

/**
 * The copy for one kind of placement — see {@link PlacementCopy}.
 *
 * A function rather than a table so the noun is spelled once: "component"
 * and "form" differ in one word, and a hand-written second set is how the two
 * drift apart.
 */
export function placementCopy(kind: PlacementKind = 'component'): PlacementCopy {
  const noun = PLACEMENT_NOUN[kind] ?? PLACEMENT_NOUN.component
  const the = `the ${noun}`
  const whole = `Whole ${noun}`
  return {
    sectionTitle: 'Change it on this page only',
    intro:
      `Changes here affect this spot only. The ${noun} itself, and every ` +
      'other page using it, stay the same.',
    helpExcerpt:
      kind === 'form'
        ? 'Give this form its own labels, placeholders or button text on ' +
          'this page. What the form collects stays the same. Leave a box ' +
          "empty to keep the form's own value."
        : `Give this spot its own settings, like a different button style ` +
          `or link, without changing ${the} anywhere else. Leave a box ` +
          `empty to keep ${the}'s own value.`,
    styleHelpExcerpt:
      `Restyle this spot without changing ${the} anywhere else. Pick a ` +
      'part to restyle just that piece.',
    partPickerLabel: 'Which part?',
    wholePart: whole,
    wholePartHelper:
      kind === 'form'
        ? 'Changing the whole form. Pick a field to change its label or ' +
          'placeholder.'
        : `Changing the whole ${noun}. Pick a part to change just that piece.`,
    onePartHelper: `Changing just this part of ${the}.`,
    styleWholePartHelper:
      `Styling the whole ${noun}. Text that sets its own color keeps it — ` +
      'pick that text to change it.',
    styleOnePartHelper:
      `Styling just this part. Its words still come from ${the}.`,
    changedMark: '(changed)',
    changedBadge: 'Changed here',
    changedListLabel: 'Changed here:',
    summary: (count) =>
      count > 0
        ? `${count} ${count === 1 ? 'change' : 'changes'} on this page`
        : 'No changes on this page yet',
    resetAll: 'Reset all',
    resetAllAria: `Reset every change on this page back to ${the}'s values`,
    resetField: (fieldLabel) =>
      `Reset ${fieldLabel} to ${the}'s value`,
    nothingToChange: `This part of ${the} has nothing to change here.`,
  }
}

/** Every user-facing string {@link placementCopy} can produce, for specs. */
export function allPlacementCopyStrings(kind: PlacementKind): string[] {
  const copy = placementCopy(kind)
  const strings: string[] = []
  for (const value of Object.values(copy)) {
    if (typeof value === 'string') strings.push(value)
  }
  strings.push(copy.summary(0), copy.summary(1), copy.summary(3))
  strings.push(copy.resetField('Variant'))
  return strings
}

// ---------------------------------------------------------------------------
// Naming the parts
// ---------------------------------------------------------------------------

/** One part of a definition, as the part picker lists it. */
export interface PartEntry {
  /** The definition-internal node id. */
  componentInternalId: string
  /** The definition node's element type. */
  componentId?: string
  /** The definition node's own name, when its author gave it one. */
  name?: string
  /** True for the definition's outermost element. */
  isRoot: boolean
}

/** The slice of a definition node {@link describePart} reads. */
export interface PartNode {
  componentId?: string
  name?: string
  parentId?: string | null
  nodes?: unknown
  props?: unknown
  /** The node's own styles: a fill, border or shadow makes a group a card. */
  sx?: unknown
}

/** Options for {@link describePart} and {@link describeParts}. */
export interface DescribePartOptions {
  /** Which kind of placement this is; decides "Whole component/form". */
  kind?: PlacementKind
  /**
   * The placement's own values for the definition's declared properties, so
   * a text that reads `{{prop.headline}}` is named by what THIS page shows.
   */
  propValues?: Record<string, unknown>
  /**
   * The definition's declared defaults ({@link propDefaultsOf}), for a token
   * this page leaves unset: the part is named by the words the page actually
   * shows, not by the property's name (AGL-3293).
   */
  propDefaults?: Record<string, unknown>
}

/** How long a preview may run before it is cut with an ellipsis. */
export const PART_PREVIEW_LIMIT = 32

/**
 * Element types named for what an author sees, not for the library class
 * that draws them. Anything absent falls back to the registry's label.
 */
const FRIENDLY_TYPE: Record<string, string> = {
  muiStack: 'Group',
  muiBox: 'Group',
  div: 'Group',
  muiPaper: 'Group',
  muiGrid: 'Group',
  muiToolbar: 'Group',
  muiCardContent: 'Group',
  muiCardActions: 'Group',
  muiCard: 'Card',
  muiCardHeader: 'Heading',
  muiTypography: 'Text',
  muiInlineText: 'Text',
  muiListItemText: 'Text',
  markdown: 'Text',
  muiScreenLink: 'Link',
  muiLink: 'Link',
  muiLinkBox: 'Link',
  muiButton: 'Button',
  icon: 'Icon',
  image: 'Image',
  muiImage: 'Image',
  muiImageListItem: 'Image',
  muiImageList: 'Gallery',
  video: 'Video',
  section: 'Section',
  muiContainer: 'Container',
  muiList: 'List',
  muiListItem: 'List item',
  muiAppBar: 'Top bar',
  muiAccordion: 'Accordion',
  muiAccordionSummary: 'Accordion heading',
  muiAccordionDetails: 'Accordion body',
  muiTabs: 'Tabs',
  muiTabPanel: 'Tab',
  muiBreadcrumbs: 'Breadcrumbs',
  muiNavMenu: 'Menu',
  muiMegaMenu: 'Menu',
  muiDrawer: 'Side panel',
  muiDrawerToggle: 'Menu button',
  form: 'Form',
  formField: 'Field',
  reusableInstance: 'Component',
}

/** The name every plain wrapper shares. */
const GROUP_TYPE = 'Group'

/** What a plain wrapper with a surface of its own reads as. */
const CARD_TYPE = 'Card'

/** Types whose preview is quoted, because it is running prose. */
const QUOTED_TYPES = new Set(['Text'])

/**
 * How many like items a group must hold before it is named by listing them
 * ("Besigner, Console, Commerce…") rather than by its first item's words —
 * which would give a grid of cards the same name as its first card.
 */
const COLLECTION_MIN_ITEMS = 3

/** The name an author knows an element type by. */
export function friendlyTypeName(componentId: string | undefined): string {
  if (!componentId) return 'Part'
  return (
    FRIENDLY_TYPE[componentId] ?? components.getLabel(componentId) ?? 'Part'
  )
}

/** Collapses whitespace and cuts a preview at {@link PART_PREVIEW_LIMIT}. */
export function truncatePreview(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= PART_PREVIEW_LIMIT) return flat
  return `${flat.slice(0, PART_PREVIEW_LIMIT - 1).trimEnd()}…`
}

const PROP_TOKEN = /\{\{\s*prop\.([A-Za-z0-9_$-]+)\s*\}\}/g
const ANY_TOKEN = /\{\{[^}]*\}\}/g

/** `firstName` → `First name`. */
function humanize(name: string): string {
  const spaced = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .trim()
  return spaced ? spaced[0].toUpperCase() + spaced.slice(1) : ''
}

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The declared properties' defaults of a definition, by name. Reads the
 * `props` a reusable component declares (AGL-1247); a placed form's design
 * declares none, so it answers `{}`.
 */
export function propDefaultsOf(definition: unknown): Record<string, unknown> {
  const declared = isPlainRecord(definition) ? definition['props'] : undefined
  const defaults: Record<string, unknown> = {}
  if (!Array.isArray(declared)) return defaults
  for (const prop of declared) {
    if (!isPlainRecord(prop) || typeof prop['name'] !== 'string') continue
    if (prop['defaultValue'] !== undefined && prop['defaultValue'] !== null) {
      defaults[prop['name']] = prop['defaultValue']
    }
  }
  return defaults
}

/** A property's value as a page shows it: its own, else the declared default. */
function shownValue(
  values: NameValues,
  name: string,
): string | undefined {
  for (const source of [values.propValues, values.propDefaults]) {
    const value = source?.[name]
    if (typeof value === 'string' && value.trim()) return value
  }
  return undefined
}

/** The property values a part name reads tokens against. */
interface NameValues {
  propValues?: Record<string, unknown>
  propDefaults?: Record<string, unknown>
}

/**
 * A prop value as words: declared-property tokens filled from what the page
 * shows (its own value, else the definition's default, else the property's
 * name), other tokens dropped, markup stripped.
 */
function readableText(raw: unknown, values: NameValues): string {
  if (typeof raw === 'number') return String(raw)
  if (typeof raw !== 'string') return ''
  const filled = raw
    .replace(
      PROP_TOKEN,
      (_match, name: string) => shownValue(values, name) ?? humanize(name),
    )
    .replace(ANY_TOKEN, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
  return filled.replace(/\s+/g, ' ').trim()
}

/** The props, in order, that carry the words an element shows. */
const TEXT_PROPS = [
  'children',
  'html',
  'label',
  'alt',
  'title',
  'text',
  'submitLabel',
  'placeholder',
  'fieldName',
]

/** The words a node shows by itself, or ''. */
function ownText(node: PartNode | undefined, values: NameValues): string {
  const props = node?.props as Record<string, unknown> | undefined
  if (!props) return ''
  for (const key of TEXT_PROPS) {
    const text = readableText(props[key], values)
    if (text) return text
  }
  return ''
}

/** An icon's name in words — `arrow-top-right` → "Arrow top right" — or ''. */
function iconName(node: PartNode | undefined): string {
  if (node?.componentId !== 'icon') return ''
  const props = node.props as Record<string, unknown> | undefined
  const raw = props?.['iconId'] ?? props?.['icon']
  if (typeof raw !== 'string' || !raw.trim()) return ''
  return humanize(raw.replace(/^(mdi|mui|fa)[-:]/i, ''))
}

function childIds(node: PartNode | undefined): string[] {
  return Array.isArray(node?.nodes)
    ? (node?.nodes as unknown[]).filter(
        (id): id is string => typeof id === 'string',
      )
    : []
}

/** The first words found under a node, depth first; '' when none. */
function firstDescendantText(
  id: string,
  nodes: Record<string, PartNode>,
  values: NameValues,
  seen: Set<string> = new Set(),
): string {
  for (const childId of childIds(nodes[id])) {
    if (seen.has(childId)) continue
    seen.add(childId)
    const own = ownText(nodes[childId], values)
    if (own) return own
    const deeper = firstDescendantText(childId, nodes, values, seen)
    if (deeper) return deeper
  }
  return ''
}

/**
 * A group of like items named by listing them — "Besigner, Console,
 * Commerce…" — or '' when it is not one. Like items are at least
 * {@link COLLECTION_MIN_ITEMS} children of one element type, each holding
 * words: a grid of cards, a row of buttons. Lines of text stacked in a
 * heading are not a collection — the heading is named by its first line.
 */
function collectionText(
  id: string,
  nodes: Record<string, PartNode>,
  values: NameValues,
): string {
  const items = childIds(nodes[id]).filter((child) => nodes[child])
  if (items.length < COLLECTION_MIN_ITEMS) return ''
  const type = nodes[items[0]]?.componentId
  if (friendlyTypeName(type) === 'Text') return ''
  if (!items.every((child) => nodes[child]?.componentId === type)) return ''
  const words = items.map(
    (child) =>
      ownText(nodes[child], values) ||
      firstDescendantText(child, nodes, values),
  )
  return words.every(Boolean) ? words.join(', ') : ''
}

/** Each node's parent, from `parentId` or, failing that, the `nodes` lists. */
function parentOf(
  id: string,
  nodes: Record<string, PartNode>,
): string | undefined {
  const declared = nodes[id]?.parentId
  if (typeof declared === 'string' && nodes[declared]) return declared
  for (const [candidate, node] of Object.entries(nodes)) {
    if (childIds(node).includes(id)) return candidate
  }
  return undefined
}

/**
 * Whether an author typed a node's name, rather than it being the type's own
 * label copied in — "Typography" says nothing "Text" does not.
 */
function isAuthoredName(
  name: string | undefined,
  componentId: string | undefined,
): name is string {
  const trimmed = name?.trim()
  if (!trimmed) return false
  const lower = trimmed.toLowerCase()
  const generic = [
    componentId,
    // `muiTypography` is labeled "Typography" whether or not the registry
    // that says so has loaded.
    componentId?.replace(/^mui(?=[A-Z])/, ''),
    componentId ? components.getLabel(componentId) : undefined,
    friendlyTypeName(componentId),
  ]
  return !generic.some((label) => label && label.toLowerCase() === lower)
}

/** Style keys that give an element a visible surface of its own. */
const SURFACE_KEYS = [
  'bgcolor',
  'backgroundColor',
  'background',
  'backgroundImage',
  'border',
  'borderColor',
  'boxShadow',
]

/** Whether a node paints a surface — a fill, a border or a shadow. */
function hasSurface(node: PartNode | undefined): boolean {
  const props = node?.props as Record<string, unknown> | undefined
  for (const sx of [node?.sx, props?.['sx']]) {
    if (!isPlainRecord(sx)) continue
    for (const key of SURFACE_KEYS) {
      const value = sx[key]
      if (value === undefined || value === null || value === '') continue
      if (value === 'none' || value === 'transparent' || value === 0) continue
      return true
    }
  }
  return false
}

/**
 * The type an author sees: the friendly name, except that a plain group with
 * a surface of its own and words inside it is a Card — the site's own cards
 * are Stacks with a fill, a border and a shadow, and "Group" names none of
 * that (AGL-3293).
 */
function partType(
  node: PartNode | undefined,
  componentId: string | undefined,
  hasWords: boolean,
): string {
  const type = friendlyTypeName(componentId)
  return type === GROUP_TYPE && hasWords && hasSurface(node) ? CARD_TYPE : type
}

/**
 * A wordless container named by what it holds: a box around one icon, a row
 * of icons, a frame around an image. '' when its contents say nothing.
 */
function contentsName(id: string, nodes: Record<string, PartNode>): string {
  const leaves: PartNode[] = []
  const walk = (at: string, seen: Set<string>) => {
    for (const child of childIds(nodes[at])) {
      if (seen.has(child) || !nodes[child]) continue
      seen.add(child)
      if (childIds(nodes[child]).length) walk(child, seen)
      else leaves.push(nodes[child])
    }
  }
  walk(id, new Set([id]))
  if (!leaves.length) return ''
  const types = new Set(leaves.map((leaf) => friendlyTypeName(leaf.componentId)))
  if (types.size !== 1) return ''
  const [type] = [...types]
  if (type === 'Icon') {
    const names = leaves.map(iconName).filter(Boolean)
    if (leaves.length === 1) {
      return names[0] ? `Icon box: ${truncatePreview(names[0])}` : 'Icon box'
    }
    return names.length ? `Icons: ${truncatePreview(names.join(', '))}` : 'Icons'
  }
  if (type === 'Image') return leaves.length === 1 ? 'Image box' : 'Images'
  return ''
}

/**
 * Where a part sits, in words — "Besigner card" — from its NEAREST enclosing
 * element that has a name or words, or '' when nothing encloses it.
 *
 * Nearest, and nothing else: an earlier version skipped plain groups for the
 * first non-group ancestor at any distance, and because the site's cards are
 * groups, every icon in every card was placed in the band's outer container
 * (AGL-3293). The part's own subtree is kept out of the ancestor's words, so
 * a card is never named by the very link being placed in it.
 */
function contextOf(
  id: string,
  nodes: Record<string, PartNode>,
  values: NameValues,
): string {
  const exclude = () => new Set([id])
  const wordsOf = (at: string) =>
    ownText(nodes[at], values) ||
    collectionText(at, nodes, values) ||
    firstDescendantText(at, nodes, values, exclude())
  const typeOf = (at: string) =>
    partType(nodes[at], nodes[at]?.componentId, true)
  const seen = new Set<string>([id])
  let ancestor = parentOf(id, nodes)
  while (ancestor && !seen.has(ancestor)) {
    seen.add(ancestor)
    const node = nodes[ancestor]
    if (isAuthoredName(node?.name, node?.componentId)) {
      return truncatePreview(node.name as string)
    }
    const words = wordsOf(ancestor)
    if (words) {
      // A plain row that only borrows its words from the card around it —
      // an icon beside a title — is placed by that card: "in Besigner card"
      // rather than "in Besigner group". Only while the words stay the same:
      // an outer element named by different words is somewhere else.
      let place = ancestor
      let outer = parentOf(ancestor, nodes)
      while (
        typeOf(place) === GROUP_TYPE &&
        outer &&
        !seen.has(outer) &&
        wordsOf(outer) === words
      ) {
        seen.add(outer)
        place = outer
        outer = parentOf(outer, nodes)
      }
      const chosen = typeOf(place) === GROUP_TYPE ? ancestor : place
      return `${truncatePreview(words)} ${typeOf(chosen).toLowerCase()}`
    }
    ancestor = parentOf(ancestor, nodes)
  }
  return ''
}

/**
 * One part's name, before the list is checked for twins: `base` is what the
 * part is and shows, `context` where it sits, and `needsContext` says the
 * base alone names nothing a reader could find (a bare "Group").
 */
interface PartName {
  base: string
  context: () => string
  needsContext: boolean
}

function namePart(
  entry: PartEntry,
  nodes: Record<string, PartNode>,
  options: DescribePartOptions,
): PartName {
  const kind = options.kind ?? 'component'
  const values: NameValues = {
    propValues: options.propValues,
    propDefaults: options.propDefaults,
  }
  const id = entry.componentInternalId
  const context = () => contextOf(id, nodes, values)
  if (entry.isRoot) {
    return {
      base: placementCopy(kind).wholePart,
      context: () => '',
      needsContext: false,
    }
  }
  const node = nodes[id]
  const componentId = entry.componentId ?? node?.componentId
  const name = entry.name ?? node?.name
  if (isAuthoredName(name, componentId)) {
    return { base: truncatePreview(name), context, needsContext: false }
  }

  const own = ownText(node, values)
  if (own) {
    const type = partType(node, componentId, true)
    const preview = truncatePreview(own)
    const base = QUOTED_TYPES.has(type)
      ? `${type}: "${preview}"`
      : `${type}: ${preview}`
    return { base, context, needsContext: false }
  }

  const icon = iconName(node)
  if (icon) {
    return { base: `Icon: ${truncatePreview(icon)}`, context, needsContext: false }
  }

  const listed = collectionText(id, nodes, values)
  if (listed) {
    const type = partType(node, componentId, true)
    return {
      base: `${type}: ${truncatePreview(listed)}`,
      context,
      needsContext: false,
    }
  }

  const inner = firstDescendantText(id, nodes, values)
  if (inner) {
    const type = partType(node, componentId, true)
    return {
      base: `${type}: ${truncatePreview(inner)}`,
      context,
      needsContext: false,
    }
  }

  const contents = contentsName(id, nodes)
  if (contents) return { base: contents, context, needsContext: false }

  return {
    base: partType(node, componentId, false),
    context,
    needsContext: true,
  }
}

const withContext = (base: string, context: string) =>
  context ? `${base} (in ${context})` : base

/**
 * The picker's name for one part of a definition (AGL-3288, AGL-3293): what
 * it IS in an author's words, and what it SHOWS.
 *
 * - The outermost element is "Whole component" / "Whole form".
 * - A name the definition's author gave the element wins outright.
 * - An element with words of its own reads `Button: Start free`, or
 *   `Text: "Design on a live canvas…"` for running text — a declared
 *   property's token read as this page shows it, or as its default.
 * - An icon reads by its icon: `Icon: Arrow top right`.
 * - A group of like items is named by listing them:
 *   `Group: Besigner, Console, Commerce…`.
 * - Any other container is named by the first words inside it, and one with
 *   a surface of its own is a Card: `Card: Besigner`.
 * - A wordless container is named by what it holds: `Icon box: View grid`.
 * - An element with nothing to read is placed by the nearest enclosing
 *   element that has words: `Group (in Besigner card)`.
 *
 * A single name can still have twins elsewhere in the component — twelve
 * cards each have an "Icon: Arrow top right". {@link describeParts} names a
 * whole list and tells the twins apart.
 */
export function describePart(
  entry: PartEntry,
  definitionNodes: Record<string, PartNode> | null | undefined,
  options: DescribePartOptions = {},
): string {
  const nodes = (definitionNodes ?? {}) as Record<string, PartNode>
  const named = namePart(entry, nodes, options)
  return named.needsContext ? withContext(named.base, named.context()) : named.base
}

/**
 * Names for every part of a definition, keyed like the entries, with no two
 * alike (AGL-3293): parts that would share a name are told apart by where
 * they sit — "Icon: Arrow top right (in Besigner card)" — and, where even
 * that repeats, by number.
 */
export function describeParts<E extends PartEntry & { key: string }>(
  entries: readonly E[],
  definitionNodes: Record<string, PartNode> | null | undefined,
  options: DescribePartOptions = {},
): Map<string, string> {
  const nodes = (definitionNodes ?? {}) as Record<string, PartNode>
  const named = entries.map((entry) => ({
    key: entry.key,
    ...namePart(entry, nodes, options),
  }))
  const baseCounts = new Map<string, number>()
  for (const part of named) {
    baseCounts.set(part.base, (baseCounts.get(part.base) ?? 0) + 1)
  }
  const labels = named.map((part) =>
    part.needsContext || (baseCounts.get(part.base) ?? 0) > 1
      ? withContext(part.base, part.context())
      : part.base,
  )
  const labelCounts = new Map<string, number>()
  for (const label of labels) {
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1)
  }
  const seen = new Map<string, number>()
  const byKey = new Map<string, string>()
  named.forEach((part, index) => {
    const label = labels[index]
    if ((labelCounts.get(label) ?? 0) > 1) {
      const n = (seen.get(label) ?? 0) + 1
      seen.set(label, n)
      byKey.set(part.key, `${label} #${n}`)
    } else {
      byKey.set(part.key, label)
    }
  })
  return byKey
}

// ---------------------------------------------------------------------------
// Naming style settings
// ---------------------------------------------------------------------------

/** Spacing keys the box editor writes, named the way the editor shows them. */
const SPACING_LABELS: Record<string, string> = {
  m: 'Margin',
  margin: 'Margin',
  mt: 'Top margin',
  marginTop: 'Top margin',
  mr: 'Right margin',
  marginRight: 'Right margin',
  mb: 'Bottom margin',
  marginBottom: 'Bottom margin',
  ml: 'Left margin',
  marginLeft: 'Left margin',
  mx: 'Left & right margin',
  marginInline: 'Left & right margin',
  marginX: 'Left & right margin',
  my: 'Top & bottom margin',
  marginBlock: 'Top & bottom margin',
  marginY: 'Top & bottom margin',
  p: 'Padding',
  padding: 'Padding',
  pt: 'Top padding',
  paddingTop: 'Top padding',
  pr: 'Right padding',
  paddingRight: 'Right padding',
  pb: 'Bottom padding',
  paddingBottom: 'Bottom padding',
  pl: 'Left padding',
  paddingLeft: 'Left padding',
  px: 'Left & right padding',
  paddingInline: 'Left & right padding',
  paddingX: 'Left & right padding',
  py: 'Top & bottom padding',
  paddingBlock: 'Top & bottom padding',
  paddingY: 'Top & bottom padding',
  bgcolor: 'Background Color',
  textAlign: 'Text Alignment',
}

/**
 * The name of one changed style setting, as the Styles tab labels its field
 * — never the stored key. `fieldLabels` is the panel's own field-name →
 * label map; a key it does not cover is spelled out in words, and a raw CSS
 * selector reads as "Custom CSS".
 */
export function styleChangeLabel(
  property: string,
  fieldLabels?: Record<string, string>,
): string {
  const fromPanel = fieldLabels?.[property]
  if (fromPanel) return fromPanel
  if (SPACING_LABELS[property]) return SPACING_LABELS[property]
  if (/^[&@:.#[]/.test(property) || /\s/.test(property)) return 'Custom CSS'
  return humanize(property) || property
}
