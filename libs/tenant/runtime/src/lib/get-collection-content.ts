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

export interface CollectionEntrySummary {
  $id: string
  title: string
  slug: string
  excerpt?: string
  body?: string
  coverImage?: string
  /** Search-result title override (AGL-582); falls back to `title`. */
  seoTitle?: string
  /** Meta description override (AGL-582); falls back to `excerpt`. */
  seoDescription?: string
  /** Single taxonomy bucket (AGL-582). */
  category?: string
  /** Free-form labels (AGL-582). */
  tags?: string[]
  publishedAt?: { seconds: number } | null
}

/** Entry-doc fields shared by the list and single-entry mappers (AGL-582). */
function mapEntryFields(
  value: FirebaseFirestore.DocumentData,
): Pick<
  CollectionEntrySummary,
  'excerpt' | 'coverImage' | 'seoTitle' | 'seoDescription' | 'category' | 'tags'
> {
  return {
    excerpt: value['excerpt'] ?? '',
    coverImage: value['coverImage'] ?? '',
    seoTitle: value['seoTitle'] ?? '',
    seoDescription: value['seoDescription'] ?? '',
    category: value['category'] ?? '',
    tags: Array.isArray(value['tags'])
      ? value['tags'].filter((tag): tag is string => typeof tag === 'string')
      : [],
  }
}

/**
 * Scheduled entries (AGL-123) go live lazily like AGL-61: a due
 * `publishAt` counts as published for this render, and the doc is flipped
 * to `published` fail-open so the state becomes durable.
 */
function isLive(value: FirebaseFirestore.DocumentData): boolean {
  if (value['status'] === 'published') return true
  return (
    value['status'] === 'scheduled' &&
    (value['publishAt']?.seconds ?? Number.POSITIVE_INFINITY) * 1000 <=
      Date.now()
  )
}

function flipDueEntry(
  docRef: FirebaseFirestore.DocumentReference,
  value: FirebaseFirestore.DocumentData,
): void {
  if (value['status'] !== 'scheduled') return
  docRef
    .update({ status: 'published', publishedAt: value['publishAt'] })
    .catch((error) => console.error(error))
}

export interface CollectionContent {
  collection: {
    $id: string
    displayName: string
    slug: string
    /**
     * Legacy entry-template screen (AGL-105); superseded by
     * `entryScreenId` but still honored when only it is set.
     */
    templateScreenId?: string
    /** List-template screen (AGL-551); `/{collection}` renders through it. */
    listScreenId?: string
    /**
     * Entry-template screen (AGL-551); `/{collection}/{entry}` renders
     * through it with `{{entry.*}}` tokens.
     */
    entryScreenId?: string
  } | null
  entries: CollectionEntrySummary[]
  entry: CollectionEntrySummary | null
  error: unknown
}

/**
 * Fetches a collection's live entries (newest first), shared by the route
 * loader and the compose-time Collection entries block (AGL-551).
 */
async function listLiveEntries(
  entriesRef: FirebaseFirestore.CollectionReference,
): Promise<CollectionEntrySummary[]> {
  // No orderBy: entries missing publishedAt would be dropped by Firestore;
  // sort client-side like the version lists.
  const entriesQuery = await entriesRef
    .where('status', 'in', ['published', 'scheduled'])
    .limit(100)
    .get()
  return entriesQuery.docs
    .filter((entryDoc) => isLive(entryDoc.data()))
    .map((entryDoc) => {
      const value = entryDoc.data()
      flipDueEntry(entryDoc.ref, value)
      return {
        $id: entryDoc.id,
        title: value['title'] ?? entryDoc.id,
        slug: value['slug'] ?? entryDoc.id,
        ...mapEntryFields(value),
        publishedAt: (value['publishedAt'] ?? value['publishAt'])
          ? {
              seconds: (value['publishedAt'] ?? value['publishAt']).seconds,
            }
          : null,
      }
    })
    .sort(
      (a, b) => (b.publishedAt?.seconds ?? 0) - (a.publishedAt?.seconds ?? 0),
    )
}

/**
 * Published entries for a collection resolved by slug — the data source of
 * the Collection entries block on arbitrary screens (AGL-551). Fail-open:
 * errors and unknown slugs resolve to an empty list so a renamed collection
 * never takes a published screen down.
 */
export async function getPublishedCollectionEntries(options: {
  hostId: string
  collectionSlug: string
}): Promise<CollectionEntrySummary[]> {
  try {
    const firestore = firebaseAdmin.app().firestore()
    const collectionQuery = await firestore
      .collection('hosts')
      .doc(options.hostId)
      .collection('collections')
      .where('slug', '==', options.collectionSlug)
      .limit(1)
      .get()
    const collectionDoc = collectionQuery.docs[0]
    if (!collectionDoc) return []
    return await listLiveEntries(collectionDoc.ref.collection('entries'))
  } catch (error) {
    console.error(error)
    return []
  }
}

/**
 * Resolves a non-screen path against the host's content collections
 * (Content Collections & Blog): `/{collectionSlug}` returns the published
 * entry list, `/{collectionSlug}/{entrySlug}` one entry. Fail-open — errors
 * resolve to `collection: null` and the caller 404s.
 */
export async function getCollectionContent(options: {
  hostId: string
  collectionSlug: string
  entrySlug?: string
}): Promise<CollectionContent> {
  const { hostId, collectionSlug, entrySlug } = options
  const data: CollectionContent = {
    collection: null,
    entries: [],
    entry: null,
    error: null,
  }
  try {
    const firestore = firebaseAdmin.app().firestore()
    const collectionQuery = await firestore
      .collection('hosts')
      .doc(hostId)
      .collection('collections')
      .where('slug', '==', collectionSlug)
      .limit(1)
      .get()
    const collectionDoc = collectionQuery.docs[0]
    if (!collectionDoc) return data
    data.collection = {
      $id: collectionDoc.id,
      displayName: collectionDoc.get('displayName') ?? collectionSlug,
      slug: collectionSlug,
      templateScreenId: collectionDoc.get('templateScreenId') ?? undefined,
      listScreenId: collectionDoc.get('listScreenId') ?? undefined,
      entryScreenId: collectionDoc.get('entryScreenId') ?? undefined,
    }

    const entriesRef = collectionDoc.ref.collection('entries')
    if (entrySlug) {
      const entryQuery = await entriesRef
        .where('slug', '==', entrySlug)
        .limit(5)
        .get()
      const entryDoc = entryQuery.docs.find((docSnapshot) =>
        isLive(docSnapshot.data()),
      )
      if (entryDoc) {
        const value = entryDoc.data()
        flipDueEntry(entryDoc.ref, value)
        data.entry = {
          $id: entryDoc.id,
          title: value['title'] ?? entrySlug,
          slug: entrySlug,
          body: value['body'] ?? '',
          ...mapEntryFields(value),
          publishedAt: (value['publishedAt'] ?? value['publishAt'])
            ? {
                seconds: (value['publishedAt'] ?? value['publishAt']).seconds,
              }
            : null,
        }
      }
      return data
    }

    data.entries = await listLiveEntries(entriesRef)
  } catch (error) {
    console.error(error)
    data.error = error
  }
  return data
}

export default getCollectionContent
