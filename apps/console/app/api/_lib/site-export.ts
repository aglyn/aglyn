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

/**
 * Shared site-export bundle contract (AGL-163), used by both the export and
 * import routes. Lives in `_lib` (an App Router private folder) because
 * `route.ts` files may only export route handlers — the Pages Router version
 * exported these from the export route itself.
 */

export const SITE_EXPORT_FORMAT = 'aglyn-site-export'
export const SITE_EXPORT_VERSION = 1

/** Host-doc fields that travel in a bundle (never admins/tenant/domain). */
export const EXPORTABLE_HOST_FIELDS = [
  'displayName',
  'seo',
  'theme',
  'screens',
  'layouts',
  'notFoundScreenId',
  'errorScreens',
  'analytics',
] as const

/** Per-collection doc caps keep bundles bounded and import tractable. */
export const EXPORT_COLLECTION_LIMITS: Record<string, number> = {
  screens: 200,
  layouts: 50,
  components: 100,
  variables: 100,
  functions: 100,
  workflows: 100,
  actions: 100,
  services: 50,
  collections: 20,
  datasets: 50,
  // Read by BOTH directions, so it has to be declared rather than passed at
  // one call site (AGL-1382): the export used a literal 500 while the import
  // fell through to the `?? 100` default, so a manifest of more than 100
  // assets exported fine and restored short — the silent narrowing this file
  // now exists to prevent, one layer above the field lists.
  media: 500,
  // The folder tree the media manifest points INTO (AGL-1392). It was in
  // neither this table nor the export's `Promise.all`, while `media.folderId`
  // was (correctly) restorable — so every restored asset referenced a folder
  // document the bundle provably did not contain. Same class as the
  // AGL-1046/AGL-1050 bug that emptied datasets and media out of "whole-site"
  // backups: a referenced collection nobody added to the manifest.
  //
  // Well above `media`'s own realistic fan-out — folders are a handful per
  // library, and the cap exists to bound the bundle, not to ration them.
  mediaFolders: 200,
  /**
   * The SITE's own library — `hosts/{hostId}/media` and
   * `hosts/{hostId}/mediaFolders` (AGL-1392, second pass).
   *
   * The first pass added `mediaFolders` at ORG scope only, and production says
   * that is three quarters of the problem: of 246 foldered assets, 58 (24%)
   * live in a host library, whose folders `platform.types.ts` documents as the
   * canonical path (AGL-171) and which `resolveMediaScope` still serves as a
   * first-class scope. Neither collection was read by the export at ALL, so a
   * "whole-site backup" of a site with its own library carried none of it —
   * the assets no more than the folders.
   *
   * TWO manifest arrays rather than one merged list, because the scope is the
   * document's home and not a detail of it: a host library is private by
   * construction (`scopedToHost` refuses to filter it, its docs carry no
   * `visibleTo`), so folding those assets into the org arrays would restore a
   * site's private files into the shared org DAM — visible to every member of
   * every other client site. The ids are separate spaces too, and a pointer
   * that resolves in one library must not resolve against the other.
   *
   * Same caps as their org counterparts: the number bounds a bundle, and the
   * two libraries hold the same kind of thing. Declared here rather than
   * defaulted, because `bundleItems` falls through to `?? 100` — which is
   * exactly how AGL-1382's media manifest restored short and silently.
   */
  hostMedia: 500,
  hostMediaFolders: 200,
}

/**
 * The keys an import may write, per collection (AGL-1382).
 *
 * The import route used to persist bundle documents through a DENY-list:
 * `cleanDoc` destructured away six structural keys and stored everything
 * else with `merge: false`. That is the bet this repo lost three times in one
 * night — AGL-1354 (four entitlement-bearing org fields client-writable),
 * AGL-1364 (two more, each the sibling of a field somebody DID remember), and
 * AGL-1355/AGL-1361 filed to stop the recurrence. AGL-1377 converted
 * `/api/hosts/resources` and found `/api/hosts/versions` had neither list;
 * this is the third and last of the three disciplines.
 *
 * A bundle is attacker-shaped in a way a form is not: it is a file someone
 * hands you, and `merge: false` means every key in it lands as the document.
 *
 * **These lists are derived from the round trip, not from the create paths.**
 * The export emits `{ $id: doc.id, ...doc.data() }` — the WHOLE document — so
 * the permitted set is every field a live document can legitimately carry,
 * which is strictly wider than what a create sends: creates go through
 * `RESOURCES[*].fields`, but updates and deletes stay client-direct by design,
 * and a document accretes fields for its whole life. Deriving from the create
 * allow-lists alone would drop `icon` and `props` off every reusable
 * component, `categories` off every content collection, and `model` off every
 * dataset — silently, on restore, with `merge: false` ERASING them rather
 * than merely failing to add them. That is the opposite failure and the worse
 * one, which is why `site-export.spec.ts` round-trips a fully-populated
 * document of every shape through both directions.
 *
 * Four classes are deliberately absent:
 *
 * * `$id`, `version`, `entries`, `records` — structural; the import re-keys
 *   them explicitly.
 * * `createdAt`/`updatedAt` — stamped server-side; a client clock is not a
 *   fact about the document.
 * * `deletedAt` — the export filters soft-deleted docs, so a legitimate
 *   bundle never carries one. Restoring a tombstone makes a document
 *   invisible with no error, and it is the shape of both the AGL-1173
 *   cap-evasion bug and AGL-1383's exclusion laundering.
 * * `visibleTo` — the import assigns a fresh `host:` scope. A bundle is
 *   portable, and honouring an embedded `['org']` would publish one org's
 *   data across another agency's whole client roster on a restore.
 *
 * Keyed by COLLECTION, not by manifest array. `media` and `hostMedia` are the
 * same document in two libraries — one org-shared, one site-private — so the
 * import cleans both through the `media` list and the two cannot drift into
 * different permitted sets. Only the CAPS above are per-array, because a cap
 * bounds a bundle rather than describing a document.
 */
