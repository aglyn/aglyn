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

import {
  CORE_CONTENT_COLLECTIONS,
  CORE_GENERIC_SCAN_COLLECTIONS,
} from '@aglyn/aglyn/server'
import {
  listPluginOrgCollections,
  pluginHostCollectionsScannedGenerically,
} from '@aglyn/aglyn/plugin-manager/plugin-host-collections'
import {
  WORKSPACE_SETTINGS_AREA,
  mediaIdsUsedBy,
  mediaMovePatch,
  type MediaLibraryMove,
  type MediaLibraryUse,
  type MediaUseRewriter,
} from '@aglyn/aglyn/app-utils/media-library-move'
import { newMediaFolderDoc } from '@aglyn/aglyn/app-utils/media-folders'
import { ORG_SCOPE_TOKEN } from '@aglyn/aglyn/app-utils/scope-tokens'
import { createResourceUid } from '@aglyn/aglyn/server'
import {
  firebaseAdmin,
  mediaDerivedObjectPaths,
} from '@aglyn/tenant-data-admin'
import {
  folderStoragePath,
  mediaCdnPathUpdate,
  mediaObjectPath,
  type MediaScope,
} from './media-scope'

/**
 * The server half of moving files between a site's library and the
 * organization library: the walk that finds every stored use, the move of one
 * file, and the rewrite of its uses.
 *
 * The walk is COMPLETE or it says it is not. The reference scan behind "Find
 * where this is used" is bounded because it sits behind a button and only
 * reports; this walk decides what gets rewritten, so a document it skipped is
 * a page left pointing at the old address. It pages through every document and
 * every version, and when it runs out of reads it stops and the move is
 * refused rather than half done.
 */

/** Documents one walk may read before the move is refused as too large. */
export const MOVE_CORPUS_READ_LIMIT = 40_000

/** Page size for the walk. */
const PAGE = 300

/** One stored document that uses at least one of the files being moved. */
export interface MediaUseHit {
  ref: FirebaseFirestore.DocumentReference
  /** The site the document belongs to; '' for the organization's own. */
  hostId: string
  area: string
  name: string
  mediaIds: string[]
  /** A record holding the file by bare id, which a move does not change. */
  rewritable: boolean
}

export interface MoveCorpusWalk {
  hits: MediaUseHit[]
  complete: boolean
  reads: number
}

