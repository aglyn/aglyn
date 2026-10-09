/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
 *
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

import { CANVAS_ROOT_ELEMENT_ID } from '@aglyn/aglyn/foundation/constants/canvas'
import type { NodesMap } from '@aglyn/aglyn/types/nodes'
import { aiLayoutPageCheck } from '../jobs/ai-job-page-language'
import {
  AI_LAYOUT_STARTER_PHOTOS,
  aiLayoutPictureSlots,
  aiLayoutStarterPhotos,
  aiResolveLayoutPictures,
  type AiLayoutPictureSlot,
} from './ai-layout-pictures'

const block = (kind: string, text: string, col = -1) => ({ kind, col, text, to: '', icon: '', style: 'none', items: [] })

const SECTIONS = [
  { name: 'Hero', uses: [], items: 0 },
  { name: 'About us', uses: [], items: 0 },
  { name: 'Our work', uses: [], items: 0 },
]
const SECTION_IDS = ['sec-0', 'sec-1', 'sec-2']

/** A stored three-section towing page with a picture in each section. */
function towingPage(): NodesMap {
  const result = aiLayoutPageCheck({
    screen: { title: 'Home', slug: '/', template: null, sections: SECTIONS } as never,
    sectionIds: SECTION_IDS,
    targets: { pageId: 'p0', pages: [], homeIds: [], forms: [], formPageId: null, components: [], facts: 'A towing company.' } as never,
    context: { screenIds: [], formIds: [], componentIds: [], codeBuilt: true, scrollTargetIds: SECTION_IDS },
    reusableComponents: false,
  })({
    sections: [
      {
        band: 'plain',
        align: 'start',
        cols: [6, 6],
        blocks: [
          block('heading', 'Fast towing, day or night', 0),
          block('lede', 'We reach you within the hour.', 0),
          block('image', 'A tow truck lifting a car on a highway at dusk', 1),
        ],
      },
      {
        band: 'soft',
        align: 'start',
        cols: [],
        blocks: [block('heading', 'About us'), block('text', 'Family run since 1990.'), block('image', 'The owner beside the truck')],
      },
      {
        band: 'plain',
        align: 'start',
        cols: [],
        blocks: [block('heading', 'Our work'), block('text', 'Recoveries across the county.'), block('image', 'A flatbed carrying a van')],
      },
    ],
  })
  if (!result.value) throw new Error(JSON.stringify(result.violations))
  return result.value.nodes
}

const input = (seed: string) => ({
  rootId: CANVAS_ROOT_ELEMENT_ID,
  sectionIds: SECTION_IDS,
  sectionNames: SECTIONS.map((section) => section.name),
  seed,
})

type Node = { componentId: string; props?: Record<string, unknown>; nodes?: string[] }
/** The page's `image` nodes in document order. */
function imagesOf(nodes: NodesMap): Node[] {
  const map = nodes as unknown as Record<string, Node>
  const out: Node[] = []
  const visit = (id: string) => {
    const node = map[id]
    if (!node) return
    if (node.componentId === 'image') out.push(node)
    for (const child of node.nodes ?? []) visit(child)
  }
  visit(CANVAS_ROOT_ELEMENT_ID)
  return out
}

const STARTER_SRCS: string[] = Object.values(AI_LAYOUT_STARTER_PHOTOS).map((photo) => photo.src)

