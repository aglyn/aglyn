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
import { useContext, useMemo } from 'react'
import {
  ScreenLinkContext,
  type ScreenRouteMap,
} from './screen-link-context-value'
import {
  EXTERNAL_HREF_PATTERN,
  SAFE_HREF_PATTERN,
  resolveScreenHref,
  splitLinkValue,
} from './screen-link-value'

export * from './screen-link-context-value'

export interface ResolvedScreenLink {
  /** Site-relative href (`/`, `/company/about`), undefined when unresolvable. */
  href?: string
  suppressNavigation: boolean
  /** True only on the static besigner canvas — interactions are inert. */
  editorInert: boolean
  /**
   * A screen id WAS authored and the routing map does not have it — the
   * target is unpublished or deleted (AGL-1893).
   *
   * Distinct from "no href": the canvas and the preview withhold hrefs on
   * purpose, and an element with no link at all never had one to lose.
   * Only this flag means the author asked for a link that cannot exist, and
   * only elements reading THIS may say so — see {@link isScreenLinkBroken}
   * for why an absent or empty map is deliberately not "broken".
   */
  broken: boolean
}

/**
 * Whether an authored screen id points at nothing (AGL-1893).
 *
 * Unpublishing or deleting a screen is a normal authoring action, and until
 * this existed nothing anywhere reported what it had just broken: a Tabs
 * link to a retired screen shipped as a live-looking control that silently
 * did nothing on `aglyn.com/changelog` and `/newsroom` for two days.
 *
 * The two "we cannot tell" cases are NOT broken, and the distinction is the
 * whole safety of this predicate:
 *
 * - **no map** — a surface that renders canvas nodes without providing
 *   `ScreenLinkContext` (an isolated spec, an embed) knows nothing about
 *   the host's screens, and must not conclude that every link is dead;
 * - **an empty map** — the same thing one beat earlier: the console's live
 *   host subscription starts empty, and a moment of `{}` must not repaint a
 *   whole navigation row as broken and then repaint it back.
 *
 * Both failure directions were weighed. Calling a live link broken hides or
 * disables working navigation on a customer's site; calling a dead link fine
 * leaves exactly the defect this issue is about. Only the first is
 * unrecoverable from the visitor's side, so the doubt resolves that way.
 */
export function isScreenLinkBroken(
  screens: ScreenRouteMap | undefined,
  screenId: string | null | undefined,
): boolean {
  if (!screenId) return false
  if (!screens || Object.keys(screens).length === 0) return false
  return resolveScreenHref(screens, screenId) === undefined
}

/**
 * The extra option a Screen picker needs when its stored value matches none
 * of the host's screens (AGL-1893).
 *
 * The console builds `SCREEN_SELECT` options from the routing map, so a
 * value the map has lost — the retired `/blog` screen, say — matches
 * nothing and the field renders EMPTY. Which reads, to the person looking
 * at it, as "no link set". Meanwhile the element still behaves as linked:
 * the strip is still a nav landmark, that tab is still skipped as
 * "navigates", and the panel it would have revealed is still suppressed. So
 * the one surface where this is repairable was also the one actively
 * denying there was anything to repair.
 *
 * Returns the stored value UNCHANGED as the option's value: naming a dead
 * target must not rewrite it, or opening the panel and pressing Save would
 * quietly convert a recoverable reference into something else.
 *
 * Two shapes get named, because a Screen picker can legally hold either
 * (AGL-1335 / AGL-1894): a screen reference whose screen is gone, and a
 * plain address typed in before the picker existed. The second is not
 * broken — but it is just as invisible, and an author who cannot see it is
 * the reason those links are not rename-safe yet.
 */
export function unavailableScreenLabel(
  screenId: string,
  screensKnown: boolean,
): string {
  // With no map loaded yet nothing is known to be missing, so the id is
  // shown plainly. Flashing "unavailable" over every link for the beat
  // before the console's host subscription lands would teach authors to
  // ignore the warning that matters.
  return screensKnown
    ? `⚠ Unavailable screen (${screenId}) — unpublished or deleted`
    : screenId
}

export function unresolvedScreenOption(
  value: unknown,
  screens: ScreenRouteMap | undefined,
): { value: string; label: string } | undefined {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return undefined
  const known = !!screens && Object.keys(screens).length > 0
  const target = splitLinkValue(raw, undefined)
  if (target.screenId) {
    if (resolveScreenHref(screens, target.screenId) !== undefined) {
      return undefined
    }
    return {
      value: raw,
      label: unavailableScreenLabel(target.screenId, known),
    }
  }
  return target.href
    ? { value: raw, label: `⚠ Plain address (${target.href}) — not a screen` }
    : undefined
}

/**
 * Marks the element in the DOM. Present on the live site too, deliberately:
 * a smoke pass can then find every dead control on a page with one selector
 * instead of reading five different components' conditions.
 */
export const BROKEN_SCREEN_LINK_ATTR = 'data-aglyn-broken-link'

/** What the AUTHOR is told, on the one surface that can fix it. */
export const BROKEN_SCREEN_LINK_MESSAGE =
  'Broken link: this points at a screen that is unpublished or deleted, so ' +
  'it will not work on the published site. Pick a screen again in the ' +
  'attributes panel, or clear the link.'

/**
 * The editor-only outline. A warning ring rather than an error one: the
 * screen may be deliberately unpublished and about to come back, and the
 * page is not broken, one control on it is.
 */
export const BROKEN_SCREEN_LINK_SX = {
  outline: '2px dashed',
  outlineColor: 'warning.main',
  outlineOffset: '2px',
  borderRadius: 1,
}

/**
 * Props that make a dead screen link visible to its author (AGL-1893).
 *
 * The tooltip and the ring are `editorInert` only — that is the static
 * besigner canvas, the one surface where the person who can fix this is
 * looking at it. Preview deliberately does NOT get them: preview exists to
 * show what visitors will see, and an authoring annotation painted into it
 * is a lie of a different kind.
 *
 * The data attribute ships everywhere, canvas and live site alike.
 */
export function brokenScreenLinkProps(
  broken: boolean,
  editorInert: boolean,
): Record<string, unknown> {
  if (!broken) return {}
  return {
    [BROKEN_SCREEN_LINK_ATTR]: '',
    ...(editorInert ? { title: BROKEN_SCREEN_LINK_MESSAGE } : null),
  }
}

/**
 * Link VALUE parsing AND resolution live in `./screen-link-value` —
 * server-safe, because the where-used scan and the Markdown representation of
 * a page both run on the server, and the `createContext` this module reaches
 * keeps it out of the `@aglyn/aglyn/server` barrel (AGL-703, AGL-2740).
 * Re-exported here so every existing importer, and the spec beside this file,
 * keeps reaching them at the address they have always used.
 */
export {
  EXTERNAL_HREF_PATTERN,
  SAFE_HREF_PATTERN,
  SCREEN_LINK_VALUE_PREFIX,
  formatScreenLinkValue,
  nodesReferenceScreen,
  parseScreenLinkValue,
  resolveScreenHref,
  splitLinkValue,
} from './screen-link-value'

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
    // NOT `!href`: a suppressed surface has no href for links that resolve
    // perfectly well, and the whole point of this flag is to separate the
    // two (AGL-1893).
    broken: isScreenLinkBroken(screens, screenId),
  }
}
