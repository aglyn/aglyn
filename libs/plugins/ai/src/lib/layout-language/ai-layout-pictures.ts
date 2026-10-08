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

import { DEFAULT_SITE_IMAGES } from '@aglyn/aglyn/app-utils/default-site'
import type { NodesMap } from '@aglyn/aglyn/types/nodes'

/**
 * THE PICTURES OF A LANGUAGE PAGE (AGL-3660).
 *
 * The compiler writes a picture slot as a frame holding an icon and an
 * `image` with alt text and no source (`ai-layout-compiler.ts`), and stays
 * pure: it never looks a photo up. This module is what runs after it, on the
 * stored page — it finds each empty slot, decides what kind of picture the
 * slot is, and fills it with a photo the site can serve from its own origin.
 *
 * Two sources fill a slot, in order:
 *
 * 1. A stock photo searched for by the slot's own description and copied into
 *    the site's media library (`jobs/ai-layout-stock-photos.ts`), when the
 *    deployment has a stock-photo key.
 * 2. Otherwise, or when the search finds nothing fitting, one of the STARTER
 *    PHOTOS every new site is born with (`DEFAULT_SITE_IMAGES`, served at
 *    `/_static/starter/` by the tenant and the console alike, credited in the
 *    CREDITS file beside them). They are the platform's own files, so a
 *    visitor's browser asks no other host for them.
 *
 * The slot keeps the alt text the model wrote whichever source fills it.
 */

/** What a picture slot is for, read from where it sits and what it says. */
export type AiLayoutPictureRole = 'hero' | 'about' | 'gallery'

/** One empty picture slot of a stored page, in document order. */
export interface AiLayoutPictureSlot {
  /** The `image` node. */
  imageId: string
  /** The frame around it, which sets the slot's shape. */
  frameId: string | null
  /** The placeholder icon sharing the frame, taken out once a photo fills it. */
  iconId: string | null
  alt: string
  /** The frame's shape as width over height; 1 when it names none. */
  aspect: number
  /** The plan index of the section it sits in, or -1. */
  sectionIndex: number
  role: AiLayoutPictureRole
}

/** A photo a slot is filled with. */
export interface AiLayoutPicturePhoto {
  /** The site-served address: a starter path or the media library's own. */
  src: string
  width: number
  height: number
}

/** Words that say a picture shows people, or a section is about them. */
const PEOPLE =
  /\b(about|team|story|owner|owners|founder|founders|staff|crew|people|person|portrait|meet|family|families|who we are|our (?:team|crew|people|story)|therapist|counsel(?:l)?or|coach|doctor|dentist|stylist|trainer|smil(?:e|es|ing)|headshot)\b/i

/**
 * An `aspectRatio` (`'16 / 9'`) as a number, or `null` where none is named.
 * A responsive one (`{ xs: '4 / 3', md: '4 / 5' }`, as a designed page's
 * pictures carry, AGL-3660) reads at the desktop breakpoint first: one photo
 * serves every width, and the wide screen is where its shape shows most.
 */
function aspectOf(value: unknown): number | null {
  if (value && typeof value === 'object') {
    const byBreakpoint = value as Record<string, unknown>
    for (const breakpoint of ['md', 'lg', 'xl', 'sm', 'xs']) {
      const ratio = aspectOf(byBreakpoint[breakpoint])
      if (ratio !== null) return ratio
    }
    return null
  }
  const match = /^\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/.exec(String(value ?? ''))
  if (!match) return null
  const ratio = Number(match[1]) / Number(match[2])
  return Number.isFinite(ratio) && ratio > 0 ? ratio : null
}

/** The shape a full-bleed cover's photo is searched for: it fills a wide band. */
const COVER_ASPECT = 16 / 9

/**
 * A slot's shape (AGL-3660): the image's own `aspectRatio` (a designed
 * picture card sets it on the image), else its frame's, else — for a frame
 * laid absolutely over its whole section, a designed photo cover — a wide
 * band's. 1 where nothing says.
 */
