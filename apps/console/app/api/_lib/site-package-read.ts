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

import { decodeStoredNodes } from '@aglyn/aglyn/server'
import { THEME_LIBRARY_COLLECTION } from '@aglyn/aglyn/app-utils/theme-library'
import { contentHash } from '@aglyn/aglyn/data-transfer'
import {
  buildSitePackage,
  describeSiteItem,
  isPlainSiteObject,
  listSitePackageKinds,
  siteBundleItems,
  sitePackageKindMap,
  siteReferenceIndex,
  type SiteBundle,
  type SiteExistingItem,
  type SitePackage,
  type SitePackageContract,
  type SitePackageItem,
  type SitePackageKind,
  type SitePackageSectionHooks,
} from '@aglyn/aglyn/data-transfer/site-package'
import type { ResolvedSiteBundleSection } from '@aglyn/aglyn/plugin-manager/plugin-site-bundle'
import { TENANT_EMAIL_COLLECTION } from '@aglyn/shared-util-email/tenant-email-catalog'
import { scopedToHost } from '@aglyn/tenant-data-admin'
import { decodeBundleTimestamps, encodeBundleTimestamps } from './bundle-timestamps'
import {
  EXPORT_COLLECTION_LIMITS,
  EXPORTABLE_HOST_FIELDS,
  IMPORTABLE_FIELDS,
  PLUGIN_SITE_EXPORT_COLLECTIONS,
  SITE_SETTINGS_FIELDS,
  SITE_THEME_FIELDS,
} from './site-export'

/**
 * Reading a site as a package (AGL-3533): the export's reads, and the same
 * reads an import makes of the site it lands in, so an incoming item and the
 * site's own are hashed from one shape and `identical` means what it says.
 *
 * Lives in `_lib` (an App Router private folder) because `route.ts` files may
 * only export route handlers.
 */

/** The contract the core's item conversion is held to: the host fields and the caps. */
export function sitePackageContract(): SitePackageContract {
  return {
    settingsFields: SITE_SETTINGS_FIELDS,
    themeFields: SITE_THEME_FIELDS,
    limits: EXPORT_COLLECTION_LIMITS,
  }
}

/** Every kind this console reads, by name. */
export function consoleSitePackageKinds(): ReadonlyMap<string, SitePackageKind> {
  return sitePackageKindMap(listSitePackageKinds())
}

/** Each section's package hooks, by the kind it declares. */
export function sectionPackageHooks(
  sections: readonly ResolvedSiteBundleSection[],
): SitePackageSectionHooks {
  return Object.fromEntries(sections.map((one) => [one.package.kind, one.section.package]))
}

type Doc = Record<string, any>

/**
 * A document's `nodes`, decoded to the map a bundle can actually carry
 * (AGL-1391).
 *
 * `nodes` is stored in TWO live forms — a plain Firestore map, and msgpack
 * `Bytes` — and the besigner writes the compressed one, so it is the
 * majority of live screens and layouts. Read raw, with no converter, the
 * Admin SDK hands back a Node `Buffer`, and `JSON.stringify` turns that into
 * `{"type":"Buffer","data":[…]}`, which the import used to write straight
 * back: every besigner-saved page restored EMPTY, silently, exactly as
 * AGL-1223 failed.
 *
 * Decoding here rather than re-encoding on the way in is the deliberate
 * choice. A backup whose content nobody can read is most of the way to no
 * backup: a bundle is a JSON file customers diff, grep and hand-edit, and it
 * is the only artefact that survives losing the account. It is also SMALLER —
 * `JSON.stringify` of a Buffer emits a decimal array at ~4 characters per
 * byte, roughly 3x the plain map it encodes.
 *
 * `elements` gets the same treatment. It is the legacy alias migrated inside
 * `screenVersionConverter`, so it only exists on documents written before
 * compression and is always a plain map — which passes through unchanged.
 *
 * A decode failure keeps the RAW value rather than dropping to null: the
 * bytes are the only copy of that page, so shipping them opaque leaves a
 * recovery possible, and the import re-encodes an envelope losslessly.
 */
export function readableNodes(data: Doc): Doc {
  const readable: Doc = {}
  for (const key of ['nodes', 'elements']) {
    // Only rewrite a field the document actually has — writing an explicit
    // `null` over an absent key would restore as a cleared tree.
    if (data[key] === undefined) continue
    readable[key] = decodeStoredNodes(data[key]) ?? data[key]
  }
  return readable
}

