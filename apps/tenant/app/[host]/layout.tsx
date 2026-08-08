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

// Deep import (not the barrel) so this Server Component doesn't pull the
// theme lib's createContext HOCs into the RSC graph (AGL-405).
import { resolveSiteTheme } from '@aglyn/aglyn/app-utils/marketplace-theme'
import { getGoogleFontsUrl } from '@aglyn/shared-ui-theme/util/host-theme'
import type { ReactNode } from 'react'
import AdminBarSlot from './admin-bar/admin-bar-slot'
import { getHostCached } from './host-data'
import { HostThemeProviders } from './host-theme-providers'

/**
 * Per-host layout (App Router): resolves the tenant host to apply its MUI
 * theme and preload its Google Fonts. This is the App Router home for the
 * per-host theming the Pages Router `_app` did from `pageProps.data.host` —
 * it depends on the resolved host, so it lives under `[host]` rather than
 * the host-agnostic root layout. Wraps both the catch-all render route and
 * the search route.
 */
export default async function HostLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ host: string }>
}) {
  const { host } = await params
  const hostRes = await getHostCached(host)
  // default ⊕ marketplace theme ⊕ site overrides (AGL-1021). The default is
  // applied below by HostThemeProvider; these are the upper two layers.
  const hostTheme = resolveSiteTheme(hostRes.host)
  const fontsHref = getGoogleFontsUrl(hostTheme?.fonts)
  return (
    <HostThemeProviders
      hostTheme={hostTheme}
      brandLogoUrl={hostRes.host?.logoUrl}
      brandName={hostRes.host?.displayName}
    >
      {/* Per-host manifest (AGL-1252). A relative href on purpose: the
          browser resolves it against the site's own origin, so one link tag
          serves every customer domain and every aglyn.app subdomain without
          the layout needing to know which it is on. */}
      <link rel="manifest" href="/manifest.webmanifest" />
      {fontsHref ? (
        <>
          <link
            rel="preconnect"
            href="https://fonts.gstatic.com"
            crossOrigin="anonymous"
          />
          <link rel="stylesheet" href={fontsHref} />
        </>
      ) : null}
      {children}
      {/* Edit-access admin bar (AGL-1302 follow-on) — renders nothing unless
          release_edit_bar is on; anonymous visitors get no output at all. */}
      <AdminBarSlot host={host} />
    </HostThemeProviders>
  )
}
