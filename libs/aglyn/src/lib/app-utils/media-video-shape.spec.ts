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
 * The video contract, held in one place (AGL-2742 / AGL-2743 / AGL-2745).
 *
 * Everything under test here is a pure function, and every one of them sits
 * on a seam between two things that ship separately: the console writes the
 * document, the CDN reads it, a besigner element renders it, and a script
 * produces the renditions. A seam like that does not fail loudly — a renderer
 * that builds `?poster=1` slightly differently from the handler that reads it
 * gets a 404 on a `<video poster>`, which a browser swallows silently and
 * nobody notices until someone asks why the page is slow.
 *
 * So this file is the written-down shape rather than a coverage exercise. The
 * three bounds it asserts are the ones a caller cannot see from a type:
 *
 * 1. `normalizeVideoMetadata` is ALL-OR-NOTHING on the three numbers, because
 *    `Infinity` is a real value `HTMLMediaElement.duration` returns.
 * 2. `parseMediaRendition` is a security gate, because its output is
 *    interpolated into a Cloud Storage object path on an admin-SDK read.
 * 3. `mediaPosterSrc` answers only for URLs this platform serves, because
 *    appending `?poster=1` to a hotlink asks a stranger's server for one.
 */

import { sendAnalyticsBeacon, videoQuartileEvent } from './analytics-beacon'
import {
  MEDIA_VIDEO_MAX_DURATION_MS,
  normalizeVideoMetadata,
  videoDurationIso8601,
} from './media-metadata'
import {
  isMediaRenditionKey,
  MEDIA_CDN_RENDITION_AUTO,
  mediaPosterObjectPath,
  mediaPosterSrc,
  mediaRenditionObjectPath,
  mediaRenditionSrc,
  parseMediaRendition,
  parseMediaRenditions,
  videoDeliverySrc,
} from './media-ref'

const GOOD = { durationMs: 60_000, width: 1920, height: 1080 }

describe('normalizeVideoMetadata bounds what a browser reported', () => {
  it('accepts a coherent report and rounds to whole units', () => {
    expect(normalizeVideoMetadata({ durationMs: 60_000.4, width: 1920, height: 1080 })).toEqual(
      GOOD,
    )
  })

  it('refuses an Infinity duration — the shape a stream actually returns', () => {
    // Not a hypothetical: `duration` is `Infinity` for a live stream and for
    // some WebM files until the element has been seeked to the end. Storing
    // it would put `Infinity` in a `VideoObject`.
    expect(normalizeVideoMetadata({ ...GOOD, durationMs: Infinity })).toBeNull()
    expect(normalizeVideoMetadata({ ...GOOD, durationMs: NaN })).toBeNull()
  })

  it('refuses a duration past the 24-hour bound', () => {
    expect(
      normalizeVideoMetadata({ ...GOOD, durationMs: MEDIA_VIDEO_MAX_DURATION_MS + 1 }),
    ).toBeNull()
  })

  it('is all-or-nothing: a missing dimension loses the duration too', () => {
    // A record with a duration and no width would make `VideoObject` emit one
    // and omit the other, and would make a renderer sizing its container from
    // `video.height` find the key present and the value absent.
    expect(normalizeVideoMetadata({ durationMs: 60_000, width: 1920 })).toBeNull()
    expect(normalizeVideoMetadata({ ...GOOD, height: 0 })).toBeNull()
    expect(normalizeVideoMetadata({ ...GOOD, width: -1 })).toBeNull()
    expect(normalizeVideoMetadata(null)).toBeNull()
    expect(normalizeVideoMetadata('60000')).toBeNull()
  })

  it('DROPS a malformed codec rather than losing the record over it', () => {
    // Same rule `formatMediaRef` applies to a bad content pin: a label
    // nothing branches on must not cost a working poster and a correct
    // aspect ratio.
    expect(normalizeVideoMetadata({ ...GOOD, codec: '<script>' })).toEqual(GOOD)
    expect(normalizeVideoMetadata({ ...GOOD, codec: 'avc1.640028' })).toEqual({
      ...GOOD,
      codec: 'avc1.640028',
    })
  })
})

