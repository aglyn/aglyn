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

import { screenRoutePathToUrl } from './screen-route'
import { nodesReferenceScreen } from './screen-link-value'
import {
  isScreenIndexable,
  isSearchDiscouraged,
  statusPageScreenIds,
  type SearchIndexingScreen,
} from './search-indexing'
import {
  SEO_AUDIT_MAX_PAGES,
  parseSeoKeywordLines,
  seoNormalizePath,
  type SeoAuditPage,
  type SeoAuditSite,
} from './seo-audit'
import { seoPageFacts } from './seo-page-facts'
import type { PageMarkdownNodes } from './page-markdown'
import { resolveSeoTitleVariables } from './seo-title-variables'
import { decodeStoredNodes } from './stored-nodes'

/**
 * Read a site for the SEO check (`seo-audit.ts`) the way its sitemap lists
 * it: every screen the routing map publishes, less the template screens, the
 * status pages and every screen that is not public — through the same shared
 * predicates the tenant's `sitemap.xml` and `/llms.txt` apply, so the check
 * covers exactly the pages a crawler is handed. Then each page's published
 * version, and the shared layouts, for the links that decide which pages
 * nothing points to.
 *
 * It knows nothing about the Firestore SDK. A caller hands it a
 * {@link SeoScanStore} — the Admin SDK's `Firestore` satisfies it — and the
 * template screen ids, which the tenant runtime resolves; so this module stays
 * pure enough to import from anywhere, and a spec hands it a fake.
 *
 * Reads: one projected query of the screens, one of the layouts, and one
 * version document per checked page and per layout — at most
 * {@link SEO_AUDIT_MAX_PAGES} + {@link SEO_SCAN_LAYOUT_LIMIT} + 2.
 */

/** Shared layouts read for the links they carry. */
export const SEO_SCAN_LAYOUT_LIMIT = 20

/** Version documents read at once. */
const READ_CHUNK = 10

/** Screen documents the projected query reads. */
const SCREEN_SCAN_LIMIT = 1000

/* ---- The store, structurally ---------------------------------------------- */

export interface SeoScanSnapshot {
  readonly exists: boolean
  get(field: string): unknown
}

export interface SeoScanQueryDocument {
  readonly id: string
  data(): unknown
  get(field: string): unknown
  readonly ref: SeoScanDocumentRef
}

export interface SeoScanQuery {
  limit(count: number): SeoScanQuery
  get(): Promise<{ readonly docs: readonly SeoScanQueryDocument[] }>
}

export interface SeoScanCollection {
  select(...fields: string[]): SeoScanQuery
  doc(id: string): SeoScanDocumentRef
}

export interface SeoScanDocumentRef {
  collection(name: string): SeoScanCollection
  get(): Promise<SeoScanSnapshot>
}

/** What the scan reads through; the Admin SDK's `Firestore` is one. */
export interface SeoScanStore {
  collection(name: string): SeoScanCollection
}

/* ---- What it reads --------------------------------------------------------- */

/** The host document fields the scan and the site findings read. */
export interface SeoSiteHost {
  displayName?: string
  screens?: Record<string, string>
  errorScreens?: Record<string, string>
  notFoundScreenId?: string | null
  seo?: {
    title?: string
    separator?: string
    discourageSearchEngines?: boolean
    entity?: { name?: string; description?: string }
    agent?: { whenToUse?: string }
  }
}

/** The screen document fields the scan reads. */
interface SeoScreenDocument {
  displayName?: string
  description?: string
  versionId?: string
  visibility?: unknown
  deletedAt?: unknown
  seo?: {
    title?: string
    description?: string
    breadcrumb?: string
    image?: string
    imageAlt?: string
  }
}

export interface SeoScannedPage extends SeoAuditPage {
  /** The listing as the screen document stores it: a title's variables unresolved. */
  storedSeo: NonNullable<SeoScreenDocument['seo']>
  /** The page's node map as checked. */
  nodes: Record<string, unknown> | null
}

export interface SeoSiteScan {
  pages: SeoScannedPage[]
  /** Published pages past {@link SEO_AUDIT_MAX_PAGES}. */
  skipped: number
  /** Customer-safe lines: a keyword line naming a page the site does not publish. */
  notes: string[]
}

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/** The site as the check reads it, from its host document. */
export function seoAuditSiteOf(host: SeoSiteHost): SeoAuditSite {
  return {
    discouraged: isSearchDiscouraged(host),
    entity: host.seo?.entity ?? {},
    agent: host.seo?.agent ?? {},
  }
}