function slotAspect(image: { sx?: Record<string, unknown> } | undefined, frame: { sx?: Record<string, unknown> } | undefined): number {
  const own = aspectOf(image?.sx?.['aspectRatio']) ?? aspectOf(frame?.sx?.['aspectRatio'])
  if (own !== null) return own
  const sx = frame?.sx
  if (sx?.['position'] === 'absolute' && sx['width'] === '100%' && sx['height'] === '100%') return COVER_ASPECT
  return 1
}

/** A slot's role: the first section's picture is the hero; people make an about picture. */
export function aiLayoutPictureRole(input: {
  sectionIndex: number
  sectionName: string
  alt: string
}): AiLayoutPictureRole {
  if (input.sectionIndex === 0) return 'hero'
  if (PEOPLE.test(input.sectionName) || PEOPLE.test(input.alt)) return 'about'
  return 'gallery'
}

/**
 * Every empty picture slot of a stored page, walked from its root in
 * document order. A slot that already has a source — one the owner placed, or
 * an earlier pass filled — is not a slot.
 */
export function aiLayoutPictureSlots(
  nodes: NodesMap,
  rootId: string,
  sections: { ids: readonly string[]; names: readonly string[] },
): AiLayoutPictureSlot[] {
  const map = nodes as unknown as Record<
    string,
    { componentId?: string; props?: Record<string, unknown>; sx?: Record<string, unknown>; nodes?: string[] }
  >
  const slots: AiLayoutPictureSlot[] = []
  const seen = new Set<string>()
  const visit = (id: string, parentId: string | null, sectionIndex: number) => {
    if (seen.has(id)) return
    seen.add(id)
    const node = map[id]
    if (!node) return
    const index = sections.ids.indexOf(id)
    const here = index >= 0 ? index : sectionIndex
    if (node.componentId === 'image') {
      const src = node.props?.['src']
      const alt = typeof node.props?.['alt'] === 'string' ? (node.props['alt'] as string).trim() : ''
      if ((typeof src !== 'string' || !src.trim()) && alt) {
        const frame = parentId ? map[parentId] : undefined
        const iconId =
          frame?.nodes?.find((child) => child !== id && map[child]?.componentId === 'icon') ?? null
        slots.push({
          imageId: id,
          frameId: frame ? parentId : null,
          iconId,
          alt,
          aspect: slotAspect(node, frame),
          sectionIndex: here,
          role: aiLayoutPictureRole({
            sectionIndex: here,
            sectionName: here >= 0 ? (sections.names[here] ?? '') : '',
            alt,
          }),
        })
      }
    }
    for (const child of node.nodes ?? []) visit(child, id, here)
  }
  visit(rootId, null, -1)
  return slots
}

/** The starter photos, by name. */
export const AI_LAYOUT_STARTER_PHOTOS = DEFAULT_SITE_IMAGES

type StarterName = keyof typeof AI_LAYOUT_STARTER_PHOTOS

/**
 * The starter photos each role draws from, best first. A hero draws from the
 * wide photos that read as a page's opening, an about picture leads with the
 * owner, and the rest are the gallery's.
 */
const STARTER_POOLS: Readonly<Record<AiLayoutPictureRole, readonly StarterName[]>> = {
  hero: ['hero', 'desk', 'craft'],
  about: ['about', 'hero'],
  gallery: ['desk', 'plants', 'craft'],
}

const ALL_STARTERS = Object.keys(AI_LAYOUT_STARTER_PHOTOS) as StarterName[]

