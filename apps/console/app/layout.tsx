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

import { APP_CONSOLE } from '@aglyn/shared-data-enums'
// Deep import (not the barrel) so this Server Component doesn't pull the theme
// lib's createContext HOCs into the RSC graph (AGL-405).
import { APP_EMOTION_CACHE_OPTIONS } from '@aglyn/shared-ui-theme/util/emotion-cache'
import { AppRouterCacheProvider } from '@mui/material-nextjs/v16-appRouter'
import type { Metadata, Viewport } from 'next'
import type { ReactNode } from 'react'
import Providers from './providers'
import '../public/_static/styles/styles.css'

/**
 * App Router root layout for the console (migrated from pages/_app +
 * _document). Owns the document shell and emotion/MUI SSR via
 * `AppRouterCacheProvider` (replacing the Pages Router
 * `_EmotionDocumentComponent`); the global client provider stack lives in
 * `./providers`.
 *
 * The cache options are named rather than defaulted, and shared with the
 * tenant's root layout (AGL-1266) — the canvas renders tenant node trees
 * inside this app, so the two surfaces have to agree on the emotion key or a
 * component styled here and shipped there changes class prefix between them.
 */
const SOCIAL_CARD = '/_static/images/social/aglyn-console-social-card.png'

// The console is an installable PWA. The manifest and its icons are plain
// static files under `/_static`, which middleware excludes from the auth
// matcher so the browser can fetch them pre-login (AGL-1052).
const PWA_MANIFEST = '/_static/_pwa/manifest.json'
const BRAND_ICONS = '/_static/images/brand'

// The installable app icon, distinct from the transparent favicon glyph. This
// is the brand drive's light/solid variant: an opaque white plate that bleeds
// to the edges, which is what a maskable icon requires — the platform supplies
// its own mask, so the artwork must not be pre-inset.
const APP_ICONS = '/_static/images/brand/app-icon'

// Resolves the relative og:image above to an absolute URL for crawlers. The
// console apex is `app.aglyn.com` (see middleware); override via env per deploy.
const SITE_URL = process.env.NEXT_PUBLIC_CONSOLE_URL ?? 'https://app.aglyn.com'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  // Every page supplies a bare segment ("Billing", "Screens · acme") from a
  // server layout beside its route, and this template affixes the brand
  // (AGL-1059). Before that, pages titled themselves through `NextPageTitle`
  // → `next/head`, which the App Router ignores — so every route in the
  // console rendered the default below.
  // Separator and affix are the pre-AGL-1059 pair on purpose: a middle dot
  // and the bare brand, not `APP_CONSOLE.SEP`/`AFFIX` ('–' / 'Aglyn Platform
  // Console'). Those read as a marketing string in a browser tab, and the
  // tab is where a console user distinguishes between several open pages.
  title: { default: APP_CONSOLE.TITLE ?? 'Aglyn', template: '%s · Aglyn' },
  description: APP_CONSOLE.DESCRIPTION,
  manifest: PWA_MANIFEST,
  applicationName: 'Aglyn Console',
  icons: {
    icon: [
      { url: `${BRAND_ICONS}/icon-32x32.png`, sizes: '32x32', type: 'image/png' },
      { url: `${BRAND_ICONS}/icon-256x256.png`, sizes: '256x256', type: 'image/png' },
      { url: `${BRAND_ICONS}/icon-24x24.svg`, type: 'image/svg+xml' },
    ],
    // iOS applies its own rounded mask and composites transparency against
    // black, so the home-screen icon must be the opaque plate — never the
    // transparent glyph used for the favicon above.
    apple: [{ url: `${APP_ICONS}/light-solid-180.png`, sizes: '180x180', type: 'image/png' }],
  },
  appleWebApp: {
    capable: true,
    title: 'Aglyn',
    statusBarStyle: 'default',
  },
  openGraph: {
    title: APP_CONSOLE.TITLE,
    description: APP_CONSOLE.DESCRIPTION,
    siteName: 'Aglyn',
    type: 'website',
    images: [
      {
        url: SOCIAL_CARD,
        width: 1200,
        height: 630,
        alt: 'Aglyn Console',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: APP_CONSOLE.TITLE,
    description: APP_CONSOLE.DESCRIPTION,
    images: [SOCIAL_CARD],
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Matches `theme_color` in the manifest; without it the installed window
  // renders its title bar in the browser default rather than Aglyn's slate.
  themeColor: '#404c5c',
}

// The console is a fully client-rendered authoring app (firebase/reactfire/
// mobx behind an auth gate); nothing is statically prerenderable, so opt the
// whole App Router tree out of static generation (AGL-401).
import ServiceWorkerRegistrar from '../components/service-worker-registrar.component'
import ErrorBeacon from '../components/error-beacon.component'
import WebVitalsReporter from '../components/web-vitals-reporter.component'

export const dynamic = 'force-dynamic'

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppRouterCacheProvider options={APP_EMOTION_CACHE_OPTIONS}>
          <Providers>
            {children}
            {/* Registers /sw.js in production only, and offers its updates
                (AGL-1053/AGL-1055). Renders nothing.

                INSIDE Providers, which it was not at first: it needs the
                snackbar to offer the reload, and `useSnackbar()` outside its
                provider returns null — every render of the app then threw on
                destructuring it. Caught by loading a production build, not by
                the unit tests, which mocked `useSnackbar` and so mocked away
                the exact thing that was broken.

                The original reason for keeping it outside — "so it still runs
                on the sign-in page" — was simply wrong. `Providers` wraps
                every route, sign-in included. */}
            <ServiceWorkerRegistrar />
            {/* First-party error beacon (AGL-1538): uncaught browser errors
                → /api/errors → Cloud Error Reporting. Module-scope install,
                null render — see the component. */}
            <ErrorBeacon />
            {/* Real-user Core Web Vitals → GA4 (AGL-1642). Same shape as the
                beacon above: module-scope install, null render, outside every
                page boundary so a wedged page still measures. */}
            <WebVitalsReporter />
          </Providers>
        </AppRouterCacheProvider>
      </body>
    </html>
  )
}
