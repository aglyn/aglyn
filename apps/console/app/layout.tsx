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
export const metadata: Metadata = {
  title: { default: APP_CONSOLE.TITLE ?? 'Aglyn', template: '%s · Aglyn' },
  description: APP_CONSOLE.DESCRIPTION,
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

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
