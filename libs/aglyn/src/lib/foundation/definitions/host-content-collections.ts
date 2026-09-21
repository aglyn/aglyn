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
 * The host subcollections CORE owns, and how the media usage scan reads them
 * (AGL-1867, AGL-3080).
 *
 * ## Why this exists, and why it is shaped the way it is
 *
 * `scanMediaReferences` answers "what uses this asset" immediately before an
 * author deletes it, and every way it can be wrong points at "unused". AGL-1413
 * closed the screen/layout/component/host-field half. AGL-1867 closed emails.
 * What was left was plugin-owned content: a commerce product carries `imageUrl`
 * and `mediaUrls`, so a product photo used nowhere else reported as unused, and
 * the panel said so with a straight face.
 *
 * An earlier pass at this issue concluded the gap could not be closed by hand,
 * because closing it looked like classifying fifty-odd collection names as
 * media-bearing or not — "a large list of guesses dressed as decisions, and the
 * first stale entry is where the next hole hides". That reasoning was right
 * about the hazard and wrong about the shape of the fix. The classification it
 * feared is only necessary if the default is NOT to scan. So the default here
 * is inverted:
 *
 * **Every host subcollection is scanned unless it is named with a reason it is
 * not.**
 *
 * That turns the open question from "does this carry media?" — which needs a
 * judgement about a schema nobody wrote down — into "is scanning this wasteful
 * or wrong?", which is answerable from the collection's own volume and who
 * writes it. It also puts the failure on the safe side: a collection nobody has
 * thought about is READ, so a plugin shipping a new media-bearing collection is
 * covered the day it lands rather than the day somebody remembers it.
 *
 * ## Core holds core's, and asks the plugins for theirs (AGL-3080)
 *
 * This file used to hold every collection in the product: which ones commerce
 * writes, which ones marketing writes, and which console page each deep-links
 * to. That is the platform keeping a map of its plugins' storage, and the map
 * went stale exactly where a stale map is invisible — three of its deep links
 * pointed at a hub that did not hold the document, and nothing could tell.
 *
 * So a plugin declares its own collections in `plugins.config.json` and the
 * readers ask `plugin-manager/plugin-host-collections`. What is left here is
 * core's own storage, which is the only part core is entitled to name.
 *
 * ## What keeps these lists from rotting
 *
 * `host-content-media-coverage.spec.ts` sweeps `apps/**` and `libs/**` for host
 * subcollection names — the same derived sweep
 * `host-subcollection-write-deny-coverage.spec.ts` uses, for the same reason —
 * and asserts the sweep is EXACTLY these three lists plus the plugins'
 * declarations. A new collection fails the build with a one-line decision to
 * make, and the default answer — declare it scanned, on the plugin that writes
 * it — is also the safe one.
 *
 * ## The plugin boundary was NOT crossed to do this
 *
 * Worth stating, because "read plugin data into a first-party corpus" sounds
 * like it should be. It is not, and the reason is that "plugin" means two
 * disjoint things:
 *
 *  - a SANDBOXED marketplace plugin runs in an iframe on a separate origin and
 *    has no Firestore access at all — `plugin-bridge.ts` is the whole protocol
 *    and its guest verbs are `ready`, `resize`, `event`, `fetch-request` and
 *    `error`, with `parseGuestMessage` rejecting anything else. It owns no
 *    documents, so there is nothing here to reach into.
 *  - a FIRST-PARTY feature plugin under `libs/plugins/*` is compiled into the
 *    apps and writes ORDINARY host subcollections with the ordinary SDKs. Those
 *    documents already sit under the same `hosts/{hostId}` rules as a screen,
 *    are already read by first-party console pages, and are already covered by
 *    the same scope check the scan runs before it reads anything.
 *
 * So the corpus grows to include documents the caller could already read
 * through the console, under an authorization decision that has not changed.
 * Nothing in the sandbox boundary is bypassed, because no sandboxed guest owns
 * any of this.
 */

