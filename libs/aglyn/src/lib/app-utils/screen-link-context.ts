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
// Lives in @aglyn/aglyn (not a UI lib) deliberately, WITHOUT a 'use client'
// banner: every surface that renders canvas nodes already imports this
// package, and a client boundary here (or importing the shared-ui-jsx
// barrel from the tenant page) makes the bundler duplicate parts of the
// module graph — a second canvas/emitter instance renders the site blank.
import { createContext, useContext, useMemo } from 'react'

/**
 * Host routing map: screen id → routed path in the tenant matcher format
 * (root is `'/'`, nested paths are slash-joined segments WITHOUT a leading
 * slash, e.g. `company/about`). This is the `screens` field of the host
 * document — the single source of truth kept current by the publish and
 * hierarchy flows.
 */
export type ScreenRouteMap = Record<string, string>

export interface ScreenLinkContextValue {
  /** Routing map hrefs are resolved against. Absent → nothing resolves. */
  screens?: ScreenRouteMap
  /** Optional display names by screen id, for editor-facing pickers. */
  labels?: Record<string, string>
  /**
   * True inside editing surfaces (besigner canvas, preview): screen links
   * render their content but must not navigate.
   */
  suppressNavigation?: boolean
  /**
   * True ONLY on the static besigner canvas (AGL-830): interactions are
   * inert and command-bus-driven elements (nav menus, drawers) render their
   * editor affordance instead of the live popup. The Preview surface leaves
   * this falsy — it suppresses navigation but runs interactions for real, so
   * a hover-to-open mega menu behaves exactly like the live site. Split out
   * of {@link suppressNavigation}, which now means only "links don't navigate".
   */
  editorInert?: boolean
  /** Current screen's translations: locale → screen id (AGL-164). */
  localeVariants?: Record<string, string>
  /** Locale of the screen being rendered (AGL-164). */
  currentLocale?: string
}

/**
 * Render-time resolution context for id-based screen links: canvas nodes
 * persist a screen id, never a path, so slug renames and re-parenting can't
 * break links. Provided by the tenant page (map from static props, refreshed
 * by ISR) and by the console's besigner/preview surfaces (map from the live
 * host doc subscription, navigation suppressed). Context crosses the canvas
 * shadow DOM because the shadow root renders through a React portal.
 */
export const ScreenLinkContext = createContext<ScreenLinkContextValue>({})
ScreenLinkContext.displayName = 'ScreenLinkContext'

export interface ResolvedScreenLink {
  /** Site-relative href (`/`, `/company/about`), undefined when unresolvable. */
  href?: string
  suppressNavigation: boolean
  /** True only on the static besigner canvas — interactions are inert. */
  editorInert: boolean
}

/**
 * Turns a screen id into its current href against a routing map, or
 * `undefined` when there is no id or the id has no entry (unpublished or
 * deleted). Pure and hook-free on purpose: an element that resolves ONE
 * target uses {@link useScreenLink}, but a row of them — the Tabs strip's
 * per-tab links (AGL-1312) — cannot call a hook per item, and the
 * map-to-path contract (root is `'/'`, everything else gains a leading
 * slash) must have exactly one implementation.
 */
export function resolveScreenHref(
  screens: ScreenRouteMap | undefined,
  screenId: string | null | undefined,
): string | undefined {
  if (!screenId) return undefined
  // A value that arrived through a `Link`-typed component prop (AGL-1335)
  // carries the prefix, because there it has to be distinguishable from the
  // raw path strings those props held before the picker existed. Stripping
  // it HERE rather than at each call site is the same "one resolver" rule
  // the doc comment above states: every surface that resolves a screen id
  // must accept both spellings, or a prop-fed tab strip would resolve where
  // a prop-fed button did not.
  const id = parseScreenLinkValue(screenId) ?? screenId
  const path = screens?.[id]
  if (path === undefined) return undefined
  return path === '/' ? '/' : `/${path}`
}

/**
 * Prefix marking a stored link value as a screen REFERENCE rather than a
 * literal href (AGL-1335).
 *
 * A `Link`-typed component prop stores its value in the same string slot
 * whichever way it was authored, and every value written before the picker
 * existed is a raw path (`/pricing`). A bare screen id is indistinguishable
 * from a relative path that happens to have no slash, so the id-carrying
 * shape is the one that gets the marker: a legacy string keeps meaning
 * exactly what it always meant, and only newly picked values indirect
 * through the routing map.
 */
export const SCREEN_LINK_VALUE_PREFIX = 'screen:'

/** Wraps a screen id as a stored link value — see {@link SCREEN_LINK_VALUE_PREFIX}. */
export function formatScreenLinkValue(screenId: string): string {
  return `${SCREEN_LINK_VALUE_PREFIX}${screenId}`
}

/**
 * The screen id a stored link value references, or `undefined` when the
 * value is a literal href (legacy raw string, external URL, or unset).
 */
