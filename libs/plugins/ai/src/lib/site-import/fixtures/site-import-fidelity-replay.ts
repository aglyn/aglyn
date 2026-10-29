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
 * The recorded pages brought in again, offline (AGL-4109), for the fidelity
 * spec and the fidelity report: each page of `site-layout/` read by the
 * reader, built by the import's compile and held to its page check as the
 * page step stores it, and each recorded home page's header and footer drawn
 * as the frame step draws them, with no model. Every page the source links
 * on its own site is a page the import plans, as on a whole-site import. No
 * live AI: a design answer here is a recorded one, in the shape the tool
 * answers.
 */

import { aiImportedPageCheck } from '../../jobs/ai-job-page-language'
import { aiSiteImportFrameJob, aiSiteImportHomeOf } from '../../jobs/ai-job-import-step'
import { aiLayoutSiteBrandOf, aiLayoutSiteFrameOf, aiLayoutSourceFrameBuild } from '../../jobs/ai-job-layout-language'
import { aiLayoutChecks } from '../../jobs/ai-job-layout-step'
import { aiSiteImportSectionNames } from '../../jobs/ai-site-import-compile'
import type { AiSiteImportDocument } from '../../jobs/ai-site-import-document'
import type { AiLayoutFrameSource } from '../../layout-language/ai-layout-frame-source'
import type { AiJob } from '../../model/ai-jobs.types'
import { aiSiteImportLedger, type AiSiteImportPage, type AiSiteImportState, type SiteImportFooter, type SiteImportNavTree } from '../../model/ai-site-import'
import type { SiteImportFidelitySource, SiteImportFidelityTree } from '../../model/ai-site-import-fidelity'
import { emptyAiSiteInventory } from '../../model/ai-site-inventory'
import type { SiteImportInventory } from '../site-import-crawl'
import { extractSiteImportPage, type SiteImportBlock } from '../site-import-html'
import { siteImportLayout, siteImportLookOf } from '../site-import-layout'
import { siteImportFooterColumns, siteImportNavTree, type SiteImportFrameSource } from '../site-import-nav'
import { siteImportPageRead } from '../site-import-page'
import { SITE_LAYOUT_PAGES, siteLayoutRecording, siteLayoutSameSite, type SiteLayoutPageName } from './site-layout-recordings'

/** The page's same-site addresses, each a page the import plans: every page a link may go to. */
function plannedLinks(blocks: readonly SiteImportBlock[], origin: string): Array<{ path: string; id: string }> {
  const paths = new Set<string>()
  for (const block of blocks) {
    if (block.kind !== 'link') continue
    try {
      const url = new URL(block.href)
      const path = url.pathname.replace(/\/+$/, '') || '/'
      if (url.origin === origin && path !== '/') paths.add(path)
    } catch {
      // Not an address.
    }
  }
  return [...paths].map((path) => ({ path, id: `p${path.replace(/[^a-z0-9]+/gi, '-')}` }))
}

/** A recorded page as a wave's read keeps it and the import step hands it on: its blocks, its layout, its photos in the library. */
export function siteImportReplayDocument(name: SiteLayoutPageName): AiSiteImportDocument {
  const { url } = SITE_LAYOUT_PAGES[name]
  const page = extractSiteImportPage(siteLayoutRecording(name), url, siteLayoutSameSite(name), { structure: true })
  const layout = siteImportLayout(page as Parameters<typeof siteImportLayout>[0])
  const path = new URL(url).pathname
  const read = siteImportPageRead({ ...page, layout, url, path, foundBy: path === '/' ? 'home' : 'sitemap', bytes: 0 } as never, 'now')
  const blocks = read.blocks ?? []
  const origin = new URL(url).origin
  const pictures = [...new Set(blocks.flatMap((block) => (block.kind === 'image' ? [block.url] : [])))]
  return {
    build: 'arranged',
    title: read.title,
    url,
    blocks,
    photos: pictures.map((from, index) => ({ mediaId: `m${index}`, src: `media:host-import/m${index}`, from, width: 1600, height: 900 })),
    links: plannedLinks(blocks, origin),
    origins: [origin, origin.replace('://', '://www.')],
    ...(read.layout ? { layout: read.layout } : {}),
  }
}