describe('a language page fills its picture slots with photos the site serves itself (AGL-3660)', () => {
  it('finds each empty slot in document order, with its role', () => {
    const slots = aiLayoutPictureSlots(towingPage(), CANVAS_ROOT_ELEMENT_ID, {
      ids: SECTION_IDS,
      names: SECTIONS.map((section) => section.name),
    })
    expect(slots.map((slot) => [slot.role, slot.alt])).toEqual([
      ['hero', 'A tow truck lifting a car on a highway at dusk'],
      ['about', 'The owner beside the truck'],
      ['gallery', 'A flatbed carrying a van'],
    ])
    expect(slots.every((slot) => slot.iconId && slot.frameId)).toBe(true)
  })

  it('fills every slot with a starter photo, keeps the alt text and takes out the placeholder icon', async () => {
    const before = towingPage()
    const after = await aiResolveLayoutPictures(before, input('job-a:home'))
    const images = imagesOf(after)
    expect(images).toHaveLength(3)
    for (const photo of images) {
      expect(STARTER_SRCS).toContain(photo.props?.['src'])
      expect(photo.props?.['intrinsicWidth']).toEqual(expect.any(Number))
      expect(photo.props?.['src']).not.toMatch(/^https?:/)
    }
    expect(images.map((photo) => photo.props?.['alt'])).toEqual([
      'A tow truck lifting a car on a highway at dusk',
      'The owner beside the truck',
      'A flatbed carrying a van',
    ])
    const icons = Object.values(after as unknown as Record<string, Node>).filter((node) => node.componentId === 'icon')
    expect(icons).toHaveLength(0)
    // Every child listed still exists: the icon left its frame's list too.
    const map = after as unknown as Record<string, Node>
    for (const node of Object.values(map)) for (const child of node.nodes ?? []) expect(map[child]).toBeDefined()
  })

  it('gives the about slot the owner photo and loads only the hero eagerly', async () => {
    const after = await aiResolveLayoutPictures(towingPage(), input('job-b:home'))
    const [hero, about, gallery] = imagesOf(after)
    expect(about.props?.['src']).toBe(AI_LAYOUT_STARTER_PHOTOS.about.src)
    expect(hero.props?.['loading']).toBe('eager')
    expect(gallery.props?.['loading']).toBe('lazy')
  })

  it('repeats no photo on a page while one is unused, and starts again past the last', () => {
    const slots = Array.from({ length: 7 }, (_, index) => ({ role: index === 0 ? 'hero' : 'gallery' }) as AiLayoutPictureSlot)
    const photos = aiLayoutStarterPhotos(slots, 'seed').map((photo) => photo.src)
    // Four starters are not a person's portrait, and a page without people uses all four first.
    expect(new Set(photos.slice(0, 4)).size).toBe(4)
    expect(photos.slice(4).every((src) => STARTER_SRCS.includes(src))).toBe(true)
  })

  it('never puts the owner’s portrait in a gallery or hero picture, even to avoid a repeat (AGL-3660)', () => {
    for (let job = 0; job < 40; job += 1) {
      const slots = Array.from({ length: 8 }, (_, index) => ({ role: index === 0 ? 'hero' : 'gallery' }) as AiLayoutPictureSlot)
      const photos = aiLayoutStarterPhotos(slots, `job-${job}`).map((photo) => photo.src)
      expect(photos).not.toContain(AI_LAYOUT_STARTER_PHOTOS.about.src)
    }
  })

  it('serves the about picture the owner before a card takes it, as the live Juniper Clay page did not (AGL-3660)', () => {
    // Its six slots in document order: a hero, three work cards, Exhibitions, About.
    const roles = ['hero', 'gallery', 'gallery', 'gallery', 'gallery', 'about'] as const
    const slots = roles.map((role) => ({ role }) as AiLayoutPictureSlot)
    for (let job = 0; job < 40; job += 1) {
      const photos = aiLayoutStarterPhotos(slots, `job-${job}:home`).map((photo) => photo.src)
      expect(photos[5]).toBe(AI_LAYOUT_STARTER_PHOTOS.about.src)
      // Six slots, five starters: one repeat, never beside itself.
      expect(new Set(photos).size).toBe(5)
      photos.forEach((src, index) => expect(src === photos[index + 1]).toBe(false))
    }
  })

  it('repeats no photo on any page of five slots or fewer, whatever the seed and the roles', () => {
    const roles = ['hero', 'about', 'gallery'] as const
    for (let job = 0; job < 60; job += 1) {
      const count = 1 + (job % 5)
      const slots = Array.from({ length: count }, (_, index) => ({ role: roles[(job + index) % 3] }) as AiLayoutPictureSlot)
      const photos = aiLayoutStarterPhotos(slots, `job-${job}`).map((photo) => photo.src)
      expect(new Set(photos).size).toBe(count)
    }
  })

  it('opens sites with different photos, and the same job always with the same one', () => {
    const hero = [{ role: 'hero' }] as AiLayoutPictureSlot[]
    const openers = new Set(
      Array.from({ length: 24 }, (_, index) => aiLayoutStarterPhotos(hero, `job-${index}`)[0].src),
    )
    expect(openers.size).toBeGreaterThan(1)
    expect(aiLayoutStarterPhotos(hero, 'job-7')).toEqual(aiLayoutStarterPhotos(hero, 'job-7'))
  })

  it('takes the source’s photos where it answers and starter photos where it does not', async () => {
    const source = jest.fn(async (slots: readonly AiLayoutPictureSlot[]) =>
      slots.map((_, index) => (index === 1 ? { src: '/api/media/cdn/h_site/m1', width: 1600, height: 1067 } : null)),
    )
    const after = await aiResolveLayoutPictures(towingPage(), { ...input('job-c:home'), source })
    const srcs = imagesOf(after).map((photo) => photo.props?.['src'])
    expect(source).toHaveBeenCalledTimes(1)
    expect(srcs[1]).toBe('/api/media/cdn/h_site/m1')
    expect(STARTER_SRCS).toContain(srcs[0])
    expect(STARTER_SRCS).toContain(srcs[2])
  })

  it('falls back to starter photos when the source throws, and never throws itself', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const after = await aiResolveLayoutPictures(towingPage(), {
      ...input('job-d:home'),
      source: async () => {
        throw new Error('rate limited')
      },
    })
    expect(imagesOf(after).every((photo) => STARTER_SRCS.includes(String(photo.props?.['src'])))).toBe(true)
    warn.mockRestore()
  })

  it('leaves a slot that already has a source alone', async () => {
    const once = await aiResolveLayoutPictures(towingPage(), input('job-e:home'))
    const twice = await aiResolveLayoutPictures(once, input('another-seed'))
    expect(twice).toEqual(once)
  })
})
