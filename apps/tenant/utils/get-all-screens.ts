/**
 * @license
 * Copyright 2022 Aglyn LLC
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

import * as Aglyn from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'

/**
 * The read behind `GET /api/screen?host=` — a site's published pages, served
 * to ANONYMOUS callers on the tenant origin (`/api` is outside the middleware
 * matcher, so nothing upstream gates it).
 *
 * ## Why this is a projection and not a filter (AGL-2191)
 *
 * It used to push `screen.data()` — the WHOLE document — into the response.
 * `AglynScreen` carries `protection.passwordHash`, the unsalted sha256 hex of
 * the visitor password for a password-protected page (AGL-87), and a
 * password-protected page is PUBLISHED, so it was exactly the kind of document
 * this query returned. Any anonymous caller could read the hash that gates the
 * page and crack it offline — no `/api/protection/unlock` round trip, so the
 * durable 10-per-minute brute-force budget (AGL-794) never applied.
 *
 * The fix is an allow-list in TWO places, deliberately:
 *
 *  1. `PUBLIC_SCREEN_PROJECTION` — a Firestore `select()` mask, so the hash is
 *     never fetched at all. The same shape `/api/sitemap` and `get-site-nav`
 *     use for their sweeps, and it costs less to read as well.
 *  2. `toPublicScreen` — an explicit field-by-field copy of the result.
 *
 * Either alone would work today. Both is what makes a NEW sensitive field on
 * `AglynScreen` safe by default: a denylist ("delete `protection`") is one
 * field away from leaking again, and the next field will be added by somebody
 * who has never read this file. Note that `seo` is projected as a whole map
 * but copied key by key, for the same reason one level down.
 *
 * `visibility` is read but never returned. It is here to DECIDE: gated screens
 * (`PRIVATE`, `PASSWORD`, `AUTHENTICATED`, `AUTHORIZED`, and `UNLISTED`) are
 * dropped from the listing entirely, via the same `isScreenIndexable` predicate
 * `/api/sitemap` uses — an anonymous listing should not advertise the titles
 * and paths of pages a visitor is not allowed to open. That also means a
 * protected screen never reaches the response in any form, which is belt and
 * braces on top of the projection rather than a substitute for it.
 */
const PUBLIC_SCREEN_PROJECTION = [
  'slug',
  'parentId',
  'order',
  'displayName',
  'description',
  'locale',
  'publishedAt',
  'updatedAt',
  'seo',
  // Read to decide, never returned. See the note above.
  'visibility',
] as const

/** Exactly what `GET /api/screen` publishes about a page. */
export interface PublicScreen {
  $id: string
  slug?: string
  parentId?: string
  order?: number
  displayName?: string
  description?: string
  locale?: string
  publishedAt?: unknown
  updatedAt?: unknown
  seo?: {
    title?: string
    description?: string
    breadcrumb?: string
    image?: string
    imageWidth?: number
    imageHeight?: number
  }
}

function toPublicScreen(id: string, doc: Record<string, unknown>): PublicScreen {
  const seo = (doc.seo ?? undefined) as Record<string, unknown> | undefined
  return {
    $id: id,
    slug: doc.slug as string | undefined,
    parentId: doc.parentId as string | undefined,
    order: doc.order as number | undefined,
    displayName: doc.displayName as string | undefined,
    description: doc.description as string | undefined,
    locale: doc.locale as string | undefined,
    publishedAt: doc.publishedAt,
    updatedAt: doc.updatedAt,
    seo: seo
      ? {
          title: seo.title as string | undefined,
          description: seo.description as string | undefined,
          breadcrumb: seo.breadcrumb as string | undefined,
          image: seo.image as string | undefined,
          imageWidth: seo.imageWidth as number | undefined,
          imageHeight: seo.imageHeight as number | undefined,
        }
      : undefined,
  }
}

export async function getAllScreens(
  host: Aglyn.HostUid,
  nextPageToken?: string,
) {
  const data: {
    screens: PublicScreen[]
    nextPageToken: string
    error: Error | null
  } = { screens: [], nextPageToken: '', error: null }
  const firestore = firebaseAdmin.app().firestore()

  await firestore
    .collection('hosts')
    .doc(host)
    .collection('screens')
    .where('status', '==', Aglyn.HostScreenStatus.PUBLISHED)
    .select(...PUBLIC_SCREEN_PROJECTION)
    .limit(5)
    .get()
    .then((screens) => {
      screens.forEach((screen) => {
        const doc = (screen.data() ?? {}) as Record<string, unknown>
        if (
          !Aglyn.isScreenIndexable(doc as Aglyn.SearchIndexingScreen)
        ) {
          return
        }
        data.screens.push(toPublicScreen(screen.id, doc))
      })
    })
    .catch((error) => {
      console.error(error)
      data.error = error
    })

  return data
}
export default getAllScreens
