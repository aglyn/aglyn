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

import type { VideoEmbedProviderDeclaration } from '@aglyn/aglyn/plugin-manager/video-embed-provider'

/**
 * The video hosts whose own player the Video element plays a link in
 * (AGL-3080). Named under `videoEmbedProviders` in `plugins.config.json`: the
 * manifest generator calls this, validates the answer and compiles it into
 * core's `first-party-plugins.generated.ts`, where the published page, its
 * `VideoObject`, the entry page and the tenant's `frame-src` read it without
 * loading this plugin. Regenerate after changing it; `--check` refuses a
 * stale copy.
 *
 * It lives in this plugin because the element that plays these links does:
 * `components/video.tsx`, beside the YouTube and Vimeo embed block.
 *
 * Every host here gets the same treatment from the element (AGL-4140): the
 * poster first, the host's player only once a visitor presses play (or with
 * the page, behind analytics consent, when "Load the player with the page"
 * is on), and a player address rebuilt from the media id alone.
 */
export function muiVideoEmbedProviders(): VideoEmbedProviderDeclaration[] {
  return [WISTIA, YOUTUBE, VIMEO]
}

/**
 * Wistia (AGL-2826).
 *
 * ## The iframe embed, not the player script
 *
 * Wistia offers two embeds. The script embed runs Wistia's JavaScript in the
 * page itself, so every site would need `connect-src`, `img-src` and
 * `media-src` grants for Wistia's hosts, and the player's storage and beacons
 * would run as the site. The iframe embed runs all of that inside a document
 * on Wistia's origin, under Wistia's own policy: the page needs one
 * `frame-src` entry, and whatever the player stores is keyed to Wistia inside
 * the site's partition rather than written as the site.
 *
 * Measured on 2026-09-10: `fast.wistia.net/embed/iframe/{id}` answers 200
 * with no redirect, so no second origin is involved in loading the frame.
 *
 * ## The links an author is handed
 *
 * Wistia's oEmbed endpoint matches on the path rather than the host, and so
 * does this: a media page (`/medias/{id}`, and its `/manage`), its short form
 * (`/m/{id}`), an iframe embed's own address, and a script embed's media
 * address with or without its `.jsonp` suffix. A share link (`/s/{slug}`)
 * names no id and is refused rather than guessed at. An id is a hashed id:
 * ten lowercase letters and digits, e.g. `e4a27b971d`.
 *
 * ## The query
 *
 * `autoPlay` is stated both ways. The frame a page loads before anyone has
 * pressed anything ("Load the player with the page", AGL-2962) says
 * `autoPlay=false` rather than leaving the option out: an option in the
 * embed overrides the media's own settings in the Wistia account, and those
 * may be set to autoplay.
 *
 * `roundedPlayer=false` is on every address, and no option turns it back on
 * (AGL-3209). Wistia's rounded chrome rounds and clips INSIDE the frame,
 * where the document's own canvas is white: on a dark page the corner arcs
 * and the clip's antialiased edge composite as a white ring around the film
 * rather than as the page behind them. Measured on 2026-09-21 against the
 * live videos page, whose background is `rgb(42 52 64)` and whose film is
 * `rgb(22 30 52)`: the frame's first column read `rgb(137 141 152)` and its
 * top-left corner `rgb(195 198 201)` — lighter than either, so painted rather
 * than blended. With the option off the same pixels are the film. The shape
 * is the placement's to decide in any case: `VideoPlayerFrame` takes a
 * `radius` from the element's own control and puts it on the frame.
 *
 * `doNotTrack` is Wistia's embed option for not recording the viewing
 * session; `endVideoBehavior=loop` is its loop.
 */
const WISTIA: VideoEmbedProviderDeclaration = {
  id: 'wistia',
  label: 'Wistia',
  domains: ['wistia.com', 'wistia.net', 'wi.st'],
  mediaIdPaths: [
    '^\\/medias\\/([^/]+)(?:\\/manage)?\\/?$',
    '^\\/m\\/([^/]+)\\/?$',
    '^\\/embed\\/iframe\\/([^/]+)\\/?$',
    '^\\/embed\\/medias\\/([^/.]+)(?:\\.jsonp?)?\\/?$',
  ],
  mediaIdPattern: '^[a-z0-9]{10}$',
  playerOrigin: 'https://fast.wistia.net',
  playerPath: '/embed/iframe/{id}',
  playerQuery: [
    { param: 'autoPlay', option: 'autoPlay', on: 'true', off: 'false' },
    { param: 'roundedPlayer', value: 'false' },
    { param: 'doNotTrack', option: 'doNotTrack', on: 'true' },
    { param: 'muted', option: 'muted', on: 'true' },
    { param: 'endVideoBehavior', option: 'loop', on: 'loop' },
  ],
}

