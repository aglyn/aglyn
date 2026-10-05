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

import { REUSABLE_INSTANCE_COMPONENT_ID } from '../app-utils/reusable-component-keys'
import { SCREEN_KIND_EMAIL } from '../app-utils/screen-route'
import { listPluginSiteExportCollections } from '../plugin-manager/plugin-site-export'
import {
  listDeclaredSiteBundleSections,
  type PluginSiteBundleSectionPackage,
} from '../plugin-manager/plugin-site-bundle'
import {
  contentHash,
  keepBothSlug,
  matchPackageItems,
  packageDecisionsFor,
  packageDependencyClosure,
  packageItemKey,
  proposePackageDecision,
  readPackageManifest,
  TRANSFER_PACKAGE_FORMAT,
  TRANSFER_PACKAGE_VERSION,
  type ExistingPackageItem,
  type PackageDependency,
  type PackageItemComparison,
  type PackageItemDecision,
  type PackageItemStatus,
  type PackageManifest,
  type PackageManifestItem,
  type TransferPackage,
} from './package'

/*==========================================
 * SITE PACKAGES — a site's items as one `aglyn-package` file (AGL-3533).
 *
 * The whole-site backup used to be one all-or-nothing bundle restored by
 * id. A site package lists every item instead — each page, layout,
 * component, form, redirect, dataset… — with a content hash and the items
 * it depends on, so an export can carry a chosen few (with what they
 * need) and an import can say, before it writes anything, which items are
 * new, which the site already holds unchanged, and which differ.
 *
 * This module is pure: no Firestore, no Node builtin, no React. The console
 * routes read and write; here is what the items ARE, how one names
 * another, how references move when an item lands under a new id, and what
 * the import would do with each item.
 *
 * Reached by its own subpath (`@aglyn/aglyn/data-transfer/site-package`),
 * never through `@aglyn/aglyn/data-transfer`: it reads the compiled plugin
 * declarations, which the generic core does not.
 *
 * ## Kinds
 *
 * The platform's own (`settings`, `theme`, `page`, `email`, `emailTemplate`,
 * `layout`, `component`, `author`, `collection`, the four media kinds and
 * `savedTheme`) are listed here. A plugin's are declared beside its data in
 * `plugins.config.json` — a host collection's `siteExport.package`, or a
 * backup section's `package` — and read from the compiled declarations, so
 * this module names no plugin.
 *
 * ## Item content
 *
 * An item's content is the document a v1 backup carried for it, without
 * its `$id` (the manifest holds that): a page with its published `version`
 * and its address in the routing map as `route`, a collection with its
 * `entries`, a section's item as the plugin exported it. The site's own
 * fields are two singleton items, `settings/settings` and `theme/theme`.
 *
 * ## References
 *
 * An item depends on another when it names its id. The kinds say where
 * names are typed (`layoutId` is a layout, a reusable component placement's
 * `refId` is a component, `{{var:id}}` is the kind that declares the `var`
 * token), so a dependency on an item that exists nowhere can still be
 * reported. Beyond those, any string or map key in the content that is, or
 * contains as a whole token, the id of another known item is a dependency:
 * links (`screen:<id>`), media references and the long tail of id-bearing
 * props are covered without a list that would always be one prop short.
 * Ids that are words (a catalog key, `default`) are never searched for.
 *
 * Moving references is the same walk: every exact id and every whole
 * token naming one is rewritten through an id map, and a reference the
 * person chose to drop becomes `null` (a field), disappears (a map key, a
 * list entry, a binding token) or empties the string that held it.
 *=========================================*/

/*==========================================
 * KINDS
 *=========================================*/

/** Where a kind is declared. */
export type SitePackageKindSource = 'platform' | 'collection' | 'section'

/** A field of an item that holds the id of another item. */
export interface SitePackageReferenceField {
  field: string
  /** The kinds the id may name, tried in order against what is known. */
  kinds: readonly string[]
  /** `values`: the field is a map whose values are ids; `items`: a list of ids. */
  each?: 'values' | 'items'
}

/** A node prop that names an item of the kind that declares it. */
export interface SitePackagePlacement {
  /** Only nodes of this component; any node when absent. */
  componentId?: string
  prop: string
}

/** One kind of item a site package carries. */
export interface SitePackageKind {
  kind: string
  /** Plural, for the import screen. */
  label: string
  source: SitePackageKindSource
  /**
   * Where a v1 backup carries the kind: its array (`screens`, a plugin
   * collection's name, a section's key), or `host` for the site's fields.
   */
  bundleKey: string
  /** The field an item with a new id is matched by first. */
  slugField?: string
  /** …and second. */
  nameField?: string
  /** Settings and the theme merge key by key. */
  mergeable?: boolean
  /** A replace writes the incoming design as a new version. */
  versioned?: boolean
  /** Its ids are words, never searched for inside other items' text. */
  wordIds?: boolean
  /** Its own id inside its own content is left alone when it moves (a stored file's address). */
  keepsOwnId?: boolean
  references?: readonly SitePackageReferenceField[]
  bindingToken?: 'var' | 'fn'
  placements?: readonly SitePackagePlacement[]
  /** The one id a singleton kind is filed under. */
  singletonId?: string
  /** Its ids are fixed (a singleton, a catalog key): an item cannot be kept as a copy. */
  noCopies?: boolean
}

/** The singleton id of the site's settings item. */
export const SITE_SETTINGS_ITEM_ID = 'settings'
/** The singleton id of the site's theme item. */
export const SITE_THEME_ITEM_ID = 'theme'

/** The two kinds a site's screens are listed as. */
export const SITE_SCREEN_KINDS = ['page', 'email'] as const

const SCREEN_REFS = SITE_SCREEN_KINDS

