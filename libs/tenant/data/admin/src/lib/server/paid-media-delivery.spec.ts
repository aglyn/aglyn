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
 * Where a paid product's media may be redirected to (AGL-2814).
 *
 * Every signature in this file is minted and verified with the real secret
 * and the real `media-signing` module, so an assertion that a link "expires"
 * is an assertion about the verifier the CDN runs, not about a string shape.
 * What a stored value NAMES is `paid-media-source.spec.ts`; this file is what
 * the platform does about it.
 */

process.env['TOKEN_SIGNING_SECRET'] = 'paid-media-spec-secret'

// `serve-media-cdn` is imported for its scope rules only; nothing here may
// reach a real Firestore or bucket.
jest.mock('./firebase-admin', () => ({ firebaseAdmin: {} }))

import {
  GATED_VIDEO_SESSION_TTL_MS,
  MEDIA_SIGNATURE_MAX_TTL_MS,
  verifyMediaAccess,
} from './media-signing'
import {
  createPaidMediaDeliveryIo,
  type PaidMediaDeliveryIo,
  resolvePaidMediaDelivery,
} from './paid-media-delivery'

const HOST = 'host-1'
const ORG = 'acme'
const BUCKET = 'aglyn-test.appspot.com'
const NOW = 1_800_000_000_000
const TTL = GATED_VIDEO_SESSION_TTL_MS

/** A raw download URL, the way every upload route mints one. */
const downloadUrl = (objectPath: string, bucket = BUCKET) =>
  `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/` +
  `${encodeURIComponent(objectPath)}?alt=media&token=long-lived-token`

function makeIo() {
  const media = new Map<string, Record<string, unknown>>()
  const reads: string[] = []
  const signedReads: { objectPath: string; expiresAtMs: number }[] = []
  const io: PaidMediaDeliveryIo = {
    bucketName: BUCKET,
    readMedia: async (collection, scopeId, mediaId) => {
      const path = `${collection}/${scopeId}/media/${mediaId}`
      reads.push(path)
      const data = media.get(path)
      return { exists: data !== undefined, get: (field) => data?.[field] }
    },
    orgIdForHost: async (hostId) => (hostId === HOST ? ORG : null),
    signStorageRead: async (objectPath, expiresAtMs) => {
      signedReads.push({ objectPath, expiresAtMs })
      return (
        `https://storage.googleapis.com/${BUCKET}/${objectPath}` +
        '?X-Goog-Algorithm=GOOG4-RSA-SHA256&X-Goog-Signature=v4'
      )
    },
  }
  return { io, media, reads, signedReads }
}

function resolve(
  stored: unknown,
  io: PaidMediaDeliveryIo,
  overrides: Partial<Parameters<typeof resolvePaidMediaDelivery>[0]> = {},
) {
  return resolvePaidMediaDelivery({
    stored,
    hostId: HOST,
    ttlMs: TTL,
    nowMs: NOW,
    cdnParams: [['r', 'auto']],
    io,
    ...overrides,
  })
}

/** The pieces of a signed CDN location a verifier reads. */
function signedParts(location: string) {
  const url = new URL(location, 'https://shop.example')
  return {
    path: url.pathname,
    r: url.searchParams.get('r'),
    exp: Number(url.searchParams.get('exp')),
    sig: String(url.searchParams.get('sig') ?? ''),
    exps: url.searchParams.getAll('exp').length,
    sigs: url.searchParams.getAll('sig').length,
  }
}