export const IMPORTABLE_FIELDS: Record<string, readonly string[]> = {
  screens: [
    'displayName',
    'description',
    'slug',
    // Re-derived on import from displayName (AGL-835), but bundles that
    // predate the field still carry it and it costs nothing to accept.
    'nameLower',
    'seo',
    // The published-version pointer: the export hangs `item.version` off it,
    // so without it a restored screen renders nothing.
    'versionId',
    'parentId',
    'order',
    // Shared-layout binding — dropping it silently strips a page's chrome.
    'layoutId',
    'publishedAt',
    'publishSchedule',
    'visibility',
    // sha256 of the visitor password (AGL-87). A site admin can already set
    // this through the console, so accepting it crosses no privilege
    // boundary — and dropping it locks a restored password-protected screen.
    'protection',
    'locale',
    'localeVariants',
    // 'email' marks an Emails-page document; dropping it turns every
    // restored email into a live billable page (AGL-1383).
    'kind',
    // Legacy, but still queried live by apps/tenant/utils/get-all-screens.ts.
    'status',
    'schedule',
  ],
  layouts: [
    'displayName',
    'description',
    'versionId',
    // No `versions` array (AGL-1384): every reader uses the `versions`
    // SUBCOLLECTION, nothing kept the array in step, and the caller that
    // seeded it has stopped. Existing documents keep a harmless dead key that
    // a restore now drops.
    // Nested-layout parent (AGL-703) — same key name as the doc id, which
    // makes it easy to mistake for a self-reference and drop.
    'layoutId',
    'publishSchedule',
  ],
  /**
   * Screen and layout version subdocuments (the export attaches the
   * published one as `item.version`).
   *
   * `elements` is the one that would have been missed. It is a LEGACY ALIAS
   * for `nodes`, migrated only inside `screenVersionConverter` — and the
   * export reads `version.data()` raw, with no converter. A version document
   * that has not been re-saved since that migration therefore ships
   * `elements` and no `nodes`, so an allow-list without it restores the page
   * EMPTY. Same argument for the `bundleId`/`pluginId` pair the converter
   * migrates alongside it.
   */
  versions: [
    'displayName',
    'nodes',
    'elements',
    'rootId',
    'screenId',
    'layoutId',
    'hostId',
    'componentId',
    'pluginId',
    'bundleId',
  ],
  components: [
    // No `hostId` (AGL-1384): it duplicated the document's own path and
    // nothing read it. Existing documents keep a harmless dead key that a
    // restore now drops.
    'displayName',
    'description',
    // Neither `icon` (AGL-1193) nor `props` (AGL-1247) is in the create
    // allow-list — both arrive only by update, so a list seeded from
    // `RESOURCES.reusableComponent.fields` would erase them on restore.
    // `props` is what the tenant graft needs, or every {{prop.*}} renders raw.
    'icon',
    'props',
    'rootId',
    'nodes',
    // No `versionId` (AGL-1392), and unlike every other omission here this one
    // is about a POINTER rather than a payload.
    //
    // The export carries version subdocuments for screens and layouts only, so
    // a restored `components.versionId` named a document the bundle provably
    // did not contain. It costs nothing at render — the tenant reads
    // `nodes`/`rootId`/`props` straight off the component DOCUMENT
    // (`get-components.ts`) and never opens a version — but it strands the
    // EDITOR permanently: both "mint version 1 if absent" fallbacks are guarded
    // on `!versionId`, which a dangling id satisfies, so the self-heal that
    // exists for exactly this case never fires and the besigner renders "Not
    // found" with no way back.
    //
    // Dropping it is therefore the fix rather than a loss: the restored
    // component renders from its own tree, and the first open mints a fresh
    // version 1 seeded from it. Exporting component versions instead would ship
    // a second copy of every component's tree to repair a pointer nothing reads.
    'marketplace',
    'installedFrom',
    'detachedFrom',
    'publishSchedule',
    'kind',
  ],
  variables: ['name', 'type', 'value', 'workflowId', 'workflowName'],
  functions: ['name', 'parameters', 'variables', 'operations', 'returnValue'],
  // `trigger` is written as a literal `null` by the edit path, so absence and
  // null are different states here — the filter must drop only `undefined`.
  workflows: ['name', 'steps', 'returnValue', 'trigger'],
  // Interactions have no `RESOURCES` entry at all: all three creators write
  // the document client-direct, so this list comes from them, not from a route.
  actions: ['name', 'trigger', 'steps', 'enabled'],
  services: [
    'name',
    'description',
    'durationMinutes',
    'priceUsd',
    'timezone',
    'windows',
  ],
  /**
   * One collection holding two shapes, discriminated by `kind` (AGL-954), so
   * this is the union of both. `CONTENT_KEYS` in the collections route is NOT
   * a sufficient seed — it covers create/rename only, and every other content
   * field is written client-direct. `CATALOG_KEYS` is complete, because
   * catalog rows have no client-direct writer.
   */
  collections: [
    'kind',
    'slug',
    // Content.
    'displayName',
    'listScreenId',
    'entryScreenId',
    // Legacy AGL-105 pointer, still honoured when it is the only one set.
    'templateScreenId',
    // Entries reference the stable category id, so losing this orphans the
    // taxonomy of every entry in the collection (AGL-582).
    'categories',
    // Catalog (CommerceModel.HostCollection).
    'name',
    'description',
    'mode',
    'productIds',
    'rules',
    'matchAll',
    'imageUrl',
    'order',
  ],
  entries: [
    'title',
    'slug',
    'excerpt',
    'body',
    'coverImage',
    'seoTitle',
    'seoDescription',
    'authorName',
    'categoryId',
    // Legacy free-typed bucket, still read as the fallback everywhere.
    'category',
    'tags',
    // `listLiveEntries` queries `where('status','in',…)`, so an entry
    // restored without one is invisible on the live site.
    'status',
    'publishedAt',
    'publishAt',
  ],
  datasets: [
    'displayName',
    // Pre-AGL-536 human name, still read as a fallback by site search.
    'name',
    'fields',
    // The typed DatasetModel, and exactly what `effectiveDatasetModel` reads
    // below. Drop it and every restored dataset silently degrades to the
    // derived all-text v1 model, losing types, `required`, `validation`,
    // `default` and every `reference` link (AGL-180).
    'model',
    'names',
    'description',
    'source',
    'installedFrom',
    'detachedFrom',
  ],
  // `order` is what `sortDatasetRecords` sorts by, so dropping it reorders
  // every repeatable on the restored site.
  records: ['values', 'order'],
  media: [
    'fileName',
    'contentType',
    'sizeBytes',
    // The premise of "bytes stay in storage; URLs keep working".
    'url',
    'storagePath',
    'folderId',
    // Legacy free-text folder name (AGL-124), still the fallback for
    // unmigrated documents.
    'folder',
    'tags',
    'alt',
    'description',
    'width',
    'height',
    'contentHash',
    // The strong quarantine digest (AGL-1614). Carried for the same reason
    // `contentHash` is: an import re-creates the media document, and an
    // asset that arrives without its digest arrives without the key a
    // takedown was written under.
    'contentSha256',
    'variants',
    'cdnPath',
    'customMetadata',
    'private',
  ],
  /**
   * The DAM folder tree (AGL-1392). Two fields, and the short list is the
   * finding rather than an oversight: a folder is a name and a place.
   *
   * `parentId` is content, not structure — the hierarchy is the thing a restore
   * is for, and it is capped at `MEDIA_FOLDER_MAX_DEPTH`. It is also the one
   * field the import post-processes: a `parentId` naming a folder that will not
   * exist is dropped to root, because an unreachable folder is INVISIBLE in the
   * DAM rather than merely misplaced.
   *
   * Absent on purpose:
   *
   * * `visibleTo` — as for datasets and media, the import assigns a fresh
   *   `host:` scope; a bundle is portable and an embedded `['org']` would
   *   publish one org's folders across another agency's client roster.
   * * `createdAt` — server-stamped.
   * * `order` — declared on the interface and read by the library's sort, but
   *   NO write path in the repo ever sets it, so no live document carries one.
   *   The same "a key nobody can point at a document for" test AGL-1384 applies.
   */
  mediaFolders: ['name', 'parentId'],
}
