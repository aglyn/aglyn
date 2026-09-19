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
'use client'

/**
 * Finds the ENTRIES a link picker offers (AGL-3119) — the console half of
 * `LinkTargetSearchContext`.
 *
 * Mounted around every surface that edits links: each besigner, and the
 * content entry editor whose markdown bodies link other entries. Nothing is
 * read until an author opens a link picker and types, because the reads are
 * per keystroke-burst rather than per page.
 *
 * ## The read budget
 *
 * One SEARCH is one query per content collection, capped at
 * {@link LINK_TARGET_COLLECTION_CAP} collections and
 * {@link LINK_TARGET_ENTRIES_PER_COLLECTION} documents each: at most 10
 * queries and 50 documents for a site with ten collections, 5 documents for
 * the ordinary site with one. A query matching nothing still costs its one
 * minimum read, so the floor is one per collection searched. The picker
 * debounces by 250 ms, so a typed word is one search and not five, and this
 * provider caches each query's answer for {@link SEARCH_CACHE_MS}, so
 * reopening the picker on the same site costs nothing.
 *
 * Naming a STORED reference is one keyed read of that one entry, cached for
 * the life of the provider, and seeded free from whatever a search returned.
 *
 * Neither query needs a composite index: each is a single `orderBy` on a
 * subcollection field, which Firestore indexes automatically — the prefix
 * range on `slug` and the recency scan on `updatedAt` add no second field.
 */

import {
  collectionListUrl,
  entryLinkTargetLabel,
  formatEntryLinkValue,
  LinkTargetSearchContext,
  normalizeLinkTargetEntryStatus,
  parseEntryLinkValue,
  urlSlugSegment,
  type LinkTargetOption,
  type LinkTargetSearchContextValue,
  type LinkTargetSearchOptions,
} from '@aglyn/aglyn'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import {
  collection,
  doc,
  endAt,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAt,
  type Firestore,
} from 'firebase/firestore'
import { useMemo, type ReactNode } from 'react'

/**
 * How many of a host's content collections one search reaches.
 *
 * A site with more than ten collections is rare enough that widening the cap
 * would spend every author's reads for it; the entries of the rest are still
 * reachable by typing an address into the picker's External URL box.
 */
export const LINK_TARGET_COLLECTION_CAP = 10

/** How many entries per collection a search offers. */
export const LINK_TARGET_ENTRIES_PER_COLLECTION = 5

/** How long a query's answer is reused before it is read again. */
const SEARCH_CACHE_MS = 60_000

/** The upper bound of a slug prefix range — after every code point a slug holds. */
const PREFIX_END = ''

/** What a collection contributes: its id, its routing slug and its name. */
export interface LinkTargetCollection {
  slug: string
  name: string
}

export interface CreateLinkTargetSearchOptions {
  firestore: Firestore
  hostId: string
  /** The host's content collections, keyed by id (`listingTargets`). */
  collections: Record<string, LinkTargetCollection>
}

function abortError(): Error {
  return new DOMException('The link-target search was aborted', 'AbortError')
}

