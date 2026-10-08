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

import { hostCollectionKind } from '@aglyn/aglyn/app-utils/collection-kind'
import {
  COLLECTIONS_MAX_PER_HOST,
  ENTRIES_MAX_PER_COLLECTION,
} from '@aglyn/aglyn/app-utils/collection-entries'
import { entryHasByline } from '@aglyn/aglyn/app-utils/content-authors'
import { entryTitleSearchFields } from '@aglyn/aglyn/app-utils/content-query-fields'
import { hostRoleCanPublish, hostRoleCanWrite } from '@aglyn/aglyn/app-utils/organizations'
import type { Firestore } from 'firebase-admin/firestore'

/**
 * A SITE'S POSTS WRITTEN ON A MEMBER'S BEHALF (AGL-3676).
 *
 * A blog is a core content collection — `hosts/{hostId}/collections/{id}`
 * with `kind: 'content'` and a slug the tenant serves its listing at — and
 * its posts are the collection's entries. The console makes both through two
 * routes: `/api/hosts/collections` claims the slug inside a transaction and
 * holds the per-site collection cap, and `/api/hosts/resources` creates an
 * entry from its allow-list, under the per-collection cap, born a DRAFT.
 *
 * A server job that writes a site's first posts (the guided start's) needs
 * the same writes without a browser's token, so they live here, in the lib
 * both runtimes already share, under the same rules:
 *
 *  - THE ROLE is the member's on the site: one who may write its content
 *    creates; one who may publish publishes. Refused in the routes' words.
 *  - THE SLUG of a collection is claimed per host and per kind in the
 *    transaction that creates it, and the collection cap is counted there.
 *  - AN ENTRY keeps only the fields the resources route's allow-list keeps,
 *    is counted against `ENTRIES_MAX_PER_COLLECTION`, and is stamped
 *    `status: 'draft'` with its title's search keys — never sent published.
 *  - PUBLISHING is a separate act, as it is in the console: it needs the
 *    publish role and a byline (`entryHasByline`), and sets `publishedAt`.
 *
 * Every write is idempotent on the id its caller chose: asked again, it
 * reports what it already wrote.
 */

/** The fields an entry keeps: the resources route's `entry` allow-list. */
export const CONTENT_ENTRY_DRAFT_FIELDS = [
  'title',
  'slug',
  'excerpt',
  'body',
  'coverImage',
  'coverImageAlt',
  'coverVideo',
  'coverVideoDuration',
  'seoTitle',
  'seoDescription',
  'authorName',
  'categoryId',
  'category',
  'tags',
  'authorId',
] as const

/** The routes' refusal for a member who may not write the site's content. */
export const CONTENT_DRAFT_ROLE_REFUSAL = 'Editing requires the editor role'
/** The refusal for a member who may not publish it. */
export const CONTENT_PUBLISH_ROLE_REFUSAL = 'Publishing requires the publisher role'
/** The collections route's refusal at the per-site cap. */
export const CONTENT_COLLECTIONS_FULL_REFUSAL =
  `This site holds the maximum of ${COLLECTIONS_MAX_PER_HOST} collections — delete one to make room`
/** The resources route's refusal at the per-collection cap. */
export const CONTENT_ENTRIES_FULL_REFUSAL =
  `A collection holds at most ${ENTRIES_MAX_PER_COLLECTION} entries — delete some to make room`

/** A collection slug the collections route accepts. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** The longest entry slug this writer mints from a title. */
export const CONTENT_ENTRY_SLUG_MAX = 80

/** A title as an entry slug: lowercase words joined by dashes. */
export function contentEntrySlug(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, CONTENT_ENTRY_SLUG_MAX)
    .replace(/-+$/g, '')
  return slug || 'post'
}

export type ContentDraftRefusal = { ok: false; status: 400 | 403 | 404 | 409; error: string }

export type ContentCollectionWrite =
  | { ok: true; id: string; slug: string; displayName: string; replayed: boolean }
  | ContentDraftRefusal

export type ContentEntryWrite =
  | { ok: true; id: string; slug: string; title: string; replayed: boolean }
  | ContentDraftRefusal

