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
 * The node-definition sanitizer and the component allowlists (AGL-2939):
 * what a node tree must satisfy before it lands on a canvas that did not
 * author it — a marketplace install, and a tree a model generated. Core
 * rather than the marketplace plugin, because two plugins pass their trees
 * through it and a plugin may not import another plugin's model; the
 * marketplace re-exports it under the names its publishers use.
 */

import { isFirstPartyMediaSrc } from './media-ref'

/**
 * Component ids publishable to the marketplace. Mirrors the persisted ids in
 * plugins-mui (plugin.spec.ts) minus `reusableInstance` — nested
 * instances would smuggle references to another tenant's private
 * definitions — and minus `layoutSlot`, which is layout chrome. Keep sorted.
 *
 * The rule this list encodes is "inert and self-contained": an element that
 * renders from its own props travels to another workspace intact. What stays
 * out is what cannot — raw-HTML escape hatches (`customHtml`), references to
 * another tenant's documents (`reusableInstance`), third-party code
 * (`plugin`), host chrome (`layoutSlot`) and anything bound to the source
 * site's data (`collection`, `product`).
 *
 * It must cover everything the besigner's palette offers under those terms, or
 * the catalogue promises what the exporter refuses — which is how `section`
 * came to be missing (AGL-1033): every Sections & Blocks preset composes it,
 * so the whole category was unpublishable. `blocks-publishable.spec.ts` walks
 * the presets and fails if this list falls behind them again.
 */
export const MARKETPLACE_COMPONENT_ID_ALLOWLIST: readonly string[] = [
  'form',
  'formField',
  'image',
  'muiAppBar',
  'muiButton',
  'muiContainer',
  'muiList',
  'muiListItem',
  'muiListItemText',
  'muiScreenLink',
  'muiStack',
  'muiToolbar',
  'muiTypography',
  'searchBox',
  // A semantic wrapper — `<section>`/`<footer>`/`<nav>` plus styling, with no
  // behaviour and no binding to the site it came from.
  'section',
  'socialLinks',
  'videoEmbed',
]

/**
 * Email block ids publishable as an `emailTemplate` (AGL-657).
 *
 * A separate list from the page allowlist because the two vocabularies don't
 * overlap — an email design is built entirely from `plugins-email` blocks, and
 * page components (MUI, forms, video) don't survive an email client anyway.
 *
 * `emailHtml` is excluded deliberately, for the same reason `reusableInstance`
 * is excluded above: it is a raw-HTML escape hatch, and a published template
 * lands in another org's OUTGOING CUSTOMER EMAIL. Email clients don't run
 * scripts, so this isn't XSS — it's that arbitrary markup sent from someone
 * else's domain is a phishing and tracking-pixel vector that no amount of
 * render-time sanitization makes reviewable. Keep sorted.
 */
export const MARKETPLACE_EMAIL_COMPONENT_ID_ALLOWLIST: readonly string[] = [
  'emailButton',
  'emailDivider',
  'emailImage',
  'emailProduct',
  'emailRichtext',
  'emailSection',
  'emailSpacer',
  'emailText',
]

/**
 * Email block ids publishable as an `emailStarter` — the transactional list
 * minus `emailRichtext`.
 *
 * Derived rather than written out, so a block added to the list above cannot
 * silently miss this one. What it subtracts is the reason it exists.
 *
 * `emailRichtext` holds its content in an `html` prop, and the email renderer's
 * `sanitize` hook defaults to identity with no production caller supplying one
 * — so that prop reaches the recipient's inbox exactly as authored. On a
 * transactional design that is the site's own author writing their own mail. In
 * a STARTER it is a stranger's markup mailed from the shared sending domain
 * under the tenant's From header, which is the raw-HTML escape hatch
 * `emailHtml` was excluded for, wearing a friendlier block name. A remote
 * `<img>` inside it is a tracking pixel that the src policy on `emailImage`
 * would otherwise have caught.
 *
 * Subtracting the block is deliberate rather than sanitizing its markup: an
 * allowlist over someone else's HTML is a judgment we would have to keep
 * re-making, and everything rich text can express in an email — a heading, a
 * paragraph, a link, a button — the remaining blocks already express as a
 * structured tree we render ourselves.
 */
