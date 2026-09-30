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
 */
export function muiVideoEmbedProviders(): VideoEmbedProviderDeclaration[] {
  return [WISTIA]
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
