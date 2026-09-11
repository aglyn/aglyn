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
 * A placed film's length, shape and poster, read from the DAM asset as it is
 * NOW rather than as it was when it was picked (AGL-2807).
 *
 * ## Why the pick-time copy is not enough
 *
 * Picking a library film copies four facts onto the Video node
 * ({@link videoMediaProps}): its running time, its frame's pixel pair, and
 * whether the DAM generated a poster. The published page is rendered from
 * those props. The pair becomes the player's CSS `aspect-ratio`, the running
 * time becomes `VideoObject.duration`, and the poster flag decides whether a
 * lightbox `<img>` and a `thumbnailUrl` exist at all.
 *
 * A replace (AGL-2732) keeps the asset's id and URL and rewrites its `video`
 * and `poster` records. It cannot rewrite the nodes, which sit in every
 * screen, layout, component and published version that places the film. So a
 * page went on publishing the previous film's length and shape — and, when the
 * new film arrived without a probe, a poster URL that now 404s — for as long
 * as nobody re-picked it.
 *
 * ## The rule
 *
 * The tenant's composition reads each placed film's document
 * (`libs/tenant/runtime/src/lib/get-video-asset-facts.ts`) and lays what it
 * records over the node here:
 *
 * - **The asset answered.** Its facts win, including their ABSENCE. A film the
 *   replace left with no `video` record has no known shape, so a stored pair
 *   describing the previous film is dropped rather than published, and a
 *   poster flag the document no longer backs is dropped with it.
 * - **The asset could not be answered for** — a failed read, a missing or
 *   deleted document, a film the CDN would not serve under this page's URL.
 *   The node keeps what the pick stored, which is the render every page had
 *   before this and never a worse one.
 *
 * One stored value survives an answered read: a running time the AUTHOR typed
 * for a film the DAM has no running time for. The pick only ever writes the
 * duration together with the pixel pair — {@link videoMediaProps} is
 * all-or-nothing on the `video` record — and the pair is not an author
 * control. So a duration standing alone is an author's, and a duration
 * standing beside a pair is a copy of a film that may no longer be the one in
 * the bucket.
 *
 * Server-only, beside `video-object.ts`: the composition is the only caller,
 * and nothing here has a reason to reach a published page's bundle.
 */

import { videoMediaProps } from './media-metadata'
import { type MediaRef, parseMediaRef } from './media-ref'
import { VIDEO_COMPONENT_ID } from './video-object'

/**
 * What a readable film's media document records, as the overlay consumes it.
 *
 * Raw on purpose: {@link videoMediaProps} is the one place a `video` record is
 * bounded, and a second reading of the same three numbers here is how two
 * files come to disagree about what a partial record means.
 */
export interface VideoAssetFacts {
  /** The document's `video` record — `durationMs`, `width` and `height`. */
  video?: unknown
  /** The document's generated `poster` record, when it has one. */
  poster?: unknown
}

/** A node as the composed map holds it — flat, children by id. */
interface ComposedVideoNode {
  componentId?: string
  props?: Record<string, unknown>
  resolvedProps?: Record<string, unknown>
}

/**
 * The key a film's facts are filed under: the reference's own scope and id.
 *
 * Deliberately NOT the host-qualified scope a page renders. The document lives
 * under the scope's owner whichever site places it, and which site may be
 * shown it is the reader's question, answered once per page.
 */
export function videoAssetFactsKey(
  ref: Pick<MediaRef, 'scope' | 'mediaId'>,
): string {
  return `${ref.scope}/${ref.mediaId}`
}

/** The library film a node plays, or null for anything else. */
function placedFilm(
  node: ComposedVideoNode | null | undefined,
): MediaRef | null {
  if (!node || node.componentId !== VIDEO_COMPONENT_ID) return null
  // The precedence every other reader of the composed map uses: a node inside
  // a repeated collection carries its bound values in the resolved copy.
  const props = node.resolvedProps ?? node.props
  return parseMediaRef(props?.['src'])
}

/**
 * Every distinct library film the Video nodes in a map play, in map order.
 *
 * `[]` for a page that places none — which is most pages — so a caller that
 * gates its read on the length spends nothing on them. A pinned and an
 * unpinned reference to one film are one entry: a pin names bytes, not a
 * different asset.
 */
export function videoAssetRefs(
  nodes: Record<string, unknown> | null | undefined,
): MediaRef[] {
  const refs: MediaRef[] = []
  if (!nodes) return refs
  const seen = new Set<string>()
  for (const id in nodes) {
    const ref = placedFilm(nodes[id] as ComposedVideoNode)
    if (!ref) continue
    const key = videoAssetFactsKey(ref)
    if (seen.has(key)) continue
    seen.add(key)
    refs.push(ref)
  }
  return refs
}

const usable = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

/** One props object with a film's facts laid over it. See the module note. */
function withFacts(
  props: Record<string, unknown>,
  facts: VideoAssetFacts,
): Record<string, unknown> {
  const live = videoMediaProps({
    componentId: VIDEO_COMPONENT_ID,
    propName: 'src',
    assetVideo: facts.video,
    assetPoster: facts.poster,
  })
  const {
    durationSeconds,
    intrinsicWidth,
    intrinsicHeight,
    posterFromSource: _storedPosterFlag,
    ...next
  } = props
  // The pick writes a duration only beside the pixel pair, so a pair is what
  // marks the stored duration as a copy rather than an author's own.
  const typedByAuthor = !(usable(intrinsicWidth) && usable(intrinsicHeight))
  if (live.durationSeconds !== undefined) {
    next['durationSeconds'] = live.durationSeconds
  } else if (typedByAuthor && durationSeconds !== undefined) {
    next['durationSeconds'] = durationSeconds
  }
  if (live.intrinsicWidth !== undefined && live.intrinsicHeight !== undefined) {
    next['intrinsicWidth'] = live.intrinsicWidth
    next['intrinsicHeight'] = live.intrinsicHeight
  }
  if (live.posterFromSource) next['posterFromSource'] = true
  return next
}

/**
 * The composed map with each placed film's facts laid over its node.
 *
 * `facts` is keyed by {@link videoAssetFactsKey}. A film with no entry — the
 * reader could not answer for it — keeps its stored props. The SAME map comes
 * back when nothing applies, so a page with no library film pays for one walk
 * and no copy, and the input is never mutated either way.
 */
export function applyVideoAssetFacts<T extends Record<string, unknown>>(
  nodes: T,
  facts: ReadonlyMap<string, VideoAssetFacts>,
): T {
  let applied: Record<string, unknown> | undefined
  for (const id in nodes) {
    const node = nodes[id] as ComposedVideoNode
    const ref = placedFilm(node)
    const found = ref ? facts.get(videoAssetFactsKey(ref)) : undefined
    if (!found) continue
    if (!applied) applied = { ...nodes }
    applied[id] = {
      ...node,
      ...(node.props ? { props: withFacts(node.props, found) } : {}),
      ...(node.resolvedProps
        ? { resolvedProps: withFacts(node.resolvedProps, found) }
        : {}),
    }
  }
  return applied ? (applied as T) : nodes
}
