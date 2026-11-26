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

import { buildPageMarkdown } from '@aglyn/aglyn/app-utils/page-markdown'
import {
  buildSectionIndex,
  rankSections,
  type RankedSection,
  type SectionIndex,
} from '@aglyn/aglyn/app-utils/section-retrieval'
import * as Aglyn from '@aglyn/aglyn/server'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'
import {
  PUBLISHED_SITE_DATA_TTL_SECONDS,
  tenantDataTag,
  withRenderCache,
} from '@aglyn/tenant-data-admin/render-cache'
import getScreenVersion from './get-screen-version'
import getTemplateScreenIds from './template-screens'

/**
 * A published site's own section index (AGL-4250): every published page and
 * content entry, cut at its headings into sections a question can be scored
 * against. Site search's page results and the site chat's grounding read the
 * same index, so the chat answers from exactly what a visitor could find.
 *
 * Built once per published state: the index is cached on the site and tagged
 * with its data tag, so the publish that busts the pages busts the index with
 * them, and the first question after a publish builds the new one. Between
 * publishes it costs no Firestore read at all.
 */

export interface SiteSection {
  /** The site path the section is on: `/about`. */
  url: string
  /** The page's own title. */
  title: string
  /** The heading the section sits under; '' for the text above the first. */
  heading: string
  /** Plain text, capped. */
  text: string
  kind: 'page' | 'entry'
}

/** Text one section keeps: enough to answer from, little enough to quote. */
export const SITE_SECTION_TEXT_CHARS = 1_200
/** Sections one site keeps: the index is one cache entry. */
export const SITE_SECTION_LIMIT = 600
const SCREEN_LIMIT = 100
const COLLECTION_LIMIT = 20
const ENTRY_LIMIT = 60

const collapse = (value: string): string => value.replace(/\s+/g, ' ').trim()

