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
  chunkForInQuery,
  classifyPagePath,
  displayCountedPath,
  normalizeCountedPath,
  type PagePathClass,
} from '@aglyn/aglyn/app-utils/page-traffic'
import { hostCollectionKind } from '@aglyn/aglyn/app-utils/collection-kind'
import { hostPublicOrigin } from '@aglyn/aglyn/app-utils/host-naming'
import {
  listSiteBuiltInPages,
  listSitePathKinds,
  type ResolvedSitePathKind,
} from '@aglyn/aglyn/plugin-manager/site-path-kinds'
import {
  collection,
  doc,
  documentId,
  getDoc,
  getDocs,
  query,
  where,
  type Firestore,
} from 'firebase/firestore'
import { collectionTemplateScreenIds } from '../constants/collection-templates'
import { buildRoute, Route } from '../constants/route-links'

/** One grouping of the Pages table: Pages, Products, a blog… */
export interface SitePageGroup {
  id: string
  label: string
}

/**
 * What a counted path is, in words a site owner reads (AGL-4253): the
 * product's name, the post's title, the page's title — never the template
 * screen that drew it.
 */
export interface SitePageLabel {
  /** The path as a visitor types it: `/products/nova`. */
  path: string
  group: SitePageGroup
  title: string
  /** A second line when the title alone would mislead: a removed record. */
  note: string | null
  /** Where it is edited in the console; null for nowhere. */
  editHref: string | null
  /** The live page; null when nothing answers the path now. */
  liveHref: string | null
  /**
   * The routed screen, for a page that is ONE screen at ONE path — the only
   * rows whose per-screen device and referrer counts are this page's own.
   */
  screenId: string | null
}

export const PAGES_GROUP: SitePageGroup = { id: 'pages', label: 'Pages' }
export const BUILT_IN_GROUP: SitePageGroup = { id: 'builtIn', label: 'Built-in pages' }
export const OTHER_GROUP: SitePageGroup = { id: 'other', label: 'Other addresses' }

interface HostFacts {
  routes: Record<string, string>
  origin: string | null
  collections: Array<Record<string, unknown> & { $id: string }>
}

interface LabelContext {
  orgSlug: string
  host: string
}

/**
 * Labels last five minutes per path. A label changes when a product is
 * renamed, which is not worth a read per page open; a site owner who renamed
 * one sees the new name on the next visit.
 */
const LABEL_TTL_MS = 5 * 60_000
const labelCache = new Map<string, { value: SitePageLabel; storedAt: number }>()
const factsCache = new Map<string, { value: HostFacts; storedAt: number }>()

/** Test seam: the caches are module scope by design. */
export function resetSitePageLabelCache(): void {
  labelCache.clear()
  factsCache.clear()
}

async function readHostFacts(
  firestore: Firestore,
  hostId: string,
  now: number,
): Promise<HostFacts> {
  const hit = factsCache.get(hostId)
  if (hit && now - hit.storedAt < LABEL_TTL_MS) return hit.value
  const [hostSnapshot, collectionsSnapshot] = await Promise.all([
    getDoc(doc(firestore, 'hosts', hostId)),
    getDocs(collection(firestore, 'hosts', hostId, 'collections')),
  ])
  const hostData = (hostSnapshot.data() ?? {}) as Record<string, unknown>
  const value: HostFacts = {
    routes: (hostData['screens'] ?? {}) as Record<string, string>,
    origin: hostPublicOrigin(hostData as never) ?? null,
    collections: collectionsSnapshot.docs.map((snapshot) => ({
      ...(snapshot.data() as Record<string, unknown>),
      $id: snapshot.id,
    })),
  }
  factsCache.set(hostId, { value, storedAt: now })
  return value
}

/** Reads `ids`' docs from `path`, thirty to a query, keyed by id. */
async function readByIds(
  firestore: Firestore,
  path: string[],
  ids: string[],
): Promise<Map<string, Record<string, unknown>>> {
  const found = new Map<string, Record<string, unknown>>()
  for (const chunk of chunkForInQuery(ids)) {
    const snapshot = await getDocs(
      query(
        collection(firestore, path[0], ...path.slice(1)),
        where(documentId(), 'in', chunk),
      ),
    )
    for (const one of snapshot.docs) found.set(one.id, one.data())
  }
  return found
}