/** The platform's own kinds, in the order an export lists them. */
export const PLATFORM_SITE_PACKAGE_KINDS: readonly SitePackageKind[] = [
  {
    kind: 'settings',
    label: 'Site settings',
    source: 'platform',
    bundleKey: 'host',
    mergeable: true,
    wordIds: true,
    noCopies: true,
    singletonId: SITE_SETTINGS_ITEM_ID,
    references: [
      { field: 'notFoundScreenId', kinds: SCREEN_REFS },
      { field: 'errorScreens', kinds: SCREEN_REFS, each: 'values' },
    ],
  },
  {
    kind: 'theme',
    label: 'Theme',
    source: 'platform',
    bundleKey: 'host',
    mergeable: true,
    wordIds: true,
    noCopies: true,
    singletonId: SITE_THEME_ITEM_ID,
  },
  {
    kind: 'page',
    label: 'Pages',
    source: 'platform',
    bundleKey: 'screens',
    slugField: 'slug',
    nameField: 'displayName',
    versioned: true,
    references: [
      { field: 'layoutId', kinds: ['layout'] },
      { field: 'parentId', kinds: SCREEN_REFS },
      { field: 'localeVariants', kinds: SCREEN_REFS, each: 'values' },
    ],
  },
  {
    kind: 'email',
    label: 'Email designs',
    source: 'platform',
    bundleKey: 'screens',
    slugField: 'slug',
    nameField: 'displayName',
    versioned: true,
    references: [
      { field: 'layoutId', kinds: ['layout'] },
      { field: 'parentId', kinds: SCREEN_REFS },
    ],
  },
  {
    kind: 'emailTemplate',
    label: 'Site emails',
    source: 'platform',
    bundleKey: 'emailTemplates',
    versioned: true,
    wordIds: true,
    noCopies: true,
  },
  {
    kind: 'layout',
    label: 'Layouts',
    source: 'platform',
    bundleKey: 'layouts',
    nameField: 'displayName',
    versioned: true,
    references: [{ field: 'layoutId', kinds: ['layout'] }],
  },
  {
    kind: 'component',
    label: 'Components',
    source: 'platform',
    bundleKey: 'components',
    nameField: 'displayName',
  },
  {
    kind: 'author',
    label: 'Authors',
    source: 'platform',
    bundleKey: 'authors',
    slugField: 'slug',
    nameField: 'name',
  },
  {
    kind: 'collection',
    label: 'Collections',
    source: 'platform',
    bundleKey: 'collections',
    slugField: 'slug',
    nameField: 'displayName',
    references: [
      { field: 'listScreenId', kinds: SCREEN_REFS },
      { field: 'entryScreenId', kinds: SCREEN_REFS },
      { field: 'templateScreenId', kinds: SCREEN_REFS },
    ],
  },
  {
    kind: 'mediaFolder',
    label: 'Media folders (workspace library)',
    source: 'platform',
    bundleKey: 'mediaFolders',
    references: [{ field: 'parentId', kinds: ['mediaFolder'] }],
  },
  {
    kind: 'media',
    label: 'Media (workspace library)',
    source: 'platform',
    bundleKey: 'media',
    keepsOwnId: true,
    references: [{ field: 'folderId', kinds: ['mediaFolder'] }],
  },
  {
    kind: 'siteMediaFolder',
    label: 'Media folders (site library)',
    source: 'platform',
    bundleKey: 'hostMediaFolders',
    references: [{ field: 'parentId', kinds: ['siteMediaFolder'] }],
  },
  {
    kind: 'siteMedia',
    label: 'Media (site library)',
    source: 'platform',
    bundleKey: 'hostMedia',
    keepsOwnId: true,
    references: [{ field: 'folderId', kinds: ['siteMediaFolder'] }],
  },
  {
    kind: 'savedTheme',
    label: 'Saved themes',
    source: 'platform',
    bundleKey: 'themes',
    nameField: 'name',
    wordIds: true,
  },
]

/**
 * Every kind a site package carries: the platform's, then each host
 * collection a plugin declares for the backup, then each backup section, in
 * config order. Throws when two declare one kind — the generator refuses
 * that, so it only fires for a hand-edited catalog.
 */
export function listSitePackageKinds(): SitePackageKind[] {
  const kinds: SitePackageKind[] = [...PLATFORM_SITE_PACKAGE_KINDS]
  for (const declared of listPluginSiteExportCollections()) {
    const pkg = declared.package
    kinds.push({
      kind: pkg.kind,
      label: pkg.label,
      source: 'collection',
      bundleKey: declared.collection,
      ...(pkg.slugField ? { slugField: pkg.slugField } : {}),
      ...(pkg.nameField ? { nameField: pkg.nameField } : {}),
      references: (pkg.references ?? []).map((ref) => ({ field: ref.field, kinds: [ref.kind] })),
      ...(pkg.bindingToken ? { bindingToken: pkg.bindingToken } : {}),
      ...(pkg.placements?.length ? { placements: pkg.placements } : {}),
    })
  }
  for (const declared of listDeclaredSiteBundleSections()) {
    const pkg = declared.package
    kinds.push({
      kind: pkg.kind,
      label: pkg.label,
      source: 'section',
      bundleKey: declared.key,
      ...(pkg.slugField ? { slugField: pkg.slugField } : {}),
      ...(pkg.nameField ? { nameField: pkg.nameField } : {}),
      ...(pkg.placements?.length ? { placements: pkg.placements } : {}),
    })
  }
  const seen = new Set<string>()
  for (const one of kinds) {
    if (seen.has(one.kind)) throw new Error(`site package kind "${one.kind}" is declared twice`)
    seen.add(one.kind)
  }
  return kinds
}

/** The kinds by name. */
export function sitePackageKindMap(kinds = listSitePackageKinds()): ReadonlyMap<string, SitePackageKind> {
  return new Map(kinds.map((one) => [one.kind, one]))
}

/*==========================================
 * ITEMS, AND THE v1 BACKUP THEY ARE READ FROM AND WRITTEN AS
 *=========================================*/

