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
 * What a placed library asset is NOW, read from its DAM document when the
 * page is composed rather than copied onto the node when it was picked: a
 * film's length, shape and poster (AGL-2807), and an image's pixel pair
 * (AGL-2833).
 *
 * ## Why the pick-time copy is not enough
 *
 * Picking a library asset copies facts onto the node. An image gets its pixel
 * pair ({@link intrinsicMediaSize}), which `image.tsx` renders as the
 * `<img>`'s `width`/`height` attributes so the browser can reserve the box
 * before the bytes arrive. A film gets its running time, its frame's pair and
 * a poster flag ({@link videoMediaProps}): the pair becomes the player's CSS
 * `aspect-ratio`, the running time becomes `VideoObject.duration`, and the
 * flag decides whether a lightbox `<img>` and a `thumbnailUrl` exist at all.
 *
 * A replace (AGL-2732) keeps the asset's id and URL and rewrites its document:
 * an image's `width`/`height`, a film's `video` and `poster` records. It
 * cannot rewrite the nodes, which sit in every screen, layout, component and
 * published version that places the asset. So after a replace with a
 * different shape, every page placing the image reserved the previous
 * picture's box and shifted when the new one decoded, and every page placing
 * the film kept the previous film's length and shape, until someone re-picked
 * it.
 *
 * ## The rule
 *
 * Two surfaces read each placed asset's document and lay what it records over
 * the node here: the tenant's composition, for the page a visitor gets
 * (`libs/tenant/runtime/src/lib/get-media-asset-facts.ts`), and the console,
 * for the besigner canvas an author edits and the Preview that checks it
 * (AGL-2838, AGL-2849). Both decide what a read answers through
 * {@link mediaAssetFactsFromDocument}, so the editor cannot disagree with the
 * page about which assets answer. When the asset cannot be answered for (a
 * failed or pending read, a missing or deleted document, an asset the CDN
 * would not serve under this page's URL, one past the composition's cap), the
 * node keeps what the pick stored. That is the render every page had before
 * this, never a worse one. When the asset answers:
 *
 * - **A film's facts win, including their ABSENCE.** A film the replace left
 *   with no `video` record has no known shape, so a stored pair describing
 *   the previous film is dropped rather than published, and a poster flag the
 *   document no longer backs is dropped with it. One stored value survives: a
 *   running time the AUTHOR typed for a film the DAM has no running time for.
 *   The pick only ever writes the duration together with the pixel pair
 *   ({@link videoMediaProps} is all-or-nothing on the `video` record), and the
 *   pair is not an author control. So a duration standing alone is an
 *   author's, and a duration standing beside a pair is a copy of a film that
 *   may no longer be the one in the bucket.
 * - **An image's pair wins when the document records one.** When it records
 *   none (an SVG, which the upload cannot measure, or a file older than
 *   AGL-173), the stored pair stays, whether an author typed it through the
 *   API or it is a copy of the file the asset held before. The asymmetry with
 *   a film is in the render, not the data. A film's pair is the player's
 *   permanent box, but an image's is only a reservation
 *   (`aspect-ratio: auto w / h`), which the decoded picture's own ratio
 *   replaces. Dropping the pair guarantees a shift of the image's full height
 *   on every view. A stale pair shifts by the difference between two heights,
 *   and a pair typed for a file the DAM cannot measure shifts by nothing.
 *
 * Nothing an author sets for the placement is touched: an image's CSS
 * `width` and `height`, its fit and radius, and a film's own poster describe
 * the placement rather than the file.
 *
 * Imported by path and never through a barrel: every `@aglyn/aglyn` barrel
 * ships to published pages, and nothing here has a reason to reach one, so
 * the composition and the console both import this module by path.
 */

import { CANVAS_ROOT_ELEMENT_ID } from '../foundation/constants/canvas'
import { mediaCdnScopeRefusal, parseMediaCdnScope } from './media-cdn-scope'
import { intrinsicMediaSize, videoMediaProps } from './media-metadata'
import { hostQualifiedScope, type MediaRef, parseMediaRef } from './media-ref'
import { VIDEO_COMPONENT_ID } from './video-object'

/** The Image element's persisted component id (`image.tsx`), never renamed. */
export const IMAGE_COMPONENT_ID = 'image'