describe('resolvePaidMediaDelivery (AGL-2814)', () => {
  it('signs a private asset of the site’s own library for the session window', async () => {
    const { io, media } = makeIo()
    media.set('hosts/host-1/media/med-film', { private: true })
    const delivery = await resolve('media:host-1/med-film', io)
    expect(delivery.ok && delivery.via).toBe('signed-cdn')
    if (!delivery.ok || delivery.via !== 'signed-cdn') return
    const parts = signedParts(delivery.location)
    expect(parts.path).toBe('/api/media/cdn/host-1/med-film')
    expect(parts.r).toBe('auto')
    expect(parts.exp).toBe(NOW + TTL)
    expect(delivery.expiresAtMs).toBe(NOW + TTL)
    expect(
      verifyMediaAccess('host-1', 'med-film', parts, NOW + TTL - 1),
    ).toBe(true)
    expect(verifyMediaAccess('host-1', 'med-film', parts, NOW + TTL)).toBe(
      false,
    )
  })

  it('qualifies an org asset with the site selling it, and signs that scope', async () => {
    const { io, media } = makeIo()
    media.set('orgs/acme/media/med-film', { private: true, visibleTo: ['org'] })
    for (const stored of [
      'media:org:acme/med-film',
      'media:org:acme:host-elsewhere/med-film',
      '/api/media/cdn/org:acme/med-film/abc123def456',
    ]) {
      const delivery = await resolve(stored, io)
      if (!delivery.ok || delivery.via !== 'signed-cdn') {
        throw new Error(`expected a signed CDN link for ${stored}`)
      }
      const parts = signedParts(delivery.location)
      expect(parts.path).toBe('/api/media/cdn/org:acme:host-1/med-film')
      expect(verifyMediaAccess('org:acme:host-1', 'med-film', parts, NOW)).toBe(
        true,
      )
      // The CDN verifies against the URL's own scope segment, so a signature
      // for the qualified form must not also open the bare one.
      expect(verifyMediaAccess('org:acme', 'med-film', parts, NOW)).toBe(false)
    }
  })

  it('⛔ refuses a public asset instead of handing out its permanent URL', async () => {
    const { io, media } = makeIo()
    media.set('orgs/acme/media/med-film', { visibleTo: ['org'] })
    expect(await resolve('media:org:acme/med-film', io)).toEqual({
      ok: false,
      refusal: 'not-private',
    })
    media.set('orgs/acme/media/med-film', { visibleTo: ['org'], private: 'yes' })
    expect(await resolve('media:org:acme/med-film', io)).toEqual({
      ok: false,
      refusal: 'not-private',
    })
  })

  it('⛔ refuses a missing, deleted, or unshared asset', async () => {
    const { io, media } = makeIo()
    expect(await resolve('media:host-1/med-film', io)).toEqual({
      ok: false,
      refusal: 'not-found',
    })
    media.set('hosts/host-1/media/med-film', { private: true, deletedAt: 1 })
    expect(await resolve('media:host-1/med-film', io)).toEqual({
      ok: false,
      refusal: 'not-found',
    })
    media.set('orgs/acme/media/med-film', {
      private: true,
      visibleTo: ['host:host-2'],
    })
    expect(await resolve('media:org:acme/med-film', io)).toEqual({
      ok: false,
      refusal: 'not-found',
    })
  })

  it('⛔ never reads or signs another site’s or another org’s library', async () => {
    const { io, media, reads } = makeIo()
    media.set('hosts/host-2/media/med-film', { private: true })
    media.set('orgs/rival/media/med-film', { private: true, visibleTo: ['org'] })
    for (const stored of [
      'media:host-2/med-film',
      'media:org:rival/med-film',
      'media:org:rival:host-1/med-film',
      '/api/media/cdn/org:rival/med-film',
    ]) {
      expect(await resolve(stored, io)).toEqual({
        ok: false,
        refusal: 'out-of-scope',
      })
    }
    expect(reads).toEqual([])
    // A site with no org behind it has no org library to sign from.
    expect(
      await resolve('media:org:acme/med-film', io, { hostId: 'host-unindexed' }),
    ).toEqual({ ok: false, refusal: 'out-of-scope' })
    expect(await resolve('media:host-1/med-film', io, { hostId: '' })).toEqual({
      ok: false,
      refusal: 'out-of-scope',
    })
  })

  describe('a Storage download URL is never the redirect', () => {
    it('signs the library asset its object belongs to', async () => {
      const { io, media } = makeIo()
      media.set('orgs/acme/media/med-film', {
        private: true,
        visibleTo: ['org'],
        storagePath: 'orgs/acme/media/Films/med-film',
      })
      const delivery = await resolve(
        downloadUrl('orgs/acme/media/Films/med-film'),
        io,
      )
      if (!delivery.ok || delivery.via !== 'signed-cdn') {
        throw new Error('expected a signed CDN link')
      }
      expect(delivery.location).not.toContain('token=')
      expect(delivery.location).not.toContain('firebasestorage')
      expect(signedParts(delivery.location).path).toBe(
        '/api/media/cdn/org:acme:host-1/med-film',
      )
    })

    it('⛔ refuses the object of a public asset rather than passing its token on', async () => {
      const { io, media } = makeIo()
      media.set('hosts/host-1/media/med-film', {})
      expect(
        await resolve(downloadUrl('hosts/host-1/media/Films/med-film'), io),
      ).toEqual({ ok: false, refusal: 'not-private' })
    })

    it('gives an object no asset owns a V4 signed read with the same window', async () => {
      const { io, signedReads } = makeIo()
      const delivery = await resolve(
        downloadUrl('hosts/host-1/media/Programs/week-1.mp4'),
        io,
      )
      expect(delivery.ok && delivery.via).toBe('signed-storage')
      if (!delivery.ok || delivery.via !== 'signed-storage') return
      expect(signedReads).toEqual([
        {
          objectPath: 'hosts/host-1/media/Programs/week-1.mp4',
          expiresAtMs: NOW + TTL,
        },
      ])
      expect(delivery.expiresAtMs).toBe(NOW + TTL)
      expect(delivery.location).not.toContain('token=')
    })

    it('⛔ refuses a bucket this platform does not serve from, signing nothing', async () => {
      const { io, signedReads } = makeIo()
      expect(
        await resolve(
          downloadUrl('hosts/host-1/media/week-1.mp4', 'someone-else.appspot.com'),
          io,
        ),
      ).toEqual({ ok: false, refusal: 'foreign-storage' })
      expect(
        await resolve(downloadUrl('hosts/host-1/media/week-1.mp4'), {
          ...io,
          bucketName: '',
        }),
      ).toEqual({ ok: false, refusal: 'foreign-storage' })
      expect(signedReads).toEqual([])
    })

    it('⛔ refuses an object outside the site’s own libraries, signing nothing', async () => {
      const { io, signedReads, reads } = makeIo()
      for (const objectPath of [
        'hosts/host-2/media/week-1.mp4',
        'orgs/rival/media/week-1.mp4',
        'adminAudit-archive/2026/export.json',
        'hosts/host-1/secrets/week-1.mp4',
        'hosts/host-1/media/../../orgs/rival/media/week-1.mp4',
        'hosts/host-1/media/',
      ]) {
        expect(await resolve(downloadUrl(objectPath), io)).toEqual({
          ok: false,
          refusal: 'out-of-scope',
        })
      }
      expect(signedReads).toEqual([])
      expect(reads).toEqual([])
    })
  })

  it('passes somebody else’s server through untouched', async () => {
    const { io } = makeIo()
    expect(await resolve('https://videos.example.com/w1.m3u8', io)).toEqual({
      ok: true,
      via: 'external',
      location: 'https://videos.example.com/w1.m3u8',
    })
  })

  it('⛔ refuses a value it cannot resolve', async () => {
    const { io } = makeIo()
    expect(await resolve('media:not a reference', io)).toEqual({
      ok: false,
      refusal: 'malformed',
    })
  })

  it('⛔ lets no parameter stand in for the signature', async () => {
    const { io, media } = makeIo()
    media.set('hosts/host-1/media/med-film', { private: true })
    const delivery = await resolve('media:host-1/med-film', io, {
      cdnParams: [
        ['exp', '9999999999999'],
        ['sig', 'forged'],
        ['r', 'auto'],
      ],
    })
    if (!delivery.ok) throw new Error('expected a link')
    const parts = signedParts(delivery.location)
    expect(parts.exps).toBe(1)
    expect(parts.sigs).toBe(1)
    expect(parts.exp).toBe(NOW + TTL)
    expect(parts.sig).not.toBe('forged')
  })

  it('⛔ issues no lifetime the verifier would refuse, on either kind of link', async () => {
    const { io, media } = makeIo()
    media.set('hosts/host-1/media/med-film', { private: true })
    const tooLong = { ttlMs: MEDIA_SIGNATURE_MAX_TTL_MS + 1 }
    await expect(resolve('media:host-1/med-film', io, tooLong)).rejects.toThrow(
      RangeError,
    )
    await expect(
      resolve(downloadUrl('hosts/host-1/media/week-1.mp4'), io, tooLong),
    ).rejects.toThrow(RangeError)
  })
})

