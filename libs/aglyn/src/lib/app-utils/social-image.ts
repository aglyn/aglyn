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
 * The social card image (AGL-1337).
 *
 * ## The gap this closes
 *
 * `buildMetadata` already read `screen.seo.image || host.seo.image`, and the
 * collection branch already read `entry.coverImage` — but nothing in the
 * console could WRITE either screen or host field, so on a site whose pages
 * are screens rather than collection entries every share fell back to
 * `twitter:card: summary`: the small, image-less card. Meanwhile 44 designed
 * 1200×630 assets sat in the DAM with nowhere to be bound.
 *
 * ## Why one function rather than a branch each
 *
 * There were already two half-answers in one file — the content branch took
 * the entry cover, the screen branch took the screen/host fields — and
 * neither did the two things a crawler actually requires:
 *
 * 1. **The URL must be absolute.** A picked asset is stored as
 *    `media:{scope}/{mediaId}` and resolves to the site-RELATIVE path
 *    `/api/media/cdn/{scope}/{mediaId}`. A browser has a page to resolve that
 *    against; a crawler fetching `og:image` out of band does not. This is the
 *    same problem `resolveEmailMediaSrc` solves for inboxes, and the tenant
 *    app declares no `metadataBase`, so Next resolves nothing for us either.
 *    Worse, before this the stored value was passed through UNTOUCHED, so a
 *    `media:` reference reached `og:image` as the literal string `media:…`.
 * 2. **`og:image:width`/`height` were emitted nowhere at all.** Both branches
 *    passed a bare string, and Next only emits the dimension tags for an
 *    object entry. Crawlers that pre-render a card without fetching the bytes
 *    need them to reserve the right box.
 *
 * So both branches call this, and the resolution order is a LIST rather than
 * a chain of `||` at each call site: whoever adds a third surface inherits
 * the absolute-URL and dimension handling instead of writing a third copy
 * that forgets one of them.
 *
 * ## Why the dimensions are stored beside the reference
 *
 * They are read off {@link AglynHostMedia.width}/`height` — auto-captured at
 * upload (AGL-173) — and persisted next to the reference by whichever picker
 * wrote it, rather than looked up at render. `generateMetadata` runs on the
 * ISR render path, which is under an active cold-start budget (AGL-1152); a
 * media-doc read per screen render buys a number that changes only when
 * someone REPLACES the asset with one of different proportions, and the
 * picker rewrites the pair whenever it is re-picked. The tradeoff is stated
 * so the next person can reverse it deliberately.
 *
 * The pair travels WITH its image and is never mixed across sources — taking
 * a screen's image and the host's dimensions would describe a card that does
 * not exist, which is worse than emitting no dimensions at all.
 *
 * ## `og:image:alt` (AGL-2417)
 *
 * `imageAlt` is stored and carried by exactly the same rule, and for a
 * stronger version of the same reason. Until this, NO tenant page emitted an
 * alt at all: the type had nowhere to hold one, so every shared card
 * announced itself to a screen reader as an undescribed image.
 *
 * The alt is captured at PICK time from the chosen DAM asset
 * (`inheritedMediaAlt`, AGL-1896) and is editable per surface, rather than
 * looked up at render — the cold-start argument above applies unchanged, and
 * a per-surface override is what lets "our logo" become "the Q3 report cover"
 * on the one page where that is what the card shows.
 *
 * Defaulting at pick time on ONE of the three storage sites would NOT have
 * been enough, and this is the objection worth recording: the resolver picks
 * whichever source wins for a given page, so an alt stored only on the host
 * default would be emitted beside a SCREEN's image — a description of a
 * picture the card does not show, which is worse than no description. It is
 * therefore stored beside the reference at all three sites and read off the
 * SAME source the URL came from, exactly as the dimensions are.
 */

import { hostPublicOrigin } from './host-naming'
import { MEDIA_ALT_MAX_LENGTH } from './media-metadata'
import { absoluteMediaSrc } from './media-ref'

/**
 * One candidate in the precedence list — the persisted shape of a social
 * image on a host, a screen, or a template.
 */
export interface SocialImageSource {
  /** A `media:` reference, a CDN path, or an author-supplied absolute URL. */
  image?: string | null
  /** Pixel dimensions copied from the media record at pick time. */
  imageWidth?: number | null
  imageHeight?: number | null
  /**
   * What the card SHOWS, for `og:image:alt` (AGL-2417). Defaulted from the
   * chosen asset's own alt at pick time and overridable per surface. Read off
   * the same source as `image`, never mixed across the precedence list.
   */
  imageAlt?: string | null
}