/**
 * The prop each element that holds a markdown-lite DOCUMENT keeps it in, and
 * therefore every element whose body can name a library image (AGL-3149).
 *
 * The same two elements and the same two prop names `resolveMarkdownSource`
 * walks for a table of contents (AGL-1162), which is the other reader of a
 * body's contents. They differ: the Markdown element calls it `content` and a
 * collection entry's body calls it `markdown`.
 *
 * Both ids are spelled out rather than imported. `markdown` belongs to a
 * plugin, which core may never import; `collectionEntryBody` is exported by
 * `collection-entries.ts`, but that module is 1,860 lines and drags
 * `content-authors.ts` behind it, and this one is deliberately outside the
 * barrel that ships to published pages. A persisted component id is a string
 * that cannot change — renaming one orphans every document that stores it —
 * so the copy cannot drift in the way an imported value would protect against.
 */
const MARKDOWN_BODY_PROPS: Readonly<Record<string, string>> = {
  markdown: 'content',
  collectionEntryBody: 'markdown',
}

/** The root of a composed map, where a walk in document order starts. */
const ROOT_NODE_ID: string = CANVAS_ROOT_ELEMENT_ID

/**
 * What a readable asset's media document records, as the overlay consumes it.
 *
 * Raw on purpose: {@link intrinsicMediaSize} and {@link videoMediaProps} are
 * where a pair and a `video` record are bounded, and a second reading of the
 * same numbers here is how two files come to disagree about what a partial
 * record means.
 */
export interface MediaAssetFacts {
  /** The document's `width`: an image's, read from its bytes at upload. */
  width?: unknown
  /** The document's `height`, the other half of {@link width}. */
  height?: unknown
  /** The document's `video` record: `durationMs`, `width` and `height`. */
  video?: unknown
  /** The document's generated `poster` record, when it has one. */
  poster?: unknown
}

/**
 * Every field an asset's facts are decided from, and the projection a reader
 * asks Firestore for: ONE list, whichever surface reads. `width` and `height`
 * (an image's) and `video` and `poster` (a film's) are the facts. The other
 * three are the gates `serveMediaCdn` applies before it will serve an asset at
 * all, so no surface shows the shape of a file its page's URL refuses.
 */
export const MEDIA_ASSET_FACT_FIELDS = [
  'width',
  'height',
  'video',
  'poster',
  'deletedAt',
  'private',
  'visibleTo',
] as const

/** An asset's media document, as far as {@link MEDIA_ASSET_FACT_FIELDS} reach. */
export type MediaAssetDocument = Partial<
  Record<(typeof MEDIA_ASSET_FACT_FIELDS)[number], unknown>
>

/** The elements whose placements follow their file. */
export type MediaAssetElement =
  | typeof IMAGE_COMPONENT_ID
  | typeof VIDEO_COMPONENT_ID

export interface MediaAssetFactsOptions {
  /**
   * One element's placements only, by persisted component id. Absent means
   * both, which is what the composition asks for.
   */
  only?: MediaAssetElement
}

/** A node as the composed map holds it: flat, children by id. */
interface ComposedMediaNode {
  componentId?: string
  nodes?: unknown
  props?: Record<string, unknown>
  resolvedProps?: Record<string, unknown>
}

const owns = (map: object, key: string) =>
  Object.prototype.hasOwnProperty.call(map, key)

/**
 * The key an asset's facts are filed under: the reference's own scope and id.
 *
 * Deliberately NOT the host-qualified scope a page renders. The document lives
 * under the scope's owner whichever site places it, and which site may be
 * shown it is the reader's question, answered once per page.
 */
export function mediaAssetFactsKey(
  ref: Pick<MediaRef, 'scope' | 'mediaId'>,
): string {
  return `${ref.scope}/${ref.mediaId}`
}

/**
 * Where an asset's media document lives: under the scope's OWNER, `orgs/` for
 * the org library and `hosts/` for a site's own, whichever site places it.
 * `null` for a scope the CDN would not parse, which no read can answer for.
 */
export function mediaAssetDocumentPath(
  ref: Pick<MediaRef, 'scope' | 'mediaId'>,
): string | null {
  const scope = parseMediaCdnScope(ref.scope)
  if (!scope) return null
  return `${scope.isOrg ? 'orgs' : 'hosts'}/${scope.scopeId}/media/${ref.mediaId}`
}