describe('createPaidMediaDeliveryIo', () => {
  it('reads the library document, the site’s org, and signs a V4 read', async () => {
    const paths: string[] = []
    const snapshot = (data?: Record<string, unknown>) => ({
      exists: data !== undefined,
      get: (field: string) => data?.[field],
    })
    const docRef = (path: string): any => ({
      get: async () => {
        paths.push(path)
        if (path === 'hostIndex/host-1') return snapshot({ orgId: 'acme' })
        if (path === 'orgs/acme/media/m1') return snapshot({ private: true })
        return snapshot()
      },
      collection: (name: string) => ({
        doc: (id: string) => docRef(`${path}/${name}/${id}`),
      }),
    })
    const configs: unknown[] = []
    const io = createPaidMediaDeliveryIo({
      firestore: {
        collection: (name: string) => ({
          doc: (id: string) => docRef(`${name}/${id}`),
        }),
      },
      bucket: {
        name: BUCKET,
        file: (path: string) => ({
          getSignedUrl: async (config: unknown) => {
            configs.push({ path, config })
            return ['https://signed.example/v4']
          },
        }),
      },
    })
    expect(io.bucketName).toBe(BUCKET)
    expect((await io.readMedia('orgs', 'acme', 'm1')).get('private')).toBe(true)
    expect(await io.orgIdForHost('host-1')).toBe('acme')
    expect(await io.orgIdForHost('host-unindexed')).toBeNull()
    expect(await io.signStorageRead('hosts/host-1/media/a.mp4', NOW + TTL)).toBe(
      'https://signed.example/v4',
    )
    expect(configs).toEqual([
      {
        path: 'hosts/host-1/media/a.mp4',
        config: { version: 'v4', action: 'read', expires: NOW + TTL },
      },
    ])
    expect(paths).toEqual([
      'orgs/acme/media/m1',
      'hostIndex/host-1',
      'hostIndex/host-unindexed',
    ])
  })
})
