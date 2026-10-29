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

import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import {
  type SitePreviewViewer,
  verifySitePreviewViewer,
} from '@aglyn/tenant-data-admin/server/site-view-authz'
import { cookies } from 'next/headers'
import { cache } from 'react'

/**
 * The tenant's wiring of the preview check (AGL-4086): this request's cookies,
 * this app's Firestore, and the shared verifier that decides.
 *
 * Callable ONLY from a dynamic render — the uncached preview route, the site
 * search page, an api route. Reading `cookies()` under the ISR catch-all would
 * opt every customer page out of static rendering, which is the AGL-1152
 * regression the catch-all is written around; the catch-all never asks.
 *
 * `cache()`d per request, so `generateMetadata` and the page body ask once.
 */
export const sitePreviewViewer = cache(
  async (hostId: string): Promise<SitePreviewViewer> => {
    const jar = await cookies()
    const cookieHeader = jar
      .getAll()
      .map((entry) => `${entry.name}=${entry.value}`)
      .join('; ')
    return verifySitePreviewViewer({
      firestore: firebaseAdmin.app().firestore(),
      hostId,
      cookieHeader,
    })
  },
)

/** The same check for a route handler, which holds the request itself. */
export function sitePreviewViewerForRequest(
  request: Request,
  hostId: string,
): Promise<SitePreviewViewer> {
  return verifySitePreviewViewer({
    firestore: firebaseAdmin.app().firestore(),
    hostId,
    cookieHeader: request.headers.get('cookie'),
  })
}