function roleOf(host: FirebaseFirestore.DocumentSnapshot, uid: string): unknown {
  return (host.get('memberRoles') ?? {})[uid]
}

/**
 * The site's content collection under `id`, created when it does not exist:
 * the first of `slugs` no other content collection of the site serves, under
 * the collection cap. Refused for a member who may not write the site, or
 * when every slug is taken.
 */
export async function writeContentCollection(
  firestore: Firestore,
  request: { hostId: string; uid: string; id: string; displayName: string; slugs: readonly string[]; now: Date },
): Promise<ContentCollectionWrite> {
  const slugs = [...new Set(request.slugs.map((slug) => slug.trim().toLowerCase()))].filter((slug) => SLUG.test(slug))
  if (!slugs.length) return { ok: false, status: 400, error: 'Slug must be lowercase letters, numbers, and dashes' }
  const hostRef = firestore.collection('hosts').doc(request.hostId)
  const collections = hostRef.collection('collections')
  const ref = collections.doc(request.id)
  return firestore.runTransaction(async (tx): Promise<ContentCollectionWrite> => {
    // Every read before the write, which Firestore requires.
    const [host, existing] = await Promise.all([tx.get(hostRef), tx.get(ref)])
    if (!host.exists) return { ok: false, status: 404, error: 'Unknown site' }
    if (existing.exists) {
      if (hostCollectionKind(existing.data()) !== 'content') {
        return { ok: false, status: 409, error: 'That collection belongs to a different part of the console' }
      }
      return {
        ok: true,
        replayed: true,
        id: existing.id,
        slug: String(existing.get('slug') ?? ''),
        displayName: String(existing.get('displayName') ?? ''),
      }
    }
    if (!hostRoleCanWrite(roleOf(host, request.uid))) return { ok: false, status: 403, error: CONTENT_DRAFT_ROLE_REFUSAL }
    const held = await tx.get(collections.where('slug', 'in', slugs.slice(0, 10)))
    const taken = new Set(
      held.docs.filter((doc) => hostCollectionKind(doc.data()) === 'content').map((doc) => String(doc.get('slug'))),
    )
    const slug = slugs.find((candidate) => !taken.has(candidate))
    if (!slug) return { ok: false, status: 409, error: `Another collection already serves /${slugs[0]}` }
    const count = (await tx.get(collections.count())).data().count
    if (count >= COLLECTIONS_MAX_PER_HOST) return { ok: false, status: 403, error: CONTENT_COLLECTIONS_FULL_REFUSAL }
    tx.create(ref, { displayName: request.displayName, slug, kind: 'content', createdAt: request.now })
    return { ok: true, replayed: false, id: request.id, slug, displayName: request.displayName }
  })
}

/**
 * One draft entry of a content collection under `id`: the allow-listed
 * fields of `content`, a slug no other entry of the collection holds (from
 * the title when none is given), `status: 'draft'`, its title's search keys
 * and its author. Never published here.
 */
