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
 * ## Where the dimensions come from (AGL-2850)
 *
 * Each picker copies {@link AglynHostMedia.width}/`height` — auto-captured at
 * upload (AGL-173) — beside the reference it writes, and that copy is the
 * FALLBACK. A replace (AGL-2732) keeps an asset's id and URL and rewrites its
 * pair. It cannot reach the copies stored beside the references to it, so a
 * card replaced with a picture of another shape went on declaring the old
 * shape to the crawlers that lay a card out before fetching its image, while
 * its URL served the new bytes (AGL-2798).
 *
 * So the page's composition reads the document of each asset a card may name
 * (a screen's and the host's `seo.image`, an entry's cover, an author's
 * pictures) and hands their pairs here as `assetFacts`
 * (`libs/tenant/runtime/src/lib/social-image-facts.ts`). The winning source
 * takes its asset's pair when the document records a usable one, and its
 * stored copy when it does not: an SVG the upload could not measure, a file
 * older than AGL-173, an asset the CDN would not serve to this site, a failed
 * read. Each of those renders the card every page rendered before.
 *
 * This reverses the tradeoff this note used to record. The pair was stored so
 * that `generateMetadata`, on the ISR render path under a cold-start budget
 * (AGL-1152), never read a media document for a number that changes only when
 * someone replaces the asset. The composition already reads the documents of
 * the images and films a page places, in one projected batch, so the card's
 * documents join that read instead of adding one. The page that composes
 * nothing, a password-protected screen, reads its card's documents on its own
 * in one projected read.
 *
 * The pair travels WITH its image and is never mixed across sources — taking
 * a screen's image and the host's dimensions would describe a card that does
 * not exist, which is worse than emitting no dimensions at all. A current pair
 * is looked up by the winning source's own reference, so it cannot cross
 * sources either.
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
  /**
   * Pixel dimensions copied from the media record at pick time: the fallback
   * when `assetFacts` records no usable pair for `image`.
   */
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
 * What each library asset a card may name records NOW (AGL-2850): the pixel
 * pair on its DAM document, keyed by the reference exactly as a source stores
 * it (`media:{scope}/{mediaId}`, pinned or not).
 *
 * Built on the server from the batch the page's composition reads. A
 * reference with no entry is one that read did not answer for, and its card
 * keeps the pair stored beside it.
 */
export type SocialImageAssetFacts = Readonly<
  Record<string, { width?: number | null; height?: number | null }>
>

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

/**
 * A dimension pair is emitted only when BOTH sides are positive integers.
 * Half a pair tells a crawler nothing and invites it to infer the other.
 */
function dimensions(source: SocialImageSource): {
  width?: number
  height?: number
} {
  const width = Number(source.imageWidth)
  const height = Number(source.imageHeight)
  if (!Number.isFinite(width) || !Number.isFinite(height)) return {}
  if (width <= 0 || height <= 0) return {}
  return { width: Math.round(width), height: Math.round(height) }
}

/**
 * The pair a card emits: its asset's current one when `assetFacts` records a
 * usable pair for the winning source's OWN reference, and otherwise the copy
 * stored beside that reference. Both pass through {@link dimensions}, so the
 * two cannot disagree about what a usable pair is.
 */
function currentDimensions(
  source: SocialImageSource,
  assetFacts: SocialImageAssetFacts | null | undefined,
): { width?: number; height?: number } {
  const image = source.image ?? ''
  const recorded =
    assetFacts && Object.prototype.hasOwnProperty.call(assetFacts, image)
      ? assetFacts[image]
      : undefined
  const current: { width?: number; height?: number } = recorded
    ? dimensions({ imageWidth: recorded.width, imageHeight: recorded.height })
    : {}
  return current.width === undefined ? dimensions(source) : current
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
  /**
   * What the named assets' DAM documents record now (AGL-2850). The winning
   * source's pair comes from here when its own reference has a usable one,
   * and from the copy stored beside the reference otherwise. A surface that
   * read no documents omits it and emits the stored copy, as every surface
   * did before.
   */
  assetFacts?: SocialImageAssetFacts | null
}): ResolvedSocialImage | undefined {
  const { sources, host, origin, assetFacts } = options
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
  return { url, ...currentDimensions(source, assetFacts), ...alt(source) }
}
