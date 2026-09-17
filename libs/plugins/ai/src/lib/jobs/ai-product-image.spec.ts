/**
 * @jest-environment node
 */
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
 * A product's photo as a `products` job sends it (AGL-2916), with the real
 * `sharp` the job loads: what size and format leaves, that none of the
 * original file's metadata goes with it, and that only an asset of the site's
 * own library, or its org's, is read at all.
 */

import { loadAiMediaSharp } from './ai-media-asset'
import {
  AI_PRODUCT_IMAGE_MAX_EDGE_PX,
  AI_PRODUCT_IMAGE_MAX_SOURCE_BYTES,
  AI_PRODUCT_IMAGE_TYPES,
  encodeAiProductImage,
  readAiProductImage,
} from './ai-product-image'

const HOST = 'host-1'
const ORG = 'org-1'
const firestore = {} as FirebaseFirestore.Firestore

/** The `sharp` the job itself loads, so the spec reads pictures with the same build. */
let sharp: any

beforeAll(async () => {
  sharp = await loadAiMediaSharp()
})

/** A photo as a camera leaves it: large, transparent in a corner, and carrying EXIF with a location. */
async function cameraPhoto(width: number, height: number, orientation?: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 4, background: { r: 200, g: 120, b: 40, alpha: 0.5 } } })
    .png()
    .withMetadata({
      ...(orientation ? { orientation } : {}),
      exif: { IFD0: { Make: 'Acme Camera', Model: 'Field 1' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '35/1 35/1 0/1' } },
    })
    .toBuffer()
}

describe('the picture a products job sends', () => {
  it('is a JPEG no larger than the long edge, with none of the original’s metadata', async () => {
    const original = await cameraPhoto(2_400, 1_200)
    expect((await sharp(original).metadata()).exif).toBeDefined()

    const sent = await sharp(await encodeAiProductImage(original)).metadata()
    expect(sent).toMatchObject({ format: 'jpeg', width: AI_PRODUCT_IMAGE_MAX_EDGE_PX, height: 384, hasAlpha: false })
    expect(sent.exif).toBeUndefined()
    expect(sent.icc).toBeUndefined()
    expect(sent.xmp).toBeUndefined()
    expect(sent.iptc).toBeUndefined()
  })

  it('turns a photo upright by its orientation before fitting it, and never enlarges a small one', async () => {
    const sideways = await sharp(await encodeAiProductImage(await cameraPhoto(1_600, 800, 6))).metadata()
    expect([sideways.width, sideways.height]).toEqual([384, AI_PRODUCT_IMAGE_MAX_EDGE_PX])
    expect(sideways.orientation).toBeUndefined()

    const small = await sharp(await encodeAiProductImage(await cameraPhoto(300, 200))).metadata()
    expect([small.width, small.height]).toEqual([300, 200])
  })

  it('reads only the formats a product photo comes in', () => {
    for (const type of ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']) {
      expect([type, AI_PRODUCT_IMAGE_TYPES.test(type)]).toEqual([type, true])
    }
    for (const type of ['image/svg+xml', 'image/heic', 'application/pdf', 'video/mp4', 'image/png; x']) {
      expect([type, AI_PRODUCT_IMAGE_TYPES.test(type)]).toEqual([type, false])
    }
  })
})

describe('which photo is read', () => {
  const bytes = Buffer.from('original')
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0])

  it('reads an asset of the site’s own library or its org’s, and sends the JPEG made from it', async () => {
    for (const value of [`media:${HOST}/lamp`, `media:org:${ORG}/lamp`]) {
      const readBytes = jest.fn(async () => ({ buffer: bytes, contentType: 'image/png' }))
      const encode = jest.fn(async () => jpeg)
      const read = await readAiProductImage(firestore, { value, hostId: HOST, orgId: ORG }, { readBytes, encode })
      expect(read).toEqual({
        status: 'read',
        image: { type: 'image', mediaType: 'image/jpeg', data: jpeg.toString('base64') },
      })
      expect(readBytes).toHaveBeenCalledWith(firestore, expect.objectContaining({ mediaId: 'lamp' }), HOST)
      expect(encode).toHaveBeenCalledWith(bytes)
    }
  })

  it('reads nothing for a link, a raw storage URL, or another site’s or org’s asset', async () => {
    const readBytes = jest.fn()
    for (const value of [
      'https://cdn.example.com/lamp.jpg',
      'https://firebasestorage.googleapis.com/v0/b/bucket/o/hosts%2Fhost-1%2Fmedia%2Flamp',
      'media:host-2/lamp',
      'media:org:org-2/lamp',
    ]) {
      const read = await readAiProductImage(firestore, { value, hostId: HOST, orgId: ORG }, { readBytes })
      expect([value, read]).toEqual([value, { status: 'not-in-library' }])
    }
    expect(readBytes).not.toHaveBeenCalled()
    expect(await readAiProductImage(firestore, { value: '', hostId: HOST, orgId: ORG }, { readBytes })).toEqual({
      status: 'none',
    })
  })

  it('answers unreadable, and never throws, for an asset the library refuses or bytes that do not decode', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined)
    const input = { value: `media:${HOST}/lamp`, hostId: HOST, orgId: ORG }
    expect(await readAiProductImage(firestore, input, { readBytes: async () => null })).toEqual({ status: 'unreadable' })
    expect(
      await readAiProductImage(firestore, input, {
        readBytes: async () => ({ buffer: Buffer.from('not a picture'), contentType: 'image/png' }),
      }),
    ).toEqual({ status: 'unreadable' })
    expect(
      await readAiProductImage(firestore, input, {
        readBytes: async () => {
          throw new Error('storage unavailable')
        },
      }),
    ).toEqual({ status: 'unreadable' })
    expect(AI_PRODUCT_IMAGE_MAX_SOURCE_BYTES).toBe(15 * 1024 * 1024)
  })
})
