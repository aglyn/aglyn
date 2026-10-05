/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it is
 * silently ignored and the suite runs on jsdom.
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

import sharp from 'sharp'

import { encodeIco, renderSiteIcon } from './site-icon-render'

/**
 * The pixels of a site's derived icons (AGL-3484), drawn by the real `sharp`
 * and read back pixel by pixel: center-fit rather than stretched, flattened
 * where iOS would paint transparency black, the maskable mark inside the safe
 * zone, an SVG rasterized sharp at every size, and a real multi-size ICO.
 */

const RED = '#ff0000'

/** A solid opaque rectangle, as a PNG. */
const solid = (width: number, height: number, color = RED) =>
  sharp({ create: { width, height, channels: 4, background: color } })
    .png()
    .toBuffer()

/** Decoded RGBA pixels with a reader. */
const pixels = async (png: Buffer) => {
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return {
    info,
    at: (x: number, y: number) => {
      const i = (y * info.width + x) * 4
      return Array.from(data.subarray(i, i + 4))
    },
  }
}

describe('a transparent icon', () => {
  it('is exactly the size asked for, as a PNG', async () => {
    const icon = await renderSiteIcon({
      source: await solid(512, 512),
      spec: { plate: 'transparent', size: 32 },
    })
    expect(icon.contentType).toBe('image/png')
    const meta = await sharp(icon.body).metadata()
    expect([meta.format, meta.width, meta.height]).toEqual(['png', 32, 32])
    // 512px of red, drawn at 32: a fraction of the original's bytes.
    expect(icon.body.length).toBeLessThan(1024)
  })

  it('center-fits a non-square upload instead of stretching it', async () => {
    // 2:1 — a wordmark's shape.
    const icon = await renderSiteIcon({
      source: await solid(200, 100),
      spec: { plate: 'transparent', size: 48 },
    })
    const { info, at } = await pixels(icon.body)
    expect([info.width, info.height]).toEqual([48, 48])
    // Letterboxed: transparent bands above and below, the mark between.
    expect(at(24, 2)[3]).toBe(0)
    expect(at(24, 45)[3]).toBe(0)
    expect(at(24, 24)).toEqual([255, 0, 0, 255])
    // Full width, so the mark keeps its 2:1 shape (48×24) — not 48×48.
    expect(at(0, 24)).toEqual([255, 0, 0, 255])
    expect(at(47, 24)).toEqual([255, 0, 0, 255])
  })
})

describe('an apple-touch-icon', () => {
  it('is flattened onto the plate: no alpha anywhere for iOS to paint black', async () => {
    const icon = await renderSiteIcon({
      source: await solid(100, 50),
      spec: { plate: 'flat', size: 180 },
      background: '#fafaf9',
    })
    const meta = await sharp(icon.body).metadata()
    expect([meta.width, meta.height, meta.hasAlpha]).toEqual([180, 180, false])
    const { at } = await pixels(icon.body)
    // The letterbox band is the plate, not transparency.
    expect(at(90, 2)).toEqual([0xfa, 0xfa, 0xf9, 255])
    expect(at(90, 90)).toEqual([255, 0, 0, 255])
  })

  it('falls back to a white plate for a background it cannot read', async () => {
    const icon = await renderSiteIcon({
      source: await solid(10, 20),
      spec: { plate: 'flat', size: 152 },
      background: 'var(--page)',
    })
    const { at } = await pixels(icon.body)
    expect(at(2, 76)).toEqual([255, 255, 255, 255])
  })
})

describe('a maskable icon', () => {
  it('keeps the whole mark inside the 80% safe circle, on the plate', async () => {
    const size = 512
    const icon = await renderSiteIcon({
      source: await solid(400, 400),
      spec: { plate: 'maskable', size },
      background: '#102030',
    })
    const { info, at } = await pixels(icon.body)
    expect([info.width, info.height]).toEqual([size, size])
    const plate = [0x10, 0x20, 0x30, 255]
    const center = size / 2
    const radius = (size * 0.8) / 2
    // Every mark pixel lies inside the safe circle; everything else is plate.
    let markPixels = 0
    for (let y = 0; y < size; y += 4) {
      for (let x = 0; x < size; x += 4) {
        const pixel = at(x, y)
        if (pixel[0] > 128 && pixel[2] < 64) {
          markPixels += 1
          expect(Math.hypot(x - center, y - center)).toBeLessThanOrEqual(radius)
        } else {
          expect(pixel).toEqual(plate)
        }
      }
    }
    expect(markPixels).toBeGreaterThan(0)
    expect(at(0, 0)).toEqual(plate)
  })
})

describe('an SVG source', () => {
  it('is rasterized at the target size, not upscaled from 72 dpi', async () => {
    // A 24-unit mark: its left half black. Rendered at 72 dpi it would be 24px
    // and the edge at x=256 would blur across ~20px once scaled to 512.
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
        '<rect x="0" y="0" width="12" height="24" fill="#000"/></svg>',
    )
    const icon = await renderSiteIcon({
      source: svg,
      spec: { plate: 'transparent', size: 512 },
    })
    const { at } = await pixels(icon.body)
    expect(at(250, 256)[3]).toBe(255)
    expect(at(262, 256)[3]).toBe(0)
  })
})

describe('/favicon.ico', () => {
  it('is one ICO holding a 16, a 32 and a 48px PNG', async () => {
    const icon = await renderSiteIcon({
      source: await solid(512, 512),
      spec: { plate: 'ico' },
    })
    expect(icon.contentType).toBe('image/x-icon')
    const body = icon.body
    // Reserved 0, type 1 (icon), three images.
    expect([body.readUInt16LE(0), body.readUInt16LE(2), body.readUInt16LE(4)]).toEqual(
      [0, 1, 3],
    )
    for (const [index, size] of [16, 32, 48].entries()) {
      const at = 6 + index * 16
      expect([body.readUInt8(at), body.readUInt8(at + 1)]).toEqual([size, size])
      const length = body.readUInt32LE(at + 8)
      const offset = body.readUInt32LE(at + 12)
      const meta = await sharp(body.subarray(offset, offset + length)).metadata()
      expect([meta.format, meta.width, meta.height]).toEqual(['png', size, size])
    }
  })

  it('writes 256px as 0, as the format requires', () => {
    const ico = encodeIco([{ size: 256, png: Buffer.from([1, 2, 3]) }])
    expect([ico.readUInt8(6), ico.readUInt8(7)]).toEqual([0, 0])
    expect(ico.readUInt32LE(6 + 12)).toBe(22)
    expect(Array.from(ico.subarray(22))).toEqual([1, 2, 3])
  })
})

describe('a file that will not decode', () => {
  it('rejects, so the CDN can fall back to the original', async () => {
    await expect(
      renderSiteIcon({
        source: Buffer.from('not an image'),
        spec: { plate: 'transparent', size: 16 },
      }),
    ).rejects.toThrow()
  })
})
