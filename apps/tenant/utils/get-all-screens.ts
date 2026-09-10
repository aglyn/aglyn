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
    /** `og:image:alt` (AGL-2417): carried with the reference, never apart. */
    imageAlt?: string
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
          imageAlt: seo.imageAlt as string | undefined,
        }
      : undefined,
  }
}

/** Pages per response when the caller names no `limit`. */
export const SCREEN_PAGE_SIZE_DEFAULT = 50

/** The most a caller may ask for in one response. */
export const SCREEN_PAGE_SIZE_MAX = 100

/**
 * Published pages for a site, one page of them at a time.
 *
 * ## The cursor is real now (AGL-2716)
 *
 * `nextPageToken` was accepted by the route, threaded into this function, and
 * READ BY NOTHING: the query was a bare `.limit(5)` and the returned token was
 * always `''`. So the endpoint published the first five pages of a site and
 * offered no way to reach the sixth — which made it undescribable in
 * `/openapi.json`, because the honest description was "returns some of your
 * pages, and there is no way to ask for the rest".
 *
 * ⚠️ `orderBy` IS LOAD-BEARING, not tidiness. `limit()` without an explicit
 * order returns an arbitrary slice, and a cursor into an arbitrary order is a
 * cursor into a different set on every call — pages would repeat and pages
 * would be missed. `__name__` is the document id: total, stable, and served by
 * Firestore's automatic single-field index alongside the `status` equality, so
 * this needs no composite index to be deployed with it.
 *
 * ## The cursor is the last document READ, not the last one RETURNED
 *
 * `isScreenIndexable` filters in memory, after the query, because visibility
 * cannot be expressed as a filter beside the status equality without a second
 * index and a second refusal to keep in step. So a page of 50 documents can
 * return fewer than 50 screens — and if the cursor were built from the last
 * RETURNED screen, every gated page at the end of a slice would be re-read on
 * the next request, or worse, everything after it skipped.
 */
export async function getAllScreens(
  host: Aglyn.HostUid,
  nextPageToken?: string,
  pageSize?: number,
) {
  const data: {
    screens: PublicScreen[]
    nextPageToken: string
    error: Error | null
  } = { screens: [], nextPageToken: '', error: null }
  const firestore = firebaseAdmin.app().firestore()

  const limit = Math.min(
    Math.max(1, Math.trunc(Number(pageSize)) || SCREEN_PAGE_SIZE_DEFAULT),
    SCREEN_PAGE_SIZE_MAX,
  )

  let query = firestore
    .collection('hosts')
    .doc(host)
    .collection('screens')
    .where('status', '==', Aglyn.HostScreenStatus.PUBLISHED)
    .orderBy('__name__')
    .select(...PUBLIC_SCREEN_PROJECTION)
    .limit(limit)

  /*
    The token IS the last document id. A document id is already public — it is
    the `$id` of every screen in the response — so there is nothing to sign or
    obscure, and an opaque encoding would only mean a caller cannot tell a
    truncated token from an exhausted listing.
  */
  const cursor = String(nextPageToken ?? '').trim()
  if (cursor) query = query.startAfter(cursor)

  await query
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
      /*
        A SHORT page is the end of the listing, and that is the only signal
        there is: asking for one more document to find out would bill a read
        per page for a fact the page count already implies. A full page whose
        successor turns out to be empty costs the caller one extra request that
        answers with no screens and an empty token — which is a correct answer,
        just not the shortest possible conversation.
      */
      const last = screens.docs[screens.docs.length - 1]
      data.nextPageToken = screens.size === limit && last ? last.id : ''
    })
    .catch((error) => {
      console.error(error)
      data.error = error
    })

  return data
}
export default getAllScreens
