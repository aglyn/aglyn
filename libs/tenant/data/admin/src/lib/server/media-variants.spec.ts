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
 * AGL-1468: variant generation had failed on every upload for three weeks and
 * nothing said so. These run REAL `sharp` on purpose.
 *
 * A mocked `sharp` proves the loop calls it, which was never in doubt — the
 * loop is unchanged since AGL-175 and it worked in production on 2026-07-19.
 * What broke is whether `sharp` is CALLABLE at all in the environment the code
 * runs in, and a mock is the one thing guaranteed to be callable. So the
 * central case here resolves the real module and asserts the real output is a
 * real WebP that is genuinely SMALLER than its source.
 *
 * Byte count is the assertion for the same reason it is in the issue: the
 * broken path returns 200 with the original, so a status code and a
 * non-null buffer both pass while every grid card downloads a full-size PNG.
 */

import {
  generateMediaVariants,
  mediaVariantWidthsFor,
  probeMediaVariantSupport,
} from './media-variants'

/**
 * A 1200x630 PNG — the exact shape of the assets that failed in production
 * (`og--press--716-9809.png`, 1200x630, 190 KB, `variants: []`).
 *
 * A smooth gradient rather than noise, and the difference matters: PNG stores
 * high-entropy noise near-raw and lossy WebP re-expands it, so a noise source
 * makes the 640px variant LARGER than its original and the size assertion
 * below fails for a reason that has nothing to do with the bug. Real photos
 * and OG cards are smooth. This is what the fixture is modelling.
 */
async function sourcePng(width = 1200, height = 630): Promise<Buffer> {
  const sharp = (await import('sharp')).default
  const pixels = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 3
      pixels[index] = Math.round((x * 255) / width)
      pixels[index + 1] = Math.round((y * 255) / height)
      pixels[index + 2] = Math.round((((x + y) % 600) * 255) / 600)
    }
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer()
}

describe('mediaVariantWidthsFor (AGL-1468)', () => {
  it('keeps only widths narrower than the source', () => {
    expect(
      mediaVariantWidthsFor({ contentType: 'image/png', sourceWidth: 1200 }),
    ).toEqual([320, 640])
  })

  it('produces nothing for a source already smaller than every width', () => {
    expect(
      mediaVariantWidthsFor({ contentType: 'image/png', sourceWidth: 256 }),
    ).toEqual([])
  })

  it('generates for an unreadable header rather than opting the asset out', () => {
    expect(
      mediaVariantWidthsFor({ contentType: 'image/png', sourceWidth: null }),
    ).toEqual([320, 640, 1280])
  })

  it('excludes SVG and non-images', () => {
    expect(
      mediaVariantWidthsFor({ contentType: 'image/svg+xml', sourceWidth: 2000 }),
    ).toEqual([])
    expect(
      mediaVariantWidthsFor({ contentType: 'video/mp4', sourceWidth: 2000 }),
    ).toEqual([])
  })
})

describe('generateMediaVariants with real sharp (AGL-1468)', () => {
  it('writes WebP variants that are SMALLER than the original', async () => {
    const buffer = await sourcePng()
    const written = new Map<string, Buffer>()
    const outcome = await generateMediaVariants({
      buffer,
      contentType: 'image/png',
      sourceWidth: 1200,
      objectPath: 'hosts/site-a/media/asset',
      saveVariant: async (path, webp) => {
        written.set(path, webp)
      },
    })

    expect(outcome.error).toBeUndefined()
    expect(outcome.variants).toEqual([320, 640])
    expect([...written.keys()]).toEqual([
      'hosts/site-a/media/asset__w320.webp',
      'hosts/site-a/media/asset__w640.webp',
    ])
    // The whole point of the feature, asserted in bytes.
    for (const [, webp] of written) {
      expect(webp.length).toBeLessThan(buffer.length)
      expect(webp.toString('ascii', 0, 4)).toBe('RIFF')
      expect(webp.toString('ascii', 8, 12)).toBe('WEBP')
    }
    // And narrower is smaller than wider — a resize that ignored its argument
    // would produce two identical buffers and still pass every check above.
    const w320 = written.get('hosts/site-a/media/asset__w320.webp') as Buffer
    const w640 = written.get('hosts/site-a/media/asset__w640.webp') as Buffer
    expect(w320.length).toBeLessThan(w640.length)
  })

  it('reports nothing wrong when nothing was eligible', async () => {
    const outcome = await generateMediaVariants({
      buffer: Buffer.from('<svg/>'),
      contentType: 'image/svg+xml',
      objectPath: 'hosts/site-a/media/logo',
      saveVariant: async () => {
        throw new Error('must not be called')
      },
    })
    // An empty array with NO error — if this reported a fault, the fault
    // signal would be noise on the majority of a real library.
    expect(outcome).toEqual({ variants: [] })
  })
})

describe('a total failure is reported, not swallowed (AGL-1468)', () => {
  it('surfaces the error when the variant cannot be stored', async () => {
    const buffer = await sourcePng(800, 400)
    const outcome = await generateMediaVariants({
      buffer,
      contentType: 'image/png',
      sourceWidth: 800,
      objectPath: 'hosts/site-a/media/asset',
      saveVariant: async () => {
        throw new Error('storage said no')
      },
    })
    expect(outcome.variants).toEqual([])
    expect(outcome.error).toContain('storage said no')
  })

  it('keeps the widths that landed when a later one fails', async () => {
    const buffer = await sourcePng(1200, 630)
    let calls = 0
    const outcome = await generateMediaVariants({
      buffer,
      contentType: 'image/png',
      sourceWidth: 1200,
      objectPath: 'hosts/site-a/media/asset',
      saveVariant: async () => {
        calls += 1
        if (calls > 1) throw new Error('storage said no')
      },
    })
    // The 320 file is really there; the document must keep claiming it.
    expect(outcome.variants).toEqual([320])
    expect(outcome.error).toContain('storage said no')
  })
})

describe('probeMediaVariantSupport (AGL-1468)', () => {
  it('confirms this runtime can actually produce a smaller WebP', async () => {
    await expect(probeMediaVariantSupport()).resolves.toEqual({ ok: true })
  })
})