/** A recorded page built as the page step builds it: its source, its stored nodes, and what the page check said. */
export interface SiteImportReplayPage {
  doc: AiSiteImportDocument
  source: SiteImportFidelitySource
  tree: SiteImportFidelityTree
  violations: unknown[]
}

/**
 * A recorded page built and checked as the page step stores it (AGL-4109):
 * with a recorded design `answer`, as a main page is arranged, or with none,
 * as a page is drawn from its layout alone; `forms` are the site's saved
 * forms. `layout: false` builds it as a read with no layout was built, one
 * section at each second-level heading, as the 10/29 import did.
 */
export function siteImportReplayPage(
  name: SiteLayoutPageName,
  options: { answer?: Record<string, unknown> | null; forms?: Array<{ id: string; name: string }>; layout?: boolean } = {},
): SiteImportReplayPage {
  const read = siteImportReplayDocument(name)
  const { layout, ...rest } = read
  const doc: AiSiteImportDocument = options.layout === false ? rest : read
  const names = aiSiteImportSectionNames(doc)
  const sectionIds = names.map((_, index) => `sec-${index}`)
  const screen = { title: doc.title, slug: name === 'home' ? '/' : `/${name}`, sections: names.map((section) => ({ name: section, uses: [] as string[], items: 0 })) }
  const forms = options.forms ?? []
  const targets = { pageId: 'p0', pages: [], homeIds: [], forms, formPageId: null, components: [], facts: '' }
  const check = aiImportedPageCheck({
    screen: screen as never,
    sectionIds,
    targets: targets as never,
    context: { screenIds: doc.links.map((link) => link.id), formIds: forms.map((form) => form.id), componentIds: [], codeBuilt: true },
    design: { kind: 'business', seed: 7, home: name === 'home' } as never,
    doc,
  })
  const result = check(options.answer ?? null)
  const nodes = (result.value?.nodes ?? {}) as unknown as SiteImportFidelityTree['nodes']
  return {
    doc,
    source: { layout: layout as NonNullable<typeof layout>, blocks: read.blocks, photos: read.photos },
    tree: { rootId: '_@_', nodes },
    violations: result.violations,
  }
}

/**
 * The design answer recorded for aglyn.com's Home, in the tool's shape: a
 * split hero, ruled cards, a dark band asked where the source drew its own
 * white, a style of pictures for a group that has none. The compile spec
 * holds the same one.
 */
export const SITE_IMPORT_REPLAY_HOME_ANSWER: Readonly<Record<string, unknown>> = {
  sections: [
    { hero: 'split', band: 'source', align: 'start', groups: [] },
    { hero: 'none', band: 'source', align: 'source', groups: [{ kind: 'source', style: 'ruled' }] },
    { hero: 'none', band: 'dark', align: 'source', groups: [] },
    { hero: 'none', band: 'source', align: 'source', groups: [{ kind: 'source', style: 'pictures' }] },
  ],
}

/** The recorded home pages a header and footer is drawn from. */
export type SiteImportReplayHome = Extract<SiteLayoutPageName, 'home' | 'pottery'>

const NOW = new Date('2026-10-29T18:00:00.000Z')

/** A recorded home page as the crawl keeps it: its menu, footer and look read as the source builds them. */
function crawledHome(name: SiteImportReplayHome): SiteImportInventory['pages'][number] {
  const { url } = SITE_LAYOUT_PAGES[name]
  const extract = extractSiteImportPage(siteLayoutRecording(name), url, siteLayoutSameSite(name), { structure: true })
  const source = extract as SiteImportFrameSource
  const { structure: _structure, loginForm: _loginForm, ...rest } = extract
  return { ...rest, url, path: '/', foundBy: 'home', bytes: 0, nav: siteImportNavTree(source), footer: siteImportFooterColumns(source), look: siteImportLookOf(source) }
}