/** One item: its kind, its id and its content (the document, without `$id`). */
export interface SitePackageItem<T = Record<string, unknown>> {
  kind: string
  id: string
  content: T
}

/**
 * What the console's write path decides and this module must agree with:
 * the site fields each singleton carries and the most items of each v1
 * array an import reads.
 */
export interface SitePackageContract {
  /** The host fields the `settings` item carries (the routing map is the pages'). */
  settingsFields: readonly string[]
  /** The host fields the `theme` item carries. */
  themeFields: readonly string[]
  /** The most items one array carries, by v1 key; a key absent is not capped here. */
  limits: Readonly<Record<string, number>>
}

/** The routing map's host field: screen id → address. */
export const SITE_ROUTING_MAP_FIELD = 'screens'

/** A v1 backup's arrays and host block, as far as this module reads them. */
export type SiteBundle = Record<string, unknown> & { host?: Record<string, unknown> }

type Doc = Record<string, unknown>

/**
 * A plain object, from any realm: one whose prototype is some realm's
 * `Object.prototype` (itself prototype-less) or `null`. A request body parsed
 * by the platform's fetch is a plain object of the host realm, not the
 * module's, so identity with this realm's `Object.prototype` is not the test.
 * Class instances — a `Timestamp`, a `Buffer` — are not plain.
 */
export function isPlainSiteObject(value: unknown): value is Doc {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === null || Object.getPrototypeOf(proto) === null
}

function asDoc(value: unknown): Doc {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Doc) : {}
}

function pick(source: Doc, fields: readonly string[]): Doc | null {
  const out: Doc = {}
  for (const field of fields) if (source[field] !== undefined) out[field] = source[field]
  return Object.keys(out).length ? out : null
}

/** The kind a screen is listed as: an email design, or a page. */
export function screenPackageKind(screen: Doc): 'page' | 'email' {
  return screen['kind'] === SCREEN_KIND_EMAIL ? 'email' : 'page'
}

/**
 * A v1 backup's documents as package items, in kind order. Each array is
 * capped at the contract's limit for it; a document with no `$id` is not an
 * item. A screen's address in the routing map travels with it as `route`;
 * an address naming a screen the backup does not carry is not an item and
 * is dropped.
 */
export function siteBundleItems(
  bundle: SiteBundle,
  contract: SitePackageContract,
  kinds: readonly SitePackageKind[] = listSitePackageKinds(),
): SitePackageItem[] {
  const host = asDoc(bundle.host)
  const routes = asDoc(host[SITE_ROUTING_MAP_FIELD])
  const items: SitePackageItem[] = []
  const arrays = new Map<string, Doc[]>()
  const array = (key: string): Doc[] => {
    if (!arrays.has(key)) {
      const raw = Array.isArray(bundle[key]) ? (bundle[key] as unknown[]) : []
      const limit = contract.limits[key]
      arrays.set(key, (limit === undefined ? raw : raw.slice(0, limit)).map(asDoc))
    }
    return arrays.get(key) as Doc[]
  }
  for (const kind of kinds) {
    if (kind.singletonId) {
      const fields = kind.kind === 'theme' ? contract.themeFields : kind.kind === 'settings' ? contract.settingsFields : []
      const content = pick(host, fields)
      if (content) items.push({ kind: kind.kind, id: kind.singletonId, content })
      continue
    }
    for (const doc of array(kind.bundleKey)) {
      const id = doc['$id']
      if (typeof id !== 'string' && typeof id !== 'number') continue
      if (kind.bundleKey === 'screens' && screenPackageKind(doc) !== kind.kind) continue
      const { $id: _id, ...rest } = doc
      const content: Doc = { ...rest }
      if (kind.bundleKey === 'screens') {
        const route = routes[String(id)]
        if (typeof route === 'string') content['route'] = route
        else delete content['route']
      }
      items.push({ kind: kind.kind, id: String(id), content })
    }
  }
  return items
}

/** An item as an import writes it: under `targetId`, its references moved. */
export interface SitePackageWrite {
  /** `<kind>/<id>` in the package. */
  key: string
  kind: string
  /** Its id in the package. */
  sourceId: string
  /** The id it is written under. */
  targetId: string
  decision: Exclude<PackageItemDecision, 'skip'>
  content: Doc
  /** The site item it replaces or merges into, by key. */
  existingKey?: string
}

/** What a v1-shaped write needs: the arrays, and the host fields to merge. */
export interface SiteBundleWrite {
  bundle: Record<string, Doc[]>
  /**
   * The host fields to write with `merge: true`: settings and theme fields,
   * and `screens` holding the address of each page written with one.
   */
  hostPatch: Doc
}

/**
 * Writes as the v1 shape the restore's writers read: each kind's documents
 * under its array, with `$id` set to the id it is written under, and the
 * site's own fields as one host patch.
 */
export function siteWritesToBundle(
  writes: readonly SitePackageWrite[],
  kinds: ReadonlyMap<string, SitePackageKind> = sitePackageKindMap(),
): SiteBundleWrite {
  const bundle: Record<string, Doc[]> = {}
  const hostPatch: Doc = {}
  const routes: Doc = {}
  for (const write of writes) {
    const kind = kinds.get(write.kind)
    if (!kind) throw new Error(`site package kind "${write.kind}" is not one this site reads`)
    if (kind.singletonId) {
      Object.assign(hostPatch, write.content)
      continue
    }
    const { route, ...rest } = write.content
    if (kind.bundleKey === 'screens' && typeof route === 'string') routes[write.targetId] = route
    // The id last: a content's own `$id` never chooses where it is written.
    ;(bundle[kind.bundleKey] ??= []).push({ ...(kind.bundleKey === 'screens' ? rest : write.content), $id: write.targetId })
  }
  if (Object.keys(routes).length) hostPatch[SITE_ROUTING_MAP_FIELD] = routes
  return { bundle, hostPatch }
}

/*==========================================
 * REFERENCES
 *=========================================*/