export const MARKETPLACE_EMAIL_STARTER_COMPONENT_ID_ALLOWLIST: readonly string[] =
  MARKETPLACE_EMAIL_COMPONENT_ID_ALLOWLIST.filter(
    (componentId) => componentId !== 'emailRichtext',
  )

/** Serialized definition size cap (Firestore doc limit is 1 MiB). */
export const MARKETPLACE_DEFINITION_MAX_BYTES = 200 * 1024

const KEPT_NODE_KEYS = [
  '$id',
  'componentId',
  'pluginId',
  'parentId',
  'props',
  'nodes',
] as const

/**
 * Only navigable protocols — mirrors ScreenLink/Image/Button hardening.
 *
 * Exported for the marketplace's property sanitizer, which holds a published
 * property's Link default to the same rule as a published node's `href`.
 */
const SAFE_HREF = /^(https?:\/\/|mailto:|tel:|\/|#)/i
/**
 * `src` additionally allows inline images, which are inert.
 *
 * `https:` only, unlike {@link SAFE_HREF} (AGL-1701). An `http:` href is a
 * link a reader chooses to follow and their browser will warn about; an
 * `http:` image is fetched automatically, and on the authenticated console —
 * or on any tenant page we serve over TLS — it is mixed content, which every
 * current browser blocks outright. So the permissive form bought a published
 * node nothing: the image did not render either way, it just failed at the
 * viewer instead of at publish time.
 *
 * Exported for the property sanitizer, which holds an Image default to it.
 */
const SAFE_SRC = /^(https:\/\/|data:image\/|\/|#)/i

export { SAFE_HREF as MARKETPLACE_SAFE_HREF, SAFE_SRC as MARKETPLACE_SAFE_SRC }

/**
 * Strips props a published node must never carry into someone else's site
 * (AGL-784).
 *
 * `Leaf` spreads a node's props straight onto the rendered component, and MUI
 * passes unknown props through to its root DOM element, so whatever survives
 * publishing reaches the DOM of every org that installs the listing. Marketplace
 * components are auto-listed with no review, and `hosts/{h}/components` is
 * writable by any org member, so a hand-crafted doc is a realistic input here.
 *
 * What each stripped key actually does, measured rather than assumed:
 * - `dangerouslySetInnerHTML` is NOT the stored-XSS it looks like — `Leaf`
 *   always passes a children array, so React throws
 *   "Can only set one of `children` or `props.dangerouslySetInnerHTML`"
 *   (and the void-element variant for self-closing components like `image`).
 *   That is worse in practice than it sounds: the throw happens during SSR,
 *   which is the AGL-579 failure mode that 500s the page and wedges ISR for
 *   the whole site. One published component would take down every consumer.
 * - `on*` handlers can only survive JSON as strings, which React drops with a
 *   warning. Removed for hygiene, and so a future renderer that does eval-ish
 *   prop handling can't turn them back into a vector.
 * - `href`/`src` get the render-time URL policy applied at publish time too.
 *   React already neutralizes `javascript:` hrefs and the mui components run
 *   SAFE_HREF themselves, so this is defense in depth for any component that
 *   forgets to — cheap, and it keeps the stored artifact honest.
 *
 * Deliberately shallow: only top-level props are spread onto the DOM. A nested
 * object (`icon: { path }`) is consumed by the component, never spread, so
 * recursing would strip legitimate data for no security gain.
 */
function sanitizePublishedNodeProps(
  props: Record<string, unknown>,
): Record<string, unknown> {
  const safe: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(props)) {
    if (key === 'dangerouslySetInnerHTML') continue
    if (/^on[A-Z]/.test(key)) continue
    if ((key === 'href' || key === 'src') && typeof value === 'string') {
      const trimmed = value.trim()
      const pattern = key === 'href' ? SAFE_HREF : SAFE_SRC
      if (!pattern.test(trimmed)) continue
      safe[key] = trimmed
      continue
    }
    safe[key] = value
  }
  return safe
}

/**
 * `nodes` that is still in one of its STORAGE forms rather than a node map
 * (AGL-1395).
 *
 * The two forms `decodeStoredNodes` knows about, tested structurally so this
 * stays a model function with no server import: a byte view — what
 * firebase-admin hands back for a `Bytes` field — and the `{type, data}`
 * envelope `JSON.stringify` makes of a Node `Buffer`, which is what a
 * site-export bundle carries. Neither is a map, and neither is anything the
 * publisher did.
 *
 * The envelope test is deliberately exact, for the reason `decodeStoredNodes`
 * spells out: the alternative reading is a node map with nodes called `type`
 * and `data`, which cannot exist because node-map values are objects.
 */
function isUndecodedNodes(nodes: unknown): boolean {
  if (ArrayBuffer.isView(nodes)) return true
  if (typeof nodes !== 'object' || nodes === null || Array.isArray(nodes)) {
    return false
  }
  const value = nodes as { type?: unknown; data?: unknown }
  return (
    value.type === 'Buffer' &&
    Array.isArray(value.data) &&
    Object.keys(value).length === 2
  )
}

export type MarketplaceDefinitionNodes = Record<
  string,
  {
    $id: string
    componentId: string
    pluginId?: string
    parentId: string | null
    props?: Record<string, unknown>
    nodes?: string[]
  }
>

/**
 * Validates and strips a host component definition for publishing:
 * - only allowlisted component ids (no reusable instances, no layout chrome)
 * - only the persisted node keys (drops runtime fields like resolvedProps)
 * - the subtree reachable from `rootId` only, and a serialized size cap
 *
 * - per-node prop hardening (see `sanitizePublishedNodeProps`, AGL-784)
 *
 * XSS note: rich-text `html` props stay as-authored here — they are sanitized
 * at render time (sanitize-rich-text allowlist), which also covers definitions
 * written to Firestore directly (see docs/SECURITY_CONTENT_REVIEW.md). Props
 * that are spread onto the DOM (`dangerouslySetInnerHTML`, `on*`, `href`,
 * `src`) are hardened HERE as well, because publishing hands them to a
 * different org's render tree.
 */
export function sanitizeMarketplaceDefinition(
  definition: {
    rootId: string
    nodes: Record<string, any>
  },
  options?: {
    /**
     * Additional component ids permitted for this artifact type.
     *
     * `layoutSlot` is excluded from the shared allowlist because a slot in
     * page content has nowhere to graft — but a published LAYOUT is
     * meaningless without one (AGL-671). Scoped per call rather than added
     * globally so page and component publishing stay unchanged.
     */
    extraComponentIds?: readonly string[]
    /**
     * Replaces the page allowlist outright, for artifact types built from a
     * disjoint component vocabulary — an email design uses `plugins-email`
     * blocks and nothing else (AGL-657), so EXTENDING the page list would
     * green-light a `videoEmbed` or `form` that no email client can render.
     */
    componentIds?: readonly string[]
  },
):
  | { ok: true; rootId: string; nodes: MarketplaceDefinitionNodes }
  | { ok: false; error: string } {
  const { rootId, nodes } = definition
  const base = options?.componentIds ?? MARKETPLACE_COMPONENT_ID_ALLOWLIST
  const allowed = options?.extraComponentIds?.length
    ? [...base, ...options.extraComponentIds]
    : base
  // An UNDECODED `nodes` is never the author's fault, so it must not share a
  // message with a genuinely rootless definition (AGL-1395). Both undecoded
  // forms — a Node `Buffer` from the Admin SDK, and the `{type:'Buffer'}`
  // envelope `JSON.stringify` makes of one — reach the root check below as
  // something with no `_@_` in it, and the answer was "Definition has no root
  // node": a sentence that sends the publisher to redesign a page that is
  // fine. Callers must run `decodeStoredNodes` first; this says so out loud
  // rather than letting the next raw read look like a content problem.
  if (isUndecodedNodes(nodes)) {
    return {
      ok: false,
      error:
        'This content could not be read — it is stored compressed and was ' +
        'not decoded before publishing. That is a bug on our side, not a ' +
        'problem with your design.',
    }
  }
  if (!rootId || !nodes?.[rootId]) {
    return { ok: false, error: 'Definition has no root node' }
  }
  const sanitized: MarketplaceDefinitionNodes = {}
  /** Set while walking; see the empty-definition check after the loop. */
  let rootIsWrapper = false
  const queue = [rootId]
  while (queue.length) {
    const id = queue.shift() as string
    if (sanitized[id]) continue
    const node = nodes[id]
    if (!node) return { ok: false, error: `Missing node "${id}"` }
    // The root node is the virtual root-collection wrapper (canvas
    // `NODE_ROOT_ID` = `_@_`): it declares "everything inside <body>" for
    // drag/drop mapping, not a rendered component, so a `div`/absent
    // componentId there is structural — not a real component to allowlist
    // (AGL-783). Exempt ONLY that wrapper shape; a root carrying a real
    // component id is still checked, so a disallowed component can't be
    // smuggled in as the root. Every descendant is real content and always
    // checked below.
    const isRootWrapper =
      id === rootId &&
      (node.componentId == null ||
        node.componentId === '' ||
        node.componentId === 'div')
    if (!isRootWrapper && !allowed.includes(node.componentId)) {
      return {
        ok: false,
        // Says why, not just no (AGL-1033). The bare id was doubly unhelpful:
        // it is not what the palette calls the element, and it left the author
        // guessing whether this was a bug or a rule.
        error:
          `Component "${node.componentId}" cannot be published — a listing may ` +
          'only contain self-contained presentational elements. Raw HTML, ' +
          'reusable-component references, plugin elements and anything bound ' +
          "to this site's data or layout stay behind.",
      }
    }
    const plain: any = {}
    for (const key of KEPT_NODE_KEYS) {
      if (node[key] !== undefined) plain[key] = node[key]
    }
    // Per-node prop hardening (AGL-784) — see sanitizePublishedNodeProps.
    if (plain.props && typeof plain.props === 'object') {
      plain.props = sanitizePublishedNodeProps(plain.props)
    }
    plain.$id = id
    plain.parentId = id === rootId ? null : (node.parentId ?? null)
    // Give the wrapper an explicit container id so the installed definition
    // renders its root collection the same way it did on the source site.
    if (isRootWrapper) {
      plain.componentId = 'div'
      rootIsWrapper = true
    }
    sanitized[id] = plain
    if (Array.isArray(node.nodes)) queue.push(...node.nodes)
  }
  let serialized: string
  try {
    serialized = JSON.stringify(sanitized)
  } catch {
    return { ok: false, error: 'Definition is not serializable' }
  }
  if (serialized.length > MARKETPLACE_DEFINITION_MAX_BYTES) {
    return { ok: false, error: 'Definition is too large to publish' }
  }
  // An empty definition is not a listing (AGL-1033). Publishing one used to
  // SUCCEED — the root wrapper alone sanitizes cleanly — so a component whose
  // content had never been published to its document shipped a blank version
  // to everyone who installed it, and said nothing. Refusing here is the
  // "fail loudly at the point the author understands it" half.
  //
  // Only the WRAPPER case: a definition that is a single real component is a
  // perfectly good one-element listing, and refusing that would be a different
  // bug in the other direction.
  if (rootIsWrapper && Object.keys(sanitized).length <= 1) {
    return {
      ok: false,
      error:
        'There is nothing to publish — this is empty. If you have edited it ' +
        'in the designer, publish those changes first, then publish the listing.',
    }
  }
  return { ok: true, rootId, nodes: sanitized }
}

/**
 * Converts a sanitized marketplace/AI definition (normalized map) into the
 * nested node shape `canvas.addNodeFromPreset` grafts — ids regenerate on
 * insert, so collisions with existing canvas nodes are impossible
 * (AGL-169). A seen-set guards malformed self-referencing trees.
 */
export function marketplaceDefinitionToNested(
  rootId: string,
  nodes: MarketplaceDefinitionNodes,
): Record<string, unknown> | null {
  const seen = new Set<string>()
  const build = (id: string): Record<string, unknown> | null => {
    const node = nodes[id]
    if (!node || seen.has(id)) return null
    seen.add(id)
    return {
      componentId: node.componentId,
      ...(node.pluginId ? { pluginId: node.pluginId } : {}),
      ...(node.props ? { props: node.props } : {}),
      nodes: (node.nodes ?? [])
        .map(build)
        .filter((child): child is Record<string, unknown> => Boolean(child)),
    }
  }
  return build(rootId)
}

/**
 * Field types a published dataset schema may declare (AGL-657). Mirrors
 * `DATASET_FIELD_TYPES` in core; duplicated rather than imported to keep this
 * module dependency-free (it is imported by API routes and client components
 * alike), and asserted against the source of truth in the spec.
 */
export const MARKETPLACE_DATASET_FIELD_TYPES: readonly string[] = [
  'bool',
  'bytes',
  'coordinates',
  'float',
  'int32',
  'int64',
  'map',
  'nil',
  'reference',
  'sorted',
  'text',
  'timestamp',
]

