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

import { CANVAS_ROOT_ELEMENT_ID } from '../foundation/constants/canvas'
import {
  ANIMATION_MAX_DELAY_MS,
  ANIMATION_MAX_DURATION_MS,
  ANIMATION_MAX_STAGGER_STEP_MS,
  NODE_ANIMATION_DELAY_PROP,
  NODE_ANIMATION_DURATION_PROP,
  NODE_ANIMATION_EASE_PROP,
  NODE_ANIMATION_PROPS,
  NODE_ANIMATION_PROP,
  NODE_ANIMATION_STAGGER_PROP,
  NODE_ANIMATION_STAGGER_STEP_PROP,
  NODE_ANIMATION_TRIGGER_PROP,
  type AnimationEase,
  type AnimationPreset,
  type AnimationTrigger,
} from './element-animation'

/**
 * Entrance motion for a whole page (AGL-3838): the pass that writes the
 * existing animation props (`element-animation.ts`) onto a page built by
 * code — a starter, a new site's home, a page the AI composed — so it moves
 * the way an author would have set it up by hand in the attributes panel.
 *
 * Nothing new is rendered or shipped: the pass only writes the reserved
 * `aglynAnimation*` props the renderer and the tenant's stylesheet already
 * read, with values from their own vocabulary. A page that moves pays the
 * stylesheet and the scroll observer it always paid; a page this pass leaves
 * alone pays nothing.
 *
 * ## The rules
 *
 *  - The FIRST section's secondary content — its eyebrow, its lede, its
 *    buttons, a small picture — plays on `load`, as a short ladder: each
 *    block starts {@link ElementMotionCharacter.heroStepMs} after the one
 *    before. Its main heading and its largest picture, the candidates for the
 *    page's Largest Contentful Paint, never move: they are painted where
 *    they stand from the first frame. Its band — a background color or a
 *    cover photo — never moves either.
 *  - Every later section's content slides in on `scroll`, each section in
 *    turn taking the next of the character's {@link
 *    ElementMotionCharacter.sectionPresets}, so a page does not arrive as
 *    one repeated move.
 *  - A split — a column of words beside a picture — comes in from its
 *    sides when the character says {@link ElementMotionCharacter.sides}:
 *    the left column from the left, the right from the right, the second a
 *    stagger step after the first. A picture whose preset zooms keeps its
 *    zoom. Without sides its columns still arrive one after the other, the
 *    picture's in the media preset and the words' in the section's.
 *  - A group of like items — a grid of cards, a list, the questions of an
 *    FAQ, a dataset repeated over one card — STAGGERS its items, one after
 *    another, rather than arriving as one block, in the character's {@link
 *    ElementMotionCharacter.groupPreset} where it names one.
 *  - A picture, and a group whose items each lead with one, takes the
 *    character's media preset.
 *  - Never touched: forms and their fields, navigation and the site's frame,
 *    anything out of the flow (`position: fixed | sticky | absolute` — a
 *    cover photo's backdrop is its band's), anything hidden, and
 *    anything that already carries an animation prop — an author's choice,
 *    `none` included, is never overwritten. A block that HOLDS one of those
 *    is not animated as a whole either; its other children are animated one
 *    by one instead, so a form never slides in with its section.
 *  - Except a picture's FRAME: a box in the flow whose picture is laid over
 *    it (`position: absolute`), as the AI's layout compiler draws every
 *    picture slot. The frame is the picture, so it moves as one, picture and
 *    all, and counts as a picture for the media preset and for a split.
 *  - Never nested: once a block animates, nothing inside it does. Two
 *    entrances on the same pixels multiply their fades and add their
 *    offsets, which reads as a stutter, not as motion.
 *
 * Pure and idempotent: a page it already moved comes back as the same
 * object, which is what lets a caller compare by identity to skip a write.
 *
 * Leaf imports only, the same as `starter-template-nodes.ts`: the starter
 * kit reads this from the console's client gallery and its seed route alike.
 */