const nameOf = (snapshot: FirebaseFirestore.DocumentSnapshot): string => {
  for (const field of ['displayName', 'title', 'name', 'label']) {
    const value = snapshot.get(field)
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return snapshot.id
}

async function* pages(
  query: FirebaseFirestore.Query,
): AsyncGenerator<FirebaseFirestore.QueryDocumentSnapshot[]> {
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | undefined
  for (;;) {
    let next = query.orderBy(firebaseAdmin.firestore.FieldPath.documentId()).limit(PAGE)
    if (cursor) next = next.startAfter(cursor)
    const page = await next.get()
    if (page.empty) return
    yield page.docs
    if (page.size < PAGE) return
    cursor = page.docs[page.docs.length - 1]
  }
}

/**
 * Every stored use of the files `rewriter` knows, across the sites named and
 * the organization's own records.
 */
export async function walkMoveCorpus(options: {
  firestore: FirebaseFirestore.Firestore
  orgId: string
  hostIds: readonly string[]
  mediaIds: readonly string[]
  rewriter: Pick<MediaUseRewriter, 'usedIn'>
  readLimit?: number
}): Promise<MoveCorpusWalk> {
  const { firestore, orgId, hostIds, rewriter } = options
  const limit = options.readLimit ?? MOVE_CORPUS_READ_LIMIT
  const hits: MediaUseHit[] = []
  let reads = 0
  let complete = true
  const spend = (count: number) => {
    reads += Math.max(1, count)
    if (reads > limit) complete = false
    return complete
  }
  const consider = (
    snapshot: FirebaseFirestore.DocumentSnapshot,
    hostId: string,
    area: string,
    name = nameOf(snapshot),
  ) => {
    const data = snapshot.data()
    if (!data || data['deletedAt']) return
    const mediaIds = mediaIdsUsedBy(data, rewriter)
    if (mediaIds.length) {
      hits.push({ ref: snapshot.ref, hostId, area, name, mediaIds, rewritable: true })
    }
  }

  const versioned = CORE_CONTENT_COLLECTIONS.filter((name) => name !== 'collections')
  const generic = [
    ...CORE_GENERIC_SCAN_COLLECTIONS,
    ...pluginHostCollectionsScannedGenerically(),
  ]

  for (const hostId of hostIds) {
    const hostRef = firestore.collection('hosts').doc(hostId)
    const host = await hostRef.get()
    if (!spend(1)) break
    if (host.exists) consider(host, hostId, 'site', 'Site settings')

    for (const collectionName of versioned) {
      for await (const docs of pages(hostRef.collection(collectionName))) {
        if (!spend(docs.length)) break
        for (const parent of docs) {
          if (parent.get('deletedAt')) continue
          const parentName = nameOf(parent)
          consider(parent, hostId, collectionName, parentName)
          // Every version: the published one, older ones and drafts. A
          // rollback or the next publish would bring any of them back.
          for await (const versions of pages(parent.ref.collection('versions'))) {
            if (!spend(versions.length)) break
            for (const version of versions) {
              consider(version, hostId, collectionName, parentName)
            }
          }
          if (!complete) break
        }
        if (!complete) break
      }
      if (!complete) break
    }
    if (!complete) break

    for await (const collections of pages(hostRef.collection('collections'))) {
      if (!spend(collections.length)) break
      for (const collection of collections) {
        consider(collection, hostId, 'collections')
        for await (const entries of pages(collection.ref.collection('entries'))) {
          if (!spend(entries.length)) break
          for (const entry of entries) consider(entry, hostId, 'entries')
        }
        if (!complete) break
      }
      if (!complete) break
    }
    if (!complete) break

    for (const collectionName of generic) {
      for await (const docs of pages(hostRef.collection(collectionName))) {
        if (!spend(docs.length)) break
        for (const document of docs) consider(document, hostId, collectionName)
      }
      if (!complete) break
    }
    if (!complete) break
  }

  if (complete && orgId) {
    const orgRef = firestore.collection('orgs').doc(orgId)
    const org = await orgRef.get()
    spend(1)
    if (org.exists) consider(org, '', WORKSPACE_SETTINGS_AREA, 'Workspace settings')
    for (const declared of listPluginOrgCollections()) {
      if ((declared.mediaScan ?? 'generic') !== 'generic' || !complete) continue
      for await (const docs of pages(orgRef.collection(declared.name))) {
        if (!spend(docs.length)) break
        for (const document of docs) {
          const site = declared.siteField ? document.get(declared.siteField) : undefined
          consider(document, typeof site === 'string' ? site : '', declared.name)
        }
      }
    }
    // Some plugins attach library files to their records by bare id (a
    // declaration's `mediaIdsField`), which no address rewrite touches. They
    // can only be found by id, and a file one of them holds has to stay where
    // the plugin reads it from.
    for (const declared of listPluginOrgCollections()) {
      if (!declared.mediaIdsField) continue
      for (let index = 0; complete && index < options.mediaIds.length; index += 30) {
        const chunk = options.mediaIds.slice(index, index + 30)
        const page = await orgRef
          .collection(declared.name)
          .where(declared.mediaIdsField, 'array-contains-any', chunk)
          .get()
        if (!spend(page.size)) break
        for (const document of page.docs) {
          const held = (document.get(declared.mediaIdsField) as unknown[]) ?? []
          hits.push({
            ref: document.ref,
            hostId: '',
            area: declared.label ?? declared.name,
            name: nameOf(document),
            mediaIds: chunk.filter((id) => held.includes(id)),
            rewritable: false,
          })
        }
      }
    }
  }

  return { hits, complete, reads }
}

/** The uses one file has, for the guard and the report. */
export function usesOf(hits: readonly MediaUseHit[], mediaId: string): MediaLibraryUse[] {
  return hits
    .filter((hit) => hit.mediaIds.includes(mediaId))
    .map((hit) => ({ mediaId, hostId: hit.hostId, area: hit.area, name: hit.name }))
}

/**
 * The destination folder with the same path of names as the source folder,
 * created level by level where it is missing. Cached per request, since a bulk
 * move files many assets into the same few folders.
 */
export function destinationFolders(options: { from: MediaScope; to: MediaScope }) {
  const { from, to } = options
  const cache = new Map<string, Promise<string | null>>()
  let destination: Promise<FirebaseFirestore.QuerySnapshot> | null = null

  const sourceChain = async (folderId: string): Promise<string[]> => {
    const names: string[] = []
    let current: string | null = folderId
    for (let depth = 0; depth < 6 && current; depth += 1) {
      const snapshot = await from.scopeRef.collection('mediaFolders').doc(current).get()
      if (!snapshot.exists) break
      names.unshift(String(snapshot.get('name') ?? 'Folder'))
      current = (snapshot.get('parentId') as string | null) ?? null
    }
    return names
  }

  const resolve = async (folderId: string | null): Promise<string | null> => {
    if (!folderId) return null
    const names = await sourceChain(folderId)
    if (!names.length) return null
    destination ??= to.scopeRef.collection('mediaFolders').limit(1000).get()
    const existing = (await destination).docs.map((doc) => ({
      id: doc.id,
      name: String(doc.get('name') ?? ''),
      parentId: (doc.get('parentId') as string | null) ?? null,
    }))
    let parentId: string | null = null
    for (const name of names) {
      const match = existing.find(
        (folder) =>
          folder.parentId === parentId &&
          folder.name.trim().toLowerCase() === name.trim().toLowerCase(),
      )
      if (match) {
        parentId = match.id
        continue
      }
      const ref = to.scopeRef.collection('mediaFolders').doc(createResourceUid())
      await ref.set(
        newMediaFolderDoc({
          name,
          parentId,
          createdAt: firebaseAdmin.firestore.FieldValue.serverTimestamp(),
          // A folder in the organization library is shared with every site,
          // like the files a move puts in it; a site library's folders carry
          // no sharing.
          visibleTo: to.collection === 'orgs' ? [ORG_SCOPE_TOKEN] : undefined,
        } as Parameters<typeof newMediaFolderDoc>[0]),
      )
      existing.push({ id: ref.id, name, parentId })
      parentId = ref.id
    }
    return parentId
  }

  return (folderId: string | null) => {
    const key = folderId ?? ''
    if (!cache.has(key)) cache.set(key, resolve(folderId))
    return cache.get(key) as Promise<string | null>
  }
}

/** Why one file cannot be moved, as the person moving it should read it. */
export class MoveRefusal extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MoveRefusal'
  }
}

