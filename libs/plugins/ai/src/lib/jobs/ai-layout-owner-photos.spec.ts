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

import type { PluginMediaAsset, PluginMediaIngest } from '@aglyn/aglyn/plugin-manager/plugin-media-ingest'
import type { AiLayoutPictureSlot } from '../layout-language/ai-layout-pictures'
import { AI_LAYOUT_NO_PHOTO } from '../layout-language/ai-layout-pictures'
import { aiAssignOwnerPhotos, aiLayoutSitePhotoSource } from './ai-layout-owner-photos'
import type { AiLayoutStockPhotoSourceInput } from './ai-layout-stock-photos'

const slot = (role: AiLayoutPictureSlot['role'], extra: Partial<AiLayoutPictureSlot> = {}): AiLayoutPictureSlot => ({
  imageId: `img-${role}-${Math.random().toString(36).slice(2, 6)}`,
  frameId: null,
  iconId: null,
  alt: '',
  aspect: 1,
  sectionIndex: 0,
  role,
  ...extra,
})

const photo = (mediaId: string, width: number, height: number, alt?: string): PluginMediaAsset => ({
  mediaId,
  src: `media:host-1/${mediaId}`,
  width,
  height,
  ...(alt ? { alt } : {}),
})

const INPUT: AiLayoutStockPhotoSourceInput = {
  hostId: 'host-1',
  uid: 'member-1',
  seed: 'job-1:home',
  business: 'A handyman service',
  sectionNames: ['Hero', 'About', 'Work'],
}

describe("the business's own photos fill a page first (AGL-3957)", () => {
  it('gives the hero the widest of the largest, about the next, the gallery the rest, each once', () => {
    const slots = [slot('gallery'), slot('hero'), slot('about'), slot('gallery'), slot('gallery')]
    const photos = [
      photo('tall', 1200, 1600),
      photo('wide', 1600, 1200, 'The van'),
      photo('small', 400, 300),
      photo('big-tall', 2000, 2600),
    ]
    const answers = aiAssignOwnerPhotos(slots, photos)
    // The hero takes the widest of the three largest, not the largest.
    expect(answers[1]).toEqual({ src: 'media:host-1/wide', width: 1600, height: 1200, alt: 'The van' })
    expect(answers[2]).toEqual({ src: 'media:host-1/big-tall', width: 2000, height: 2600 })
    expect(answers[0]?.src).toBe('media:host-1/tall')
    expect(answers[3]?.src).toBe('media:host-1/small')
    // Four photos, five slots: the last gallery slot is left to the stock search.
    expect(answers[4]).toBeNull()
  })

  it('leaves a product, a portrait and a record cover to the stock search, and never repeats a photo the job shows', () => {
    const slots = [slot('gallery', { product: { subjects: ['wick trimmer'] } }), slot('about', { people: true }), slot('gallery', { record: {} }), slot('gallery')]
    const answers = aiAssignOwnerPhotos(slots, [photo('a', 800, 600), photo('b', 800, 600)], new Set(['media:host-1/a']))
    expect(answers.slice(0, 3)).toEqual([null, null, null])
    expect(answers[3]?.src).toBe('media:host-1/b')
    expect(aiAssignOwnerPhotos(slots, [photo('nodims', 0, 0)])).toEqual([null, null, null, null])
  })

  it('asks the stock source only for the slots left over, and keeps its answers in place', async () => {
    const ingest: PluginMediaIngest = {
      ingest: async () => ({ ok: false, status: 500, reason: 'unused' }),
      findStockPhoto: async () => null,
      listOwnerPhotos: async () => [photo('own', 1600, 1200)],
    }
    const asked: AiLayoutPictureSlot[][] = []
    const stock = jest.fn(() => async (slots: readonly AiLayoutPictureSlot[]) => {
      asked.push([...slots])
      return slots.map((s, index) => (index === 0 ? { src: `stock:${s.role}`, width: 1, height: 1 } : AI_LAYOUT_NO_PHOTO))
    })
    const source = aiLayoutSitePhotoSource(INPUT, { ingest: () => ingest, stock })
    expect(source).not.toBeNull()
    const slots = [slot('hero'), slot('gallery'), slot('gallery')]
    const answers = await source!(slots)
    expect(answers[0]?.src).toBe('media:host-1/own')
    expect(asked).toEqual([[slots[1], slots[2]]])
    expect(answers[1]?.src).toBe('stock:gallery')
    expect(answers[2]).toBe(AI_LAYOUT_NO_PHOTO)
  })

  it('answers from the owner photos alone where there is no stock library, and from stock alone where the door has no owner photos', async () => {
    const ingest: PluginMediaIngest = {
      ingest: async () => ({ ok: false, status: 500, reason: 'unused' }),
      findStockPhoto: async () => null,
      listOwnerPhotos: async () => [photo('own', 1600, 1200)],
    }
    const ownerOnly = aiLayoutSitePhotoSource(INPUT, { ingest: () => ingest, stock: () => null })
    expect(await ownerOnly!([slot('hero'), slot('gallery')])).toEqual([
      { src: 'media:host-1/own', width: 1600, height: 1200 },
      null,
    ])

    const older: PluginMediaIngest = { ingest: ingest.ingest, findStockPhoto: ingest.findStockPhoto }
    const stockSource = async () => [{ src: 'stock:hero', width: 1, height: 1 }]
    expect(aiLayoutSitePhotoSource(INPUT, { ingest: () => older, stock: () => stockSource })).toBe(stockSource)

    // A read that fails leaves the page to the stock source, never to an error.
    const failing: PluginMediaIngest = { ...ingest, listOwnerPhotos: async () => { throw new Error('offline') } }
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const fallback = aiLayoutSitePhotoSource(INPUT, { ingest: () => failing, stock: () => stockSource })
    expect(await fallback!([slot('hero')])).toEqual([{ src: 'stock:hero', width: 1, height: 1 }])
    warn.mockRestore()
  })
})
