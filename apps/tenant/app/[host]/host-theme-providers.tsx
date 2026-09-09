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

import type { HostTheme } from '@aglyn/shared-data-types'
// Deep path like the console's providers.tsx — the component is not in
// the shared-ui-jsx barrel.
import LoadingLayoutAppComponent from '@aglyn/shared-ui-jsx/components/loading-layout-app.component'
import {
  consoleOptions,
  consoleOptionsDark,
  consoleThemeDark,
  consoleThemeLight,
  HostThemeProvider,
  tenantOptions,
  tenantOptionsDark,
  tenantThemeDark,
  tenantThemeLight,
  type ThemeMode,
  wearsPlatformBrand,
} from '@aglyn/shared-ui-theme'
import type { ReactNode } from 'react'
// Type-only — see the note on the same import in `host-brand.context.tsx`.
import type { SiteNavLink } from '../../utils/site-nav'
import { HostBrandProvider } from './host-brand.context'

/**
 * Client theme boundary for tenant sites (App Router). Replaces the Pages
 * Router `_app` `MainComponent`: the resolved host theme is fetched in the
 * `[host]` server layout and handed down as a serializable prop, then
 * `HostThemeProvider` renders children under the host's MUI theme (falling
 * back to the console light/dark themes when the host has no customization).
 *
 * The navigation loader (AGL-594) mounts INSIDE the host theme so its
 * blurred `background.paper` scrim and `secondary` progress colors match
 * the site, branded with the host's logo (site name as fallback).
 *
 * `HostBrandProvider` publishes that same logo/name pair to the rest of the
 * tree (AGL-2074). The navigation loader consumed them as props and nothing
 * else could see them, which left the `not-found`/`error` boundaries — which
 * get no `params` and so cannot resolve the host themselves — with no way to
 * wear the site's own mark. Mounted OUTSIDE the loading layout rather than
 * inside it, so a boundary rendering in place of the page still reads the
 * brand even when the loader is not on screen.
 */
export function HostThemeProviders({
  hostTheme,
  initialThemeMode,
  initialDeviceMode,
  brandLogoUrl,
  brandName,
  siteLinks,
  hostKey,
  siteTitle,
  titleSeparator,
  children,
}: {
  hostTheme?: HostTheme
  /**
   * The visitor's stated light/dark choice as a seed for the first render.
   *
   * ⚠️ NOT SUPPLIED BY THE TENANT LAYOUT, and that is the AGL-2708 fix rather
   * than an omission. Reading the cookie in the render is what made the route
   * dynamic and took every tenant page to a 500; the scheme now arrives
   * already resolved, in `initialDeviceMode` below. The stated-choice half is
   * restored at hydration, where the browser reads its own cookie — which is
   * soon enough, because it changes no color, only which switcher radio is
   * checked inside a menu the visitor has to open.
   */
  initialThemeMode?: ThemeMode
  /**
   * The scheme the document is built in: the resolved light/dark the
   * middleware spent as a path segment and the layout read back off its route
   * params (AGL-2708).
   *
   * The device seat rather than the choice seat because that is where a value
   * with no cookie beside it belongs — `useThemeModeState` takes
   * `mode = cookieMode ?? systemMode`, and `cookieMode` is unreadable on the
   * server. Without it the media query has no answer until the page has
   * hydrated and a visitor on a dark device is served a light document.
   */
  initialDeviceMode?: ThemeMode
  brandLogoUrl?: string
  brandName?: string
  siteLinks?: SiteNavLink[]
  hostKey?: string
  siteTitle?: string
  titleSeparator?: string
  children: ReactNode
}) {
  // A site that authored no palette of its own resolves the tenant default —
  // MUI's stock accents plus this platform's extra slots, accessible in both
  // schemes. The platform's own marketing hosts keep the Aglyn brand, which
  // is why the choice is made here rather than by writing a palette into
  // every host document: the marketing site tracks `console.theme.ts` the
  // same way the console does.
  const platformBrand = wearsPlatformBrand(hostKey)
  const fallback = platformBrand
    ? ([consoleThemeLight, consoleThemeDark] as [
        typeof consoleThemeLight,
        typeof consoleThemeDark,
      ])
    : ([tenantThemeLight, tenantThemeDark] as [
        typeof tenantThemeLight,
        typeof tenantThemeDark,
      ])
  // The same theme as `fallback`, in options form, so a host that customizes
  // one value keeps the rest of the base rather than MUI's stock (AGL-1180).
  const baseOptions = platformBrand
    ? ([consoleOptions, consoleOptionsDark] as [
        typeof consoleOptions,
        typeof consoleOptionsDark,
      ])
    : ([tenantOptions, tenantOptionsDark] as [
        typeof tenantOptions,
        typeof tenantOptionsDark,
      ])

  return (
    <HostThemeProvider
      theme={hostTheme}
      fallback={fallback}
      baseOptions={baseOptions}
      initialMode={initialThemeMode}
      initialDeviceMode={initialDeviceMode}
    >
      <HostBrandProvider
        brandLogoUrl={brandLogoUrl}
        brandName={brandName}
        siteLinks={siteLinks}
        hostKey={hostKey}
        siteTitle={siteTitle}
        titleSeparator={titleSeparator}
      >
        <LoadingLayoutAppComponent
          brandLogoUrl={brandLogoUrl}
          brandName={brandName}
        >
          {children}
        </LoadingLayoutAppComponent>
      </HostBrandProvider>
    </HostThemeProvider>
  )
}
