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
import getTemplateScreenIds from '@aglyn/tenant-runtime/template-screens'
import getHost from './get-host'

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
  /**
   * The URL path the router serves this screen at, composed — `/company/about`
   * rather than the `about` in `slug`. Read straight off the routing map,
   * which is the same string {@link Aglyn.screenRoutePathToUrl} hands the sitemap,
   * so a caller never has to rebuild it from `slug` and `parentId`.
   */
  path?: string
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

function toPublicScreen(
  id: string,
  doc: Record<string, unknown>,
  path: string,
): PublicScreen {
  const seo = (doc.seo ?? undefined) as Record<string, unknown> | undefined
  return {
    $id: id,
    path,
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
 * The most screen documents one call will scan to decide what is listable.
 * Matches the sitemap's own cap, because the two read the same set for the
 * same reason and a site that outgrew one has outgrown both.
 */
const SCREEN_SCAN_MAX = 1000

/**
 * Published pages for a site, one page of them at a time.
 *
 * ## What "published" means here, and why it moved (AGL-2719)
 *
 * The published set is `host.screens` — the routing map that decides what the
 * router will actually serve — filtered by the same three exclusions
 * `/sitemap.xml` applies. The two surfaces agreeing is the point rather than a
 * convenience: a page listed here but withheld from the sitemap is a site
 * advertising to agents a URL it hid from crawlers.
 *
 * It used to be `where('status', '==', PUBLISHED)` against the screens
 * collection, and it returned NOTHING, for every site on the platform. Two
 * independent faults, either fatal on its own:
 *
 * 1. The `host` this receives is the name the caller addressed — `acme.com`,
 *    or the `Host:` header — and it went straight into `.doc(host)`. Host
 *    documents are keyed by uid, so the query addressed a document that does
 *    not exist. Resolving through {@link getHost} is what the rest of the
 *    runtime already does with that value.
 * 2. Nothing writes `status`. Measured against production: 69 screen
 *    documents, `status` undefined on all 69. `HostScreenStatus` is also a
 *    BITFIELD — `SCHEDULED_TO_UPDATE_PUBLISHED` is `PUBLISHED | 32` — so an
 *    `==` against `PUBLISHED` would miss a scheduled-update page even once
 *    something did start writing the field.
 *
 * ⚠️ Neither fault was visible from the test suite, and that is the durable
 * lesson: the suite answered out of a fixture that stamped
 * `status: PUBLISHED` on every screen and resolved every `.doc()` to the same
 * collection. A mock cannot see a `where` clause that matches nothing in
 * reality, nor a document id that addresses nothing. The spec beside this file
 * now asserts the shapes production actually holds — a screen with NO `status`
 * field at all, and a host addressed by hostname.
 *
 * ## An unresolvable host is an ERROR, not an empty page
 *
 * Returning `{ screens: [] }` for a site that does not exist is what let this
 * hide: "no pages" and "no such site" read identically to every caller,
 * including the ones that were supposed to notice. They are different answers
 * and they are now said differently.
 *
 * ## The cursor
 *
 * The routing map is a field on the host document, so there is nothing to page
 * AT the query — the whole set is in hand and a page is a slice of it, ordered
 * by screen id. `nextPageToken` keeps its meaning, the last id of the page
 * just served, so a caller holding a token from before this change keeps
 * working.
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

  const limit = Math.min(
    Math.max(1, Math.trunc(Number(pageSize)) || SCREEN_PAGE_SIZE_DEFAULT),
    SCREEN_PAGE_SIZE_MAX,
  )

  try {
    const resolved = await getHost({ host })
    const hostDoc = resolved?.host
    if (!hostDoc?.$id) {
      /*
        404, not the 500 an undecorated Error becomes (AGL-2724).
        `appHandleJsonError` reads `code || statusCode` off the error and
        falls back to 500, and a 500 tells a caller the server is broken and
        the request is worth retrying. Neither is true here: the request was
        well-formed and the answer will not change on a retry. An agent
        walking a list of domains has to be able to tell "this one is not
        ours" from "come back later", and only the status carries that.
      */
      const missing = Object.assign(
        new Error(`No site is published at ${host}`),
        { statusCode: 404 },
      )
      data.error = missing
      return data
    }

    const routes = (hostDoc.screens ?? {}) as Record<string, string | undefined>

    /*
      Started before the screens read and awaited after it, so the two overlap
      rather than costing a round trip each — the same shape `/sitemap.xml`
      uses for the same pair of reads.
    */
    const templateScreenIdsPromise = getTemplateScreenIds({
      hostId: hostDoc.$id,
    })

    const screenDocs = await firebaseAdmin
      .app()
      .firestore()
      .collection('hosts')
      .doc(hostDoc.$id)
      .collection('screens')
      .select(...PUBLIC_SCREEN_PROJECTION)
      .limit(SCREEN_SCAN_MAX)
      .get()

    const documents = new Map<string, Record<string, unknown>>()
    for (const snapshot of screenDocs.docs) {
      documents.set(snapshot.id, (snapshot.data() ?? {}) as Record<string, unknown>)
    }

    /*
      Excluded for the three reasons the sitemap excludes them: a gated page
      answers an agent with a password prompt rather than the page, a template
      is not a page at all (the router refuses to serve one), and an error
      screen is a status, not a destination.
    */
    const excluded = new Set<string>(await templateScreenIdsPromise)
    for (const screenId of Aglyn.statusPageScreenIds(hostDoc as never)) {
      excluded.add(screenId)
    }

    const listable = Object.entries(routes)
      .filter(([screenId, path]) => {
        if (typeof path !== 'string' || excluded.has(screenId)) return false
        const doc = documents.get(screenId)
        /*
          A screen in the routing map with no document behind it is a routing
          entry the publish left dangling. It is not listable — the router has
          nothing to render — and it is not an error either.
        */
        if (!doc) return false
        return Aglyn.isScreenIndexable(doc as Aglyn.SearchIndexingScreen)
      })
      .map(([screenId, path]) => [screenId, path as string] as const)
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))

    const cursor = String(nextPageToken ?? '').trim()
    const start = cursor
      ? listable.findIndex(([screenId]) => screenId > cursor)
      : 0
    const from = start === -1 ? listable.length : start
    const page = listable.slice(from, from + limit)

    for (const [screenId, path] of page) {
      data.screens.push(
        toPublicScreen(
          screenId,
          documents.get(screenId) as Record<string, unknown>,
          Aglyn.screenRoutePathToUrl(path),
        ),
      )
    }

    /*
      Exhausted when the slice reached the end of the set. Unlike the old query
      this can be answered exactly, because the whole set was in hand — so a
      caller is never handed a token that returns nothing.
    */
    const last = page[page.length - 1]
    data.nextPageToken = from + page.length < listable.length && last ? last[0] : ''
  } catch (error) {
    console.error(error)
    data.error = error as Error
  }

  return data
}

export default getAllScreens