/**
 * YouTube (AGL-4140).
 *
 * ## The privacy-enhanced player, always
 *
 * The player is framed from `www.youtube-nocookie.com`, YouTube's
 * privacy-enhanced embed, on every address and whatever the visitor's
 * consent says: it is the one origin this declaration names, so there is no
 * second, cookie-setting player a link could reach. It is also the origin the
 * Video embed block (`components/blocks.tsx`) already builds, so the
 * published page's `frame-src` admits it already.
 *
 * ## The links an author is handed
 *
 * A watch page (`youtube.com/watch?v={id}`, on `www.`, `m.` or `music.`), a
 * Short (`/shorts/{id}`), a live page (`/live/{id}`), an embed address on
 * either YouTube domain (`/embed/{id}`), the old `/v/{id}`, and the share link
 * (`youtu.be/{id}`). The share link's whole path is the id, a shape that
 * would misread a page on youtube.com, so it is read on `youtu.be` alone. A
 * channel, a playlist (`/embed/videoseries?list=…` included, whose path word
 * happens to be eleven letters long) or a search names no single film and is
 * refused. An id is eleven letters, digits, `-` or `_`. A start time in the
 * link is not carried: only the id survives.
 *
 * ## The query
 *
 * `autoplay` is stated both ways, as Wistia's is. `mute` and `loop` follow
 * the element's switches; YouTube loops a single film only as a playlist of
 * itself, hence `playlist={id}` beside `loop=1`. `playsinline=1` keeps the
 * film in the page on a phone, as the element's own player does.
 */
const YOUTUBE: VideoEmbedProviderDeclaration = {
  id: 'youtube',
  label: 'YouTube',
  domains: ['youtube.com', 'youtube-nocookie.com', 'youtu.be'],
  mediaIdPaths: [
    '^\\/embed\\/([^/]+)\\/?$',
    '^\\/shorts\\/([^/]+)\\/?$',
    '^\\/live\\/([^/]+)\\/?$',
    '^\\/v\\/([^/]+)\\/?$',
  ],
  mediaIdLinks: [
    { path: '^\\/watch\\/?$', param: 'v', domains: ['youtube.com'] },
    { path: '^\\/([^/]+)\\/?$', domains: ['youtu.be'] },
  ],
  mediaIdPattern: '^(?!videoseries$)[A-Za-z0-9_-]{11}$',
  playerOrigin: 'https://www.youtube-nocookie.com',
  playerPath: '/embed/{id}',
  playerQuery: [
    { param: 'autoplay', option: 'autoPlay', on: '1', off: '0' },
    { param: 'playsinline', value: '1' },
    { param: 'mute', option: 'muted', on: '1' },
    { param: 'loop', option: 'loop', on: '1' },
    { param: 'playlist', option: 'loop', on: '{id}' },
  ],
}

/**
 * Vimeo (AGL-4140).
 *
 * ## Do-not-track, always
 *
 * `dnt=1` is on every address, whatever the visitor's consent says. It is
 * Vimeo's embed option for keeping the player from tracking the viewing
 * session, cookies included: the same promise as the nocookie origin above,
 * and stricter than Wistia's `doNotTrack`, which consent turns off. The player
 * origin, `player.vimeo.com`, is the one the Video embed block already
 * builds, so the published page's `frame-src` admits it already.
 *
 * ## The links an author is handed
 *
 * A video page (`vimeo.com/{id}`), the same video in a channel, group,
 * showcase or album, the manage page in the author's account, and the
 * player's own address (`player.vimeo.com/video/{id}`). An id is digits. An
 * unlisted video's page carries a second, private segment after the id
 * (`vimeo.com/{id}/{hash}`); the player cannot play such a video from the id
 * alone, so that shape is refused rather than turned into a player that
 * says the video does not exist.
 *
 * ## The query
 *
 * `autoplay` stated both ways, `muted` and `loop` from the element's
 * switches.
 */
const VIMEO: VideoEmbedProviderDeclaration = {
  id: 'vimeo',
  label: 'Vimeo',
  domains: ['vimeo.com'],
  mediaIdPaths: [
    '^\\/([0-9]+)\\/?$',
    '^\\/video\\/([0-9]+)\\/?$',
    '^\\/channels\\/[^/]+\\/([0-9]+)\\/?$',
    '^\\/groups\\/[^/]+\\/videos\\/([0-9]+)\\/?$',
    '^\\/showcase\\/[^/]+\\/video\\/([0-9]+)\\/?$',
    '^\\/album\\/[^/]+\\/video\\/([0-9]+)\\/?$',
    '^\\/manage\\/videos\\/([0-9]+)\\/?$',
  ],
  mediaIdPattern: '^[0-9]{6,12}$',
  playerOrigin: 'https://player.vimeo.com',
  playerPath: '/video/{id}',
  playerQuery: [
    { param: 'autoplay', option: 'autoPlay', on: '1', off: '0' },
    { param: 'dnt', value: '1' },
    { param: 'muted', option: 'muted', on: '1' },
    { param: 'loop', option: 'loop', on: '1' },
  ],
}
