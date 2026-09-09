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
 * The visitor's scheme, as a path segment (AGL-2708).
 *
 * A published page resolves its dark scheme in JS rather than in CSS, so the
 * scheme has to be decided before the first render. Reading it from the
 * request inside the render — `cookies()` in a layout — decides it correctly
 * but makes the route dynamic, and the catch-all page beneath declares
 * `revalidate`: on the regeneration path Next renders that segment in a static
 * context, where a dynamic API throws `DYNAMIC_SERVER_USAGE`. Per-visitor
 * theming and ONE cached document are irreconcilable.
 *
 * Per-SCHEME theming and TWO cached documents are not. This module is that
 * seam: the middleware resolves the scheme from the request — where reading
 * cookies and headers costs nothing, because middleware runs ahead of the
 * cache on every request — and spends it as a path segment. Next's route cache
 * keys on the pathname, so `light` and `dark` become two entries of the same
 * page instead of one entry that cannot answer either.
 *
 * ⚠️ TWO SEGMENTS, NOT FOUR. The request carries two separate answers — the
 * visitor's explicit choice (cookie) and their device's preference (client
 * hint) — and `useThemeModeState` keeps them apart so the switcher can show
 * "Device default" checked rather than the scheme the device happens to be in.
 * Encoding both would be four cache entries per page. This encodes only what
 * they RESOLVE to, because that is the only part that changes a pixel: which
 * radio is checked is settled at hydration from the cookie the browser already
 * has, inside a menu a visitor has to open before they can see it. Four-fold
 * cache multiplication is a poor price for the checked state of a hidden
 * control, on a page that is billed per view.
 *
 * Nothing here imports React, MUI or `js-cookie`, and its one import is a type
 * erased at compile time — the same constraint `util/theme-mode-cookie` and
 * `util/color-scheme-hint` hold themselves to, and for the same two reasons:
 * a Server Component may take it without pulling the theme library's context
 * providers into the RSC graph, and the edge middleware may take it at all.
 */
import type { ThemeMode } from '../hocs/create-with-theme-provider'

/**
 * Every spelling the segment is allowed to take.
 *
 * A closed set on purpose: the segment is written by our own middleware and
 * read back by a route, so an unknown value is never a visitor's preference —
 * it is a stale link, a crawler walking a guessed URL, or a bug. Each such
 * request must still render a page, which is what `parseSchemeRouteSegment`
 * guarantees by resolving anything unrecognized to the light default rather
 * than throwing.
 */
export const SCHEME_ROUTE_SEGMENTS = ['light', 'dark'] as const

export type SchemeRouteSegment = (typeof SCHEME_ROUTE_SEGMENTS)[number]

/**
 * The scheme a request resolves to, as the segment that will carry it.
 *
 * This is the same precedence `useThemeModeState` applies on the client — a
 * stated preference outranks a device default, and light is what remains when
 * the request said neither — expressed once here so the server render and the
 * hydration that follows it cannot disagree about which document was owed.
 *
 * `'system'` is not a scheme. The switcher writes it to mean "follow the
 * device", and `parseThemeModeCookie` already reads it back as `null`; it is
 * rejected here too so a caller passing a raw cookie value cannot smuggle it
 * in as a choice.
 *
 * ⚠️ Light for a request that named nothing is a FALLBACK, not a default
 * preference. Firefox and Safari send no client hint, so their visitors reach
 * this with two nulls and are served the light document, then settle on their
 * real device scheme once `prefers-color-scheme` can be evaluated — the same
 * hydration-time settle those browsers have always had here. Choosing dark
 * instead would not fix them; it would only move the flip to the other half of
 * their visitors.
 */
export function resolveSchemeRouteSegment(
  chosen: ThemeMode,
  device: ThemeMode,
): SchemeRouteSegment {
  const scheme = isScheme(chosen) ? chosen : isScheme(device) ? device : 'light'
  return scheme
}

/**
 * A path segment as the scheme to render.
 *
 * Total, by construction: an absent, misspelled or hostile segment renders the
 * light document rather than refusing. A route that 500s on an unrecognized
 * segment would turn a stale bookmark into an error page, and this segment is
 * in the URL of every cached page on the site.
 */
export function parseSchemeRouteSegment(
  value: string | undefined | null,
): SchemeRouteSegment {
  return value === 'dark' ? 'dark' : 'light'
}

function isScheme(mode: ThemeMode): mode is SchemeRouteSegment {
  return mode === 'light' || mode === 'dark'
}
