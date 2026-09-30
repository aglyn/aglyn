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

import { FIRST_PARTY_VIDEO_EMBED_PROVIDERS } from './first-party-plugins.generated'
import {
  type ResolvedVideoEmbedProvider,
  videoEmbedOf,
  videoEmbedPlayerOrigins,
  videoEmbedPlayerSrc,
  videoEmbedProviderLabels,
  videoEmbedProviders,
  videoEmbedUrl,
} from './video-embed-provider'

/**
 * Core's resolvers over a host no plugin declares, so what is tested is the
 * contract rather than any one vendor's grammar. The declaring plugin's own
 * spec holds its declaration to the links it must keep reading.
 */

const PLAYER: ResolvedVideoEmbedProvider = {
  pluginId: 'example-plugin',
  id: 'example-player',
  label: 'Example Player',
  domains: ['player.example.net', 'ex.example'],
  mediaIdPaths: ['^\\/watch\\/([^/]+)\\/?$', '^\\/v\\/([^/]+)$'],
  mediaIdPattern: '^[a-z0-9]{6}$',
  playerOrigin: 'https://embed.example.net',
  playerPath: '/frame/{id}',
  playerQuery: [
    { param: 'play', option: 'autoPlay', on: '1', off: '0' },
    { param: 'chrome', value: 'none' },
    { param: 'dnt', option: 'doNotTrack', on: '1' },
    { param: 'mute', option: 'muted', on: '1' },
    { param: 'repeat', option: 'loop', on: 'yes', off: 'no' },
  ],
}
const OTHER: ResolvedVideoEmbedProvider = {
  pluginId: 'example-plugin',
  id: 'other-player',
  label: 'Other Player',
  domains: ['other.example'],
  mediaIdPaths: ['^\\/(.+)$'],
  mediaIdPattern: '^.+$',
  playerOrigin: 'https://embed.example.net',
  playerPath: '/other/{id}',
}
const HOSTS = [PLAYER, OTHER]

describe('videoEmbedOf reads a declared host’s link (AGL-3080)', () => {
  it.each([
    'https://player.example.net/watch/abc123',
    'https://www.player.example.net/watch/abc123/',
    'http://ex.example/v/abc123',
    '  https://player.example.net/watch/abc123?t=4#x  ',
  ])('finds the id in %s', (link) => {
    expect(videoEmbedOf(link, HOSTS)).toEqual({
      provider: PLAYER,
      mediaId: 'abc123',
      embedUrl: 'https://embed.example.net/frame/abc123',
    })
  })

  it.each([
    ['a host that only ends in the name', 'https://notplayer.example.net/watch/abc123'],
    ['a host that only starts with it', 'https://player.example.net.evil.test/watch/abc123'],
    ['the name in the query instead of the host', 'https://evil.test/watch/abc123?h=player.example.net'],
    ['a path no pattern names', 'https://player.example.net/stats/abc123'],
    ['an id the host’s pattern refuses', 'https://player.example.net/watch/ABC123'],
    ['a script URL', 'javascript:alert(1)//player.example.net/watch/abc123'],
    ['a bare id', 'abc123'],
    ['a media reference', 'media:host1/abc123'],
    ['nothing', ''],
    ['a non-string', 42],
  ])('refuses %s', (_why, value) => {
    expect(videoEmbedOf(value, HOSTS)).toBeUndefined()
  })

  it('never lets a declaration widen the player path, whatever its pattern admits', () => {
    // `OTHER` accepts anything as an id. Core's floor still refuses a
    // separator, a dot or an encoded one, so the frame stays on the path the
    // declaration names.
    for (const link of [
      'https://other.example/a/b',
      'https://other.example/a.b',
      'https://other.example/a%2Fb',
    ]) {
      expect(videoEmbedOf(link, HOSTS)).toBeUndefined()
    }
    expect(videoEmbedUrl('https://other.example/ok_id-1', HOSTS)).toBe(
      'https://embed.example.net/other/ok_id-1',
    )
  })

  it('answers nothing when nothing is declared', () => {
    expect(videoEmbedOf('https://player.example.net/watch/abc123', [])).toBeUndefined()
  })
})

describe('videoEmbedPlayerSrc rebuilds the address from the id alone', () => {
  const link = 'https://player.example.net/watch/abc123?evil=1#frag'

  it('writes the declared query in its own order, autoplaying by default', () => {
    expect(videoEmbedPlayerSrc(link, {}, HOSTS)).toBe(
      'https://embed.example.net/frame/abc123?play=1&chrome=none&repeat=no',
    )
  })

  it('turns autoplay off only for an explicit false', () => {
    expect(videoEmbedPlayerSrc(link, { autoPlay: false }, HOSTS)).toContain('play=0')
    expect(videoEmbedPlayerSrc(link, { autoPlay: undefined }, HOSTS)).toContain('play=1')
  })

  it('sends an option only in the states the host spells', () => {
    const src = videoEmbedPlayerSrc(
      link,
      { doNotTrack: true, muted: true, loop: true },
      HOSTS,
    ) as string
    expect(src).toBe(
      'https://embed.example.net/frame/abc123?play=1&chrome=none&dnt=1&mute=1&repeat=yes',
    )
    expect(src).not.toContain('evil')
    expect(src).not.toContain('frag')
  })

  it('leaves the query off a host that declares none', () => {
    expect(videoEmbedPlayerSrc('https://other.example/abc', {}, HOSTS)).toBe(
      'https://embed.example.net/other/abc',
    )
  })

  it('builds nothing for a link no host declares', () => {
    expect(videoEmbedPlayerSrc('https://videos.example.com/film.mp4', {}, HOSTS)).toBeUndefined()
  })
})

describe('what the published page and the console read', () => {
  it('names each player origin once, for frame-src', () => {
    expect(videoEmbedPlayerOrigins(HOSTS)).toEqual(['https://embed.example.net'])
  })

  it('names each host as an author knows it', () => {
    expect(videoEmbedProviderLabels(HOSTS)).toEqual(['Example Player', 'Other Player'])
  })

  it('reads the compiled list by default, so no reader depends on a registration', () => {
    expect(videoEmbedProviders()).toBe(FIRST_PARTY_VIDEO_EMBED_PROVIDERS)
    for (const provider of videoEmbedProviders()) {
      expect(provider.playerOrigin.startsWith('https://')).toBe(true)
      expect(videoEmbedPlayerOrigins()).toContain(provider.playerOrigin)
    }
  })
})
