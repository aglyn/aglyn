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

import { PLATFORM_DEFAULT_LOCALE } from '@aglyn/aglyn/app-utils/seo-locale'
import StatusScreenPlain from '@aglyn/shared-ui-jsx/components/status-screen-plain.component'
import type { Metadata } from 'next'
import { NOT_FOUND_PAGE_NAME } from '../utils/not-found-title'
import DocumentShell from '../components/document-shell.component'

/**
 * Root not-found boundary (AGL-2074).
 *
 * Almost every tenant request is rewritten into `[host]/…` by the middleware
 * and lands on the branded `[host]/[scheme]/not-found.tsx` instead — this catches the
 * remainder: a path the middleware matcher excluded that matches no route,
 * and a `notFound()` thrown before any host segment is entered.
 *
 * Deliberately the PLAIN screen. There is no resolved host at this level, so
 * there is no theme, no logo and no name to render, and inventing one is the
 * white-label defect described in `site-status-screen.component.tsx`. Being
 * unstyled by our theme is fine; being branded as somebody else is not.
 *
 * It renders the document shell ITSELF (AGL-3153). The shell moved down to
 * `[host]/layout.tsx` so `<html lang>` could be the site's own language, and
 * this boundary is the case where there is no site — so it carries its own
 * shell in the PLATFORM DEFAULT language, by the same reasoning that keeps the
 * screen plain. This is also the app's `/_not-found` page, the one Next
 * prerenders to `404.html`, and a shell rendered from a path parameter keeps
 * that prerender: a `headers()` read in the root layout took it out of the
 * prerender manifest entirely.
 */

/**
 * The document's title (AGL-2648). This boundary is also the app's
 * `/_not-found` page — the one Next prerenders to `404.html` and serves for a
 * URL that matches no route at all — and that document had no `<title>`. The
 * same white-label rule as the body: the page's name and nothing else, because
 * at this level there is no site to name and no operator to admit to.
 */
export const metadata: Metadata = { title: NOT_FOUND_PAGE_NAME }

export default function RootNotFound() {
  return (
    <DocumentShell lang={PLATFORM_DEFAULT_LOCALE}>
      <StatusScreenPlain
        code="404"
        title={'We can’t find that page'}
        message={
          'The link may be out of date, or the page may have been moved or ' +
          'removed.'
        }
      />
    </DocumentShell>
  )
}
