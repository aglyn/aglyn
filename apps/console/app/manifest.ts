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
 * The console's PWA manifest (AGL-2153).
 *
 * Was `public/_static/_pwa/manifest.json`, a static file carrying the literals
 * "Aglyn Console", "Aglyn" and "Build, manage and publish your Aglyn sites."
 * A static JSON cannot read configuration, so a self-host operator's installed
 * app was titled *Aglyn* on their users\' home screens and there was no way to
 * change it short of editing a file in the repository — precisely the thing
 * the self-host mandate says must not be necessary.
 *
 * Next serves this at `/manifest.webmanifest`. That path sits INSIDE the
 * console middleware\'s matcher, unlike `/_static`, so it is added to the
 * matcher\'s exclusion list — the browser fetches a manifest before the user
 * has signed in, and an auth redirect there makes the app uninstallable from
 * the sign-in page (the same reason `_static` is excluded, AGL-1052).
 *
 * The ICONS stay static files. An operator reskins them by replacing the PNGs
 * in their Docker build context, which is how you skin an image; an env var
 * cannot carry a 512px maskable icon and pretending otherwise would be worse
 * than saying so.
 */

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/server'
import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: `${PLATFORM_BRAND_NAME} Console`,
    short_name: PLATFORM_BRAND_NAME,
    description: `Build, manage and publish your ${PLATFORM_BRAND_NAME} sites.`,
    display: 'standalone',
    start_url: '/',
    scope: '/',
    // Matches `viewport.themeColor` in app/layout.tsx; the two must agree or
    // the installed window\'s title bar differs from the page it frames.
    theme_color: '#404c5c',
    background_color: '#ffffff',
    icons: [
      {
        src: '/_static/images/brand/app-icon/light-solid-16.png',
        sizes: '16x16',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/_static/images/brand/app-icon/light-solid-32.png',
        sizes: '32x32',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/_static/images/brand/app-icon/light-solid-64.png',
        sizes: '64x64',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/_static/images/brand/app-icon/light-solid-128.png',
        sizes: '128x128',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/_static/images/brand/app-icon/light-solid-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/_static/images/brand/app-icon/light-solid-256.png',
        sizes: '256x256',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/_static/images/brand/app-icon/light-solid-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/_static/images/brand/app-icon/light-solid-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/_static/images/brand/app-icon/light-solid-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  }
}
