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

import {
  WISTIA_PLAYER_ORIGIN,
  wistiaEmbedUrl,
  wistiaMediaId,
  wistiaPlayerSrc,
} from './wistia-embed'

const ID = 'e4a27b971d'

describe('wistiaMediaId reads the links Wistia hands an author (AGL-2826)', () => {
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
      `${WISTIA_PLAYER_ORIGIN}/embed/iframe/${ID}?autoPlay=true`,
    )
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