/** What a site read needs: the site, its organization and the plugin sections. */
export interface SiteReadContext {
  firestore: FirebaseFirestore.Firestore
  hostRef: FirebaseFirestore.DocumentReference
  hostId: string
  orgId: string | null | undefined
  hostData: Doc
  sections: readonly ResolvedSiteBundleSection[]
}

/**
 * Everything designable on a site, in the v1 backup's shape (AGL-163): host
 * settings and theme, screens and layouts with their PUBLISHED versions, the
 * site's emails with theirs, reusable components, authors, content
 * collections and their entries, the theme library, a media manifest
 * (metadata and URLs; bytes stay in storage), every host collection a plugin
 * declares for the backup, and every section a plugin answers for itself.
 * Never admins, tenant linkage, domain, submissions, bookings or leads, or
 * secrets.
 */
export async function readSiteBundle(context: SiteReadContext): Promise<SiteBundle> {
  const { firestore, hostRef, hostId, orgId, hostData, sections } = context
  const host: Doc = {}
  for (const field of EXPORTABLE_HOST_FIELDS) {
    if (hostData[field] !== undefined) host[field] = hostData[field]
  }

  /**
   * Every exported document, with any node tree made readable.
   *
   * `readableNodes` runs on the DOCUMENT here, not only on the published
   * versions below, because a document can carry a tree of its own:
   * components and forms hold their published design on the parent, and both
   * are compressed at rest (AGL-1151). Applied to every collection rather
   * than a named few, so a collection that gains a `nodes` field is covered
   * the day it does.
   */
  const exportCollection = async (name: string) => {
    const snapshot = await hostRef
      .collection(name)
      .limit(EXPORT_COLLECTION_LIMITS[name] ?? 100)
      .get()
    return snapshot.docs
      .filter((doc) => !doc.get('deletedAt'))
      .map((doc) => {
        const data = doc.data()
        return { $id: doc.id, ...data, ...readableNodes(data) }
      })
  }

  // Screens, layouts and the site's emails carry only their published
  // version's design.
  const withPublishedVersion = async (name: string) => {
    const docs = await exportCollection(name)
    return Promise.all(
      docs.map(async (item: Doc) => {
        if (!item['versionId']) return item
        const version = await hostRef
          .collection(name)
          .doc(item['$id'])
          .collection('versions')
          .doc(String(item['versionId']))
          .get()
        if (!version.exists) return item
        const data = version.data() ?? {}
        return { ...item, version: { $id: version.id, ...data, ...readableNodes(data) } }
      }),
    )
  }

  const withEntries = async () => {
    const collections = await exportCollection('collections')
    return Promise.all(
      collections.map(async (item: Doc) => ({
        ...item,
        entries: (
          await hostRef.collection('collections').doc(item['$id']).collection('entries').limit(200).get()
        ).docs.map((doc) => ({ $id: doc.id, ...doc.data() })),
      })),
    )
  }

  /**
   * Media is ORG-owned (AGL-237) and narrowed to what this host may see
   * (AGL-1046): an agency's export of a client site must contain that
   * client's data and no other's. `visibleTo` itself is stripped on the way
   * out — its `host:` tokens name hosts of THIS org, a dangling reference once
   * the bundle is restored elsewhere; the import assigns a fresh scope.
   */
  const scopeless = (doc: FirebaseFirestore.QueryDocumentSnapshot) => {
    const { visibleTo: _visibleTo, ...data } = doc.data()
    return { $id: doc.id, ...data }
  }
  const exportOrgCollection = async (name: 'media' | 'mediaFolders', cap: number) => {
    // A host with no owning org genuinely has no org data — a known-empty
    // answer, not a failure. Everything else THROWS: a catch-all would
    // produce a silently empty, still-200 "backup" nobody discovers until
    // they restore it. An export that fails loudly is recoverable; one that
    // lies is not.
    if (!orgId) return []
    const ref = firestore.collection('orgs').doc(orgId).collection(name)
    const snapshot = await scopedToHost(ref, hostId).limit(cap).get()
    return snapshot.docs.filter((doc) => !doc.get('deletedAt')).map(scopeless)
  }

  /**
   * The SITE's own media library — `hosts/{hostId}/media` and
   * `hosts/{hostId}/mediaFolders` (AGL-1392, second pass). No scope filter:
   * a host library is private by construction and carries no `visibleTo`,
   * so the org query would match NOTHING and ship an empty library that
   * reads as an honest empty one.
   */
  const exportHostLibrary = async (name: 'media' | 'mediaFolders', cap: number) => {
    const snapshot = await hostRef.collection(name).limit(cap).get()
    return snapshot.docs.filter((doc) => !doc.get('deletedAt')).map(scopeless)
  }

  const [
    screens,
    layouts,
    emailTemplates,
    components,
    authors,
    collections,
    themes,
    media,
    mediaFolders,
    hostMedia,
    hostMediaFolders,
    declared,
    sectionItems,
  ] = await Promise.all([
    withPublishedVersion('screens'),
    withPublishedVersion('layouts'),
    withPublishedVersion(TENANT_EMAIL_COLLECTION),
    exportCollection('components'),
    // The bylines `entries.authorId` points at (AGL-2486).
    exportCollection('authors'),
    withEntries(),
    exportCollection(THEME_LIBRARY_COLLECTION),
    // Media manifest only — bytes stay in storage; URLs keep working because
    // download tokens are stable. The caps read from the shared table, so the
    // export and the import cannot disagree about them (AGL-1382).
    exportOrgCollection('media', EXPORT_COLLECTION_LIMITS['media']),
    // The tree the manifest points into (AGL-1392): a dangling `folderId`
    // HIDES an asset rather than misfiling it.
    exportOrgCollection('mediaFolders', EXPORT_COLLECTION_LIMITS['mediaFolders']),
    exportHostLibrary('media', EXPORT_COLLECTION_LIMITS['hostMedia']),
    exportHostLibrary('mediaFolders', EXPORT_COLLECTION_LIMITS['hostMediaFolders']),
    // The collections plugins declare for the backup, read exactly like the
    // platform's plain ones: capped, live documents only, trees readable.
    Promise.all(PLUGIN_SITE_EXPORT_COLLECTIONS.map((one) => exportCollection(one.collection))),
    // The sections plugins answer for themselves. A section declared and not
    // registered has already thrown, where the caller resolved them.
    Promise.all(sections.map((one) => one.section.export({ hostId, orgId: orgId ?? null, limit: one.limit }))),
  ])

  return {
    host,
    screens,
    layouts,
    [TENANT_EMAIL_COLLECTION]: emailTemplates,
    components,
    ...Object.fromEntries(PLUGIN_SITE_EXPORT_COLLECTIONS.map((one, index) => [one.collection, declared[index]])),
    authors,
    collections,
    [THEME_LIBRARY_COLLECTION]: themes,
    ...Object.fromEntries(sections.map((one, index) => [one.key, sectionItems[index]])),
    media,
    mediaFolders,
    // Two libraries, two arrays: the scope is where the document LIVES, not a
    // property of it, and merging them would restore a site's private files
    // into the shared org DAM (AGL-1392).
    hostMedia,
    hostMediaFolders,
  }
}