/**
 * Moves one file's record and bytes from one library to the other, keeping
 * its media id, and leaves a forwarding record at its old address.
 *
 * Order matters for a failure halfway: the copy lands first, then the new
 * record, then the forwarding record, and only then does the old record and
 * the old bytes go. Whatever step fails, the file is answered at one address
 * or the other.
 */
export async function moveOneAcrossLibraries(options: {
  firestore: FirebaseFirestore.Firestore
  bucket: ReturnType<ReturnType<ReturnType<typeof firebaseAdmin.app>["storage"]>["bucket"]>
  from: MediaScope
  to: MediaScope
  mediaId: string
  uid: string
  folderFor: (folderId: string | null) => Promise<string | null>
}): Promise<MediaLibraryMove> {
  const { bucket, from, to, mediaId, uid, folderFor } = options
  const sourceRef = from.scopeRef.collection('media').doc(mediaId)
  const targetRef = to.scopeRef.collection('media').doc(mediaId)
  const [source, target] = await Promise.all([sourceRef.get(), targetRef.get()])
  if (!source.exists || source.get('deletedAt')) throw new MoveRefusal('It is no longer in this library')
  if (target.exists) throw new MoveRefusal('A file with the same id is already in the other library')

  const data = source.data() as Record<string, unknown>
  const folderId = await folderFor((data['folderId'] as string | null) ?? null)
  const folderPath = await folderStoragePath(to.scopeRef, folderId)
  const fromObjectPath = mediaObjectPath(source, from.base)
  const toObjectPath = `${to.base}/media/` + (folderPath ? `${folderPath}/` : '') + mediaId

  // Bytes first. A copy keeps the object's metadata, so the download token —
  // and with it the legacy storage URL — carries over.
  const sourceFile = bucket.file(fromObjectPath)
  const [exists] = await sourceFile.exists()
  let url = data['url'] as string | undefined
  const derivedFrom = mediaDerivedObjectPaths(fromObjectPath, source)
  const derivedTo = mediaDerivedObjectPaths(toObjectPath, source)
  if (exists) {
    await sourceFile.copy(bucket.file(toObjectPath))
    await Promise.all(
      derivedFrom.map((path, index) =>
        bucket.file(path).copy(bucket.file(derivedTo[index])).catch(() => undefined),
      ),
    )
    if (typeof url === 'string' && url.includes(encodeURIComponent(fromObjectPath))) {
      url = url.split(encodeURIComponent(fromObjectPath)).join(encodeURIComponent(toObjectPath))
    }
  }

  const isPrivate = data['private'] === true
  const now = firebaseAdmin.firestore.FieldValue.serverTimestamp()
  const moved: Record<string, unknown> = {
    ...data,
    storagePath: toObjectPath,
    ...(url ? { url } : {}),
    folderId: folderId ?? null,
    cdnPath: mediaCdnPathUpdate({
      billing: to.billing,
      cdnScope: to.cdnScope,
      mediaId,
      isPrivate,
    }),
    movedFrom: { scope: from.cdnScope, at: now, by: uid },
    updatedAt: now,
  }
  if (to.collection === 'orgs') {
    // Into the shared library: shared with every site, the library's own
    // default for a file that more than one site may use. A narrower choice
    // is one Sharing click away, and nothing that used the file stops
    // seeing it.
    moved['visibleTo'] = [ORG_SCOPE_TOKEN]
    delete moved['scopeMode']
    delete moved['scopeExcept']
  } else {
    // A site's library carries no sharing: its files are that site's.
    delete moved['visibleTo']
    delete moved['scopeMode']
    delete moved['scopeExcept']
  }
  // `set` without merge: the record is new here. A FieldValue delete is not a
  // value a new document can hold, so an absent cdnPath is simply absent.
  if (typeof moved['cdnPath'] !== 'string') delete moved['cdnPath']
  await targetRef.set(moved)

  // The forwarding record, and none left over from an earlier move the other
  // way, which would forward this library's own file away from it.
  await Promise.all([
    from.scopeRef.collection('mediaMoves').doc(mediaId).set({
      toScope: to.cdnScope,
      movedAt: now,
      movedBy: uid,
    }),
    to.scopeRef.collection('mediaMoves').doc(mediaId).delete().catch(() => undefined),
  ])

  await sourceRef.delete()
  const bytes = Number(data['sizeBytes'] ?? data['size'] ?? 0) || 0
  await Promise.all([
    from.scopeRef.collection('counters').doc('media').set(
      {
        bytes: firebaseAdmin.firestore.FieldValue.increment(-bytes),
        count: firebaseAdmin.firestore.FieldValue.increment(-1),
      },
      { merge: true },
    ),
    to.scopeRef.collection('counters').doc('media').set(
      {
        bytes: firebaseAdmin.firestore.FieldValue.increment(bytes),
        count: firebaseAdmin.firestore.FieldValue.increment(1),
      },
      { merge: true },
    ),
  ])
  if (exists) {
    await Promise.all(
      [fromObjectPath, ...derivedFrom].map((path) =>
        bucket.file(path).delete().catch(() => undefined),
      ),
    )
  }
  return {
    mediaId,
    fromScope: from.cdnScope,
    toScope: to.cdnScope,
    ...(exists ? { fromObjectPath, toObjectPath } : {}),
  }
}