/** Ids searched for inside text are at least this long, so a word is never one. */
export const SITE_REFERENCE_MIN_ID_LENGTH = 8

const ID_TOKEN = /[A-Za-z0-9_-]+/g
const VAR_TOKEN = /\{\{\s*var:([a-zA-Z0-9_-]{1,64})\s*\}\}/g
const FN_TOKEN = /\{\{\s*fn:([a-zA-Z0-9_-]{1,64})(?: [a-zA-Z0-9_-]{1,64})*\s*\([^)]*\)\s*\}\}/g

/** What the items being described can see: every item's kind by its id. */
export interface SiteReferenceIndex {
  /** The kinds an id is known as, among the items this description can see. */
  kindsOf(id: string): readonly string[]
  /** Whether ids of this kind are searched for inside text. */
  searchable(id: string): boolean
}

/** An index over items (the package's, and the site's when importing). */
export function siteReferenceIndex(
  items: Iterable<{ kind: string; id: string }>,
  kinds: ReadonlyMap<string, SitePackageKind> = sitePackageKindMap(),
): SiteReferenceIndex {
  const byId = new Map<string, string[]>()
  for (const item of items) {
    const list = byId.get(item.id) ?? []
    if (!list.includes(item.kind)) list.push(item.kind)
    byId.set(item.id, list)
  }
  return {
    kindsOf: (id) => byId.get(id) ?? [],
    searchable: (id) =>
      id.length >= SITE_REFERENCE_MIN_ID_LENGTH &&
      (byId.get(id) ?? []).some((kind) => !kinds.get(kind)?.wordIds),
  }
}

function eachString(value: unknown, visit: (text: string) => void, keys = true): void {
  if (typeof value === 'string') {
    visit(value)
    return
  }
  if (Array.isArray(value)) {
    for (const entry of value) eachString(entry, visit, keys)
    return
  }
  if (value && typeof value === 'object' && !ArrayBuffer.isView(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (keys) visit(key)
      eachString(entry, visit, keys)
    }
  }
}

/** The node maps an item's content holds: its own, and its published version's. */
function nodeMaps(content: Doc): Doc[] {
  const maps: Doc[] = []
  for (const holder of [content, asDoc(content['version'])]) {
    for (const key of ['nodes', 'elements']) {
      const nodes = holder[key]
      if (nodes && typeof nodes === 'object' && !Array.isArray(nodes) && !ArrayBuffer.isView(nodes)) {
        maps.push(nodes as Doc)
      }
    }
  }
  return maps
}

/** What a section answers for its items, by kind. */
export type SitePackageSectionHooks = Readonly<Record<string, PluginSiteBundleSectionPackage>>

/**
 * The items one item depends on: its typed references (fields, node
 * placements, binding tokens) whether or not the item they name is known,
 * then every other known id its content names. Never itself.
 */
export function siteItemDependencies(
  item: SitePackageItem,
  index: SiteReferenceIndex,
  kinds: ReadonlyMap<string, SitePackageKind> = sitePackageKindMap(),
  sections: SitePackageSectionHooks = {},
): PackageDependency[] {
  const kind = kinds.get(item.kind)
  const found = new Map<string, PackageDependency>()
  const add = (depKind: string, id: unknown) => {
    if (typeof id !== 'string' || !id) return
    if (depKind === item.kind && id === item.id) return
    found.set(`${depKind}/${id}`, { kind: depKind, id })
  }
  const typed = (candidates: readonly string[], id: unknown) => {
    if (typeof id !== 'string' || !id) return
    const known = index.kindsOf(id)
    add(candidates.find((one) => known.includes(one)) ?? (candidates[0] as string), id)
  }
  const content = item.content
  for (const ref of kind?.references ?? []) {
    const value = content[ref.field]
    if (ref.each === 'values') for (const entry of Object.values(asDoc(value))) typed(ref.kinds, entry)
    else if (ref.each === 'items') for (const entry of Array.isArray(value) ? value : []) typed(ref.kinds, entry)
    else typed(ref.kinds, value)
  }
  if (kind?.versioned) typed(['layout'], asDoc(content['version'])['layoutId'])
  if (item.kind === 'collection') {
    for (const entry of Array.isArray(content['entries']) ? content['entries'] : []) {
      typed(['author'], asDoc(entry)['authorId'])
    }
  }
  const placements: Array<{ kind: string } & SitePackagePlacement> = []
  const tokenKinds: Record<string, string> = {}
  for (const one of kinds.values()) {
    for (const placement of one.placements ?? []) placements.push({ kind: one.kind, ...placement })
    if (one.bindingToken) tokenKinds[one.bindingToken] = one.kind
  }
  for (const nodes of nodeMaps(content)) {
    for (const node of Object.values(nodes)) {
      const shape = asDoc(node)
      const props = asDoc(shape['props'])
      if (shape['componentId'] === REUSABLE_INSTANCE_COMPONENT_ID) typed(['component'], props['refId'])
      for (const placement of placements) {
        if (placement.componentId && placement.componentId !== shape['componentId']) continue
        typed([placement.kind], props[placement.prop])
      }
    }
  }
  eachString(
    content,
    (text) => {
      if (!text.includes('{{')) return
      if (tokenKinds['var']) for (const match of text.matchAll(VAR_TOKEN)) typed([tokenKinds['var']], match[1])
      if (tokenKinds['fn']) for (const match of text.matchAll(FN_TOKEN)) typed([tokenKinds['fn']], match[1])
    },
    false,
  )
  const section = sections[item.kind]
  if (section) {
    for (const dep of section.dependencies({ $id: item.id, ...content })) add(dep.kind, dep.id)
  }
  eachString(content, (text) => {
    for (const token of text.match(ID_TOKEN) ?? []) {
      if (token === item.id || !index.searchable(token)) continue
      for (const known of index.kindsOf(token)) {
        if (!found.has(`${known}/${token}`) && !kinds.get(known)?.wordIds) add(known, token)
      }
    }
  })
  return [...found.values()]
}