/*==========================================
 * HASHING — what "identical" compares
 *=========================================*/

/** The allow-list each v1 array's documents are written through, by array. */
const ARRAY_FIELDS: Record<string, string> = {
  hostMedia: 'media',
  hostMediaFolders: 'mediaFolders',
}

/** The allow-list of a versioned kind's `version`, by array. */
const VERSION_FIELDS: Record<string, string> = {
  screens: 'versions',
  layouts: 'versions',
  [TENANT_EMAIL_COLLECTION]: 'emailTemplateVersions',
}

/** The keys a restore stamps or scopes itself, and so never what an item IS. */
const STAMPED = new Set(['createdAt', 'updatedAt', 'deletedAt', 'visibleTo', 'createdBy'])

function project(fields: readonly string[] | undefined, doc: Doc): Doc {
  const out: Doc = {}
  if (!fields) {
    for (const [key, value] of Object.entries(doc)) {
      if (!STAMPED.has(key) && value !== undefined) out[key] = stripStamps(value)
    }
    return out
  }
  for (const field of fields) if (doc[field] !== undefined) out[field] = doc[field]
  return { ...out, ...readableNodes(out) }
}

function stripStamps(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripStamps)
  if (isPlainSiteObject(value)) {
    const out: Doc = {}
    for (const [key, entry] of Object.entries(value)) if (!STAMPED.has(key)) out[key] = stripStamps(entry)
    return out
  }
  return value
}

