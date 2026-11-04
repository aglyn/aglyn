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

import { FIRST_PARTY_VIDEO_EMBED_PROVIDERS } from '@aglyn/aglyn/plugin-manager/video-embed-providers.generated'
import {
  type VideoEmbedPlayerOptions,
  videoEmbedOf,
  videoEmbedPlayerOrigins,
  videoEmbedPlayerSrc,
  videoEmbedUrl,
} from '@aglyn/aglyn/plugin-manager/video-embed-provider'
import { muiVideoEmbedProviders } from './video-embed-providers'

/**
 * The Wistia declaration, read through core's resolvers over the COMPILED
 * list — the one the published page, its `VideoObject` and the tenant's
 * `frame-src` actually read. Every case below is a link an author has
 * already saved somewhere, so a declaration that stopped reading one would
 * turn a customer's film into a dead link.
 */

const ID = 'e4a27b971d'
const WISTIA_PLAYER_ORIGIN = 'https://fast.wistia.net'
const YOUTUBE_PLAYER_ORIGIN = 'https://www.youtube-nocookie.com'
const VIMEO_PLAYER_ORIGIN = 'https://player.vimeo.com'

const wistiaMediaId = (value: unknown) => {
  const embed = videoEmbedOf(value)
  return embed?.provider.id === 'wistia' ? embed.mediaId : undefined
}
const wistiaEmbedUrl = (value: unknown) => videoEmbedUrl(value)
const wistiaPlayerSrc = (value: unknown, options?: VideoEmbedPlayerOptions) =>
  videoEmbedPlayerSrc(value, options)