/** Reads the docs whose `field` is one of `values`, keyed by that value. */
async function readByField(
  firestore: Firestore,
  path: string[],
  field: string,
  values: string[],
  accepts?: (data: Record<string, unknown>) => boolean,
): Promise<Map<string, { id: string; data: Record<string, unknown> }>> {
  const found = new Map<string, { id: string; data: Record<string, unknown> }>()
  for (const chunk of chunkForInQuery(values)) {
    const snapshot = await getDocs(
      query(
        collection(firestore, path[0], ...path.slice(1)),
        where(field, 'in', chunk),
      ),
    )
    for (const one of snapshot.docs) {
      const data = one.data() as Record<string, unknown>
      if (accepts && !accepts(data)) continue
      const key = String(data[field] ?? '')
      if (key && !found.has(key)) found.set(key, { id: one.id, data })
    }
  }
  return found
}

const text = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : ''

/**
 * Names every path in `paths` (counted keys, any form). Reads only what was
 * visited and not labeled in the last five minutes: the host doc and its
 * collections once, then one `in` query per thirty pages, records or entries.
 *
 * A read that fails throws — the caller shows the paths unlabeled and SAYS
 * so, rather than filing a product under "Other addresses" because its
 * lookup was denied.
 */
export async function labelSitePaths(options: {
  firestore: Firestore
  hostId: string
  paths: readonly string[]
  context: LabelContext
  now?: number
}): Promise<Map<string, SitePageLabel>> {
  const { firestore, hostId, context } = options
  const now = options.now ?? Date.now()
  const result = new Map<string, SitePageLabel>()
  const wanted: string[] = []
  for (const raw of options.paths) {
    const path = normalizeCountedPath(raw)
    const hit = labelCache.get(`${hostId}|${path}`)
    if (hit && now - hit.storedAt < LABEL_TTL_MS) result.set(path, hit.value)
    else if (!wanted.includes(path)) wanted.push(path)
  }
  if (!wanted.length) return result

  const facts = await readHostFacts(firestore, hostId, now)
  const kinds = new Map<string, ResolvedSitePathKind>(
    listSitePathKinds().map((kind) => [kind.segment, kind]),
  )
  const contentCollections = facts.collections.filter(
    (one) => hostCollectionKind(one) === 'content' && text(one['slug']),
  )
  const contentBySlug = new Map(
    contentCollections.map((one) => [text(one['slug']), one]),
  )
  const builtInPages = new Map(listSiteBuiltInPages().map((page) => [page.path, page.title]))
  const classes = new Map<string, PagePathClass>()
  for (const path of wanted) {
    classes.set(
      path,
      classifyPagePath(path, {
        routes: facts.routes,
        templateScreenIds: collectionTemplateScreenIds(facts.collections as never),
        recordSegments: new Set(kinds.keys()),
        contentCollectionSlugs: new Set(contentBySlug.keys()),
        builtInPages,
      }),
    )
  }

  // What to read, grouped so each source is one batch of `in` queries.
  const screenIds = new Set<string>()
  const recordSlugs = new Map<string, Set<string>>()
  const entrySlugs = new Map<string, Set<string>>()
  for (const found of classes.values()) {
    if (found.kind === 'page') screenIds.add(found.screenId)
    if (found.kind === 'record') {
      const set = recordSlugs.get(found.segment) ?? new Set<string>()
      set.add(found.slug)
      recordSlugs.set(found.segment, set)
    }
    if (found.kind === 'entry') {
      const set = entrySlugs.get(found.collectionSlug) ?? new Set<string>()
      set.add(found.entrySlug)
      entrySlugs.set(found.collectionSlug, set)
    }
  }
  const [screens, records, entries] = await Promise.all([
    readByIds(firestore, ['hosts', hostId, 'screens'], [...screenIds]),
    Promise.all(
      [...recordSlugs].map(async ([segment, slugs]) => {
        const kind = kinds.get(segment) as ResolvedSitePathKind
        return [
          segment,
          await readByField(
            firestore,
            ['hosts', hostId, kind.collection],
            kind.slugField ?? 'slug',
            [...slugs],
            kind.accepts,
          ),
        ] as const
      }),
    ).then((pairs) => new Map(pairs)),
    Promise.all(
      [...entrySlugs].map(async ([collectionSlug, slugs]) => {
        const owner = contentBySlug.get(collectionSlug) as { $id: string }
        return [
          collectionSlug,
          await readByField(
            firestore,
            ['hosts', hostId, 'collections', owner.$id, 'entries'],
            'slug',
            [...slugs],
          ),
        ] as const
      }),
    ).then((pairs) => new Map(pairs)),
  ])

  const live = (path: string) =>
    facts.origin ? `${facts.origin}${displayCountedPath(path) === '/' ? '' : displayCountedPath(path)}` : null

  for (const path of wanted) {
    const found = classes.get(path) as PagePathClass
    const shown = displayCountedPath(path)
    let label: SitePageLabel
    if (found.kind === 'page') {
      const screen = screens.get(found.screenId)
      const versionId = text(screen?.['versionId'])
      label = {
        path: shown,
        group: PAGES_GROUP,
        title:
          text(screen?.['displayName']) ||
          text(screen?.['name']) ||
          (shown === '/' ? 'Home' : shown),
        note: null,
        editHref: versionId
          ? buildRoute(Route.SCREEN_DETAILS, {
              ...context,
              screenId: found.screenId,
              versionId,
            })
          : null,
        liveHref: live(path),
        screenId: found.screenId,
      }
    } else if (found.kind === 'record') {
      const kind = kinds.get(found.segment) as ResolvedSitePathKind
      const record = records.get(found.segment)?.get(found.slug)
      const title = record ? text(record.data[kind.titleField ?? 'name']) : ''
      label = {
        path: shown,
        group: { id: `record:${kind.segment}`, label: kind.groupLabel },
        title: title || shown,
        note: record ? null : `Not a ${kind.noun} on this site now`,
        editHref: record ? (kind.editHref?.(context, record.id) ?? null) : null,
        liveHref: record ? live(path) : null,
        screenId: null,
      }
    } else if (found.kind === 'entry' || found.kind === 'collectionList') {
      const owner = contentBySlug.get(found.collectionSlug) as Record<string, unknown> & {
        $id: string
      }
      const collectionName =
        text(owner['displayName']) || text(owner['name']) || found.collectionSlug
      const group = { id: `content:${found.collectionSlug}`, label: collectionName }
      if (found.kind === 'collectionList') {
        label = {
          path: shown,
          group,
          title: `${collectionName} (list page)`,
          note: null,
          editHref: buildRoute(Route.HOST_CONTENT_COLLECTION, {
            ...context,
            collectionSlug: found.collectionSlug,
          }),
          liveHref: live(path),
          screenId: null,
        }
      } else {
        const entry = entries.get(found.collectionSlug)?.get(found.entrySlug)
        label = {
          path: shown,
          group,
          title: (entry && text(entry.data['title'])) || shown,
          note: entry ? null : `Not in ${collectionName} now`,
          editHref: entry
            ? buildRoute(Route.CONTENT_ENTRY_DETAILS, {
                ...context,
                collectionSlug: found.collectionSlug,
                entryId: entry.id,
              })
            : null,
          liveHref: entry ? live(path) : null,
          screenId: null,
        }
      }
    } else if (found.kind === 'builtIn') {
      label = {
        path: shown,
        group: BUILT_IN_GROUP,
        title: found.title,
        note: null,
        editHref: null,
        liveHref: live(path),
        screenId: null,
      }
    } else {
      label = {
        path: shown,
        group: OTHER_GROUP,
        title: shown,
        // Not "nothing answers": a page a plugin serves without declaring it
        // here would land in this group too, and this is all that is known.
        note: 'Not a page, product or post of this site now',
        editHref: null,
        liveHref: null,
        screenId: null,
      }
    }
    labelCache.set(`${hostId}|${path}`, { value: label, storedAt: now })
    result.set(path, label)
  }
  return result
}