/** Rejects as soon as the caller stops wanting the answer. */
function untilAborted<T>(
  pending: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (!signal) return pending
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    pending.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

/**
 * What the author typed, as the slug a match would have: lowercased, trimmed,
 * runs of anything a slug cannot hold collapsed to `-`. The one rule entry
 * slugs are minted with (`slugify`, `urlSlugSegment`), so "Hello World" finds
 * `hello-world` — and a prefix search is only sound because both sides
 * normalize identically.
 */
export function linkTargetSearchSlug(text: string): string {
  return urlSlugSegment(text)
}

/**
 * The seam's implementation over Firestore. Separate from the provider so the
 * queries can be read — and tested — without a React tree.
 */
export function createLinkTargetSearch(
  options: CreateLinkTargetSearchOptions,
): LinkTargetSearchContextValue {
  const { firestore, hostId, collections } = options
  // By name, so which collections a capped search covers is stable rather
  // than whatever order the subscription delivered.
  const searched = Object.entries(collections)
    .filter(([, target]) => target?.slug)
    .sort(([, a], [, b]) => a.name.localeCompare(b.name))
    .slice(0, LINK_TARGET_COLLECTION_CAP)

  const searches = new Map<
    string,
    { at: number; pending: Promise<LinkTargetOption[]> }
  >()
  const labels = new Map<string, Promise<string | undefined>>()

  const entriesOf = (collectionId: string) =>
    collection(
      firestore,
      'hosts',
      hostId,
      'collections',
      collectionId,
      'entries',
    )

  const optionOf = (
    collectionId: string,
    target: LinkTargetCollection,
    entryId: string,
    data: Record<string, unknown>,
  ): LinkTargetOption | undefined => {
    const slug = typeof data['slug'] === 'string' ? data['slug'].trim() : ''
    // An entry with no slug has no address, so a link to it would resolve to
    // nothing on the published site.
    if (!slug) return undefined
    const title =
      typeof data['title'] === 'string' && data['title'].trim()
        ? data['title'].trim()
        : slug
    const status = normalizeLinkTargetEntryStatus(data['status'])
    const value = formatEntryLinkValue(collectionId, entryId)
    const option: LinkTargetOption = {
      value,
      label: entryLinkTargetLabel({
        title,
        path: `${collectionListUrl({ collectionSlug: target.slug })}/${slug}`,
        collectionName: target.name,
        status,
      }),
      title,
      collectionName: target.name,
      status,
    }
    // Naming this entry later is free: the search already read it.
    labels.set(value, Promise.resolve(option.label))
    return option
  }

  const readEntries = async (text: string): Promise<LinkTargetOption[]> => {
    const slug = linkTargetSearchSlug(text)
    const found = await Promise.all(
      searched.map(async ([collectionId, target]) => {
        const constraints = slug
          ? [orderBy('slug'), startAt(slug), endAt(`${slug}${PREFIX_END}`)]
          : // Nothing typed yet: the entries most recently worked on, which
            // is what an author reaching for a link usually wants.
            [orderBy('updatedAt', 'desc')]
        const snapshot = await getDocs(
          query(
            entriesOf(collectionId),
            ...constraints,
            limit(LINK_TARGET_ENTRIES_PER_COLLECTION),
          ),
        )
        return snapshot.docs
          .map((entry) =>
            optionOf(
              collectionId,
              target,
              entry.id,
              (entry.data() ?? {}) as Record<string, unknown>,
            ),
          )
          .filter((option): option is LinkTargetOption => Boolean(option))
      }),
    )
    return found.flat()
  }

  const searchEntries = (
    text: string,
    searchOptions: LinkTargetSearchOptions = {},
  ): Promise<LinkTargetOption[]> => {
    const { signal } = searchOptions
    if (signal?.aborted) return Promise.reject(abortError())
    if (!searched.length) return Promise.resolve([])
    const key = linkTargetSearchSlug(text)
    const cached = searches.get(key)
    const fresh = cached && Date.now() - cached.at < SEARCH_CACHE_MS
    // An aborted search keeps filling the cache: its reads are paid for
    // either way, and the next keystroke back to it then costs nothing.
    const pending = fresh ? cached.pending : readEntries(text)
    if (!fresh) {
      searches.set(key, { at: Date.now(), pending })
      // A failed read is not an answer, so it is not remembered as one.
      pending.catch(() => searches.delete(key))
    }
    return untilAborted(pending, signal)
  }

  const describeTarget = (value: string): Promise<string | undefined> => {
    const entry = parseEntryLinkValue(value)
    if (!entry) return Promise.resolve(undefined)
    const key = formatEntryLinkValue(entry.collectionId, entry.entryId)
    const cached = labels.get(key)
    if (cached) return cached
    const target = collections[entry.collectionId]
    const pending = getDoc(
      doc(entriesOf(entry.collectionId), entry.entryId),
    ).then((snapshot) => {
      if (!snapshot.exists()) return undefined
      const data = (snapshot.data() ?? {}) as Record<string, unknown>
      const slug = typeof data['slug'] === 'string' ? data['slug'].trim() : ''
      const title =
        typeof data['title'] === 'string' && data['title'].trim()
          ? data['title'].trim()
          : slug
      return entryLinkTargetLabel({
        title,
        // Without its collection's slug the entry has no address to show;
        // the name and status still tell the author what they picked.
        path:
          target?.slug && slug
            ? `${collectionListUrl({ collectionSlug: target.slug })}/${slug}`
            : undefined,
        collectionName: target?.name,
        status: normalizeLinkTargetEntryStatus(data['status']),
      })
    })
    labels.set(key, pending)
    // A read that failed says nothing about the entry — drop it so the next
    // picker that asks tries again instead of inheriting a verdict.
    pending.catch(() => labels.delete(key))
    return pending
  }

  return { available: true, searchEntries, describeTarget }
}

export interface LinkTargetSearchProviderProps {
  hostId: string
  /** The host's content collections by id — `listingTargets`. */
  collections: Record<string, LinkTargetCollection> | undefined
  children?: ReactNode
}

/**
 * Provides the entry lookup for one host. Re-created when the host's
 * collections change, which also clears the caches above — a renamed
 * collection must not keep naming entries by its old name.
 */
export function LinkTargetSearchProvider(props: LinkTargetSearchProviderProps) {
  const { hostId, collections, children } = props
  const firestore = useFirestore()
  const value = useMemo(
    () =>
      createLinkTargetSearch({
        firestore,
        hostId,
        collections: collections ?? {},
      }),
    [firestore, hostId, collections],
  )
  return (
    <LinkTargetSearchContext.Provider value={value}>
      {children}
    </LinkTargetSearchContext.Provider>
  )
}
LinkTargetSearchProvider.displayName = 'LinkTargetSearchProvider'

export default LinkTargetSearchProvider