/** A page's motion: the presets, curve and timing every entrance on it shares. */
export interface ElementMotionCharacter {
  /** Words and blocks: a section's content, a group of cards. */
  preset: AnimationPreset
  /** A picture, or a group whose every item leads with one. */
  mediaPreset: AnimationPreset
  ease: AnimationEase
  durationMs: number
  /** Gap between the items of a staggered group. */
  staggerStepMs: number
  /** Gap between the rungs of the first section's load ladder. */
  heroStepMs: number
  /**
   * The presets later sections take in turn, the second section the first of
   * them; {@link preset} alone when absent. A section's pictures still take
   * {@link mediaPreset}.
   */
  sectionPresets?: readonly AnimationPreset[]
  /** Whether a split's two columns come in from their own sides. */
  sides?: boolean
  /**
   * What a group of like items — a grid of cards, a list, an FAQ — arrives
   * with, whatever its section's turn; the section's own preset when absent.
   * A group whose every item leads with a picture still takes {@link mediaPreset}.
   */
  groupPreset?: AnimationPreset
}

/** The motion a page gets when nothing says otherwise: a soft rise, as the attributes panel defaults to. */
export const ELEMENT_MOTION_DEFAULT: ElementMotionCharacter = {
  preset: 'slide-up',
  mediaPreset: 'fade',
  ease: 'smooth',
  durationMs: 600,
  staggerStepMs: 90,
  heroStepMs: 120,
  sectionPresets: ['slide-up', 'fade'],
  sides: true,
}

/** The most rungs the first section's ladder climbs; later blocks share the last. */
export const ELEMENT_MOTION_HERO_RUNGS = 6

/**
 * Elements that are never animated, nor animated as part of a block that
 * holds them: forms and every field of one, and the site's navigation and
 * frame. A field that slides in under a visitor's cursor is a field they
 * miss, and a header that moves is a site that looks broken.
 */
export const ELEMENT_MOTION_NEVER: ReadonlySet<string> = new Set([
  // Forms and their fields.
  'form',
  'formField',
  'muiFormControl',
  'muiFormLabel',
  'muiFormControlLabel',
  'muiFormHelperText',
  'muiInput',
  'muiSelect',
  'muiSelectOption',
  'muiRadioGroup',
  'muiRadio',
  'muiCheckbox',
  'muiRating',
  'muiDatePicker',
  'muiTimePicker',
  'newsletter-signup',
  'member-signin',
  'member-signup',
  'member-recovery',
  'booking',
  'reservation-widget',
  'customer-account',
  'return-request',
  'order-status',
  'quote-page',
  'searchBox',
  'collectionSearch',
  // Navigation and the site's frame.
  'layoutSlot',
  'muiAppBar',
  'muiToolbar',
  'muiDrawer',
  'muiDrawerToggle',
  'muiNavMenu',
  'muiMegaMenu',
  'muiBreadcrumbs',
  'muiTabs',
  'languageSwitcher',
  'themeModeSwitcher',
  'cart',
])

/** Pictures: what the media preset is for. */
const MEDIA: ReadonlySet<string> = new Set(['image', 'video', 'videoEmbed', 'gated-video'])

/** Components that list like items whatever their children are. */
const LISTS: ReadonlySet<string> = new Set(['muiList', 'muiImageList', 'collectionEntries'])

/**
 * What a group's items are made of when they are alike: cards, cells,
 * panels, pictures. Words and buttons never count, however alike — a row of
 * two buttons is a call to action, not a group of cards.
 */
const ITEMS: ReadonlySet<string> = new Set([
  'muiCard',
  'muiPaper',
  'muiGrid',
  'muiStack',
  'muiBox',
  'muiLinkBox',
  'muiListItem',
  'muiImageListItem',
  'muiAccordion',
  'reusableInstance',
  'div',
  'image',
  'video',
])

interface MotionNode {
  componentId?: string
  props?: Record<string, unknown>
  sx?: Record<string, unknown>
  nodes?: string[]
  hidden?: boolean
}