/** A small stable number from a seed, so the same job always picks the same photos. */
export function aiLayoutSeedNumber(seed: string): number {
  let hash = 2166136261
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function rotate<T>(list: readonly T[], by: number): T[] {
  if (!list.length) return []
  const start = by % list.length
  return [...list.slice(start), ...list.slice(0, start)]
}

/**
 * A starter photo for each slot. The hero's and the gallery's pools are
 * rotated by the seed, so sites do not all open with the same photo, while an
 * about picture always leads with the owner; no photo repeats on a page
 * while one is still unused; and a page with more slots than photos starts
 * the round again from its role's pool.
 */
export function aiLayoutStarterPhotos(
  slots: readonly AiLayoutPictureSlot[],
  seed: string,
): AiLayoutPicturePhoto[] {
  const turn = aiLayoutSeedNumber(seed)
  const used = new Set<StarterName>()
  return slots.map((slot) => {
    // An about picture leads with the owner on every site; the others turn.
    const pool =
      slot.role === 'about' ? [...STARTER_POOLS.about] : rotate(STARTER_POOLS[slot.role], turn)
    const rest = rotate(
      ALL_STARTERS.filter((name) => !pool.includes(name)),
      turn,
    )
    if (used.size >= ALL_STARTERS.length) used.clear()
    const name = [...pool, ...rest].find((candidate) => !used.has(candidate)) ?? pool[0]
    used.add(name)
    const photo = AI_LAYOUT_STARTER_PHOTOS[name]
    return { src: photo.src, width: photo.width, height: photo.height }
  })
}

/**
 * The page with each slot filled by its photo: the `image` given its source,
 * its intrinsic size and how it loads (the hero eagerly, as the starter home
 * page loads its own), and the placeholder icon taken out of the frame. The
 * alt text is kept as the model wrote it. A slot given no photo is left as
 * the compiler wrote it.
 */
export function aiLayoutPlacePictures(
  nodes: NodesMap,
  slots: readonly AiLayoutPictureSlot[],
  photos: ReadonlyArray<AiLayoutPicturePhoto | null>,
): NodesMap {
  const next = { ...(nodes as unknown as Record<string, Record<string, unknown>>) }
  slots.forEach((slot, index) => {
    const photo = photos[index]
    const node = next[slot.imageId]
    if (!photo || !node) return
    next[slot.imageId] = {
      ...node,
      props: {
        ...((node['props'] as Record<string, unknown> | undefined) ?? {}),
        src: photo.src,
        intrinsicWidth: photo.width,
        intrinsicHeight: photo.height,
        loading: slot.role === 'hero' ? 'eager' : 'lazy',
      },
    }
    if (slot.iconId && slot.frameId && next[slot.frameId]) {
      const frame = next[slot.frameId]
      next[slot.frameId] = {
        ...frame,
        nodes: ((frame['nodes'] as string[] | undefined) ?? []).filter((child) => child !== slot.iconId),
      }
      delete next[slot.iconId]
    }
  })
  return next as unknown as NodesMap
}

/**
 * A source of photos found for the slots themselves — a stock search copied
 * into the site's library — answering one photo or `null` per slot, in order.
 * It may throw; a slot it leaves unfilled takes a starter photo.
 */
export type AiLayoutPictureSource = (
  slots: readonly AiLayoutPictureSlot[],
) => Promise<ReadonlyArray<AiLayoutPicturePhoto | null>>

/**
 * Fills a stored page's empty picture slots (AGL-3660): from `source` where
 * one is given and it answers, else from the starter photos. Never throws,
 * and never leaves a page worse than it came: a picture is decoration, and a
 * job never fails over one.
 */
export async function aiResolveLayoutPictures(
  nodes: NodesMap,
  input: {
    rootId: string
    sectionIds: readonly string[]
    sectionNames: readonly string[]
    /** A per-job word, so two sites do not open with the same photo. */
    seed: string
    source?: AiLayoutPictureSource | null
  },
): Promise<NodesMap> {
  try {
    const slots = aiLayoutPictureSlots(nodes, input.rootId, {
      ids: input.sectionIds,
      names: input.sectionNames,
    })
    if (!slots.length) return nodes
    let found: ReadonlyArray<AiLayoutPicturePhoto | null> = []
    if (input.source) {
      try {
        found = await input.source(slots)
      } catch (error) {
        console.warn('ai layout pictures: the stock source failed; starter photos fill the page', { error })
        found = []
      }
    }
    const starters = aiLayoutStarterPhotos(slots, input.seed)
    return aiLayoutPlacePictures(
      nodes,
      slots,
      slots.map((_slot, index) => found[index] ?? starters[index]),
    )
  } catch (error) {
    console.error('ai layout pictures: the page keeps its empty picture slots', { error })
    return nodes
  }
}