describe('videoDurationIso8601 emits what a VideoObject wants', () => {
  it('formats whole seconds, hours down to seconds', () => {
    expect(videoDurationIso8601(60_000)).toBe('PT1M')
    expect(videoDurationIso8601(90_500)).toBe('PT1M31S')
    expect(videoDurationIso8601(3_661_000)).toBe('PT1H1M1S')
    expect(videoDurationIso8601(45_000)).toBe('PT45S')
  })

  it('rounds a sub-second duration UP, never to PT0S', () => {
    // `PT0S` reads as "no duration" to a consumer testing for truthiness.
    expect(videoDurationIso8601(400)).toBe('PT1S')
  })

  it('answers undefined for anything that is not a duration', () => {
    expect(videoDurationIso8601(0)).toBeUndefined()
    expect(videoDurationIso8601(-1)).toBeUndefined()
    expect(videoDurationIso8601(undefined)).toBeUndefined()
  })
})

describe('parseMediaRendition is a path gate, not a shape check', () => {
  const VALID = {
    key: '720p',
    ext: 'mp4',
    contentType: 'video/mp4',
    width: 1280,
    height: 720,
    sizeBytes: 12_582_912,
  }

  it('accepts a well-formed entry', () => {
    expect(parseMediaRendition(VALID)).toEqual(VALID)
  })

  it('refuses a key that would walk out of the asset prefix', () => {
    // The reason this is a gate: `mediaRenditionObjectPath` interpolates
    // `key` into an object path read with the admin SDK, which Storage rules
    // do not constrain — the AGL-1881 class, reached through a different
    // field. A media document is writable by anyone with editor rights.
    for (const key of [
      '../../../adminAudit-archive/x',
      'a/b',
      '_poster',
      '_w320',
      '-leading',
      'UPPER',
      'x'.repeat(25),
      '',
    ]) {
      expect(parseMediaRendition({ ...VALID, key })).toBeNull()
    }
  })

  it('refuses an extension that is not a bare word', () => {
    for (const ext of ['../x', 'm p4', 'mp4.exe', '']) {
      expect(parseMediaRendition({ ...VALID, ext })).toBeNull()
    }
  })

  it('refuses a contentType that is not video/*', () => {
    // The served `Content-Type` comes from this field rather than from
    // Storage metadata, so an unconstrained value would let a document
    // choose how a browser interprets bytes served from a customer's origin.
    for (const contentType of ['text/html', 'image/svg+xml', 'video', '']) {
      expect(parseMediaRendition({ ...VALID, contentType })).toBeNull()
    }
  })

  it('drops one bad entry rather than the whole list', () => {
    expect(parseMediaRenditions([VALID, { ...VALID, key: 'a/b' }])).toEqual([VALID])
    expect(parseMediaRenditions('nope')).toEqual([])
    expect(parseMediaRenditions(undefined)).toEqual([])
  })

  it('preserves stored ORDER, which is the codec preference', () => {
    const vp9 = { ...VALID, key: '720p-vp9', ext: 'webm', contentType: 'video/webm' }
    // A renderer emits one `<source>` per entry and a browser takes the first
    // it can decode, so the array order is a decision, not a detail.
    expect(parseMediaRenditions([vp9, VALID]).map((r) => r.key)).toEqual([
      '720p-vp9',
      '720p',
    ])
  })
})

describe('object paths', () => {
  it('places the poster and its widths under one suffix', () => {
    expect(mediaPosterObjectPath('orgs/a/media/v1')).toBe(
      'orgs/a/media/v1__poster.webp',
    )
  })

  it('names a rendition by key and extension', () => {
    expect(
      mediaRenditionObjectPath('orgs/a/media/v1', { key: '720p', ext: 'mp4' }),
    ).toBe('orgs/a/media/v1__r720p.mp4')
  })

  it('admits the keys the producer mints and refuses the collisions', () => {
    expect(isMediaRenditionKey('720p')).toBe(true)
    expect(isMediaRenditionKey('720p-vp9')).toBe(true)
    expect(isMediaRenditionKey('_poster')).toBe(false)
    expect(isMediaRenditionKey(720)).toBe(false)
  })
})