/** Markdown to the words a reader sees: links keep their text, marks go. */
export function markdownToPlainText(markdown: string): string {
  return collapse(
    String(markdown ?? '')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^>\s?/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '')
      .replace(/^\s*\d+\.\s+/gm, '')
      .replace(/^---+$/gm, ' ')
      .replace(/[*_`~]+/g, '')
      .replace(/\\([\\`*_{}[\]()#+\-.!>|])/g, '$1'),
  )
}

/**
 * One page's Markdown, cut at its headings. The `# ` line names the page
 * (`fallbackTitle` when it has none); every deeper heading opens a section.
 * A heading with nothing under it still carries its own words.
 */
export function splitMarkdownIntoSections(
  markdown: string,
  page: { url: string; fallbackTitle: string; kind: SiteSection['kind'] },
): SiteSection[] {
  const lines = String(markdown ?? '').split('\n')
  let title = collapse(page.fallbackTitle)
  const sections: SiteSection[] = []
  let heading = ''
  let body: string[] = []
  const flush = () => {
    const text = markdownToPlainText(body.join('\n')).slice(0, SITE_SECTION_TEXT_CHARS)
    if (text || heading) {
      sections.push({ url: page.url, title, heading, text, kind: page.kind })
    }
    body = []
  }
  for (const line of lines) {
    const match = /^(#{1,6})\s+(.*)$/.exec(line)
    if (match && match[1].length === 1 && !sections.length && !body.join('').trim()) {
      title = markdownToPlainText(match[2]) || title
      continue
    }
    if (match) {
      flush()
      heading = markdownToPlainText(match[2])
      continue
    }
    if (/^Source: /.test(line)) continue
    body.push(line)
  }
  flush()
  return sections.map((section) => ({ ...section, title: section.title || page.url }))
}

/** Every section of the site's published pages and entries. Uncached. */
export async function readSiteSections(host: Aglyn.AglynHost): Promise<SiteSection[]> {
  const hostId = host.$id
  const hostRef = firebaseAdmin.app().firestore().collection('hosts').doc(hostId)
  const routing = host.screens ?? {}
  const templateScreenIds = await getTemplateScreenIds({ hostId })
  const screenIds = Object.keys(routing)
    .filter((screenId) => !templateScreenIds.has(screenId))
    .slice(0, SCREEN_LIMIT)
  const pages = await Promise.all(
    screenIds.map(async (screenId) => {
      try {
        const snapshot = await hostRef.collection('screens').doc(screenId).get()
        if (!snapshot.exists) return []
        const screen = snapshot.data() as Record<string, any>
        const path = routing[screenId]
        const versionId = screen?.['versionId']
        if (path == null || !versionId) return []
        const { version } = await getScreenVersion({
          hostId,
          screenId,
          versionId: String(versionId),
        })
        const nodes = Aglyn.decodeStoredNodes((version as any)?.nodes) ?? null
        const title = String(screen?.['seo']?.title || screen?.['displayName'] || '')
        const markdown = buildPageMarkdown({
          nodes: nodes as never,
          front: { title, description: String(screen?.['seo']?.description ?? '') },
          context: { hostId, screenRoutes: routing as Record<string, string> },
        })
        return splitMarkdownIntoSections(markdown, {
          url: Aglyn.screenRoutePathToUrl(path),
          fallbackTitle: title,
          kind: 'page',
        })
      } catch (error) {
        console.error(error)
        return []
      }
    }),
  )

  const entries: SiteSection[] = []
  try {
    const collections = await hostRef.collection('collections').limit(COLLECTION_LIMIT).get()
    for (const collectionDoc of collections.docs) {
      if (Aglyn.hostCollectionKind(collectionDoc.data()) !== 'content') continue
      const slug = String(collectionDoc.get('slug') ?? '')
      const published = await collectionDoc.ref
        .collection('entries')
        .where('status', '==', 'published')
        .limit(ENTRY_LIMIT)
        .get()
      for (const entryDoc of published.docs) {
        const entry = entryDoc.data() as Record<string, any>
        const title = String(entry['title'] ?? entryDoc.id)
        const body = [entry['excerpt'] ? `> ${entry['excerpt']}` : '', String(entry['body'] ?? '')]
          .filter(Boolean)
          .join('\n\n')
        entries.push(
          ...splitMarkdownIntoSections(body, {
            url: `/${slug}/${entry['slug'] ?? entryDoc.id}`,
            fallbackTitle: title,
            kind: 'entry',
          }),
        )
      }
    }
  } catch (error) {
    console.error(error)
  }

  return [...pages.flat(), ...entries].slice(0, SITE_SECTION_LIMIT)
}

/**
 * The site's sections, cached until its next publish. Fails open to an
 * uncached read, the posture every published-site reader takes: a cache
 * fault makes grounding slower, never absent.
 */
export async function getSiteSections(host: Aglyn.AglynHost): Promise<SiteSection[]> {
  const read = () => readSiteSections(host)
  try {
    return await withRenderCache({
      key: ['tenant-site-sections', host.$id],
      revalidate: PUBLISHED_SITE_DATA_TTL_SECONDS,
      tags: [tenantDataTag(host.$id)],
      read,
    })
  } catch (error) {
    console.error(error)
    return read()
  }
}

/**
 * Tokenized once per process per published state: a cached read hands back a
 * fresh array each time, so the index is kept by site and by a signature of
 * what it was built from, and a publish (a new signature) replaces it.
 */
const indexes = new Map<string, { signature: string; index: SectionIndex<SiteSection> }>()
const INDEXES_KEPT = 200

const signatureOf = (sections: readonly SiteSection[]): string =>
  `${sections.length}:${sections.reduce((sum, section) => sum + section.text.length + section.url.length, 0)}`

export function siteSectionIndex(
  sections: readonly SiteSection[],
  siteKey?: string,
): SectionIndex<SiteSection> {
  if (!siteKey) return buildSectionIndex(sections)
  const signature = signatureOf(sections)
  const kept = indexes.get(siteKey)
  if (kept && kept.signature === signature) return kept.index
  const index = buildSectionIndex(sections)
  indexes.delete(siteKey)
  indexes.set(siteKey, { signature, index })
  if (indexes.size > INDEXES_KEPT) indexes.delete(indexes.keys().next().value as string)
  return index
}

/**
 * The sections of a site that answer `question`, best first. idf-weighted:
 * the business's own name is on every page and must not decide the answer.
 */
export function rankSiteSections(
  sections: readonly SiteSection[],
  question: string,
  limit = 6,
  siteKey?: string,
): RankedSection<SiteSection>[] {
  return rankSections(siteSectionIndex(sections, siteKey), question, { limit, idf: true })
}

/** The best sections of `host` for `question`. */
export async function retrieveSiteSections(
  host: Aglyn.AglynHost,
  question: string,
  limit = 6,
): Promise<RankedSection<SiteSection>[]> {
  const needle = String(question ?? '').trim()
  if (!needle || needle.length > 500) return []
  return rankSiteSections(await getSiteSections(host), needle, limit, host.$id)
}