/**
 * The facts one read of an asset's document yields for a placement rendered
 * on `hostId`'s pages, or `undefined` when the placement keeps its stored
 * props.
 *
 * An answer exists only for a document that was read, is live, is not
 * private, and is visible to that site under the host-qualified scope the page
 * renders: the verdict the CDN reaches when the browser asks for the bytes.
 * The URL a page renders names the site doing the rendering
 * (`resolveMediaSrc`), so visibility is asked of THAT scope, not of the scope
 * the reference was stored with.
 */
export function mediaAssetFactsFromDocument(
  document: MediaAssetDocument | null | undefined,
  ref: Pick<MediaRef, 'scope'>,
  hostId: string,
): MediaAssetFacts | undefined {
  if (!document) return undefined
  if (document.deletedAt || document.private === true) return undefined
  const served = parseMediaCdnScope(hostQualifiedScope(ref.scope, hostId))
  if (!served || mediaCdnScopeRefusal(served, document.visibleTo)) {
    return undefined
  }
  return {
    width: document.width,
    height: document.height,
    video: document.video,
    poster: document.poster,
  }
}

/** The library asset an Image or Video node places, or null for anything else. */
function placedAsset(
  node: ComposedMediaNode | null | undefined,
  only?: MediaAssetElement,
): MediaRef | null {
  const componentId = node?.componentId
  if (componentId !== IMAGE_COMPONENT_ID && componentId !== VIDEO_COMPONENT_ID) {
    return null
  }
  if (only && componentId !== only) return null
  // The precedence every other reader of the composed map uses: a node inside
  // a repeated collection carries its bound values in the resolved copy.
  const props = node?.resolvedProps ?? node?.props
  return parseMediaRef(props?.['src'])
}

/** A compose-time token the tenant has not substituted — never a document. */
const UNRESOLVED_TOKEN = /^\{\{[^}]+\}\}$/

/**
 * The markdown-lite document a node holds, or `''` for a node holding none.
 *
 * `resolvedProps` first, for the reason {@link placedAsset} gives: an entry
 * body is the literal `{{entry.body}}` in `props` and the entry's real text in
 * the resolved copy. An unsubstituted token is not a document — it can name no
 * asset — so it is dropped here rather than walked for images that a canvas
 * surface would never find.
 */
function markdownBodyOf(
  props: Record<string, unknown> | undefined,
  componentId: string | undefined,
): string {
  const prop =
    componentId && owns(MARKDOWN_BODY_PROPS, componentId)
      ? MARKDOWN_BODY_PROPS[componentId]
      : undefined
  const text = prop ? props?.[prop] : undefined
  if (typeof text !== 'string' || UNRESOLVED_TOKEN.test(text.trim())) return ''
  return text
}

/** See {@link markdownBodyOf} — the body the page will actually render. */
function markdownBody(node: ComposedMediaNode | null | undefined): string {
  return markdownBodyOf(
    node?.resolvedProps ?? node?.props,
    node?.componentId,
  )
}

/**
 * A markdown-lite image: `![alt](target)`, capturing only the target, and only
 * up to the first whitespace or `)`.
 *
 * That is the whole of the syntax `markdown-lite.ts` accepts — no title string
 * after the target, no angle-bracket form — so there is nowhere else in a body
 * for a reference to hide, and matching more than the parser does would name
 * assets the renderer never asks for.
 */
const MARKDOWN_IMAGE_TARGET = /!\[[^\]]*\]\(\s*([^)\s]+)/g

/**
 * Every library asset a markdown body's images name, in the order the body
 * names them, each beside the target EXACTLY as the body wrote it.
 *
 * The raw target is carried because that is the key the renderer has: it holds
 * the parsed block's `src`, the same string, and looking a pair up by it costs
 * no second parse per image on every render.
 *
 * A target that is not a `media:` reference yields nothing — a hotlinked URL
 * and a legacy stored path have no DAM document to read, and the renderer
 * gives those today's markup unchanged.
 */
function markdownImageRefs(
  text: string,
): Array<{ target: string; ref: MediaRef }> {
  if (!text.includes('![')) return []
  const found: Array<{ target: string; ref: MediaRef }> = []
  for (const match of text.matchAll(MARKDOWN_IMAGE_TARGET)) {
    const target = match[1]
    const ref = parseMediaRef(target)
    if (ref) found.push({ target, ref })
  }
  return found
}

/**
 * The map's node ids in document order: depth first from the root through
 * each node's child ids, then every id the walk never reached (a map with no
 * root, an orphan) in the order the map lists it. That puts the top of the
 * page ahead of its footer, and it is the same order for the same map.
 */
