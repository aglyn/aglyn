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
 * AGL-3486: an asset whose delivery copies an older encoder made converges on
 * its next view, with no backfill.
 *
 * The decision is pure and asserted case by case. The regeneration runs real
 * `sharp` against an in-memory bucket and an in-memory document, because what
 * matters is what ends up in each: the new copies written, the document
 * naming exactly those, and the objects it stopped naming deleted only after.
 */

import {
  MEDIA_VARIANT_ENCODER_VERSION,
  MEDIA_VARIANT_ENCODER_VERSION_FIELD,
} from '@aglyn/aglyn/server'
import {
  MEDIA_REGENERATION_LEASE_MS,
  mediaDeliveryCopiesStale,
  regenerateMediaDeliveryCopies,
} from './media-delivery-regeneration'
import { loadSharp } from './media-variants'

jest.mock('firebase-admin/firestore', () => ({
  FieldValue: { delete: () => '__delete__' },
}))

const NOW = 1_800_000_000_000

/** A legacy document: generation 1, the old ladder, no display record. */
const LEGACY = {
  contentType: 'image/jpeg',
  cdnPath: '/api/media/cdn/site-a/m1',
  sizeBytes: 300_000,
  width: 1600,
  contentHash: 'abc123',
  variants: [320, 640, 1280, 1920],
}

describe('mediaDeliveryCopiesStale (AGL-3486)', () => {
  it('is stale for a CDN image an older encoder made, and for one that never got variants', () => {
    expect(mediaDeliveryCopiesStale(LEGACY, NOW)).toBe(true)
    expect(mediaDeliveryCopiesStale({ ...LEGACY, variants: [] }, NOW)).toBe(true)
    expect(
      mediaDeliveryCopiesStale(
        { ...LEGACY, [MEDIA_VARIANT_ENCODER_VERSION_FIELD]: MEDIA_VARIANT_ENCODER_VERSION - 1 },
        NOW,
      ),
    ).toBe(true)
  })

  it('is not stale at the current generation', () => {
    expect(
      mediaDeliveryCopiesStale(
        { ...LEGACY, [MEDIA_VARIANT_ENCODER_VERSION_FIELD]: MEDIA_VARIANT_ENCODER_VERSION },
        NOW,
      ),
    ).toBe(false)
  })

  it('leaves alone what the upload routes would not have generated for', () => {
    // No CDN path: a free workspace's asset, or a private one.
    expect(mediaDeliveryCopiesStale({ ...LEGACY, cdnPath: undefined }, NOW)).toBe(false)
    expect(mediaDeliveryCopiesStale({ ...LEGACY, contentType: 'image/svg+xml' }, NOW)).toBe(false)
    expect(mediaDeliveryCopiesStale({ ...LEGACY, contentType: 'image/x-icon' }, NOW)).toBe(false)
    expect(mediaDeliveryCopiesStale({ ...LEGACY, contentType: 'video/mp4' }, NOW)).toBe(false)
    expect(mediaDeliveryCopiesStale({ ...LEGACY, sizeBytes: 40 * 1024 * 1024 }, NOW)).toBe(false)
    // A GIF narrower than every width has no variants and no display copy.
    expect(
      mediaDeliveryCopiesStale({ ...LEGACY, contentType: 'image/gif', width: 100 }, NOW),
    ).toBe(false)
  })

  it('waits out another regeneration’s lease, and does not retry a generation that failed', () => {
    expect(
      mediaDeliveryCopiesStale({ ...LEGACY, variantRegeneration: { startedAtMs: NOW - 1000 } }, NOW),
    ).toBe(false)
    expect(
      mediaDeliveryCopiesStale(
        { ...LEGACY, variantRegeneration: { startedAtMs: NOW - MEDIA_REGENERATION_LEASE_MS - 1 } },
        NOW,
      ),
    ).toBe(true)
    expect(
      mediaDeliveryCopiesStale(
        { ...LEGACY, variantRegeneration: { failedVersion: MEDIA_VARIANT_ENCODER_VERSION } },
        NOW,
      ),
    ).toBe(false)
  })
})

/** One document and its writes, with a transaction that reads and writes it. */
function memoryDoc(initial: Record<string, unknown>) {
  let data: Record<string, unknown> | null = { ...initial }
  const apply = (update: Record<string, unknown>) => {
    const next = { ...(data ?? {}) }
    for (const [key, value] of Object.entries(update)) {
      if (value === '__delete__') delete next[key]
      else next[key] = value
    }
    data = next
  }
  const ref = {
    firestore: {
      runTransaction: async <T>(
        work: (transaction: {
          get: () => Promise<{ exists: boolean; data: () => Record<string, unknown> | undefined }>
          update: (ref: unknown, update: Record<string, unknown>) => void
        }) => Promise<T>,
      ): Promise<T> =>
        work({
          get: async () => ({
            exists: data !== null,
            data: () => (data ? { ...data } : undefined),
          }),
          update: (_ref, update) => apply(update),
        }),
    },
  }
  return {
    ref: ref as unknown as FirebaseFirestore.DocumentReference,
    read: () => data,
    /** A write from elsewhere — a replace landing mid-regeneration. */
    externalWrite: apply,
  }
}