/**
 * Rewrites every use of the moved files in the documents the walk found,
 * each one re-read first so an edit made since the walk is kept.
 */
export async function rewriteMovedUses(options: {
  hits: readonly MediaUseHit[]
  movedIds: ReadonlySet<string>
  rewriter: MediaUseRewriter
  /** Only documents of these sites, and the organization's own when true. */
  hostIds: ReadonlySet<string>
}): Promise<{ documents: number; failed: number }> {
  let documents = 0
  let failed = 0
  for (const hit of options.hits) {
    if (!hit.rewritable) continue
    if (!hit.mediaIds.some((id) => options.movedIds.has(id))) continue
    if (hit.hostId && !options.hostIds.has(hit.hostId)) continue
    try {
      const snapshot = await hit.ref.get()
      const data = snapshot.data()
      if (!data) continue
      const patch = mediaMovePatch(data, options.rewriter.rewrite)
      if (!patch) continue
      for (const [key, value] of Object.entries(patch)) {
        // The Admin SDK stores a Buffer as bytes; a bare Uint8Array it
        // refuses.
        if (value instanceof Uint8Array && !Buffer.isBuffer(value)) {
          patch[key] = Buffer.from(value.buffer, value.byteOffset, value.byteLength)
        }
      }
      await hit.ref.update(patch)
      documents += 1
    } catch (error) {
      failed += 1
      console.error('media library move: could not rewrite', hit.ref.path, error)
    }
  }
  return { documents, failed }
}

