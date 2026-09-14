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
 * finds Video nodes by walking the values, and then keeps only the ones the
 * page draws — see {@link pageVideoObjects}.
 *
 * ## Why an incomplete block is not emitted
 *
 * Google requires `name`, `thumbnailUrl` and `uploadDate` for a video result. A
 * `VideoObject` missing one of them is not a partial win — it is an invalid
 * rich result that a search console reports as an error against the page. So
 * the block is withheld until all three are there, the way
 * `breadcrumbListJsonLd` declines a single-crumb list. Everything else
 * (`description`, `contentUrl`, `embedUrl`, `duration`) is added when known and
 * omitted when not, because none of those changes whether the page is
 * eligible. `description` is one Google recommends rather than requires, so a
 * blank one costs the block that field and nothing more.
 */

import { NODE_ROOT_ID } from '../canvas-manager/canvas-manager'
import type { AglynNodeSchema, NodeId } from '../foundation'
import { collectDescendantIds } from './compose-reusable-components'
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
 * The UTC hour a bare calendar day is published at. An author names a day,
 * not a moment, and noon UTC is still that same day in every zone from UTC-12
 * through UTC+11. Midnight UTC is the previous evening in every zone behind
 * UTC, so a video result dated from it reads a day early across the Americas.
 */
const CALENDAR_DAY_UTC_HOUR = 12

/** A calendar day: the shape the Publication date field asks an author for. */
const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * An ISO 8601 date-time that names its zone, as `Z` or an offset — the shape
 * a bound timestamp or a video host's own metadata arrives in.
 */
const ZONED_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})T(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/

/**
 * The instant at `hour` UTC on the day a match's year, month and day groups
 * name, or `undefined` when that day does not exist. `Date.UTC` rolls
 * 2026-02-30 over to March 2 rather than refusing it, so a real day is one
 * whose parts survive the round trip.
 */
const utcDay = (match: RegExpExecArray, hour = 0): number | undefined => {
  const year = Number(match[1])
  const month = Number(match[2]) - 1
  const day = Number(match[3])
  const time = Date.UTC(year, month, day, hour)
  const date = new Date(time)
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month &&
    date.getUTCDate() === day
    ? time
    : undefined
}

/**
 * `uploadDate` as Google reads it: an ISO 8601 date AND time, with its zone
 * (AGL-2948).
 *
 * Google types the property as a DateTime. A bare `YYYY-MM-DD` is reported
 * against the page twice, as an invalid datetime and as one missing its
 * timezone, and a time with no zone is read in Googlebot's. Converting where
 * the block is built covers every writer at once: the field, a bound
 * property, an agent, and every document already published with a bare day.
 *
 * - A calendar day becomes that day at {@link CALENDAR_DAY_UTC_HOUR}:00 UTC.
 * - A date-time that names its zone keeps its instant.
 * - Both are spelled by `toISOString()`, as `Article.datePublished` is.
 * - Anything else — a time with no zone, a day that does not exist, free
 *   text — is published exactly as typed. Which zone an author meant is a
 *   guess, and a confidently wrong date is harder to notice than a warning.
 */
const uploadDateTime = (value: string | undefined): string | undefined => {
  if (!value) return undefined
  const day = CALENDAR_DAY.exec(value)
  if (day) {
    const noon = utcDay(day, CALENDAR_DAY_UTC_HOUR)
    return noon === undefined ? value : new Date(noon).toISOString()
  }
  const zoned = ZONED_DATE_TIME.exec(value)
  if (!zoned || utcDay(zoned) === undefined) return value
  // `toISOString` throws on an invalid date, and a page render is no place
  // to find out which fraction lengths this runtime's parser accepts.
  const instant = Date.parse(value)
  return Number.isNaN(instant) ? value : new Date(instant).toISOString()
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
  const uploadDate = uploadDateTime(text(props['uploadDate']))
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
  // All three, or nothing. See the module note: a block missing one of these
  // is an error a search console reports, not a smaller win.
  if (!name || !uploadDate || !thumbnailUrl) return undefined
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
    ...(description ? { description } : {}),
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
 *
 * ## Only the videos the page draws (AGL-2957)
 *
 * Being in the map is not being on the page. The renderer starts at
 * {@link NODE_ROOT_ID} and follows child id lists, and nothing else, so a node
 * no list names is carried in the payload and never drawn. Composition leaves
 * such nodes on purpose: `expandCollectionEntries` and `expandRepeatables`
 * point a block's list at its clones and keep the template in the map. On a
 * list page that template publishes a block named `{{entry.title}}`; on an
 * entry page, where entry tokens are substituted across the whole map, it
 * publishes a copy of the page's own film.
 *
 * So when the map has a root, a Video counts only if a child list reaches it
 * from there. Every stage that moves a subtree does so through those lists —
 * a layout slot adopts the screen's top-level ids, a reusable component or a
 * placed form hands its definition's list to the placement, a tab panel lists
 * its content — so each of those is followed by the same walk, and a panel
 * the route withheld has already lost its list. `parentId` is never followed:
 * a template keeps its parent's id after its parent stops listing it.
 *
 * A map with no root is a fragment with no entry point to measure reach from,
 * and keeps the whole-map walk.
 *
 * One rule of the renderer's is not in the map: a self-closing element draws
 * no children, and which components are self-closing is registry knowledge.
 * The editor refuses a child under one (`nodeAcceptsChildren`), so a Video
 * there is a hand-edited document rather than an authored page.
 *
 * The reach is computed only for a map that holds a Video at all, so a page
 * without one costs a single pass over its values and no walk.
 */
export function pageVideoObjects(
  nodes: Record<string, unknown> | null | undefined,
  context?: VideoObjectContext,
): Record<string, unknown>[] {
  if (!nodes) return []
  const videoIds: string[] = []
  for (const id in nodes) {
    const node = nodes[id] as ComposedVideoNode | null | undefined
    if (node?.componentId === VIDEO_COMPONENT_ID) videoIds.push(id)
  }
  if (!videoIds.length) return []
  const drawn = nodes[NODE_ROOT_ID]
    ? collectDescendantIds(
        nodes as Record<NodeId, AglynNodeSchema>,
        NODE_ROOT_ID,
      )
    : undefined
  const found: Record<string, unknown>[] = []
  for (const id of videoIds) {
    if (drawn && id !== NODE_ROOT_ID && !drawn.has(id)) continue
    const block = videoObjectJsonLd(nodes[id] as ComposedVideoNode, context)
    if (block) found.push(block)
  }
  return found
}
