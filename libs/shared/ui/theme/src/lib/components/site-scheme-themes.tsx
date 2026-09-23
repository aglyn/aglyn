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
'use client'

import { createContext, useContext } from 'react'
import type { Theme } from '../../vendor/mui'

/** The two schemes a site renders in. */
export type SiteScheme = 'light' | 'dark'

/**
 * The SITE's full theme for either scheme, whichever one is active
 * (AGL-3284).
 *
 * A site resolves light/dark by swapping one single-mode MUI theme, so
 * everything below the provider sees exactly one scheme. An element the author
 * pinned to "Always light" / "Always dark" needs the OTHER one — built from the
 * same host document, base and options as the active theme, so a dark band on a
 * light page wears the site's own dark palette rather than MUI's stock one.
 *
 * Undefined when nothing provides it (an email render, a bare test), which the
 * renderer reads as "no scheme can be forced here" and renders unchanged.
 */
export type SiteSchemeThemes = (scheme: SiteScheme) => Theme

export const SiteSchemeThemesContext = createContext<
  SiteSchemeThemes | undefined
>(undefined)
SiteSchemeThemesContext.displayName = 'SiteSchemeThemesContext'

/** The site's theme-per-scheme getter, or `undefined` outside a site surface. */
export function useSiteSchemeThemes() {
  return useContext(SiteSchemeThemesContext)
}

/**
 * Wraps a per-scheme theme builder so each scheme is built at most once, and
 * only when something asks for it.
 *
 * Lazy on purpose: nearly every page pins nothing, and building the other
 * scheme's theme up front would double the theme construction on every
 * render of every site for an element that is not there. Callers memoize the
 * returned getter on the builder's inputs, so a changed host document drops
 * both cached themes together.
 */
export function createSiteSchemeThemes(
  build: (scheme: SiteScheme) => Theme,
): SiteSchemeThemes {
  const cache: Partial<Record<SiteScheme, Theme>> = {}
  return (scheme) => {
    const key: SiteScheme = scheme === 'dark' ? 'dark' : 'light'
    return (cache[key] ??= build(key))
  }
}