/** A site planned for its first wave: Home, and two pages of its own. */
function replayState(name: SiteImportReplayHome): AiSiteImportState {
  const origin = new URL(SITE_LAYOUT_PAGES[name].url).origin
  const paths = name === 'home' ? ['/', '/product', '/pricing'] : ['/', '/classes', '/gallery']
  const pages: AiSiteImportPage[] = paths.map((path, index) => {
    const slug = path === '/' ? '/' : (path.split('/').filter(Boolean).pop() as string)
    return { slot: `p${index}`, url: `${origin}${path}`, path, title: slug, group: 'main', wave: 1, draftId: `draft${index}`, slug, words: 300, images: 0 }
  })
  return {
    domain: new URL(origin).hostname.replace(/^www\./, ''),
    siteName: 'import-check',
    ownership: { method: 'dns', provenAt: 1, detail: null },
    readAt: NOW.toISOString(),
    pageLimit: null,
    existingPages: 0,
    found: pages.length,
    stoppedBy: null,
    groups: [],
    pages,
    waves: [{ index: 1, label: 'Wave 1', group: 'main', slots: pages.map((page) => page.slot), frame: true, status: 'running', startedAt: NOW.toISOString(), finishedAt: null }],
    leftOut: [],
    leftOutCount: {},
    frame: { draftId: 'frameDraft' },
    reviewId: null,
    home: aiSiteImportHomeOf({ pages: [crawledHome(name)] }),
    look: {
      at: NOW.toISOString(),
      theme: 'applied',
      colors: [],
      logo: name === 'home' ? { mediaId: 'm1', src: 'media:host-import/m1', width: 632, height: 192 } : null,
      seo: true,
      seed: 7,
    },
  }
}

/** A recorded home page's header and footer as the frame step draws them: the source's menu and footer, the stored nodes, the check's word. */
export interface SiteImportReplayFrame {
  nav: SiteImportNavTree | null
  footer: SiteImportFooter | null
  tree: SiteImportFidelityTree
  violations: unknown[]
}

/** A recorded home page's header and footer, drawn with no model as the layout step stores them (AGL-4108). */
export function siteImportReplayFrame(name: SiteImportReplayHome): SiteImportReplayFrame {
  const state = replayState(name)
  const job = {
    $id: 'importJob',
    orgId: 'org-replay',
    hostId: 'host-replay',
    kind: 'import',
    status: 'running',
    brief: `Bring in ${state.domain}`,
    inputs: { domain: state.domain },
    steps: [],
    outputs: [],
    createdBy: 'uid-replay',
    createdAt: NOW,
    updatedAt: NOW,
    expiresAt: NOW,
  } as unknown as AiJob
  const frameJob = aiSiteImportFrameJob(job, state, state.waves[0] as AiSiteImportState['waves'][number], aiSiteImportLedger(state))
  const home = state.pages[0] as AiSiteImportPage
  const built = aiLayoutSourceFrameBuild({
    siteName: String(frameJob.inputs?.['businessName']),
    homeId: home.draftId,
    pages: [{ id: home.draftId, label: 'Home', slug: '/' }],
    targets: { pageId: null, pages: [], homeIds: [home.draftId], forms: [], formPageId: null, components: [], facts: '' } as never,
    extend: aiLayoutChecks(emptyAiSiteInventory('host-replay'), frameJob.plan ?? null, [frameJob.brief, ...(state.home?.facts.lines ?? [])].join('\n')),
    brand: aiLayoutSiteBrandOf(frameJob.inputs),
    source: aiLayoutSiteFrameOf(frameJob.inputs) as AiLayoutFrameSource,
  })
  const nodes = (built.value?.nodes ?? {}) as unknown as SiteImportFidelityTree['nodes']
  return { nav: state.home?.nav ?? null, footer: state.home?.footer ?? null, tree: { rootId: '_@_', nodes }, violations: built.violations }
}
