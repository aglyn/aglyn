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
 */
const SOCIAL_CARD = '/_static/images/social/aglyn-console-social-card.png'

// The console is an installable PWA. The manifest and its icons are plain
// static files under `/_static`, which middleware excludes from the auth
// matcher so the browser can fetch them pre-login (AGL-1052).
const PWA_MANIFEST = '/_static/_pwa/manifest.json'
const BRAND_ICONS = '/_static/images/brand'

// Resolves the relative og:image above to an absolute URL for crawlers. The
// console apex is `app.aglyn.com` (see middleware); override via env per deploy.
const SITE_URL = process.env.NEXT_PUBLIC_CONSOLE_URL ?? 'https://app.aglyn.com'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
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
    apple: [{ url: `${BRAND_ICONS}/icon-180x180.png`, sizes: '180x180', type: 'image/png' }],
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
export const dynamic = 'force-dynamic'

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppRouterCacheProvider options={{ enableCssLayer: true }}>
          <Providers>{children}</Providers>
        </AppRouterCacheProvider>
      </body>
    </html>
  )
}
