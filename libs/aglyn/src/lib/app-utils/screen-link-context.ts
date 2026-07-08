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
  const { screens, suppressNavigation } = useContext(ScreenLinkContext)
  const href = useMemo(() => {
    if (!screenId) return undefined
    const path = screens?.[screenId]
    if (path === undefined) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn(
          `[ScreenLink] screen "${screenId}" has no routing-map entry — ` +
            'it may be unpublished or deleted; rendering without an href.',
        )
      }
      return undefined
    }
    return path === '/' ? '/' : `/${path}`
  }, [screenId, screens])
  return { href, suppressNavigation: Boolean(suppressNavigation) }
}