function documentOrder(nodes: Record<string, unknown>): string[] {
  const order: string[] = []
  const seen = new Set<string>()
  const stack = owns(nodes, ROOT_NODE_ID) ? [ROOT_NODE_ID] : []
  while (stack.length) {
    const id = stack.pop() as string
    if (seen.has(id) || !owns(nodes, id)) continue
    seen.add(id)
    order.push(id)
    const children = (nodes[id] as ComposedMediaNode | null)?.nodes
    if (!Array.isArray(children)) continue
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index]
      if (typeof child === 'string' && !seen.has(child)) stack.push(child)
    }
  }
  for (const id in nodes) if (!seen.has(id)) order.push(id)
  return order
}

/**
 * Every distinct library asset the Image and Video nodes in a map place:
 * films first, then images, each in document order.
 *
 * A read that is capped honors that order. A film goes first because its
 * stale facts are the worse render (a player of the wrong shape and a
 * thumbnail that 404s, against a reservation that corrects itself when an
 * image decodes), and document order covers the top of the page before its
 * footer.
 *
 * `[]` for a page that places none, so a caller that gates its read on the
 * length spends nothing on it. A pinned and an unpinned reference to one
 * asset are one entry: a pin names bytes, not a different asset.
 */
export function mediaAssetRefs(
  nodes: Record<string, unknown> | null | undefined,
  options: MediaAssetFactsOptions = {},
): MediaRef[] {
  const refs: MediaRef[] = []
  if (!nodes) return refs
  const order = documentOrder(nodes)
  const seen = new Set<string>()
  for (const element of [VIDEO_COMPONENT_ID, IMAGE_COMPONENT_ID] as const) {
    if (options.only && options.only !== element) continue
    for (const id of order) {
      const node = nodes[id] as ComposedMediaNode | null
      if (node?.componentId !== element) continue
      const ref = placedAsset(node)
      if (!ref) continue
      const key = mediaAssetFactsKey(ref)
      if (seen.has(key)) continue
      seen.add(key)
      refs.push(ref)
    }
  }
  // A markdown body's images come LAST, and only when the caller wants every
  // element (AGL-3149). Last because of what a capped read costs each kind: a
  // placement that misses out renders at its pick-time pair, a body image that
  // misses out renders exactly as it does today, and a film that misses out
  // gets a player of the wrong shape. Only-when-unfiltered because `only` asks
  // for one ELEMENT's placements, and a body image is not a placement of the
  // Image element — the video-asset reader would otherwise read image
  // documents it has no use for.
  if (options.only) return refs
  for (const id of order) {
    const body = markdownBody(nodes[id] as ComposedMediaNode | null)
    for (const { ref } of markdownImageRefs(body)) {
      const key = mediaAssetFactsKey(ref)
      if (seen.has(key)) continue
      seen.add(key)
      refs.push(ref)
    }
  }
  return refs
}

const usable = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

