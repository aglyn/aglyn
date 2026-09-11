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
 * The one grammar for what a product's paid media URL names (AGL-2814).
 *
 * The stream route signs from this answer, the console shows the author
 * whether a video is protected from it, and the media route refuses to publish
 * a file a product still sells from it. A shape this misreads is therefore
 * either a link that cannot play or, worse, a Storage token URL handed through
 * as if it were somebody else's hotlink — so every stored shape is driven here.
 */

import {
  paidMediaAssetOf,
  paidMediaAssetOfObject,
  parsePaidMediaSource,
  samePaidMediaLibrary,
} from './paid-media-source'

const BUCKET = 'aglyn-test.appspot.com'

/** A raw download URL, the way every upload route mints one. */
const downloadUrl = (objectPath: string, bucket = BUCKET) =>
  `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/` +
  `${encodeURIComponent(objectPath)}?alt=media&token=long-lived-token`

describe('parsePaidMediaSource', () => {
  it('reads every library form the pickers and the CDN have written', () => {
    for (const [stored, scope] of [
      ['media:host-1/med-film', 'host-1'],
      ['media:org:acme/med-film@abc123def456', 'org:acme'],
      ['media:org:acme:host-1/med-film', 'org:acme:host-1'],
      ['/api/media/cdn/org:acme/med-film', 'org:acme'],
      ['/api/media/cdn/org:acme/med-film/abc123def456', 'org:acme'],
      ['/api/media/cdn/org:acme/med-film?r=auto&exp=1&sig=x', 'org:acme'],
      ['https://demo.aglyn.app/api/media/cdn/host-1/med-film', 'host-1'],
    ] as const) {
      expect(parsePaidMediaSource(stored)).toEqual({
        kind: 'asset',
        scope,
        mediaId: 'med-film',
      })
    }
  })

  it('reads a Storage download or GCS URL as the object it names', () => {
    expect(
      parsePaidMediaSource(downloadUrl('hosts/host-1/media/Films/med-film')),
    ).toEqual({
      kind: 'storage-object',
      bucket: BUCKET,
      objectPath: 'hosts/host-1/media/Films/med-film',
    })
    expect(
      parsePaidMediaSource(
        `https://storage.googleapis.com/${BUCKET}/hosts/host-1/media/week%201.mp4`,
      ),
    ).toEqual({
      kind: 'storage-object',
      bucket: BUCKET,
      objectPath: 'hosts/host-1/media/week 1.mp4',
    })
  })

  it('reads the Storage emulator’s download URLs the same way', () => {
    const previous = process.env['FIREBASE_STORAGE_EMULATOR_HOST']
    process.env['FIREBASE_STORAGE_EMULATOR_HOST'] = '127.0.0.1:9199'
    try {
      expect(
        parsePaidMediaSource(
          `http://127.0.0.1:9199/v0/b/${BUCKET}/o/hosts%2Fhost-1%2Fmedia%2Fm1?alt=media&token=t`,
        ),
      ).toEqual({
        kind: 'storage-object',
        bucket: BUCKET,
        objectPath: 'hosts/host-1/media/m1',
      })
    } finally {
      if (previous === undefined) {
        delete process.env['FIREBASE_STORAGE_EMULATOR_HOST']
      } else {
        process.env['FIREBASE_STORAGE_EMULATOR_HOST'] = previous
      }
    }
  })

  it('⛔ never classifies a Storage URL it cannot read as a hotlink', () => {
    // A token URL in an unfamiliar shape is still a token URL.
    for (const stored of [
      'https://firebasestorage.googleapis.com/v1/weird?token=t',
      'https://firebasestorage.googleapis.com/v0/b/x/o/a%ZZ?token=t',
      'https://storage.googleapis.com/',
    ]) {
      expect(parsePaidMediaSource(stored)).toEqual({ kind: 'malformed' })
    }
  })

  it('treats somebody else’s server as external, even when its path looks like ours', () => {
    for (const stored of [
      'https://videos.example.com/w1.m3u8',
      'https://evil.example/api/media/cdn/host-1/med-film',
      'http://videos.example.com/w1.mp4',
    ]) {
      expect(parsePaidMediaSource(stored)).toEqual({
        kind: 'external',
        url: stored,
      })
    }
  })

  it('⛔ refuses what no delivery can be built from', () => {
    for (const stored of [
      undefined,
      null,
      42,
      '',
      '   ',
      'media:not a reference',
      '/uploads/film.mp4',
      '//videos.example.com/w1.mp4',
      'javascript:alert(1)',
      '/api/media/cdn/org:/med-film',
      '/api/media/cdn/host-1',
      '/api/media/cdn/host-1/med-film/abc/extra',
    ]) {
      expect(parsePaidMediaSource(stored)).toEqual({ kind: 'malformed' })
    }
  })
})

