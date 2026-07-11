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

import { getGoogleFontsUrl } from '@aglyn/shared-ui-theme'
import type { ReactNode } from 'react'
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
  const hostTheme = hostRes.host?.theme
  const fontsHref = getGoogleFontsUrl(hostTheme?.fonts)
  return (
    <HostThemeProviders hostTheme={hostTheme}>
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
    </HostThemeProviders>
  )
}