describe('the compiled declaration is this module\'s (AGL-3080)', () => {
  it('matches what the plugin declares, so a regeneration was not skipped', () => {
    const compiled = FIRST_PARTY_VIDEO_EMBED_PROVIDERS.filter(
      (provider) => provider.pluginId === 'mui',
    )
    // The generator lists every host in id order, whatever order a plugin
    // declares them in.
    expect(compiled).toEqual(
      muiVideoEmbedProviders()
        .map((declaration) => ({ pluginId: 'mui', ...declaration }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    )
  })

  it("frames Wistia's player from its one origin", () => {
    expect(videoEmbedPlayerOrigins()).toContain(WISTIA_PLAYER_ORIGIN)
  })

  it('frames YouTube and Vimeo from the privacy-enhanced origins only (AGL-4140)', () => {
    const origins = videoEmbedPlayerOrigins()
    expect(origins).toContain(YOUTUBE_PLAYER_ORIGIN)
    expect(origins).toContain(VIMEO_PLAYER_ORIGIN)
    // Never the cookie-setting player: no declaration names its origin.
    expect(origins).not.toContain('https://www.youtube.com')
  })
})

describe('the declaration reads the links Wistia hands an author (AGL-2826)', () => {
  for (const link of [
    `https://aglyn.wistia.com/medias/${ID}`,
    `https://aglyn.wistia.com/medias/${ID}/manage`,
    `https://aglyn.wistia.com/m/${ID}`,
    `https://home.wistia.com/medias/${ID}`,
    `https://fast.wistia.net/embed/iframe/${ID}`,
    `https://fast.wistia.net/embed/iframe/${ID}?videoFoam=true`,
    `https://fast.wistia.com/embed/iframe/${ID}`,
    `https://fast.wistia.com/embed/medias/${ID}.jsonp`,
    `https://wi.st/medias/${ID}`,
    `  https://aglyn.wistia.com/medias/${ID}  `,
  ]) {
    it(`finds the id in ${link.trim()}`, () => {
      expect(wistiaMediaId(link)).toBe(ID)
    })
  }

  for (const [why, value] of [
    ['a host that only ends in the name', `https://notwistia.com/medias/${ID}`],
    [
      'a host that only starts with it',
      `https://wistia.com.example.net/medias/${ID}`,
    ],
    [
      'the name in the query instead of the host',
      `https://example.net/medias/${ID}?h=wistia.com`,
    ],
    ['a share link, which names no id', 'https://aglyn.wistia.com/s/hero-film'],
    ['an id of the wrong length', 'https://aglyn.wistia.com/medias/e4a27b971'],
    ['an id with capitals', 'https://aglyn.wistia.com/medias/E4A27B971D'],
    ['a path that is not a media', `https://aglyn.wistia.com/stats/${ID}`],
    ['a script URL', `javascript:alert(1)//fast.wistia.net/embed/iframe/${ID}`],
    ['a bare id', ID],
    ['a media reference', `media:host1/${ID}`],
    ['nothing', ''],
    ['a non-string', 42],
  ] as const) {
    it(`refuses ${why}`, () => {
      expect(wistiaMediaId(value)).toBeUndefined()
    })
  }
})

describe('the Wistia builders rebuild the address from the id alone', () => {
  it('names the player page as the embed URL', () => {
    expect(wistiaEmbedUrl(`https://aglyn.wistia.com/medias/${ID}`)).toBe(
      `${WISTIA_PLAYER_ORIGIN}/embed/iframe/${ID}`,
    )
  })

  it('drops everything the author pasted except the id', () => {
    // The pasted query and fragment never reach a frame: the address is
    // rebuilt, which is what keeps `frame-src` to one closed origin.
    const src = wistiaPlayerSrc(
      `https://fast.wistia.com/embed/iframe/${ID}?plugin[x]=evil#frag`,
    ) as string
    expect(new URL(src).origin).toBe(WISTIA_PLAYER_ORIGIN)
    expect(src).not.toContain('evil')
    expect(src).not.toContain('frag')
  })

  it('plays at once, because the frame only exists after a press', () => {
    expect(wistiaPlayerSrc(`https://wi.st/medias/${ID}`)).toBe(
      `${WISTIA_PLAYER_ORIGIN}/embed/iframe/${ID}?autoPlay=true&roundedPlayer=false`,
    )
  })

  it('says autoPlay=false for a player the page loads before any press (AGL-2962)', () => {
    // Stated rather than left out: an option in the embed overrides a media
    // whose own Wistia settings autoplay.
    expect(
      wistiaPlayerSrc(`https://wi.st/medias/${ID}`, { autoPlay: false }),
    ).toBe(
      `${WISTIA_PLAYER_ORIGIN}/embed/iframe/${ID}?autoPlay=false&roundedPlayer=false`,
    )
  })

  it('turns Wistia\'s rounded chrome off on every address (AGL-3209)', () => {
    // The rounding is clipped inside the frame, over a white canvas, so on a
    // dark page it paints a white ring around the film. No option turns it
    // back on: the corner shape is the frame's, from the element's `radius`.
    for (const options of [
      {},
      { autoPlay: false },
      { doNotTrack: true, muted: true, loop: true },
    ]) {
      const params = new URL(
        wistiaPlayerSrc(`https://wi.st/medias/${ID}`, options) as string,
      ).searchParams
      expect(params.get('roundedPlayer')).toBe('false')
    }
  })

  it('keeps autoplay on for anything but an explicit false', () => {
    for (const options of [
      { autoPlay: true },
      { autoPlay: undefined },
      { doNotTrack: true },
    ]) {
      const params = new URL(
        wistiaPlayerSrc(`https://wi.st/medias/${ID}`, options) as string,
      ).searchParams
      expect(params.get('autoPlay')).toBe('true')
    }
  })

  it('carries doNotTrack, muted and loop only when asked', () => {
    const params = new URL(
      wistiaPlayerSrc(`https://wi.st/medias/${ID}`, {
        doNotTrack: true,
        muted: true,
        loop: true,
      }) as string,
    ).searchParams
    expect(params.get('doNotTrack')).toBe('true')
    expect(params.get('muted')).toBe('true')
    expect(params.get('endVideoBehavior')).toBe('loop')
  })

  it('builds nothing for a link that is not Wistia', () => {
    expect(
      wistiaEmbedUrl('https://videos.example.com/film.mp4'),
    ).toBeUndefined()
    expect(wistiaPlayerSrc('media:host1/film')).toBeUndefined()
  })
})

const providerOf = (value: unknown) => videoEmbedOf(value)?.provider.id

describe('the declaration reads the links YouTube hands an author (AGL-4140)', () => {
  const YT = 'dQw4w9WgXcQ'

  for (const link of [
    `https://www.youtube.com/watch?v=${YT}`,
    `https://youtube.com/watch?v=${YT}&t=42s`,
    `https://m.youtube.com/watch?feature=share&v=${YT}`,
    `https://music.youtube.com/watch?v=${YT}&list=RD${YT}`,
    `https://www.youtube.com/shorts/${YT}`,
    `https://www.youtube.com/shorts/${YT}?feature=share`,
    `https://www.youtube.com/live/${YT}`,
    `https://www.youtube.com/embed/${YT}`,
    `https://www.youtube.com/embed/${YT}?start=10`,
    `https://www.youtube-nocookie.com/embed/${YT}`,
    `https://www.youtube.com/v/${YT}`,
    `https://youtu.be/${YT}`,
    `https://youtu.be/${YT}?si=share-token`,
    `  https://youtu.be/${YT}  `,
  ]) {
    it(`finds the id in ${link.trim()}`, () => {
      const embed = videoEmbedOf(link)
      expect(embed?.provider.id).toBe('youtube')
      expect(embed?.mediaId).toBe(YT)
    })
  }

  for (const [why, value] of [
    ['a channel', 'https://www.youtube.com/@aglyn'],
    ['a vanity page whose name is eleven letters', 'https://www.youtube.com/abcdefghijk'],
    ['a playlist', 'https://www.youtube.com/playlist?list=PL1234567890'],
    ['a playlist embed', 'https://www.youtube.com/embed/videoseries?list=PL1234567890'],
    ['a watch page without a film', 'https://www.youtube.com/watch?list=PL1234567890'],
    ['a search', 'https://www.youtube.com/results?search_query=bakery'],
    ['an id of the wrong length', 'https://youtu.be/dQw4w9WgXc'],
    ['a share link on the main domain', `https://www.youtube.com/${YT}`],
    ['a host that only ends in the name', `https://notyoutube.com/watch?v=${YT}`],
    ['the name in the query instead of the host', `https://example.net/watch?v=${YT}&h=youtube.com`],
  ] as const) {
    it(`refuses ${why}`, () => {
      expect(providerOf(value)).toBeUndefined()
    })
  }

  it('plays from the privacy-enhanced origin, whatever the author pasted', () => {
    for (const link of [
      `https://www.youtube.com/watch?v=${YT}&evil=1`,
      `https://youtu.be/${YT}#frag`,
    ]) {
      const src = videoEmbedPlayerSrc(link) as string
      expect(new URL(src).origin).toBe(YOUTUBE_PLAYER_ORIGIN)
      expect(src).not.toContain('evil')
      expect(src).not.toContain('frag')
    }
    expect(videoEmbedUrl(`https://youtu.be/${YT}`)).toBe(
      `${YOUTUBE_PLAYER_ORIGIN}/embed/${YT}`,
    )
  })

  it('autoplays a pressed player, and says autoplay=0 for one the page loads', () => {
    expect(videoEmbedPlayerSrc(`https://youtu.be/${YT}`)).toBe(
      `${YOUTUBE_PLAYER_ORIGIN}/embed/${YT}?autoplay=1&playsinline=1`,
    )
    expect(videoEmbedPlayerSrc(`https://youtu.be/${YT}`, { autoPlay: false })).toBe(
      `${YOUTUBE_PLAYER_ORIGIN}/embed/${YT}?autoplay=0&playsinline=1`,
    )
  })

  it('mutes and loops only when asked, looping as a playlist of the one film', () => {
    const params = new URL(
      videoEmbedPlayerSrc(`https://youtu.be/${YT}`, {
        muted: true,
        loop: true,
        doNotTrack: true,
      }) as string,
    ).searchParams
    expect(params.get('mute')).toBe('1')
    expect(params.get('loop')).toBe('1')
    expect(params.get('playlist')).toBe(YT)
    // The origin is the do-not-track form already; there is no switch to send.
    expect([...params.keys()]).toEqual([
      'autoplay',
      'playsinline',
      'mute',
      'loop',
      'playlist',
    ])
  })
})

describe('the declaration reads the links Vimeo hands an author (AGL-4140)', () => {
  const VM = '76979871'

  for (const link of [
    `https://vimeo.com/${VM}`,
    `https://www.vimeo.com/${VM}/`,
    `https://vimeo.com/channels/staffpicks/${VM}`,
    `https://vimeo.com/groups/shortfilms/videos/${VM}`,
    `https://vimeo.com/showcase/1234567/video/${VM}`,
    `https://vimeo.com/album/1234567/video/${VM}`,
    `https://vimeo.com/manage/videos/${VM}`,
    `https://player.vimeo.com/video/${VM}`,
    `https://player.vimeo.com/video/${VM}?badge=0&autopause=0`,
  ]) {
    it(`finds the id in ${link}`, () => {
      const embed = videoEmbedOf(link)
      expect(embed?.provider.id).toBe('vimeo')
      expect(embed?.mediaId).toBe(VM)
    })
  }

  for (const [why, value] of [
    // The player cannot play an unlisted film from its id alone, so the
    // link is refused rather than turned into a player that says the video
    // does not exist.
    ['an unlisted page with its private segment', `https://vimeo.com/${VM}/abcdef1234`],
    ['a profile', 'https://vimeo.com/aglyn'],
    ['a channel', 'https://vimeo.com/channels/staffpicks'],
    ['an id too short to be one', 'https://vimeo.com/12345'],
    ['a host that only ends in the name', `https://notvimeo.com/${VM}`],
  ] as const) {
    it(`refuses ${why}`, () => {
      expect(providerOf(value)).toBeUndefined()
    })
  }

  it('plays from the player origin with dnt=1 on every address', () => {
    for (const options of [
      {},
      { autoPlay: false },
      { doNotTrack: false, muted: true, loop: true },
    ]) {
      const src = videoEmbedPlayerSrc(`https://vimeo.com/${VM}?evil=1`, options) as string
      const url = new URL(src)
      expect(`${url.origin}${url.pathname}`).toBe(`${VIMEO_PLAYER_ORIGIN}/video/${VM}`)
      expect(url.searchParams.get('dnt')).toBe('1')
      expect(src).not.toContain('evil')
    }
  })

  it('autoplays a pressed player, and mutes and loops only when asked', () => {
    expect(videoEmbedPlayerSrc(`https://vimeo.com/${VM}`)).toBe(
      `${VIMEO_PLAYER_ORIGIN}/video/${VM}?autoplay=1&dnt=1`,
    )
    expect(
      videoEmbedPlayerSrc(`https://vimeo.com/${VM}`, {
        autoPlay: false,
        muted: true,
        loop: true,
      }),
    ).toBe(`${VIMEO_PLAYER_ORIGIN}/video/${VM}?autoplay=0&dnt=1&muted=1&loop=1`)
  })
})
