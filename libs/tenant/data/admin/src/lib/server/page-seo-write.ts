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

import { createResourceUid } from '@aglyn/aglyn/app-utils/create-resource-uid'
import { screenClaimsToBeAPage, screenRoutePathToUrl } from '@aglyn/aglyn/app-utils/screen-route'
import { SEO_DESCRIPTION_MAX_LENGTH, SEO_TITLE_MAX_LENGTH } from '@aglyn/aglyn/app-utils/screen-seo-fields'
import { buildScreenSeoUpdate, type ScreenSeoEdits } from '@aglyn/aglyn/app-utils/screen-seo-update'
import { SEO_BREADCRUMB_MAX_LENGTH } from '@aglyn/aglyn/app-utils/seo-listing-fields'
import { dropPluginSiteCache } from '@aglyn/aglyn/plugin-manager/plugin-site-cache'
import { FieldValue, type Firestore } from 'firebase-admin/firestore'
import { sameSiteSetting } from './site-settings-write'

/**
 * A PAGE'S SEARCH LISTING SAVED ON THE SERVER (AGL-4235).
 *
 * A page's search title, description and breadcrumb label live on the page
 * document, `hosts/{hostId}/screens/{screenId}.seo` — not on a version or a
 * draft — so a save is live the moment it lands for a page that is
 * published. The console's two SEO panels save it from the browser through
 * `buildScreenSeoUpdate` and then announce the page (`announceLiveScreenChange`):
 * the live page's head is rendered from this document and held behind the
 * tenant's caches until something drops them. This is that save on the
 * server, with the same rules and the same announce:
 *
 * - One transaction reads the page and the site's routing map as stored now,
 *   refuses a page that is gone or is not a page of the site, and writes the
 *   rebuilt `seo` map, or deletes the field when nothing is left in it.
 * - A page with a public address has its cached copy dropped, by that address
 *   only — as the console's announce does — with a publish outbox entry
 *   naming it in the same transaction, so the drop is written down for the
 *   drain whether or not this process lives to send it. A page with no
 *   address has no cached copy anywhere, and announces nothing.
 */

/**
 * Every member a page search listing write may carry, and its limit. Over the
 * API the title and description limits are HARD: the console's editors show
 * them as guidance and publish a longer value, but a program writing a
 * listing is held to what a search result shows.
 */
export const PAGE_SEO_LIMITS = {
  title: SEO_TITLE_MAX_LENGTH,
  description: SEO_DESCRIPTION_MAX_LENGTH,
  breadcrumb: SEO_BREADCRUMB_MAX_LENGTH,
} as const

export type PageSeoMember = keyof typeof PAGE_SEO_LIMITS

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/**
 * Reads and checks a page search listing write body into the edits
 * `buildScreenSeoUpdate` takes: a member left out is untouched, and `''` or
 * `null` empties it. Limits are checked on the trimmed value, which is what
 * is stored.
 */
export function readPageSeoPatch(body: unknown): { edits: ScreenSeoEdits } | { errors: Record<string, string> } {
  if (!isObject(body)) return { errors: { body: 'Must be a JSON object' } }
  const errors: Record<string, string> = {}
  const edits: ScreenSeoEdits = {}
  for (const key of Object.keys(body)) {
    if (!(key in PAGE_SEO_LIMITS)) errors[key] = 'Not writable on a page’s search listing'
  }
  for (const [member, limit] of Object.entries(PAGE_SEO_LIMITS) as Array<[PageSeoMember, number]>) {
    const value = body[member]
    if (value === undefined) continue
    if (value !== null && typeof value !== 'string') {
      errors[member] = 'Must be a string, or null to clear it'
      continue
    }
    const text = typeof value === 'string' ? value.trim() : ''
    if (text.length > limit) {
      errors[member] = `Must be ${limit} characters or fewer`
      continue
    }
    edits[member] = text
  }
  return Object.keys(errors).length ? { errors } : { edits }
}

export type PageSeoWrite =
  | { ok: false; missing: true }
  | {
      ok: true
      /** The page document as it reads now, the write applied. */
      page: Record<string, unknown>
      /** The page's entry in the site's routing map, or `null` when it has none. */
      routePath: string | null
      /** Whether the stored `seo` changed. */
      changed: boolean
      /** The outbox entry the drop is written down in, when one was owed. */
      outboxId: string | null
    }

/** Whether a page document is one the API lists and saves: a page of the site, not deleted. */
export function isApiV1Page(page: Record<string, unknown> | null | undefined): boolean {
  return screenClaimsToBeAPage(page as never)
}

/** The page's entry in a routing map, or `null`. */
export function pageRoutePath(routingMap: unknown, pageId: string): string | null {
  const path = (routingMap as Record<string, unknown> | null | undefined)?.[pageId]
  return typeof path === 'string' ? path : null
}

/**
 * Saves a page's search listing: `edits` over the stored `seo` map, by
 * {@link buildScreenSeoUpdate}'s rules. Nothing differing writes nothing.
 */
export async function writePageSeo(
  firestore: Firestore,
  input: { hostId: string; pageId: string; edits: ScreenSeoEdits; now: Date },
): Promise<PageSeoWrite> {
  const hostRef = firestore.collection('hosts').doc(input.hostId)
  const pageRef = hostRef.collection('screens').doc(input.pageId)
  return firestore.runTransaction(async (tx): Promise<PageSeoWrite> => {
    const [host, page] = await Promise.all([tx.get(hostRef), tx.get(pageRef)])
    const stored = (page.data() ?? undefined) as Record<string, unknown> | undefined
    if (!page.exists || !stored || !isApiV1Page(stored)) return { ok: false, missing: true }
    const routePath = pageRoutePath(host.get('screens'), input.pageId)
    const existing = stored['seo'] && typeof stored['seo'] === 'object' ? (stored['seo'] as Record<string, unknown>) : null
    const seo = buildScreenSeoUpdate(existing, input.edits)
    if (sameSiteSetting(seo, existing)) {
      return { ok: true, page: stored, routePath, changed: false, outboxId: null }
    }
    tx.update(pageRef, { seo: seo ?? FieldValue.delete(), updatedAt: input.now })
    let outboxId: string | null = null
    if (routePath !== null) {
      const outboxRef = firestore.collection('publishOutbox').doc(createResourceUid())
      tx.set(outboxRef, {
        hostId: input.hostId,
        paths: [screenRoutePathToUrl(routePath)],
        createdAt: FieldValue.serverTimestamp(),
        attempts: 0,
      })
      outboxId = outboxRef.id
    }
    const next: Record<string, unknown> = { ...stored, updatedAt: input.now }
    if (seo) next['seo'] = seo
    else delete next['seo']
    return { ok: true, page: next, routePath, changed: true, outboxId }
  })
}

/**
 * Drops the cached copy of the one page a search listing save changed, and
 * releases its outbox entry only when the drop certainly happened. Never
 * throws: the save has landed, and an entry left behind is the drain's.
 */
export async function settlePageSeoCache(
  firestore: Firestore,
  input: { hostId: string; routePath: string; outboxId: string },
  deps: { dropCache?: typeof dropPluginSiteCache } = {},
): Promise<boolean> {
  const dropCache = deps.dropCache ?? dropPluginSiteCache
  const dropped = await dropCache({
    hostIds: [input.hostId],
    reason: 'API changed a page’s search listing',
    paths: { [input.hostId]: [screenRoutePathToUrl(input.routePath)] },
  }).catch(() => ({ complete: false }))
  if (!dropped.complete) return false
  await firestore
    .collection('publishOutbox')
    .doc(input.outboxId)
    .delete()
    .catch(() => undefined)
  return true
}