/** A version's node map and root, or `null` when it cannot be read. */
async function readVersionNodes(
  parent: SeoScanDocumentRef,
  versionId: string,
): Promise<{ nodes: Record<string, unknown>; rootId?: string } | null> {
  if (!versionId) return null
  const snapshot = await parent.collection('versions').doc(versionId).get()
  if (!snapshot.exists) return null
  const nodes = decodeStoredNodes<Record<string, unknown>>(snapshot.get('nodes'))
  if (!nodes) return null
  const rootId = snapshot.get('rootId')
  return { nodes, ...(typeof rootId === 'string' ? { rootId } : {}) }
}

async function inChunks<T>(items: readonly T[], run: (item: T) => Promise<void>): Promise<void> {
  for (let start = 0; start < items.length; start += READ_CHUNK) {
    await Promise.all(items.slice(start, start + READ_CHUNK).map(run))
  }
}

/**
 * Read `hostId`'s published pages for the check.
 *
 * `keywords` are the target keyword lines a person typed (`/path: a, b`);
 * `templateScreenIds` are the screens a collection, the store or the host
 * renders other URLs through, which are not pages of their own.
 */
export async function scanSeoSite(
  store: SeoScanStore,
  hostId: string,
  host: SeoSiteHost,
  options: { keywords?: unknown; templateScreenIds?: Iterable<string> } = {},
): Promise<SeoSiteScan> {
  const hostRef = store.collection('hosts').doc(hostId)
  const routing = host.screens ?? {}
  const [screenDocs, layoutDocs] = await Promise.all([
    hostRef
      .collection('screens')
      .select('visibility', 'seo', 'description', 'displayName', 'versionId', 'deletedAt')
      .limit(SCREEN_SCAN_LIMIT)
      .get(),
    hostRef.collection('layouts').select('versionId').limit(SEO_SCAN_LAYOUT_LIMIT).get(),
  ])
  const screens = new Map(screenDocs.docs.map((doc) => [doc.id, (doc.data() ?? {}) as SeoScreenDocument]))
  const excluded = new Set<string>([...statusPageScreenIds(host), ...(options.templateScreenIds ?? [])])
  const published = Object.entries(routing)
    .filter(([screenId]) => !excluded.has(screenId))
    .filter(([screenId]) => {
      const screen = screens.get(screenId)
      return Boolean(screen) && !screen?.deletedAt && isScreenIndexable(screen as SearchIndexingScreen)
    })
    .map(([screenId, route]) => ({ screenId, path: screenRoutePathToUrl(String(route)) }))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  const checked = published.slice(0, SEO_AUDIT_MAX_PAGES)

  const versions = new Map<string, { nodes: Record<string, unknown>; rootId?: string } | null>()
  await inChunks(checked, async ({ screenId }) => {
    versions.set(
      screenId,
      await readVersionNodes(hostRef.collection('screens').doc(screenId), str(screens.get(screenId)?.versionId)),
    )
  })
  const layoutNodes: Record<string, unknown>[] = []
  await inChunks(
    layoutDocs.docs.filter((doc) => str(doc.get('versionId'))),
    async (doc) => {
      const version = await readVersionNodes(doc.ref, str(doc.get('versionId')))
      if (version) layoutNodes.push(version.nodes)
    },
  )

  const keywordsByPath = parseSeoKeywordLines(options.keywords)
  const checkedPaths = new Set(checked.map((page) => seoNormalizePath(page.path)))
  const notes = Object.keys(keywordsByPath)
    .filter((path) => !checkedPaths.has(path))
    .map((path) => `Keywords for ${path} were not used: no checked page is published at that address.`)

  const siteName = str(host.seo?.title) || str(host.displayName)
  const pages: SeoScannedPage[] = checked.map(({ screenId, path }) => {
    const screen = screens.get(screenId) ?? {}
    const version = versions.get(screenId) ?? null
    const storedSeo = screen.seo ?? {}
    const linkedFrom =
      layoutNodes.some((nodes) => nodesReferenceScreen(nodes, screenId)) ||
      checked.some(
        (other) =>
          other.screenId !== screenId &&
          nodesReferenceScreen(versions.get(other.screenId)?.nodes ?? null, screenId),
      )
    return {
      screenId,
      path,
      name: str(screen.displayName) || path,
      versionId: str(screen.versionId) || null,
      // Judged as the head renders it: `{{page.name}} – {{site.name}}` on two
      // pages is two different titles, and its length is the rendered one.
      seo: {
        ...storedSeo,
        title: resolveSeoTitleVariables(storedSeo.title, {
          'page.name': str(screen.displayName),
          'site.name': siteName,
          'site.separator': str(host.seo?.separator),
        }),
      },
      storedSeo,
      description: str(screen.description),
      facts: seoPageFacts(version?.nodes as PageMarkdownNodes | undefined, { rootId: version?.rootId }),
      linkedFrom,
      keywords: keywordsByPath[seoNormalizePath(path)] ?? [],
      nodes: version?.nodes ?? null,
    }
  })
  return { pages, skipped: Math.max(0, published.length - checked.length), notes }
}