/** An id map for moving references: an id to its new id, or `null` to drop the reference. */
export type SiteIdMap = ReadonlyMap<string, string | null>

function remapString(text: string, ids: SiteIdMap): string | null {
  if (ids.has(text)) return ids.get(text) as string | null
  let dropped = false
  const withoutTokens = text
    .replace(VAR_TOKEN, (whole, id: string) => (ids.has(id) ? (ids.get(id) === null ? '' : whole.replace(id, ids.get(id) as string)) : whole))
    .replace(FN_TOKEN, (whole, id: string) => (ids.has(id) ? (ids.get(id) === null ? '' : whole.replace(id, ids.get(id) as string)) : whole))
  const next = withoutTokens.replace(ID_TOKEN, (token) => {
    // Inside text only an id long enough never to be a word is moved; an
    // exact value or a map key is moved whatever its length.
    if (token.length < SITE_REFERENCE_MIN_ID_LENGTH || !ids.has(token)) return token
    const moved = ids.get(token)
    if (moved === null) dropped = true
    return moved ?? token
  })
  return dropped ? '' : next
}

/**
 * The value with every reference in `ids` moved: an exact id, a whole
 * token inside a string, a map key. A dropped reference is `null` in a
 * field, gone from a list or a map, gone as a binding token, and empties
 * any other string it sat in. Unchanged parts keep their identity.
 */
export function remapSiteReferences<T>(value: T, ids: SiteIdMap): T {
  if (!ids.size) return value
  const walk = (current: unknown): unknown => {
    if (typeof current === 'string') return remapString(current, ids)
    if (Array.isArray(current)) {
      let changed = false
      const next: unknown[] = []
      for (const entry of current) {
        const moved = walk(entry)
        if (moved !== entry) changed = true
        if (moved === null && typeof entry === 'string') continue
        next.push(moved)
      }
      return changed ? next : current
    }
    if (isPlainSiteObject(current)) {
      let changed = false
      const next: Doc = {}
      for (const [key, entry] of Object.entries(current)) {
        let target = key
        if (ids.has(key)) {
          changed = true
          const moved = ids.get(key)
          if (moved === null) continue
          target = moved as string
        }
        const value = walk(entry)
        if (value !== entry) changed = true
        next[target] = value
      }
      return changed ? next : current
    }
    return current
  }
  return walk(value) as T
}

/*==========================================
 * PACKAGES
 *=========================================*/

/** How an item is hashed: by default its content as is. */
export type SiteItemHasher = (item: SitePackageItem) => Promise<string>

/** What an item is called on the import screen, and matched by. */
export function describeSiteItem(
  item: SitePackageItem,
  kinds: ReadonlyMap<string, SitePackageKind> = sitePackageKindMap(),
): { slug?: string; name?: string } {
  const kind = kinds.get(item.kind)
  const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value : undefined)
  if (kind?.singletonId) return { name: kind.label }
  const slug = kind?.slugField ? text(item.content[kind.slugField]) : undefined
  const name =
    (kind?.nameField ? text(item.content[kind.nameField]) : undefined) ??
    text(item.content['displayName']) ??
    text(item.content['name']) ??
    text(item.content['title']) ??
    text(item.content['fileName'])
  return { ...(slug ? { slug } : {}), ...(name ? { name } : {}) }
}

/** A site package: the manifest, and each item's content by `<kind>/<id>`. */
export type SitePackage = TransferPackage<Doc>

/**
 * Builds a package from items: each hashed (by `hash`, or its content), named,
 * and given its dependencies against `index` — the items themselves, and the
 * site's own when an import is describing what it received.
 */
export async function buildSitePackage(
  items: readonly SitePackageItem[],
  options: {
    hash?: SiteItemHasher
    index?: SiteReferenceIndex
    kinds?: ReadonlyMap<string, SitePackageKind>
    sections?: SitePackageSectionHooks
    createdAt?: number
    source?: string
  } = {},
): Promise<SitePackage> {
  const kinds = options.kinds ?? sitePackageKindMap()
  const index = options.index ?? siteReferenceIndex(items, kinds)
  const hash = options.hash ?? ((item: SitePackageItem) => contentHash(item.content))
  const manifestItems: PackageManifestItem[] = []
  const contents: Record<string, Doc> = {}
  for (const item of items) {
    const entry: PackageManifestItem = {
      kind: item.kind,
      $id: item.id,
      ...describeSiteItem(item, kinds),
      contentHash: await hash(item),
      deps: siteItemDependencies(item, index, kinds, options.sections),
    }
    const key = packageItemKey(entry)
    if (contents[key]) {
      // Two documents under one id are one document on the site: the later
      // one is what a v1 restore left standing, so it is what is kept.
      const at = manifestItems.findIndex((one) => packageItemKey(one) === key)
      manifestItems.splice(at, 1)
    }
    manifestItems.push(entry)
    contents[key] = item.content
  }
  return {
    manifest: {
      format: TRANSFER_PACKAGE_FORMAT,
      version: TRANSFER_PACKAGE_VERSION,
      items: manifestItems,
      ...(options.createdAt !== undefined ? { createdAt: options.createdAt } : {}),
      ...(options.source ? { source: options.source } : {}),
    },
    items: contents,
  }
}

/** The package's items, back as items. */
export function sitePackageItems(pkg: SitePackage): SitePackageItem[] {
  return pkg.manifest.items.map((entry) => ({
    kind: entry.kind,
    id: entry.$id,
    content: asDoc(pkg.items[packageItemKey(entry)]),
  }))
}

/**
 * The chosen items, and — with `includeDependencies` — everything they need
 * inside the package, transitively. Keys are `<kind>/<id>`; an unknown key
 * is ignored. The manifest keeps every item's full dependency list, so an
 * import can say which ones the file does not carry.
 */