export async function writeContentEntryDraft(
  firestore: Firestore,
  request: {
    hostId: string
    collectionId: string
    uid: string
    id: string
    content: Readonly<Record<string, unknown>>
    now: Date
  },
): Promise<ContentEntryWrite> {
  const title = typeof request.content['title'] === 'string' ? request.content['title'].trim() : ''
  if (!title) return { ok: false, status: 400, error: 'A post needs a title' }
  const fields: Record<string, unknown> = {}
  for (const key of CONTENT_ENTRY_DRAFT_FIELDS) {
    const value = request.content[key]
    if (value !== undefined && value !== null) fields[key] = value
  }
  fields['title'] = title
  const base = contentEntrySlug(typeof fields['slug'] === 'string' && fields['slug'] ? String(fields['slug']) : title)
  const hostRef = firestore.collection('hosts').doc(request.hostId)
  const parentRef = hostRef.collection('collections').doc(request.collectionId)
  const entries = parentRef.collection('entries')
  const ref = entries.doc(request.id)
  return firestore.runTransaction(async (tx): Promise<ContentEntryWrite> => {
    const [host, parent, existing] = await Promise.all([tx.get(hostRef), tx.get(parentRef), tx.get(ref)])
    if (!host.exists) return { ok: false, status: 404, error: 'Unknown site' }
    if (existing.exists) {
      return {
        ok: true,
        replayed: true,
        id: existing.id,
        slug: String(existing.get('slug') ?? ''),
        title: String(existing.get('title') ?? ''),
      }
    }
    if (!parent.exists || hostCollectionKind(parent.data()) !== 'content') {
      return { ok: false, status: 404, error: 'Unknown collections document' }
    }
    if (!hostRoleCanWrite(roleOf(host, request.uid))) return { ok: false, status: 403, error: CONTENT_DRAFT_ROLE_REFUSAL }
    const candidates = Array.from({ length: 10 }, (_, index) => (index === 0 ? base : `${base}-${index + 1}`))
    const held = new Set((await tx.get(entries.where('slug', 'in', candidates))).docs.map((doc) => String(doc.get('slug'))))
    const slug = candidates.find((candidate) => !held.has(candidate)) ?? `${base}-${request.id.slice(0, 8).toLowerCase()}`
    const count = (await tx.get(entries.count())).data().count
    if (count >= ENTRIES_MAX_PER_COLLECTION) return { ok: false, status: 403, error: CONTENT_ENTRIES_FULL_REFUSAL }
    tx.create(ref, {
      ...fields,
      slug,
      // Born a draft, as the resources route stamps it (AGL-2266).
      status: 'draft',
      ...entryTitleSearchFields(title),
      createdAt: request.now,
      updatedAt: request.now,
      createdBy: request.uid,
    })
    return { ok: true, replayed: false, id: request.id, slug, title }
  })
}

/** What publishing a set of entries came to. */
export interface ContentEntriesPublish {
  published: string[]
  /** Entries left as they were, each with the plain sentence for why. */
  kept: Array<{ id: string; reason: string }>
}

/** The console's refusal for an entry with no byline (`ENTRY_BYLINE_REQUIRED_MESSAGE`'s sense). */
export const CONTENT_PUBLISH_NO_BYLINE = 'It has no author yet. Add one in Content and publish it.'
export const CONTENT_PUBLISH_GONE = 'It was deleted before it could be published.'

/**
 * Publishes draft entries of a collection on a member's behalf, as the
 * entry editor's Publish does: `status: 'published'` and `publishedAt`, for a
 * member who may publish the site and an entry that names its byline. An
 * entry already published stays as it is; one that cannot be published is
 * kept a draft and reported. Never throws for an entry.
 */
export async function publishContentEntries(
  firestore: Firestore,
  request: { hostId: string; collectionId: string; uid: string; ids: readonly string[]; now: Date },
): Promise<ContentEntriesPublish | ContentDraftRefusal> {
  const hostRef = firestore.collection('hosts').doc(request.hostId)
  const host = await hostRef.get()
  if (!host.exists) return { ok: false, status: 404, error: 'Unknown site' }
  if (!hostRoleCanPublish(roleOf(host, request.uid))) return { ok: false, status: 403, error: CONTENT_PUBLISH_ROLE_REFUSAL }
  const entries = hostRef.collection('collections').doc(request.collectionId).collection('entries')
  const result: ContentEntriesPublish = { published: [], kept: [] }
  const batch = firestore.batch()
  for (const id of new Set(request.ids)) {
    const entry = await entries.doc(id).get()
    if (!entry.exists || entry.get('deletedAt') != null) {
      result.kept.push({ id, reason: CONTENT_PUBLISH_GONE })
      continue
    }
    if (entry.get('status') === 'published') {
      result.published.push(id)
      continue
    }
    if (!entryHasByline({ authorId: entry.get('authorId'), authorName: entry.get('authorName') })) {
      result.kept.push({ id, reason: CONTENT_PUBLISH_NO_BYLINE })
      continue
    }
    batch.set(entries.doc(id), { status: 'published', publishedAt: request.now, updatedAt: request.now }, { merge: true })
    result.published.push(id)
  }
  await batch.commit()
  return result
}
