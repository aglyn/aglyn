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
 * The render-time screen-link context, and the shape it carries.
 *
 * Its own module because a published page provides this context and reads
 * nothing else here: the map goes in at the top of the tree and the canvas
 * nodes below resolve their hrefs from it. `screen-link-context.ts` around it
 * is the resolution machinery every editing surface needs — the broken-link
 * verdict and its styling, the unavailable-screen labels, the href resolver,
 * the link-value splitter and the two hooks — and through
 * `screen-link-value.ts` the persisted link grammar as well. A bundler cannot
 * drop that around a single named import.
 *
 * No `'use client'` banner, for the reason `screen-link-context.ts` records:
 * inside this package the directive forks the module graph, and a second
 * copy of the context is a second context — providers on one, consumers on
 * the other, and every link resolving to nothing.
 */

import { createContext } from 'react'

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