export function selectSitePackage(
  pkg: SitePackage,
  keys: Iterable<string>,
  includeDependencies: boolean,
): SitePackage {
  const wanted = new Set(
    includeDependencies ? packageDependencyClosure(pkg.manifest.items, keys) : [...keys],
  )
  const items = pkg.manifest.items.filter((entry) => wanted.has(packageItemKey(entry)))
  return {
    manifest: { ...pkg.manifest, items },
    items: Object.fromEntries(items.map((entry) => [packageItemKey(entry), pkg.items[packageItemKey(entry)]])),
  }
}

/** The manifest without the content: the export picker's catalog. */
export function sitePackageCatalog(pkg: SitePackage): PackageManifest {
  return pkg.manifest
}

/** A package read from a file, or why it cannot be. */
export type SitePackageRead =
  | { ok: true; items: SitePackageItem[]; manifest: PackageManifest; unknownKinds: string[] }
  | { ok: false; problems: string[] }

/**
 * A v2 package from untrusted JSON: the manifest checked by the core, every
 * listed item's content present and an object, and items of kinds this
 * site does not read set aside (named in `unknownKinds`) rather than
 * refusing the file — a package from a site with a plugin this one lacks
 * still imports the rest.
 */
export function readSitePackage(
  raw: unknown,
  kinds: ReadonlyMap<string, SitePackageKind> = sitePackageKindMap(),
): SitePackageRead {
  const file = asDoc(raw)
  const read = readPackageManifest(file['manifest'])
  if (read.ok === false) return { ok: false, problems: read.problems }
  const contents = asDoc(file['items'])
  const problems: string[] = []
  const items: SitePackageItem[] = []
  const unknown = new Set<string>()
  for (const entry of read.manifest.items) {
    const key = packageItemKey(entry)
    const content = contents[key]
    if (!content || typeof content !== 'object' || Array.isArray(content)) {
      problems.push(`${key} is listed and its content is missing.`)
      continue
    }
    if (!kinds.has(entry.kind)) {
      unknown.add(entry.kind)
      continue
    }
    const kind = kinds.get(entry.kind) as SitePackageKind
    if (kind.singletonId && entry.$id !== kind.singletonId) {
      problems.push(`${key} is a ${entry.kind} item filed under an id other than "${kind.singletonId}".`)
      continue
    }
    // The manifest names the item; an `$id` inside its content is not a second say.
    const { $id: _ignored, ...rest } = content as Doc
    items.push({ kind: entry.kind, id: entry.$id, content: rest })
  }
  if (problems.length) return { ok: false, problems }
  return { ok: true, items, manifest: read.manifest, unknownKinds: [...unknown] }
}

/*==========================================
 * THE IMPORT PLAN — nothing written
 *=========================================*/

/** One item of the plan the import screen shows. */
export interface SitePackagePlanItem {
  key: string
  kind: string
  id: string
  name?: string
  slug?: string
  status: PackageItemStatus
  comparison: PackageItemComparison
  /** The site item it was matched to, and how. */
  existing?: { id: string; name?: string; slug?: string }
  matchedBy?: 'id' | 'slug' | 'name'
  /** What it needs, and of that what neither the package nor the site holds. */
  deps: PackageDependency[]
  missing: PackageDependency[]
  /** The decision proposed, and whether the person must make one. */
  proposed: PackageItemDecision
  needsChoice: boolean
  /** Every decision the item may take. */
  choices: PackageItemDecision[]
}

/** The plan for a whole package. */
export interface SitePackagePlan {
  items: SitePackagePlanItem[]
  counts: Record<PackageItemStatus, number>
  /** Each kind present, with its label and how many items. */
  kinds: Array<{ kind: string; label: string; count: number }>
}

/** A site item as the plan compares against it. */
export type SiteExistingItem = ExistingPackageItem

/**
 * Every incoming item against the site: matched by id, then slug, then name
 * within its kind; `identical` when the hashes agree; `missingDependency`
 * when it names an item neither side holds. Proposes create for new items
 * and skip for everything else — replacing is never assumed.
 */
export function planSitePackageImport(
  incoming: SitePackage,
  existing: readonly SiteExistingItem[],
  kinds: ReadonlyMap<string, SitePackageKind> = sitePackageKindMap(),
): SitePackagePlan {
  const matches = matchPackageItems(incoming.manifest, existing)
  const counts: Record<PackageItemStatus, number> = { new: 0, identical: 0, differs: 0, missingDependency: 0 }
  const perKind = new Map<string, number>()
  const items = matches.map((match): SitePackagePlanItem => {
    const kind = kinds.get(match.item.kind)
    const proposed = proposePackageDecision(match)
    counts[match.status] += 1
    perKind.set(match.item.kind, (perKind.get(match.item.kind) ?? 0) + 1)
    return {
      key: packageItemKey(match.item),
      kind: match.item.kind,
      id: match.item.$id,
      ...(match.item.name ? { name: match.item.name } : {}),
      ...(match.item.slug ? { slug: match.item.slug } : {}),
      status: match.status,
      comparison: match.comparison,
      ...(match.existing
        ? {
            existing: {
              id: match.existing.id,
              ...(match.existing.name ? { name: match.existing.name } : {}),
              ...(match.existing.slug ? { slug: match.existing.slug } : {}),
            },
            matchedBy: match.matchedBy,
          }
        : {}),
      deps: match.item.deps,
      missing: match.missing,
      proposed: proposed.decision,
      needsChoice: proposed.needsChoice,
      choices: packageDecisionsFor(match, Boolean(kind?.mergeable)).filter(
        // A singleton or a catalog key has one place to be: a second copy
        // has nowhere to go.
        (choice) => !(kind?.noCopies && choice === 'keepBoth'),
      ),
    }
  })
  return {
    items,
    counts,
    kinds: [...perKind.entries()].map(([kind, count]) => ({
      kind,
      label: kinds.get(kind)?.label ?? kind,
      count,
    })),
  }
}

/*==========================================
 * DECISIONS → WRITES
 *=========================================*/