export function parseScreenLinkValue(
  value: unknown,
): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed.startsWith(SCREEN_LINK_VALUE_PREFIX)) return undefined
  const id = trimmed.slice(SCREEN_LINK_VALUE_PREFIX.length).trim()
  return id || undefined
}

/**
 * Navigable protocols only. A stored `javascript:`/`data:` href would
 * execute in visitors' browsers, so the guard the linking components each
 * carried is here instead — one copy, one place to harden.
 */
export const SAFE_HREF_PATTERN = /^(https?:\/\/|mailto:|tel:|\/|#)/i

/** Of those, the ones that actually leave the site (new-tab decisions). */
export const EXTERNAL_HREF_PATTERN = /^(https?:\/\/|mailto:|tel:)/i

/**
 * Sorts an element's two link inputs into "a screen id" and "a literal
 * href", tolerating either value arriving in either slot (AGL-1335).
 *
 * Both slots are string props, and a component prop bound with
 * `{{prop.link}}` can be dropped into whichever one the author reached for
 * first. So the ROUTING is driven by the value's shape, not by which field
 * it sits in:
 *
 * - a `screen:`-prefixed value is a screen reference wherever it appears;
 * - an href-shaped value (`/x`, `https://…`, `#a`, `mailto:`) in the screen
 *   slot is a literal href — a real screen id never looks like that, and
 *   the alternative is a link that silently resolves to nothing;
 * - anything else in the screen slot is a bare screen id, exactly as before.
 *
 * A resolved screen id always wins: `screenId` has taken precedence over
 * `href` since AGL-139, and this must not change which of the two an
 * already-published page follows.
 */
export function splitLinkValue(
  screenId: string | null | undefined,
  href: string | null | undefined,
): { screenId?: string; href?: string } {
  const rawScreen = typeof screenId === 'string' ? screenId.trim() : ''
  const rawHref = typeof href === 'string' ? href.trim() : ''
  const fromScreenSlot = parseScreenLinkValue(rawScreen)
  if (fromScreenSlot) return { screenId: fromScreenSlot }
  if (rawScreen && !SAFE_HREF_PATTERN.test(rawScreen)) {
    return { screenId: rawScreen }
  }
  const fromHrefSlot = parseScreenLinkValue(rawHref)
  if (fromHrefSlot) return { screenId: fromHrefSlot }
  // An href-shaped value in the screen slot beats an empty href slot, and
  // loses to a real one — the screen slot was never meant to hold a path.
  const literal = rawHref || rawScreen
  return literal ? { href: literal } : {}
}

/** What a linking element renders — see {@link useLinkTarget}. */
export interface ResolvedLinkTarget extends ResolvedScreenLink {
  /** The literal href in play once safety-checked, when no screen resolved. */
  externalHref?: string
  /** True when `href` leaves the site — what "open in a new tab" may act on. */
  leavesSite: boolean
}

/**
 * The single href a linking element should render, from the `screenId` +
 * `href` pair every one of them declares (AGL-1335).
 *
 * Button, Screen Link, Link Box and Image each had the same four lines —
 * resolve the id, safety-check the URL, prefer the id — which is three
 * copies too many now that a `Link`-typed component prop can feed either
 * slot with either shape. Hook-shaped because {@link useScreenLink} is;
 * it is always called, so the hook order never depends on the values.
 */
export function useLinkTarget(
  screenId: string | null | undefined,
  href: string | null | undefined,
): ResolvedLinkTarget {
  const target = splitLinkValue(screenId, href)
  const resolved = useScreenLink(target.screenId)
  const externalHref =
    target.href && SAFE_HREF_PATTERN.test(target.href) ? target.href : undefined
  const finalHref = target.screenId ? resolved.href : externalHref
  return {
    ...resolved,
    href: finalHref,
    externalHref,
    leavesSite: Boolean(
      !target.screenId && externalHref && EXTERNAL_HREF_PATTERN.test(externalHref),
    ),
  }
}

/**
 * Resolves a screen id to its current href. Memoized on the routing-map
 * identity: a slug rename, parent-slug change, or re-parent produces a new
 * map value, so cached hrefs reset exactly when the map changes. Returns no
 * href for unknown/unpublished ids — callers degrade to plain content
 * instead of rendering a dead link.
 */
export function useScreenLink(
  screenId: string | null | undefined,
): ResolvedScreenLink {
  const { screens, suppressNavigation, editorInert } = useContext(ScreenLinkContext)
  const href = useMemo(() => {
    if (!screenId) return undefined
    const resolved = resolveScreenHref(screens, screenId)
    if (resolved === undefined) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(
          `[ScreenLink] screen "${screenId}" has no routing-map entry — ` +
            'it may be unpublished or deleted; rendering without an href.',
        )
      }
      return undefined
    }
    return resolved
  }, [screenId, screens])
  return {
    href,
    suppressNavigation: Boolean(suppressNavigation),
    editorInert: Boolean(editorInert),
  }
}