/**
 * Host subcollections the media scan reads through its own dedicated machinery.
 *
 * Not "excluded" — covered, by a pass that knows their shape. Screens, layouts,
 * components and email templates each hang a node tree off
 * `…/versions/{versionId}` and get the published-version and history passes;
 * `collections` is walked one level deeper, into `…/entries`.
 */
export const CORE_CONTENT_COLLECTIONS = [
  'screens',
  'layouts',
  'components',
  'emailTemplates',
  'collections',
] as const

/**
 * Core's own host subcollections that the scan reads generically.
 *
 * Generically: no per-collection field list and no per-collection decoder.
 * Each document is flattened by `documentHaystack` — which decodes `nodes` and
 * `elements` through `decodeStoredNodes` first — and the matching field's
 * dotted path is recovered by walking the document. A field list here would be
 * the same staleness trap `referencingFieldPath` was written to avoid one
 * level down.
 *
 * Short because it is only core's: a blog author, the per-plugin settings
 * document the plugin manager owns, and a site template. Everything else that
 * is scanned generically belongs to a plugin and is declared by it.
 */
export const CORE_GENERIC_SCAN_COLLECTIONS = [
  'authors',
  'pluginSettings',
  'templates',
] as const

/**
 * Core's own host subcollections that the media scan deliberately does NOT
 * read, and why.
 *
 * Every entry has to answer one of two questions: what would scanning it cost,
 * or what would scanning it get wrong. "It probably has no images in it" is not
 * an accepted reason — that is the guess this file is arranged to avoid making.
 * A plugin's exclusions carry the same burden and live in its own declaration,
 * where `mediaScanReason` is required with `mediaScan: 'none'`.
 */
export const MEDIA_SCAN_EXCLUDED: Record<string, string> = {
  media:
    'The library itself. The asset under audit IS a document in here, and ' +
    'its own record holds its own url, cdnPath and storage path — every ' +
    'needle the scan carries. Reading this collection would report every ' +
    'asset as referencing itself, which turns a deletion-safety control into ' +
    'noise that nobody reads.',
  mediaFolders:
    'Folder records: a name, a parent pointer and a scope. A folder never ' +
    'holds an asset reference, and it is not a dependent either — deleting a ' +
    'file does not break the folder it sat in.',
  analytics:
    'Per-day traffic rollups written by the tenant collector. One document ' +
    'per day per site forever, no author-editable field, and no surface that ' +
    'can pick an asset into one.',
  screenAnalytics:
    'Per-screen traffic history behind the Pro+ panel, written by the same ' +
    'collector on the same unbounded per-day cadence.',
  counters:
    'Quota and usage counters, server-owned (AGL-1367) and denied to client ' +
    'writes outright. Numbers, not content.',
  activity:
    'The site activity feed — an append-only audit log the console writes a ' +
    'row into on every change. Unbounded by design, and a row that quotes an ' +
    'asset id is a record that somebody touched it, not a place it is used.',
  members:
    'The ORG-facing member roster mirrored onto the site, server-owned ' +
    '(AGL-1367). A member\'s photo is their own account photo, uploaded ' +
    'through /api/account/photo and stored outside any site\'s library, so it ' +
    'is not an asset this scan can be asked about.',
}

/**
 * What to call one of these in a reference row.
 *
 * Derived from the collection name rather than declared, so a newly scanned
 * collection gets a readable label without a second list to keep in step —
 * `productCategories` reads as "Product category". Singularised with the two
 * rules English spells consistently enough to be worth automating; anything
 * else keeps its name, which is a cosmetic miss rather than a coverage one.
 *
 * Shared with `pluginHostCollectionLabel`, which prefers a plugin's declared
 * label and falls back to exactly this.
 */
export function hostContentCollectionLabel(collection: string): string {
  const singular = /ies$/.test(collection)
    ? collection.replace(/ies$/, 'y')
    : /(ss|s)$/.test(collection)
      ? collection.replace(/s$/, '')
      : collection
  const spaced = singular.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}
