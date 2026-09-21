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
 * A Wistia video, as the Video element plays it (AGL-2826).
 *
 * ## Only the media id survives
 *
 * An author pastes whatever link Wistia showed them. That string never reaches
 * a frame: every builder below reads the media's hashed id out of it and
 * rebuilds the address, so the only frame this module can produce is on
 * {@link WISTIA_PLAYER_ORIGIN}. That closed set is what lets the tenant's
 * `frame-src` name the origin for every site, and it is the rule
 * `parseVideoEmbedSrc` already holds YouTube and Vimeo to.
 *
 * ## The iframe embed, not the player script
 *
 * Wistia offers two embeds. The script embed runs Wistia's JavaScript in the
 * page itself, so every site would need `connect-src`, `img-src` and
 * `media-src` grants for Wistia's hosts, and the player's storage and beacons
 * would run as the site. The iframe embed runs all of that inside a document on
 * Wistia's origin, under Wistia's own policy: the page needs one `frame-src`
 * entry, and whatever the player stores is keyed to Wistia inside the site's
 * partition rather than written as the site.
 *
 * Measured on 2026-09-10: `fast.wistia.net/embed/iframe/{id}` answers 200 with
 * no redirect, so no second origin is involved in loading the frame.
 */

/** The only origin a Wistia player frame is ever loaded from. */
export const WISTIA_PLAYER_ORIGIN = 'https://fast.wistia.net'

/** A hashed id: ten lowercase letters and digits, e.g. `e4a27b971d`. */
const HASHED_ID = /^[a-z0-9]{10}$/

/**
 * The paths a Wistia link carries a media id in. Wistia's oEmbed endpoint
 * matches on the path rather than the host, and so does this; the host is
 * checked separately by {@link isWistiaHostname}.
 */
const MEDIA_ID_PATHS: readonly RegExp[] = [
  // A media page: `https://acme.wistia.com/medias/{id}`, and its `/manage`.
  /^\/medias\/([^/]+)(?:\/manage)?\/?$/,
  // The short form of the same page.
  /^\/m\/([^/]+)\/?$/,
  // An iframe embed's own address.
  /^\/embed\/iframe\/([^/]+)\/?$/,
  // A script embed's media address, with or without its `.jsonp` suffix.
  /^\/embed\/medias\/([^/.]+)(?:\.jsonp?)?\/?$/,
]

/**
 * Whether a hostname is Wistia's. Exact or dot-anchored matches only, so
 * `wistia.com.example.net` and `notwistia.com` are refused.
 */
function isWistiaHostname(hostname: string): boolean {
  return ['wistia.com', 'wistia.net', 'wi.st'].some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
  )
}

/**
 * The hashed id a Wistia link names, or `undefined` for anything else.
 *
 * A share link (`/s/{slug}`) names no id and is refused rather than guessed
 * at, as is a value that is not an http(s) URL.
 */
export function wistiaMediaId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return undefined
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined
  if (!isWistiaHostname(url.hostname)) return undefined
  for (const pattern of MEDIA_ID_PATHS) {
    const id = pattern.exec(url.pathname)?.[1]
    if (id && HASHED_ID.test(id)) return id
  }
  return undefined
}

/**
 * The player page for a Wistia link, with no per-visit options: what
 * `VideoObject.embedUrl` names.
 */
export function wistiaEmbedUrl(value: unknown): string | undefined {
  const id = wistiaMediaId(value)
  return id ? `${WISTIA_PLAYER_ORIGIN}/embed/iframe/${id}` : undefined
}

export interface WistiaPlayerOptions {
  /**
   * Start playing as soon as the player is ready. On unless this is exactly
   * `false`; see {@link wistiaPlayerSrc} for which frame turns it off.
   */
  autoPlay?: boolean
  /**
   * Ask Wistia not to record the viewing session (its `doNotTrack` embed
   * option). The element sets it for every visitor whose analytics consent is
   * not on record.
   */
  doNotTrack?: boolean
  /** Start without sound. */
  muted?: boolean
  /** Restart at the end (`endVideoBehavior=loop`). */
  loop?: boolean
}

/**
 * The address of a Wistia player frame.
 *
 * `autoPlay` is on by default, because the usual frame is the one a visitor's
 * press loads: it exists only because somebody pressed play, and a second play
 * button inside the player would ask them twice.
 *
 * The frame a page loads before anyone has pressed anything ("Load the player
 * with the page", AGL-2962) passes `autoPlay: false`. The address then says
 * `autoPlay=false` rather than leaving the option out: an option in the embed
 * overrides the media's own settings in the Wistia account, and those may be
 * set to autoplay.
 *
 * ## The corners belong to the page (AGL-3209)
 *
 * `roundedPlayer=false` is stated on every address, and is not an option a
 * caller may turn back on. Wistia's rounded chrome rounds and clips INSIDE the
 * frame, where the document's own canvas is white: on a dark page the corner
 * arcs and the clip's antialiased edge composite as a white ring around the
 * film rather than as the page behind them.
 *
 * Measured on 2026-09-21 against the live videos page, whose background is
 * `rgb(42 52 64)` and whose film is `rgb(22 30 52)`: the frame's first column
 * read `rgb(137 141 152)` and its top-left corner `rgb(195 198 201)` —
 * lighter than either, so painted rather than blended. With the option off
 * the same pixels are the film.
 *
 * The shape is the placement's to decide in any case: `VideoPlayerFrame` takes
 * a `radius` from the element's own control and puts it on the frame, which a
 * second rounding inside the frame can only fight.
 */
export function wistiaPlayerSrc(
  value: unknown,
  options: WistiaPlayerOptions = {},
): string | undefined {
  const embedUrl = wistiaEmbedUrl(value)
  if (!embedUrl) return undefined
  const params = new URLSearchParams({
    autoPlay: options.autoPlay === false ? 'false' : 'true',
    roundedPlayer: 'false',
  })
  if (options.doNotTrack) params.set('doNotTrack', 'true')
  if (options.muted) params.set('muted', 'true')
  if (options.loop) params.set('endVideoBehavior', 'loop')
  return `${embedUrl}?${params.toString()}`
}
