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
 * AGL-3486: what the encoder writes, read back out of the bytes it wrote.
 *
 * Real `sharp` throughout, for the reason `media-variants.spec.ts` gives: the
 * properties under test — upright pixels, no GPS position, a variant smaller
 * than what it stands in for — exist only in the encoded output, and a mock
 * would only prove the options were passed.
 */

import {
  MEDIA_CDN_VARIANT_WIDTHS,
  MEDIA_DELIVERY_MAX_EDGE,
  MEDIA_VARIANT_ENCODER_VERSION,
} from '@aglyn/aglyn/server'
import {
  encodeMediaDisplay,
  encodeMediaVariant,
  generateMediaVariants,
  loadSharp,
  MEDIA_VARIANT_WEBP_OPTIONS,
  mediaDerivedObjectPaths,
  mediaVariantDocFields,
} from './media-variants'

let sharp: any

beforeAll(async () => {
  sharp = await loadSharp()
})

/** A smooth picture, as a photo or a design export is. */
function gradient(width: number, height: number): Buffer {
  const pixels = Buffer.alloc(width * height * 3)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 3
      pixels[index] = Math.round((x * 255) / width)
      pixels[index + 1] = Math.round((y * 255) / height)
      pixels[index + 2] = Math.round((((x + y) % 600) * 255) / 600)
    }
  }
  return pixels
}

/** A JPEG as a phone leaves it: EXIF with a GPS position, optionally a rotation flag. */
async function phonePhoto(
  width: number,
  height: number,
  orientation?: number,
): Promise<Buffer> {
  return sharp(gradient(width, height), { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 90 })
    .withMetadata({
      ...(orientation ? { orientation } : {}),
      exif: {
        IFD0: { Make: 'Acme Phone', Model: 'One' },
        IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '35/1 35/1 0/1' },
      },
    })
    .toBuffer()
}

/** A clean PNG with no metadata, below the delivery edge. */
async function cleanPng(width: number, height: number): Promise<Buffer> {
  return sharp(gradient(width, height), { raw: { width, height, channels: 3 } })
    .png()
    .toBuffer()
}

/**
 * Noise saved as a low-quality JPEG: the shape of the customer photos the
 * issue measured, where a WebP of the same pixels came out LARGER than the
 * JPEG it was made from.
 */
async function noisyJpeg(width: number, height: number): Promise<Buffer> {
  const pixels = Buffer.alloc(width * height * 3)
  let seed = 7
  for (let index = 0; index < pixels.length; index += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    pixels[index] = (seed >> 16) & 255
  }
  return sharp(pixels, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 30 })
    .toBuffer()
}