export interface ElementMotionOptions {
  /** The page's root; the canvas root when absent. */
  rootId?: string
  /** The page's sections in order; the root's own children when absent. */
  sectionIds?: readonly string[]
  character?: ElementMotionCharacter
}

const clamp = (value: number, max: number): number => Math.min(Math.max(Math.round(value), 0), max)

/**
 * Whether a style value — plain or one per breakpoint — takes the element out
 * of the flow: pinned to the screen, or laid over its band, as a cover
 * photo's backdrop and its scrim are. Either is part of the band, not of what
 * the band holds.
 */
function pins(value: unknown): boolean {
  if (value === 'fixed' || value === 'sticky' || value === 'absolute') return true
  return typeof value === 'object' && value !== null && Object.values(value).some(pins)
}

/**
 * Writes entrance motion onto a page's nodes by the rules above, and returns
 * the new node map — or `nodes` itself, unchanged, when there was nothing to
 * move.
 */
export function applyElementMotion<T extends Record<string, any>>(nodes: T, options: ElementMotionOptions = {}): T {
  if (!nodes) return nodes
  const character = options.character ?? ELEMENT_MOTION_DEFAULT
  const rootId = options.rootId ?? CANVAS_ROOT_ELEMENT_ID
  const node = (id: string): MotionNode | undefined => nodes[id] as MotionNode | undefined
  const children = (id: string): string[] => (node(id)?.nodes ?? []).filter((child) => typeof child === 'string' && !!node(child))
  const patches = new Map<string, Record<string, unknown>>()

  /** The first section's Largest Contentful Paint candidates, painted where they stand. */
  const still = new Set<string>()
  /** Left alone for what it is, wherever it stands. */
  const refused = (id: string): boolean => {
    const at = node(id)
    if (!at) return true
    if (at.hidden || still.has(id)) return true
    if (ELEMENT_MOTION_NEVER.has(String(at.componentId ?? ''))) return true
    return !!at.props && NODE_ANIMATION_PROPS.some((prop) => at.props?.[prop] !== undefined)
  }
  /** Left alone, and so is everything inside it. */
  const closed = (id: string): boolean => refused(id) || pins(node(id)?.sx?.['position'])
  /** A picture laid over its box, free to move with it. */
  const overlay = (id: string): boolean =>
    MEDIA.has(String(node(id)?.componentId ?? '')) && pins(node(id)?.sx?.['position']) && !refused(id)
  /**
   * A picture's frame: a box in the flow whose picture is laid over it
   * (`position: absolute`, filling it), beside at most the placeholder icon
   * an empty slot shows. The frame IS the picture, so it moves as one,
   * picture and all; its picture being out of the flow does not hold it still
   * the way a cover's backdrop holds its band, which is itself out of the flow.
   */
  const isFrame = (id: string): boolean => {
    const kids = children(id)
    return (
      !closed(id) &&
      kids.some(overlay) &&
      kids.every((child) => overlay(child) || (node(child)?.componentId === 'icon' && !refused(child) && !children(child).length))
    )
  }
  const holdsClosed = new Map<string, boolean>()
  /** The element, or one inside it, is left alone: it cannot move as one block. */
  const holds = (id: string): boolean => {
    const known = holdsClosed.get(id)
    if (known !== undefined) return known
    holdsClosed.set(id, false)
    const result = closed(id) || (!isFrame(id) && children(id).some(holds))
    holdsClosed.set(id, result)
    return result
  }
  const groupMemo = new Map<string, boolean>()
  const belowMemo = new Map<string, boolean>()
  /**
   * A group of like items, whose items stagger. A grid or a row of panels
   * that holds a group of its own is the LAYOUT around it — a heading beside
   * its cards — so it is opened up and the group inside staggers instead.
   */
  const isGroup = (id: string): boolean => {
    const known = groupMemo.get(id)
    if (known !== undefined) return known
    const at = node(id) as MotionNode
    const componentId = String(at.componentId ?? '')
    const kids = children(id)
    let result: boolean
    // A dataset repeated over one card renders one child per record.
    if ((at.props?.['repeatDataset'] || LISTS.has(componentId)) && kids.length) result = true
    else if (kids.length < 2) result = false
    else {
      const first = String(node(kids[0])?.componentId ?? '')
      const alike =
        (componentId === 'muiGrid' && !!at.props?.['container']) ||
        (ITEMS.has(first) && kids.every((child) => node(child)?.componentId === first))
      result = alike && !holdsGroup(id)
    }
    groupMemo.set(id, result)
    return result
  }
  /** A group sits somewhere inside the element. */
  const holdsGroup = (id: string): boolean => {
    const known = belowMemo.get(id)
    if (known !== undefined) return known
    const result = children(id).some((child) => isGroup(child) || holdsGroup(child))
    belowMemo.set(id, result)
    return result
  }
  /** Leads with a picture: its first leaf, down its first children, is one, or the frame of one. */
  const leadsWithMedia = (id: string): boolean => {
    let at = id
    for (let depth = 0; depth < 12; depth += 1) {
      if (MEDIA.has(String(node(at)?.componentId ?? '')) || isFrame(at)) return true
      const kids = children(at)
      if (!kids.length) return false
      at = kids[0]
    }
    return false
  }
  const presetOf = (id: string, group: boolean, words: AnimationPreset): AnimationPreset => {
    const media = group ? children(id).every(leadsWithMedia) : leadsWithMedia(id)
    return media ? character.mediaPreset : words
  }

  const animate = (
    id: string,
    trigger: AnimationTrigger,
    delayMs: number,
    words: AnimationPreset = character.preset,
    side?: AnimationPreset,
  ): void => {
    const group = isGroup(id)
    const preset = presetOf(id, group, group && character.groupPreset ? character.groupPreset : words)
    patches.set(id, {
      [NODE_ANIMATION_PROP]: side && !preset.startsWith('zoom') ? side : preset,
      [NODE_ANIMATION_TRIGGER_PROP]: trigger,
      [NODE_ANIMATION_DURATION_PROP]: clamp(character.durationMs, ANIMATION_MAX_DURATION_MS),
      ...(delayMs > 0 ? { [NODE_ANIMATION_DELAY_PROP]: clamp(delayMs, ANIMATION_MAX_DELAY_MS) } : {}),
      [NODE_ANIMATION_EASE_PROP]: character.ease,
      ...(group
        ? {
            [NODE_ANIMATION_STAGGER_PROP]: true,
            [NODE_ANIMATION_STAGGER_STEP_PROP]: clamp(character.staggerStepMs, ANIMATION_MAX_STAGGER_STEP_MS),
          }
        : {}),
    })
  }

  /** Down through wrappers of one child, to where a section's content starts. */
  const contentOf = (id: string): string => {
    let at = id
    while (!closed(at) && !isGroup(at)) {
      const kids = children(at)
      if (kids.length !== 1) break
      at = kids[0]
    }
    return at
  }

  /**
   * A column of words beside a picture: two blocks, one of which leads with a
   * picture and one of which does not, neither left alone. Two cards that
   * both lead with one are a group, and stagger.
   */
  const isSplit = (id: string): boolean => {
    const kids = children(id)
    return kids.length === 2 && leadsWithMedia(kids[0]) !== leadsWithMedia(kids[1]) && !kids.some(holds)
  }

  /** A later section's content: on scroll, groups staggered, splits from their sides, nothing nested. */
  const place = (id: string, words: AnimationPreset): void => {
    if (closed(id)) return
    if (isSplit(id)) {
      const [start, end] = children(id)
      animate(start, 'scroll', 0, words, character.sides ? 'slide-right' : undefined)
      animate(end, 'scroll', character.staggerStepMs, words, character.sides ? 'slide-left' : undefined)
      return
    }
    if (holds(id) || (!isGroup(id) && holdsGroup(id))) {
      for (const child of children(id)) place(child, words)
      return
    }
    animate(id, 'scroll', 0, words)
  }

  /** Down through wrappers of one child that are free to move. */
  const descend = (id: string): string => {
    let at = id
    for (let kids = children(at); kids.length === 1 && !closed(kids[0]); kids = children(at)) at = kids[0]
    return at
  }

  /**
   * The first section's content: on load, one rung per block, around the
   * blocks that stay still. A rung that holds one is opened up, down to the
   * parts beside it, so the eyebrow, the lede and the buttons still climb.
   */
  const ladder = (id: string): void => {
    if (closed(id)) return
    // A repeat's one child is the card every record is drawn with: the
    // repeat staggers its records rather than each record playing at once.
    if (isGroup(id) && children(id).length < 2) return animate(id, 'load', 0)
    const around = (at: string): string[] =>
      children(at).flatMap((child) => (closed(child) ? [] : holds(child) ? around(child) : [child]))
    const base = children(id).length ? around(id) : [id]
    // A column of words beside a picture is opened up, so its lines climb one
    // after another before the picture lands.
    const rungs: string[] = []
    base.forEach((rung, index) => {
      const inner = descend(rung)
      const kids = children(inner)
      const opens =
        kids.length >= 2 &&
        !isGroup(inner) &&
        !leadsWithMedia(inner) &&
        rungs.length + kids.length + (base.length - index - 1) <= ELEMENT_MOTION_HERO_RUNGS
      rungs.push(...(opens ? kids : [rung]))
    })
    // A rung left alone takes no step of the ladder: the first block that moves starts at once.
    rungs
      .filter((rung) => !closed(rung))
      .forEach((rung, index) => animate(rung, 'load', Math.min(index, ELEMENT_MOTION_HERO_RUNGS - 1) * character.heroStepMs))
  }

  /**
   * What the first section paints first, and so what Lighthouse times as its
   * Largest Contentful Paint (AGL-3581): its main heading — the h1, else its
   * first heading — and its largest picture. Neither ever starts at opacity 0,
   * which would hold the paint back by the length of the entrance.
   */
  const markStill = (sectionId: string): void => {
    const order: string[] = []
    const walk = (id: string): void => {
      order.push(id)
      for (const child of children(id)) walk(child)
    }
    walk(sectionId)
    const typeOf = (id: string) => {
      const at = node(id)
      return at?.componentId === 'muiTypography' ? String(at.props?.['variant'] ?? '') : null
    }
    const main = (id: string) => /^(h1|display)/i.test(typeOf(id) ?? '') || (typeOf(id) !== null && node(id)?.props?.['component'] === 'h1')
    const heading = order.find(main) ?? order.find((id) => /^(h[1-6]|display)/i.test(typeOf(id) ?? ''))
    if (heading) still.add(heading)
    const size = (id: string): number => {
      const at = node(id)
      const read = (value: unknown) => (typeof value === 'number' ? value : parseFloat(String(value ?? '')) || 0)
      return Math.max(read(at?.props?.['height']), read(at?.props?.['width']), read(at?.sx?.['height']), read(at?.sx?.['width']))
    }
    let picture: string | undefined
    for (const id of order) {
      if (MEDIA.has(String(node(id)?.componentId ?? '')) && (picture === undefined || size(id) > size(picture))) picture = id
    }
    if (picture) still.add(picture)
  }

  const sections = (options.sectionIds ?? children(rootId)).filter((id) => !!node(id))
  if (sections[0]) markStill(sections[0])
  const turns = character.sectionPresets?.length ? character.sectionPresets : [character.preset]
  sections.forEach((id, index) => {
    if (closed(id)) return
    const content = contentOf(id)
    // The band itself never moves — only what it holds — so a section that
    // is nothing but its band has nothing to move.
    if (content === id && !children(id).length) return
    const words = turns[(index - 1) % turns.length] ?? character.preset
    if (index === 0) ladder(content)
    else if (content === id && !isGroup(id) && !isSplit(id))
      for (const child of children(id)) place(child, words)
    else place(content, words)
  })

  if (!patches.size) return nodes
  const next: Record<string, any> = { ...nodes }
  for (const [id, props] of patches) {
    next[id] = { ...nodes[id], props: { ...(nodes[id]?.props ?? {}), ...props } }
  }
  return next as T
}