/**
 * What to do about a dependency neither side will hold after the import:
 * `import` the package's copy (when the package carries it and the person
 * skipped it), map it to an item the site holds (`mapTo`), `drop` the
 * reference, or `keep` it as it is — pointing at nothing until that item
 * exists.
 */
export type SitePackageDependencyChoice = 'import' | 'keep' | 'drop' | { mapTo: string }

/** Whose value one key of a merged item takes. */
export type SitePackageMergeChoice = 'site' | 'package'

/** How the import decides. */
export type SitePackageImportMode =
  /**
   * The person's decisions, each item's own or the proposed one: the
   * import plan's way.
   */
  | 'decide'
  /**
   * A whole-site restore: every item under its own id — created where the
   * site lacks the id, replaced where it holds it — whatever its slug or
   * name, exactly as a v1 backup restored.
   */
  | 'restore'

export interface ResolveSitePackageInput {
  incoming: SitePackage
  plan: SitePackagePlan
  mode: SitePackageImportMode
  /** The person's decision per item key; the proposed one where absent. */
  decisions?: Readonly<Record<string, PackageItemDecision>>
  /** The person's choice per dependency key (`<kind>/<id>`). */
  dependencyChoices?: Readonly<Record<string, SitePackageDependencyChoice>>
  /**
   * For a merged item, whose value each top-level key takes, by item key
   * then key: `site` keeps the site's, `package` takes the file's. A key
   * not named merges as {@link mergeSiteFields} does.
   */
  mergeChoices?: Readonly<Record<string, Readonly<Record<string, SitePackageMergeChoice>>>>
  /** The site's items: their content (for merge) and slugs (for keep both). */
  existing: readonly (SiteExistingItem & { content?: Doc })[]
  /** A new id for an item kept beside an existing one. */
  newId: () => string
  kinds?: ReadonlyMap<string, SitePackageKind>
  sections?: SitePackageSectionHooks
}

/** A warning the import reports beside its writes. */
export interface SitePackageWarning {
  code: 'droppedReference' | 'danglingReference' | 'mappedReference'
  item: string
  dependency: string
  message: string
}

export interface ResolvedSitePackageImport {
  writes: SitePackageWrite[]
  skipped: string[]
  warnings: SitePackageWarning[]
  /** Item key → the id it is written under, for every item that moved. */
  moved: Record<string, string>
}

/** Why the decisions cannot be applied. */
export class SitePackageDecisionError extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join(' '))
    this.name = 'SitePackageDecisionError'
  }
}

/**
 * Site fields filled from the incoming item only where the site holds
 * none, at every depth of a plain object: the site's own value wins
 * wherever it has one.
 */
export function mergeSiteFields(existing: unknown, incoming: unknown): unknown {
  if (existing === undefined || existing === null) return incoming
  if (!isPlainSiteObject(existing) || !isPlainSiteObject(incoming)) return existing
  const out: Doc = { ...(existing as Doc) }
  for (const [key, value] of Object.entries(incoming as Doc)) out[key] = mergeSiteFields(out[key], value)
  return out
}

/**
 * The writes an import makes: which items are written, under which ids,
 * with every reference moved — to an item kept beside an existing one, to
 * the site item an incoming one was matched to, to an item the person
 * mapped a missing dependency onto — and the references dropped.
 */
