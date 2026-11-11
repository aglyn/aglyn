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
 * A picture that is a graphic, by its pixels (AGL-4152), on invented pixels
 * drawn here at the size the read draws them: a two-ink wordmark on white, a
 * noisy photo-like gradient, a cut-out mark, a photo with rounded corners.
 */

import {
  AI_SITE_IMPORT_GRAPHIC_CLEAR,
  AI_SITE_IMPORT_GRAPHIC_FLAT,
  AI_SITE_IMPORT_GRAPHIC_GRAIN,
  aiSiteImportLooksGraphic,
  aiSiteImportPixelFacts,
} from './ai-site-import-graphic'

const W = 64
const H = 48

/** A seeded generator, so every run draws the same noise. */
function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32
}

function canvas(fill: [number, number, number, number]): Uint8Array {
  const data = new Uint8Array(W * H * 4)
  for (let at = 0; at < W * H; at += 1) data.set(fill, at * 4)
  return data
}

function rect(data: Uint8Array, x: number, y: number, w: number, h: number, color: [number, number, number, number]) {
  for (let row = y; row < y + h; row += 1) for (let col = x; col < x + w; col += 1) data.set(color, (row * W + col) * 4)
}

/** A wordmark in two inks on white: a building of three blocks and a row of letters. */
function wordmark(): Uint8Array {
  const data = canvas([255, 255, 255, 255])
  const navy: [number, number, number, number] = [29, 58, 110, 255]
  rect(data, 6, 16, 3, 14, navy)
  rect(data, 10, 12, 4, 18, navy)
  rect(data, 15, 18, 3, 12, navy)
  for (let letter = 0; letter < 7; letter += 1) rect(data, 22 + letter * 6, 18, 4, 8, navy)
  rect(data, 22, 29, 40, 2, [200, 16, 46, 255])
  return data
}

/** A photo-like picture: a gradient with soft blobs of color and grain everywhere. */
function photoLike(seed: number): Uint8Array {
  const random = seeded(seed)
  const data = new Uint8Array(W * H * 4)
  const blobs = Array.from({ length: 6 }, () => ({ x: random() * W, y: random() * H, size: 6 + random() * 14, color: [random() * 255, random() * 255, random() * 255] }))
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      let color = [90 + 80 * (x / W), 110 + 60 * (y / H), 70 + 40 * Math.sin(x / 5)]
      for (const blob of blobs) {
        const reach = ((x - blob.x) ** 2 + (y - blob.y) ** 2) / blob.size ** 2
        if (reach < 1) color = color.map((value, at) => value * reach + (blob.color[at] as number) * (1 - reach))
      }
      const grain = (random() - 0.5) * 16
      data.set([...color.map((value) => Math.max(0, Math.min(255, Math.round(value + grain)))), 255], (y * W + x) * 4)
    }
  }
  return data
}

describe('a picture’s pixels', () => {
  it('make a two-ink wordmark on white a graphic: one flat color, no grain, few inks', () => {
    const facts = aiSiteImportPixelFacts(wordmark(), W, H, 4)
    expect(facts.clear).toBe(0)
    expect(facts.flat).toBeGreaterThan(0.75)
    expect(facts.grain).toBe(0)
    expect(facts.inks).toBeLessThanOrEqual(2)
    expect(aiSiteImportLooksGraphic(facts)).toBe(true)
  })

  it('make a noisy photo-like gradient a photo: no flat color, grain everywhere, many inks', () => {
    for (const seed of [1, 2, 3]) {
      const facts = aiSiteImportPixelFacts(photoLike(seed), W, H, 4)
      expect(facts.flat).toBeLessThan(AI_SITE_IMPORT_GRAPHIC_FLAT)
      expect(facts.grain).toBeGreaterThan(AI_SITE_IMPORT_GRAPHIC_GRAIN)
      expect(facts.inks).toBeGreaterThan(10)
      expect(aiSiteImportLooksGraphic(facts)).toBe(false)
    }
  })

  it('make a cut-out mark a graphic by its transparency alone', () => {
    const data = canvas([0, 0, 0, 0])
    rect(data, 10, 14, 44, 20, [10, 170, 119, 255])
    const facts = aiSiteImportPixelFacts(data, W, H, 4)
    expect(facts.clear).toBeGreaterThan(AI_SITE_IMPORT_GRAPHIC_CLEAR)
    expect(aiSiteImportLooksGraphic(facts)).toBe(true)
  })

  it('keep a photo with rounded corners a photo: its few clear corners are not a cut-out', () => {
    const data = photoLike(4)
    for (const [x, y] of [[0, 0], [W - 2, 0], [0, H - 2], [W - 2, H - 2]] as const) rect(data, x, y, 2, 2, [0, 0, 0, 0])
    const facts = aiSiteImportPixelFacts(data, W, H, 4)
    expect(facts.clear).toBeGreaterThan(0)
    expect(facts.clear).toBeLessThan(AI_SITE_IMPORT_GRAPHIC_CLEAR)
    expect(aiSiteImportLooksGraphic(facts)).toBe(false)
  })

  it('read three channels as opaque, and an empty picture as nothing', () => {
    const rgba = wordmark()
    const rgb = new Uint8Array(W * H * 3)
    for (let at = 0; at < W * H; at += 1) rgb.set(rgba.subarray(at * 4, at * 4 + 3), at * 3)
    expect(aiSiteImportPixelFacts(rgb, W, H, 3)).toEqual(aiSiteImportPixelFacts(rgba, W, H, 4))
    expect(aiSiteImportPixelFacts(new Uint8Array(0), 0, 0, 4)).toEqual({ clear: 0, flat: 0, grain: 0, inks: 0 })
    expect(aiSiteImportLooksGraphic({ clear: 0, flat: 0, grain: 0, inks: 0 })).toBe(false)
  })
})
