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
  classifyLoadFailure,
  generateMediaVariants,
  generateStoredMediaVariants,
  MEDIA_VARIANT_SOURCE_MAX_BYTES,
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

/**
 * AGL-1476: the same guarantee for an asset whose bytes are in STORAGE.
 *
 * Real `sharp` again, and in bytes again, for the reason the issue states: the
 * broken signed path answers `?w=320` with a 200 and 6,606,921 B of the
 * original PNG. Nothing short of counting bytes tells that apart from a
 * working one.
 */
describe('generateStoredMediaVariants fetches the bytes and generates (AGL-1476)', () => {
  it('downloads the object and writes variants that are genuinely SMALLER', async () => {
    const buffer = await sourcePng()
    const written = new Map<string, Buffer>()
    let downloads = 0
    const outcome = await generateStoredMediaVariants({
      contentType: 'image/png',
      sizeBytes: buffer.length,
      sourceWidth: 1200,
      objectPath: 'orgs/org-1/media/asset',
      readSource: async () => {
        downloads += 1
        return buffer
      },
      saveVariant: async (path, webp) => {
        written.set(path, webp)
      },
    })

    expect(downloads).toBe(1)
    expect(outcome.error).toBeUndefined()
    expect(outcome.variants).toEqual([320, 640])
    const w320 = written.get('orgs/org-1/media/asset__w320.webp') as Buffer
    const w640 = written.get('orgs/org-1/media/asset__w640.webp') as Buffer
    expect(w320.toString('ascii', 8, 12)).toBe('WEBP')
    expect(w320.length).toBeLessThan(buffer.length)
    expect(w320.length).toBeLessThan(w640.length)
  })

  it('never touches storage when there is nothing to generate', async () => {
    // The ordering guarantee. This route also carries 200 MB videos, and
    // discovering they have no variants must not cost a download.
    for (const contentType of ['video/mp4', 'application/pdf', 'image/svg+xml']) {
      const outcome = await generateStoredMediaVariants({
        contentType,
        sizeBytes: 200 * 1024 * 1024,
        objectPath: 'orgs/org-1/media/asset',
        readSource: async () => {
          throw new Error('must not download')
        },
        saveVariant: async () => {
          throw new Error('must not save')
        },
      })
      expect(outcome).toEqual({ variants: [] })
    }
  })

  it('does not download a source already narrower than every target width', async () => {
    const outcome = await generateStoredMediaVariants({
      contentType: 'image/png',
      sizeBytes: 4096,
      sourceWidth: 256,
      objectPath: 'orgs/org-1/media/icon',
      readSource: async () => {
        throw new Error('must not download')
      },
      saveVariant: async () => {
        throw new Error('must not save')
      },
    })
    expect(outcome).toEqual({ variants: [] })
  })

  it('refuses a source past the ceiling, and SAYS SO rather than reporting []', async () => {
    // `variants: []` with no error means "nothing was eligible" (AGL-1468).
    // A 40 MB image the platform accepted is eligible work that did not
    // happen, so it has to be countable.
    const outcome = await generateStoredMediaVariants({
      contentType: 'image/png',
      sizeBytes: 40 * 1024 * 1024,
      sourceWidth: 6000,
      objectPath: 'orgs/org-1/media/huge',
      readSource: async () => {
        throw new Error('must not download')
      },
      saveVariant: async () => {
        throw new Error('must not save')
      },
    })
    expect(outcome.variants).toEqual([])
    expect(outcome.error).toContain('too large')
  })

  it('admits every image the DAM accepts — the two ceilings agree', () => {
    // `IMAGE_MAX_BYTES` in apps/console/utils/media-upload-limits.ts. If that
    // is raised without raising this, large images silently stop getting
    // variants, which is exactly the bug this issue is about.
    expect(MEDIA_VARIANT_SOURCE_MAX_BYTES).toBe(15 * 1024 * 1024)
  })

  it('reports a failed download instead of an empty success', async () => {
    const outcome = await generateStoredMediaVariants({
      contentType: 'image/png',
      sizeBytes: 4 * 1024 * 1024,
      sourceWidth: 1200,
      objectPath: 'orgs/org-1/media/asset',
      readSource: async () => {
        throw new Error('storage said no')
      },
      saveVariant: async () => {
        throw new Error('must not save')
      },
    })
    expect(outcome.variants).toEqual([])
    expect(outcome.error).toContain('storage said no')
  })
})

describe('probeMediaVariantSupport (AGL-1468)', () => {
  it('confirms this runtime can actually produce a smaller WebP', async () => {
    await expect(probeMediaVariantSupport()).resolves.toEqual({ ok: true })
  })
})

/**
 * AGL-1471: the code the probe publishes has to name the failure.
 *
 * Production answered `sharp-unavailable`, and that turned out to be the
 * fallback for "the error had no `code`" — which is where BOTH interesting
 * failures land. `sharp` collects every failed `require` of its prebuilt
 * binaries and rethrows one composed `Error` with no `code`; `loadSharp`
 * throws a plain `Error` when the module resolves to a non-function. The
 * remedies are a build-tracing change and a bundler change respectively, so
 * one string for both costs a deploy cycle to disambiguate — and this bug has
 * already spent three weeks being invisible.
 *
 * The fixture is `sharp`'s real message, because the classifier reads prose:
 * there is no field to branch on, only the help text the loader composes.
 */
describe('classifyLoadFailure (AGL-1471)', () => {
  it('prefers a real error code when the platform supplies one', () => {
    const error = Object.assign(new Error('nope'), { code: 'ERR_DLOPEN_FAILED' })
    expect(classifyLoadFailure(error)).toBe('ERR_DLOPEN_FAILED')
  })

  it('names a native load failure, which carries no code at all', () => {
    // The first two lines sharp composes when no prebuilt binary loads.
    const error = new Error(
      'Could not load the "sharp" module using the linux-x64 runtime\n' +
        'Possible solutions:\n- Ensure optional dependencies can be installed:',
    )
    expect(classifyLoadFailure(error)).toBe('sharp-native-missing')
  })

  it('separates a module SHAPE problem from a missing binary', () => {
    const error = new Error(
      'sharp did not resolve to a function (module was object, ' +
        'default was undefined)',
    )
    expect(classifyLoadFailure(error)).toBe('sharp-not-a-function')
  })

  it('keeps the old fallback for anything it cannot place', () => {
    expect(classifyLoadFailure(new Error('something else entirely'))).toBe(
      'sharp-unavailable',
    )
    expect(classifyLoadFailure(undefined)).toBe('sharp-unavailable')
  })

  it('never lets the message itself out — a code is a fixed vocabulary', () => {
    // The health endpoint is public and a native loader failure names every
    // path it tried, including the deployment's filesystem layout.
    const error = new Error(
      'Could not load the "sharp" module using the linux-x64 runtime\n' +
        '/var/task/node_modules/sharp/node_modules/@img/sharp-linux-x64',
    )
    expect(classifyLoadFailure(error)).not.toContain('/var/task')
  })
})