describe('paidMediaAssetOfObject', () => {
  it('names the asset an object key belongs to, wherever folders put it', () => {
    expect(paidMediaAssetOfObject('hosts/host-1/media/m1')).toEqual({
      scope: 'host-1',
      mediaId: 'm1',
    })
    expect(paidMediaAssetOfObject('orgs/acme/media/Films/2026/m1')).toEqual({
      scope: 'org:acme',
      mediaId: 'm1',
    })
  })

  it('names no asset for a derived object, a foreign prefix, or traversal', () => {
    for (const objectPath of [
      'orgs/acme/media/Films/m1__r720p.mp4',
      'orgs/acme/media/Films/m1__poster.webp',
      'hosts/host-1/media/week-1.mp4',
      'hosts/host-1/secrets/m1',
      'adminAudit-archive/2026/m1',
      'users/u1/media/m1',
      'hosts/host-1/media/../m1',
      'hosts/host-1/media//m1',
      'hosts/host-1/media',
      '',
    ]) {
      expect(paidMediaAssetOfObject(objectPath)).toBeNull()
    }
  })
})

describe('paidMediaAssetOf', () => {
  it('names the same asset from every stored form', () => {
    for (const stored of [
      'media:org:acme/m1',
      '/api/media/cdn/org:acme:host-1/m1/abc123',
      downloadUrl('orgs/acme/media/Films/m1'),
    ]) {
      expect(paidMediaAssetOf(stored)?.mediaId).toBe('m1')
    }
  })

  it('⛔ names nothing for a download URL from another bucket when told which one is ours', () => {
    const foreign = downloadUrl('orgs/acme/media/m1', 'someone-else.appspot.com')
    expect(paidMediaAssetOf(foreign, { bucket: BUCKET })).toBeNull()
    expect(paidMediaAssetOf(downloadUrl('orgs/acme/media/m1'), { bucket: BUCKET }))
      .toEqual({ scope: 'org:acme', mediaId: 'm1' })
  })

  it('names nothing for a hotlink or a malformed value', () => {
    expect(paidMediaAssetOf('https://videos.example.com/w1.m3u8')).toBeNull()
    expect(paidMediaAssetOf('media:not a reference')).toBeNull()
  })
})

describe('samePaidMediaLibrary', () => {
  it('matches an org library whatever site either side is qualified with', () => {
    expect(samePaidMediaLibrary('org:acme', 'org:acme:host-1')).toBe(true)
    expect(samePaidMediaLibrary('org:acme:host-2', 'org:acme:host-1')).toBe(true)
    expect(samePaidMediaLibrary('host-1', 'host-1')).toBe(true)
  })

  it('⛔ keeps libraries apart', () => {
    expect(samePaidMediaLibrary('org:acme', 'org:rival')).toBe(false)
    expect(samePaidMediaLibrary('host-1', 'host-2')).toBe(false)
    expect(samePaidMediaLibrary('acme', 'org:acme')).toBe(false)
  })
})