/** A film's props with its asset's facts laid over them. See the module note. */
function withFilmFacts(
  props: Record<string, unknown>,
  facts: MediaAssetFacts,
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
 * An image's props with its asset's pair laid over them, or the SAME object
 * when the document records no usable pair or the stored one already matches.
 * See the module note.
 */
function withImageFacts(
  props: Record<string, unknown>,
  facts: MediaAssetFacts,
): Record<string, unknown> {
  // Through the pick's own gate, so the overlay and the pick agree on what a
  // usable pair is: both halves, finite and positive.
  const live = intrinsicMediaSize({
    componentId: IMAGE_COMPONENT_ID,
    propName: 'src',
    assetWidth: facts.width,
    assetHeight: facts.height,
  })
  if (live.intrinsicWidth === undefined || live.intrinsicHeight === undefined) {
    return props
  }
  if (
    props['intrinsicWidth'] === live.intrinsicWidth &&
    props['intrinsicHeight'] === live.intrinsicHeight
  ) {
    return props
  }
  return {
    ...props,
    intrinsicWidth: live.intrinsicWidth,
    intrinsicHeight: live.intrinsicHeight,
  }
}

/**
 * The prop a markdown body carries its images' pixel pairs in, keyed by the
 * target the body wrote (AGL-3149).
 *
 * A body image is not a node, so it cannot take `intrinsicWidth` and
 * `intrinsicHeight` the way a placement does; the pairs travel together on the
 * element that holds the document, and the renderer looks each one up by the
 * parsed block's `src`.
 */
export const BODY_IMAGE_SIZES_PROP = 'intrinsicSizes'

/** One body image's pair, as {@link BODY_IMAGE_SIZES_PROP} carries it. */
export interface BodyImageSize {
  width: number
  height: number
}

/**
 * A markdown body's props with a pair for each library image it names, or the
 * SAME object when no image in it can be answered for.
 *
 * Only images whose document records a usable pair get an entry, through the
 * same {@link intrinsicMediaSize} gate a placement goes through. An image left
 * out is one the renderer must give today's markup: `srcSet` without the pair
 * makes `sizes` the image's rendered width, which upscales anything narrower
 * than the column, so a partial answer is worse here than no answer.
 */
function withBodyImageFacts(
  props: Record<string, unknown>,
  componentId: string | undefined,
  facts: ReadonlyMap<string, MediaAssetFacts>,
): Record<string, unknown> {
  // THIS object's own body, never the node's resolved one: `props` on a bound
  // entry body still holds the `{{entry.body}}` token, and pairs for images it
  // does not name are bytes in the tree that nothing can ever look up.
  let sizes: Record<string, BodyImageSize> | undefined
  for (const { target, ref } of markdownImageRefs(
    markdownBodyOf(props, componentId),
  )) {
    const found = facts.get(mediaAssetFactsKey(ref))
    if (!found) continue
    const live = intrinsicMediaSize({
      componentId: IMAGE_COMPONENT_ID,
      propName: 'src',
      assetWidth: found.width,
      assetHeight: found.height,
    })
    if (
      live.intrinsicWidth === undefined ||
      live.intrinsicHeight === undefined
    ) {
      continue
    }
    if (!sizes) sizes = {}
    sizes[target] = {
      width: live.intrinsicWidth,
      height: live.intrinsicHeight,
    }
  }
  if (!sizes) return props
  return { ...props, [BODY_IMAGE_SIZES_PROP]: sizes }
}

/**
 * The composed map with each placed asset's facts laid over its node, and each
 * markdown body's images' pairs laid over the element holding the body.
 *
 * `facts` is keyed by {@link mediaAssetFactsKey}. A placement with no entry,
 * because the reader could not answer for its asset, keeps its stored props.
 * The SAME map comes back when nothing changes, so a page with no library
 * asset pays for one walk and no copy, and the input is never mutated either
 * way.
 */
export function applyMediaAssetFacts<T extends Record<string, unknown>>(
  nodes: T,
  facts: ReadonlyMap<string, MediaAssetFacts>,
  options: MediaAssetFactsOptions = {},
): T {
  if (!facts.size) return nodes
  let applied: Record<string, unknown> | undefined
  const write = (id: string, node: ComposedMediaNode, next: {
    props?: Record<string, unknown>
    resolvedProps?: Record<string, unknown>
  }): void => {
    if (!applied) applied = { ...nodes }
    applied[id] = {
      ...node,
      ...(next.props ? { props: next.props } : {}),
      ...(next.resolvedProps ? { resolvedProps: next.resolvedProps } : {}),
    }
  }
  for (const id in nodes) {
    const node = nodes[id] as ComposedMediaNode
    const ref = placedAsset(node, options.only)
    const found = ref ? facts.get(mediaAssetFactsKey(ref)) : undefined
    if (found) {
      const overlay =
        node.componentId === VIDEO_COMPONENT_ID ? withFilmFacts : withImageFacts
      const props = node.props && overlay(node.props, found)
      const resolvedProps =
        node.resolvedProps && overlay(node.resolvedProps, found)
      if (props === node.props && resolvedProps === node.resolvedProps) continue
      write(id, node, { props, resolvedProps })
      continue
    }
    // A markdown body, under the same `only` rule `mediaAssetRefs` collects
    // under: a body image is not a placement of the Image element, so a reader
    // asking for one element's placements is not asking about bodies.
    if (options.only) continue
    const { componentId } = node
    if (!componentId || !owns(MARKDOWN_BODY_PROPS, componentId)) continue
    const props =
      node.props && withBodyImageFacts(node.props, componentId, facts)
    const resolvedProps =
      node.resolvedProps &&
      withBodyImageFacts(node.resolvedProps, componentId, facts)
    if (props === node.props && resolvedProps === node.resolvedProps) continue
    write(id, node, { props, resolvedProps })
  }
  return applied ? (applied as T) : nodes
}