/**
 * What the head emits. `width`/`height` are present only as a valid pair, and
 * `alt` only when the winning source actually carries one.
 *
 * Next's OpenGraph/Twitter image DESCRIPTOR accepts exactly these keys, and
 * both tenant branches already spread this object into `images: [ … ]` — so
 * `og:image:alt` and `twitter:image:alt` start being emitted with no change
 * at either emit site.
 */
export interface ResolvedSocialImage {
  url: string
  width?: number
  height?: number
  alt?: string
}

/** The host fields the resolver needs: scope qualification and origin. */
export interface SocialImageHost {
  $id?: string | null
  cname?: string | null
  subdomain?: string | null
}

/**
 * A dimension pair is emitted only when BOTH sides are positive integers.
 * Half a pair tells a crawler nothing and invites it to infer the other.
 */
/**
 * The alt, trimmed, or nothing.
 *
 * Blank is never emitted. `og:image:alt=""` is a positive assertion that the
 * image conveys nothing — the decorative case — and a share card is by
 * definition not decorative, so an empty string here would be a worse claim
 * than the absent tag it replaced. It is also capped at the same length the
 * DAM saves through, so an alt that reaches a card is one the library would
 * also have stored.
 */
function alt(source: SocialImageSource) {
  const value = typeof source.imageAlt === 'string' ? source.imageAlt.trim() : ''
  return value ? { alt: value.slice(0, MEDIA_ALT_MAX_LENGTH) } : {}
}

function dimensions(source: SocialImageSource) {
  const width = Number(source.imageWidth)
  const height = Number(source.imageHeight)
  if (!Number.isFinite(width) || !Number.isFinite(height)) return {}
  if (width <= 0 || height <= 0) return {}
  return { width: Math.round(width), height: Math.round(height) }
}

/**
 * Resolves the social card image for a page.
 *
 * `sources` is the precedence list, most specific first — the tenant head
 * passes `[entryCover, screen.seo, host.seo]` for a collection page and
 * `[screen.seo, host.seo]` for a screen. The FIRST source carrying a
 * non-empty `image` wins outright, together with its own dimensions.
 *
 * An empty string is a cleared field, not a value: it is how both pickers
 * express "no image of my own" (the console writes it directly to Firestore
 * rather than through the attributes form stack, which maps `''` to
 * `undefined` and would make clearing impossible — AGL-1191). So clearing a
 * screen's image means the host default applies again. There is deliberately
 * no way for a screen to suppress the host default: the default exists so
 * that every page has a card, and a page that wants none is not a case
 * anyone has asked for. If one appears, add an explicit sentinel here — do
 * not overload `''`, which cannot survive the form stack.
 */
export function resolveSocialImage(options: {
  sources: Array<SocialImageSource | null | undefined>
  host?: SocialImageHost | null | undefined
  /**
   * The origin to absolutize a site-relative URL against, for a surface that
   * is not a tenant site and therefore has no host record to derive one from
   * (AGL-876: the console's marketplace listing card).
   *
   * Takes precedence over the host, so a caller that has both is stating the
   * origin it actually serves from rather than the one the host doc names.
   * With neither, a relative URL still resolves to `undefined` — the rule in
   * `absolutize` is unchanged, this only widens where the origin may come
   * from.
   */
  origin?: string | null
}): ResolvedSocialImage | undefined {
  const { sources, host, origin } = options
  const source = sources.find((candidate) => Boolean(candidate?.image))
  if (!source?.image) return undefined
  // A `media:` reference becomes the site-relative CDN path, host-qualified
  // so a restricted org asset resolves for the site actually rendering, and is
  // then absolutized because a crawler reads `og:image` out of band; any other
  // string passes through untouched (back-compat with the raw storage URLs the
  // content and favicon pickers have always written). Both halves live in
  // `media-ref.ts` (AGL-1407) so the manifest and the inbox share this rule
  // rather than each keeping a copy that can drift.
  const url = absoluteMediaSrc(source.image, {
    hostId: host?.$id,
    origin: origin || hostPublicOrigin(host),
  })
  if (!url) return undefined
  return { url, ...dimensions(source), ...alt(source) }
}