describe('poster and rendition URLs', () => {
  const REF = 'media:org:acme/v1'

  it('builds a poster URL off a stored reference', () => {
    expect(mediaPosterSrc(REF)).toBe('/api/media/cdn/org:acme/v1?poster=1')
    expect(mediaPosterSrc(REF, { width: 640 })).toBe(
      '/api/media/cdn/org:acme/v1?poster=1&w=640',
    )
  })

  it('asks a pinned reference for its poster at the stable URL (AGL-2798)', () => {
    expect(mediaPosterSrc('media:org:acme/v1@abc123')).toBe(
      '/api/media/cdn/org:acme/v1?poster=1',
    )
  })

  it('host-qualifies the scope exactly as resolveMediaSrc does', () => {
    expect(mediaPosterSrc(REF, { hostId: 'site9' })).toBe(
      '/api/media/cdn/org:acme:site9/v1?poster=1',
    )
  })

  it('answers undefined for a URL this platform does not serve', () => {
    // Appending `?poster=1` to a hotlink asks a stranger's server for a
    // poster; on a permissive host that answers with the whole video under a
    // name that promised 40 KB.
    expect(mediaPosterSrc('https://images.example.com/cat.jpg')).toBeUndefined()
    expect(
      mediaPosterSrc('https://firebasestorage.googleapis.com/v0/b/b/o/x?alt=media'),
    ).toBeUndefined()
    expect(mediaPosterSrc('')).toBeUndefined()
    expect(mediaPosterSrc('media:junk')).toBeUndefined()
  })

  it('builds a rendition URL, and refuses a key it would not serve', () => {
    expect(mediaRenditionSrc(REF, '720p')).toBe('/api/media/cdn/org:acme/v1?r=720p')
    // An empty `src` makes a browser re-request the PAGE, which is far more
    // expensive than a missing `<source>` element.
    expect(mediaRenditionSrc(REF, '../x')).toBeUndefined()
  })

  /*
   * The URL a player actually loads (AGL-2753). It asks for the best encoding
   * rather than naming one, which is the only way a page can reach a file
   * produced after it was published: renditions are made out of band and no
   * tenant render path reads a media document.
   */
  it('asks for the best encoding rather than naming one', () => {
    expect(videoDeliverySrc(REF)).toBe('/api/media/cdn/org:acme/v1?r=auto')
    expect(videoDeliverySrc(REF, { hostId: 'site9' })).toBe(
      '/api/media/cdn/org:acme:site9/v1?r=auto',
    )
    // A pinned reference asks at the stable URL too (AGL-2798).
    expect(videoDeliverySrc('media:org:acme/v1@abc123')).toBe(
      '/api/media/cdn/org:acme/v1?r=auto',
    )
  })

  it('⛔ passes a value it cannot improve through, rather than dropping it', () => {
    // The difference from `mediaPosterSrc`, which answers undefined: a poster
    // with no URL renders without one, but a VIDEO with no URL is a dead
    // player. A hotlink is not this platform's object and has no encodings to
    // ask for, so it comes back exactly as `resolveMediaSrc` left it.
    const hotlink = 'https://videos.example.com/film.mp4'
    expect(videoDeliverySrc(hotlink)).toBe(hotlink)
    expect(videoDeliverySrc(undefined)).toBeUndefined()
    expect(videoDeliverySrc('')).toBeUndefined()
  })

  it('⛔ keeps the sentinel out of the key space it shares', () => {
    // `auto` fits the key grammar, so a producer could mint one — and a
    // stored entry named `auto` would shadow the request every page makes.
    expect(isMediaRenditionKey(MEDIA_CDN_RENDITION_AUTO)).toBe(true)
    expect(
      parseMediaRendition({
        key: MEDIA_CDN_RENDITION_AUTO,
        ext: 'mp4',
        contentType: 'video/mp4',
        width: 1280,
        height: 720,
        sizeBytes: 1,
      }),
    ).toBeNull()
  })
})

describe('videoQuartileEvent fires each threshold once', () => {
  it('reports the crossing and nothing else', () => {
    expect(videoQuartileEvent(0.26, 0.1)).toBe('progress25')
    expect(videoQuartileEvent(0.51, 0.26)).toBe('progress50')
    expect(videoQuartileEvent(0.76, 0.51)).toBe('progress75')
  })

  it('says nothing when the threshold was already passed', () => {
    expect(videoQuartileEvent(0.6, 0.55)).toBeUndefined()
    expect(videoQuartileEvent(0.3, 0.9)).toBeUndefined()
  })

  it('never produces `complete` — that belongs to the `ended` event', () => {
    // Reaching 100% of the timeline is a seek; watching to the end is not,
    // and only the media element can tell them apart.
    expect(videoQuartileEvent(1, 0.9)).toBe(undefined)
  })
})

describe('the playback beacon rides the existing gate', () => {
  it('refuses to send from anything that is not a production surface', () => {
    // Every environment gate is inherited from `sendAnalyticsBeacon` rather
    // than re-implemented — which is what keeps a preview deployment and a
    // local `next dev`, both of which point at the production Firebase
    // project, from adding plays to a customer's dashboard.
    expect(sendAnalyticsBeacon({ video: 'play' })).toBe(false)
  })
})