export function resolveSitePackageImport(input: ResolveSitePackageInput): ResolvedSitePackageImport {
  const kinds = input.kinds ?? sitePackageKindMap()
  const problems: string[] = []
  const planByKey = new Map(input.plan.items.map((item) => [item.key, item]))
  const existingByKey = new Map(input.existing.map((item) => [`${item.kind}/${item.id}`, item]))
  const decided = new Map<string, PackageItemDecision>()
  for (const item of input.plan.items) {
    let decision: PackageItemDecision
    if (input.mode === 'restore') {
      decision = existingByKey.has(item.key) ? 'replace' : 'create'
    } else {
      decision = input.decisions?.[item.key] ?? item.proposed
      if (!item.choices.includes(decision)) {
        problems.push(`${item.key} cannot be "${decision}"; it may be ${item.choices.join(', ')}.`)
      }
    }
    decided.set(item.key, decision)
  }
  for (const key of Object.keys(input.decisions ?? {})) {
    if (!planByKey.has(key)) problems.push(`${key} is not in the package.`)
  }
  for (const [key, choices] of Object.entries(input.mergeChoices ?? {})) {
    if (decided.get(key) !== 'merge') {
      problems.push(`${key} is not merged, so its keys cannot be chosen.`)
      continue
    }
    for (const [field, choice] of Object.entries(choices ?? {})) {
      if (choice !== 'site' && choice !== 'package') {
        problems.push(`${key} key "${field}" cannot take "${String(choice)}"; it may take site or package.`)
      }
    }
  }

  // A dependency the person asked to import from the package is created
  // when it was new and set aside.
  for (const [depKey, choice] of Object.entries(input.dependencyChoices ?? {})) {
    if (choice !== 'import') continue
    const dep = planByKey.get(depKey)
    if (!dep) {
      problems.push(`${depKey} is not in the package, so it cannot be imported from it.`)
      continue
    }
    if (decided.get(depKey) === 'skip') decided.set(depKey, dep.comparison === 'new' ? 'create' : 'replace')
  }
  if (problems.length) throw new SitePackageDecisionError(problems)

  const takenSlugs = new Map<string, Set<string>>()
  const slugsOf = (kind: string) => {
    if (!takenSlugs.has(kind)) {
      takenSlugs.set(
        kind,
        new Set(
          [
            ...input.existing.filter((one) => one.kind === kind).map((one) => one.slug),
            ...input.plan.items.filter((one) => one.kind === kind).map((one) => one.slug),
          ].filter((slug): slug is string => Boolean(slug)),
        ),
      )
    }
    return takenSlugs.get(kind) as Set<string>
  }

  // Where each incoming item lands, and so where references to it go.
  const target = new Map<string, string>()
  const moved: Record<string, string> = {}
  for (const item of input.plan.items) {
    const decision = decided.get(item.key) as PackageItemDecision
    let id = item.id
    if (decision === 'keepBoth') id = input.newId()
    else if (item.existing && input.mode === 'decide') id = item.existing.id
    target.set(item.key, id)
    if (id !== item.id) moved[item.key] = id
  }

  // Every dependency that will exist nowhere after the import.
  const written = new Set(
    input.plan.items.filter((item) => decided.get(item.key) !== 'skip').map((item) => item.key),
  )
  const onSite = new Set(existingByKey.keys())
  const warnings: SitePackageWarning[] = []
  // Moves by item key; the raw id map below is what content walks use.
  const keyed = new Map<string, string | null>()
  for (const [key, id] of target) {
    const item = planByKey.get(key) as SitePackagePlanItem
    // A skipped item that matched nothing on the site leaves its references
    // to the dependency step below.
    if (decided.get(key) === 'skip' && !item.existing) continue
    if (id !== item.id) keyed.set(key, id)
  }
  for (const item of input.plan.items) {
    if (!written.has(item.key)) continue
    for (const dep of item.deps) {
      const depKey = `${dep.kind}/${dep.id}`
      if (written.has(depKey) || onSite.has(depKey)) continue
      if (planByKey.get(depKey)?.existing) continue
      const choice = input.dependencyChoices?.[depKey] ?? 'keep'
      if (typeof choice === 'object') {
        keyed.set(depKey, choice.mapTo)
        warnings.push({
          code: 'mappedReference',
          item: item.key,
          dependency: depKey,
          message: `${item.key} pointed at ${depKey}, which this site does not hold; it now points at ${dep.kind}/${choice.mapTo}.`,
        })
      } else if (choice === 'drop') {
        keyed.set(depKey, null)
        warnings.push({
          code: 'droppedReference',
          item: item.key,
          dependency: depKey,
          message: `${item.key} pointed at ${depKey}, which this site does not hold; the reference was removed.`,
        })
      } else {
        warnings.push({
          code: 'danglingReference',
          item: item.key,
          dependency: depKey,
          message: `${item.key} points at ${depKey}, which this site does not hold, and will until it does.`,
        })
      }
    }
  }
  // Ids that are words (a catalog key, `default`) are never moved through
  // content: the word would be rewritten wherever it is written.
  const idMap = new Map<string, string | null>()
  for (const [key, id] of keyed) {
    const kindName = key.slice(0, key.indexOf('/'))
    if (kinds.get(kindName)?.wordIds) continue
    idMap.set(key.slice(key.indexOf('/') + 1), id)
  }

  const writes: SitePackageWrite[] = []
  const skipped: string[] = []
  const contents = input.incoming.items
  for (const item of input.plan.items) {
    const decision = decided.get(item.key) as PackageItemDecision
    if (decision === 'skip') {
      skipped.push(item.key)
      continue
    }
    const kind = kinds.get(item.kind)
    const targetId = target.get(item.key) as string
    let ids: Map<string, string | null> = idMap
    if (kind?.keepsOwnId && idMap.has(item.id)) {
      ids = new Map(idMap)
      ids.delete(item.id)
    }
    let content = remapSiteReferences(asDoc(contents[item.key]), ids)
    const section = input.sections?.[item.kind]
    if (section && keyed.size) {
      const { $id: _id, ...rest } = section.remapIds({ $id: item.id, ...content }, keyed)
      content = rest
    }
    if (decision === 'keepBoth') {
      if (kind?.slugField && typeof content[kind.slugField] === 'string') {
        const slug = content[kind.slugField] as string
        const fresh = keepBothSlug(slug, slugsOf(item.kind))
        slugsOf(item.kind).add(fresh)
        content = { ...content, [kind.slugField]: fresh }
        if (typeof content['route'] === 'string') {
          content = { ...content, route: movedRoute(content['route'] as string, slug, fresh) }
          if (content['route'] === null) delete content['route']
        }
      } else if (kind?.nameField && typeof content[kind.nameField] === 'string') {
        content = { ...content, [kind.nameField]: `${content[kind.nameField] as string} (copy)` }
      }
    }
    let existingKey: string | undefined
    if (decision === 'replace' || decision === 'merge') {
      existingKey = `${item.kind}/${targetId}`
    }
    if (decision === 'merge') {
      const current = asDoc(existingByKey.get(existingKey as string)?.content)
      const incomingContent = content
      content = mergeSiteFields(current, incomingContent) as Doc
      for (const [field, choice] of Object.entries(input.mergeChoices?.[item.key] ?? {})) {
        const value = choice === 'package' ? incomingContent[field] : current[field]
        if (value === undefined) delete content[field]
        else content[field] = value
      }
    }
    writes.push({
      key: item.key,
      kind: item.kind,
      sourceId: item.id,
      targetId,
      decision,
      content,
      ...(existingKey ? { existingKey } : {}),
    })
  }
  return { writes, skipped, warnings, moved }
}

/**
 * A kept-both page's address: the original's with its last segment moved
 * to the copy's slug, or `null` — no address — when the original's address
 * does not end in its slug and so says nothing about where a copy goes.
 */
function movedRoute(route: string, slug: string, fresh: string): string | null {
  const trim = (value: string) => value.replace(/^\/+|\/+$/g, '')
  const from = trim(slug)
  const to = trim(fresh)
  const segments = route.split('/')
  if (!from || segments[segments.length - 1] !== from) return null
  segments[segments.length - 1] = to
  return segments.join('/')
}

/** Whether a package carries the format and version this module writes. */
export function isSitePackageFile(raw: unknown): boolean {
  const manifest = asDoc(asDoc(raw)['manifest'])
  return manifest['format'] === TRANSFER_PACKAGE_FORMAT && manifest['version'] === TRANSFER_PACKAGE_VERSION
}
