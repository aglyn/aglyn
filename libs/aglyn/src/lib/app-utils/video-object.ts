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
 * `VideoObject` structured data for a published page (AGL-2747).
 *
 * ## Why the page's NODES are the input
 *
 * Every other block `buildJsonLd` emits is derived from a screen, a collection
 * entry or the host document — metadata about the page. A video is not
 * metadata about anything: it is a thing an author placed *in* the page, and
 * the only record that it is there is the node.
 *
 * The route already walks that map twice for exactly this kind of question
 * (`pageAnimationAssets`, `deferLazyPanelNodes`) and commerce walks it in a
 * site-page enricher to seed the `Product` block. So this is the same
 * mechanism, not a second one.
 *
 * ⚠️ The composed map is **denormalized and flat**: `Record<string, node>`
 * whose children are id STRINGS under `nodes`, never a nested `children`
 * array. The commerce enricher's first version recursed `children`, matched
 * nothing on any page, and shipped green because its fixture was a tree. This
 * walks the values, which needs no recursion at all.
 *
 * ## Why an incomplete block is not emitted
 *
 * Google requires `name`, `description`, `thumbnailUrl` and `uploadDate` for a
 * video result. A `VideoObject` missing one of them is not a partial win — it
 * is an invalid rich result that a search console reports as an error against
 * the page. So the block is withheld until all four are there, the way
 * `breadcrumbListJsonLd` declines a single-crumb list. Everything else
 * (`contentUrl`, `duration`) is added when known and omitted when not, because
 * none of those changes whether the page is eligible.
 */

import { videoDurationIso8601 } from './media-metadata'
import {
  MEDIA_CDN_POSTER_WIDTH,
  absoluteMediaSrc,
  videoPosterSrc,
} from './media-ref'
import { wistiaEmbedUrl } from './wistia-embed'

/** Component id of the Video element. Persisted in documents; never renamed. */
export const VIDEO_COMPONENT_ID = 'video'

/** Milliseconds in a second — the unit `videoDurationIso8601` takes. */
const MS_PER_SECOND = 1000

/** A node as the composed map holds it — flat, children by id. */
interface ComposedVideoNode {
  componentId?: string
  props?: Record<string, unknown>
  resolvedProps?: Record<string, unknown>
}

export interface VideoObjectContext {
  /** The site's public origin — a relative URL is not a `contentUrl`. */
  origin?: string | null
  /** The site being rendered, which qualifies an org-scoped media scope. */
  hostId?: string
}

/** A trimmed string, or nothing. Blank is never a value here. */
const text = (value: unknown): string | undefined => {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed || undefined
}

/**
 * The `VideoObject` for one Video node, or `undefined` when the author has not
 * given it enough to be worth publishing.
 *
 * `props` precedence is `resolvedProps ?? props` — the same rule every other
 * consumer of the composed map uses, because a node inside a repeated
 * collection carries its bound values only in the resolved copy.
 *
 * URLs go through `absoluteMediaSrc` and `mediaVariantSrc`, never through the
 * stored value: a `media:` reference published into structured data is a
 * string no crawler can fetch, which is the AGL-1343 lesson `article-json-ld`
 * pins for cover images.
 */
export function videoObjectJsonLd(
  node: ComposedVideoNode | null | undefined,
  context?: VideoObjectContext,
): Record<string, unknown> | undefined {
  if (!node || node.componentId !== VIDEO_COMPONENT_ID) return undefined
  const props = node.resolvedProps ?? node.props ?? {}
  const origin = context?.origin
  const hostId = context?.hostId
  const name = text(props['title'])
  const description = text(props['description'])
  const uploadDate = text(props['uploadDate'])
  // The SAME rule the element renders with, so the thumbnail a crawler
  // fetches is the poster a visitor sees — including the refusal to derive a
  // generated poster's url unless the node records that one exists, which is
  // what keeps a 404 out of the rich result.
  const thumbnailUrl = absoluteMediaSrc(
    videoPosterSrc({
      hostId,
      poster: props['poster'],
      src: props['src'],
      generated: props['posterFromSource'],
      width: MEDIA_CDN_POSTER_WIDTH,
    }),
    { hostId, origin },
  )
  // All four, or nothing. See the module note: a block missing one of these is
  // an error a search console reports, not a smaller win.
  if (!name || !description || !uploadDate || !thumbnailUrl) return undefined
  // A Wistia link names a player, not a file (AGL-2826), so it is published
  // as the player page and never as `contentUrl`: the link an author pasted
  // is Wistia's media page, whose bytes are HTML.
  const embedUrl = wistiaEmbedUrl(props['src'])
  const contentUrl = embedUrl
    ? undefined
    : absoluteMediaSrc(
        typeof props['src'] === 'string' ? props['src'] : undefined,
        { hostId, origin },
      )
  // Through the DAM's own formatter, in ITS unit. The node stores seconds
  // because that is what an author types; `videoDurationIso8601` takes
  // milliseconds and rounds a sub-second clip UP to `PT1S` rather than to a
  // `PT0S` that reads as "no duration" — which is why this converts rather
  // than keeping the second implementation it used to have.
  const seconds = Number(props['durationSeconds'])
  const duration =
    Number.isFinite(seconds) && seconds > 0
      ? videoDurationIso8601(seconds * MS_PER_SECOND)
      : undefined
  return {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name,
    description,
    thumbnailUrl,
    uploadDate,
    // Exactly one of the two. `contentUrl` is the file, for a film served from
    // this site's media CDN or hotlinked; `embedUrl` is a PLAYER page, which
    // this element renders only for a Wistia video.
    ...(contentUrl ? { contentUrl } : {}),
    ...(embedUrl ? { embedUrl } : {}),
    ...(duration ? { duration } : {}),
  }
}

/**
 * Every publishable `VideoObject` on a page, in the composed map's own order.
 *
 * Returns `[]` — the common case — for a page with no video, a page whose
 * videos have no SEO fields filled in, and a page with no nodes at all. The
 * route then emits no extra script, which is the same shape
 * `pageAnimationAssets` uses for the same reason.
 *
 * ⚠️ Hand this the map the page actually SHIPS, not the one the loader read.
 * A video inside a withheld lazy tab panel is not in the HTML, and a
 * `VideoObject` describing a player that is not on the page is precisely the
 * mismatch a video rich result is checked for.
 */
export function pageVideoObjects(
  nodes: Record<string, unknown> | null | undefined,
  context?: VideoObjectContext,
): Record<string, unknown>[] {
  if (!nodes) return []
  const found: Record<string, unknown>[] = []
  for (const id in nodes) {
    const block = videoObjectJsonLd(nodes[id] as ComposedVideoNode, context)
    if (block) found.push(block)
  }
  return found
}
