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
  brandLogoUrl,
  brandName,
  siteLinks,
  children,
}: {
  hostTheme?: HostTheme
  brandLogoUrl?: string
  brandName?: string
  siteLinks?: SiteNavLink[]
  children: ReactNode
}) {
  return (
    <HostThemeProvider
      theme={hostTheme}
      fallback={[consoleThemeLight, consoleThemeDark]}
      // The same brand theme as `fallback`, in options form, so a host that
      // customizes one value keeps the brand for the rest (AGL-1180).
      baseOptions={[consoleOptions, consoleOptionsDark]}
    >
      <HostBrandProvider
        brandLogoUrl={brandLogoUrl}
        brandName={brandName}
        siteLinks={siteLinks}
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
