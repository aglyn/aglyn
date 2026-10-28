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

import type { NodesMap } from '@aglyn/aglyn/types/nodes'
import { aiSiteIsStarterSrc, type AiSiteStarterSlot } from '../model/ai-site-photos'
import {
  PIT_ROW_HOME,
  PIT_ROW_HOME_PAGE,
  RUT_RUNNERS_HOME,
  RUT_RUNNERS_HOME_PAGE,
} from '../jobs/fixtures/ai-site-agl4065-pages'
import {
  AI_LAYOUT_NO_PHOTO,
  aiLayoutPictureSlots,
  aiResolveLayoutPictures,
  type AiLayoutPicturePhoto,
  type AiLayoutPictureSource,
} from './ai-layout-pictures'

/*
 * The two "… in pictures" bands of the 2026-10-25 booth kit (AGL-4065):
 * Rut Runners Racing's "The team at the track in pictures" and Pit Row
 * Tacos's "The trailer and the food in pictures" shipped as a heading over
 * six captions ("Gate drop — Riders staged and ready for the start.") and no
 * picture, while the Rut Runners job had copied thirteen on-topic photos.
 * Replayed over the stored home pages (fixtures/ai-site-agl4065-pages.ts),
 * as drawn on 2026-10-25 and as drawn with a picture over each caption,
 * with a source answering each slot as the library did. Pure; no network.
 */

type Map = Record<string, { componentId?: string; props?: Record<string, unknown>; nodes?: string[]; parentId?: string }>

const RUT_GALLERY = 'ai-LpjPaYgvkh-section-4'
const PIT_ROW_GALLERY = 'ai-cmKXUpADXV-section-4'

/** The thirteen photos the Rut Runners job had copied, as its library holds them. */
const RUT_RUNNERS_PHOTOS: AiLayoutPicturePhoto[] = [
  ['-1n3AQz89o', 1280, 912, 'A smart motorcycle and a motocross'],
  ['1Jk1ry2HOR', 1280, 960, 'A team'],
  ['2EQ9F1TzqG', 1280, 853, 'A motorcycle and a motocross'],
  ['8YuvVNpqMv', 1280, 853, 'A motocross and a race'],
  ['AfJQ-PRkj6', 1280, 853, 'A race car and a motorsport'],
  ['Jy9akO-_kg', 1280, 853, 'A speedway and a motorcycle'],
  ['L4JZI2S-OT', 1280, 841, 'Cyclists and a bicycle race'],
  ['Q6moFD0axG', 1280, 853, 'A motocross and a motorbike'],
  ['TVhJCgtnlr', 1280, 853, 'A motocross'],
  ['aU8rfCBqDj', 1280, 853, 'A motorcycle and a rider'],
  ['onIYQoJyIs', 1280, 868, 'A motocross and a race'],
  ['p51ro5NPdP', 853, 1280, 'A terrain on a path'],
  ['tacprubqBD', 1280, 853, 'Horses'],
].map(([id, width, height, alt]) => ({ src: `media:rut-runners/${id}`, width: Number(width), height: Number(height), alt: String(alt) }))

/**
 * The page with a band's captions drawn as the compiler draws a band of
 * pictures: each caption under a stand-in picture of its own words, its frame
 * the picture, in a cell of the band's grid.
 */
function pictured(nodes: NodesMap, sectionId: string): NodesMap {
  const map = JSON.parse(JSON.stringify(nodes)) as Map
  const within = (id: string): string[] => [id, ...(map[id]?.nodes ?? []).flatMap(within)]
  for (const id of within(sectionId)) {
    const node = map[id]
    if (node?.componentId !== 'muiListItemText') continue
    const { primary, secondary } = (node.props ?? {}) as { primary: string; secondary: string }
    const cell = node.parentId as string
    map[`${id}-image`] = { componentId: 'image', props: { alt: primary, objectFit: 'cover', decorative: true, width: '100%' }, nodes: [], parentId: `${id}-work` }
    map[`${id}-title`] = { componentId: 'muiTypography', props: { children: primary, variant: 'h6', component: 'h3' }, nodes: [], parentId: `${id}-work` }
    map[`${id}-text`] = { componentId: 'muiTypography', props: { children: secondary, variant: 'body2' }, nodes: [], parentId: `${id}-work` }
    map[`${id}-work`] = { componentId: 'muiStack', props: { spacing: '1.5' }, nodes: [`${id}-image`, `${id}-title`, `${id}-text`], parentId: cell }
    ;(map[cell] as { nodes: string[] }).nodes = [`${id}-work`]
    delete map[id]
  }
  return map as unknown as NodesMap
}

/** A source answering the hero with a photo of the job's and every other slot as `others` says. */
const answering =
  (others: AiLayoutPicturePhoto | null): AiLayoutPictureSource =>
  async (slots) =>
    slots.map((slot) => (slot.role === 'hero' ? (RUT_RUNNERS_PHOTOS[0] as AiLayoutPicturePhoto) : others))