/** An in-memory bucket that records every save and delete. */
function memoryBucket(objects: Record<string, Buffer>) {
  const store = new Map(Object.entries(objects))
  const types = new Map<string, string>()
  const deleted: string[] = []
  return {
    store,
    types,
    deleted,
    bucket: {
      file: (path: string) => ({
        download: async (): Promise<[Buffer]> => {
          const bytes = store.get(path)
          if (!bytes) throw new Error(`No such object: ${path}`)
          return [bytes]
        },
        save: async (bytes: Buffer, options: { contentType: string }) => {
          store.set(path, bytes)
          types.set(path, options.contentType)
        },
        delete: async () => {
          deleted.push(path)
          store.delete(path)
        },
      }),
    },
  }
}

async function photo(width: number, height: number, withGps = true): Promise<Buffer> {
  const sharp = await loadSharp()
  const pixels = Buffer.alloc(width * height * 3)
  for (let index = 0; index < pixels.length; index += 3) {
    const x = (index / 3) % width
    pixels[index] = Math.round((x * 255) / width)
    pixels[index + 1] = 128
    pixels[index + 2] = 200
  }
  let image = sharp(pixels, { raw: { width, height, channels: 3 } }).jpeg({ quality: 92 })
  if (withGps) {
    image = image.withMetadata({
      exif: { IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '35/1 35/1 0/1' } },
    })
  }
  return image.toBuffer()
}

const BASE = 'hosts/site-a/media/m1'

describe('regenerateMediaDeliveryCopies (AGL-3486)', () => {
  it('rewrites a legacy asset with the current encoder, and drops what the new set no longer names', async () => {
    const original = await photo(1600, 900)
    const legacyObjects = Object.fromEntries(
      LEGACY.variants.map((width) => [`${BASE}__w${width}.webp`, Buffer.from('old')]),
    )
    const { bucket, store, types, deleted } = memoryBucket({
      [BASE]: original,
      ...legacyObjects,
    })
    const doc = memoryDoc({ ...LEGACY, sizeBytes: original.length })

    await expect(
      regenerateMediaDeliveryCopies({ docRef: doc.ref, bucket, basePath: BASE, nowMs: NOW }),
    ).resolves.toBe('regenerated')

    const after = doc.read() ?? {}
    expect(after[MEDIA_VARIANT_ENCODER_VERSION_FIELD]).toBe(MEDIA_VARIANT_ENCODER_VERSION)
    expect(after['variantRegeneration']).toBeUndefined()
    const variants = after['variants'] as number[]
    // The finer ladder up to the source's own width, and on past it as
    // source-width re-encodes for a JPEG.
    expect(variants).toEqual(expect.arrayContaining([160, 480, 768, 960]))
    for (const width of variants) {
      const bytes = store.get(`${BASE}__w${width}.webp`)
      expect(bytes?.toString('ascii', 8, 12)).toBe('WEBP')
    }
    // The photo carried a GPS position, so the bare URL gets a stripped copy.
    expect(after['display']).toMatchObject({ contentType: 'image/jpeg', width: 1600, height: 900 })
    expect(types.get(`${BASE}__display`)).toBe('image/jpeg')
    // A legacy width the new set does not name is deleted — never one it does.
    for (const path of deleted) {
      const width = Number(/__w(\d+)\.webp$/.exec(path)?.[1])
      expect(variants).not.toContain(width)
    }
    // The original is never touched.
    expect(store.get(BASE)).toBe(original)
  })

  it('takes a lease, so a second request in the window does nothing', async () => {
    const original = await photo(800, 450, false)
    const { bucket } = memoryBucket({ [BASE]: original })
    const doc = memoryDoc({
      ...LEGACY,
      width: 800,
      sizeBytes: original.length,
      variantRegeneration: { startedAtMs: NOW - 5_000 },
    })
    await expect(
      regenerateMediaDeliveryCopies({ docRef: doc.ref, bucket, basePath: BASE, nowMs: NOW }),
    ).resolves.toBe('not-stale')
  })

  it('records nothing over a replace that landed while it worked', async () => {
    const original = await photo(800, 450, false)
    const { bucket } = memoryBucket({ [BASE]: original })
    const doc = memoryDoc({ ...LEGACY, width: 800, sizeBytes: original.length })
    const download = bucket.file(BASE).download
    const racing = {
      file: (path: string) => {
        const file = bucket.file(path)
        return path === BASE
          ? {
              ...file,
              download: async () => {
                doc.externalWrite({ contentHash: 'replaced', variants: [160] })
                return download()
              },
            }
          : file
      },
    }
    await expect(
      regenerateMediaDeliveryCopies({ docRef: doc.ref, bucket: racing, basePath: BASE, nowMs: NOW }),
    ).resolves.toBe('changed')
    expect(doc.read()?.['variants']).toEqual([160])
    expect(doc.read()?.[MEDIA_VARIANT_ENCODER_VERSION_FIELD]).toBeUndefined()
  })

  it('records a failure once, so the same generation is not retried on every view', async () => {
    const { bucket } = memoryBucket({ [BASE]: Buffer.from('not an image at all') })
    const doc = memoryDoc({ ...LEGACY, sizeBytes: 19 })
    await expect(
      regenerateMediaDeliveryCopies({ docRef: doc.ref, bucket, basePath: BASE, nowMs: NOW }),
    ).resolves.toBe('failed')
    const after = doc.read() ?? {}
    expect(after['variantRegeneration']).toMatchObject({
      failedVersion: MEDIA_VARIANT_ENCODER_VERSION,
    })
    expect(typeof after['variantsError']).toBe('string')
    // The old variants are still real objects, and still named.
    expect(after['variants']).toEqual(LEGACY.variants)
    expect(mediaDeliveryCopiesStale(after, NOW + 10 * MEDIA_REGENERATION_LEASE_MS)).toBe(false)
  })
})