describe('the variant encoder settings (AGL-3486)', () => {
  it('encodes WebP at quality 72, effort 5, under a newer encoder generation', () => {
    expect(MEDIA_VARIANT_WEBP_OPTIONS).toEqual({ quality: 72, effort: 5 })
    // Generation 1 is every variant made at quality 80 before this field
    // existed; a change to the settings above must move this too.
    expect(MEDIA_VARIANT_ENCODER_VERSION).toBeGreaterThanOrEqual(2)
  })

  it('writes an upright WebP with none of the photo’s metadata', async () => {
    const photo = await phonePhoto(1600, 800, 6)
    expect((await sharp(photo).metadata()).exif).toBeDefined()

    const variant = await sharp(await encodeMediaVariant(sharp, photo, 640)).metadata()
    expect(variant.format).toBe('webp')
    // Orientation 6 is a quarter turn: the 1600x800 sensor image is a
    // portrait photo, and its variant is portrait pixels with no flag left.
    expect([variant.width, variant.height]).toEqual([640, 1280])
    expect(variant.orientation).toBeUndefined()
    expect(variant.exif).toBeUndefined()
    expect(variant.xmp).toBeUndefined()
    expect(variant.iptc).toBeUndefined()
  })

  it('is smaller than the generation-1 encode of the same pixels', async () => {
    const photo = await phonePhoto(1600, 900)
    const now = await encodeMediaVariant(sharp, photo, 1280)
    const before = await sharp(photo)
      .resize({ width: 1280, withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer()
    expect(now.length).toBeLessThan(before.length)
  })
})

describe('a variant is never larger than what it stands in for (AGL-3486)', () => {
  it('skips a width whose WebP is no smaller than the original, and keeps the rest', async () => {
    const source = await noisyJpeg(1000, 500)
    const written = new Map<string, Buffer>()
    const outcome = await generateMediaVariants({
      buffer: source,
      contentType: 'image/jpeg',
      sourceWidth: 1000,
      objectPath: 'hosts/site-a/media/photo',
      saveVariant: async (path, bytes) => {
        written.set(path, bytes)
      },
    })
    expect(outcome.error).toBeUndefined()
    // Small widths are a real saving and are kept…
    expect(outcome.variants).toContain(480)
    // …while the source-width re-encodes, larger than the JPEG, are not: the
    // CDN serves the smaller original for them instead.
    expect(outcome.variants).not.toContain(1280)
    expect(outcome.variants).not.toContain(2560)
    for (const bytes of written.values()) {
      expect(bytes.length).toBeLessThan(source.length)
    }
    expect([...written.keys()]).toEqual(
      outcome.variants.map((width) => `hosts/site-a/media/photo__w${width}.webp`),
    )
  })
})

describe('the display copy (AGL-3486)', () => {
  it('downscales an oversized photo to the delivery edge, upright and stripped, in its own format', async () => {
    const photo = await phonePhoto(3000, 1500)
    const made = await encodeMediaDisplay(sharp, photo, 'image/jpeg')
    expect(made).not.toBeNull()
    const metadata = await sharp(made?.bytes).metadata()
    expect(metadata.format).toBe('jpeg')
    expect([metadata.width, metadata.height]).toEqual([MEDIA_DELIVERY_MAX_EDGE, 1280])
    expect(metadata.exif).toBeUndefined()
    expect(made?.copy).toEqual({
      contentType: 'image/jpeg',
      width: MEDIA_DELIVERY_MAX_EDGE,
      height: 1280,
      sizeBytes: made?.bytes.length,
    })
    expect(made?.bytes.length).toBeLessThan(photo.length)
  })

  it('strips a small photo’s GPS position even though it needs no resize', async () => {
    const photo = await phonePhoto(800, 600)
    const made = await encodeMediaDisplay(sharp, photo, 'image/jpeg')
    const metadata = await sharp(made?.bytes).metadata()
    expect([metadata.width, metadata.height]).toEqual([800, 600])
    expect(metadata.exif).toBeUndefined()
  })

  it('applies an EXIF orientation, so the copy is upright without the flag', async () => {
    const photo = await phonePhoto(1600, 800, 6)
    const made = await encodeMediaDisplay(sharp, photo, 'image/jpeg')
    const metadata = await sharp(made?.bytes).metadata()
    expect([metadata.width, metadata.height]).toEqual([800, 1600])
    expect(metadata.orientation).toBeUndefined()
  })

  it('makes none for a clean image within the edge — the original is served as it is', async () => {
    expect(await encodeMediaDisplay(sharp, await cleanPng(1200, 600), 'image/png')).toBeNull()
  })

  it('makes none for a format outside the set, such as a GIF', async () => {
    expect(await encodeMediaDisplay(sharp, Buffer.from('GIF89a'), 'image/gif')).toBeNull()
  })

  it('is written beside the variants only when the caller asks, and the variants are judged against it', async () => {
    const photo = await phonePhoto(3000, 1500)
    const written = new Map<string, { bytes: Buffer; type: string }>()
    const outcome = await generateMediaVariants({
      buffer: photo,
      contentType: 'image/jpeg',
      sourceWidth: 3000,
      objectPath: 'orgs/o/media/photo',
      display: true,
      saveVariant: async (path, bytes, type) => {
        written.set(path, { bytes, type })
      },
    })
    expect(outcome.error).toBeUndefined()
    const display = written.get('orgs/o/media/photo__display')
    expect(display?.type).toBe('image/jpeg')
    expect(outcome.display?.sizeBytes).toBe(display?.bytes.length)
    // The ladder stops at the delivery edge, and every variant is smaller
    // than the display copy a missing width would be served instead.
    expect(outcome.variants).toEqual([...MEDIA_CDN_VARIANT_WIDTHS])
    for (const width of outcome.variants) {
      const variant = written.get(`orgs/o/media/photo__w${width}.webp`)
      expect(variant?.type).toBe('image/webp')
      expect(variant?.bytes.length).toBeLessThan(display?.bytes.length ?? 0)
    }

    const posterLike = await generateMediaVariants({
      buffer: photo,
      contentType: 'image/jpeg',
      sourceWidth: 3000,
      objectPath: 'orgs/o/media/other',
      saveVariant: async () => undefined,
    })
    expect(posterLike.display).toBeUndefined()
  })
})

describe('mediaVariantDocFields (AGL-3486)', () => {
  it('records the generation beside the widths, and clears a display copy there is none of', () => {
    expect(mediaVariantDocFields({ variants: [160, 320] })).toEqual({
      variants: [160, 320],
      variantEncoderVersion: MEDIA_VARIANT_ENCODER_VERSION,
      display: null,
    })
  })
})

describe('mediaDerivedObjectPaths (AGL-3486)', () => {
  it('names every derived object, so a move or a delete takes all of them', () => {
    expect(
      mediaDerivedObjectPaths('orgs/o/media/a', {
        variants: [160, 640],
        display: { contentType: 'image/jpeg' },
        poster: { variants: [320] },
        videoRenditions: [
          { key: '720p', contentType: 'video/mp4', ext: 'mp4', width: 1280, height: 720 },
        ],
      }),
    ).toEqual([
      'orgs/o/media/a__w160.webp',
      'orgs/o/media/a__w640.webp',
      'orgs/o/media/a__display',
      'orgs/o/media/a__poster.webp',
      'orgs/o/media/a__poster__w320.webp',
      'orgs/o/media/a__r720p.mp4',
    ])
  })

  it('names nothing for an asset with no derived objects', () => {
    expect(mediaDerivedObjectPaths('orgs/o/media/a', { variants: [] })).toEqual([])
  })
})