const sectionsOf = (nodes: NodesMap, root: string) => ((nodes as unknown as Map)[root]?.nodes ?? []).filter((id) => id.includes('-section-'))
const imagesIn = (nodes: NodesMap, id: string): Array<Record<string, unknown>> => {
  const map = nodes as unknown as Map
  const node = map[id]
  if (!node) return []
  return [...(node.componentId === 'image' ? [node.props ?? {}] : []), ...(node.nodes ?? []).flatMap((child) => imagesIn(nodes, child))]
}
const mainRoot = (page: { rootId: string }, nodes: NodesMap) => {
  // The page's sections sit in its main element, under the canvas root.
  const map = nodes as unknown as Map
  const holder = Object.keys(map).find((id) => (map[id]?.nodes ?? []).some((child) => child.includes('-section-')))
  return holder ?? page.rootId
}

describe('a band of pictures the library found nothing for (AGL-4065)', () => {
  it('leaves Rut Runners’ captions band out, as drawn on 2026-10-25, and keeps every other section', async () => {
    const out = await aiResolveLayoutPictures(RUT_RUNNERS_HOME, { ...RUT_RUNNERS_HOME_PAGE, seed: 'GTxJrcby9-:home', source: answering(AI_LAYOUT_NO_PHOTO) })
    const root = mainRoot(RUT_RUNNERS_HOME_PAGE, out)
    expect(sectionsOf(out, root)).not.toContain(RUT_GALLERY)
    expect(sectionsOf(out, root)).toEqual(RUT_RUNNERS_HOME_PAGE.sectionIds.filter((id) => id !== RUT_GALLERY))
    expect(Object.keys(out)).not.toContain('_YCvKjLLeW')
  })

  it('leaves Pit Row’s captions band out too', async () => {
    const out = await aiResolveLayoutPictures(PIT_ROW_HOME, { ...PIT_ROW_HOME_PAGE, seed: '2NuneC5WZ4:home', source: answering(AI_LAYOUT_NO_PHOTO) })
    expect(sectionsOf(out, mainRoot(PIT_ROW_HOME_PAGE, out))).not.toContain(PIT_ROW_GALLERY)
  })

  it('fills a band the library answered with nothing fitting from the job’s own photos, six of them, none twice', async () => {
    const page = pictured(RUT_RUNNERS_HOME, RUT_GALLERY)
    const slots = aiLayoutPictureSlots(page, RUT_RUNNERS_HOME_PAGE.rootId, { ids: RUT_RUNNERS_HOME_PAGE.sectionIds, names: RUT_RUNNERS_HOME_PAGE.sectionNames })
    // The band calls its pictures the team's, so they are read as about pictures, each a cell of the band.
    expect(slots.filter((slot) => slot.sectionIndex === 3)).toHaveLength(6)
    const out = await aiResolveLayoutPictures(page, {
      ...RUT_RUNNERS_HOME_PAGE,
      seed: 'GTxJrcby9-:home',
      source: answering(AI_LAYOUT_NO_PHOTO),
      jobPhotos: RUT_RUNNERS_PHOTOS,
    })
    const band = imagesIn(out, RUT_GALLERY)
    expect(band).toHaveLength(6)
    const srcs = band.map((props) => String(props['src']))
    expect(new Set(srcs).size).toBe(6)
    for (const src of srcs) expect(src).toMatch(/^media:rut-runners\//)
    // Never the hero's own photo again on the page.
    expect(srcs).not.toContain(RUT_RUNNERS_PHOTOS[0]?.src)
  })

  it('leaves the band out when the job has no photo for it, keeping the page’s other sections and its floor photo', async () => {
    const page = pictured(RUT_RUNNERS_HOME, RUT_GALLERY)
    const out = await aiResolveLayoutPictures(page, {
      ...RUT_RUNNERS_HOME_PAGE,
      seed: 'GTxJrcby9-:home',
      source: async (slots) => slots.map(() => AI_LAYOUT_NO_PHOTO),
    })
    const root = mainRoot(RUT_RUNNERS_HOME_PAGE, out)
    expect(sectionsOf(out, root)).toEqual(RUT_RUNNERS_HOME_PAGE.sectionIds.filter((id) => id !== RUT_GALLERY))
    // The page floor: one picture still opens it.
    const hero = imagesIn(out, RUT_RUNNERS_HOME_PAGE.sectionIds[0] as string)
    expect(hero.some((props) => typeof props['src'] === 'string' && (props['src'] as string).length > 0)).toBe(true)
  })

  it('on a site start, fills the band from the job’s photos the page does not show, and holds a starter for the late pass where none is left', async () => {
    const page = pictured(RUT_RUNNERS_HOME, RUT_GALLERY)
    let starters: AiSiteStarterSlot[] = []
    const out = await aiResolveLayoutPictures(page, {
      ...RUT_RUNNERS_HOME_PAGE,
      seed: 'GTxJrcby9-:home',
      source: answering(AI_LAYOUT_NO_PHOTO),
      jobPhotos: RUT_RUNNERS_PHOTOS.slice(0, 4),
      onStarters: (slots) => {
        starters = slots
      },
    })
    const band = imagesIn(out, RUT_GALLERY).map((props) => String(props['src']))
    expect(band).toHaveLength(6)
    const own = band.filter((src) => src.startsWith('media:'))
    expect(new Set(own).size).toBe(own.length)
    expect(own).toHaveLength(3)
    expect(band.filter((src) => aiSiteIsStarterSrc(src))).toHaveLength(3)
    expect(starters.filter((slot) => slot.role !== 'hero')).toHaveLength(3)
  })
})