/**
 * What an item is, for comparing it with another: the fields a restore would
 * write (its allow-list, its version's and its entries'), its address, and
 * nothing a restore stamps — so an item restored yesterday and exported today
 * is `identical` to the file it came from. Dates in one wire form and node
 * trees decoded, whichever form either side holds them in.
 */
export function siteItemProjection(item: SitePackageItem, kind: SitePackageKind | undefined): unknown {
  const content = item.content as Doc
  let projected: Doc
  if (!kind || kind.singletonId) {
    projected = project(undefined, content)
  } else if (kind.source === 'section') {
    projected = project(undefined, content)
  } else {
    const fields = IMPORTABLE_FIELDS[ARRAY_FIELDS[kind.bundleKey] ?? kind.bundleKey]
    projected = project(fields, content)
    const versionFields = VERSION_FIELDS[kind.bundleKey]
    if (versionFields && content['version'] && typeof content['version'] === 'object') {
      projected['version'] = { $id: content['version'].$id, ...project(IMPORTABLE_FIELDS[versionFields], content['version']) }
    }
    if (kind.bundleKey === 'screens' && typeof content['route'] === 'string') projected['route'] = content['route']
    if (kind.bundleKey === 'collections' && Array.isArray(content['entries'])) {
      projected['entries'] = content['entries'].map((entry: Doc) => ({
        $id: entry?.['$id'],
        ...project(IMPORTABLE_FIELDS['entries'], entry ?? {}),
      }))
    }
  }
  return encodeBundleTimestamps(decodeBundleTimestamps(projected))
}

/** A published version's hash, over the allow-list its documents are written through. */
export function siteVersionHash(bundleKey: string, version: Doc): Promise<string> {
  const fields = IMPORTABLE_FIELDS[VERSION_FIELDS[bundleKey] ?? 'versions']
  return contentHash(encodeBundleTimestamps(decodeBundleTimestamps({ $id: version['$id'], ...project(fields, version) })))
}

/** An item's content hash, over {@link siteItemProjection}. */
export function siteItemHasher(kinds: ReadonlyMap<string, SitePackageKind>) {
  return (item: SitePackageItem) => contentHash(siteItemProjection(item, kinds.get(item.kind)))
}

/** A site read as package items, hashed, with their content for merges and undo. */
export interface SiteAsPackage {
  items: SitePackageItem[]
  existing: Array<SiteExistingItem & { content: Doc }>
}

/**
 * The site as package items: what an import compares against and what an
 * undo snapshot holds. Dates stay in the wire form the file carries, so a
 * snapshot is JSON as it is.
 */
export async function readSiteAsPackage(
  context: SiteReadContext,
  kinds: ReadonlyMap<string, SitePackageKind>,
): Promise<SiteAsPackage> {
  const bundle = encodeBundleTimestamps(await readSiteBundle(context))
  const items = siteBundleItems(bundle, sitePackageContract(), [...kinds.values()])
  const hash = siteItemHasher(kinds)
  const existing = await Promise.all(
    items.map(async (item) => ({
      kind: item.kind,
      id: item.id,
      ...describeSiteItem(item, kinds),
      contentHash: await hash(item),
      content: item.content as Doc,
    })),
  )
  return { items, existing }
}

/**
 * Items as a package: hashed through the projection and given their
 * dependencies against `alsoKnown` too — the site an import lands in, whose
 * items an incoming one may name.
 */
export function sitePackageOf(
  items: readonly SitePackageItem[],
  options: {
    kinds: ReadonlyMap<string, SitePackageKind>
    sections: SitePackageSectionHooks
    alsoKnown?: ReadonlyArray<{ kind: string; id: string }>
    createdAt?: number
    source?: string
  },
): Promise<SitePackage> {
  return buildSitePackage(items, {
    hash: siteItemHasher(options.kinds),
    index: siteReferenceIndex([...items, ...(options.alsoKnown ?? [])], options.kinds),
    kinds: options.kinds,
    sections: options.sections,
    ...(options.createdAt !== undefined ? { createdAt: options.createdAt } : {}),
    ...(options.source ? { source: options.source } : {}),
  })
}
